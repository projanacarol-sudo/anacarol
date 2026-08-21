/**
 * POST /api/email/enviar-massa   { assunto, html, offset, postId }   (protegido)
 * Pega 100 leads com opt-in, injeta o link de descadastro por destinatário e
 * dispara via Resend batch. Devolve o progresso (o front chama em loop).
 *
 * O HTML deve conter o placeholder %UNSUB% no rodapé (trocado por lead).
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!(await requireAuth(request, env))) return json({ erro: "nao_autorizado" }, 401);
  if (!env.RESEND_API_KEY) return json({ erro: "falta RESEND_API_KEY" }, 200);

  let body = {}; try { body = await request.json(); } catch (e) {}
  const { assunto, html, offset = 0, postId = null, tag = null, origem = null } = body;
  if (!assunto || !html) return json({ erro: "faltam assunto ou html" }, 200);

  // 1) 100 contatos com opt-in (LGPD): opt_in_email = true e não descadastrado.
  //    Filtra por origem (preferencial) OU por tag, se vierem.
  const filtro = origem
    ? `&origem_id=eq.${encodeURIComponent(String(origem))}`
    : (tag ? `&tags=cs.{${encodeURIComponent(String(tag))}}` : "");
  const q = `/leads?select=id,email,email_normalizado&opt_in_email=eq.true&unsubscribed_email=eq.false&email_normalizado=not.is.null${filtro}&order=id&limit=100&offset=${offset}`;
  let leads = [];
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1${q}`, {
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY },
    });
    leads = (await r.json()) || [];
  } catch (e) { return json({ erro: "falha ao ler contatos", detalhe: e.message, offset }, 200); }

  // trava de segurança: 1 único `to` inválido derruba o LOTE inteiro no Resend.
  // A base (fase 32) já mantém o pool limpo; aqui garantimos de novo, barato.
  const RX = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/;   // estrito: barra *, acento, etc.
  const validos = leads
    .map(l => ({ id: l.id, email: String(l.email_normalizado || l.email || "").trim().toLowerCase() }))
    .filter(l => RX.test(l.email));
  if (validos.length === 0) {
    return json({ ok: true, enviados_no_lote: 0, proximo_offset: offset + leads.length, acabou: leads.length < 100 }, 200);
  }

  // 2) monta o lote (Resend batch: até 100), com unsub por destinatário
  const base = env.PUBLIC_BASE || "";
  const payload = validos.map(l => {
    const unsub = `${base}/api/unsub?l=${encodeURIComponent(l.id)}`;
    return {
      from: env.RESEND_FROM,
      to: [l.email],
      subject: assunto,
      html: String(html).replace(/%UNSUB%/g, unsub),
      headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      tags: postId ? [{ name: "post", value: String(postId).slice(0, 60) }] : undefined,
    };
  });

  // LOG do que será enviado (aparece no Cloudflare → Functions → Real-time Logs)
  console.log("[enviar-massa v74] from:", env.RESEND_FROM,
    "| qtd:", validos.length, "| to:", validos.map(v => v.email).join(", "));

  const r = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const d = await r.json().catch(() => ({}));

  // ids aceitos (pra métricas). Se o batch passou, pega deles.
  let sentIds = r.ok && Array.isArray(d.data) ? d.data.map(x => x && x.id).filter(Boolean) : [];
  let recusados = [];

  // FALLBACK: o batch é tudo-ou-nada — 1 endereço que o Resend rejeite derruba
  // os 100. Reenvia UM A UM, pula os recusados e os tira do pool de envio
  // (email_normalizado = null) pra não repetir nos próximos disparos.
  if (!r.ok) {
    for (const l of validos) {
      const unsub = `${base}/api/unsub?l=${encodeURIComponent(l.id)}`;
      const one = {
        from: env.RESEND_FROM, to: [l.email], subject: assunto,
        html: String(html).replace(/%UNSUB%/g, unsub),
        headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        tags: postId ? [{ name: "post", value: String(postId).slice(0, 60) }] : undefined,
      };
      try {
        const rr = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify(one),
        });
        const dd = await rr.json().catch(() => ({}));
        if (rr.ok && dd.id) sentIds.push(dd.id); else recusados.push(l);
      } catch (e) { recusados.push(l); }
    }
    if (recusados.length) {
      console.log("[enviar-massa v74] recusados pelo Resend:", recusados.map(x => x.email).join(", "));
      try {
        const ids = recusados.map(x => x.id).join(",");
        await fetch(`${env.SUPABASE_URL}/rest/v1/leads?id=in.(${ids})`, {
          method: "PATCH",
          headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ email_normalizado: null }),
        });
      } catch (e) {}
    }
  }

  // métricas: liga cada email_id ao post e conta enviados
  if (postId && sentIds.length) {
    try {
      const rows = sentIds.map(eid => ({ email_id: eid, post_id: postId }));
      await fetch(`${env.SUPABASE_URL}/rest/v1/email_sends?on_conflict=email_id`, {
        method: "POST",
        headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(rows),
      });
      await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/email_campaign_bump`, {
        method: "POST",
        headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ p_post: postId, p_campo: "enviados", p_delta: sentIds.length }),
      });
    } catch (e) { /* métrica não bloqueia o envio */ }
  }

  const proximo = offset + leads.length;   // avança pelos LIDOS (não pelos válidos), senão para cedo
  const acabou = leads.length < 100;

  // marca o post como enviado ao terminar
  if (acabou && postId) {
    try {
      await fetch(`${env.SUPABASE_URL}/rest/v1/ig_email_posts?id=eq.${encodeURIComponent(postId)}`, {
        method: "PATCH",
        headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ enviado_em: new Date().toISOString() }),
      });
    } catch (e) {}
  }

  return json({ ok: true, enviados_no_lote: sentIds.length, recusados: recusados.length, proximo_offset: proximo, acabou }, 200);
}

async function requireAuth(request, env) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  try { const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token } }); return r.ok; } catch (e) { return false; }
}
function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } }); }

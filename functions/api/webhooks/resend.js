/**
 * CRM Ana — Webhook do Resend: POST /api/webhooks/resend
 * Recebe eventos (delivered/opened/clicked/bounced/complained) e grava
 * em email_events, ligando ao lead pelo e-mail. Descadastra em complaint.
 *
 * Variáveis: SUPABASE_URL, SUPABASE_SERVICE_KEY
 *            RESEND_WEBHOOK_SECRET  (opcional; verifica assinatura svix)
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const raw = await request.text();

  // verificação de assinatura (svix), se o segredo estiver configurado
  if (env.RESEND_WEBHOOK_SECRET) {
    const ok = await verifySvix(request, raw, env.RESEND_WEBHOOK_SECRET);
    if (!ok) return new Response("bad signature", { status: 401 });
  }

  let ev;
  try { ev = JSON.parse(raw); } catch { return json({ ok: false }, 200); }
  try {
    await handle(env, ev);
  } catch (e) {
    console.log("ERRO webhook resend:", String(e));
  }
  return json({ ok: true }, 200);
}

async function handle(env, ev) {
  const tipo = String(ev.type || "").replace(/^email\./, ""); // sent|delivered|opened|clicked|bounced|complained
  const data = ev.data || {};
  const to = Array.isArray(data.to) ? data.to[0] : data.to;
  const emailNorm = (to || "").trim().toLowerCase();
  let leadId = null;
  if (emailNorm) {
    const rows = await sb(env, "GET", `/leads?email_normalizado=eq.${encodeURIComponent(emailNorm)}&select=id&limit=1`);
    leadId = rows[0] ? rows[0].id : null;
  }
  await sb(env, "POST", "/email_events", {
    lead_id: leadId,
    email_id: data.email_id || data.id || null,
    tipo: mapTipo(tipo),
    url_clicada: (data.click && data.click.link) || null,
    payload: ev,
  });
  // reclamação de spam -> descadastra (protege a reputação do domínio)
  if (tipo === "complained" && leadId) {
    await sb(env, "PATCH", `/leads?id=eq.${leadId}`, { unsubscribed_email: true, opt_in_email: false });
    await pausarFunis(env, leadId);
  }
  // hard bounce (permanente) -> descadastra. NÃO mexe em bounce temporário
  // (transient) nem em delivery_delayed (que o mapTipo trata como "bounced").
  if (tipo === "bounced" && leadId) {
    const bt = String((data.bounce && data.bounce.type) || "").toLowerCase();
    const temporario = bt === "transient" || bt === "soft";
    if (!temporario) {
      await sb(env, "PATCH", `/leads?id=eq.${leadId}`, { unsubscribed_email: true, opt_in_email: false });
      await pausarFunis(env, leadId);
    }
  }

  // métricas por post (Gerador de E-mail): entrega/abertura/clique, sem duplicar
  try {
    const eid = data.email_id || data.id;
    const t = mapTipo(tipo);
    if (eid && ["delivered", "opened", "clicked", "bounced"].includes(t)) {
      const rows = await sb(env, "GET", `/email_sends?email_id=eq.${encodeURIComponent(eid)}&select=post_id,entregue,aberto,clicou&limit=1`);
      const s = rows[0];
      if (s && s.post_id) {
        if (t === "delivered" && !s.entregue) { await sb(env, "PATCH", `/email_sends?email_id=eq.${encodeURIComponent(eid)}`, { entregue: true }); await bump(env, s.post_id, "entregues"); }
        else if (t === "opened" && !s.aberto) { await sb(env, "PATCH", `/email_sends?email_id=eq.${encodeURIComponent(eid)}`, { aberto: true }); await bump(env, s.post_id, "abertos"); }
        else if (t === "clicked" && !s.clicou) { await sb(env, "PATCH", `/email_sends?email_id=eq.${encodeURIComponent(eid)}`, { clicou: true }); await bump(env, s.post_id, "cliques"); }
        else if (t === "bounced") { await bump(env, s.post_id, "bounces"); }
      }
    }
  } catch (e) { console.log("stats post erro:", String(e)); }

  // termômetro do lead: abertura/clique esquenta (frio→morno→quente), nunca esfria
  try {
    const t2 = mapTipo(tipo);
    if (leadId && (t2 === "opened" || t2 === "clicked")) {
      await sb(env, "POST", "/rpc/lead_engajou", { p_lead: leadId, p_tipo: t2 });
    }
  } catch (e) { console.log("engajamento lead erro:", String(e)); }
}

async function bump(env, post, campo) {
  await sb(env, "POST", "/rpc/email_campaign_bump", { p_post: post, p_campo: campo, p_delta: 1 });
}

function mapTipo(t) {
  const m = { sent: "sent", delivered: "delivered", opened: "opened", clicked: "clicked",
    bounced: "bounced", complained: "complained", "delivery_delayed": "bounced" };
  return m[t] || t || "evento";
}
async function pausarFunis(env, leadId) {
  await sb(env, "PATCH", `/lead_sequence_state?lead_id=eq.${leadId}&status=eq.ativo`, { status: "pausado" });
}

/* svix signature (HMAC-SHA256) */
async function verifySvix(request, payload, secret) {
  try {
    const id = request.headers.get("svix-id");
    const ts = request.headers.get("svix-timestamp");
    const sigHeader = request.headers.get("svix-signature") || "";
    if (!id || !ts || !sigHeader) return false;
    const keyB64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
    const key = await crypto.subtle.importKey(
      "raw", b64ToBytes(keyB64), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signed = new TextEncoder().encode(`${id}.${ts}.${payload}`);
    const mac = await crypto.subtle.sign("HMAC", key, signed);
    const expected = bytesToB64(new Uint8Array(mac));
    return sigHeader.split(" ").some(p => p.split(",")[1] === expected);
  } catch { return false; }
}
function b64ToBytes(b64) { const s = atob(b64); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
function bytesToB64(bytes) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }

async function sb(env, method, path, payload) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method, headers: {
      "apikey": env.SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    }, body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`supabase ${method} ${path} -> ${res.status} ${t}`);
  return t ? JSON.parse(t) : [];
}
function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } }); }

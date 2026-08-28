/**
 * POST /api/evento-avisar   (protegido — admin logado)
 * Avisa a LISTA DE ESPERA de um evento: abriu vaga / próximo evento.
 * Body: { page_id, mensagem? }  — mensagem é opcional (texto extra do admin).
 * Envia e-mail a cada inscrito em espera (com opt_in_email) e marca avisado_em.
 *
 * Variáveis: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY,
 *            RESEND_API_KEY, RESEND_FROM, PUBLIC_BASE (opcional)
 */
export async function onRequestPost({ request, env }) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "sem_token" }, 401);
  const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token } });
  if (!who.ok) return json({ ok: false, error: "nao_autorizado" }, 401);

  let body = {}; try { body = await request.json(); } catch {}
  const pageId = String(body.page_id || "");
  const extra = (body.mensagem || "").trim();
  if (!pageId) return json({ ok: false, error: "sem_page_id" }, 200);

  const pRows = await sb(env, "GET",
    `/landing_pages?id=eq.${encodeURIComponent(pageId)}&select=id,slug,headline,data_txt,local,cor,grupo_url&limit=1`);
  const p = pRows[0];
  if (!p) return json({ ok: false, error: "pagina_nao_encontrada" }, 200);

  const rows = await sb(env, "GET",
    `/inscricoes?page_id=eq.${p.id}&status=eq.espera&select=id,leads(nome,email,email_normalizado,opt_in_email,unsubscribed_email)&order=created_at.asc&limit=2000`);

  const base = (env.PUBLIC_BASE || new URL(request.url).origin).replace(/\/$/, "");
  const RX = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/;
  let enviados = 0, pulados = 0; const idsOk = [];
  for (const r of rows) {
    const l = r.leads || {};
    const to = (l.email_normalizado || l.email || "").toLowerCase().trim();
    if (!RX.test(to) || l.unsubscribed_email) { pulados++; continue; }
    const ok = await enviar(env, to, l.nome, p, extra, base);
    if (ok) { enviados++; idsOk.push(r.id); } else { pulados++; }
  }
  // marca avisado_em nos que receberam
  if (idsOk.length) {
    try {
      await sb(env, "PATCH",
        `/inscricoes?id=in.(${idsOk.map(x => `"${x}"`).join(",")})`,
        { avisado_em: new Date().toISOString() });
    } catch (e) { console.log("marca avisado_em falhou:", String(e)); }
  }
  return json({ ok: true, total: rows.length, enviados, pulados }, 200);
}

async function enviar(env, to, nome, p, extra, base) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) return false;
  const cor = p.cor || "#128C7E";
  const link = `${base}/p/${encodeURIComponent(p.slug)}`;
  const primeiro = (nome || "").trim().split(/\s+/)[0] || "";
  const quando = [p.data_txt, p.local].filter(Boolean).join(" · ");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#eef2f4;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#14202a">
  <div style="max-width:520px;margin:0 auto;padding:24px 16px 40px">
    <div style="background:#fff;border-radius:16px;padding:26px 24px;box-shadow:0 6px 24px #0000000d">
      <div style="font-size:26px">🎉</div>
      <h1 style="font-size:20px;margin:8px 0 6px;color:${cor}">Abriu vaga pra você!</h1>
      <p style="font-size:15px;color:#41505a;line-height:1.55;margin:0 0 12px">
        Olá${primeiro ? " " + esc(primeiro) : ""}, você estava na <b>lista de espera</b> do evento
        <b>${esc(p.headline || "")}</b>${quando ? ` (${esc(quando)})` : ""} e agora abriu uma oportunidade de participar.</p>
      ${extra ? `<p style="font-size:14.5px;color:#41505a;line-height:1.55;margin:0 0 14px;background:#f7fafb;border-radius:10px;padding:12px 14px">${esc(extra)}</p>` : ""}
      <p style="font-size:15px;color:#41505a;line-height:1.55;margin:0 0 18px">Garanta seu lugar agora — as vagas são limitadas:</p>
      <a href="${esc(link)}" style="display:inline-block;background:${cor};color:#fff;text-decoration:none;font-weight:800;font-size:15px;padding:13px 24px;border-radius:11px">Confirmar minha presença</a>
      ${p.grupo_url ? `<p style="font-size:13px;color:#66757e;margin:16px 0 0">Já está no grupo do WhatsApp? Fique por lá pra receber os avisos.</p>` : ""}
    </div>
    <div style="text-align:center;color:#98a4ab;font-size:11px;margin-top:14px">Ana Carolina Oliveira</div>
  </div></body></html>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.RESEND_FROM, to: [to], subject: `Abriu vaga: ${p.headline || "evento"}`, html }),
    });
    return r.ok;
  } catch (e) { return false; }
}

async function sb(env, method, path, payload) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method, headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY, "Content-Type": "application/json" },
    body: payload !== undefined ? JSON.stringify(payload) : undefined });
  const t = await res.text();
  if (!res.ok) throw new Error(`sb ${res.status} ${t}`);
  return t ? JSON.parse(t) : [];
}
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } }); }

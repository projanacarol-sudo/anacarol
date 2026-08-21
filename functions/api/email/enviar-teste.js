/**
 * POST /api/email/enviar-teste   { assunto, html, para }   (protegido)
 * Envia UM e-mail de teste (para a própria Ana conferir) via Resend.
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!(await requireAuth(request, env))) return json({ erro: "nao_autorizado" }, 401);
  if (!env.RESEND_API_KEY) return json({ erro: "falta RESEND_API_KEY" }, 200);

  let body = {}; try { body = await request.json(); } catch (e) {}
  const { assunto, html } = body;
  const para = String(body.para || "").trim().toLowerCase();
  if (!assunto || !html || !para) return json({ erro: "faltam assunto, html ou para" }, 200);
  const RX = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/;
  if (!RX.test(para)) return json({ erro: "e-mail de teste inválido", para }, 200);

  const htmlFinal = String(html).replace(/%UNSUB%/g, `${env.PUBLIC_BASE || ""}/api/unsub?l=teste`);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.RESEND_FROM, to: [para], subject: "[TESTE] " + assunto, html: htmlFinal }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return json({ erro: "Resend recusou", detalhe: d }, 200);
  return json({ ok: true, id: d.id }, 200);
}

async function requireAuth(request, env) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  try { const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token } }); return r.ok; } catch (e) { return false; }
}
function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } }); }

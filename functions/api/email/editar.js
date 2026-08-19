/**
 * POST /api/email/editar   { id, campo, valor }   (protegido)
 * Salva a edição manual de assunto/preview/texto de um post.
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!(await requireAuth(request, env))) return json({ erro: "nao_autorizado" }, 401);

  let body = {}; try { body = await request.json(); } catch (e) {}
  const id = body.id;
  const permitidos = { assunto: 1, preview: 1, texto: 1 };
  if (!id || !permitidos[body.campo]) return json({ erro: "campo inválido" }, 200);

  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/ig_email_posts?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ [body.campo]: body.valor || "" }),
    });
    if (!r.ok) { const t = await r.text(); return json({ erro: "falha ao salvar", detalhe: t.slice(0, 200) }, 200); }
  } catch (e) { return json({ erro: "falha ao salvar", detalhe: e.message }, 200); }
  return json({ ok: true }, 200);
}

async function requireAuth(request, env) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  try { const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token } }); return r.ok; } catch (e) { return false; }
}
function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } }); }

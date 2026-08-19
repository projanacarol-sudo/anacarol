/**
 * POST /api/email/upload   { id, imagem }  (imagem = data URL base64)  (protegido)
 * Sobe a imagem no Supabase Storage (bucket "email") e devolve a URL pública.
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!(await requireAuth(request, env))) return json({ erro: "nao_autorizado" }, 401);

  let body = {}; try { body = await request.json(); } catch (e) {}
  const postId = body.id;
  const dataUrl = body.imagem || "";
  if (!postId || !dataUrl) return json({ erro: "faltam id ou imagem" }, 200);

  const m = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!m) return json({ erro: "formato inválido" }, 200);
  const mime = m[1];
  const ext = mime.split("/")[1].replace("jpeg", "jpg").replace("+xml", "");
  const bin = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
  const path = `news/${postId}-${Date.now()}.${ext}`;

  // upload no Storage (service key)
  const up = await fetch(`${env.SUPABASE_URL}/storage/v1/object/email/${path}`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY, "Content-Type": mime, "x-upsert": "true" },
    body: bin,
  });
  if (!up.ok) { const t = await up.text(); return json({ erro: "falha no Storage", detalhe: t.slice(0, 200) }, 200); }

  const urlPublica = `${env.SUPABASE_URL}/storage/v1/object/public/email/${path}`;
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/ig_email_posts?id=eq.${encodeURIComponent(postId)}`, {
      method: "PATCH",
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ imagem_upload: urlPublica }),
    });
  } catch (e) {}
  return json({ ok: true, url: urlPublica }, 200);
}

async function requireAuth(request, env) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  try { const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token } }); return r.ok; } catch (e) { return false; }
}
function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } }); }

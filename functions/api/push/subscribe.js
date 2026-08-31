/**
 * POST /api/push/subscribe   (colaborador logado)
 * Salva/atualiza a assinatura de push deste aparelho, vinculada ao colaborador.
 * Body: { endpoint, keys:{p256dh,auth}, user_agent }   -> salva
 *       { unsubscribe:true, endpoint }                  -> remove
 */
export async function onRequestPost({ request, env }) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "sem_token" }, 401);
  const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token } });
  if (!who.ok) return json({ ok: false, error: "nao_autorizado" }, 401);
  const user = await who.json().catch(() => null);
  const uid = user && user.id;

  let b = {}; try { b = await request.json(); } catch {}

  if (b.unsubscribe && b.endpoint) {
    await sb(env, "DELETE", `/push_subscriptions?endpoint=eq.${encodeURIComponent(b.endpoint)}`);
    return json({ ok: true, removed: true }, 200);
  }

  const endpoint = b.endpoint, p256dh = b.keys && b.keys.p256dh, auth = b.keys && b.keys.auth;
  if (!endpoint || !p256dh || !auth) return json({ ok: false, error: "assinatura_incompleta" }, 200);

  // colaborador dono deste login
  let colaboradorId = null;
  if (uid) {
    try {
      const c = await sb(env, "GET", `/colaboradores?auth_user_id=eq.${uid}&select=id&limit=1`);
      colaboradorId = c[0] ? c[0].id : null;
    } catch (e) {}
  }

  const row = {
    colaborador_id: colaboradorId, auth_user_id: uid || null,
    endpoint, p256dh, auth,
    user_agent: (b.user_agent || request.headers.get("user-agent") || "").slice(0, 240),
    visto_em: new Date().toISOString(),
  };
  // upsert por endpoint (único)
  await fetch(`${env.SUPABASE_URL}/rest/v1/push_subscriptions?on_conflict=endpoint`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
      "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(row),
  });
  return json({ ok: true, colaborador_id: colaboradorId }, 200);
}

async function sb(env, method, path, payload) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method, headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY, "Content-Type": "application/json" },
    body: payload !== undefined ? JSON.stringify(payload) : undefined });
  const t = await res.text(); if (!res.ok) throw new Error(`sb ${res.status} ${t}`);
  return t ? JSON.parse(t) : [];
}
function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } }); }

/**
 * /api/higiene   (PROTEGIDO — precisa estar logado no painel)
 *   GET  -> retorna qualidade_base() (números da base)
 *   POST -> roda higienizar_base() (unifica duplicados + normaliza) e devolve o resultado + qualidade
 * Vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY
 */
export async function onRequestOptions() { return new Response(null, { status: 204, headers: cors() }); }

export async function onRequestGet({ request, env }) {
  const h = cors();
  if (!(await auth(request, env))) return json({ ok: false, erro: "nao_autorizado" }, 401, h);
  const q = await rpc(env, "qualidade_base", {});
  return json({ ok: true, qualidade: q }, 200, h);
}

export async function onRequestPost({ request, env }) {
  const h = cors();
  if (!(await auth(request, env))) return json({ ok: false, erro: "nao_autorizado" }, 401, h);
  try {
    const r = await rpc(env, "higienizar_base", {});
    const q = await rpc(env, "qualidade_base", {});
    return json({ ok: true, resultado: r, qualidade: q }, 200, h);
  } catch (e) {
    return json({ ok: false, erro: "internal", detalhe: String(e).slice(0, 160) }, 500, h);
  }
}

async function rpc(env, fn, body) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) throw new Error(`${fn} -> ${r.status} ${(await r.text()).slice(0, 160)}`);
  return r.json().catch(() => null);
}
async function auth(request, env) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  try {
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token } });
    return r.ok;
  } catch (e) { return false; }
}
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}
function json(o, s, extra) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json", ...(extra || {}) } }); }

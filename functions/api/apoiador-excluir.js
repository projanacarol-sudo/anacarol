/**
 * POST /api/apoiador-excluir   { id }   (PROTEGIDO — precisa estar logado)
 * Remove um registro do Romaneio (tabela apoiadores). Não mexe no lead do CRM.
 */
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors() });
}

export async function onRequestPost({ request, env }) {
  const h = cors();
  if (!(await requireAuth(request, env))) return json({ ok: false, erro: "nao_autorizado" }, 401, h);

  let b = {}; try { b = await request.json(); } catch (e) {}
  const id = String(b.id || "").trim();
  if (!id) return json({ ok: false, erro: "id_obrigatorio" }, 400, h);

  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/apoiadores?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
        Prefer: "return=minimal",
      },
    });
    if (!r.ok) {
      const t = await r.text();
      return json({ ok: false, erro: "banco", detalhe: t.slice(0, 200) }, 500, h);
    }
    return json({ ok: true }, 200, h);
  } catch (e) {
    return json({ ok: false, erro: "internal", detalhe: String(e).slice(0, 120) }, 500, h);
  }
}

async function requireAuth(request, env) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  try {
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token },
    });
    return r.ok;
  } catch (e) { return false; }
}
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}
function json(o, s, extra) {
  return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json", ...(extra || {}) } });
}

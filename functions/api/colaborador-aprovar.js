/**
 * POST /api/colaborador-aprovar   (protegido — precisa estar logado no painel)
 * Body: { id, nivel }  nivel = "admin" | "colaborador"
 *
 * Fluxo: valida o token do admin -> gera senha temporária -> cria o login
 * no Supabase Auth -> ativa o colaborador com o nível escolhido.
 * Retorna a senha temporária UMA vez para o admin repassar.
 *
 * Usa: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY (já existentes).
 */
export async function onRequestPost({ request, env }) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "sem_token" }, 401);

  // 1) confirma que quem chamou está logado
  const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token },
  });
  if (!who.ok) return json({ ok: false, error: "nao_autorizado" }, 401);

  let body; try { body = await request.json(); } catch { body = {}; }
  const id = String(body.id || "");
  const nivel = body.nivel === "admin" ? "admin" : "colaborador";
  if (!id) return json({ ok: false, error: "sem_id" }, 200);

  // 2) busca o colaborador pendente
  const rows = await sb(env, "GET",
    `/colaboradores?id=eq.${encodeURIComponent(id)}&select=id,nome,email&limit=1`);
  const col = rows[0];
  if (!col) return json({ ok: false, error: "nao_encontrado" }, 200);
  const email = (col.email || "").trim().toLowerCase();
  if (!email) return json({ ok: false, error: "sem_email" }, 200);

  // 3) cria o login com senha temporária
  const password = genPass(12);
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const t = await res.text();

  if (res.ok) {
    let uid = null; try { uid = JSON.parse(t).id || null; } catch {}
    await ativar(env, id, nivel, uid);
    return json({ ok: true, email, nivel, password }, 200);
  }

  // Já existia login para esse e-mail: só ativa (sem senha nova)
  if (/already been registered|already exists|email_exists/i.test(t)) {
    await ativar(env, id, nivel, null);
    return json({ ok: true, already: true, email, nivel }, 200);
  }

  return json({ ok: false, error: "falhou", detalhe: t.slice(0, 200) }, 200);
}

async function ativar(env, id, nivel, uid) {
  const patch = { status: "ativo", ativo: true, nivel };
  if (uid) patch.auth_user_id = uid;
  await sb(env, "PATCH", `/colaboradores?id=eq.${encodeURIComponent(id)}`, patch);
}

async function sb(env, method, path, payload) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
      "Content-Type": "application/json",
    },
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`sb ${res.status} ${t}`);
  return t ? JSON.parse(t) : [];
}

function genPass(n) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  const a = new Uint32Array(n);
  crypto.getRandomValues(a);
  for (let i = 0; i < n; i++) s += chars[a[i] % chars.length];
  return s;
}

function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } }); }

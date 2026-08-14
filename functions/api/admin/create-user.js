/**
 * CRM Ana — Criar login de colaborador: POST /api/admin/create-user
 * Cria um usuário no Supabase Auth (e-mail + senha, já confirmado).
 *
 * Segurança: só funciona se o CHAMADOR já estiver logado no painel.
 *   O painel envia o token da sessão em Authorization: Bearer <access_token>.
 *   A Function valida esse token antes de criar o novo usuário.
 *
 * Variáveis: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY (já existem)
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "sem_token" }, 401);

  // 1) confirma que quem chamou está logado
  const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token } });
  if (!who.ok) return json({ ok: false, error: "nao_autorizado" }, 401);

  let body; try { body = await request.json(); } catch { body = {}; }
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!email || !email.includes("@")) return json({ ok: false, error: "email_invalido" }, 200);
  if (password.length < 6) return json({ ok: false, error: "senha_curta" }, 200);

  // 2) cria o usuário (confirmado) com a service key
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const t = await res.text();
  if (!res.ok) {
    const jaExiste = /already been registered|already exists/i.test(t);
    return json({ ok: false, error: jaExiste ? "ja_existe" : "falhou", detalhe: t.slice(0, 200) }, 200);
  }
  return json({ ok: true, email }, 200);
}

function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } }); }

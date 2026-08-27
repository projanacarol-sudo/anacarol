/**
 * POST /api/colaborador-senha   (protegido — admin logado)
 * Body: { id, enviar_email }   -> gera NOVA senha temporária, atualiza no
 * Supabase Auth e (se enviar_email) reenvia o acesso por e-mail.
 * Retorna a nova senha UMA vez, pro admin repassar.
 *
 * Usa: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, RESEND_API_KEY, RESEND_FROM
 */
export async function onRequestPost({ request, env }) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "sem_token" }, 401);
  const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token },
  });
  if (!who.ok) return json({ ok: false, error: "nao_autorizado" }, 401);

  let body; try { body = await request.json(); } catch { body = {}; }
  const id = String(body.id || "");
  const enviarEmail = !!body.enviar_email;
  if (!id) return json({ ok: false, error: "sem_id" }, 200);

  const rows = await sb(env, "GET",
    `/colaboradores?id=eq.${encodeURIComponent(id)}&select=id,nome,email,auth_user_id&limit=1`);
  const col = rows[0];
  if (!col) return json({ ok: false, error: "nao_encontrado" }, 200);
  const email = (col.email || "").trim().toLowerCase();
  if (!email) return json({ ok: false, error: "sem_email" }, 200);

  const password = genPass(12);
  let uid = col.auth_user_id || null;
  if (!uid) uid = await findUserByEmail(env, email);

  if (uid) {
    // atualiza a senha do usuário existente
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
      method: "PUT",
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!r.ok) return json({ ok: false, error: "falha_ao_atualizar", detalhe: (await r.text()).slice(0, 200) }, 200);
  } else {
    // não tinha login ainda -> cria com a nova senha
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    const t = await r.text();
    if (!r.ok) return json({ ok: false, error: "falha_ao_criar", detalhe: t.slice(0, 200) }, 200);
    try { uid = JSON.parse(t).id || null; } catch {}
  }

  // garante o vínculo do auth_user_id no colaborador
  if (uid && uid !== col.auth_user_id) {
    try { await sb(env, "PATCH", `/colaboradores?id=eq.${encodeURIComponent(id)}`, { auth_user_id: uid }); } catch (e) {}
  }

  let emailed = false;
  if (enviarEmail) { try { emailed = await enviarAcesso(env, email, col.nome, password, request); } catch (e) {} }

  return json({ ok: true, email, password, emailed }, 200);
}

async function findUserByEmail(env, email) {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users?per_page=200`, {
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY },
    });
    if (!r.ok) return null;
    const d = await r.json();
    const list = (d && (d.users || d)) || [];
    const u = list.find(x => (x.email || "").toLowerCase() === email);
    return u ? u.id : null;
  } catch (e) { return null; }
}

async function enviarAcesso(env, email, nome, senha, request) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) return false;
  const origin = new URL(request.url).origin;
  const link = `${origin}/painel.html`;
  const primeiro = (nome || "").trim().split(/\s+/)[0] || "";
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#14202a">
      <h2 style="color:#128C7E">Seu acesso ao CRM</h2>
      <p>Olá${primeiro ? " " + escHtml(primeiro) : ""}, aqui estão os seus dados de acesso atualizados:</p>
      <div style="background:#f4f7f8;border:1px solid #e5e9ec;border-radius:10px;padding:14px 16px;margin:14px 0">
        <p style="margin:0 0 6px"><b>Link:</b> <a href="${link}">${link}</a></p>
        <p style="margin:0 0 6px"><b>E-mail:</b> ${escHtml(email)}</p>
        <p style="margin:0"><b>Senha temporária:</b> <span style="font-family:monospace;font-size:16px">${escHtml(senha)}</span></p>
      </div>
      <p style="font-size:13px;color:#66757e">Recomendamos trocar a senha após o acesso, no botão <b>Trocar senha</b> dentro do painel.</p>
    </div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.RESEND_FROM, to: [email], subject: "Seu acesso ao CRM — Ana Carolina Oliveira", html }),
  });
  return r.ok;
}
function escHtml(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
async function sb(env, method, path, payload) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method, headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY, "Content-Type": "application/json" },
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`sb ${res.status} ${t}`);
  return t ? JSON.parse(t) : [];
}
function genPass(n) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let s = ""; const a = new Uint32Array(n); crypto.getRandomValues(a);
  for (let i = 0; i < n; i++) s += chars[a[i] % chars.length];
  return s;
}
function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } }); }

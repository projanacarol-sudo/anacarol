/**
 * POST /api/colaborador-cadastro   (PÚBLICO — auto-cadastro de colaborador)
 * Recebe { nome, email, whatsapp, atividade } e cria um registro PENDENTE.
 * O admin aprova depois no painel (define o nível e gera o login).
 *
 * Usa SUPABASE_URL + SUPABASE_SERVICE_KEY (já existentes no Pages).
 */
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors() });
}

export async function onRequestPost({ request, env }) {
  const h = cors();
  try {
    const body = await readBody(request);
    if (body._gotcha) return json({ ok: true, skipped: true }, 200, h);

    const nome = clean(body.nome);
    const email = clean(body.email).toLowerCase();
    const whatsapp = clean(body.whatsapp || body.telefone);
    const atividade = clean(body.atividade);

    if (!nome || !email.includes("@")) return json({ ok: false, error: "dados_invalidos" }, 200, h);

    // Evita duplicar: já existe alguém com esse e-mail?
    const ex = await sb(env, "GET",
      `/colaboradores?email=eq.${encodeURIComponent(email)}&select=id,status&limit=1`);
    if (ex[0]) return json({ ok: true, dup: true, status: ex[0].status }, 200, h);

    await sb(env, "POST", "/colaboradores", {
      nome, email, whatsapp, atividade,
      status: "pendente", ativo: false, nivel: "colaborador",
      cor: randColor(),
    });
    return json({ ok: true }, 200, h);
  } catch (e) {
    return json({ ok: false, error: "internal" }, 200, h);
  }
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

async function readBody(request) {
  const ct = (request.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) return await request.json();
  const form = await request.formData();
  const o = {}; for (const [k, v] of form.entries()) o[k] = v; return o;
}
function clean(v) { return v == null ? "" : String(v).trim(); }
function randColor() {
  const cores = ["#128C7E", "#7a2418", "#9a3524", "#2b6cb0", "#6b46c1", "#c05621", "#2f855a", "#b7791f"];
  return cores[Math.floor(Math.random() * cores.length)];
}
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}
function json(o, s, extra) {
  return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json", ...(extra || {}) } });
}

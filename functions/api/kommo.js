/**
 * POST /api/kommo?key=SEGREDO   (receptor de webhook do Kommo → CRM)
 * O Kommo dispara "Lead adicionado" (x-www-form-urlencoded, só IDs + nome).
 * Telefone/e-mail ficam no CONTATO — então enriquecemos pela API do Kommo
 * (se KOMMO_TOKEN + KOMMO_SUBDOMAIN estiverem configurados). Também aceita
 * os campos já mapeados (nome/telefone/email), caso venham por Salesbot.
 *
 * Vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, KOMMO_KEY,
 *       KOMMO_SUBDOMAIN (ex.: "anacarol"), KOMMO_TOKEN (long-lived access token)
 */
export async function onRequestGet({ request, env }) {
  // o Kommo às vezes valida a URL com GET — respondemos ok
  const key = new URL(request.url).searchParams.get("key") || "";
  if (env.KOMMO_KEY && key !== env.KOMMO_KEY) return j({ ok: false, erro: "nao_autorizado" }, 401);
  return j({ ok: true, pronto: true }, 200);
}
export function onRequestOptions() { return new Response(null, { status: 204, headers: cors() }); }

export async function onRequestPost({ request, env }) {
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!env.KOMMO_KEY || key !== env.KOMMO_KEY) return j({ ok: false, erro: "nao_autorizado" }, 401);

  const dados = await lerCorpo(request);

  // ids / nome vindos do webhook (leads[add][0][...]) ou de um payload mapeado
  const kommoId = pick(dados, ["leads[add][0][id]", "leads[status][0][id]", "lead_id", "id"]);
  let nome  = pick(dados, ["leads[add][0][name]", "nome", "name"]);
  let email = pick(dados, ["email", "leads[add][0][email]"]);
  let telefone = pick(dados, ["telefone", "phone", "whatsapp", "leads[add][0][phone]"]);

  // enriquece pela API do Kommo se faltou contato e há token
  if ((!telefone || !email || !nome) && kommoId && env.KOMMO_TOKEN && env.KOMMO_SUBDOMAIN) {
    try {
      const c = await buscarContato(env, kommoId);
      nome = nome || c.nome; email = email || c.email; telefone = telefone || c.telefone;
    } catch (e) { /* segue com o que tiver */ }
  }

  if (!telefone && !email) return j({ ok: true, ignorado: "sem_contato", kommoId }, 200);

  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/kommo_lead`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_nome: nome || "", p_email: email || "", p_telefone: telefone || "", p_kommo_id: kommoId || null }),
    });
    if (!r.ok) return j({ ok: false, erro: "banco", detalhe: (await r.text()).slice(0, 200) }, 500);
    const lead_id = await r.json().catch(() => null);
    return j({ ok: true, lead_id, kommoId }, 200);
  } catch (e) { return j({ ok: false, erro: "internal", detalhe: String(e).slice(0, 120) }, 500); }
}

/* ---- Kommo API: pega o contato principal do lead ---- */
async function buscarContato(env, leadId) {
  const base = `https://${env.KOMMO_SUBDOMAIN}.kommo.com/api/v4`;
  const H = { Authorization: "Bearer " + env.KOMMO_TOKEN };
  const rl = await fetch(`${base}/leads/${encodeURIComponent(leadId)}?with=contacts`, { headers: H });
  const lead = await rl.json();
  const cts = (lead && lead._embedded && lead._embedded.contacts) || [];
  const main = cts.find(c => c.is_main) || cts[0];
  if (!main) return {};
  const rc = await fetch(`${base}/contacts/${main.id}`, { headers: H });
  const ct = await rc.json();
  const out = { nome: ct.name || "", email: "", telefone: "" };
  for (const f of (ct.custom_fields_values || [])) {
    const cod = (f.field_code || "").toUpperCase();
    const val = f.values && f.values[0] && f.values[0].value;
    if (!val) continue;
    if (cod === "PHONE" && !out.telefone) out.telefone = String(val);
    if (cod === "EMAIL" && !out.email) out.email = String(val);
  }
  return out;
}

/* ---- utils ---- */
async function lerCorpo(request) {
  const ct = (request.headers.get("content-type") || "").toLowerCase();
  try {
    if (ct.includes("application/json")) {
      const o = await request.json(); return flat(o);
    }
    const txt = await request.text();
    const p = new URLSearchParams(txt); const o = {};
    for (const [k, v] of p.entries()) o[k] = v;
    return o;
  } catch (e) { return {}; }
}
function flat(o, pre, acc) {
  acc = acc || {}; pre = pre || "";
  if (o && typeof o === "object") {
    for (const k of Object.keys(o)) flat(o[k], pre ? `${pre}[${k}]` : k, acc);
  } else { acc[pre] = o; }
  return acc;
}
function pick(o, keys) { for (const k of keys) { if (o[k] != null && String(o[k]).trim() !== "") return String(o[k]).trim(); } return ""; }
function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }; }
function j(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json", ...cors() } }); }

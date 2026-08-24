/**
 * GET/POST /api/kommo-backfill?key=SEGREDO&page=1&limit=250   (protegido)
 * Puxa UMA página de contatos do Kommo e grava tudo no CRM (kommo_backfill).
 * Chame em loop, avançando `page`, até acabou=true.
 *
 * Vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, KOMMO_KEY, KOMMO_SUBDOMAIN, KOMMO_TOKEN
 */
export function onRequestOptions() { return new Response(null, { status: 204, headers: cors() }); }
export async function onRequestGet(ctx) { return handler(ctx); }
export async function onRequestPost(ctx) { return handler(ctx); }

async function handler({ request, env }) {
  const url = new URL(request.url);
  if (!env.KOMMO_KEY || url.searchParams.get("key") !== env.KOMMO_KEY) return j({ ok: false, erro: "nao_autorizado" }, 401);
  if (!env.KOMMO_TOKEN || !env.KOMMO_SUBDOMAIN) return j({ ok: false, erro: "faltam KOMMO_TOKEN/KOMMO_SUBDOMAIN" }, 200);

  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(250, Math.max(10, parseInt(url.searchParams.get("limit") || "250", 10)));

  // 1) pega a página de contatos do Kommo
  let data;
  try {
    const r = await fetch(`https://${env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/contacts?page=${page}&limit=${limit}`,
      { headers: { Authorization: "Bearer " + env.KOMMO_TOKEN } });
    if (r.status === 204) return j({ ok: true, pagina: page, recebidos: 0, gravados: 0, acabou: true }, 200);
    if (!r.ok) return j({ ok: false, erro: "kommo", status: r.status, detalhe: (await r.text()).slice(0, 200) }, 200);
    data = await r.json();
  } catch (e) { return j({ ok: false, erro: "falha_kommo", detalhe: String(e).slice(0, 120) }, 200); }

  const contatos = (data && data._embedded && data._embedded.contacts) || [];
  const rows = contatos.map(mapear).filter(x => x.telefone || x.email);

  // 2) grava em lote (uma chamada só ao banco)
  let gravados = 0;
  if (rows.length) {
    try {
      const rr = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/kommo_backfill`, {
        method: "POST",
        headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ p_rows: rows }),
      });
      const d = await rr.json().catch(() => ({}));
      gravados = (d && d.gravados) || 0;
    } catch (e) { /* segue */ }
  }

  const temProxima = !!(data && data._links && data._links.next) || contatos.length === limit;
  return j({ ok: true, pagina: page, recebidos: contatos.length, comContato: rows.length, gravados, proxima: temProxima ? page + 1 : null, acabou: !temProxima }, 200);
}

function mapear(ct) {
  const out = { nome: ct.name || "", telefone: "", email: "", kommo_id: "" };
  for (const f of (ct.custom_fields_values || [])) {
    const cod = (f.field_code || "").toUpperCase();
    const val = f.values && f.values[0] && f.values[0].value;
    if (!val) continue;
    if (cod === "PHONE" && !out.telefone) out.telefone = String(val);
    if (cod === "EMAIL" && !out.email) out.email = String(val);
  }
  return out;
}
function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }; }
function j(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json", ...cors() } }); }

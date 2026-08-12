/**
 * CRM Ana — Coletor SendFlow por API: POST /api/sendflow/sync
 * Puxa as campanhas e os analytics de cada uma (agregados + séries diárias)
 * e grava em sendflow_campanhas. É o "cron seu" (você controla a frequência).
 *
 * Protegido por: header x-engine-key == env.ENGINE_KEY
 * Variáveis (Pages → Environment variables):
 *   ENGINE_KEY (já existe)
 *   SENDFLOW_API_KEY (Secret) — API token do SendFlow
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY (já existem)
 *
 * Rate limits do SendFlow: /releases a cada 5 min; analytics 1x/min por campanha.
 * Rode o cron no máximo a cada 30 min.
 */
const BASE = "https://sendapi.sendflow.pro";

export async function onRequestPost(context) {
  const { request, env } = context;
  if ((request.headers.get("x-engine-key") || "") !== (env.ENGINE_KEY || "\0")) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  if (!env.SENDFLOW_API_KEY) return json({ ok: false, error: "defina SENDFLOW_API_KEY" }, 200);

  try {
    const campanhas = await sf(env, "/releases");
    if (!Array.isArray(campanhas)) return json({ ok: false, error: "resposta_inesperada", amostra: campanhas }, 200);

    let ok = 0, erros = 0;
    for (const c of campanhas) {
      try {
        await sleep(1300); // respeita o 1s entre GETs
        const a = await sf(env, `/releases/${c.id}/analytics`);
        await sb(env, "POST", "/sendflow_campanhas", {
          campaign_id: c.id, nome: c.name || null,
          participantes: numOr(a.participants),
          grupos_total: numOr(a.groups),
          entradas: numOr(a.add && a.add.total),
          saidas: numOr(a.remove && a.remove.total),
          cliques: numOr(a.clicks && a.clicks.total),
          input_dates: normDatas(a.add && a.add.dates),
          output_dates: normDatas(a.remove && a.remove.dates),
          atualizado_em: new Date().toISOString(),
        }, "resolution=merge-duplicates");
        ok++;
      } catch (e) { console.log("campanha", c.id, "falhou:", String(e)); erros++; }
    }
    return json({ ok: true, campanhas: campanhas.length, atualizadas: ok, erros }, 200);
  } catch (e) {
    console.log("sendflow sync erro:", String(e));
    return json({ ok: false, error: "internal", detalhe: String(e).slice(0, 200) }, 200);
  }
}

/* ddmmyyyy -> yyyy-mm-dd (formato que o painel usa) */
function normDatas(obj) {
  const out = {};
  if (obj && typeof obj === "object") {
    for (const k of Object.keys(obj)) {
      const iso = /^\d{8}$/.test(k) ? (k.slice(4) + "-" + k.slice(2, 4) + "-" + k.slice(0, 2)) : k;
      out[iso] = Number(obj[k]) || 0;
    }
  }
  return out;
}
function numOr(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function sf(env, path) {
  const res = await fetch(BASE + path, { headers: { "Authorization": `Bearer ${env.SENDFLOW_API_KEY}` } });
  const t = await res.text();
  if (!res.ok) throw new Error(`sendflow ${res.status} ${t.slice(0, 160)}`);
  try { return JSON.parse(t); } catch { return t; }
}
async function sb(env, method, path, payload, prefer) {
  const headers = {
    "apikey": env.SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers["Prefer"] = prefer;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method, headers, body: payload !== undefined ? JSON.stringify(payload) : undefined });
  const t = await res.text();
  if (!res.ok) throw new Error(`supabase ${method} ${path} -> ${res.status} ${t}`);
  return t ? JSON.parse(t) : [];
}
function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } }); }

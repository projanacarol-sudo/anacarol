/**
 * CRM Ana — Coletor SendFlow por API: POST /api/sendflow/sync
 * Puxa os grupos de cada campanha (participantsAmount, full) e grava os
 * totais em sendflow_campanhas. É o "cron seu" (você controla a frequência).
 *
 * Protegido por: header x-engine-key == env.ENGINE_KEY
 * Variáveis (Pages → Environment variables):
 *   ENGINE_KEY (já existe)
 *   SENDFLOW_API_KEY  (Secret) — API token do SendFlow
 *   SENDFLOW_CAMPAIGNS (opcional) — IDs das campanhas a sincronizar,
 *       separados por vírgula. Vazio = todas. Use para EXCLUIR campanhas
 *       (ex.: deixe só o id da campanha da Ana).
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY (já existem)
 *
 * Rate limits: /releases a cada 5 min; /groups no máx 1x/10 min por campanha.
 * Rode o cron a cada 30 min.
 */
const BASE = "https://sendapi.sendflow.pro";

export async function onRequestPost(context) {
  const { request, env } = context;
  if ((request.headers.get("x-engine-key") || "") !== (env.ENGINE_KEY || "\0")) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  if (!env.SENDFLOW_API_KEY) return json({ ok: false, error: "defina SENDFLOW_API_KEY" }, 200);

  const permitidas = (env.SENDFLOW_CAMPAIGNS || "").split(",").map(s => s.trim()).filter(Boolean);

  try {
    let campanhas = await sf(env, "/releases");
    if (!Array.isArray(campanhas)) return json({ ok: false, error: "resposta_inesperada", amostra: campanhas }, 200);
    if (permitidas.length) campanhas = campanhas.filter(c => permitidas.includes(c.id));

    let ok = 0, erros = 0;
    for (let i = 0; i < campanhas.length; i++) {
      const c = campanhas[i];
      try {
        if (i > 0) await sleep(1500);
        let g = await sf(env, `/releases/${c.id}/groups`);
        const grupos = Array.isArray(g) && Array.isArray(g[0]) ? g.flat() : (Array.isArray(g) ? g : []);
        const participantes = grupos.reduce((a, x) => a + (Number(x.participantsAmount) || 0), 0);
        const cheios = grupos.filter(x => x.full).length;
        await sb(env, "POST", "/sendflow_campanhas", {
          campaign_id: c.id, nome: c.name || null,
          participantes, grupos_total: grupos.length, grupos_cheios: cheios,
          grupos_abertos: grupos.length - cheios,
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

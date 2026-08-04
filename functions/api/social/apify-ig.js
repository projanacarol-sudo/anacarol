/**
 * CRM Ana — Coletor Instagram via Apify: POST /api/social/apify-ig
 * Chamado 1x por dia pelo pg_cron. Roda o ator "Instagram Profile Scraper",
 * pega seguidores/seguindo/posts e calcula engajamento pelos últimos posts,
 * e grava em social_metrics.
 *
 * Protegido por: header x-engine-key == env.ENGINE_KEY
 * Variáveis (Pages → Environment variables):
 *   ENGINE_KEY  (já existe)
 *   APIFY_TOKEN  (Secret) — Personal API token do Apify
 *   IG_HANDLE    — @ da Ana, sem o @ (ex: anacarolinaoliveira)
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY (já existem)
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  if ((request.headers.get("x-engine-key") || "") !== (env.ENGINE_KEY || "\0")) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  try {
    const handle = (env.IG_HANDLE || "").replace(/^@/, "").trim();
    if (!handle) return json({ ok: false, error: "defina IG_HANDLE" }, 200);
    if (!env.APIFY_TOKEN) return json({ ok: false, error: "defina APIFY_TOKEN" }, 200);

    // roda o ator e já pega os itens do dataset (sincrono)
    const res = await fetch(
      `https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items?token=${env.APIFY_TOKEN}`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usernames: [handle] }) });
    const items = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(items) || !items.length) {
      return json({ ok: false, error: "apify_sem_dados", status: res.status, amostra: items }, 200);
    }
    const p = items[0];
    const seguidores = num(p.followersCount);
    const seguindo   = num(p.followsCount);
    const publicacoes = num(p.postsCount);

    // engajamento médio (curtidas+comentários dos últimos posts) / seguidores
    let engajamento = null;
    const posts = p.latestPosts || [];
    if (posts.length && seguidores) {
      const soma = posts.reduce((a, x) => a + num(x.likesCount) + num(x.commentsCount), 0);
      engajamento = Math.round((soma / posts.length) / seguidores * 10000) / 100; // % 2 casas
    }

    // acha ou cria a conta
    let acc = (await sb(env, "GET",
      `/social_accounts?plataforma=eq.instagram&handle=eq.${encodeURIComponent(handle)}&select=id&limit=1`))[0];
    if (!acc) {
      acc = (await sb(env, "POST", "/social_accounts",
        { plataforma: "instagram", handle, account_ref: p.id || p.username || null, ativo: true },
        "return=representation"))[0];
    }

    await sb(env, "POST", "/social_metrics", {
      account_id: acc.id,
      seguidores,
      publicacoes,
      engajamento: engajamento != null ? Math.round(engajamento) : null,
      coletado_em: new Date().toISOString(),
    });

    return json({ ok: true, handle, seguidores, seguindo, publicacoes, engajamento }, 200);
  } catch (e) {
    console.log("apify-ig erro:", String(e));
    return json({ ok: false, error: "internal" }, 200);
  }
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
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

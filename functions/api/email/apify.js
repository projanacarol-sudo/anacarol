/**
 * GET /api/email/apify?limit=12   (protegido — precisa estar logado no painel)
 * Puxa os últimos posts do Instagram da Ana (Apify) e faz UPSERT sem
 * sobrescrever o que a IA já gerou (ignore-duplicates por id).
 *
 * Vars: APIFY_TOKEN, IG_HANDLE, SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY
 */
export async function onRequestPost(context) { return onRequestGet(context); }

export async function onRequestGet(context) {
  const { request, env } = context;
  // aceita a chave do cron (x-engine-key) OU o login do painel (Bearer)
  const okCron = (request.headers.get("x-engine-key") || "") === (env.ENGINE_KEY || "\0");
  if (!okCron && !(await requireAuth(request, env))) return json({ erro: "nao_autorizado" }, 401);

  const url = new URL(request.url);
  const handle = (url.searchParams.get("user") || env.IG_HANDLE || "").replace(/^@/, "").trim();
  const limite = Math.min(30, Number(url.searchParams.get("limit") || 12));
  if (!handle) return json({ erro: "defina IG_HANDLE" }, 200);
  if (!env.APIFY_TOKEN) return json({ erro: "defina APIFY_TOKEN" }, 200);

  const runUrl = `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${env.APIFY_TOKEN}`;
  const input = {
    directUrls: [`https://www.instagram.com/${handle}/`],
    resultsType: "posts", resultsLimit: limite, addParentData: false,
  };

  let res, data;
  try {
    res = await fetch(runUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  } catch (e) { return json({ erro: "falha ao chamar o Apify", detalhe: e.message }, 200); }
  if (!res.ok) { const t = await res.text(); return json({ erro: "Apify retornou erro", status: res.status, corpo: t.slice(0, 400) }, 200); }
  try { data = await res.json(); } catch (e) { return json({ erro: "resposta do Apify não é JSON" }, 200); }

  const arr = Array.isArray(data) ? data : [];
  const posts = arr.map(p => ({
    id: p.id || p.shortCode || null,
    legenda: p.caption || "",
    tipo: p.type || p.productType || null,
    imagem: p.displayUrl || (p.images && p.images[0]) || null,
    link: p.url || (p.shortCode ? `https://www.instagram.com/p/${p.shortCode}/` : null),
    data: p.timestamp || null,
    curtidas: p.likesCount ?? null,
    comentarios: p.commentsCount ?? null,
  })).filter(p => p.id && (p.link || p.imagem));

  // upsert que NÃO sobrescreve os campos da IA (ignore-duplicates por id)
  if (posts.length) {
    const rows = posts.map(p => ({
      id: p.id, legenda: p.legenda || "", imagem: p.imagem || "", link: p.link || "",
      tipo: p.tipo || "", data: p.data || "", curtidas: p.curtidas, comentarios: p.comentarios,
    }));
    try {
      await fetch(`${env.SUPABASE_URL}/rest/v1/ig_email_posts?on_conflict=id`, {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
          "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal",
        },
        body: JSON.stringify(rows),
      });
    } catch (e) { /* segue mesmo se o upsert falhar */ }
  }

  return json({ total: posts.length, user: handle, posts }, 200);
}

async function requireAuth(request, env) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  try {
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token } });
    return r.ok;
  } catch (e) { return false; }
}
function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } }); }

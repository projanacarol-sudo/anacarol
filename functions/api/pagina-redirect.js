/**
 * GET /api/pagina-redirect?slug=apoiar   (público)
 * Diz à página se ela deve redirecionar e para onde.
 * Lido do topo de cada página pública (guard de redirect).
 * Variáveis: SUPABASE_URL, SUPABASE_SERVICE_KEY (ou SUPABASE_ANON_KEY).
 */
export async function onRequestGet({ request, env }) {
  const slug = new URL(request.url).searchParams.get("slug") || "";
  let ativo = false, destino = "";
  try {
    const url = env.SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY;
    if (url && key && slug) {
      const r = await fetch(
        `${url}/rest/v1/pagina_redirects?slug=eq.${encodeURIComponent(slug)}&select=ativo,destino`,
        { headers: { apikey: key, Authorization: "Bearer " + key } }
      );
      if (r.ok) {
        const rows = await r.json();
        if (rows && rows[0]) {
          ativo = rows[0].ativo === true;
          destino = rows[0].destino || "";
        }
      }
    }
  } catch (e) {}
  return new Response(JSON.stringify({ ok: true, ativo: ativo && !!destino, destino }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store",
               "Access-Control-Allow-Origin": "*" },
  });
}

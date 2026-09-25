/**
 * GET /api/materiais-digitais   (público)
 * Devolve o catálogo ATIVO do Kit Mídia Digital para a página kit-digital.html,
 * já agrupado por tipo e ordenado. Se falhar, o front usa os padrões embutidos.
 *
 * Variáveis: SUPABASE_URL, SUPABASE_SERVICE_KEY (ou SUPABASE_ANON_KEY).
 */
export async function onRequestGet({ env }) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY;
  const grupos = { moldura_perfil: [], moldura_story: [], arte: [], jingle: [] };
  try {
    if (url && key) {
      const r = await fetch(
        `${url}/rest/v1/materiais_digitais?ativo=eq.true&select=tipo,nome,url,ordem&order=ordem.asc,criado_em.asc`,
        { headers: { apikey: key, Authorization: "Bearer " + key } }
      );
      if (r.ok) {
        const rows = await r.json();
        for (const m of rows) {
          if (grupos[m.tipo]) grupos[m.tipo].push({ n: m.nome, u: m.url });
        }
      }
    }
  } catch (e) {}
  return new Response(JSON.stringify({ ok: true, grupos }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store",
               "Access-Control-Allow-Origin": "*" },
  });
}

/**
 * GET /api/img?u=<url do R2>   — repassa a imagem do R2 COM cabeçalho CORS,
 * pra a moldura poder ser desenhada no canvas e baixada sem "sujar" a imagem.
 * Por segurança, só repassa do bucket R2 da campanha.
 */
export async function onRequestGet({ request }) {
  const u = new URL(request.url).searchParams.get("u") || "";
  if (!/^https:\/\/pub-[a-z0-9]+\.r2\.dev\//i.test(u)) {
    return new Response("url nao permitida", { status: 400, headers: cors() });
  }
  let r;
  try {
    r = await fetch(u, { cf: { cacheEverything: true, cacheTtl: 86400 } });
  } catch (e) {
    return new Response("falha ao buscar", { status: 502, headers: cors() });
  }
  if (!r.ok) return new Response("erro " + r.status, { status: r.status, headers: cors() });
  const h = cors();
  h.set("Content-Type", r.headers.get("Content-Type") || "image/png");
  h.set("Cache-Control", "public, max-age=86400");
  return new Response(r.body, { status: 200, headers: h });
}
export function onRequestOptions() { return new Response(null, { status: 204, headers: cors() }); }
function cors() {
  const h = new Headers();
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  return h;
}

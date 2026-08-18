/**
 * GET /api/podcast?show=SHOW_ID
 * Lê a página de EMBED do Spotify do podcast e devolve os episódios recentes
 * em JSON (com CORS liberado), para a página de BIO montar a lista sozinha.
 *
 * Sem credenciais: usa os dados públicos embutidos na página de embed.
 * Se algo falhar, retorna ok:false e a bio usa o fallback local.
 */
export async function onRequestGet(context) {
  const { request } = context;
  const cors = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=1800", // 30 min
  };
  try {
    const url = new URL(request.url);
    const show = (url.searchParams.get("show") || "").replace(/[^A-Za-z0-9]/g, "");
    if (!show) return json({ ok: false, error: "sem_show" }, cors);

    const res = await fetch(`https://open.spotify.com/embed/show/${show}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BioBot/1.0)", "Accept-Language": "pt-BR,pt" },
    });
    if (!res.ok) return json({ ok: false, error: "spotify_" + res.status }, cors);
    const html = await res.text();

    // Extrai o JSON embutido (__NEXT_DATA__ ou qualquer <script application/json>)
    let data = null;
    let m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) m = html.match(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
    if (m) { try { data = JSON.parse(m[1]); } catch (e) {} }
    if (!data) return json({ ok: false, error: "sem_dados" }, cors);

    // Busca recursiva pela maior lista de itens que pareçam episódios
    const eps = biggestEpisodeList(data);
    if (!eps.length) return json({ ok: false, error: "sem_episodios" }, cors);

    const out = eps.slice(0, 8).map((e) => {
      const uri = String(e.uri || "");
      const id = uri.split(":").pop();
      const img = pickImage(e);
      return {
        name: e.title || e.name || "",
        url: id ? `https://open.spotify.com/episode/${id}` : `https://open.spotify.com/show/${show}`,
        duration: typeof e.duration === "number" ? e.duration : null, // ms
        date: e.releaseDate && (e.releaseDate.isoString || e.releaseDate) || null,
        image: img || null,
      };
    }).filter((e) => e.name);

    return json({ ok: out.length > 0, show, episodes: out }, cors);
  } catch (err) {
    return json({ ok: false, error: String(err).slice(0, 120) }, cors);
  }
}

function biggestEpisodeList(root) {
  let best = [];
  const seen = new Set();
  (function walk(o) {
    if (!o || typeof o !== "object" || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) {
      const eps = o.filter((x) => x && typeof x === "object" &&
        typeof x.uri === "string" && x.uri.indexOf("spotify:episode:") === 0 &&
        (x.title || x.name));
      if (eps.length > best.length) best = eps;
      for (const v of o) walk(v);
    } else {
      for (const k in o) walk(o[k]);
    }
  })(root);
  return best;
}

function pickImage(e) {
  const src = e.coverArt || e.images || e.visualIdentity || null;
  if (!src) return null;
  const arr = src.sources || src;
  if (Array.isArray(arr) && arr.length) {
    const last = arr[arr.length - 1];
    return (last && (last.url || last)) || null;
  }
  return typeof src === "string" ? src : null;
}

function json(o, headers) { return new Response(JSON.stringify(o), { headers }); }

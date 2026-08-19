/**
 * GET /api/apoiador-checar?whats=DIGITOS&email=EMAIL   (PÚBLICO)
 * Diz se a pessoa já se cadastrou na LP de materiais (por WhatsApp OU e-mail).
 * Retorna { existe:true, modo } quando encontra. Não expõe outros dados.
 */
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors() });
}

export async function onRequestGet({ request, env }) {
  const h = cors();
  try {
    const u = new URL(request.url);
    const whats = String(u.searchParams.get("whats") || "").replace(/\D/g, "").slice(0, 13);
    const email = String(u.searchParams.get("email") || "").trim().toLowerCase().slice(0, 160);

    const conds = [];
    if (whats.length >= 10) conds.push(`whatsapp.eq.${whats}`);
    if (email.includes("@")) conds.push(`email.eq.${email}`);
    if (!conds.length) return json({ existe: false }, 200, h);

    const q = `/apoiadores?select=id,modo&or=(${conds.join(",")})&limit=1`;
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1${q}`, {
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY },
    });
    if (!r.ok) return json({ existe: false }, 200, h);
    const rows = await r.json().catch(() => []);
    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
    return json({ existe: !!row, modo: row ? row.modo : null }, 200, h);
  } catch (e) {
    // se a checagem falhar, não trava o cadastro: responde "não existe"
    return json({ existe: false }, 200, h);
  }
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}
function json(o, s, extra) {
  return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json", ...(extra || {}) } });
}

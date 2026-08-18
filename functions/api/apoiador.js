/**
 * POST /api/apoiador   (PÚBLICO — cadastro de apoiador da LP de material)
 * A LP calcula a rota (BrasilAPI + haversine) e manda modo/lat/lng/distancia.
 * Aqui só validamos e gravamos (upsert por whatsapp).
 *
 * Regra: recadastro do mesmo WhatsApp atualiza os dados, mas NUNCA rebaixa
 * status/lote/rastreio (essas colunas ficam fora do payload — o upsert do
 * PostgREST só atualiza as colunas enviadas).
 *
 * Usa SUPABASE_URL + SUPABASE_SERVICE_KEY (já existentes no Pages).
 */
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors() });
}

export async function onRequestPost({ request, env }) {
  const h = cors();
  try {
    const b = await request.json().catch(() => null);
    if (!b) return json({ ok: false, erro: "json invalido" }, 400, h);
    if (b._gotcha) return json({ ok: true, skipped: true }, 200, h);

    const modo = b.modo === "fisico" ? "fisico" : "digital";
    const nome = texto(b.nome, 120);
    const whatsapp = String(b.whatsapp || "").replace(/\D/g, "").slice(0, 13);
    const email = texto(b.email, 160).toLowerCase();
    const cep = String(b.cep || "").replace(/\D/g, "").slice(0, 8);

    if (!nome || nome.length < 5) return json({ ok: false, erro: "nome invalido" }, 400, h);
    if (whatsapp.length < 10) return json({ ok: false, erro: "whatsapp invalido" }, 400, h);
    if (!email || !email.includes("@")) return json({ ok: false, erro: "email invalido" }, 400, h);
    if (cep.length !== 8) return json({ ok: false, erro: "cep invalido" }, 400, h);
    if (modo === "fisico" && !texto(b.numero, 20))
      return json({ ok: false, erro: "numero do endereco obrigatorio no modo fisico" }, 400, h);

    const ip = request.headers.get("cf-connecting-ip") || null;
    const ua = texto(request.headers.get("user-agent"), 200);

    // payload SEM status/lote/rastreio/criado_em (preserva em recadastro)
    const row = {
      atualizado_em: new Date().toISOString(),
      modo, nome, whatsapp, email, cep,
      logradouro: texto(b.logradouro, 160), numero: texto(b.numero, 20),
      complemento: texto(b.complemento, 80), bairro: texto(b.bairro, 100),
      cidade: texto(b.cidade, 100), uf: texto(b.uf, 2),
      lat: num(b.lat), lng: num(b.lng), distancia_km: num(b.distancia_km),
      metodo_rota: texto(b.metodo_rota, 40),
      quer_panfletar: !!b.quer_panfletar,
      origem: texto(b.origem, 200), utm_medium: texto(b.utm_medium, 100),
      utm_campaign: texto(b.utm_campaign, 100), aceite_em: texto(b.aceite_em, 40) || null,
      ip, user_agent: ua,
    };

    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/apoiadores?on_conflict=whatsapp`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const t = await res.text();
      return json({ ok: false, erro: "banco", detalhe: t.slice(0, 200) }, 500, h);
    }
    return json({ ok: true, modo }, 200, h);
  } catch (e) {
    return json({ ok: false, erro: "internal", detalhe: String(e).slice(0, 120) }, 500, h);
  }
}

function texto(v, max) { if (v == null) return ""; return String(v).trim().slice(0, max || 200); }
function num(v) { const n = parseFloat(v); return isFinite(n) ? n : null; }
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}
function json(o, s, extra) {
  return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json", ...(extra || {}) } });
}

/**
 * POST /api/sympla-backfill   (admin logado, ou x-engine-key)
 * Puxa leads do Sympla para o CRM. Feito em passos, pra não estourar tempo:
 *   body { step:"events" }                         -> lista todos os eventos
 *   body { step:"participants", event_id, event_nome, page } -> importa 1 página
 *
 * Variáveis: SYMPLA_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY, ENGINE_KEY
 */
const API = "https://api.sympla.com.br/public/v3";

export async function onRequestPost({ request, env }) {
  // auth: admin logado OU chave do motor
  const engineOk = (request.headers.get("x-engine-key") || "") === (env.ENGINE_KEY || "\0");
  if (!engineOk) {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const who = token ? await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token } }) : null;
    if (!who || !who.ok) return json({ ok: false, error: "nao_autorizado" }, 401);
  }
  if (!env.SYMPLA_TOKEN) return json({ ok: false, error: "SYMPLA_TOKEN ausente no Cloudflare" }, 200);

  let b = {}; try { b = await request.json(); } catch {}
  try {
    if (b.step === "events") return json(await listarEventos(env), 200);
    if (b.step === "debug") { const r = await symplaRaw(env, `/events?page=1&page_size=5`); return json({ ok: true, status: r.status, corpo: (r.text || "").slice(0, 900) }, 200); }
    if (b.step === "participants") return json({ ok: true, ...(await importarPagina(env, b.event_id, b.event_nome, b.page || 1)) }, 200);
    return json({ ok: false, error: "step invalido" }, 200);
  } catch (e) {
    return json({ ok: false, error: "sympla", detalhe: String(e).slice(0, 200) }, 200);
  }
}

async function symplaRaw(env, path) {
  const r = await fetch(API + path, { headers: { "s_token": env.SYMPLA_TOKEN, "Content-Type": "application/json" } });
  const text = await r.text();
  let jsonBody = null; try { jsonBody = text ? JSON.parse(text) : null; } catch {}
  return { status: r.status, ok: r.ok, json: jsonBody, text };
}
async function sympla(env, path) {
  const r = await symplaRaw(env, path);
  if (!r.ok) throw new Error(`sympla ${r.status} ${(r.text || "").slice(0, 160)}`);
  return r.json || {};
}

async function listarEventos(env) {
  // 'published=false' é essencial: por padrão a API só lista eventos PUBLICADOS,
  // e palestras já encerradas ficam de fora. 'from' amplia a janela p/ o passado.
  const FROM = encodeURIComponent("2018-01-01 00:00:00");
  const variantes = [
    `/events?page=1&page_size=200&from=${FROM}&published=false`,
    `/events?page=1&page_size=200&published=false`,
    `/events?page=1&page_size=200&from=${FROM}`,
    `/events?page=1&page_size=200`,
  ];
  const tentativas = [];
  for (const v0 of variantes) {
    const first = await symplaRaw(env, v0);
    const arr0 = (first.json && (first.json.data || first.json.events)) || [];
    tentativas.push({ q: v0.replace(/%20/g, " "), status: first.status, quantidade: (first.json && first.json.pagination && first.json.pagination.quantity) ?? arr0.length });
    if (!arr0.length) continue;
    // funcionou -> pagina até o fim
    const out = []; let page = 1; const base = v0.replace(/([?&])page=\d+/, "$1page=PAGE");
    for (let i = 0; i < 60; i++) {
      const d = await sympla(env, base.replace("PAGE", String(page)));
      const arr = (d.data || d.events || []);
      for (const e of arr) out.push({ id: e.id, nome: e.name || e.title || ("Evento " + e.id) });
      if (!(d.pagination && d.pagination.has_next)) break;
      page++;
    }
    return { ok: true, eventos: out, usou: v0.replace(/%20/g, " ") };
  }
  return { ok: true, eventos: [], debug: { tentativas, amostra: "todas as variações voltaram 0 eventos" } };
}

async function importarPagina(env, eventId, eventNome, page) {
  const d = await sympla(env, `/events/${encodeURIComponent(eventId)}/participants?page=${page}&page_size=100`);
  const parts = d.data || [];
  let importados = 0, pulados = 0;
  for (const p of parts) {
    const nome = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
    const email = (p.email || "").trim();
    const cf = extrairCustom(p);
    const okContato = email || cf.telefone;
    if (!okContato) { pulados++; continue; }
    try {
      await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/sympla_lead`, {
        method: "POST",
        headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ p_nome: nome, p_email: email, p_telefone: cf.telefone || "", p_cidade: cf.cidade || null, p_uf: cf.uf || null, p_evento: eventNome || "" }),
      });
      importados++;
    } catch (e) { pulados++; }
  }
  const pg = d.pagination || {};
  return { event_id: eventId, page, importados, pulados, total_na_pagina: parts.length, has_next: !!pg.has_next };
}

/* extrai telefone/cidade/uf do formulário do participante (custom_form) */
function extrairCustom(p) {
  const res = { telefone: "", cidade: "", uf: "" };
  let campos = p.custom_form || p.customForm || [];
  // pode vir como array de {name,value}, um único objeto {name,value}, ou um mapa
  if (campos && !Array.isArray(campos) && typeof campos === "object") {
    campos = ("name" in campos || "value" in campos) ? [campos] : Object.values(campos);
  }
  for (const c of (campos || [])) {
    const nome = String((c && (c.name || c.label || c.title)) || "").toLowerCase();
    const val = c && (c.value != null ? c.value : c.answer);
    if (val == null || val === "") continue;
    if (!res.telefone && /telefone|celular|whats|fone|contato/.test(nome)) res.telefone = String(val);
    else if (!res.cidade && /cidade|munic/.test(nome)) res.cidade = String(val);
    else if (!res.uf && /estado|\buf\b/.test(nome)) res.uf = String(val).slice(0, 2);
  }
  // alguns eventos trazem telefone direto no participante
  if (!res.telefone && (p.phone || p.telephone)) res.telefone = String(p.phone || p.telephone);
  return res;
}

function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } }); }

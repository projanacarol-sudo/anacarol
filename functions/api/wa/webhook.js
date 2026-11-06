/**
 * POST /api/wa/webhook?key=SEGREDO   (receptor dos eventos da Evolution API)
 * Recebe principalmente "messages.upsert" e grava a conversa + mensagem no
 * Supabase, criando/atualizando a conversa e tentando vincular um lead.
 * Responde rápido (a Evolution só precisa do 200).
 *
 * Vars Cloudflare: SUPABASE_URL, SUPABASE_SERVICE_KEY, WA_WEBHOOK_KEY
 * Configure o webhook na Evolution apontando para esta URL com ?key=WA_WEBHOOK_KEY
 */
export function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors() });
}
export function onRequestGet({ request, env }) {
  const key = new URL(request.url).searchParams.get("key") || "";
  if (env.WA_WEBHOOK_KEY && key !== env.WA_WEBHOOK_KEY) return json({ ok: false }, 401);
  return json({ ok: true, pronto: true });
}

export async function onRequestPost({ request, env }) {
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!env.WA_WEBHOOK_KEY || key !== env.WA_WEBHOOK_KEY) return json({ ok: false, erro: "nao_autorizado" }, 401);

  let body = {};
  try { body = await request.json(); } catch { return json({ ok: true, ignorado: "corpo" }); }

  const evento = (body.event || body.type || "").toString().toLowerCase();
  const instancia = body.instance || body.instanceName || env.EVOLUTION_INSTANCE || "default";

  // só tratamos mensagens novas nesta fase
  if (!evento.includes("messages.upsert") && !evento.includes("messages_upsert") && !evento.includes("send.message")) {
    return json({ ok: true, ignorado: evento || "sem_evento" });
  }

  // data pode vir como objeto único ou array
  const itens = Array.isArray(body.data) ? body.data : [body.data].filter(Boolean);
  let gravadas = 0;
  for (const d of itens) {
    try { if (await gravarMensagem(env, instancia, d)) gravadas++; } catch (e) { /* segue */ }
  }
  return json({ ok: true, gravadas });
}

async function gravarMensagem(env, instancia, d) {
  if (!d || !d.key) return false;
  const jid = d.key.remoteJid || "";
  if (!jid || jid.endsWith("@g.us") || jid === "status@broadcast") return false; // ignora grupos/status
  const fromMe = !!d.key.fromMe;
  const waId = d.key.id || null;
  const nome = d.pushName || null;
  const fone = "+" + jid.replace(/@.*/, "").replace(/\D/g, "");

  const { texto, tipo, media } = extrair(d.message || {});
  if (!texto && tipo === "texto") return false; // nada útil

  // 1) upsert da conversa (por instancia+telefone)
  const conv = await upsertConversa(env, { instancia, fone, jid, nome, fromMe, ultimo: texto || `[${tipo}]` });
  if (!conv) return false;

  // 2) grava a mensagem (dedupe por wa_message_id)
  await rest(env, "POST", "/rest/v1/wa_mensagens", {
    conversa_id: conv.id,
    wa_message_id: waId,
    direcao: fromMe ? "out" : "in",
    tipo, texto: texto || null, media_url: media || null,
    origem: fromMe ? "atendente" : "contato",
  }, { Prefer: "resolution=ignore-duplicates,return=minimal" });

  return true;
}

function extrair(m) {
  if (m.conversation) return { texto: m.conversation, tipo: "texto", media: null };
  if (m.extendedTextMessage?.text) return { texto: m.extendedTextMessage.text, tipo: "texto", media: null };
  if (m.imageMessage) return { texto: m.imageMessage.caption || "", tipo: "imagem", media: null };
  if (m.videoMessage) return { texto: m.videoMessage.caption || "", tipo: "video", media: null };
  if (m.audioMessage) return { texto: "", tipo: "audio", media: null };
  if (m.documentMessage) return { texto: m.documentMessage.fileName || "", tipo: "documento", media: null };
  if (m.stickerMessage) return { texto: "", tipo: "figurinha", media: null };
  return { texto: "", tipo: "outro", media: null };
}

async function upsertConversa(env, { instancia, fone, jid, nome, fromMe, ultimo }) {
  // procura existente
  const achou = await rest(env, "GET",
    `/rest/v1/wa_conversas?instancia=eq.${encodeURIComponent(instancia)}&telefone_e164=eq.${encodeURIComponent(fone)}&select=id,nao_lidas`);
  const agora = new Date().toISOString();
  if (Array.isArray(achou) && achou[0]) {
    const patch = { ultimo_texto: ultimo, ultimo_em: agora, wa_jid: jid };
    if (nome) patch.nome = nome;
    if (!fromMe) patch.nao_lidas = (achou[0].nao_lidas || 0) + 1;
    await rest(env, "PATCH", `/rest/v1/wa_conversas?id=eq.${achou[0].id}`, patch, { Prefer: "return=minimal" });
    return { id: achou[0].id };
  }
  // cria nova (tenta vincular lead pelo telefone)
  let lead_id = null;
  try {
    const l = await rest(env, "GET", `/rest/v1/leads?telefone_e164=eq.${encodeURIComponent(fone)}&select=id&limit=1`);
    if (Array.isArray(l) && l[0]) lead_id = l[0].id;
  } catch {}
  const criada = await rest(env, "POST", "/rest/v1/wa_conversas", {
    instancia, telefone_e164: fone, wa_jid: jid, nome, lead_id,
    status: "novo", nao_lidas: fromMe ? 0 : 1, ultimo_texto: ultimo, ultimo_em: agora,
  }, { Prefer: "return=representation" });
  return Array.isArray(criada) ? criada[0] : criada;
}

/* ---- helpers Supabase REST (service key) ---- */
async function rest(env, method, path, body, extraHeaders) {
  const r = await fetch(env.SUPABASE_URL + path, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
      "Content-Type": "application/json",
      ...(extraHeaders || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  try { return txt ? JSON.parse(txt) : null; } catch { return null; }
}
function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST,GET,OPTIONS", "Access-Control-Allow-Headers": "content-type" };
}
function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json", ...cors() } }); }

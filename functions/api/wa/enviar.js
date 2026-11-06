/**
 * POST /api/wa/enviar   (atendente logado)
 * Envia uma mensagem de texto pelo WhatsApp (Evolution) e registra na conversa.
 * body: { conversa_id, texto }   (ou { telefone, texto })
 *
 * Vars: EVOLUTION_URL, EVOLUTION_KEY, EVOLUTION_INSTANCE,
 *       SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY
 */
export function onRequestOptions() { return new Response(null, { status: 204, headers: cors() }); }

export async function onRequestPost({ request, env }) {
  const who = await usuario(env, request);
  if (!who) return json({ ok: false, erro: "nao_autorizado" }, 401);

  let b = {}; try { b = await request.json(); } catch {}
  const texto = (b.texto || "").toString().trim();
  if (!texto) return json({ ok: false, erro: "texto_vazio" }, 400);

  // resolve conversa + telefone
  let conv = null, fone = (b.telefone || "").toString();
  if (b.conversa_id) {
    const c = await rest(env, "GET", `/rest/v1/wa_conversas?id=eq.${b.conversa_id}&select=id,telefone_e164,instancia`);
    conv = Array.isArray(c) ? c[0] : null;
    if (conv) fone = conv.telefone_e164;
  }
  if (!fone) return json({ ok: false, erro: "sem_destino" }, 400);

  const instancia = (conv && conv.instancia) || env.EVOLUTION_INSTANCE;
  const numero = fone.replace(/\D/g, "");

  // envia pela Evolution
  let waId = null, erro = null;
  try {
    const r = await fetch(`${env.EVOLUTION_URL}/message/sendText/${encodeURIComponent(instancia)}`, {
      method: "POST",
      headers: { apikey: env.EVOLUTION_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ number: numero, text: texto }),
    });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
    if (!r.ok) erro = `evolution ${r.status}: ${t.slice(0, 160)}`;
    waId = j?.key?.id || null;
  } catch (e) { erro = String(e).slice(0, 160); }

  // registra na conversa (mesmo se deu erro, para o atendente ver)
  if (conv) {
    await rest(env, "POST", "/rest/v1/wa_mensagens", {
      conversa_id: conv.id, wa_message_id: waId, direcao: "out", tipo: "texto",
      texto, origem: "atendente", atendente_id: who.id || null, status: erro ? "erro" : "ok",
    }, { Prefer: "return=minimal" });
    await rest(env, "PATCH", `/rest/v1/wa_conversas?id=eq.${conv.id}`, {
      ultimo_texto: texto, ultimo_em: new Date().toISOString(),
      status: "em_atendimento", nao_lidas: 0,
    }, { Prefer: "return=minimal" });
  }

  if (erro) return json({ ok: false, erro }, 502);
  return json({ ok: true, wa_message_id: waId });
}

/* valida o token do Supabase Auth (atendente logado) */
async function usuario(env, request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  try {
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
async function rest(env, method, path, body, extra) {
  const r = await fetch(env.SUPABASE_URL + path, {
    method, headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY, "Content-Type": "application/json", ...(extra || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text(); try { return t ? JSON.parse(t) : null; } catch { return null; }
}
function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST,OPTIONS", "Access-Control-Allow-Headers": "content-type,authorization" }; }
function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json", ...cors() } }); }

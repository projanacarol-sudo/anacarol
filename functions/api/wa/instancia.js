/**
 * /api/wa/instancia   (atendente/admin logado)
 * Gerencia a instância da Evolution usada no atendimento.
 *   GET  ?acao=status   -> estado da conexão
 *   GET  ?acao=qr       -> QR code (base64) para conectar o número
 *   POST {acao:"criar"} -> cria a instância e aponta o webhook de volta pro CRM
 *   POST {acao:"logout"}-> desconecta o número
 *
 * Vars: EVOLUTION_URL, EVOLUTION_KEY, EVOLUTION_INSTANCE, WA_WEBHOOK_KEY,
 *       SUPABASE_URL, SUPABASE_ANON_KEY  (+ origem do CRM para o webhook)
 */
export function onRequestOptions() { return new Response(null, { status: 204, headers: cors() }); }

export async function onRequestGet({ request, env }) {
  if (!(await autorizado(env, request))) return json({ ok: false, erro: "nao_autorizado" }, 401);
  const acao = new URL(request.url).searchParams.get("acao") || "status";
  const inst = env.EVOLUTION_INSTANCE;
  try {
    if (acao === "qr") {
      const r = await evo(env, "GET", `/instance/connect/${enc(inst)}`);
      return json({ ok: true, base64: r.json?.base64 || null, code: r.json?.code || r.json?.pairingCode || null });
    }
    const r = await evo(env, "GET", `/instance/connectionState/${enc(inst)}`);
    return json({ ok: true, estado: r.json?.instance?.state || r.json?.state || "desconhecido" });
  } catch (e) { return json({ ok: false, erro: String(e).slice(0, 160) }, 502); }
}

export async function onRequestPost({ request, env }) {
  if (!(await autorizado(env, request))) return json({ ok: false, erro: "nao_autorizado" }, 401);
  let b = {}; try { b = await request.json(); } catch {}
  const inst = env.EVOLUTION_INSTANCE;
  const origem = new URL(request.url).origin;
  const webhookUrl = `${origem}/api/wa/webhook?key=${encodeURIComponent(env.WA_WEBHOOK_KEY || "")}`;
  try {
    if (b.acao === "logout") {
      const r = await evo(env, "DELETE", `/instance/logout/${enc(inst)}`);
      return json({ ok: r.ok });
    }
    if (b.acao === "criar") {
      // cria a instância (Baileys = QR Code) e já configura o webhook
      const criar = await evo(env, "POST", "/instance/create", {
        instanceName: inst, qrcode: true, integration: "WHATSAPP-BAILEYS",
      });
      await evo(env, "POST", `/webhook/set/${enc(inst)}`, {
        webhook: { enabled: true, url: webhookUrl, webhookByEvents: false, base64: true,
          events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"] },
      });
      return json({ ok: true, base64: criar.json?.qrcode?.base64 || null, criado: criar.ok, webhook: webhookUrl });
    }
    return json({ ok: false, erro: "acao_invalida" }, 400);
  } catch (e) { return json({ ok: false, erro: String(e).slice(0, 180) }, 502); }
}

async function evo(env, method, path, body) {
  const r = await fetch(env.EVOLUTION_URL + path, {
    method, headers: { apikey: env.EVOLUTION_KEY, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
  return { ok: r.ok, status: r.status, json: j, text: t };
}
async function autorizado(env, request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  try { const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token } }); return r.ok; }
  catch { return false; }
}
const enc = encodeURIComponent;
function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS", "Access-Control-Allow-Headers": "content-type,authorization" }; }
function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json", ...cors() } }); }

/**
 * Disparo de push — módulo compartilhado (sem rota própria).
 *  - enviarParaSubs(env, subs, payload): envia para uma lista de assinaturas,
 *    limpa as mortas (404/410) e retorna { enviados, falhas }.
 *  - dispararEvento(env, evento, payload): resolve a regra do evento
 *    (todos / selecionados) e envia. Usado pelos gatilhos automáticos.
 */
import { sendWebPush } from "./webpush.js";

export async function enviarParaSubs(env, subs, payload) {
  let enviados = 0, falhas = 0; const mortas = [];
  for (const s of subs) {
    try {
      const r = await sendWebPush(env, { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      if (r.ok) enviados++;
      else { falhas++; if (r.gone) mortas.push(s.endpoint); }
    } catch (e) { falhas++; }
  }
  if (mortas.length) {
    try {
      const list = mortas.map(e => `"${e.replace(/"/g, "")}"`).join(",");
      await sb(env, "DELETE", `/push_subscriptions?endpoint=in.(${encodeURIComponent(list)})`);
    } catch (e) {}
  }
  return { enviados, falhas };
}

export async function dispararEvento(env, evento, payload) {
  try {
    const reg = await sb(env, "GET", `/notif_eventos?evento=eq.${encodeURIComponent(evento)}&select=ativo,alvo&limit=1`);
    const r = reg[0];
    if (!r || r.ativo === false) return { enviados: 0, falhas: 0, pulado: true };

    let subs;
    if (r.alvo === "selecionados") {
      // colaboradores vinculados a este evento
      const vinc = await sb(env, "GET", `/notif_evento_colab?evento=eq.${encodeURIComponent(evento)}&select=colaborador_id`);
      const ids = vinc.map(v => v.colaborador_id).filter(Boolean);
      if (!ids.length) return { enviados: 0, falhas: 0 };
      const inList = ids.map(id => `"${id}"`).join(",");
      subs = await sb(env, "GET", `/push_subscriptions?colaborador_id=in.(${inList})&select=endpoint,p256dh,auth`);
    } else {
      subs = await sb(env, "GET", `/push_subscriptions?select=endpoint,p256dh,auth`);
    }
    const res = await enviarParaSubs(env, subs, payload);
    try { await sb(env, "POST", "/notif_log", { evento, titulo: payload.title || payload.titulo, corpo: payload.body || payload.corpo, url: payload.url, enviados: res.enviados, falhas: res.falhas }); } catch (e) {}
    return res;
  } catch (e) { return { enviados: 0, falhas: 0, erro: String(e).slice(0, 120) }; }
}

async function sb(env, method, path, payload) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method, headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY, "Content-Type": "application/json" },
    body: payload !== undefined ? JSON.stringify(payload) : undefined });
  const t = await res.text(); if (!res.ok) throw new Error(`sb ${res.status} ${t}`);
  return t ? JSON.parse(t) : [];
}

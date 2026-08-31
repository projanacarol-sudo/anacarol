/**
 * POST /api/push/enviar   (admin logado) — envio manual segmentado.
 * Body: { titulo, corpo, url?, alvo:'todos'|'selecionados', colaborador_ids?[] }
 */
import { enviarParaSubs } from "./disparo.js";

export async function onRequestPost({ request, env }) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "sem_token" }, 401);
  const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token } });
  if (!who.ok) return json({ ok: false, error: "nao_autorizado" }, 401);
  const user = await who.json().catch(() => null);
  const uid = user && user.id;

  let b = {}; try { b = await request.json(); } catch {}
  const titulo = (b.titulo || "").trim() || (b.teste ? "Teste de notificação" : "");
  const corpo = (b.corpo || "").trim() || (b.teste ? "Se você recebeu isto, está tudo funcionando ✅" : "");
  if (!titulo) return json({ ok: false, error: "sem_titulo" }, 200);

  let subs;
  if (b.teste) {
    // envia só para os aparelhos do próprio usuário logado
    subs = await sb(env, "GET", `/push_subscriptions?auth_user_id=eq.${encodeURIComponent(uid)}&select=endpoint,p256dh,auth`);
  } else if (b.alvo === "selecionados" && Array.isArray(b.colaborador_ids) && b.colaborador_ids.length) {
    const inList = b.colaborador_ids.map(id => `"${String(id).replace(/"/g, "")}"`).join(",");
    subs = await sb(env, "GET", `/push_subscriptions?colaborador_id=in.(${inList})&select=endpoint,p256dh,auth`);
  } else {
    subs = await sb(env, "GET", `/push_subscriptions?select=endpoint,p256dh,auth`);
  }
  if (!subs.length) return json({ ok: true, enviados: 0, falhas: 0, aviso: "nenhum_aparelho_inscrito" }, 200);

  const payload = { title: titulo, body: corpo, url: b.url || "/painel.html", tag: "manual" };
  const res = await enviarParaSubs(env, subs, payload);
  try { await sb(env, "POST", "/notif_log", { evento: "manual", titulo, corpo, url: payload.url, enviados: res.enviados, falhas: res.falhas }); } catch (e) {}
  return json({ ok: true, ...res }, 200);
}

async function sb(env, method, path, payload) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method, headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY, "Content-Type": "application/json" },
    body: payload !== undefined ? JSON.stringify(payload) : undefined });
  const t = await res.text(); if (!res.ok) throw new Error(`sb ${res.status} ${t}`);
  return t ? JSON.parse(t) : [];
}
function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } }); }

/**
 * POST /api/comite-retirada   (colaborador logado)
 * Cadastro de RETIRADA NO LOCAL (comitê / pronta entrega).
 * Grava o apoiador como impresso + status 'entregue' + retirada_local,
 * e registra a pessoa como lead (origem "Comitê — Retirada no local").
 * Body: { nome, whatsapp, email?, cidade?, uf?, obs? }
 */
export async function onRequestPost({ request, env }) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, erro: "sem_token" }, 401);
  const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token } });
  if (!who.ok) return json({ ok: false, erro: "nao_autorizado" }, 401);

  let b = {}; try { b = await request.json(); } catch {}
  const nome = txt(b.nome, 120);
  const whatsapp = String(b.whatsapp || "").replace(/\D/g, "").slice(0, 13);
  const email = txt(b.email, 160).toLowerCase();
  const cidade = txt(b.cidade, 100);
  const uf = txt(b.uf, 2).toUpperCase();
  if (!nome || nome.length < 3) return json({ ok: false, erro: "nome invalido" }, 200);
  if (whatsapp.length < 10) return json({ ok: false, erro: "whatsapp invalido (com DDD)" }, 200);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ ok: false, erro: "email obrigatorio/invalido" }, 200);
  if (cidade.length < 2) return json({ ok: false, erro: "cidade obrigatoria" }, 200);
  if (uf.length !== 2) return json({ ok: false, erro: "uf obrigatoria" }, 200);

  const row = {
    atualizado_em: new Date().toISOString(),
    modo: "fisico", status: "entregue", retirada_local: true,
    metodo_rota: "retirada-local",
    nome, whatsapp, email,
    cidade, uf,
    obs: txt(b.obs, 200) || null,
    origem: "comite-retirada",
  };

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/apoiadores?on_conflict=whatsapp`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
      "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const t = await res.text();
    return json({ ok: false, erro: "banco", detalhe: t.slice(0, 200) }, 500);
  }

  // registra como lead (origem própria do comitê) e inscreve no funil
  const ORIGEM = "Comitê — Retirada no local";
  try {
    const rLead = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/apoiador_vira_lead`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_nome: nome, p_email: email, p_whatsapp: whatsapp,
        p_uf: uf, p_cidade: cidade,
        p_origem_nome: ORIGEM, p_tag: "Retirou no local",
      }),
    });
    let leadId = null;
    try { const t = await rLead.text(); const v = t ? JSON.parse(t) : null; leadId = typeof v === "string" ? v : null; } catch (e) {}

    // AUTO-ENROLL: se houver funil ligado a esta origem, inscreve o lead
    if (leadId) {
      const oRes = await fetch(`${env.SUPABASE_URL}/rest/v1/origens?nome=eq.${encodeURIComponent(ORIGEM)}&select=auto_sequence_id&limit=1`,
        { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY } });
      const org = (await oRes.json().catch(() => []))[0];
      const seqId = org && org.auto_sequence_id;
      if (seqId) {
        await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/enroll_lead`, {
          method: "POST",
          headers: {
            apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
            "Content-Type": "application/json", Prefer: "return=minimal",
          },
          body: JSON.stringify({ p_lead: leadId, p_sequence: seqId }),
        });
      }
    }
  } catch (e) { /* virar lead / inscrever não bloqueia o cadastro */ }

  return json({ ok: true, nome }, 200);
}

function txt(v, max) { if (v == null) return ""; return String(v).trim().slice(0, max || 200); }
function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } }); }

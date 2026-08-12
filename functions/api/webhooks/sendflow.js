/**
 * CRM Ana — Webhook do SendFlow (grupos de WhatsApp): POST /api/webhooks/sendflow
 * Recebe entrada/saída de membros dos grupos e:
 *   - registra em group_events
 *   - mantém a contagem em groups
 *   - cria/atualiza o lead pelo telefone (com DDD), marcando opt-in de WhatsApp
 *
 * Segurança: header "sendtok" == env.SENDFLOW_TOKEN
 * Blindado: SEMPRE responde 200 "ok" (para o SendFlow nunca pausar por erro).
 *
 * Variáveis (Pages → Environment variables):
 *   SENDFLOW_TOKEN  (Secret) — o mesmo token que você põe no webhook do SendFlow
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY (já existem)
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  // valida o token em QUALQUER header (independe do nome do cabeçalho)
  if (env.SENDFLOW_TOKEN) {
    let ok = false;
    for (const [, v] of request.headers) {
      if (v === env.SENDFLOW_TOKEN || v.replace(/^Bearer\s+/i, "") === env.SENDFLOW_TOKEN) { ok = true; break; }
    }
    if (!ok) return new Response("unauthorized", { status: 401 });
  }
  // rede de proteção: engole qualquer erro e sempre responde ok
  try {
    const body = await request.json().catch(() => ({}));
    await handle(env, body);
  } catch (e) { console.log("ERRO sendflow webhook:", String(e)); }
  return new Response("ok", { status: 200 });
}

async function handle(env, body) {
  const ev = body.event || "";
  const d = body.data || {};

  // allowlist: se SENDFLOW_CAMPAIGNS estiver definido, só processa essas campanhas
  const permitidas = (env.SENDFLOW_CAMPAIGNS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (permitidas.length && d.campaignId && !permitidas.includes(d.campaignId)) return;

  // métricas agregadas da campanha (participantes, grupos, entradas/saídas por dia)
  if (ev === "campaign.metrics") {
    await sb(env, "POST", "/sendflow_campanhas", {
      campaign_id: d.campaignId, nome: d.campaignName || null,
      participantes: d.participantsAmount ?? null, cliques: d.clicksTotalCount ?? null,
      entradas: d.inputAmount ?? null, saidas: d.outputAmount ?? null,
      grupos_total: d.groupsTotalAmount ?? null, grupos_cheios: d.groupsFullAmount ?? null,
      grupos_abertos: d.groupsOpenAmount ?? null,
      input_dates: d.inputDates || {}, output_dates: d.outputDates || {},
      atualizado_em: new Date().toISOString(),
    }, "resolution=merge-duplicates");
    return;
  }

  const add = ev === "group.updated.members.added";
  const rem = ev === "group.updated.members.removed";
  if (!add && !rem) return;                 // ignora outros eventos, sem erro

  const numero = String(d.number || "").trim();
  const phone = parsePhone(numero);
  const uf = phone.ddd ? (DDD_UF[phone.ddd] || null) : null;
  const grupoNome = d.groupName || "Grupo";
  const campaignId = d.campaignId || null;

  // 1) acha/cria o grupo (pela combinação campanha + nome)
  let grupo = (await sb(env, "GET",
    `/groups?nome=eq.${encodeURIComponent(grupoNome)}&select=id,qtd_membros&limit=1`))[0];
  if (!grupo) {
    grupo = (await sb(env, "POST", "/groups",
      { nome: grupoNome, campaign_id: campaignId, sendflow_group_id: (campaignId ? campaignId + "|" + grupoNome : null), qtd_membros: 0, ativo: true },
      "return=representation"))[0];
  }

  // 2) lead pelo telefone (só quando entrou; saída não apaga o lead)
  let leadId = null;
  if (phone.e164) {
    let lead = (await sb(env, "GET",
      `/leads?telefone_e164=eq.${encodeURIComponent(phone.e164)}&select=id,tags&limit=1`))[0];
    if (!lead && add) {
      const origem = await origemGrupos(env);
      lead = (await sb(env, "POST", "/leads", {
        telefone_e164: phone.e164, ddd: phone.ddd, uf,
        regiao: uf ? REGIAO[uf] : null,
        origem_id: origem, opt_in_whatsapp: true,
        tags: ["grupo-whatsapp"],
        primeira_captura_em: new Date().toISOString(),
        ultima_interacao_em: new Date().toISOString(),
      }, "return=representation"))[0];
    }
    leadId = lead ? lead.id : null;
  }

  // 3) registra o evento
  await sb(env, "POST", "/group_events", {
    group_id: grupo.id, lead_id: leadId,
    tipo: add ? "entrou" : "saiu", numero, payload: body,
  });

  // 4) atualiza a contagem do grupo (com dedup diário na entrada)
  if (add) {
    const hoje = new Date().toISOString().slice(0, 10);
    const jaHoje = (await sb(env, "GET",
      `/group_events?group_id=eq.${grupo.id}&tipo=eq.entrou&numero=eq.${encodeURIComponent(numero)}&created_at=gte.${hoje}T00:00:00Z&select=id&limit=2`));
    if (jaHoje.length <= 1) { // este é o 1º de hoje
      await sb(env, "PATCH", `/groups?id=eq.${grupo.id}`, { qtd_membros: (grupo.qtd_membros || 0) + 1 });
    }
  } else if (rem) {
    await sb(env, "PATCH", `/groups?id=eq.${grupo.id}`, { qtd_membros: Math.max(0, (grupo.qtd_membros || 0) - 1) });
  }
}

/* origem "Grupos WhatsApp" (cria uma vez) */
async function origemGrupos(env) {
  let o = (await sb(env, "GET", `/origens?nome=eq.${encodeURIComponent("Grupos WhatsApp")}&select=id&limit=1`))[0];
  if (!o) o = (await sb(env, "POST", "/origens",
    { nome: "Grupos WhatsApp", tipo: "grupo", canal: "whatsapp", base_legal_padrao: "legitimo_interesse" },
    "return=representation"))[0];
  return o ? o.id : null;
}

/* ---------- utils ---------- */
function parsePhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("0055")) d = d.slice(2);
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("55") && DDD_UF[d.slice(2, 4)] && d[2] !== "9") return { e164: null, ddd: d.slice(2, 4) };
  if (d.length < 10 || d.length > 11) return { e164: null, ddd: null };
  return { e164: "+55" + d, ddd: d.slice(0, 2) };
}
async function sb(env, method, path, payload, prefer) {
  const headers = {
    "apikey": env.SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers["Prefer"] = prefer;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method, headers, body: payload !== undefined ? JSON.stringify(payload) : undefined });
  const t = await res.text();
  if (!res.ok) throw new Error(`supabase ${method} ${path} -> ${res.status} ${t}`);
  return t ? JSON.parse(t) : [];
}
const DDD_UF = {
  "11":"SP","12":"SP","13":"SP","14":"SP","15":"SP","16":"SP","17":"SP","18":"SP","19":"SP",
  "21":"RJ","22":"RJ","24":"RJ","27":"ES","28":"ES",
  "31":"MG","32":"MG","33":"MG","34":"MG","35":"MG","37":"MG","38":"MG",
  "41":"PR","42":"PR","43":"PR","44":"PR","45":"PR","46":"PR","47":"SC","48":"SC","49":"SC",
  "51":"RS","53":"RS","54":"RS","55":"RS","61":"DF","62":"GO","63":"TO","64":"GO","65":"MT","66":"MT","67":"MS","68":"AC","69":"RO",
  "71":"BA","73":"BA","74":"BA","75":"BA","77":"BA","79":"SE","81":"PE","82":"AL","83":"PB","84":"RN","85":"CE","86":"PI","87":"PE","88":"CE","89":"PI",
  "91":"PA","92":"AM","93":"PA","94":"PA","95":"RR","96":"AP","97":"AM","98":"MA","99":"MA",
};
const REGIAO = { AC:"Norte",AP:"Norte",AM:"Norte",PA:"Norte",RO:"Norte",RR:"Norte",TO:"Norte",
  AL:"Nordeste",BA:"Nordeste",CE:"Nordeste",MA:"Nordeste",PB:"Nordeste",PE:"Nordeste",PI:"Nordeste",RN:"Nordeste",SE:"Nordeste",
  DF:"Centro-Oeste",GO:"Centro-Oeste",MT:"Centro-Oeste",MS:"Centro-Oeste",
  ES:"Sudeste",MG:"Sudeste",RJ:"Sudeste",SP:"Sudeste",PR:"Sul",RS:"Sul",SC:"Sul" };

/**
 * POST /api/dandovoz   (receptor DandoVoz/NocoBase → CRM)
 * Recebe um cadastro de munícipe e grava como LEAD no Supabase.
 *
 * Segurança: exige o header  x-dandovoz-key: <DANDOVOZ_KEY>  (segredo
 * compartilhado, configurado no Workflow do DandoVoz e nas vars do Pages).
 *
 * Aceita tanto o payload "cru" do NocoBase (campos *_municipe) quanto um
 * payload já mapeado (nome/telefone/email/...). Tolerante a variações.
 *
 * Vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, DANDOVOZ_KEY
 */
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors() });
}

export async function onRequestPost({ request, env }) {
  const h = cors();

  // 1) autorização por segredo compartilhado
  const key = request.headers.get("x-dandovoz-key") || "";
  if (!env.DANDOVOZ_KEY || key !== env.DANDOVOZ_KEY) {
    return json({ ok: false, erro: "nao_autorizado" }, 401, h);
  }

  let b = {};
  try { b = await request.json(); } catch (e) { return json({ ok: false, erro: "json_invalido" }, 400, h); }

  // NocoBase costuma mandar { data: {...} } nos workflows; aceitamos os dois
  const d = b && typeof b === "object" ? (b.data && typeof b.data === "object" ? b.data : b) : {};

  // aceita objetos aninhados (relações do NocoBase): extrai um rótulo
  const rotulo = (v) => {
    if (v == null) return "";
    if (typeof v === "string" || typeof v === "number") return String(v).trim();
    if (typeof v === "object") {
      for (const k of ["nome", "label", "title", "name", "value", "text", "nome_municipe"]) {
        if (v[k] != null && String(v[k]).trim() !== "") return String(v[k]).trim();
      }
      if (v.id != null) return String(v.id);
    }
    return "";
  };
  const pega = (...ks) => { for (const k of ks) { const r = rotulo(d[k]); if (r) return r; } return ""; };

  // "cadastro" (padrão) ou "demanda"
  const evento = (pega("evento", "tipo_evento") || "cadastro").toLowerCase();

  try {
    let rpc, body;
    if (evento === "demanda" || evento === "ocorrencia" || d.assunto_demanda != null || d.tipo_de_Demanda != null) {
      // pega o munícipe vinculado (pode vir como objeto vincular_demanda)
      const vinc = d.vincular_demanda || d.municipe || {};
      const municipe_id = pega("municipe_id", "id_municipe") || rotulo(vinc && vinc.id) ||
        (vinc && rotulo(vinc.id_municipe)) || "";
      rpc = "dandovoz_demanda";
      body = {
        p_municipe_id: municipe_id || null,
        p_telefone: pega("telefone", "telefone_municipe") || rotulo(vinc.telefone_municipe),
        p_email:    pega("email", "email_municipe") || rotulo(vinc.email_municipe),
        p_nome:     pega("nome", "nome_municipe") || rotulo(vinc.nome_municipe),
        p_assunto:  pega("assunto", "assunto_demanda"),
        p_tema:     pega("tema", "tipo_de_Demanda", "tipo_demanda"),
        p_situacao: pega("situacao", "situacao_demanda"),
        p_prioridade: pega("prioridade", "prioridade_da_demanda"),
      };
    } else {
      const nome = pega("nome", "nome_municipe");
      const telefone = pega("telefone", "telefone_municipe", "whatsapp");
      const email = pega("email", "email_municipe");
      if (!nome && !telefone && !email) return json({ ok: false, erro: "sem_dados_de_contato" }, 400, h);
      rpc = "dandovoz_lead";
      body = {
        p_nome: nome, p_email: email, p_telefone: telefone,
        p_cidade: pega("cidade", "cidade_municipe"),
        p_bairro: pega("bairro", "bairro_municipe"),
        p_tipo: pega("tipo", "tipo_municipe", "tipo_de_cadastro"),
        p_origem_cad: pega("origem", "origem_cadastro", "origem_cadastro_municipe"),
        p_dandovoz_id: pega("dandovoz_id", "id", "id_municipe") || null,
      };
    }

    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${rpc}`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const t = await r.text();
      return json({ ok: false, erro: "banco", detalhe: t.slice(0, 200) }, 500, h);
    }
    const lead_id = await r.json().catch(() => null);
    return json({ ok: true, evento, lead_id }, 200, h);
  } catch (e) {
    return json({ ok: false, erro: "internal", detalhe: String(e).slice(0, 120) }, 500, h);
  }
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-dandovoz-key",
    "Access-Control-Max-Age": "86400",
  };
}
function json(o, s, extra) {
  return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json", ...(extra || {}) } });
}

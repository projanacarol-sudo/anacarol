/**
 * CRM Ana — Motor do funil de e-mail: POST /api/engine/tick
 * ---------------------------------------------------------------------
 * Chamado a cada minuto pelo agendador (pg_cron do Supabase).
 * Seleciona os leads que estão na hora de receber o próximo passo,
 * envia pelo Resend, avança o passo e registra o evento.
 *
 * Segurança: exige o header  x-engine-key == env.ENGINE_KEY
 *
 * Variáveis (Pages → Settings → Environment variables):
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY
 *   RESEND_FROM   ex: "Ana Carolina <contato@seudominio.com.br>"
 *   ENGINE_KEY    chave forte, igual à usada no cron do Supabase
 *   PUBLIC_BASE   ex: "https://SEU-PROJETO.pages.dev"  (para o link de descadastro)
 */

const LOTE = 40;         // e-mails por tick (respeita limites do Resend)
const MAX_TENTATIVAS = 3;

export async function onRequestPost(context) {
  const { request, env } = context;
  if ((request.headers.get("x-engine-key") || "") !== (env.ENGINE_KEY || "\0")) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  try {
    const r = await tick(env);
    return json({ ok: true, ...r });
  } catch (e) {
    console.log("ERRO tick:", e && e.stack ? e.stack : String(e));
    return json({ ok: false, error: "internal" }, 200);
  }
}

async function tick(env) {
  const nowISO = new Date().toISOString();
  // pega inscrições devidas, com dados do lead e do funil
  const devidos = await sb(env, "GET",
    `/lead_sequence_state?status=eq.ativo&proximo_envio_em=lte.${nowISO}` +
    `&select=id,lead_id,sequence_id,current_step_id,tentativas,ultimo_envio_em,` +
    `leads(email,email_normalizado,nome,unsubscribed_email),email_sequences(from_nome,from_email,ativo)` +
    `&order=proximo_envio_em.asc&limit=${LOTE}`);

  let enviados = 0, concluidos = 0, pulados = 0, falhas = 0, acoes = 0;
  const nodeCache = {};
  const getNode = async (id) => {
    if (!id) return null;
    if (nodeCache[id] !== undefined) return nodeCache[id];
    const r = await sb(env, "GET",
      `/email_steps?id=eq.${id}&select=id,tipo,config,assunto,corpo_html,preheader,atraso_horas,next_step_id,next_no_id&limit=1`);
    return (nodeCache[id] = r[0] || null);
  };

  for (const d of devidos) {
    const lead = d.leads || {};
    const seq = d.email_sequences || {};

    // funil pausado ou lead descadastrado -> encerra
    if (!seq.ativo || lead.unsubscribed_email) {
      await patchState(env, d.id, { status: "concluido" });
      pulados++; continue;
    }

    const node = await getNode(d.current_step_id);
    if (!node) { await patchState(env, d.id, { status: "concluido" }); concluidos++; continue; }
    const tipo = node.tipo || "email";

    // CLAIM: adia 5 min e conta tentativa (evita processamento duplo)
    const claim = await sb(env, "PATCH",
      `/lead_sequence_state?id=eq.${d.id}&proximo_envio_em=lte.${nowISO}`,
      { proximo_envio_em: plus(5 / 60), tentativas: (d.tentativas || 0) + 1 }, "return=representation");
    if (!claim || !claim.length) { continue; } // já foi pego por outro tick

    try {
      // ---- executa o nó conforme o tipo ----
      let nextId = node.next_step_id;   // caminho padrão / "Sim"
      if (tipo === "email") {
        if (!lead.email) throw new Error("lead sem e-mail");
        const emailId = await enviaResend(env, lead, seq, node, d.lead_id);
        await sb(env, "POST", "/email_events", {
          lead_id: d.lead_id, email_id: emailId, tipo: "sent",
          payload: { sequence_id: d.sequence_id, step_id: node.id },
        });
        enviados++;
      } else if (tipo === "tag_add" || tipo === "tag_remove") {
        await aplicaTag(env, d.lead_id, node.config && node.config.tag, tipo === "tag_add");
        acoes++;
      } else if (tipo === "condicao") {
        // avalia se o lead abriu/clicou desde o último e-mail deste funil
        const cond = (node.config && node.config.cond) || "abriu";
        const evTipo = cond === "clicou" ? "clicked" : "opened";
        let ok = false;
        if (d.ultimo_envio_em) {
          const ev = await sb(env, "GET",
            `/email_events?lead_id=eq.${d.lead_id}&tipo=eq.${evTipo}&created_at=gte.${d.ultimo_envio_em}&limit=1`);
          ok = ev.length > 0;
        }
        nextId = ok ? node.next_step_id : node.next_no_id;   // Sim x Não
        acoes++;
      } else {
        // 'espera' e outros: nó instantâneo (o atraso já foi cumprido antes dele)
        acoes++;
      }

      // ---- avança para o próximo nó ligado ----
      // ultimo_envio_em só muda quando um e-mail foi enviado (referência da condição)
      const marcaEnvio = tipo === "email" ? { ultimo_envio_em: nowISO } : {};
      if (!nextId) {
        await patchState(env, d.id, { status: "concluido", current_step_id: null, tentativas: 0, ...marcaEnvio });
        concluidos++;
      } else {
        const next = await getNode(nextId);
        const atraso = Number((next && next.atraso_horas) || 0);
        await patchState(env, d.id, { current_step_id: nextId, proximo_envio_em: plus(atraso), tentativas: 0, ...marcaEnvio });
      }
    } catch (e) {
      console.log("falha nó lead", d.lead_id, String(e));
      await sb(env, "POST", "/email_events", { lead_id: d.lead_id, tipo: "falha", payload: { erro: String(e).slice(0, 300) } });
      if ((d.tentativas || 0) + 1 >= MAX_TENTATIVAS) await patchState(env, d.id, { status: "pausado" });
      falhas++;
    }
  }
  return { processados: devidos.length, enviados, acoes, concluidos, pulados, falhas };
}

/* aplica/remove tag no lead */
async function aplicaTag(env, leadId, tag, add) {
  if (!tag) return;
  const rows = await sb(env, "GET", `/leads?id=eq.${leadId}&select=tags`);
  let tags = (rows[0] && rows[0].tags) || [];
  if (add) { if (!tags.includes(tag)) tags = tags.concat([tag]); }
  else { tags = tags.filter((t) => t !== tag); }
  await sb(env, "PATCH", `/leads?id=eq.${leadId}`, { tags });
}

/* ---------- Resend ---------- */
async function enviaResend(env, lead, seq, step, leadId) {
  // Formato aceito pelo Resend: "email@dominio" OU "Nome <email@dominio>".
  // Sem nome, usa o e-mail puro (nunca "<email>", que o Resend rejeita).
  const from = seq.from_email
    ? (seq.from_nome ? `${seq.from_nome} <${seq.from_email}>` : seq.from_email)
    : env.RESEND_FROM;
  if (!from) throw new Error("sem remetente (RESEND_FROM ou funil.from_email)");
  // usa o e-mail normalizado (válido) e valida antes de chamar o Resend
  const to = String(lead.email_normalizado || lead.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) throw new Error("e-mail invalido: " + to);
  const unsub = `${env.PUBLIC_BASE || ""}/api/unsub?l=${encodeURIComponent(leadId)}`;
  const html = montarHtml(step.corpo_html || "", lead, unsub);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: [to], subject: subjEval(step.assunto || "", lead), html,
      headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    }),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`resend ${res.status} ${txt}`);
  try { return JSON.parse(txt).id || null; } catch { return null; }
}

function subjEval(s, lead) { return s.replace(/\{\{\s*nome\s*\}\}/gi, (lead.nome || "").split(" ")[0] || ""); }
function montarHtml(corpo, lead, unsub) {
  const nome = (lead.nome || "").split(" ")[0] || "";
  const body = corpo.replace(/\{\{\s*nome\s*\}\}/gi, nome);
  return `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff;padding:28px 26px;color:#1c2530;line-height:1.6;font-size:15px">
    ${body}
    <hr style="border:none;border-top:1px solid #e5e9ec;margin:24px 0 12px">
    <p style="font-size:12px;color:#8a97a0">Você recebe este e-mail porque se cadastrou em uma de nossas ações.
      <a href="${unsub}" style="color:#8a97a0">Descadastrar</a>.</p>
  </div></body></html>`;
}

/* ---------- Supabase ---------- */
function plus(horas) { return new Date(Date.now() + horas * 3600 * 1000).toISOString(); }
async function patchState(env, id, patch) {
  return sb(env, "PATCH", `/lead_sequence_state?id=eq.${id}`, patch);
}
async function sb(env, method, path, payload, prefer) {
  const headers = {
    "apikey": env.SUPABASE_SERVICE_KEY,
    "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers["Prefer"] = prefer;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method, headers, body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`supabase ${method} ${path} -> ${res.status} ${t}`);
  return t ? JSON.parse(t) : [];
}
function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } }); }

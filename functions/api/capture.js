/**
 * CRM Ana — Pages Function: POST /api/capture  (Fase 2)
 * ---------------------------------------------------------------------
 * Recebe os leads do widget de captura e:
 *   1. grava o envio bruto em form_submissions
 *   2. cria/atualiza o lead (find-or-create por e-mail, depois telefone)
 *   3. enriquece UF/região/cidade pelo DDD (tabela ddd_geo)
 *   4. registra o consentimento em consent_events (trilha LGPD)
 *   5. sincroniza o contato no Resend (Audience)
 *
 * Variáveis/segredos (Cloudflare Pages → Settings → Environment variables):
 *   SUPABASE_URL          ex: https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY  service_role key do Supabase   (Secret)
 *   RESEND_API_KEY        chave da API do Resend          (Secret)
 *   RESEND_AUDIENCE_ID    id da Audience no Resend
 *   ALLOWED_ORIGINS       opcional, domínios separados por vírgula (vazio = "*")
 * ---------------------------------------------------------------------
 */

// Preflight CORS
export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request, context.env) });
}

// Captura
export async function onRequestPost(context) {
  const { request, env } = context;
  const cors = corsHeaders(request, env);
  try {
    return await handleCapture(request, env, cors);
  } catch (err) {
    console.log("ERRO /api/capture:", err && err.stack ? err.stack : String(err));
    // Responde 200 "ok:false" para o widget não travar; o erro fica no log.
    return json({ ok: false, error: "internal" }, 200, cors);
  }
}

/* =====================================================================
 * Handler principal
 * ===================================================================== */
async function handleCapture(request, env, cors) {
  const body = await readBody(request);

  // Honeypot anti-spam
  if (body._gotcha) return json({ ok: true, skipped: true }, 200, cors);

  const nome = clean(body.nome || body.name);
  const emailRaw = clean(body.email);
  const email_normalizado = normEmail(emailRaw);
  const phone = parsePhone(body.telefone || body.phone || body.whatsapp);
  const formSlug = clean(body.form || body.form_slug);
  const pageSlug = clean(body.page);
  const optInEmail = truthy(body.opt_in_email ?? body.optin ?? body.consent);
  const textoOptin = clean(body.texto_optin);
  const obs = clean(body.obs || body.observacao || body.assunto);
  const originUrl = clean(body.origem_url) || request.headers.get("referer") || "";

  if (!email_normalizado && !phone.e164) {
    return json({ ok: false, error: "sem_email_ou_telefone" }, 200, cors);
  }

  const ip = request.headers.get("cf-connecting-ip") || null;
  const ua = request.headers.get("user-agent") || null;

  // 0) resolve o formulário/origem (ou a página de captura)
  let form = null;
  if (formSlug) {
    const rows = await sb(env, "GET",
      `/capture_forms?slug=eq.${encodeURIComponent(formSlug)}&select=id,origem_id,texto_optin,redirect_url&limit=1`);
    form = rows[0] || null;
  }
  let page = null;
  if (pageSlug) {
    const rows = await sb(env, "GET",
      `/landing_pages?slug=eq.${encodeURIComponent(pageSlug)}&select=id,origem_id,tag,sequence_id&limit=1`);
    page = rows[0] || null;
  }

  // 1) envio bruto
  const submission = (await sb(env, "POST", "/form_submissions", {
    form_id: form ? form.id : null,
    payload_json: body,
    ip, user_agent: ua, processado: false,
  }, "return=representation"))[0];

  // 2) enriquecimento por DDD
  let geo = { uf: null, regiao: null, cidade_estimada: null };
  if (phone.ddd) {
    const g = await sb(env, "GET",
      `/ddd_geo?ddd=eq.${phone.ddd}&select=uf,regiao,cidade_principal&limit=1`);
    if (g[0]) geo = { uf: g[0].uf, regiao: g[0].regiao, cidade_estimada: g[0].cidade_principal };
  }

  // 3) find-or-create do lead
  let lead = await findLead(env, email_normalizado, phone.e164);
  const now = new Date().toISOString();

  const leadData = {
    nome: nome || (lead && lead.nome) || null,
    email: emailRaw || (lead && lead.email) || null,
    email_normalizado: email_normalizado || (lead && lead.email_normalizado) || null,
    telefone_e164: phone.e164 || (lead && lead.telefone_e164) || null,
    ddd: phone.ddd || (lead && lead.ddd) || null,
    uf: geo.uf || (lead && lead.uf) || null,
    regiao: geo.regiao || (lead && lead.regiao) || null,
    cidade_estimada: geo.cidade_estimada || (lead && lead.cidade_estimada) || null,
    origem_id: (page && page.origem_id) || (form && form.origem_id) || (lead && lead.origem_id) || null,
    opt_in_email: optInEmail || (lead && lead.opt_in_email) || false,
    ultima_interacao_em: now,
  };
  // tag da página de captura
  if (page && page.tag) {
    leadData.tags = Array.from(new Set(((lead && lead.tags) || []).concat([page.tag])));
  }
  // observação (ex.: assunto do Gabinete) — acumula histórico
  if (obs) {
    leadData.observacao = (lead && lead.observacao) ? `${lead.observacao} | ${obs}` : obs;
  }

  if (lead) {
    lead = (await sb(env, "PATCH", `/leads?id=eq.${lead.id}`, leadData, "return=representation"))[0];
  } else {
    leadData.primeira_captura_em = now;
    lead = (await sb(env, "POST", "/leads", leadData, "return=representation"))[0];
  }

  // 4) trilha de consentimento
  if (optInEmail) {
    await sb(env, "POST", "/consent_events", {
      lead_id: lead.id,
      tipo: "opt_in",
      canal: "email",
      base_legal: "consentimento",
      texto_consentimento: textoOptin || (form && form.texto_optin) || null,
      origem_url: originUrl,
      ip, user_agent: ua,
    });
  }

  // marca submission processado
  await sb(env, "PATCH", `/form_submissions?id=eq.${submission.id}`,
    { processado: true, lead_id: lead.id });

  // 4b) auto-enroll: se a origem tem um funil ligado, inscreve o lead
  if (optInEmail && lead.origem_id) {
    try {
      const org = await sb(env, "GET",
        `/origens?id=eq.${lead.origem_id}&select=auto_sequence_id&limit=1`);
      const seqId = org[0] && org[0].auto_sequence_id;
      if (seqId) await sb(env, "POST", "/rpc/enroll_lead", { p_lead: lead.id, p_sequence: seqId });
    } catch (e) { console.log("auto-enroll falhou:", String(e)); }
  }
  // 4c) funil da página de captura
  if (optInEmail && page && page.sequence_id) {
    try { await sb(env, "POST", "/rpc/enroll_lead", { p_lead: lead.id, p_sequence: page.sequence_id }); }
    catch (e) { console.log("enroll da página falhou:", String(e)); }
  }

  // 5) Resend (não bloqueia a resposta)
  let resend = { synced: false };
  if (optInEmail && email_normalizado && env.RESEND_API_KEY && env.RESEND_AUDIENCE_ID) {
    try {
      const contactId = await resendUpsertContact(env, emailRaw, nome, lead.unsubscribed_email);
      if (contactId && contactId !== lead.resend_contact_id) {
        await sb(env, "PATCH", `/leads?id=eq.${lead.id}`, { resend_contact_id: contactId });
      }
      resend = { synced: true };
    } catch (e) {
      console.log("Resend sync falhou:", String(e));
    }
  }

  const redirect = (page ? `/obrigado/${encodeURIComponent(pageSlug)}` : null)
    || (form && form.redirect_url) || clean(body.redirect) || null;
  return json({ ok: true, lead_id: lead.id, uf: geo.uf, resend, redirect }, 200, cors);
}

/* =====================================================================
 * Supabase (PostgREST)
 * ===================================================================== */
async function sb(env, method, path, payload, prefer) {
  const headers = {
    "apikey": env.SUPABASE_SERVICE_KEY,
    "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers["Prefer"] = prefer;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method, headers,
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase ${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : [];
}

async function findLead(env, emailNorm, e164) {
  if (emailNorm) {
    const r = await sb(env, "GET",
      `/leads?email_normalizado=eq.${encodeURIComponent(emailNorm)}&select=*&limit=1`);
    if (r[0]) return r[0];
  }
  if (e164) {
    const r = await sb(env, "GET",
      `/leads?telefone_e164=eq.${encodeURIComponent(e164)}&select=*&limit=1`);
    if (r[0]) return r[0];
  }
  return null;
}

/* =====================================================================
 * Resend — cria/atualiza contato na Audience
 * ===================================================================== */
async function resendUpsertContact(env, email, nome, unsubscribed) {
  const [first, ...rest] = (nome || "").trim().split(/\s+/);
  const res = await fetch(`https://api.resend.com/audiences/${env.RESEND_AUDIENCE_ID}/contacts`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      first_name: first || undefined,
      last_name: rest.join(" ") || undefined,
      unsubscribed: !!unsubscribed,
    }),
  });
  const text = await res.text();
  if (!res.ok && res.status !== 409) throw new Error(`resend ${res.status} ${text}`);
  try { return JSON.parse(text).id || null; } catch { return null; }
}

/* =====================================================================
 * Utilidades
 * ===================================================================== */
function clean(v) {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}
function normEmail(v) {
  const e = clean(v).toLowerCase();
  return e && e.includes("@") ? e : "";
}
function truthy(v) {
  if (v === true) return true;
  const s = clean(v).toLowerCase();
  return s === "true" || s === "1" || s === "on" || s === "sim" || s === "yes";
}

/** Normaliza telefone BR para E.164 (+55DDDNUMERO) e extrai o DDD. */
function parsePhone(raw) {
  let d = clean(raw).replace(/\D/g, "");
  if (!d) return { e164: null, ddd: null };
  if (d.startsWith("0055")) d = d.slice(2);
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return { e164: null, ddd: null };
  const ddd = d.slice(0, 2);
  const numero = d.slice(2);
  return { e164: `+55${ddd}${numero}`, ddd };
}

async function readBody(request) {
  const ct = (request.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) return await request.json();
  const form = await request.formData();
  const obj = {};
  for (const [k, v] of form.entries()) obj[k] = v;
  return obj;
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin") || "";
  const allow = clean(env && env.ALLOWED_ORIGINS);
  let allowOrigin = "*";
  if (allow) {
    const list = allow.split(",").map((s) => s.trim());
    allowOrigin = list.includes(origin) ? origin : list[0];
  }
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(obj, status, extra) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...(extra || {}) },
  });
}

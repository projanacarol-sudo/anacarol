/**
 * Relatório de eventos por e-mail (dashboard HTML).
 * POST /api/relatorio-eventos
 *
 * Dois modos de autorização:
 *  A) Cron (pg_cron): header  x-engine-key == env.ENGINE_KEY
 *     -> envia o relatório de TODAS as páginas com relatorio_ativo=true.
 *  B) Painel (admin logado): header Authorization: Bearer <token> válido
 *     -> body { page_id }  envia SÓ daquela página, na hora (botão "Enviar agora").
 *
 * Variáveis: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY,
 *            RESEND_API_KEY, RESEND_FROM, ENGINE_KEY, PUBLIC_BASE (opcional)
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const engineOk = (request.headers.get("x-engine-key") || "") === (env.ENGINE_KEY || "\0");
    let adminOk = false;
    if (!engineOk) {
      const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      if (token) {
        const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
          headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token } });
        adminOk = who.ok;
      }
    }
    if (!engineOk && !adminOk) return json({ ok: false, error: "unauthorized" }, 401);

    let body = {}; try { body = await request.json(); } catch {}
    let paginas;
    if (adminOk && body.page_id) {
      paginas = await sb(env, "GET",
        `/landing_pages?id=eq.${encodeURIComponent(body.page_id)}&select=*&limit=1`);
    } else {
      paginas = await sb(env, "GET",
        `/landing_pages?relatorio_ativo=eq.true&relatorio_email=not.is.null&select=*`);
    }

    const base = (env.PUBLIC_BASE || new URL(request.url).origin).replace(/\/$/, "");
    let enviados = 0; const detalhes = [];
    for (const p of (paginas || [])) {
      const dest = (p.relatorio_email || "").trim();
      if (!dest) { detalhes.push({ slug: p.slug, skip: "sem_email" }); continue; }
      const dados = await coletar(env, p);
      const htmlEmail = montarDashboard(p, dados, base);
      const ok = await enviarEmail(env, dest, `📊 Relatório do evento: ${p.headline || p.slug}`, htmlEmail);
      if (ok) enviados++;
      detalhes.push({ slug: p.slug, to: dest, enviado: ok, inscritos: dados.confirmados });
    }
    return json({ ok: true, enviados, detalhes }, 200);
  } catch (e) {
    console.log("ERRO relatorio-eventos:", e && e.stack ? e.stack : String(e));
    return json({ ok: false, error: "internal" }, 200);
  }
}

/* ---------- coleta e agregações ---------- */
async function coletar(env, p) {
  const rows = await sb(env, "GET",
    `/inscricoes?page_id=eq.${p.id}&select=status,created_at,leads(nome,email,telefone_e164,uf,cidade_estimada,ddd)` +
    `&order=created_at.desc&limit=5000`);
  const confirmados = rows.filter(r => r.status === "confirmado").length;
  const espera = rows.filter(r => r.status === "espera").length;
  const limite = p.limite_vagas || 0;
  const vagas = limite > 0 ? Math.max(limite - confirmados, 0) : null;
  const ocup = limite > 0 ? Math.round((confirmados / limite) * 100) : null;

  // timeline por dia (BRT) — só confirmados contam como inscritos "válidos"? mostramos todos
  const porDia = {};
  for (const r of rows) {
    const d = diaBRT(r.created_at);
    porDia[d] = (porDia[d] || 0) + 1;
  }
  const dias = Object.keys(porDia).sort(); // asc
  const timeline = dias.map(d => ({ dia: d, n: porDia[d] }));

  // por UF e por cidade
  const porUF = {}, porCidade = {};
  for (const r of rows) {
    const l = r.leads || {};
    const uf = (l.uf || "—").toUpperCase();
    porUF[uf] = (porUF[uf] || 0) + 1;
    const c = l.cidade_estimada || "—";
    porCidade[c] = (porCidade[c] || 0) + 1;
  }
  const topUF = Object.entries(porUF).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topCidade = Object.entries(porCidade).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const ultimos = rows.slice(0, 15).map(r => ({ ...r.leads, status: r.status, quando: r.created_at }));

  return { total: rows.length, confirmados, espera, limite, vagas, ocup, timeline, topUF, topCidade, ultimos };
}

/* ---------- HTML do dashboard ---------- */
function montarDashboard(p, d, base) {
  const cor = p.cor || "#128C7E";
  const link = `${base}/p/${encodeURIComponent(p.slug)}`;
  const maxTL = Math.max(1, ...d.timeline.map(t => t.n));
  const barras = d.timeline.length
    ? d.timeline.map(t => {
        const w = Math.round((t.n / maxTL) * 100);
        return `<tr>
          <td style="padding:4px 8px;font-size:12px;color:#54636d;white-space:nowrap">${esc(t.dia)}</td>
          <td style="padding:4px 8px;width:100%">
            <div style="background:${cor};height:14px;width:${w}%;min-width:6px;border-radius:4px;display:inline-block;vertical-align:middle"></div>
            <span style="font-size:12px;color:#41505a;font-weight:700;margin-left:6px">${t.n}</span>
          </td></tr>`;
      }).join("")
    : `<tr><td style="padding:8px;color:#8a97a0;font-size:13px">Sem inscritos ainda.</td></tr>`;

  const listaMini = (arr) => arr.length
    ? arr.map(([k, v]) => `<tr>
        <td style="padding:5px 8px;font-size:13px;color:#28323a">${esc(k)}</td>
        <td style="padding:5px 8px;font-size:13px;color:#41505a;font-weight:700;text-align:right">${v}</td></tr>`).join("")
    : `<tr><td style="padding:8px;color:#8a97a0;font-size:13px">—</td></tr>`;

  const linhasUlt = d.ultimos.length
    ? d.ultimos.map(u => `<tr>
        <td style="padding:7px 8px;font-size:12.5px;border-top:1px solid #eef2f4">${esc(u.nome || "—")}</td>
        <td style="padding:7px 8px;font-size:12px;color:#54636d;border-top:1px solid #eef2f4">${esc(u.email || u.telefone_e164 || "—")}</td>
        <td style="padding:7px 8px;font-size:12px;color:#54636d;border-top:1px solid #eef2f4">${esc([u.cidade_estimada, u.uf].filter(Boolean).join("/") || "—")}</td>
        <td style="padding:7px 8px;font-size:12px;border-top:1px solid #eef2f4">${u.status === "espera"
          ? '<span style="background:#fff3d6;color:#8a5a00;font-size:10px;font-weight:800;padding:2px 7px;border-radius:99px">ESPERA</span>'
          : '<span style="background:#e6f7ee;color:#1c8a4e;font-size:10px;font-weight:800;padding:2px 7px;border-radius:99px">OK</span>'}</td>
        <td style="padding:7px 8px;font-size:11.5px;color:#8a97a0;border-top:1px solid #eef2f4;white-space:nowrap">${esc(dataHoraBRT(u.quando))}</td>
      </tr>`).join("")
    : `<tr><td colspan="5" style="padding:10px;color:#8a97a0;font-size:13px">Sem inscritos ainda.</td></tr>`;

  const card = (rotulo, valor, sub, bg, fg) => `
    <td style="padding:6px">
      <div style="background:${bg};border-radius:12px;padding:14px 14px 12px">
        <div style="font-size:11px;font-weight:800;letter-spacing:.4px;color:${fg};opacity:.85;text-transform:uppercase">${rotulo}</div>
        <div style="font-size:26px;font-weight:800;color:${fg};line-height:1.15;margin-top:2px">${valor}</div>
        ${sub ? `<div style="font-size:11.5px;color:${fg};opacity:.8;margin-top:1px">${sub}</div>` : ""}
      </div></td>`;

  const vagasTxt = d.limite > 0 ? `${d.vagas}` : "∞";
  const vagasSub = d.limite > 0 ? `de ${d.limite} vagas` : "sem limite";
  const ocupTxt = d.limite > 0 ? `${d.ocup}%` : "—";

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#eef2f4;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#14202a">
  <div style="max-width:640px;margin:0 auto;padding:20px 14px 40px">
    <div style="background:${cor};border-radius:16px 16px 0 0;padding:20px 22px;color:#fff">
      <div style="font-size:12px;font-weight:800;letter-spacing:.5px;opacity:.9;text-transform:uppercase">Relatório do evento</div>
      <div style="font-size:20px;font-weight:800;margin-top:3px">${esc(p.headline || p.slug)}</div>
      <div style="font-size:12.5px;opacity:.92;margin-top:4px">${esc([p.data_txt, p.local].filter(Boolean).join(" · "))}</div>
      <div style="font-size:11.5px;opacity:.85;margin-top:8px">Gerado em ${esc(dataHoraBRT(new Date().toISOString()))} (horário de Brasília)</div>
    </div>
    <div style="background:#fff;border-radius:0 0 16px 16px;padding:12px 12px 8px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        ${card("Inscritos", d.confirmados, "confirmados", "#e9f6f2", "#0d6b60")}
        ${card("Vagas livres", vagasTxt, vagasSub, "#eef4ff", "#2452a8")}
      </tr><tr>
        ${card("Lista de espera", d.espera, "aguardando vaga", "#fff6e6", "#8a5a00")}
        ${card("Ocupação", ocupTxt, d.limite > 0 ? "das vagas" : "sem limite", "#f3eefb", "#5b3aa8")}
      </tr></table>

      <div style="padding:12px 8px 4px">
        <h3 style="font-size:14px;margin:0 0 8px;color:#28323a">📈 Inscritos por dia</h3>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${barras}</table>
      </div>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="50%" valign="top" style="padding:12px 8px">
          <h3 style="font-size:14px;margin:0 0 6px;color:#28323a">📍 Por estado (UF)</h3>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7fafb;border-radius:10px">${listaMini(d.topUF)}</table>
        </td>
        <td width="50%" valign="top" style="padding:12px 8px">
          <h3 style="font-size:14px;margin:0 0 6px;color:#28323a">🏙️ Por cidade</h3>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7fafb;border-radius:10px">${listaMini(d.topCidade)}</table>
        </td>
      </tr></table>

      <div style="padding:8px 8px 4px">
        <h3 style="font-size:14px;margin:0 0 8px;color:#28323a">👥 Últimos inscritos</h3>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
          <tr style="background:#f2f6f7">
            <th align="left" style="padding:7px 8px;font-size:10.5px;color:#66757e;text-transform:uppercase">Nome</th>
            <th align="left" style="padding:7px 8px;font-size:10.5px;color:#66757e;text-transform:uppercase">Contato</th>
            <th align="left" style="padding:7px 8px;font-size:10.5px;color:#66757e;text-transform:uppercase">Cidade/UF</th>
            <th align="left" style="padding:7px 8px;font-size:10.5px;color:#66757e;text-transform:uppercase">Status</th>
            <th align="left" style="padding:7px 8px;font-size:10.5px;color:#66757e;text-transform:uppercase">Quando</th>
          </tr>
          ${linhasUlt}
        </table>
      </div>

      <div style="padding:14px 8px 10px;text-align:center">
        <a href="${esc(link)}" style="display:inline-block;background:${cor};color:#fff;text-decoration:none;font-weight:800;font-size:13px;padding:11px 20px;border-radius:10px">Ver página do evento</a>
      </div>
    </div>
    <div style="text-align:center;color:#98a4ab;font-size:11px;margin-top:14px;line-height:1.5">
      Relatório automático do CRM — Ana Carolina Oliveira.<br>Você recebe este e-mail porque é o responsável por este evento.
    </div>
  </div></body></html>`;
}

/* ---------- helpers ---------- */
async function enviarEmail(env, to, subject, html) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.RESEND_FROM, to: [to], subject, html }),
    });
    return r.ok;
  } catch (e) { return false; }
}
function diaBRT(iso) {
  try { return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }); }
  catch { return String(iso).slice(0, 10); }
}
function dataHoraBRT(iso) {
  try { return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  catch { return String(iso); }
}
async function sb(env, method, path, payload) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method, headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY, "Content-Type": "application/json" },
    body: payload !== undefined ? JSON.stringify(payload) : undefined });
  const t = await res.text();
  if (!res.ok) throw new Error(`sb ${res.status} ${t}`);
  return t ? JSON.parse(t) : [];
}
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } }); }

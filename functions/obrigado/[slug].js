/**
 * Página de Obrigado: GET /obrigado/{slug}
 * Agradece e redireciona para o grupo de WhatsApp da página.
 */
export async function onRequestGet(context) {
  const { env, params, request } = context;
  const espera = new URL(request.url).searchParams.get("espera") === "1";
  let p = null;
  try {
    const rows = await sb(env, `/landing_pages?slug=eq.${encodeURIComponent(params.slug)}&select=headline,grupo_url,cor&limit=1`);
    p = rows[0] || null;
  } catch (e) {}
  const cor = (p && p.cor) || "#128C7E";
  const grupo = p && p.grupo_url ? p.grupo_url : "";
  // na lista de espera NÃO redireciona automático — a pessoa lê o aviso com calma
  const redirect = (!espera && grupo)
    ? `<meta http-equiv="refresh" content="2; url=${attr(grupo)}"><script>setTimeout(function(){location.href=${JSON.stringify(grupo)};},1800);</script>`
    : "";
  const miolo = espera
    ? `<div class="ic">📝</div>
       <h1 style="font-size:22px;margin:10px 0 0">Você entrou na lista de espera</h1>
       <p>As vagas deste evento se esgotaram, mas guardamos o seu lugar na fila. <b>Se abrir uma vaga</b> (alguém desistir) ou surgir um <b>próximo evento</b>, você é avisado primeiro por e-mail e WhatsApp.</p>
       ${grupo ? `<a class="btn" href="${attr(grupo)}">Entrar no grupo do WhatsApp</a>` : ""}`
    : `<div class="ic">✅</div>
       <h1 style="font-size:22px;margin:10px 0 0">Inscrição confirmada!</h1>
       ${grupo
         ? `<p>Estamos te levando para o grupo de WhatsApp…</p><a class="btn" href="${attr(grupo)}">Entrar no grupo agora</a>`
         : `<p>Obrigado! Em breve você recebe as próximas informações por e-mail.</p>`}`;
  const body = `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1"><title>${espera ? "Lista de espera" : "Inscrição confirmada"}</title>${redirect}
  <style>body{font-family:system-ui,Arial,sans-serif;background:#eef2f4;color:#14202a;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px}
  .card{background:#fff;border-radius:18px;padding:34px;max-width:440px;text-align:center;box-shadow:0 8px 30px #0000000f}
  .ic{font-size:44px}.btn{display:inline-block;margin-top:18px;background:${cor};color:#fff;text-decoration:none;font-weight:800;padding:14px 22px;border-radius:12px}
  p{color:#54636d;font-size:15px;margin-top:8px;line-height:1.5}</style></head>
  <body><div class="card">${miolo}</div></body></html>`;
  return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function sb(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    headers: { "apikey": env.SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}` } });
  if (!res.ok) throw new Error("supabase " + res.status);
  return res.json();
}
function attr(s){return String(s==null?"":s).replace(/"/g,"&quot;");}

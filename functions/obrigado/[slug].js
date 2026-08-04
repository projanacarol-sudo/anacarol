/**
 * Página de Obrigado: GET /obrigado/{slug}
 * Agradece e redireciona para o grupo de WhatsApp da página.
 */
export async function onRequestGet(context) {
  const { env, params } = context;
  let p = null;
  try {
    const rows = await sb(env, `/landing_pages?slug=eq.${encodeURIComponent(params.slug)}&select=headline,grupo_url,cor&limit=1`);
    p = rows[0] || null;
  } catch (e) {}
  const cor = (p && p.cor) || "#128C7E";
  const grupo = p && p.grupo_url ? p.grupo_url : "";
  const redirect = grupo
    ? `<meta http-equiv="refresh" content="2; url=${attr(grupo)}"><script>setTimeout(function(){location.href=${JSON.stringify(grupo)};},1800);</script>`
    : "";
  const body = `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1"><title>Inscrição confirmada</title>${redirect}
  <style>body{font-family:system-ui,Arial,sans-serif;background:#eef2f4;color:#14202a;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px}
  .card{background:#fff;border-radius:18px;padding:34px;max-width:440px;text-align:center;box-shadow:0 8px 30px #0000000f}
  .ic{font-size:44px}.btn{display:inline-block;margin-top:18px;background:${cor};color:#fff;text-decoration:none;font-weight:800;padding:14px 22px;border-radius:12px}
  p{color:#54636d;font-size:15px;margin-top:8px}</style></head>
  <body><div class="card">
    <div class="ic">✅</div>
    <h1 style="font-size:22px;margin:10px 0 0">Inscrição confirmada!</h1>
    ${grupo
      ? `<p>Estamos te levando para o grupo de WhatsApp…</p><a class="btn" href="${attr(grupo)}">Entrar no grupo agora</a>`
      : `<p>Obrigado! Em breve você recebe as próximas informações por e-mail.</p>`}
  </div></body></html>`;
  return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function sb(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    headers: { "apikey": env.SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}` } });
  if (!res.ok) throw new Error("supabase " + res.status);
  return res.json();
}
function attr(s){return String(s==null?"":s).replace(/"/g,"&quot;");}

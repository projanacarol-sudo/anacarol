/**
 * GET /grupo  → redireciona pro grupo de WhatsApp da campanha.
 * Assim o link que aparece no e-mail é do NOSSO domínio (bate com o domínio
 * de envio), em vez de um encurtador externo — melhor pra deliverability.
 * Configure a var GRUPO_URL no Pages; senão cai no link padrão.
 */
export async function onRequestGet({ request, env }) {
  const PADRAO = "https://sndflw.com/i/CL0nKFrUVqsol11qTefA";
  const self = new URL(request.url);
  let to = env.GRUPO_URL || PADRAO;
  // trava anti-loop: se GRUPO_URL apontar de volta pro próprio /grupo, ignora
  try {
    const t = new URL(to, self.origin);
    if (t.host === self.host && /\/grupo\/?$/i.test(t.pathname)) to = PADRAO;
  } catch (e) { to = PADRAO; }
  return new Response(null, { status: 302, headers: { Location: to, "Cache-Control": "no-store" } });
}

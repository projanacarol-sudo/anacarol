/**
 * GET /grupo  → redireciona pro grupo de WhatsApp da campanha.
 * Assim o link que aparece no e-mail é do NOSSO domínio (bate com o domínio
 * de envio), em vez de um encurtador externo — melhor pra deliverability.
 * Configure a var GRUPO_URL no Pages; senão cai no link padrão.
 */
export async function onRequestGet({ env }) {
  const to = env.GRUPO_URL || "https://sndflw.com/i/CL0nKFrUVqsol11qTefA";
  return new Response(null, { status: 302, headers: { Location: to, "Cache-Control": "no-store" } });
}

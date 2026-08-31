/** GET /api/push/vapid — devolve a chave pública VAPID para o cliente assinar. */
export async function onRequestGet({ env }) {
  return new Response(JSON.stringify({ publicKey: env.VAPID_PUBLIC || "" }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

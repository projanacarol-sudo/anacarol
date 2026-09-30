/**
 * GET /api/config
 * Entrega ao painel (estático) apenas a configuração PÚBLICA do Supabase,
 * lida das variáveis do Pages. NUNCA retorna a service_role.
 *
 * Variáveis necessárias no Pages:
 *   SUPABASE_URL        (a mesma usada pela captura)
 *   SUPABASE_ANON_KEY   (a chave "anon public" — pública por design)
 */
export async function onRequestGet(context) {
  const { env } = context;
  const url = env.SUPABASE_URL || null;
  const anonKey = env.SUPABASE_ANON_KEY || null;

  const body = {
    ok: !!(url && anonKey),
    url,
    anonKey,
  };
  if (!body.ok) {
    body.error = "Faltam SUPABASE_URL e/ou SUPABASE_ANON_KEY nas variáveis do Pages.";
  }

  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
      // sem cache: se você trocar a chave, o painel pega na hora
      "Cache-Control": "no-store",
    },
  });
}

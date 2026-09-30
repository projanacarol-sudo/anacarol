/**
 * GET /api/config  (Pages da BIO)
 * Entrega só a configuração PÚBLICA do Supabase (url + anon key), lida das
 * variáveis do Pages. NUNCA retorna a service_role.
 *
 * Defina no projeto Pages da BIO (Settings > Environment variables):
 *   SUPABASE_URL        (a mesma do CRM)
 *   SUPABASE_ANON_KEY   (a chave "anon public" — pública por design)
 */
export async function onRequestGet(context) {
  const { env } = context;
  const url = env.SUPABASE_URL || null;
  const anonKey = env.SUPABASE_ANON_KEY || null;
  const body = { ok: !!(url && anonKey), url, anonKey };
  if (!body.ok) body.error = "Faltam SUPABASE_URL e/ou SUPABASE_ANON_KEY nas variáveis do Pages da bio.";
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * GET /api/materiais-config   (público)
 * Diz ao quiz (/apoiar.html) se o cadastro de materiais IMPRESSOS está ligado.
 * Quando desligado, o quiz funciona normalmente mas só entrega Kit Digital.
 *
 * Lê a chave "materiais_impressos_ativo" da tabela config_app.
 * Variáveis: SUPABASE_URL, SUPABASE_SERVICE_KEY (ou SUPABASE_ANON_KEY).
 */
export async function onRequestGet({ env }) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY;
  let impressos_ativo = true; // padrão seguro: ligado
  try {
    if (url && key) {
      const r = await fetch(
        `${url}/rest/v1/config_app?chave=eq.materiais_impressos_ativo&select=valor`,
        { headers: { apikey: key, Authorization: "Bearer " + key } }
      );
      if (r.ok) {
        const rows = await r.json();
        const v = rows && rows[0] ? rows[0].valor : null;
        // valor é jsonb (true/false). Só é false quando explicitamente false.
        if (v === false || v === "false") impressos_ativo = false;
        else if (v === true || v === "true") impressos_ativo = true;
      }
    }
  } catch (e) {}
  return new Response(JSON.stringify({ ok: true, impressos_ativo }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store",
               "Access-Control-Allow-Origin": "*" },
  });
}

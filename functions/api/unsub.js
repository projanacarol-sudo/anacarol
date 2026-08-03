/**
 * CRM Ana — Descadastro: /api/unsub?l=<lead_id>
 * GET  -> marca o lead como descadastrado e mostra confirmação.
 * POST -> one-click (List-Unsubscribe-Post) do cliente de e-mail.
 * Variáveis: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
export async function onRequestGet(context) { return unsub(context, true); }
export async function onRequestPost(context) { return unsub(context, false); }

async function unsub(context, html) {
  const { request, env } = context;
  const id = new URL(request.url).searchParams.get("l");
  if (!id) return page("Link inválido.", html);
  try {
    await sb(env, "PATCH", `/leads?id=eq.${encodeURIComponent(id)}`,
      { unsubscribed_email: true, opt_in_email: false });
    await sb(env, "PATCH", `/lead_sequence_state?lead_id=eq.${encodeURIComponent(id)}&status=eq.ativo`,
      { status: "pausado" });
    await sb(env, "POST", "/consent_events", {
      lead_id: id, tipo: "opt_out", canal: "email", base_legal: "revogacao",
      texto_consentimento: "Descadastro via link de e-mail",
    });
  } catch (e) { console.log("unsub erro", String(e)); }
  return page("Pronto! Você foi descadastrado(a) e não receberá mais e-mails.", html);
}

function page(msg, html) {
  if (!html) return new Response("ok", { status: 200 });
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width, initial-scale=1">
     <title>Descadastro</title></head>
     <body style="margin:0;font-family:system-ui,Arial,sans-serif;background:#f4f6f8;color:#1c2530;
       display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px">
       <div style="background:#fff;border-radius:16px;padding:34px;max-width:420px;text-align:center;box-shadow:0 8px 30px #0000000f">
         <div style="font-size:38px">✅</div>
         <h1 style="font-size:20px;margin:10px 0 6px">${msg}</h1>
         <p style="color:#66757e;font-size:14px;margin:0">Você pode fechar esta página.</p>
       </div></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function sb(env, method, path, payload) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method, headers: {
      "apikey": env.SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    }, body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  if (!res.ok) throw new Error(`supabase ${res.status} ${await res.text()}`);
  return res.text();
}

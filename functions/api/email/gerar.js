/**
 * POST /api/email/gerar   { id, legenda }   (protegido)
 * Reescreve a legenda como informativo de e-mail via Workers AI e salva.
 *
 * Binding: AI (Workers AI)  |  Vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY
 * Modelo recomendado (lição do William): @cf/meta/llama-3.3-70b-instruct-fp8-fast
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!(await requireAuth(request, env))) return json({ erro: "nao_autorizado" }, 401);
  if (!env.AI) return json({ erro: "IA não ativada (binding AI)" }, 200);

  let body = {}; try { body = await request.json(); } catch (e) {}
  const legenda = (body.legenda || "").trim();
  const postId = body.id || null;
  if (!legenda) return json({ erro: "sem legenda" }, 200);

  let saida = "";
  try {
    const r = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [{ role: "user", content: montarPrompt(legenda) }],
      max_tokens: 800,
    });
    saida = lerRespostaIA(r);
  } catch (e) { return json({ erro: "falha na IA", detalhe: e.message }, 200); }

  let obj = null;
  try {
    const ini = saida.indexOf("{"), fim = saida.lastIndexOf("}");
    if (ini >= 0 && fim > ini) obj = JSON.parse(saida.slice(ini, fim + 1));
  } catch (e) {}
  if (!obj) return json({ bruto: true, cru: saida }, 200);

  if (postId) {
    try {
      await fetch(`${env.SUPABASE_URL}/rest/v1/ig_email_posts?id=eq.${encodeURIComponent(postId)}`, {
        method: "PATCH",
        headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ assunto: obj.assunto || "", preview: obj.preview || "", texto: obj.texto || "", prompt_imagem: obj.prompt_imagem || "" }),
      });
    } catch (e) {}
  }
  return json(obj, 200);
}

function montarPrompt(legenda) {
  return `Você é redator do informativo por e-mail da Ana Carolina Oliveira, candidata a Deputada Federal por SP (Podemos), que defende causas como proteção de crianças, mulheres e pessoas vulneráveis. A partir da legenda de um post do Instagram dela, escreva um trecho de newsletter INFORMATIVA para os apoiadores acompanharem o dia a dia dela.

REGRAS OBRIGATÓRIAS:
- Escreva na VOZ DELA, em 1ª pessoa ("Estive...", "Quero contar...").
- Tom informativo e acolhedor, fiel ao que ela publicou. NÃO invente fatos.
- Texto enxuto e agradável de ler (2 a 4 frases curtas).
- Português impecável do Brasil.

Responda SOMENTE com um objeto JSON válido, começando com { e terminando com }. Não escreva NADA antes nem depois. Não use crases nem a palavra json.

Formato EXATO (preencha os valores, mantenha as chaves):
{"assunto":"texto aqui","preview":"texto aqui","texto":"texto aqui","prompt_imagem":"texto aqui"}

Significado de cada chave:
- assunto: assunto do e-mail, curto e chamativo, sem clickbait (máx 8 palavras)
- preview: linha de pré-visualização do e-mail (máx 12 palavras)
- texto: o trecho informativo na voz dela em 1ª pessoa (2 a 4 frases curtas)
- prompt_imagem: prompt em português para gerar uma imagem realista da Ana sobre o tema

LEGENDA DO POST:
"""${(legenda || "").slice(0, 1500)}"""`;
}

function lerRespostaIA(r) {
  if (r == null) return "";
  if (typeof r === "string") return r;
  let v = null;
  if (typeof r.response !== "undefined") v = r.response;
  else if (r.choices && r.choices[0] && r.choices[0].message) {
    const m = r.choices[0].message; v = m.content || m.reasoning_content || m.reasoning || "";
  } else if (typeof r.result === "string") v = r.result;
  else if (r.result && typeof r.result.response !== "undefined") v = r.result.response;
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(x => (typeof x === "string" ? x : (x && (x.text || x.content)) || "")).join("");
  if (typeof v === "object") return v.text || v.content || JSON.stringify(v);
  return String(v);
}

async function requireAuth(request, env) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  try { const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token } }); return r.ok; } catch (e) { return false; }
}
function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } }); }

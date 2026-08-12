/**
 * Página de captura pública: GET /p/{slug}
 * Renderiza a landing (banner, headline, descrição, form) a partir de landing_pages.
 * O form posta em /api/capture com o slug da página.
 */
export async function onRequestGet(context) {
  const { env, params } = context;
  const slug = params.slug;
  let p = null;
  try {
    const rows = await sb(env, `/landing_pages?slug=eq.${encodeURIComponent(slug)}&ativo=eq.true&select=*&limit=1`);
    p = rows[0] || null;
  } catch (e) { /* cai no 404 */ }
  if (!p) return html(pagina404(), 404);
  return html(render(p));
}

function render(p) {
  const cor = p.cor || "#128C7E";
  const fundo = p.cor_fundo || "#eef2f4";
  const titulo = p.cor_titulo || "#14202a";
  const banner = p.banner_url
    ? `<img src="${attr(p.banner_url)}" alt="" style="width:100%;aspect-ratio:1200/628;object-fit:cover;border-radius:16px;display:block;margin-bottom:22px">` : "";
  const chips = [p.data_txt, p.local].filter(Boolean)
    .map(t => `<span class="chip">${esc(t)}</span>`).join("");
  return `<!doctype html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.headline || "Inscrição")}</title>
<style>
  :root{--cor:${cor}}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:${fundo};color:#14202a;line-height:1.55}
  .wrap{max-width:560px;margin:0 auto;padding:28px 18px 60px}
  h1{font-size:27px;line-height:1.2;margin-bottom:8px;color:${titulo}}
  .sub{font-size:17px;color:#41505a;margin-bottom:16px}
  .desc{font-size:15px;color:#41505a;margin-bottom:18px;white-space:pre-line}
  .chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}
  .chip{background:#fff;border:1px solid #dfe6e9;border-radius:20px;padding:7px 14px;font-size:13px;font-weight:700;color:var(--cor)}
  form{background:#fff;border-radius:16px;padding:22px;box-shadow:0 6px 24px #0000000d;display:flex;flex-direction:column;gap:12px}
  label{font-size:13px;font-weight:700;color:#41505a;display:flex;flex-direction:column;gap:5px}
  input{padding:12px;border:1px solid #cfd8dd;border-radius:10px;font-size:15px}
  input:focus{outline:none;border-color:var(--cor);box-shadow:0 0 0 3px ${hexA(cor)}}
  .optin{flex-direction:row;align-items:flex-start;gap:9px;font-weight:400;font-size:12.5px;color:#54636d}
  .optin input{margin-top:2px}
  button{margin-top:4px;padding:14px;border:0;border-radius:10px;background:var(--cor);color:#fff;font-size:16px;font-weight:800;cursor:pointer}
  button:disabled{opacity:.6}
  .msg{padding:11px;border-radius:9px;font-size:13.5px;display:none}
  .err{background:#fdecea;color:#b3392f;display:block}
  .hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
</style></head>
<body><div class="wrap">
  ${banner}
  <h1>${esc(p.headline || "")}</h1>
  ${p.subheadline ? `<div class="sub">${esc(p.subheadline)}</div>` : ""}
  <div class="chips">${chips}</div>
  ${p.descricao ? `<div class="desc">${esc(p.descricao)}</div>` : ""}
  <form id="f" novalidate>
    <div class="msg" id="m"></div>
    <label>Nome<input name="nome" type="text" autocomplete="name" required></label>
    <label>E-mail<input name="email" type="email" autocomplete="email" required></label>
    <label>WhatsApp (com DDD)<input name="telefone" type="tel" inputmode="numeric" placeholder="(11) 99999-9999" maxlength="16"></label>
    <label class="optin"><input type="checkbox" name="opt" required> Autorizo receber e-mails e mensagens no WhatsApp e concordo em participar.</label>
    <input class="hp" name="_gotcha" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button type="submit" id="b">Quero participar</button>
  </form>
</div>
<script>
  var f=document.getElementById('f'),m=document.getElementById('m'),b=document.getElementById('b'),tel=f.telefone;
  function mask(v){var d=(v||'').replace(/\\D/g,'').slice(0,11);if(!d)return'';if(d.length<=2)return'('+d;
    if(d.length<=6)return'('+d.slice(0,2)+') '+d.slice(2);
    if(d.length<=10)return'('+d.slice(0,2)+') '+d.slice(2,6)+'-'+d.slice(6);
    return'('+d.slice(0,2)+') '+d.slice(2,7)+'-'+d.slice(7);}
  tel.addEventListener('input',function(){tel.value=mask(tel.value);});
  f.addEventListener('submit',function(e){e.preventDefault();m.style.display='none';
    if(!f.email.value||!f.opt.checked){m.className='msg err';m.textContent='Preencha o e-mail e marque a autorização.';return;}
    b.disabled=true;b.textContent='Enviando...';
    fetch('/api/capture',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({nome:f.nome.value,email:f.email.value,telefone:f.telefone.value,
        opt_in_email:f.opt.checked,page:${json(p.slug)},origem_url:location.href,_gotcha:f._gotcha.value})})
    .then(function(r){return r.json().catch(function(){return{};});})
    .then(function(res){ if(res&&res.ok){ location.href=res.redirect||('/obrigado/'+${json(p.slug)}); }
      else{m.className='msg err';m.textContent='Não foi possível cadastrar agora. Tente de novo.';b.disabled=false;b.textContent='Quero participar';} })
    .catch(function(){m.className='msg err';m.textContent='Erro de conexão.';b.disabled=false;b.textContent='Quero participar';});
  });
</script>
</body></html>`;
}

function pagina404() {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Página não encontrada</title></head>
  <body style="font-family:system-ui,Arial,sans-serif;background:#eef2f4;color:#41505a;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:20px">
  <div><div style="font-size:40px">🔎</div><h1 style="font-size:20px;margin:10px 0">Página não encontrada</h1>
  <p>Esta página de inscrição não existe ou foi desativada.</p></div></body></html>`;
}

/* helpers */
async function sb(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    headers: { "apikey": env.SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}` } });
  if (!res.ok) throw new Error("supabase " + res.status);
  return res.json();
}
function html(body, status) { return new Response(body, { status: status || 200, headers: { "Content-Type": "text/html; charset=utf-8" } }); }
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function attr(s){return String(s==null?"":s).replace(/"/g,"&quot;");}
function json(s){return JSON.stringify(String(s));}
function hexA(hex){return hex+"33";}

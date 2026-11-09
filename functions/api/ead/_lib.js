/**
 * _lib.js — utilidades do EAD (Área de Membros).
 * Autenticação de ALUNO separada do Auth da equipe:
 *  - senha com PBKDF2 (hash + salt)
 *  - token próprio assinado (HMAC-SHA256), validado nos endpoints
 * Variáveis: EAD_SECRET (segredo para assinar o token),
 *            SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uJson = (o) => b64u(enc.encode(JSON.stringify(o)));
function hex(buf){ return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join(""); }
function unhex(h){ const a = new Uint8Array(h.length/2); for(let i=0;i<a.length;i++) a[i]=parseInt(h.substr(i*2,2),16); return a; }

/* ---- senha (PBKDF2) ---- */
export async function hashSenha(senha, saltHex){
  const salt = saltHex ? unhex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name:"PBKDF2", salt, iterations:120000, hash:"SHA-256" }, key, 256);
  return { salt: hex(salt), hash: hex(bits) };
}
export async function conferirSenha(senha, saltHex, hashHex){
  const r = await hashSenha(senha, saltHex);
  return r.hash === hashHex;
}

/* ---- token (JWT HS256 simplificado) ---- */
async function hmac(secret, data){
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, enc.encode(data));
}
export async function assinarToken(payload, secret, dias=30){
  const body = { ...payload, exp: Math.floor(Date.now()/1000) + dias*86400 };
  const head = b64uJson({ alg:"HS256", typ:"JWT" });
  const pay  = b64uJson(body);
  const sig  = b64u(await hmac(secret, head + "." + pay));
  return `${head}.${pay}.${sig}`;
}
export async function verificarToken(token, secret){
  try{
    const [h,p,s] = String(token||"").split(".");
    if(!h||!p||!s) return null;
    const esperado = b64u(await hmac(secret, h + "." + p));
    if(esperado !== s) return null;
    const body = JSON.parse(atob(p.replace(/-/g,"+").replace(/_/g,"/")));
    if(body.exp && body.exp < Math.floor(Date.now()/1000)) return null;
    return body;
  }catch(e){ return null; }
}
/* extrai o aluno do header Authorization */
export async function alunoDaReq(request, env){
  const token = (request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  const body = await verificarToken(token, env.EAD_SECRET || "");
  return body && body.aluno_id ? body : null;
}

/* ---- Supabase REST (service key) ---- */
export async function rest(env, method, path, body, extra){
  const r = await fetch(env.SUPABASE_URL + path, {
    method,
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY, "Content-Type": "application/json", ...(extra||{}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
  return { ok: r.ok, status: r.status, data: j, text: t };
}
export function codigoCert(){
  return "SQG-" + Math.random().toString(36).slice(2,6).toUpperCase() + "-" + Math.random().toString(36).slice(2,6).toUpperCase();
}
export function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"GET,POST,OPTIONS", "Access-Control-Allow-Headers":"content-type,authorization" }; }
export function json(o, s){ return new Response(JSON.stringify(o), { status: s||200, headers: { "Content-Type":"application/json", ...cors() } }); }

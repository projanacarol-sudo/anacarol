/** POST /api/ead/cadastro  {nome,email,whatsapp,senha}  → cria aluno + vincula lead, retorna token */
import { hashSenha, assinarToken, rest, json, cors } from "./_lib.js";
export function onRequestOptions(){ return new Response(null,{status:204,headers:cors()}); }

export async function onRequestPost({ request, env }){
  let b={}; try{ b=await request.json(); }catch{}
  const nome=(b.nome||"").trim(), email=(b.email||"").trim().toLowerCase();
  const whats=(b.whatsapp||"").trim(), senha=(b.senha||"");
  if(!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ok:false,erro:"email_invalido"},400);
  if(senha.length<6) return json({ok:false,erro:"senha_curta"},400);

  // já existe?
  const ex=await rest(env,"GET",`/rest/v1/ead_alunos?email=eq.${encodeURIComponent(email)}&select=id`);
  if(ex.ok && ex.data && ex.data[0]) return json({ok:false,erro:"ja_cadastrado"},409);

  // vincula/cria lead
  const lead_id=await garantirLead(env,{nome,email,whats});

  const { salt, hash }=await hashSenha(senha);
  const ins=await rest(env,"POST","/rest/v1/ead_alunos",
    { nome, email, whatsapp:whats, senha_hash:hash, salt, lead_id, ultimo_em:new Date().toISOString() },
    { Prefer:"return=representation" });
  if(!ins.ok || !ins.data || !ins.data[0]) return json({ok:false,erro:"falha_criar",detalhe:(ins.text||"").slice(0,160)},500);
  const aluno=ins.data[0];
  const token=await assinarToken({ aluno_id:aluno.id, nome }, env.EAD_SECRET||"");
  return json({ ok:true, token, aluno:{ id:aluno.id, nome, email } });
}

async function garantirLead(env,{nome,email,whats}){
  try{
    const f=await rest(env,"GET",`/rest/v1/leads?email_normalizado=eq.${encodeURIComponent(email)}&select=id&limit=1`);
    if(f.ok && f.data && f.data[0]) return f.data[0].id;
    // origem do curso
    let origem_id=null;
    const o=await rest(env,"GET",`/rest/v1/origens?nome=eq.${encodeURIComponent("Curso Silêncio que Grita")}&select=id&limit=1`);
    if(o.ok && o.data && o.data[0]) origem_id=o.data[0].id;
    // telefone
    let e164=null, ddd=null; const d=String(whats).replace(/\D/g,"");
    if(d.length>=10){ const dd=(d.startsWith("55")?d:("55"+d)); e164="+"+dd; ddd=dd.substr(2,2); }
    const ins=await rest(env,"POST","/rest/v1/leads",
      { nome:nome||null, email, email_normalizado:email, telefone_e164:e164, ddd,
        origem_id, opt_in_email:true, status_aquecimento:"morno",
        tags:["Aluno SQG"], primeira_captura_em:new Date().toISOString(), ultima_interacao_em:new Date().toISOString() },
      { Prefer:"return=representation,resolution=merge-duplicates" });
    return (ins.data && ins.data[0]) ? ins.data[0].id : null;
  }catch(e){ return null; }
}

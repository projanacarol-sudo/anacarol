/**
 * /api/ead/admin  (equipe logada — Supabase Auth)
 *  GET                      -> lista alunos + progresso + certificado
 *  POST {acao:"criar", nome,email,whatsapp,senha}
 *  POST {acao:"editar", id, nome,email,whatsapp}
 *  POST {acao:"senha",  id, senha}
 *  POST {acao:"excluir",id}
 */
import { hashSenha, rest, json, cors } from "./_lib.js";
export function onRequestOptions(){ return new Response(null,{status:204,headers:cors()}); }

export async function onRequestGet({ request, env }){
  if(!(await staff(env,request))) return json({ok:false,erro:"nao_autorizado"},401);
  const [al,prog,tot,cert]=await Promise.all([
    rest(env,"GET","/rest/v1/ead_alunos?select=id,nome,email,whatsapp,criado_em,ultimo_em,lead_id&order=criado_em.desc"),
    rest(env,"GET","/rest/v1/ead_progresso?select=aluno_id"),
    rest(env,"GET","/rest/v1/ead_aulas?ativo=eq.true&select=id"),
    rest(env,"GET","/rest/v1/ead_certificados?select=aluno_id,codigo"),
  ]);
  const total=(tot.data||[]).length;
  const cnt={}; (prog.data||[]).forEach(p=>cnt[p.aluno_id]=(cnt[p.aluno_id]||0)+1);
  const certs={}; (cert.data||[]).forEach(c=>certs[c.aluno_id]=c.codigo);
  const alunos=(al.data||[]).map(a=>({ ...a, concluidas:cnt[a.id]||0, total, certificado:certs[a.id]||null }));
  return json({ ok:true, total, alunos });
}

export async function onRequestPost({ request, env }){
  if(!(await staff(env,request))) return json({ok:false,erro:"nao_autorizado"},401);
  let b={}; try{ b=await request.json(); }catch{}
  const email = b.email!==undefined ? String(b.email).trim().toLowerCase() : undefined;

  if(b.acao==="criar"){
    if(!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ok:false,erro:"email_invalido"},400);
    if((b.senha||"").length<6) return json({ok:false,erro:"senha_curta"},400);
    const ex=await rest(env,"GET",`/rest/v1/ead_alunos?email=eq.${encodeURIComponent(email)}&select=id`);
    if(ex.data && ex.data[0]) return json({ok:false,erro:"ja_existe"},409);
    const lead_id=await garantirLead(env,{nome:b.nome,email,whats:b.whatsapp});
    const { salt, hash }=await hashSenha(b.senha);
    const ins=await rest(env,"POST","/rest/v1/ead_alunos",
      { nome:b.nome||null, email, whatsapp:b.whatsapp||null, senha_hash:hash, salt, lead_id },
      { Prefer:"return=representation" });
    if(!ins.ok) return json({ok:false,erro:"falha",detalhe:(ins.text||"").slice(0,160)},500);
    return json({ ok:true, aluno:ins.data && ins.data[0] });
  }
  if(b.acao==="editar"){
    if(!b.id) return json({ok:false,erro:"sem_id"},400);
    const patch={}; if(b.nome!==undefined)patch.nome=b.nome; if(b.whatsapp!==undefined)patch.whatsapp=b.whatsapp;
    if(email!==undefined){ if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ok:false,erro:"email_invalido"},400); patch.email=email; }
    const r=await rest(env,"PATCH",`/rest/v1/ead_alunos?id=eq.${b.id}`,patch,{ Prefer:"return=minimal" });
    if(!r.ok) return json({ok:false,erro:"falha",detalhe:(r.text||"").slice(0,160)},500);
    return json({ ok:true });
  }
  if(b.acao==="senha"){
    if(!b.id) return json({ok:false,erro:"sem_id"},400);
    if((b.senha||"").length<6) return json({ok:false,erro:"senha_curta"},400);
    const { salt, hash }=await hashSenha(b.senha);
    const r=await rest(env,"PATCH",`/rest/v1/ead_alunos?id=eq.${b.id}`,{ senha_hash:hash, salt },{ Prefer:"return=minimal" });
    return json({ ok:r.ok });
  }
  if(b.acao==="excluir"){
    if(!b.id) return json({ok:false,erro:"sem_id"},400);
    const r=await rest(env,"DELETE",`/rest/v1/ead_alunos?id=eq.${b.id}`,null,{ Prefer:"return=minimal" });
    return json({ ok:r.ok });
  }
  return json({ ok:false, erro:"acao_invalida" },400);
}

async function staff(env,request){
  const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token) return false;
  try{ const r=await fetch(`${env.SUPABASE_URL}/auth/v1/user`,{ headers:{ apikey:env.SUPABASE_ANON_KEY, Authorization:"Bearer "+token } }); return r.ok; }
  catch{ return false; }
}
async function garantirLead(env,{nome,email,whats}){
  try{
    const f=await rest(env,"GET",`/rest/v1/leads?email_normalizado=eq.${encodeURIComponent(email)}&select=id&limit=1`);
    if(f.ok && f.data && f.data[0]) return f.data[0].id;
    let origem_id=null;
    const o=await rest(env,"GET",`/rest/v1/origens?nome=eq.${encodeURIComponent("Curso Silêncio que Grita")}&select=id&limit=1`);
    if(o.ok && o.data && o.data[0]) origem_id=o.data[0].id;
    let e164=null, ddd=null; const d=String(whats||"").replace(/\D/g,"");
    if(d.length>=10){ const dd=(d.startsWith("55")?d:("55"+d)); e164="+"+dd; ddd=dd.substr(2,2); }
    const ins=await rest(env,"POST","/rest/v1/leads",
      { nome:nome||null, email, email_normalizado:email, telefone_e164:e164, ddd,
        origem_id, opt_in_email:true, status_aquecimento:"morno",
        tags:["Aluno SQG"], primeira_captura_em:new Date().toISOString(), ultima_interacao_em:new Date().toISOString() },
      { Prefer:"return=representation,resolution=merge-duplicates" });
    return (ins.data && ins.data[0]) ? ins.data[0].id : null;
  }catch(e){ return null; }
}

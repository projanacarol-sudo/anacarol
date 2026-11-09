/** POST /api/ead/login  {email,senha}  → retorna token do aluno */
import { conferirSenha, assinarToken, rest, json, cors } from "./_lib.js";
export function onRequestOptions(){ return new Response(null,{status:204,headers:cors()}); }

export async function onRequestPost({ request, env }){
  if(!env.EAD_SECRET) return json({ok:false,erro:"EAD_SECRET nao configurado no Cloudflare"},500);
  let b={}; try{ b=await request.json(); }catch{}
  const email=(b.email||"").trim().toLowerCase(), senha=(b.senha||"");
  if(!email||!senha) return json({ok:false,erro:"faltam_dados"},400);
  const r=await rest(env,"GET",`/rest/v1/ead_alunos?email=eq.${encodeURIComponent(email)}&select=id,nome,salt,senha_hash&limit=1`);
  const a=r.ok && r.data && r.data[0];
  if(!a) return json({ok:false,erro:"nao_encontrado"},401);
  const ok=await conferirSenha(senha, a.salt, a.senha_hash);
  if(!ok) return json({ok:false,erro:"senha_incorreta"},401);
  await rest(env,"PATCH",`/rest/v1/ead_alunos?id=eq.${a.id}`,{ ultimo_em:new Date().toISOString() },{ Prefer:"return=minimal" });
  const token=await assinarToken({ aluno_id:a.id, nome:a.nome }, env.EAD_SECRET||"");
  return json({ ok:true, token, aluno:{ id:a.id, nome:a.nome } });
}

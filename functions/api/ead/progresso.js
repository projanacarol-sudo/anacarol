/** POST /api/ead/progresso  (aluno)  {aula_id, concluida}  → marca/desmarca e devolve contagem */
import { alunoDaReq, rest, json, cors } from "./_lib.js";
export function onRequestOptions(){ return new Response(null,{status:204,headers:cors()}); }

export async function onRequestPost({ request, env }){
  const a=await alunoDaReq(request,env);
  if(!a) return json({ok:false,erro:"nao_autorizado"},401);
  let b={}; try{ b=await request.json(); }catch{}
  const aula_id=b.aula_id; if(!aula_id) return json({ok:false,erro:"sem_aula"},400);
  const concluida = b.concluida!==false;

  if(concluida){
    await rest(env,"POST","/rest/v1/ead_progresso",
      { aluno_id:a.aluno_id, aula_id, concluida:true, concluida_em:new Date().toISOString() },
      { Prefer:"resolution=merge-duplicates,return=minimal" });
  }else{
    await rest(env,"DELETE",`/rest/v1/ead_progresso?aluno_id=eq.${a.aluno_id}&aula_id=eq.${aula_id}`,null,{ Prefer:"return=minimal" });
  }

  // aquece o lead do aluno
  tocarLead(env, a.aluno_id);

  // contagem
  const [tot, done] = await Promise.all([
    rest(env,"GET","/rest/v1/ead_aulas?ativo=eq.true&select=id"),
    rest(env,"GET",`/rest/v1/ead_progresso?aluno_id=eq.${a.aluno_id}&select=aula_id`),
  ]);
  const total=(tot.data||[]).length, concluidas=(done.data||[]).length;
  return json({ ok:true, total, concluidas, completo: total>0 && concluidas>=total });
}

async function tocarLead(env, aluno_id){
  try{
    const r=await rest(env,"GET",`/rest/v1/ead_alunos?id=eq.${aluno_id}&select=lead_id`);
    const lid=r.data && r.data[0] && r.data[0].lead_id;
    if(lid) await rest(env,"PATCH",`/rest/v1/leads?id=eq.${lid}`,{ ultima_interacao_em:new Date().toISOString(), status_aquecimento:"quente" },{ Prefer:"return=minimal" });
  }catch(e){}
}

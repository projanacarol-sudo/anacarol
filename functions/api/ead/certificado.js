/** GET /api/ead/certificado  (aluno)  → emite (se concluiu as 17 aulas) e devolve o código/nome */
import { alunoDaReq, rest, json, cors, codigoCert } from "./_lib.js";
export function onRequestOptions(){ return new Response(null,{status:204,headers:cors()}); }

export async function onRequestGet({ request, env }){
  const a=await alunoDaReq(request,env);
  if(!a) return json({ok:false,erro:"nao_autorizado"},401);

  const [tot, done, al, jacert] = await Promise.all([
    rest(env,"GET","/rest/v1/ead_aulas?ativo=eq.true&select=id"),
    rest(env,"GET",`/rest/v1/ead_progresso?aluno_id=eq.${a.aluno_id}&select=aula_id`),
    rest(env,"GET",`/rest/v1/ead_alunos?id=eq.${a.aluno_id}&select=nome,email,lead_id`),
    rest(env,"GET",`/rest/v1/ead_certificados?aluno_id=eq.${a.aluno_id}&select=codigo,emitido_em&limit=1`),
  ]);
  const total=(tot.data||[]).length, concluidas=(done.data||[]).length;
  const aluno=(al.data&&al.data[0])||{};
  if(!(total>0 && concluidas>=total)) return json({ ok:false, erro:"incompleto", falta: total-concluidas, total });

  let cert = jacert.data && jacert.data[0];
  if(!cert){
    const codigo=codigoCert();
    const ins=await rest(env,"POST","/rest/v1/ead_certificados",{ aluno_id:a.aluno_id, codigo },{ Prefer:"return=representation" });
    cert = (ins.data && ins.data[0]) || { codigo, emitido_em:new Date().toISOString() };
    // marca o lead como apoiador capacitado
    if(aluno.lead_id){
      try{
        const l=await rest(env,"GET",`/rest/v1/leads?id=eq.${aluno.lead_id}&select=tags`);
        const tags=new Set(((l.data&&l.data[0]&&l.data[0].tags)||[]));
        tags.add("Apoiador Capacitado"); tags.add("Curso SQG concluído");
        await rest(env,"PATCH",`/rest/v1/leads?id=eq.${aluno.lead_id}`,{ tags:[...tags], status_aquecimento:"quente" },{ Prefer:"return=minimal" });
      }catch(e){}
    }
  }
  return json({ ok:true, codigo:cert.codigo, nome:aluno.nome, emitido_em:cert.emitido_em });
}

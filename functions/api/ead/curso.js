/** GET /api/ead/curso  (aluno logado) → módulos+aulas+materiais + progresso + certificado */
import { alunoDaReq, rest, json, cors } from "./_lib.js";
export function onRequestOptions(){ return new Response(null,{status:204,headers:cors()}); }

export async function onRequestGet({ request, env }){
  const a=await alunoDaReq(request,env);
  if(!a) return json({ok:false,erro:"nao_autorizado"},401);

  const [mods, aulas, mats, prog, cert] = await Promise.all([
    rest(env,"GET","/rest/v1/ead_modulos?ativo=eq.true&select=id,titulo,descricao,ordem&order=ordem.asc"),
    rest(env,"GET","/rest/v1/ead_aulas?ativo=eq.true&select=id,modulo_id,titulo,descricao,embed,duracao,ordem&order=ordem.asc"),
    rest(env,"GET","/rest/v1/ead_materiais?select=id,aula_id,titulo,url,tipo,ordem&order=ordem.asc"),
    rest(env,"GET",`/rest/v1/ead_progresso?aluno_id=eq.${a.aluno_id}&select=aula_id`),
    rest(env,"GET",`/rest/v1/ead_certificados?aluno_id=eq.${a.aluno_id}&select=codigo,emitido_em&limit=1`),
  ]);

  const feitas = new Set((prog.data||[]).map(p=>p.aula_id));
  const matByAula = {}; (mats.data||[]).forEach(m=>{ (matByAula[m.aula_id]=matByAula[m.aula_id]||[]).push(m); });
  const aulasByMod = {}; let total=0, concluidas=0;
  (aulas.data||[]).forEach(al=>{
    total++; const done=feitas.has(al.id); if(done) concluidas++;
    (aulasByMod[al.modulo_id]=aulasByMod[al.modulo_id]||[]).push({ ...al, materiais:matByAula[al.id]||[], concluida:done });
  });
  const modulos=(mods.data||[]).map(m=>({ ...m, aulas:aulasByMod[m.id]||[] }));
  const completo = total>0 && concluidas>=total;
  const certificado = (cert.data && cert.data[0]) ? cert.data[0] : null;

  return json({ ok:true, aluno:{ nome:a.nome }, modulos, total, concluidas, completo, certificado });
}

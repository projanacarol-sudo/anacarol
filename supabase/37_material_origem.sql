-- =====================================================================
-- CRM Ana — Fase 37: separar a origem dos leads de material (impresso × digital)
-- Novos já entram com "LP Material Impresso" ou "LP Material Digital"
-- (feito no /api/apoiador). Aqui garantimos as origens e RECLASSIFICAMOS os
-- que já haviam entrado como "LP materiais", pelo modo gravado no Romaneio.
-- Requer a fase 28 (_e164). Idempotente.
-- =====================================================================

insert into public.origens (nome, tipo, canal, base_legal_padrao)
select 'LP Material Impresso', 'formulario', 'landing_page', 'consentimento'
where not exists (select 1 from public.origens where nome = 'LP Material Impresso');

insert into public.origens (nome, tipo, canal, base_legal_padrao)
select 'LP Material Digital', 'formulario', 'landing_page', 'consentimento'
where not exists (select 1 from public.origens where nome = 'LP Material Digital');

-- Reclassifica os leads que estão na origem antiga "LP materiais",
-- casando com o cadastro no Romaneio (apoiadores) por e-mail OU telefone.
update public.leads l
   set origem_id = (
        select o.id from public.origens o
        where o.nome = case when a.modo = 'fisico' then 'LP Material Impresso' else 'LP Material Digital' end
       ),
       updated_at = now()
  from public.apoiadores a
 where l.origem_id = (select id from public.origens where nome = 'LP materiais')
   and (
        (nullif(lower(trim(a.email)), '') is not null and l.email_normalizado = lower(trim(a.email)))
        or (public._e164(a.whatsapp) is not null and l.telefone_e164 = public._e164(a.whatsapp))
   );

-- (opcional) atualiza também as tags dos reclassificados fica a critério;
-- as tags antigas "Pediu Material" permanecem — não removemos histórico.

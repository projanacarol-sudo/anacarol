-- =====================================================================
-- CRM Ana — Fase 39: método de entrega do IMPRESSO (motoboy × correio)
--
-- Nova régua da LP /apoiar:
--   • até o raio (30 km) em SP  → impresso por MOTOBOY
--   • fora do raio, ainda em SP → impresso pelos CORREIOS (mala direta)
--   • fora de SP                → Kit Digital
--
-- Aqui: coluna `entrega` em apoiadores + as duas novas origens do CRM.
-- É controle INTERNO (o apoiador não vê a diferença). Idempotente.
-- =====================================================================

-- 1) coluna de método de entrega (só faz sentido no modo 'fisico')
alter table public.apoiadores
  add column if not exists entrega text
  check (entrega is null or entrega in ('motoboy','correio'));

-- backfill: cadastros impressos antigos eram todos dentro do raio = motoboy
update public.apoiadores
   set entrega = 'motoboy'
 where modo = 'fisico' and entrega is null;

-- 2) origens do CRM para os dois métodos (o /api/apoiador já usa esses nomes)
insert into public.origens (nome, tipo, canal, base_legal_padrao)
select 'LP Impresso Motoboy', 'formulario', 'landing_page', 'consentimento'
where not exists (select 1 from public.origens where nome = 'LP Impresso Motoboy');

insert into public.origens (nome, tipo, canal, base_legal_padrao)
select 'LP Impresso Correio', 'formulario', 'landing_page', 'consentimento'
where not exists (select 1 from public.origens where nome = 'LP Impresso Correio');

-- =====================================================================
-- (OPCIONAL) Reclassificar leads impressos ANTIGOS de "LP Material Impresso"
-- para "LP Impresso Motoboy" (eram todos dentro do raio). Rode se quiser
-- unificar o histórico. NÃO mexe em quem já era digital.
-- ---------------------------------------------------------------------
-- update public.leads l
--    set origem_id = (select id from public.origens where nome = 'LP Impresso Motoboy'),
--        updated_at = now()
--  where l.origem_id = (select id from public.origens where nome = 'LP Material Impresso');
-- =====================================================================
-- FIM
-- =====================================================================

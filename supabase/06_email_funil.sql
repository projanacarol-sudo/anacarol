-- =====================================================================
-- CRM Ana — Fase 6: Funil de e-mail (construtor + motor + auto-enroll)
-- Rode no SQL Editor. Depois configure o agendador (bloco 6) com a sua URL.
-- =====================================================================

-- 1) Colunas que faltavam ---------------------------------------------
alter table public.email_steps    add column if not exists corpo_html text;
alter table public.email_steps    add column if not exists preheader  text;
alter table public.email_sequences add column if not exists from_nome  text;
alter table public.email_sequences add column if not exists from_email text;
-- auto-enroll: origem que joga o lead novo direto num funil
alter table public.origens add column if not exists auto_sequence_id uuid references public.email_sequences(id) on delete set null;
-- controle de envio no estado do lead
alter table public.lead_sequence_state add column if not exists ultimo_envio_em timestamptz;
alter table public.lead_sequence_state add column if not exists tentativas int not null default 0;

-- 2) Inscrever um SEGMENTO num funil (manual) -------------------------
-- Filtros opcionais: uf, origem_id, tag, só com opt-in.
create or replace function public.enroll_segment(
  p_sequence uuid,
  p_uf text default null,
  p_origem uuid default null,
  p_tag text default null,
  p_somente_optin boolean default true
) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with alvo as (
    select id from leads l
    where (p_uf is null or l.uf = p_uf)
      and (p_origem is null or l.origem_id = p_origem)
      and (p_tag is null or l.tags @> array[p_tag])
      and (not p_somente_optin or l.opt_in_email)
      and (not coalesce(l.unsubscribed_email,false))
  ),
  ins as (
    insert into lead_sequence_state (lead_id, sequence_id, step_atual, proximo_envio_em, status)
    select a.id, p_sequence, 0, now(), 'ativo' from alvo a
    on conflict (lead_id, sequence_id) do nothing
    returning 1
  )
  select count(*) into n from ins;
  return n;
end $$;

-- 3) Inscrever UM lead num funil (usado no auto-enroll) ---------------
create or replace function public.enroll_lead(p_lead uuid, p_sequence uuid)
returns void
language sql security definer set search_path = public as $$
  insert into lead_sequence_state (lead_id, sequence_id, step_atual, proximo_envio_em, status)
  values (p_lead, p_sequence, 0, now(), 'ativo')
  on conflict (lead_id, sequence_id) do nothing;
$$;

-- 4) Estatísticas de um funil (para o painel) -------------------------
create or replace function public.crm_funil_stats(p_sequence uuid)
returns json
language sql security definer set search_path = public as $$
  select json_build_object(
    'ativos',    (select count(*) from lead_sequence_state where sequence_id=p_sequence and status='ativo'),
    'concluidos',(select count(*) from lead_sequence_state where sequence_id=p_sequence and status='concluido'),
    'pausados',  (select count(*) from lead_sequence_state where sequence_id=p_sequence and status='pausado'),
    'enviados',  (select count(*) from email_events e join lead_sequence_state s on s.lead_id=e.lead_id
                    where s.sequence_id=p_sequence and e.tipo in ('sent','delivered')),
    'aberturas', (select count(*) from email_events e join lead_sequence_state s on s.lead_id=e.lead_id
                    where s.sequence_id=p_sequence and e.tipo='opened'),
    'cliques',   (select count(*) from email_events e join lead_sequence_state s on s.lead_id=e.lead_id
                    where s.sequence_id=p_sequence and e.tipo='clicked')
  );
$$;

grant execute on function public.enroll_segment(uuid,text,uuid,text,boolean) to authenticated;
grant execute on function public.enroll_lead(uuid,uuid)   to authenticated;
grant execute on function public.crm_funil_stats(uuid)    to authenticated;

-- 5) Extensões do agendador (pg_cron + pg_net) ------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 6) AGENDADOR: cutuca a Function do motor a cada minuto --------------
--    >>> EDITE a URL e a chave antes de rodar este bloco. <<<
--    A chave tem que ser a mesma da variável ENGINE_KEY no Pages.
--
-- select cron.schedule('email-engine', '* * * * *', $cron$
--   select net.http_post(
--     url    := 'https://SEU-PROJETO.pages.dev/api/engine/tick',
--     headers:= jsonb_build_object('Content-Type','application/json','x-engine-key','TROQUE_POR_UMA_CHAVE_FORTE')
--   );
-- $cron$);
--
-- Para ver/remover depois:
--   select * from cron.job;
--   select cron.unschedule('email-engine');

-- =====================================================================
-- FIM
-- =====================================================================

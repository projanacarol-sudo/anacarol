-- =====================================================================
-- CRM Ana — Fase 7: fluxo visual (nós tipados)
-- Cada passo do funil passa a ter um TIPO: email | espera | tag_add | tag_remove
-- Rode no SQL Editor.
-- =====================================================================

-- 1) tipo + config nos passos ----------------------------------------
alter table public.email_steps add column if not exists tipo text not null default 'email';
alter table public.email_steps add column if not exists config jsonb not null default '{}'::jsonb;
-- assunto/corpo_html continuam para o tipo 'email'; config guarda o resto
-- (ex: tag_add -> {"tag":"cliente"} ; espera usa só atraso_horas)

-- 2) Enroll honrando o atraso do PRIMEIRO nó -------------------------
create or replace function public.enroll_lead(p_lead uuid, p_sequence uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare h int;
begin
  select coalesce(min(atraso_horas),0) into h
  from email_steps where sequence_id = p_sequence
    and ordem = (select min(ordem) from email_steps where sequence_id = p_sequence);
  insert into lead_sequence_state (lead_id, sequence_id, step_atual, proximo_envio_em, status)
  values (p_lead, p_sequence, 0, now() + make_interval(hours => coalesce(h,0)), 'ativo')
  on conflict (lead_id, sequence_id) do nothing;
end $$;

create or replace function public.enroll_segment(
  p_sequence uuid, p_uf text default null, p_origem uuid default null,
  p_tag text default null, p_somente_optin boolean default true
) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer; h int;
begin
  select coalesce(min(atraso_horas),0) into h
  from email_steps where sequence_id = p_sequence
    and ordem = (select min(ordem) from email_steps where sequence_id = p_sequence);
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
    select a.id, p_sequence, 0, now() + make_interval(hours => coalesce(h,0)), 'ativo' from alvo a
    on conflict (lead_id, sequence_id) do nothing
    returning 1
  )
  select count(*) into n from ins;
  return n;
end $$;

grant execute on function public.enroll_lead(uuid,uuid) to authenticated;
grant execute on function public.enroll_segment(uuid,text,uuid,text,boolean) to authenticated;

-- =====================================================================
-- FIM
-- =====================================================================

-- =====================================================================
-- CRM Ana — Fase 8: canvas / flow builder (grafo de nós)
-- Cada nó ganha posição (x,y) e uma ligação para o próximo (next_step_id).
-- O funil deixa de ser linear e passa a seguir as ligações desenhadas.
-- Rode no SQL Editor.
-- =====================================================================

-- posição e ligação dos nós
alter table public.email_steps add column if not exists x int not null default 120;
alter table public.email_steps add column if not exists y int not null default 120;
alter table public.email_steps add column if not exists next_step_id uuid references public.email_steps(id) on delete set null;
alter table public.email_steps add column if not exists is_start boolean not null default false;

-- estado do lead passa a guardar o NÓ atual (não mais um índice)
alter table public.lead_sequence_state add column if not exists current_step_id uuid;

-- garante 1 nó inicial por sequência (o primeiro criado, se nenhum marcado)
update public.email_steps s set is_start = true
where not exists (select 1 from public.email_steps s2 where s2.sequence_id = s.sequence_id and s2.is_start)
  and s.ordem = (select min(ordem) from public.email_steps s3 where s3.sequence_id = s.sequence_id);

-- nó inicial de uma sequência (helper)
create or replace function public.no_inicial(p_sequence uuid)
returns table(id uuid, atraso_horas int)
language sql stable security definer set search_path = public as $$
  select id, atraso_horas from email_steps
  where sequence_id = p_sequence
  order by is_start desc, ordem asc
  limit 1;
$$;

-- Enroll: começa no nó inicial, respeitando o atraso dele
create or replace function public.enroll_lead(p_lead uuid, p_sequence uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare s_id uuid; h int;
begin
  select id, atraso_horas into s_id, h from no_inicial(p_sequence);
  insert into lead_sequence_state (lead_id, sequence_id, step_atual, current_step_id, proximo_envio_em, status)
  values (p_lead, p_sequence, 0, s_id, now() + make_interval(hours => coalesce(h,0)), 'ativo')
  on conflict (lead_id, sequence_id) do nothing;
end $$;

create or replace function public.enroll_segment(
  p_sequence uuid, p_uf text default null, p_origem uuid default null,
  p_tag text default null, p_somente_optin boolean default true
) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer; s_id uuid; h int;
begin
  select id, atraso_horas into s_id, h from no_inicial(p_sequence);
  with alvo as (
    select id from leads l
    where (p_uf is null or l.uf = p_uf)
      and (p_origem is null or l.origem_id = p_origem)
      and (p_tag is null or l.tags @> array[p_tag])
      and (not p_somente_optin or l.opt_in_email)
      and (not coalesce(l.unsubscribed_email,false))
  ),
  ins as (
    insert into lead_sequence_state (lead_id, sequence_id, step_atual, current_step_id, proximo_envio_em, status)
    select a.id, p_sequence, 0, s_id, now() + make_interval(hours => coalesce(h,0)), 'ativo' from alvo a
    on conflict (lead_id, sequence_id) do nothing
    returning 1
  )
  select count(*) into n from ins;
  return n;
end $$;

grant execute on function public.no_inicial(uuid) to authenticated;
grant execute on function public.enroll_lead(uuid,uuid) to authenticated;
grant execute on function public.enroll_segment(uuid,text,uuid,text,boolean) to authenticated;

-- =====================================================================
-- FIM
-- =====================================================================

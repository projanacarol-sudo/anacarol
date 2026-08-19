-- =====================================================================
-- CRM Ana — Fase 24: Engajamento de e-mail no LEAD + termômetro + origens
-- Abertura/clique esquentam o status (frio→morno→quente), sem esfriar.
-- Vale para os DOIS mecanismos (funil e disparo por post) — webhook é o mesmo.
-- Rode no SQL Editor.
-- =====================================================================

-- Resumo de engajamento denormalizado no lead (pra segmentar/mostrar)
alter table public.leads add column if not exists total_aberturas       integer not null default 0;
alter table public.leads add column if not exists total_cliques         integer not null default 0;
alter table public.leads add column if not exists abriu_email           boolean not null default false;
alter table public.leads add column if not exists ultimo_engajamento_em timestamptz;

-- Aplica um evento de engajamento no lead e esquenta o termômetro
-- (opened -> pelo menos 'morno'; clicked -> 'quente'; nunca esfria)
create or replace function public.lead_engajou(p_lead uuid, p_tipo text)
returns void language plpgsql security definer as $$
begin
  if p_lead is null then return; end if;
  if p_tipo = 'opened' then
    update public.leads set
      total_aberturas = coalesce(total_aberturas,0) + 1,
      abriu_email = true,
      ultimo_engajamento_em = now(),
      score = coalesce(score,0) + 1,
      status_aquecimento = case when status_aquecimento = 'quente' then 'quente' else 'morno' end,
      ultima_interacao_em = now()
    where id = p_lead;
  elsif p_tipo = 'clicked' then
    update public.leads set
      total_cliques = coalesce(total_cliques,0) + 1,
      abriu_email = true,
      ultimo_engajamento_em = now(),
      score = coalesce(score,0) + 3,
      status_aquecimento = 'quente',
      ultima_interacao_em = now()
    where id = p_lead;
  end if;
end $$;

-- Origens com quantos leads opt-in cada uma tem (pra segmentar o disparo)
create or replace function public.origens_leads()
returns table(id uuid, nome text, n bigint)
language sql stable as $$
  select o.id, o.nome, count(l.*) as n
  from public.origens o
  join public.leads l on l.origem_id = o.id
  where l.opt_in_email = true and l.unsubscribed_email = false
  group by o.id, o.nome
  order by n desc;
$$;

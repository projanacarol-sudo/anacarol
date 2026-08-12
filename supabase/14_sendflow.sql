-- =====================================================================
-- CRM Ana — Fase 14: métricas de campanha do SendFlow
-- Guarda o evento campaign.metrics (agregados por campanha).
-- Rode no SQL Editor.
-- =====================================================================
create table if not exists public.sendflow_campanhas (
  campaign_id   text primary key,
  nome          text,
  participantes int,
  cliques       int,
  entradas      int,
  saidas        int,
  grupos_total  int,
  grupos_cheios int,
  grupos_abertos int,
  input_dates   jsonb default '{}'::jsonb,
  output_dates  jsonb default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

alter table public.sendflow_campanhas enable row level security;
drop policy if exists staff_read on public.sendflow_campanhas;
create policy staff_read on public.sendflow_campanhas
  for select to authenticated using (true);

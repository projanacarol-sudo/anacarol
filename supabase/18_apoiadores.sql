-- =====================================================================
-- CRM Ana — Fase 18: Apoiadores (LP de material de campanha + romaneio)
-- Espelha o schema de "leads" do William, no Postgres/Supabase.
-- Rode no SQL Editor.
-- =====================================================================

create table if not exists public.apoiadores (
  id            uuid primary key default gen_random_uuid(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz,
  modo          text not null check (modo in ('fisico','digital')),
  status        text not null default 'novo' check (status in ('novo','separado','postado','entregue','cancelado')),
  nome          text not null,
  whatsapp      text not null,
  email         text,
  cep           text,
  logradouro    text,
  numero        text,
  complemento   text,
  bairro        text,
  cidade        text,
  uf            text,
  lat           double precision,
  lng           double precision,
  distancia_km  double precision,
  metodo_rota   text,
  quer_panfletar boolean default false,
  lote          text,
  rastreio      text,
  obs           text,
  origem        text,
  utm_medium    text,
  utm_campaign  text,
  aceite_em     timestamptz,
  ip            text,
  user_agent    text
);

create unique index if not exists ux_apoiadores_whatsapp on public.apoiadores (whatsapp);
create index if not exists ix_apoiadores_modo_status on public.apoiadores (modo, status);
create index if not exists ix_apoiadores_lote   on public.apoiadores (lote);
create index if not exists ix_apoiadores_criado on public.apoiadores (criado_em);
create index if not exists ix_apoiadores_cidade on public.apoiadores (cidade);

-- (atualizado_em é setado pela aplicação a cada gravação)

-- RLS: a equipe (autenticada) lê e edita; o público NÃO acessa direto
-- (o cadastro entra pela Function /api/apoiador, que usa a service key).
alter table public.apoiadores enable row level security;
drop policy if exists staff_all on public.apoiadores;
create policy staff_all on public.apoiadores for all to authenticated using (true) with check (true);

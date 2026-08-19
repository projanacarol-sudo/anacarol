-- =====================================================================
-- CRM Ana — Fase 20: Métricas de e-mail por post (entrega/abertura)
-- Liga cada e-mail enviado ao post e conta entregues/abertos via webhook.
-- Rode no SQL Editor.
-- =====================================================================

-- Contadores agregados por post (campanha)
create table if not exists public.email_campaigns (
  post_id       text primary key,
  enviados      integer not null default 0,
  entregues     integer not null default 0,
  abertos       integer not null default 0,
  cliques       integer not null default 0,
  bounces       integer not null default 0,
  atualizado_em timestamptz not null default now()
);

-- Mapa email_id -> post (para o webhook saber a qual post o evento pertence)
-- e para deduplicar (contar 1 entrega / 1 abertura por destinatário)
create table if not exists public.email_sends (
  email_id   text primary key,
  post_id    text,
  entregue   boolean not null default false,
  aberto     boolean not null default false,
  clicou     boolean not null default false,
  criado_em  timestamptz not null default now()
);
create index if not exists ix_email_sends_post on public.email_sends (post_id);

-- RLS: a equipe lê as métricas; o mapa é só para o backend (service key)
alter table public.email_campaigns enable row level security;
drop policy if exists staff_read on public.email_campaigns;
create policy staff_read on public.email_campaigns for select to authenticated using (true);

alter table public.email_sends enable row level security;
-- (sem policy = ninguém acessa via anon/authenticated; só a service key)

-- Incremento seguro de um contador
create or replace function public.email_campaign_bump(p_post text, p_campo text, p_delta int)
returns void language plpgsql security definer as $$
begin
  if p_post is null then return; end if;
  if p_campo not in ('enviados','entregues','abertos','cliques','bounces') then return; end if;
  insert into public.email_campaigns(post_id) values (p_post) on conflict (post_id) do nothing;
  execute format('update public.email_campaigns set %I = %I + $1, atualizado_em=now() where post_id=$2', p_campo, p_campo)
    using p_delta, p_post;
end $$;

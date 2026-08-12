-- =====================================================================
-- CRM Ana — Fase 12: Gerador de páginas de captura
-- Tabela das páginas + bucket de banners no Storage.
-- Rode no SQL Editor.
-- =====================================================================

create table if not exists public.landing_pages (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  headline      text,
  subheadline   text,
  descricao     text,
  data_txt      text,           -- "12/09/2026 às 19h"
  local         text,
  banner_url    text,
  tag           text,           -- tag de captura aplicada ao lead
  sequence_id   uuid references public.email_sequences(id) on delete set null,
  origem_id     uuid references public.origens(id) on delete set null,
  grupo_url     text,           -- link do grupo de WhatsApp (destino do Obrigado)
  cor           text default '#128C7E',
  ativo         boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
drop trigger if exists trg_lp_updated on public.landing_pages;
create trigger trg_lp_updated before update on public.landing_pages
  for each row execute function public.set_updated_at();

alter table public.landing_pages enable row level security;
drop policy if exists staff_all on public.landing_pages;
create policy staff_all on public.landing_pages
  for all to authenticated using (true) with check (true);

-- Bucket público para os banners dos eventos
insert into storage.buckets (id, name, public)
values ('banners','banners', true)
on conflict (id) do nothing;

-- Políticas do bucket: leitura pública, upload/gestão por quem está logado
drop policy if exists banners_read on storage.objects;
create policy banners_read on storage.objects
  for select using (bucket_id = 'banners');

drop policy if exists banners_write on storage.objects;
create policy banners_write on storage.objects
  for insert to authenticated with check (bucket_id = 'banners');

drop policy if exists banners_update on storage.objects;
create policy banners_update on storage.objects
  for update to authenticated using (bucket_id = 'banners');

drop policy if exists banners_delete on storage.objects;
create policy banners_delete on storage.objects
  for delete to authenticated using (bucket_id = 'banners');

-- =====================================================================
-- FIM
-- =====================================================================

-- =====================================================================
-- CRM Ana — Fase 19: Gerador de E-mail com IA
-- Guarda os posts do Instagram + o que a IA gerou, e o bucket das imagens.
-- Rode no SQL Editor.
-- =====================================================================

create table if not exists public.ig_email_posts (
  id            text primary key,          -- id/shortcode do post
  legenda       text,
  imagem        text,                      -- url da imagem original do post
  link          text,
  tipo          text,
  data          text,                      -- timestamp do post (texto, como vem da Apify)
  curtidas      integer,
  comentarios   integer,
  assunto       text,                      -- \\
  preview       text,                      --  } gerados pela IA
  texto         text,                      -- /
  prompt_imagem text,                      -- /
  imagem_upload text,                      -- url (Storage) da imagem escolhida p/ o e-mail
  criado_em     timestamptz not null default now(),
  enviado_em    timestamptz
);
create index if not exists ix_ig_email_data on public.ig_email_posts (data desc);

-- RLS: só a equipe (autenticada) lê/edita pelo painel; as gravações
-- pesadas (Apify/IA/upload/envio) passam pelas Functions com service key.
alter table public.ig_email_posts enable row level security;
drop policy if exists staff_all on public.ig_email_posts;
create policy staff_all on public.ig_email_posts for all to authenticated using (true) with check (true);

-- Storage: bucket público para as imagens dos e-mails
insert into storage.buckets (id, name, public) values ('email', 'email', true)
  on conflict (id) do nothing;

drop policy if exists "email read"   on storage.objects;
create policy "email read"   on storage.objects for select using (bucket_id = 'email');
drop policy if exists "email write"  on storage.objects;
create policy "email write"  on storage.objects for insert to authenticated with check (bucket_id = 'email');
drop policy if exists "email update" on storage.objects;
create policy "email update" on storage.objects for update to authenticated using (bucket_id = 'email');

-- =====================================================================
-- BIO Ana Carolina — Cards e Botões gerenciáveis pela página /admin.html
-- Rode este arquivo INTEIRO no SQL Editor do Supabase (mesmo projeto do CRM).
-- =====================================================================

-- ---------- Tabelas ----------
create table if not exists public.bio_cards (
  id         uuid primary key default gen_random_uuid(),
  titulo     text not null,
  subtitulo  text,
  url        text,
  image_url  text,
  ordem      int  not null default 0,
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.bio_links (
  id         uuid primary key default gen_random_uuid(),
  titulo     text not null,
  subtitulo  text,
  url        text,
  icon       text default 'globe',   -- instagram|tiktok|facebook|youtube|spotify|globe|shield|chat|site
  cor        text default '#7a2418',
  ordem      int  not null default 0,
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists ix_bio_cards_ordem on public.bio_cards (ordem);
create index if not exists ix_bio_links_ordem on public.bio_links (ordem);

-- ---------- RLS: leitura pública, escrita só autenticado ----------
alter table public.bio_cards enable row level security;
alter table public.bio_links enable row level security;

drop policy if exists bio_cards_read on public.bio_cards;
create policy bio_cards_read on public.bio_cards for select using (true);
drop policy if exists bio_cards_write on public.bio_cards;
create policy bio_cards_write on public.bio_cards for all to authenticated using (true) with check (true);

drop policy if exists bio_links_read on public.bio_links;
create policy bio_links_read on public.bio_links for select using (true);
drop policy if exists bio_links_write on public.bio_links;
create policy bio_links_write on public.bio_links for all to authenticated using (true) with check (true);

-- ---------- Storage: bucket público "bio" para as artes dos cards ----------
insert into storage.buckets (id, name, public)
values ('bio', 'bio', true)
on conflict (id) do nothing;

drop policy if exists "bio read"   on storage.objects;
create policy "bio read"   on storage.objects for select using (bucket_id = 'bio');
drop policy if exists "bio insert" on storage.objects;
create policy "bio insert" on storage.objects for insert to authenticated with check (bucket_id = 'bio');
drop policy if exists "bio update" on storage.objects;
create policy "bio update" on storage.objects for update to authenticated using (bucket_id = 'bio');
drop policy if exists "bio delete" on storage.objects;
create policy "bio delete" on storage.objects for delete to authenticated using (bucket_id = 'bio');

-- ---------- Dados iniciais (só se as tabelas estiverem vazias) ----------
insert into public.bio_cards (titulo, subtitulo, url, ordem)
select * from (values
  ('Dando Voz Cast',   'Canal no YouTube',  'https://www.youtube.com/channel/UC0AViRM6LKhhH0lccYAeD2w', 1),
  ('Silêncio que Grita','Proteção infantil','https://dandovoz.com.br/silencioquegrita/',               2),
  ('Podcast',          'Ouça no Spotify',   'https://open.spotify.com/show/1fjVsMhlYPZPoU9wecSJH7',      3),
  ('Site oficial',     'anacarolinaoliveira.com.br', 'https://anacarolinaoliveira.com.br/',             4)
) as v(titulo, subtitulo, url, ordem)
where not exists (select 1 from public.bio_cards);

insert into public.bio_links (titulo, subtitulo, url, icon, cor, ordem)
select * from (values
  ('Instagram','@anacarolinaoliveira_oficial','https://www.instagram.com/anacarolinaoliveira_oficial/','instagram','#c2306b',1),
  ('TikTok',   '@anacarolinaoliveira_of',      'https://www.tiktok.com/@anacarolinaoliveira_of',        'tiktok',   '#111111',2),
  ('Facebook', 'Página oficial',               'https://www.facebook.com/anacarolinaoliveira.of/',      'facebook', '#1877F2',3)
) as v(titulo, subtitulo, url, icon, cor, ordem)
where not exists (select 1 from public.bio_links);

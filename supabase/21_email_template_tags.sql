-- =====================================================================
-- CRM Ana — Fase 21: Template visual do e-mail + tags de envio
-- Rode no SQL Editor.
-- =====================================================================

-- Config visual do e-mail (uma linha só)
create table if not exists public.email_template (
  id            int primary key default 1,
  titulo        text default 'Ana Carolina Oliveira',
  subtitulo     text default 'Deputada Federal 2026 · Podemos',
  cor_topo      text default '#7a2418',
  cor_botao     text default '#7a2418',
  texto_botao   text default 'Ver no Instagram',
  logo_url      text default '',
  rodape        text default 'Você recebe este e-mail por apoiar a campanha de Ana Carolina Oliveira.',
  atualizado_em timestamptz not null default now(),
  constraint email_template_unica check (id = 1)
);
insert into public.email_template (id) values (1) on conflict (id) do nothing;

alter table public.email_template enable row level security;
drop policy if exists staff_all on public.email_template;
create policy staff_all on public.email_template for all to authenticated using (true) with check (true);

-- Tags disponíveis (com quantos leads opt-in cada uma tem)
create or replace function public.tags_leads()
returns table(tag text, n bigint)
language sql stable as $$
  select t as tag, count(*) as n
  from public.leads, unnest(tags) as t
  where opt_in_email = true and unsubscribed_email = false
  group by t
  order by n desc;
$$;

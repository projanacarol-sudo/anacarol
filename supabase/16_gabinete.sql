-- =====================================================================
-- CRM Ana — Fase 16: Botão "Falar com o Gabinete"
-- Rode no SQL Editor.
--   1) coluna de observação no lead (guarda o assunto)
--   2) página de captura "gabinete" com a tag aplicada automaticamente
-- =====================================================================

alter table public.leads add column if not exists observacao text;

insert into public.landing_pages (slug, headline, tag, cor, ativo)
values ('gabinete', 'Falar com o Gabinete', 'Chamou Gabinete', '#7a2418', true)
on conflict (slug) do update
  set tag = excluded.tag,
      headline = excluded.headline;

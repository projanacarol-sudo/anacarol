-- =====================================================================
-- CRM Ana — Fase 13: mais estilo nas páginas de captura
-- Cor de fundo e cor do título (a cor do botão/destaque já é a coluna "cor").
-- Rode no SQL Editor.
-- =====================================================================
alter table public.landing_pages add column if not exists cor_fundo  text default '#eef2f4';
alter table public.landing_pages add column if not exists cor_titulo text default '#14202a';

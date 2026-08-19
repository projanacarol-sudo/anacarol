-- =====================================================================
-- CRM Ana — Fase 23: Vários botões no template do e-mail
-- Cada botão: { "texto": "...", "link": "...", "cor": "#..." }
-- link vazio = usa o link do post.
-- Rode no SQL Editor.
-- =====================================================================

alter table public.email_template
  add column if not exists botoes jsonb not null default '[]'::jsonb;

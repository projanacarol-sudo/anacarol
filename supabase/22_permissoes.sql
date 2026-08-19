-- =====================================================================
-- CRM Ana — Fase 22: Controle de acesso por colaborador
-- Guarda, por colaborador, quais telas ele pode Ver e Editar.
-- Formato: { "leads": {"ver":true,"editar":false}, ... }
-- Rode no SQL Editor.
-- =====================================================================

alter table public.colaboradores
  add column if not exists permissoes jsonb not null default '{}'::jsonb;

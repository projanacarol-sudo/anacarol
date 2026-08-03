-- =====================================================================
-- CRM Ana — Fase 9: nó de CONDIÇÃO (ramificação Sim/Não)
-- Ex.: "Abriu? (s/n)" -> Sim vai para um nó, Não para outro.
-- Rode no SQL Editor.
-- =====================================================================

-- segunda saída (o caminho "Não"); next_step_id é o caminho "Sim"/padrão
alter table public.email_steps add column if not exists next_no_id uuid references public.email_steps(id) on delete set null;

-- tipo 'condicao' usa config: {"cond":"abriu"} ou {"cond":"clicou"}
-- (não precisa de nova tabela; o motor avalia os email_events do lead)

-- =====================================================================
-- FIM
-- =====================================================================

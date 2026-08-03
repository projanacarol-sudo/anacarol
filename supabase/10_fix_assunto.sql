-- =====================================================================
-- CRM Ana — Fase 10: assunto opcional
-- Nós que não são e-mail (espera, tag, condição) não têm assunto.
-- Torna a coluna opcional para não dar erro de NOT NULL (23502).
-- Opcional (o painel já manda assunto vazio), mas recomendado.
-- =====================================================================
alter table public.email_steps alter column assunto drop not null;

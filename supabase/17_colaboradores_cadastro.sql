-- =====================================================================
-- CRM Ana — Fase 17: Auto-cadastro de colaboradores + aprovação
-- Rode no SQL Editor.
-- =====================================================================

alter table public.colaboradores add column if not exists whatsapp     text;
alter table public.colaboradores add column if not exists atividade    text;
alter table public.colaboradores add column if not exists status       text not null default 'ativo';       -- ativo | pendente | recusado
alter table public.colaboradores add column if not exists nivel        text not null default 'colaborador'; -- admin | colaborador
alter table public.colaboradores add column if not exists auth_user_id uuid;

create index if not exists ix_colab_status on public.colaboradores (status);

-- Colaboradores criados antes desta fase continuam ativos (default 'ativo').

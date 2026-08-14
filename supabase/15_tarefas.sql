-- =====================================================================
-- CRM Ana — Fase 15: Kanban de tarefas + colaboradores
-- Rode no SQL Editor.
-- =====================================================================

create table if not exists public.colaboradores (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  email      text,
  cor        text default '#128C7E',
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.tarefas (
  id            uuid primary key default gen_random_uuid(),
  titulo        text not null,
  descricao     text,
  status        text not null default 'afazer',   -- afazer | fazendo | revisao | concluido
  responsavel_id uuid references public.colaboradores(id) on delete set null,
  prioridade    text default 'media',             -- baixa | media | alta
  prazo         date,
  ordem         int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists ix_tarefas_status on public.tarefas (status);

drop trigger if exists trg_tarefas_updated on public.tarefas;
create trigger trg_tarefas_updated before update on public.tarefas
  for each row execute function public.set_updated_at();

alter table public.colaboradores enable row level security;
alter table public.tarefas       enable row level security;
drop policy if exists staff_all on public.colaboradores;
create policy staff_all on public.colaboradores for all to authenticated using (true) with check (true);
drop policy if exists staff_all on public.tarefas;
create policy staff_all on public.tarefas for all to authenticated using (true) with check (true);

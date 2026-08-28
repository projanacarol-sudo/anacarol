-- =====================================================================
-- CRM Ana — Fase 38: eventos com LIMITE DE VAGAS, LISTA DE ESPERA e
-- RELATÓRIO por e-mail (2x/dia).
--
-- 1) landing_pages ganha:  limite_vagas, relatorio_email, relatorio_ativo
-- 2) tabela  inscricoes  (1 linha por lead por página) — conta vagas de
--    forma confiável, mesmo com a deduplicação de leads.
-- 3) bloco pg_cron (comentado) para disparar o relatório às 09h e 18h BRT.
--
-- Rode no SQL Editor. Idempotente.
-- =====================================================================

-- 1) novas colunas na página do evento -------------------------------
alter table public.landing_pages add column if not exists limite_vagas    integer not null default 0;   -- 0 = sem limite
alter table public.landing_pages add column if not exists relatorio_email  text;
alter table public.landing_pages add column if not exists relatorio_ativo  boolean not null default false;

-- 2) inscrições por página (fonte da verdade das vagas) --------------
create table if not exists public.inscricoes (
  id          uuid primary key default gen_random_uuid(),
  page_id     uuid not null references public.landing_pages(id) on delete cascade,
  lead_id     uuid not null references public.leads(id) on delete cascade,
  status      text not null default 'confirmado',   -- 'confirmado' | 'espera'
  posicao     integer,                              -- posição na fila de espera
  avisado_em  timestamptz,                          -- quando avisamos a lista de espera
  created_at  timestamptz not null default now()
);
create unique index if not exists inscricoes_page_lead_uidx on public.inscricoes(page_id, lead_id);
create index if not exists inscricoes_page_status_idx on public.inscricoes(page_id, status);
create index if not exists inscricoes_created_idx on public.inscricoes(created_at);

alter table public.inscricoes enable row level security;
drop policy if exists staff_all on public.inscricoes;
create policy staff_all on public.inscricoes
  for all to authenticated using (true) with check (true);

-- 3) RPC: registra/atualiza inscrição e decide confirmado × espera.
--    Retorna jsonb { status, confirmados, limite, vagas, posicao }.
create or replace function public.inscrever_em_evento(p_page uuid, p_lead uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_limite   integer;
  v_conf     integer;
  v_status   text;
  v_pos      integer;
  v_existe   public.inscricoes%rowtype;
begin
  select coalesce(limite_vagas,0) into v_limite from public.landing_pages where id = p_page;
  if v_limite is null then v_limite := 0; end if;

  select * into v_existe from public.inscricoes where page_id = p_page and lead_id = p_lead;
  if found then
    -- já inscrito: mantém o status atual (não rebaixa quem já estava confirmado)
    select count(*) into v_conf from public.inscricoes where page_id = p_page and status = 'confirmado';
    return jsonb_build_object('status', v_existe.status, 'confirmados', v_conf,
      'limite', v_limite, 'vagas', greatest(v_limite - v_conf, 0), 'posicao', v_existe.posicao, 'novo', false);
  end if;

  select count(*) into v_conf from public.inscricoes where page_id = p_page and status = 'confirmado';

  if v_limite > 0 and v_conf >= v_limite then
    v_status := 'espera';
    select coalesce(max(posicao),0) + 1 into v_pos from public.inscricoes where page_id = p_page and status = 'espera';
  else
    v_status := 'confirmado';
    v_pos := null;
    v_conf := v_conf + 1;
  end if;

  insert into public.inscricoes(page_id, lead_id, status, posicao)
  values (p_page, p_lead, v_status, v_pos);

  return jsonb_build_object('status', v_status, 'confirmados', v_conf,
    'limite', v_limite, 'vagas', greatest(v_limite - v_conf, 0), 'posicao', v_pos, 'novo', true);
end;
$$;

-- 4) RPC de leitura: números do evento (para a página pública mostrar
--    "vagas esgotadas" já no GET). SECURITY DEFINER, sem expor dados.
create or replace function public.evento_status(p_slug text)
returns jsonb
language sql
security definer
as $$
  select jsonb_build_object(
    'limite', coalesce(lp.limite_vagas,0),
    'confirmados', coalesce((select count(*) from public.inscricoes i where i.page_id = lp.id and i.status = 'confirmado'),0),
    'espera', coalesce((select count(*) from public.inscricoes i where i.page_id = lp.id and i.status = 'espera'),0)
  )
  from public.landing_pages lp
  where lp.slug = p_slug and lp.ativo = true
  limit 1;
$$;

-- =====================================================================
-- 5) AGENDADOR do relatório (pg_cron + pg_net) — 09h e 18h BRT.
--    BRT = UTC-3  ⇒  12:00 e 21:00 UTC. Ajuste a URL e a chave (=ENGINE_KEY),
--    descomente e rode UMA vez.
-- =====================================================================
-- select cron.schedule('relatorio-eventos', '0 12,21 * * *', $cron$
--   select net.http_post(
--     url    := 'https://lp.anacarolinaoliveira.com.br/api/relatorio-eventos',
--     headers:= jsonb_build_object('Content-Type','application/json','x-engine-key','SUA_ENGINE_KEY')
--   );
-- $cron$);
--
-- Para ver/remover:
--   select * from cron.job;
--   select cron.unschedule('relatorio-eventos');

-- =====================================================================
-- FIM
-- =====================================================================

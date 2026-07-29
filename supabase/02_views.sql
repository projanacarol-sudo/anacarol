-- =====================================================================
-- CRM Ana — Fase 4: funções de agregação para o painel
-- Cole no SQL Editor do Supabase e clique em "Run".
-- As contagens são feitas no Postgres (rápido), sem puxar a base inteira
-- para o navegador. security definer + search_path fixo = seguro.
-- =====================================================================

-- Números-chave da Visão Geral ----------------------------------------
create or replace function public.crm_overview()
returns json
language sql security definer set search_path = public as $$
  select json_build_object(
    'total',        (select count(*) from leads),
    'com_optin',    (select count(*) from leads where opt_in_email),
    'com_telefone', (select count(*) from leads where telefone_e164 is not null),
    'com_uf',       (select count(*) from leads where uf is not null),
    'frio',         (select count(*) from leads where status_aquecimento = 'frio'),
    'morno',        (select count(*) from leads where status_aquecimento = 'morno'),
    'quente',       (select count(*) from leads where status_aquecimento = 'quente'),
    'novos_30d',    (select count(*) from leads
                       where coalesce(primeira_captura_em, created_at) >= now() - interval '30 days')
  );
$$;

-- Leads por estado (mapa/ranking) -------------------------------------
create or replace function public.crm_por_uf()
returns table(uf text, total bigint)
language sql security definer set search_path = public as $$
  select coalesce(uf, '—') as uf, count(*)::bigint as total
  from leads
  group by 1
  order by 2 desc;
$$;

-- Crescimento da base por mês -----------------------------------------
create or replace function public.crm_por_mes()
returns table(mes text, total bigint)
language sql security definer set search_path = public as $$
  select to_char(date_trunc('month', coalesce(primeira_captura_em, created_at)), 'YYYY-MM') as mes,
         count(*)::bigint as total
  from leads
  group by 1
  order by 1;
$$;

-- Eventos de e-mail agregados (funil) ---------------------------------
create or replace function public.crm_email_eventos()
returns table(tipo text, total bigint)
language sql security definer set search_path = public as $$
  select tipo, count(*)::bigint as total
  from email_events
  group by 1
  order by 2 desc;
$$;

-- Permissões: só quem está logado (authenticated) pode chamar ---------
grant execute on function public.crm_overview()       to authenticated;
grant execute on function public.crm_por_uf()         to authenticated;
grant execute on function public.crm_por_mes()        to authenticated;
grant execute on function public.crm_email_eventos()  to authenticated;

-- =====================================================================
-- FIM — funções de agregação prontas para o painel.
-- =====================================================================

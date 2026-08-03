-- =====================================================================
-- CRM Ana — Fase 5: funções para o Monitor de Audiência (estilo WS)
-- Cole no SQL Editor do Supabase e clique "Run".
-- =====================================================================

-- Entradas por dia (últimos N dias): total + total do estado foco (SP) -----
create or replace function public.crm_por_dia(dias int default 14, uf_foco text default 'SP')
returns table(dia text, total bigint, total_foco bigint)
language sql security definer set search_path = public as $$
  select to_char(date_trunc('day', coalesce(primeira_captura_em, created_at)), 'DD/MM') as dia,
         count(*)::bigint as total,
         count(*) filter (where uf = uf_foco)::bigint as total_foco
  from leads
  where coalesce(primeira_captura_em, created_at) >= (now() - make_interval(days => dias))
  group by date_trunc('day', coalesce(primeira_captura_em, created_at))
  order by date_trunc('day', coalesce(primeira_captura_em, created_at));
$$;

-- Placar de um estado: total, com WhatsApp, com e-mail ------------------
create or replace function public.crm_estado(alvo text default 'SP')
returns json
language sql security definer set search_path = public as $$
  select json_build_object(
    'uf', alvo,
    'total',    (select count(*) from leads where uf = alvo),
    'whatsapp', (select count(*) from leads where uf = alvo and telefone_e164 is not null),
    'email',    (select count(*) from leads where uf = alvo and email is not null),
    'total_base', (select count(*) from leads)
  );
$$;

grant execute on function public.crm_por_dia(int, text) to authenticated;
grant execute on function public.crm_estado(text)       to authenticated;

-- =====================================================================
-- FIM
-- =====================================================================

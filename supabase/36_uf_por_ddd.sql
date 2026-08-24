-- =====================================================================
-- CRM Ana — Fase 36: preencher UF/região/cidade pelo DDD do telefone
-- Muitos leads importados (Kommo, planilhas) vieram sem UF. Aqui usamos a
-- tabela ddd_geo (DDD → UF/região/cidade) pra preencher onde falta.
-- Roda agora e passa a rodar junto da faxina (higienizar_base).
-- Requer 28 e 32.
-- =====================================================================

create or replace function public.preencher_uf_por_ddd()
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- garante o DDD a partir do telefone (2 dígitos após o 55)
  update public.leads
     set ddd = substr(regexp_replace(telefone_e164,'\D','','g'), 3, 2)
   where telefone_e164 is not null and (ddd is null or ddd = '');

  -- preenche UF/região/cidade pelo DDD, só onde a UF está vazia
  update public.leads l set
     uf     = g.uf,
     regiao = coalesce(nullif(l.regiao,''), g.regiao),
     cidade_estimada = coalesce(nullif(l.cidade_estimada,''), g.cidade_principal)
  from public.ddd_geo g
  where g.ddd = l.ddd and (l.uf is null or l.uf = '');
  get diagnostics n = row_count;

  return jsonb_build_object('uf_preenchidas', n, 'em', now());
end; $$;

grant execute on function public.preencher_uf_por_ddd() to service_role;

-- ---- faxina passa a preencher UF por DDD também ----
create or replace function public.higienizar_base()
returns jsonb language plpgsql security definer set search_path = public as $$
declare g record; ids uuid[]; keep uuid; i int; fundidos int := 0; antes int; depois int; invalidos int; ufs jsonb;
begin
  select count(*) into antes from public.leads;

  for g in
    select lower(trim(email)) k, array_agg(id order by created_at) ids
    from public.leads where email is not null and trim(email) <> ''
    group by 1 having count(*) > 1
  loop
    ids := g.ids; keep := ids[1];
    for i in 2 .. array_length(ids,1) loop perform public.merge_leads(keep, ids[i]); fundidos := fundidos + 1; end loop;
  end loop;

  for g in
    select public._e164(telefone_e164) k, array_agg(id order by created_at) ids
    from public.leads where public._e164(telefone_e164) is not null
    group by 1 having count(*) > 1
  loop
    ids := g.ids; keep := ids[1];
    for i in 2 .. array_length(ids,1) loop perform public.merge_leads(keep, ids[i]); fundidos := fundidos + 1; end loop;
  end loop;

  update public.leads set nome = trim(nome) where nome is not null and nome <> trim(nome);
  update public.leads set email = lower(trim(email)), email_normalizado = lower(trim(email))
    where email is not null and email_normalizado is distinct from lower(trim(email));
  update public.leads set telefone_e164 = public._e164(telefone_e164)
    where telefone_e164 is not null and telefone_e164 is distinct from public._e164(telefone_e164);
  update public.leads set ddd = substr(regexp_replace(telefone_e164,'\D','','g'), 3, 2)
    where telefone_e164 is not null and (ddd is null or ddd = '');

  update public.leads set email_normalizado = null
    where email_normalizado is not null and not public.email_ok(email_normalizado);
  get diagnostics invalidos = row_count;

  ufs := public.preencher_uf_por_ddd();   -- <<< preenche estados

  select count(*) into depois from public.leads;
  return jsonb_build_object('fundidos', fundidos, 'emails_invalidados', invalidos,
                            'uf', ufs, 'antes', antes, 'depois', depois, 'em', now());
end; $$;

-- ---- RODA AGORA (preenche os estados de imediato) ----
select public.preencher_uf_por_ddd();

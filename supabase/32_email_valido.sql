-- =====================================================================
-- CRM Ana — Fase 32: validação de e-mail NA BASE (não a cada envio)
--   • email_ok(text): true se for um e-mail com formato válido;
--   • zera o email_normalizado dos inválidos (some do pool de envio, mas
--     mantém o `email` cru pra referência);
--   • a faxina (higienizar_base) passa a fazer isso sempre;
--   • qualidade_base ganha o número de "email_invalido".
-- A query de envio já exige email_normalizado IS NOT NULL, então depois disso
-- o disparo é direto, sem validar por lote. Idempotente. Rode depois do 28.
-- =====================================================================

create or replace function public.email_ok(v text)
returns boolean language sql immutable as $$
  select v is not null
     and v ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
$$;

-- ---- limpeza ÚNICA agora: tira os inválidos do pool de envio ----
update public.leads
   set email_normalizado = null, updated_at = now()
 where email_normalizado is not null
   and not public.email_ok(email_normalizado);

-- ---- faxina passa a normalizar E validar e-mail ----
create or replace function public.higienizar_base()
returns jsonb language plpgsql security definer set search_path = public as $$
declare g record; ids uuid[]; keep uuid; i int; fundidos int := 0; antes int; depois int; invalidos int;
begin
  select count(*) into antes from public.leads;

  -- 1) duplicados com o MESMO e-mail (normalizado) -> funde no mais antigo
  for g in
    select lower(trim(email)) k, array_agg(id order by created_at) ids
    from public.leads where email is not null and trim(email) <> ''
    group by 1 having count(*) > 1
  loop
    ids := g.ids; keep := ids[1];
    for i in 2 .. array_length(ids,1) loop perform public.merge_leads(keep, ids[i]); fundidos := fundidos + 1; end loop;
  end loop;

  -- 2) duplicados com o MESMO telefone (normalizado) -> funde no mais antigo
  for g in
    select public._e164(telefone_e164) k, array_agg(id order by created_at) ids
    from public.leads where public._e164(telefone_e164) is not null
    group by 1 having count(*) > 1
  loop
    ids := g.ids; keep := ids[1];
    for i in 2 .. array_length(ids,1) loop perform public.merge_leads(keep, ids[i]); fundidos := fundidos + 1; end loop;
  end loop;

  -- 3) normaliza os sobreviventes
  update public.leads set nome = trim(nome) where nome is not null and nome <> trim(nome);
  update public.leads set email = lower(trim(email)), email_normalizado = lower(trim(email))
    where email is not null and email_normalizado is distinct from lower(trim(email));
  update public.leads set telefone_e164 = public._e164(telefone_e164)
    where telefone_e164 is not null and telefone_e164 is distinct from public._e164(telefone_e164);
  update public.leads set ddd = substr(regexp_replace(telefone_e164,'\D','','g'), 3, 2)
    where telefone_e164 is not null and (ddd is null or ddd = '');

  -- 4) valida e-mail: inválido sai do pool de envio (email_normalizado = null)
  update public.leads set email_normalizado = null
    where email_normalizado is not null and not public.email_ok(email_normalizado);
  get diagnostics invalidos = row_count;

  select count(*) into depois from public.leads;
  return jsonb_build_object('fundidos', fundidos, 'emails_invalidados', invalidos,
                            'antes', antes, 'depois', depois, 'em', now());
end;
$$;

-- ---- qualidade_base + "email_invalido" ----
create or replace function public.qualidade_base()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'total',           (select count(*) from public.leads),
    'com_email',       (select count(*) from public.leads where email_normalizado is not null),
    'com_telefone',    (select count(*) from public.leads where telefone_e164 is not null),
    'sem_contato',     (select count(*) from public.leads where email_normalizado is null and telefone_e164 is null),
    'email_invalido',  (select count(*) from public.leads where email is not null and trim(email)<>'' and email_normalizado is null),
    'sem_origem',      (select count(*) from public.leads where origem_id is null),
    'sem_tags',        (select count(*) from public.leads where coalesce(array_length(tags,1),0) = 0),
    'com_optin_email', (select count(*) from public.leads where opt_in_email and not unsubscribed_email and email_normalizado is not null),
    'dup_email',       (select coalesce(sum(c-1),0) from (select count(*) c from public.leads where email is not null and trim(email)<>'' group by lower(trim(email)) having count(*)>1) t),
    'dup_telefone',    (select coalesce(sum(c-1),0) from (select count(*) c from public.leads where public._e164(telefone_e164) is not null group by public._e164(telefone_e164) having count(*)>1) t)
  );
$$;

grant execute on function public.email_ok(text)   to service_role, authenticated;
grant execute on function public.higienizar_base() to service_role;
grant execute on function public.qualidade_base()  to service_role, authenticated;

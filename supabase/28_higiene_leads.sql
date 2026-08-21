-- =====================================================================
-- CRM Ana — Fase 28: Higiene da base de leads
--   • merge_leads(keep, drop): funde dois leads num só, repontando TODAS as
--     tabelas que referenciam leads(id) e consolidando os campos.
--   • higienizar_base(): normaliza (telefone/e-mail/nome/ddd) e unifica
--     duplicados com a MESMA chave normalizada (e-mail ou telefone).
--   • qualidade_base(): números da base pra um painel de qualidade.
--   • lead_por_contato(): usado pelas RPCs de entrada p/ auto-curar
--     duplicado cruzado (um lead só com telefone + outro só com e-mail).
-- Seguro/idempotente. Agende com pg_cron (exemplo no fim).
-- =====================================================================

-- telefone -> dígitos com DDI 55 (ex.: (11) 9... -> 5511...)
create or replace function public._e164(v text)
returns text language sql immutable as $$
  select case
    when v is null then null
    else (
      with d as (select regexp_replace(v, '\D', '', 'g') as x)
      select case
        when length((select x from d)) < 10 then null
        when left((select x from d),2) = '55' then '+' || (select x from d)
        else '+55' || (select x from d)
      end
    )
  end
$$;

-- ------------------------------------------------------------------
-- FUNDE dois leads. `keep` sobrevive; `drop` some (dados migram p/ keep).
-- ------------------------------------------------------------------
create or replace function public.merge_leads(keep uuid, drop uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare r record; d public.leads%rowtype;
begin
  if keep is null or drop is null or keep = drop then return keep; end if;
  select * into d from public.leads where id = drop;
  if not found then return keep; end if;

  -- 1) reponta tudo que referencia leads(id): lead_id = keep
  for r in
    select table_schema, table_name
    from information_schema.columns
    where column_name = 'lead_id' and table_schema = 'public'
  loop
    begin
      execute format('update %I.%I set lead_id = %L where lead_id = %L', r.table_schema, r.table_name, keep, drop);
    exception when unique_violation then
      -- ex.: lead_sequence_state (lead_id, sequence_id) já existe p/ keep
      execute format('delete from %I.%I where lead_id = %L', r.table_schema, r.table_name, drop);
    end;
  end loop;

  -- 2) apaga o drop ANTES de copiar (evita colisão dos índices únicos)
  delete from public.leads where id = drop;

  -- 3) consolida os campos no keep (preenche vazios, une tags, respeita opt-out)
  update public.leads k set
    nome                = coalesce(nullif(k.nome,''), nullif(d.nome,'')),
    email               = coalesce(nullif(k.email,''), nullif(d.email,'')),
    email_normalizado   = coalesce(k.email_normalizado, d.email_normalizado),
    telefone_e164       = coalesce(k.telefone_e164, d.telefone_e164),
    ddd                 = coalesce(nullif(k.ddd,''), nullif(d.ddd,'')),
    uf                  = coalesce(nullif(k.uf,''), nullif(d.uf,'')),
    regiao              = coalesce(nullif(k.regiao,''), nullif(d.regiao,'')),
    cidade_estimada     = coalesce(nullif(k.cidade_estimada,''), nullif(d.cidade_estimada,'')),
    origem_id           = coalesce(k.origem_id, d.origem_id),
    dandovoz_id         = coalesce(k.dandovoz_id, d.dandovoz_id),
    tags                = (select array(select distinct unnest(coalesce(k.tags,'{}') || coalesce(d.tags,'{}')))),
    opt_in_email        = k.opt_in_email or d.opt_in_email,
    opt_in_whatsapp     = k.opt_in_whatsapp or d.opt_in_whatsapp,
    unsubscribed_email  = k.unsubscribed_email or d.unsubscribed_email,  -- se um saiu, mantém saída
    score               = greatest(coalesce(k.score,0), coalesce(d.score,0)),
    status_aquecimento  = case when 'quente' in (k.status_aquecimento, d.status_aquecimento) then 'quente'
                               when 'morno'  in (k.status_aquecimento, d.status_aquecimento) then 'morno'
                               else 'frio' end,
    observacao          = nullif(concat_ws(E'\n', nullif(k.observacao,''), nullif(d.observacao,'')), ''),
    primeira_captura_em = least(coalesce(k.primeira_captura_em, now()), coalesce(d.primeira_captura_em, now())),
    ultima_interacao_em = greatest(coalesce(k.ultima_interacao_em, to_timestamp(0)), coalesce(d.ultima_interacao_em, to_timestamp(0))),
    updated_at          = now()
  where k.id = keep;

  return keep;
end;
$$;

-- ------------------------------------------------------------------
-- Retorna o lead do contato, JÁ unificando duplicado cruzado
-- (um só com e-mail + outro só com telefone). Usado nas RPCs de entrada.
-- ------------------------------------------------------------------
create or replace function public.lead_por_contato(v_email text, v_e164 text)
returns uuid language plpgsql security definer set search_path = public as $$
declare a uuid; b uuid; keep uuid; drop uuid;
begin
  if v_email is not null then select id into a from public.leads where email_normalizado = v_email limit 1; end if;
  if v_e164  is not null then select id into b from public.leads where telefone_e164 = v_e164 limit 1; end if;
  if a is not null and b is not null and a <> b then
    -- mantém o mais antigo
    select case when ka.created_at <= kb.created_at then a else b end,
           case when ka.created_at <= kb.created_at then b else a end
      into keep, drop
      from public.leads ka, public.leads kb where ka.id=a and kb.id=b;
    return public.merge_leads(keep, drop);
  end if;
  return coalesce(a, b);
end;
$$;

-- ------------------------------------------------------------------
-- HIGIENIZA a base inteira: unifica duplicados por chave normalizada e
-- normaliza os campos. Retorna quantos leads foram fundidos.
-- ------------------------------------------------------------------
create or replace function public.higienizar_base()
returns jsonb language plpgsql security definer set search_path = public as $$
declare g record; ids uuid[]; keep uuid; i int; fundidos int := 0; antes int; depois int;
begin
  select count(*) into antes from public.leads;

  -- 1) duplicados com o MESMO e-mail (normalizado) -> funde no mais antigo
  for g in
    select lower(trim(email)) k, array_agg(id order by created_at) ids
    from public.leads
    where email is not null and trim(email) <> ''
    group by 1 having count(*) > 1
  loop
    ids := g.ids; keep := ids[1];
    for i in 2 .. array_length(ids,1) loop perform public.merge_leads(keep, ids[i]); fundidos := fundidos + 1; end loop;
  end loop;

  -- 2) duplicados com o MESMO telefone (normalizado) -> funde no mais antigo
  for g in
    select public._e164(telefone_e164) k, array_agg(id order by created_at) ids
    from public.leads
    where public._e164(telefone_e164) is not null
    group by 1 having count(*) > 1
  loop
    ids := g.ids; keep := ids[1];
    for i in 2 .. array_length(ids,1) loop perform public.merge_leads(keep, ids[i]); fundidos := fundidos + 1; end loop;
  end loop;

  -- 3) normaliza os sobreviventes (agora sem colisão)
  update public.leads set nome = trim(nome) where nome is not null and nome <> trim(nome);
  update public.leads set email = lower(trim(email)),
                          email_normalizado = lower(trim(email))
    where email is not null and email_normalizado is distinct from lower(trim(email));
  update public.leads set telefone_e164 = public._e164(telefone_e164)
    where telefone_e164 is not null and telefone_e164 is distinct from public._e164(telefone_e164);
  update public.leads set ddd = substr(regexp_replace(telefone_e164,'\D','','g'), 3, 2)
    where telefone_e164 is not null and (ddd is null or ddd = '');

  select count(*) into depois from public.leads;
  return jsonb_build_object('fundidos', fundidos, 'antes', antes, 'depois', depois, 'em', now());
end;
$$;

-- ------------------------------------------------------------------
-- Números da base (pra um painel de qualidade)
-- ------------------------------------------------------------------
create or replace function public.qualidade_base()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'total',           (select count(*) from public.leads),
    'com_email',       (select count(*) from public.leads where email_normalizado is not null),
    'com_telefone',    (select count(*) from public.leads where telefone_e164 is not null),
    'sem_contato',     (select count(*) from public.leads where email_normalizado is null and telefone_e164 is null),
    'sem_origem',      (select count(*) from public.leads where origem_id is null),
    'sem_tags',        (select count(*) from public.leads where coalesce(array_length(tags,1),0) = 0),
    'com_optin_email', (select count(*) from public.leads where opt_in_email and not unsubscribed_email),
    'dup_email',       (select coalesce(sum(c-1),0) from (select count(*) c from public.leads where email is not null and trim(email)<>'' group by lower(trim(email)) having count(*)>1) t),
    'dup_telefone',    (select coalesce(sum(c-1),0) from (select count(*) c from public.leads where public._e164(telefone_e164) is not null group by public._e164(telefone_e164) having count(*)>1) t)
  );
$$;

grant execute on function public.merge_leads(uuid,uuid)          to service_role;
grant execute on function public.lead_por_contato(text,text)     to service_role;
grant execute on function public.higienizar_base()               to service_role;
grant execute on function public.qualidade_base()                to service_role, authenticated;

-- =====================================================================
-- PORTAS DE ENTRADA: passam a UNIFICAR duplicado cruzado sempre que gravam.
-- (redefine as RPCs de materiais e DandoVoz p/ usar lead_por_contato)
-- =====================================================================

-- LP de materiais (apoiador) — igual antes, mas com unificação cruzada
create or replace function public.apoiador_vira_lead(
  p_nome text, p_email text, p_whatsapp text,
  p_uf text default null, p_cidade text default null,
  p_origem_nome text default 'LP materiais', p_tag text default 'Pediu Material'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_email  text := nullif(lower(trim(coalesce(p_email,''))), '');
  v_digits text := regexp_replace(coalesce(p_whatsapp,''), '\D', '', 'g');
  v_e164   text; v_ddd text; v_origem uuid; v_lead uuid;
begin
  if length(v_digits) >= 10 then
    if left(v_digits,2) <> '55' then v_digits := '55' || v_digits; end if;
    v_e164 := '+' || v_digits; v_ddd := substr(v_digits,3,2);
  end if;
  if v_email is null and v_e164 is null then return null; end if;

  select id into v_origem from public.origens where nome = p_origem_nome limit 1;
  if v_origem is null then
    insert into public.origens (nome, tipo, canal, base_legal_padrao)
    values (p_origem_nome, 'formulario', 'landing_page', 'consentimento') returning id into v_origem;
  end if;

  v_lead := public.lead_por_contato(v_email, v_e164);   -- unifica cruzado

  if v_lead is not null then
    update public.leads set
      tags = (select array(select distinct unnest(coalesce(tags,'{}') || array[p_tag]))),
      status_aquecimento = 'quente', opt_in_email = true,
      nome = coalesce(nullif(nome,''), nullif(p_nome,'')),
      email = coalesce(nullif(email,''), nullif(p_email,'')),
      email_normalizado = coalesce(email_normalizado, v_email),
      telefone_e164 = coalesce(telefone_e164, v_e164), ddd = coalesce(ddd, v_ddd),
      uf = coalesce(nullif(uf,''), nullif(p_uf,'')),
      cidade_estimada = coalesce(nullif(cidade_estimada,''), nullif(p_cidade,'')),
      ultima_interacao_em = now(), updated_at = now()
    where id = v_lead;
  else
    insert into public.leads
      (nome, email, email_normalizado, telefone_e164, ddd, uf, cidade_estimada,
       origem_id, status_aquecimento, tags, opt_in_email, primeira_captura_em, ultima_interacao_em)
    values (nullif(p_nome,''), nullif(p_email,''), v_email, v_e164, v_ddd,
       nullif(p_uf,''), nullif(p_cidade,''), v_origem, 'quente', array[p_tag], true, now(), now())
    returning id into v_lead;
  end if;
  return v_lead;
end; $$;

-- DandoVoz cadastro — igual antes, mas com unificação cruzada
create or replace function public.dandovoz_lead(
  p_nome text, p_email text, p_telefone text,
  p_cidade text default null, p_bairro text default null,
  p_tipo text default null, p_origem_cad text default null, p_dandovoz_id text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_email  text := nullif(lower(trim(coalesce(p_email,''))), '');
  v_digits text := regexp_replace(coalesce(p_telefone,''), '\D', '', 'g');
  v_e164 text; v_ddd text; v_dvid text := nullif(trim(coalesce(p_dandovoz_id,'')), '');
  v_origem uuid; v_lead uuid; v_c uuid; v_tag text := nullif(trim(coalesce(p_tipo,'')), ''); v_nota text;
begin
  if length(v_digits) >= 10 then
    if left(v_digits,2) <> '55' then v_digits := '55' || v_digits; end if;
    v_e164 := '+' || v_digits; v_ddd := substr(v_digits,3,2);
  end if;
  if v_dvid is null and v_email is null and v_e164 is null then return null; end if;
  if v_tag is not null then v_tag := 'DandoVoz: ' || v_tag; end if;
  v_nota := nullif(concat_ws(' · ', nullif(p_origem_cad,''),
              case when nullif(p_bairro,'') is not null then 'Bairro: ' || p_bairro end), '');
  select id into v_origem from public.origens where nome = 'Gabinete (DandoVoz)' limit 1;

  if v_dvid is not null then select id into v_lead from public.leads where dandovoz_id = v_dvid limit 1; end if;
  if v_lead is null then
    v_lead := public.lead_por_contato(v_email, v_e164);       -- unifica cruzado
  else
    v_c := public.lead_por_contato(v_email, v_e164);
    if v_c is not null and v_c <> v_lead then v_lead := public.merge_leads(v_lead, v_c); end if;
  end if;

  if v_lead is not null then
    update public.leads set
      dandovoz_id = coalesce(dandovoz_id, v_dvid),
      nome = coalesce(nullif(nome,''), nullif(p_nome,'')),
      email = coalesce(nullif(email,''), nullif(p_email,'')),
      email_normalizado = coalesce(email_normalizado, v_email),
      telefone_e164 = coalesce(telefone_e164, v_e164), ddd = coalesce(ddd, v_ddd),
      cidade_estimada = coalesce(nullif(cidade_estimada,''), nullif(p_cidade,'')),
      tags = case when v_tag is null then tags
                  else (select array(select distinct unnest(coalesce(tags,'{}') || array[v_tag]))) end,
      observacao = coalesce(nullif(observacao,''), v_nota),
      ultima_interacao_em = now(), updated_at = now()
    where id = v_lead;
  else
    insert into public.leads
      (nome, email, email_normalizado, telefone_e164, ddd, cidade_estimada,
       origem_id, status_aquecimento, tags, opt_in_email, dandovoz_id, observacao,
       primeira_captura_em, ultima_interacao_em)
    values (nullif(p_nome,''), nullif(p_email,''), v_email, v_e164, v_ddd, nullif(p_cidade,''),
       v_origem, 'frio', case when v_tag is null then '{}'::text[] else array[v_tag] end,
       false, v_dvid, v_nota, now(), now())
    returning id into v_lead;
  end if;
  return v_lead;
end; $$;

-- =====================================================================
-- AGENDAMENTO (pg_cron chama a função direto, sem HTTP). Rode UMA vez:
--   create extension if not exists pg_cron;
--   select cron.schedule('higiene-leads', '0 4 * * 1',  -- toda segunda 04:00
--     $$ select public.higienizar_base(); $$);
-- Ver / remover:
--   select * from cron.job;
--   select cron.unschedule('higiene-leads');
-- Rodar AGORA (manual):  select public.higienizar_base();
-- =====================================================================

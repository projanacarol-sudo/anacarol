-- =====================================================================
-- CRM Ana — Fase 27: Integração DandoVoz (Gabinete) → CRM
-- Cada cadastro de munícipe do DandoVoz (NocoBase) entra como LEAD no CRM.
--   • Origem fixa "Gabinete (DandoVoz)";
--   • o "tipo" do munícipe (Solicitante/Liderança/Apoiador/...) vira TAG;
--   • dedup por dandovoz_id (idempotente p/ webhook + backfill), e por
--     telefone/e-mail quando a pessoa já existir no CRM;
--   • guarda bairro/origem do cadastro em `observacao`.
-- LGPD: NÃO gravamos CPF aqui (minimização). opt-in de e-mail fica FALSE
--       (munícipe procurou atendimento, não marketing) — ajuste se quiser.
-- Idempotente: pode rodar de novo sem problema.
-- =====================================================================

-- id externo do DandoVoz p/ casar registros (webhook e backfill)
alter table public.leads add column if not exists dandovoz_id text;
create unique index if not exists ux_leads_dandovoz on public.leads (dandovoz_id) where dandovoz_id is not null;

-- garante a origem fixa
insert into public.origens (nome, tipo, canal, base_legal_padrao, observacao)
select 'Gabinete (DandoVoz)', 'gabinete', 'dandovoz', 'legitimo_interesse',
       'Cadastro de munícipe importado do sistema DandoVoz (NocoBase)'
where not exists (select 1 from public.origens where nome = 'Gabinete (DandoVoz)');

-- =====================================================================
create or replace function public.dandovoz_lead(
  p_nome         text,
  p_email        text,
  p_telefone     text,
  p_cidade       text default null,
  p_bairro       text default null,
  p_tipo         text default null,   -- tipo_municipe (vira tag)
  p_origem_cad   text default null,   -- origem_cadastro_municipe (nota)
  p_dandovoz_id  text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text := nullif(lower(trim(coalesce(p_email,''))), '');
  v_digits  text := regexp_replace(coalesce(p_telefone,''), '\D', '', 'g');
  v_e164    text;
  v_ddd     text;
  v_dvid    text := nullif(trim(coalesce(p_dandovoz_id,'')), '');
  v_origem  uuid;
  v_lead    uuid;
  v_tag     text := nullif(trim(coalesce(p_tipo,'')), '');
  v_nota    text;
begin
  -- telefone -> E.164 (+55...)
  if length(v_digits) >= 10 then
    if left(v_digits,2) <> '55' then v_digits := '55' || v_digits; end if;
    v_e164 := '+' || v_digits;
    v_ddd  := substr(v_digits, 3, 2);
  end if;

  if v_dvid is null and v_email is null and v_e164 is null then
    return null;  -- sem nenhuma chave, não dá pra registrar
  end if;

  if v_tag is not null then v_tag := 'DandoVoz: ' || v_tag; end if;
  v_nota := nullif(concat_ws(' · ',
              nullif(p_origem_cad,''),
              case when nullif(p_bairro,'') is not null then 'Bairro: ' || p_bairro end
            ), '');

  select id into v_origem from public.origens where nome = 'Gabinete (DandoVoz)' limit 1;

  -- acha lead existente: por dandovoz_id, depois e-mail, depois telefone
  select id into v_lead from public.leads
   where (v_dvid  is not null and dandovoz_id = v_dvid)
      or (v_email is not null and email_normalizado = v_email)
      or (v_e164  is not null and telefone_e164 = v_e164)
   order by (dandovoz_id = v_dvid) desc nulls last, created_at asc
   limit 1;

  if v_lead is not null then
    update public.leads set
      dandovoz_id = coalesce(dandovoz_id, v_dvid),
      nome  = coalesce(nullif(nome,''), nullif(p_nome,'')),
      email = coalesce(nullif(email,''), nullif(p_email,'')),
      email_normalizado = coalesce(email_normalizado, v_email),
      telefone_e164 = coalesce(telefone_e164, v_e164),
      ddd = coalesce(ddd, v_ddd),
      cidade_estimada = coalesce(nullif(cidade_estimada,''), nullif(p_cidade,'')),
      tags = case when v_tag is null then tags
                  else (select array(select distinct unnest(coalesce(tags,'{}') || array[v_tag]))) end,
      observacao = coalesce(nullif(observacao,''), v_nota),
      ultima_interacao_em = now(),
      updated_at = now()
    where id = v_lead;
  else
    insert into public.leads
      (nome, email, email_normalizado, telefone_e164, ddd, cidade_estimada,
       origem_id, status_aquecimento, tags, opt_in_email, dandovoz_id,
       observacao, primeira_captura_em, ultima_interacao_em)
    values
      (nullif(p_nome,''), nullif(p_email,''), v_email, v_e164, v_ddd, nullif(p_cidade,''),
       v_origem, 'frio', case when v_tag is null then '{}'::text[] else array[v_tag] end,
       false, v_dvid, v_nota, now(), now())
    returning id into v_lead;
  end if;

  return v_lead;
end;
$$;

grant execute on function public.dandovoz_lead(text,text,text,text,text,text,text,text) to service_role;

-- =====================================================================
-- DEMANDA (ocorrência) do DandoVoz → enriquece o lead do munícipe:
--   • tag "Tema: <tipo da demanda>" (segmentação por assunto);
--   • acrescenta o assunto/situação/prioridade na `observacao` (visível);
--   • se o munícipe ainda não existir no CRM, cria um lead mínimo.
-- Casa o munícipe por dandovoz_id (id do cadastro) ou por telefone/e-mail.
-- =====================================================================
create or replace function public.dandovoz_demanda(
  p_municipe_id  text default null,   -- id do cadastro no DandoVoz (vincular_demanda)
  p_telefone     text default null,
  p_email        text default null,
  p_nome         text default null,
  p_assunto      text default null,   -- assunto_demanda (texto livre)
  p_tema         text default null,   -- tipo_de_Demanda (vira tag)
  p_situacao     text default null,   -- situacao_demanda
  p_prioridade   text default null    -- prioridade_da_demanda
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email  text := nullif(lower(trim(coalesce(p_email,''))), '');
  v_digits text := regexp_replace(coalesce(p_telefone,''), '\D', '', 'g');
  v_e164   text;
  v_mid    text := nullif(trim(coalesce(p_municipe_id,'')), '');
  v_tema   text := nullif(trim(coalesce(p_tema,'')), '');
  v_lead   uuid;
  v_linha  text;
begin
  if length(v_digits) >= 10 then
    if left(v_digits,2) <> '55' then v_digits := '55' || v_digits; end if;
    v_e164 := '+' || v_digits;
  end if;

  -- acha o lead do munícipe (id do cadastro, e-mail ou telefone)
  select id into v_lead from public.leads
   where (v_mid   is not null and dandovoz_id = v_mid)
      or (v_email is not null and email_normalizado = v_email)
      or (v_e164  is not null and telefone_e164 = v_e164)
   order by (dandovoz_id = v_mid) desc nulls last, created_at asc
   limit 1;

  -- se não existir ainda, cria um lead mínimo (a demanda chegou antes do cadastro)
  if v_lead is null then
    v_lead := public.dandovoz_lead(p_nome, p_email, p_telefone, null, null, null, null, v_mid);
  end if;
  if v_lead is null then return null; end if;

  v_linha := nullif(concat_ws(' ',
               'Demanda:', nullif(p_assunto,''),
               case when nullif(v_tema,'') is not null then '[' || v_tema || ']' end,
               case when nullif(p_situacao,'') is not null then '· ' || p_situacao end,
               case when nullif(p_prioridade,'') is not null then '· ' || p_prioridade end
             ), 'Demanda:');

  update public.leads set
    tags = case when v_tema is null then tags
                else (select array(select distinct unnest(coalesce(tags,'{}') || array['Tema: ' || v_tema]))) end,
    observacao = nullif(concat_ws(E'\n', nullif(observacao,''), v_linha), ''),
    status_aquecimento = case when status_aquecimento = 'frio' then 'morno' else status_aquecimento end,
    ultima_interacao_em = now(),
    updated_at = now()
  where id = v_lead;

  return v_lead;
end;
$$;

grant execute on function public.dandovoz_demanda(text,text,text,text,text,text,text,text) to service_role;

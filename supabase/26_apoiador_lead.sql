-- =====================================================================
-- CRM Ana — Fase 26: Apoiador da LP de materiais também vira LEAD no CRM
-- Regra pedida:
--   • cadastro na LP de materiais registra a pessoa em `leads`
--     com a Origem fixa "LP materiais" (criada aqui se não existir);
--   • se a pessoa JÁ é lead → ganha a tag e vira QUENTE (mantém a origem antiga);
--   • lead novo → origem "LP materiais", tag, opt-in e já entra QUENTE
--     (pedir material é sinal forte de engajamento).
-- Dedup por e-mail_normalizado OU telefone_e164 (índices únicos existentes).
-- Idempotente: rode quantas vezes quiser.
-- =====================================================================

-- garante a origem fixa
insert into public.origens (nome, tipo, canal, base_legal_padrao, observacao)
select 'LP materiais', 'formulario', 'landing_page', 'consentimento',
       'Cadastro na LP de materiais de campanha (apoiador)'
where not exists (select 1 from public.origens where nome = 'LP materiais');

-- =====================================================================
create or replace function public.apoiador_vira_lead(
  p_nome        text,
  p_email       text,
  p_whatsapp    text,
  p_uf          text default null,
  p_cidade      text default null,
  p_origem_nome text default 'LP materiais',
  p_tag         text default 'Pediu Material'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text := nullif(lower(trim(coalesce(p_email,''))), '');
  v_digits  text := regexp_replace(coalesce(p_whatsapp,''), '\D', '', 'g');
  v_e164    text;
  v_ddd     text;
  v_origem  uuid;
  v_lead    uuid;
begin
  -- telefone em E.164 (+55...)
  if length(v_digits) >= 10 then
    if left(v_digits,2) <> '55' then v_digits := '55' || v_digits; end if;
    v_e164 := '+' || v_digits;
    v_ddd  := substr(v_digits, 3, 2);
  end if;

  if v_email is null and v_e164 is null then
    return null;  -- sem chave de contato, não dá pra registrar
  end if;

  -- resolve a origem fixa (cria se sumiu)
  select id into v_origem from public.origens where nome = p_origem_nome limit 1;
  if v_origem is null then
    insert into public.origens (nome, tipo, canal, base_legal_padrao)
    values (p_origem_nome, 'formulario', 'landing_page', 'consentimento')
    returning id into v_origem;
  end if;

  -- procura lead existente por e-mail OU telefone
  select id into v_lead from public.leads
   where (v_email is not null and email_normalizado = v_email)
      or (v_e164  is not null and telefone_e164 = v_e164)
   order by created_at asc
   limit 1;

  if v_lead is not null then
    -- JÁ é lead: ganha a tag, vira QUENTE, garante opt-in. Mantém a origem original.
    update public.leads set
      tags = (select array(select distinct unnest(coalesce(tags,'{}') || array[p_tag]))),
      status_aquecimento = 'quente',
      opt_in_email = true,
      nome  = coalesce(nullif(nome,''), nullif(p_nome,'')),
      email = coalesce(nullif(email,''), nullif(p_email,'')),
      email_normalizado = coalesce(email_normalizado, v_email),
      telefone_e164 = coalesce(telefone_e164, v_e164),
      ddd = coalesce(ddd, v_ddd),
      uf  = coalesce(nullif(uf,''), nullif(p_uf,'')),
      cidade_estimada = coalesce(nullif(cidade_estimada,''), nullif(p_cidade,'')),
      ultima_interacao_em = now(),
      updated_at = now()
    where id = v_lead;
  else
    -- lead NOVO: origem "LP materiais", tag, opt-in, já entra QUENTE
    insert into public.leads
      (nome, email, email_normalizado, telefone_e164, ddd, uf, cidade_estimada,
       origem_id, status_aquecimento, tags, opt_in_email,
       primeira_captura_em, ultima_interacao_em)
    values
      (nullif(p_nome,''), nullif(p_email,''), v_email, v_e164, v_ddd,
       nullif(p_uf,''), nullif(p_cidade,''),
       v_origem, 'quente', array[p_tag], true,
       now(), now())
    returning id into v_lead;
  end if;

  return v_lead;
end;
$$;

grant execute on function public.apoiador_vira_lead(text,text,text,text,text,text,text) to service_role;

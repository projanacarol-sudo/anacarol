-- =====================================================================
-- CRM Ana — Fase 29: Leads do DandoVoz passam a entrar COM opt-in de e-mail
--   • redefine dandovoz_lead: novos entram com opt_in_email = true
--     (base legal: legítimo interesse — origem "Gabinete (DandoVoz)");
--   • marca opt-in nos que JÁ entraram (sem mexer em quem se descadastrou);
--   • registra a trilha de consentimento (consent_events) p/ auditoria LGPD.
-- Idempotente. Rode DEPOIS do 28.
-- =====================================================================

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
    v_lead := public.lead_por_contato(v_email, v_e164);
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
      opt_in_email = case when unsubscribed_email then opt_in_email else true end,  -- opt-in, sem reverter descadastro
      ultima_interacao_em = now(), updated_at = now()
    where id = v_lead;
  else
    insert into public.leads
      (nome, email, email_normalizado, telefone_e164, ddd, cidade_estimada,
       origem_id, status_aquecimento, tags, opt_in_email, dandovoz_id, observacao,
       primeira_captura_em, ultima_interacao_em)
    values (nullif(p_nome,''), nullif(p_email,''), v_email, v_e164, v_ddd, nullif(p_cidade,''),
       v_origem, 'frio', case when v_tag is null then '{}'::text[] else array[v_tag] end,
       true, v_dvid, v_nota, now(), now())   -- <<< agora entra COM opt-in
    returning id into v_lead;
  end if;
  return v_lead;
end; $$;

-- ---- marca opt-in nos que JÁ entraram (respeita quem se descadastrou) ----
update public.leads
   set opt_in_email = true, updated_at = now()
 where origem_id = (select id from public.origens where nome = 'Gabinete (DandoVoz)')
   and opt_in_email = false
   and unsubscribed_email = false;

-- ---- trilha de consentimento p/ auditoria (só onde ainda não houver) ----
insert into public.consent_events (lead_id, tipo, canal, base_legal, texto_consentimento, origem_url)
select l.id, 'opt_in', 'email', 'legitimo_interesse',
       'Contato com o Gabinete (DandoVoz) — comunicação da campanha', 'dandovoz'
from public.leads l
where l.origem_id = (select id from public.origens where nome = 'Gabinete (DandoVoz)')
  and l.opt_in_email = true
  and not exists (
    select 1 from public.consent_events c
    where c.lead_id = l.id and c.tipo = 'opt_in' and c.canal = 'email'
  );

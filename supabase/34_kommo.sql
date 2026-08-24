-- =====================================================================
-- CRM Ana — Fase 34: Integração Kommo (CRM de WhatsApp) → CRM
-- Cada lead novo do Kommo entra no nosso CRM, com unificação (lead_por_contato).
--   • origem fixa "Kommo (WhatsApp)";
--   • tag "WhatsApp"; opt-in de WhatsApp = true (veio pelo WhatsApp);
--   • dedup por kommo_id (idempotente) e por telefone/e-mail.
-- Requer as fases 27 e 28 (merge_leads, lead_por_contato).
-- Idempotente.
-- =====================================================================

alter table public.leads add column if not exists kommo_id text;
create unique index if not exists ux_leads_kommo on public.leads (kommo_id) where kommo_id is not null;

insert into public.origens (nome, tipo, canal, base_legal_padrao, observacao)
select 'Kommo (WhatsApp)', 'crm', 'whatsapp', 'legitimo_interesse',
       'Lead recebido pelo Kommo (CRM de WhatsApp da equipe)'
where not exists (select 1 from public.origens where nome = 'Kommo (WhatsApp)');

create or replace function public.kommo_lead(
  p_nome text, p_email text, p_telefone text, p_kommo_id text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_email  text := nullif(lower(trim(coalesce(p_email,''))), '');
  v_digits text := regexp_replace(coalesce(p_telefone,''), '\D', '', 'g');
  v_e164 text; v_ddd text; v_kid text := nullif(trim(coalesce(p_kommo_id,'')), '');
  v_origem uuid; v_lead uuid; v_c uuid;
begin
  if length(v_digits) >= 10 then
    if left(v_digits,2) <> '55' then v_digits := '55' || v_digits; end if;
    v_e164 := '+' || v_digits; v_ddd := substr(v_digits,3,2);
  end if;
  if v_kid is null and v_email is null and v_e164 is null then return null; end if;

  select id into v_origem from public.origens where nome = 'Kommo (WhatsApp)' limit 1;

  if v_kid is not null then select id into v_lead from public.leads where kommo_id = v_kid limit 1; end if;
  if v_lead is null then
    v_lead := public.lead_por_contato(v_email, v_e164);
  else
    v_c := public.lead_por_contato(v_email, v_e164);
    if v_c is not null and v_c <> v_lead then v_lead := public.merge_leads(v_lead, v_c); end if;
  end if;

  if v_lead is not null then
    update public.leads set
      kommo_id = coalesce(kommo_id, v_kid),
      nome = coalesce(nullif(nome,''), nullif(p_nome,'')),
      email = coalesce(nullif(email,''), nullif(p_email,'')),
      email_normalizado = coalesce(email_normalizado, v_email),
      telefone_e164 = coalesce(telefone_e164, v_e164), ddd = coalesce(ddd, v_ddd),
      tags = (select array(select distinct unnest(coalesce(tags,'{}') || array['WhatsApp']))),
      opt_in_whatsapp = true,
      ultima_interacao_em = now(), updated_at = now()
    where id = v_lead;
  else
    insert into public.leads
      (nome, email, email_normalizado, telefone_e164, ddd,
       origem_id, status_aquecimento, tags, opt_in_whatsapp, kommo_id,
       primeira_captura_em, ultima_interacao_em)
    values (nullif(p_nome,''), nullif(p_email,''), v_email, v_e164, v_ddd,
       v_origem, 'frio', array['WhatsApp'], true, v_kid, now(), now())
    returning id into v_lead;
  end if;
  return v_lead;
end; $$;

grant execute on function public.kommo_lead(text,text,text,text) to service_role;

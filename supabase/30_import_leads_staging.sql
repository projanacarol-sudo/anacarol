-- =====================================================================
-- CRM Ana — Fase 30: Importação de leads de planilhas (staging + upsert)
--   1) cria a tabela de staging import_leads_raw;
--   2) você importa o leads_import.csv nela (Supabase → Table editor → Import);
--   3) roda:  select public.importar_do_staging();
-- A importação passa pela UNIFICAÇÃO (lead_por_contato), então funde com o
-- que já existe e entre si; cria a origem se não existir; aplica tag e opt-in;
-- enriquece UF/região/cidade pelo DDD; registra consentimento p/ opt-in.
-- Idempotente: pode importar mais planilhas e rodar de novo.
-- Requer as fases 27 e 28 (dandovoz_id, merge_leads, lead_por_contato).
-- =====================================================================

create table if not exists public.import_leads_raw (
  nome      text,
  email     text,
  telefone  text,
  endereco  text,
  cidade    text,
  uf        text,
  origem    text,
  tag       text,
  opt_in    text        -- "true" / "false"
);

create or replace function public.importar_do_staging()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_email text; v_e164 text; v_ddd text; v_uf text; v_reg text; v_cid text;
  v_origem uuid; v_lead uuid; v_optin boolean; v_nota text;
  n int := 0; criados int := 0; fundidos int := 0; antes int; depois int;
begin
  select count(*) into antes from public.leads;

  for r in select * from public.import_leads_raw loop
    v_email := nullif(lower(trim(coalesce(r.email,''))), '');
    if v_email is not null and position('@' in v_email) = 0 then v_email := null; end if;
    v_e164  := public._e164(r.telefone);
    if v_email is null and v_e164 is null then continue; end if;   -- sem contato
    n := n + 1;
    v_optin := lower(coalesce(r.opt_in,'')) in ('true','1','sim','t','yes');
    v_ddd   := case when v_e164 is not null then substr(regexp_replace(v_e164,'\D','','g'),3,2) end;

    -- geo pelo DDD (se a tabela existir)
    v_uf := nullif(r.uf,''); v_reg := null; v_cid := nullif(r.cidade,'');
    if v_ddd is not null then
      begin
        select g.uf, g.regiao, coalesce(v_cid, g.cidade_principal)
          into v_uf, v_reg, v_cid
          from public.ddd_geo g where g.ddd = v_ddd limit 1;
      exception when undefined_table then null; end;
    end if;

    -- origem (cria se não existir)
    v_origem := null;
    if nullif(trim(coalesce(r.origem,'')),'') is not null then
      select id into v_origem from public.origens where nome = r.origem limit 1;
      if v_origem is null then
        insert into public.origens (nome, tipo, canal, base_legal_padrao)
        values (r.origem, 'importacao', 'planilha',
                case when v_optin then 'consentimento' else 'legitimo_interesse' end)
        returning id into v_origem;
      end if;
    end if;

    v_nota := case when nullif(trim(coalesce(r.endereco,'')),'') is not null
                   then 'Endereço: ' || trim(r.endereco) end;

    v_lead := public.lead_por_contato(v_email, v_e164);

    if v_lead is null then
      insert into public.leads
        (nome, email, email_normalizado, telefone_e164, ddd, uf, regiao, cidade_estimada,
         origem_id, status_aquecimento, tags, opt_in_email, observacao,
         primeira_captura_em, ultima_interacao_em)
      values
        (nullif(trim(coalesce(r.nome,'')),''), nullif(r.email,''), v_email, v_e164, v_ddd,
         v_uf, v_reg, v_cid, v_origem, 'frio',
         case when nullif(trim(coalesce(r.tag,'')),'') is null then '{}'::text[] else array[trim(r.tag)] end,
         v_optin, v_nota, now(), now())
      returning id into v_lead;
      criados := criados + 1;
    else
      update public.leads set
        nome = coalesce(nullif(nome,''), nullif(trim(coalesce(r.nome,'')),'')),
        email = coalesce(nullif(email,''), nullif(r.email,'')),
        email_normalizado = coalesce(email_normalizado, v_email),
        telefone_e164 = coalesce(telefone_e164, v_e164),
        ddd = coalesce(ddd, v_ddd),
        uf = coalesce(nullif(uf,''), v_uf),
        regiao = coalesce(nullif(regiao,''), v_reg),
        cidade_estimada = coalesce(nullif(cidade_estimada,''), v_cid),
        origem_id = coalesce(origem_id, v_origem),
        tags = case when nullif(trim(coalesce(r.tag,'')),'') is null then tags
                    else (select array(select distinct unnest(coalesce(tags,'{}') || array[trim(r.tag)]))) end,
        opt_in_email = case when unsubscribed_email then opt_in_email else (opt_in_email or v_optin) end,
        observacao = case when v_nota is null then observacao
                          else nullif(concat_ws(E'\n', nullif(observacao,''), v_nota),'') end,
        ultima_interacao_em = now(), updated_at = now()
      where id = v_lead;
      fundidos := fundidos + 1;
    end if;

    -- trilha de consentimento p/ opt-in (só onde ainda não houver)
    if v_optin then
      insert into public.consent_events (lead_id, tipo, canal, base_legal, texto_consentimento, origem_url)
      select v_lead, 'opt_in', 'email', 'consentimento',
             'Importação de lista: ' || coalesce(r.origem,'planilha'), 'importacao'
      where not exists (
        select 1 from public.consent_events c
        where c.lead_id = v_lead and c.tipo='opt_in' and c.canal='email');
    end if;
  end loop;

  select count(*) into depois from public.leads;
  return jsonb_build_object('linhas_com_contato', n, 'leads_criados', criados,
                            'atualizados_ou_fundidos', fundidos,
                            'base_antes', antes, 'base_depois', depois, 'em', now());
end;
$$;

grant execute on function public.importar_do_staging() to service_role;

-- Depois de conferir, você pode limpar o staging:
--   truncate table public.import_leads_raw;

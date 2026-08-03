-- PASSO 2: move o staging para a base (rode DEPOIS de importar o CSV)
-- Inclui limpeza de nomes (remove emoji/símbolos dos nomes de formulário).
begin;

-- Helper: limpa nome -> só letras (com acento), espaço, hífen e apóstrofo.
-- Nomes sem nenhuma letra (ex: "€", "28", um telefone) viram NULL.
create or replace function limpa_nome(t text) returns text
language sql immutable as $$
  select initcap(nullif(
           trim(regexp_replace(
             regexp_replace(coalesce(t,''), '[^[:alpha:] .''-]', '', 'g'),
             '\s+', ' ', 'g')),
         ''));
$$;

-- origens novas (uma por abaixo-assinado)
insert into origens (nome,tipo,canal,base_legal_padrao)
select distinct s.origem,'formulario','meta_lead_ads','consentimento'
from stg_import s
where nullif(s.origem,'') is not null
  and not exists (select 1 from origens o where o.nome = s.origem);

-- leads: pula quem já existe por e-mail; anula telefone que já existe na base
insert into leads (nome,email,email_normalizado,telefone_e164,ddd,uf,regiao,cidade_estimada,origem_id,opt_in_email,primeira_captura_em,tags)
select distinct on (lower(trim(s.email)))
  limpa_nome(s.nome),
  nullif(s.email,''),
  lower(trim(s.email)),
  case when nullif(s.telefone,'') is not null
       and not exists (select 1 from leads l where l.telefone_e164 = s.telefone)
       then s.telefone else null end,
  nullif(s.ddd,''), nullif(s.uf,''), nullif(s.regiao,''), nullif(s.cidade,''),
  (select id from origens o where o.nome = s.origem limit 1),
  true,
  nullif(s.captura,'')::timestamptz,
  case when nullif(s.tag,'') is not null then array[s.tag] else '{}'::text[] end
from stg_import s
where nullif(s.email,'') is not null and s.email like '%@%'
  and not exists (select 1 from leads l where l.email_normalizado = lower(trim(s.email)))
order by lower(trim(s.email)), s.captura;

-- trilha de consentimento (LGPD) para os novos leads
insert into consent_events (lead_id,tipo,canal,base_legal,texto_consentimento,origem_url)
select l.id,'opt_in','email','consentimento','Formulário Meta Lead Ads (abaixo-assinado) — importação', null
from leads l join origens o on l.origem_id = o.id
where o.canal = 'meta_lead_ads'
  and not exists (select 1 from consent_events c where c.lead_id = l.id);

-- Corrige nomes já existentes na base que tenham símbolos/emoji
update leads
set nome = limpa_nome(nome)
where nome ~ '[^[:alpha:] .''-]';

commit;

-- conferência
select count(*) as total_leads from leads;

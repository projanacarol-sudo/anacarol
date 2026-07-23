-- =====================================================================
-- CRM Monitor — Ana Carolina  |  Fase 1: Schema base (Supabase / Postgres)
-- Cole este arquivo inteiro no editor SQL do Supabase e clique em "Run".
-- É idempotente: pode rodar de novo sem quebrar (IF NOT EXISTS / ON CONFLICT).
-- =====================================================================

-- Extensões -----------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid()

-- Função de updated_at ------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- =====================================================================
-- 1. ORIGENS  (de onde veio cada lead)
-- =====================================================================
create table if not exists public.origens (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,                       -- ex: "Palestra SP mar/26"
  tipo          text not null default 'importacao',  -- evento | formulario | social | importacao
  canal         text,                                -- youtube | instagram | evento | ...
  base_legal_padrao text,                            -- consentimento | legitimo_interesse | ...
  observacao    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- =====================================================================
-- 2. LEADS  (registro único por pessoa — contém PII)
-- =====================================================================
create table if not exists public.leads (
  id                 uuid primary key default gen_random_uuid(),
  nome               text,
  email              text,
  email_normalizado  text,                 -- lower(trim(email)) — usado para dedup
  telefone_e164      text,                 -- +5511999999999
  ddd                text,                 -- "11"
  uf                 text,                 -- "SP"
  regiao             text,                 -- "Sudeste"
  cidade_estimada    text,
  origem_id          uuid references public.origens(id) on delete set null,
  status_aquecimento text not null default 'frio',   -- frio | morno | quente
  score              integer not null default 0,
  tags               text[] not null default '{}',
  opt_in_email       boolean not null default false,
  opt_in_whatsapp    boolean not null default false,
  unsubscribed_email boolean not null default false,
  resend_contact_id  text,
  primeira_captura_em timestamptz,
  ultima_interacao_em timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
-- Dedup: um e-mail normalizado só existe uma vez (quando houver e-mail)
create unique index if not exists ux_leads_email_norm
  on public.leads (email_normalizado) where email_normalizado is not null;
create unique index if not exists ux_leads_telefone
  on public.leads (telefone_e164) where telefone_e164 is not null;
create index if not exists ix_leads_uf      on public.leads (uf);
create index if not exists ix_leads_origem  on public.leads (origem_id);
create index if not exists ix_leads_status  on public.leads (status_aquecimento);

-- =====================================================================
-- 3. CONSENT_EVENTS  (trilha de auditoria LGPD — append-only)
-- =====================================================================
create table if not exists public.consent_events (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.leads(id) on delete cascade,
  tipo          text not null,             -- opt_in | opt_out | atualizacao
  canal         text not null,             -- email | whatsapp
  base_legal    text,                      -- consentimento | legitimo_interesse
  texto_consentimento text,                -- o texto que a pessoa aceitou
  origem_url    text,
  ip            inet,
  user_agent    text,
  created_at    timestamptz not null default now()
);
create index if not exists ix_consent_lead on public.consent_events (lead_id);

-- =====================================================================
-- 4. E-MAIL (Resend)
-- =====================================================================
create table if not exists public.email_sequences (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  objetivo   text,
  ativo      boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_steps (
  id            uuid primary key default gen_random_uuid(),
  sequence_id   uuid not null references public.email_sequences(id) on delete cascade,
  ordem         integer not null,
  atraso_horas  integer not null default 0,   -- delay desde o passo anterior
  assunto       text not null,
  template_ref  text,                          -- id/slug do template
  resend_broadcast_id text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (sequence_id, ordem)
);

create table if not exists public.lead_sequence_state (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.leads(id) on delete cascade,
  sequence_id   uuid not null references public.email_sequences(id) on delete cascade,
  step_atual    integer not null default 0,
  proximo_envio_em timestamptz,
  status        text not null default 'ativo',   -- ativo | concluido | pausado
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (lead_id, sequence_id)
);
create index if not exists ix_lss_prox on public.lead_sequence_state (proximo_envio_em)
  where status = 'ativo';

create table if not exists public.email_events (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid references public.leads(id) on delete set null,
  email_id    text,                          -- id do envio no Resend
  tipo        text not null,                 -- sent|delivered|opened|clicked|bounced|complained|unsubscribed
  url_clicada text,
  payload     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists ix_email_events_lead on public.email_events (lead_id);
create index if not exists ix_email_events_tipo on public.email_events (tipo);

-- =====================================================================
-- 5. WHATSAPP E GRUPOS (ZapFlow + SendFlow)
-- =====================================================================
create table if not exists public.groups (
  id                uuid primary key default gen_random_uuid(),
  sendflow_group_id text,
  campaign_id       text,                    -- campanha do SendFlow
  nome              text,
  tema              text,
  qtd_membros       integer not null default 0,
  ativo             boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists ux_groups_sfid on public.groups (sendflow_group_id)
  where sendflow_group_id is not null;

create table if not exists public.group_events (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid references public.groups(id) on delete set null,
  lead_id    uuid references public.leads(id) on delete set null,
  tipo       text not null,                  -- entrou | saiu | mensagem
  numero     text,                           -- data.number do SendFlow
  payload    jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ix_group_events_group on public.group_events (group_id);
create index if not exists ix_group_events_dia on public.group_events (created_at);

create table if not exists public.whatsapp_events (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid references public.leads(id) on delete set null,
  tipo          text not null,               -- enviado|entregue|lido|respondido|falha
  numero_origem text,                        -- de qual número saiu
  payload       jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists ix_wa_events_lead on public.whatsapp_events (lead_id);

-- =====================================================================
-- 6. CAPTURA (formulários embed)
-- =====================================================================
create table if not exists public.capture_forms (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null,
  slug         text not null unique,
  campos_json  jsonb not null default '[]',
  texto_optin  text,
  origem_id    uuid references public.origens(id) on delete set null,
  redirect_url text,
  ativo        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.form_submissions (
  id          uuid primary key default gen_random_uuid(),
  form_id     uuid references public.capture_forms(id) on delete set null,
  payload_json jsonb not null,
  ip          inet,
  user_agent  text,
  processado  boolean not null default false,
  lead_id     uuid references public.leads(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists ix_form_sub_proc on public.form_submissions (processado)
  where processado = false;

-- =====================================================================
-- 7. MONITORAMENTO SOCIAL
-- =====================================================================
create table if not exists public.social_accounts (
  id          uuid primary key default gen_random_uuid(),
  plataforma  text not null,                 -- youtube | instagram | tiktok
  handle      text,
  account_ref text,                          -- channel_id / ig_user_id
  token_ref   text,                          -- nome do secret no Cloudflare
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.social_metrics (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.social_accounts(id) on delete cascade,
  seguidores     integer,
  visualizacoes  bigint,
  alcance        integer,
  engajamento    integer,
  publicacoes    integer,
  coletado_em    timestamptz not null default now()
);
create index if not exists ix_social_metrics_acc on public.social_metrics (account_id, coletado_em);

-- =====================================================================
-- 8. GEO por DDD (tabela de referência)
-- =====================================================================
create table if not exists public.ddd_geo (
  ddd             text primary key,
  uf              text not null,
  regiao          text not null,
  cidade_principal text
);

-- =====================================================================
-- 9. OPERAÇÃO (usuários do painel + auditoria de ações)
-- =====================================================================
create table if not exists public.app_users (
  id         uuid primary key,              -- = auth.users.id do Supabase Auth
  nome       text,
  email      text,
  papel      text not null default 'operador',  -- admin | operador
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor      text,
  acao       text not null,
  entidade   text,
  entidade_id text,
  payload    jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ix_audit_dia on public.audit_log (created_at);

-- =====================================================================
-- 10. Gatilhos de updated_at
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'origens','leads','email_sequences','email_steps','lead_sequence_state',
    'groups','capture_forms','social_accounts'
  ] loop
    execute format(
      'drop trigger if exists trg_%1$s_updated on public.%1$s;
       create trigger trg_%1$s_updated before update on public.%1$s
       for each row execute function public.set_updated_at();', t);
  end loop;
end $$;

-- =====================================================================
-- 11. SEED — DDDs do Brasil (67 códigos → UF / região / cidade principal)
-- =====================================================================
insert into public.ddd_geo (ddd, uf, regiao, cidade_principal) values
  ('11','SP','Sudeste','São Paulo'),
  ('12','SP','Sudeste','São José dos Campos'),
  ('13','SP','Sudeste','Santos'),
  ('14','SP','Sudeste','Bauru'),
  ('15','SP','Sudeste','Sorocaba'),
  ('16','SP','Sudeste','Ribeirão Preto'),
  ('17','SP','Sudeste','São José do Rio Preto'),
  ('18','SP','Sudeste','Presidente Prudente'),
  ('19','SP','Sudeste','Campinas'),
  ('21','RJ','Sudeste','Rio de Janeiro'),
  ('22','RJ','Sudeste','Campos dos Goytacazes'),
  ('24','RJ','Sudeste','Volta Redonda'),
  ('27','ES','Sudeste','Vitória'),
  ('28','ES','Sudeste','Cachoeiro de Itapemirim'),
  ('31','MG','Sudeste','Belo Horizonte'),
  ('32','MG','Sudeste','Juiz de Fora'),
  ('33','MG','Sudeste','Governador Valadares'),
  ('34','MG','Sudeste','Uberlândia'),
  ('35','MG','Sudeste','Poços de Caldas'),
  ('37','MG','Sudeste','Divinópolis'),
  ('38','MG','Sudeste','Montes Claros'),
  ('41','PR','Sul','Curitiba'),
  ('42','PR','Sul','Ponta Grossa'),
  ('43','PR','Sul','Londrina'),
  ('44','PR','Sul','Maringá'),
  ('45','PR','Sul','Foz do Iguaçu'),
  ('46','PR','Sul','Francisco Beltrão'),
  ('47','SC','Sul','Joinville'),
  ('48','SC','Sul','Florianópolis'),
  ('49','SC','Sul','Chapecó'),
  ('51','RS','Sul','Porto Alegre'),
  ('53','RS','Sul','Pelotas'),
  ('54','RS','Sul','Caxias do Sul'),
  ('55','RS','Sul','Santa Maria'),
  ('61','DF','Centro-Oeste','Brasília'),
  ('62','GO','Centro-Oeste','Goiânia'),
  ('63','TO','Norte','Palmas'),
  ('64','GO','Centro-Oeste','Rio Verde'),
  ('65','MT','Centro-Oeste','Cuiabá'),
  ('66','MT','Centro-Oeste','Rondonópolis'),
  ('67','MS','Centro-Oeste','Campo Grande'),
  ('68','AC','Norte','Rio Branco'),
  ('69','RO','Norte','Porto Velho'),
  ('71','BA','Nordeste','Salvador'),
  ('73','BA','Nordeste','Itabuna'),
  ('74','BA','Nordeste','Juazeiro'),
  ('75','BA','Nordeste','Feira de Santana'),
  ('77','BA','Nordeste','Vitória da Conquista'),
  ('79','SE','Nordeste','Aracaju'),
  ('81','PE','Nordeste','Recife'),
  ('82','AL','Nordeste','Maceió'),
  ('83','PB','Nordeste','João Pessoa'),
  ('84','RN','Nordeste','Natal'),
  ('85','CE','Nordeste','Fortaleza'),
  ('86','PI','Nordeste','Teresina'),
  ('87','PE','Nordeste','Petrolina'),
  ('88','CE','Nordeste','Juazeiro do Norte'),
  ('89','PI','Nordeste','Picos'),
  ('91','PA','Norte','Belém'),
  ('92','AM','Norte','Manaus'),
  ('93','PA','Norte','Santarém'),
  ('94','PA','Norte','Marabá'),
  ('95','RR','Norte','Boa Vista'),
  ('96','AP','Norte','Macapá'),
  ('97','AM','Norte','Coari'),
  ('98','MA','Nordeste','São Luís'),
  ('99','MA','Nordeste','Imperatriz')
on conflict (ddd) do nothing;

-- =====================================================================
-- 12. RLS — Row Level Security
--   Regra: o painel usa Supabase Auth (papel 'authenticated' = equipe interna).
--   O Worker do Cloudflare escreve com a service_role key, que IGNORA o RLS.
--   'anon' fica sem nenhuma policy => sem acesso.
-- =====================================================================

-- Liga RLS em todas as tabelas
do $$
declare t text;
begin
  foreach t in array array[
    'origens','leads','consent_events','email_sequences','email_steps',
    'lead_sequence_state','email_events','groups','group_events','whatsapp_events',
    'capture_forms','form_submissions','social_accounts','social_metrics',
    'ddd_geo','app_users','audit_log'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- Tabelas de cadastro/operação: equipe interna tem CRUD completo
do $$
declare t text;
begin
  foreach t in array array[
    'origens','leads','email_sequences','email_steps','lead_sequence_state',
    'groups','capture_forms','social_accounts','app_users'
  ] loop
    execute format('drop policy if exists staff_all on public.%I;', t);
    execute format(
      'create policy staff_all on public.%I
         for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;

-- Tabelas de eventos/auditoria: equipe só LÊ (escrita vem do Worker via service_role)
do $$
declare t text;
begin
  foreach t in array array[
    'consent_events','email_events','group_events','whatsapp_events',
    'social_metrics','form_submissions','audit_log'
  ] loop
    execute format('drop policy if exists staff_read on public.%I;', t);
    execute format(
      'create policy staff_read on public.%I
         for select to authenticated using (true);', t);
  end loop;
end $$;

-- ddd_geo: tabela de referência, leitura para a equipe
drop policy if exists staff_read on public.ddd_geo;
create policy staff_read on public.ddd_geo
  for select to authenticated using (true);

-- =====================================================================
-- FIM — schema base pronto.
-- Próximo passo (Fase 2): endpoint /api/capture + widget embed.
-- =====================================================================

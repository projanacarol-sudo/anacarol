# CRM Ana — Captura (Cloudflare Pages + Functions)

Monorepo do CRM da Ana Carolina. Nesta fase, entrega a **captura de leads**: um formulário embed + o endpoint `/api/capture` que grava o lead no Supabase, registra o consentimento (LGPD), enriquece o estado pelo DDD e sincroniza no Resend.

## Estrutura

```
.
├── functions/
│   └── api/
│       ├── capture.js     → POST /api/capture   (Pages Function)
│       └── health.js      → GET  /api/health
├── widget-captura.js      → servido em /widget-captura.js (asset estático)
├── index.html             → página de captura de exemplo (/)
├── painel.html            → o CRM operacional (/painel.html)
├── monitor.html           → o monitor de audiência, estilo relatório (/monitor.html)
├── _headers               → cache + CORS do widget
└── supabase/
    ├── 01_schema.sql      → schema do banco (Fase 1)
    └── 02_views.sql       → funções de agregação do painel (Fase 4)
```

Regra do Cloudflare Pages: **tudo fora de `/functions` é estático**; arquivos em `/functions` viram rotas de API automaticamente. Sem build, sem terminal.

## Deploy (uma vez)

1. Faça commit destes arquivos no repositório da Ana.
2. Cloudflare → **Workers & Pages → Create → Pages → Connect to Git** → selecione o repo.
3. Build settings: **Framework preset = None**, **Build command = vazio**, **Output directory = `/`** (raiz). Salvar e implantar.
4. Em **Settings → Environment variables** (produção), adicione:

   | Nome | Tipo | Valor |
   |---|---|---|
   | `SUPABASE_URL` | Plaintext | Project URL do Supabase |
   | `SUPABASE_SERVICE_KEY` | **Secret** | chave `service_role` |
   | `RESEND_API_KEY` | **Secret** | chave da API do Resend |
   | `RESEND_AUDIENCE_ID` | Plaintext | Audience ID do Resend |
   | `ALLOWED_ORIGINS` | Plaintext | *(opcional)* domínios das páginas dela, separados por vírgula |

5. Reimplante (Deployments → Retry) para aplicar as variáveis.

> A `service_role` fica **só** nas variáveis do Pages (server-side). Nunca no widget nem no HTML.

A partir daqui, todo `git push` na branch de produção reimplanta sozinho.

## Testar

- `GET https://SEU-PROJETO.pages.dev/api/health` → `{"ok":true}`
- Abra `https://SEU-PROJETO.pages.dev/` → formulário de exemplo. Envie um teste com telefone + DDD.
- Confira no Supabase: `leads` (com `uf` preenchida), `consent_events`, `form_submissions`; e no Resend, a Audience.

## Usar nas páginas da Ana (embed em site externo)

```html
<div id="captura-ana"></div>
<script src="https://SEU-PROJETO.pages.dev/widget-captura.js"
        data-endpoint="https://SEU-PROJETO.pages.dev/api/capture"
        data-form="palestra-sp"
        data-target="#captura-ana"
        data-titulo="Quero receber os conteúdos"
        data-botao="Entrar na lista"
        data-optin="Autorizo a Ana Carolina a me enviar e-mails e mensagens no WhatsApp."></script>
```

Em site externo, use o `data-endpoint` **absoluto** (com o domínio do Pages). Na própria `index.html` deste projeto, o endpoint é relativo (`/api/capture`), porque é a mesma origem.

## Cadastrar um formulário/origem (opcional, recomendado)

No Supabase → SQL Editor:

```sql
insert into origens (nome, tipo, canal, base_legal_padrao)
values ('Palestra SP mar/26','evento','evento','consentimento')
returning id;

insert into capture_forms (nome, slug, texto_optin, origem_id, redirect_url)
values ('Captura Palestra SP','palestra-sp',
        'Autorizo receber e-mails e mensagens da Ana Carolina.',
        'COLE_O_id_DA_ORIGEM','');
```

O `slug` (`palestra-sp`) é o que liga o `data-form` do widget à origem no banco.

---

# Painel / CRM (`/painel.html`)

Dashboard de página única: login real, 4 abas (Visão geral, Leads, E-mail/Funil, Grupos e Redes), gráficos, edição de leads, adição a sequência e exportação CSV. Lê o Supabase direto do navegador — quem protege os dados é o RLS + login.

## Ativar (uma vez)

1. **Rodar as agregações:** Supabase → SQL Editor → cole `supabase/02_views.sql` → Run.
2. **Criar o login da equipe:** Supabase → **Authentication → Users → Add user** → defina e-mail e senha (esse é o acesso ao painel). Repita para cada pessoa da equipe.
3. **Configurar o painel:** abra `painel.html` e preencha as duas linhas no topo (bloco CONFIG):
   ```js
   const SUPABASE_URL = "https://SEU-PROJETO.supabase.co";
   const SUPABASE_ANON_KEY = "SUA_ANON_KEY_AQUI";
   ```
   Pegue os dois em **Project Settings → API**. A **anon key** (não a service_role!) é pública por design; o RLS é quem protege.
4. Commit + push. O Pages publica sozinho.

## Usar

Acesse `https://SEU-PROJETO.pages.dev/painel.html`, faça login com o usuário criado no passo 2.

- **Visão geral:** totais, opt-in, WhatsApp, novos em 30 dias; crescimento por mês; aquecimento; leads por estado.
- **Leads:** busca por nome/e-mail, filtros (UF, origem, status, opt-in), paginação. Botão **Editar** abre o lead para alterar dados/tags/status, marcar opt-in e **adicionar a uma sequência** de e-mail. **Exportar CSV** baixa o segmento filtrado.
- **E-mail / Funil:** eventos do Resend (enviados/abertos/cliques/descadastros) e sequências ativas — populam quando o funil rodar.
- **Grupos e Redes:** grupos do SendFlow e métricas sociais — populam nas fases seguintes.

> Segurança: a `service_role` continua **só** nas variáveis do Pages (server-side, usada pelo `/api/capture`). O painel usa a **anon key** + Supabase Auth; o RLS já criado limita o acesso a usuários logados.

---

# Funil de e-mail ("ZapFlow do e-mail")

Construtor de sequências + motor de envio automático (Resend) + rastreamento. A lógica de envio é a Function `/api/engine/tick`, disparada a cada minuto pelo `pg_cron` do Supabase.

## Ativar (uma vez)

1. **SQL:** rode `supabase/06_email_funil.sql` (colunas, RPCs de inscrição/stats, extensões `pg_cron`/`pg_net`).
2. **Variáveis no Pages** (Settings → Environment variables):

   | Nome | Valor |
   |---|---|
   | `RESEND_API_KEY` | (já existe) chave do Resend |
   | `RESEND_FROM` | `Ana Carolina <contato@SEU-DOMINIO>` (domínio verificado no Resend) |
   | `ENGINE_KEY` | uma chave forte inventada por você |
   | `PUBLIC_BASE` | `https://SEU-PROJETO.pages.dev` |
   | `RESEND_WEBHOOK_SECRET` | (opcional) segredo do webhook no Resend |

3. **Agendador:** no fim do `06_email_funil.sql` há um bloco comentado. Edite a URL (`/api/engine/tick`) e a chave (= `ENGINE_KEY`), descomente e rode. Isso liga o cron de 1 em 1 minuto.
4. **Webhook do Resend:** no painel do Resend → Webhooks → aponte para `https://SEU-PROJETO.pages.dev/api/webhooks/resend` (eventos delivered/opened/clicked/bounced/complained). Se definir um Signing Secret, coloque em `RESEND_WEBHOOK_SECRET`.
5. Push do repo.

## Usar (no painel, aba E-mail / Funil)

- **+ Nova sequência:** nome, remetente, ativo. Depois **Abrir** → adicione **passos** (ordem, atraso em horas, assunto, corpo HTML). Use `{{nome}}` para o primeiro nome.
- **Inscrever segmento:** escolhe o funil e filtra por estado / origem / tag / opt-in — joga o segmento no funil de uma vez.
- **Auto-inscrição:** dentro do funil, ligue uma **origem**; todo lead novo capturado por ela entra sozinho.
- O motor manda o passo 0 na entrada e os seguintes conforme o atraso de cada passo. Descadastro é automático (link no rodapé + `/api/unsub`), e o RLS/LGPD ficam preservados.

Endpoints novos: `/api/engine/tick` (motor, protegido por `ENGINE_KEY`), `/api/webhooks/resend` (eventos), `/api/unsub` (descadastro).

---

# Monitor de audiência (`/monitor.html`)

Relatório visual no estilo "Central de Relatórios" (placar por estado, abas por canal, gráficos de entrada por dia). Ideal para apresentar à cliente. Mesmo login do painel.

**Ativar:** rode `supabase/04_monitor.sql` no SQL Editor (funções `crm_por_dia`, `crm_estado`). Depois acesse `/monitor.html`.

Edite a marca no topo do arquivo (bloco `MARCA`): nome, subtítulo, site, foto e o estado-foco (padrão `SP`). As abas WhatsApp, E-mail e do estado-foco já acendem com a base; YouTube e Instagram ficam como "aguardando conexão" até ligarmos as redes.

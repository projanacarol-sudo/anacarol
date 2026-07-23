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
├── _headers               → cache + CORS do widget
└── supabase/
    └── 01_schema.sql      → schema do banco (Fase 1, histórico)
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

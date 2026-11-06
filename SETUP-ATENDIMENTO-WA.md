# Atendimento WhatsApp no CRM — Fase 1 (inbox) · Guia de setup

Substitui o Kommo. Inbox nativo via **Evolution API**, com departamentos
(SQG / Comercial / Central de Leads), conversas ao vivo e resposta pelo painel.
IA de 1º atendimento e migração do Kommo são as próximas fases.

## 1. Variáveis no Cloudflare Pages (Settings → Environment variables)
Já existem: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`.
Adicionar:

- `EVOLUTION_URL` = `https://evo.eusamuelcosta.com.br`  (sua Evolution)
- `EVOLUTION_KEY` = a **API key global** da Evolution (não colar em chat)
- `EVOLUTION_INSTANCE` = nome da instância. **Comece com uma de teste**, ex.: `gabinete-teste`
- `WA_WEBHOOK_KEY` = um segredo qualquer (ex.: gere uma senha longa). Protege o webhook.

## 2. Banco
Rode `supabase/46_whatsapp.sql` no SQL Editor do Supabase (cria tabelas,
departamentos, RLS e liga o Realtime).

## 3. Subir o código
Suba a v114 no GitHub (arraste a pasta inteira, com `functions` junto).

## 4. Conectar um número de TESTE primeiro (não encosta no Kommo)
1. Abra **/atendimento.html** e faça login (mesmo login do CRM).
2. Clique em **Conectar WhatsApp** → **Criar instância**.
   - Isso cria a instância na Evolution e já aponta o webhook para
     `/api/wa/webhook?key=...` automaticamente.
3. Aparece o **QR Code** → escaneie com um **número de teste**
   (WhatsApp → Aparelhos conectados → Conectar aparelho).
4. O indicador no topo fica **Conectado** (verde).

## 5. Testar
- De outro celular, mande uma mensagem para o número de teste.
- A conversa aparece na lista **ao vivo**; abra e **responda** pelo painel.
- A resposta chega no celular. Mude o **status** (Novo/Em atendimento/Resolvido)
  e veja a conversa se organizar.

## 6. Virada do número real (só depois de validar o teste)
> Um número só fica ativo em um lugar por vez. Fazer em horário de baixo movimento.
1. **Desconecte o número do Kommo** (no Kommo, remova/desconecte o canal WhatsApp Business daquele número).
2. Troque `EVOLUTION_INSTANCE` para a instância do número real (ex.: `gabinete-ana`) e redeploy, **ou** em **Conectar WhatsApp** gere o QR da nova instância.
3. Escaneie o QR com o **número oficial do gabinete**.
4. Pronto: as mensagens passam a cair no CRM.

## Próximas fases
- **Fase 2:** fila/transferência entre atendentes, atribuição por departamento, permissões, mídias (áudio/imagem) completas.
- **Fase 3:** IA de 1º atendimento (humanizada, provedor a definir — Gemini), roteamento automático, e **migração dos dados/histórico do Kommo** via API (subdomínio real: `anacarolinaoliveiraoficial1`).

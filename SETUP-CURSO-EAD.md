# Área de Membros (EAD) — Curso Silêncio que Grita

Curso gratuito com login de aluno próprio, 8 módulos / 17 aulas, progresso,
certificado e tudo ligado ao CRM (cada aluno vira/une um lead).

## Variáveis no Cloudflare Pages
Já existem: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`.
Adicionar:
- `EAD_SECRET` = um segredo longo e aleatório (assina o token de login do aluno). Não colar em chat.

## Banco
Rode `supabase/47_ead.sql` no SQL Editor do Supabase (cria as tabelas, RLS e
já cria os 8 módulos vazios + a origem "Curso Silêncio que Grita").

## Subir
Suba a v116 no GitHub (arraste a pasta inteira, com `functions`).

## Preencher o conteúdo (admin)
1. Abra **/curso-admin.html** e faça login (mesmo login da equipe do CRM).
2. Em cada módulo, clique **+ Aula**, abra a aula e preencha:
   - **Título**, **Duração**, **Descrição**;
   - **Embed do Smart Player**: cole o código de incorporação (iframe/script) do vídeo;
   - **Materiais**: título + URL (PDF/link) por material.
3. Marque a aula como **visível**. Ajuste a ordem dos módulos/aulas.
   (As 17 aulas podem ser distribuídas entre os 8 módulos como você quiser.)

## Como o aluno usa
- Página pública: **/curso.html** → cria conta (nome, WhatsApp, e-mail, senha) ou entra.
- Assiste as aulas, baixa materiais e marca cada aula como concluída.
- Ao concluir todas, aparece **Emitir certificado** → abre **/certificado.html**
  com o nome dele, pronto para imprimir/salvar em PDF.

## Ligação com o CRM
- Cada aluno é criado/unido como **lead** (origem "Curso Silêncio que Grita", tag `Aluno SQG`).
- Ao concluir o curso, o lead ganha as tags **`Apoiador Capacitado`** e
  `Curso SQG concluído` e vira **quente** — dá pra filtrar e acompanhar no painel.

## Observações
- Login de aluno é **separado** do login da equipe (segurança): aluno não acessa o CRM.
- O rastreamento de "assistiu o vídeo" nesta versão é pelo botão **Marcar como concluída**.
  Dá pra evoluir depois para marcar automático quando o Smart Player sinalizar fim do vídeo.

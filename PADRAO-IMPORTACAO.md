# Padrão de importação de leads — CRM Ana

A dashboard e o monitor **só leem a tabela `leads`**. Qualquer fonte de leads
(Sympla, Meta Lead Ads, formulário de captura, planilha manual…) é normalizada
para o mesmo padrão antes de entrar. Assim o painel nunca depende do formato de origem.

```
CSV da fonte (colunas quaisquer)
        │   normalização (limpeza + DDD + dedup)
        ▼
stg_import (padrão de entrada, 10 colunas)   ← você importa o CSV aqui
        │   05b_mover_para_base.sql
        ▼
leads (padrão canônico)                      ← a dashboard lê SÓ isto
        │
        ▼
funções crm_* → painel.html / monitor.html
```

---

## 1. Padrão canônico — tabela `leads` (o que a dashboard usa)

Toda origem vira uma linha aqui, sempre com estas colunas:

| Coluna | O que é |
|---|---|
| `nome` | Nome completo |
| `email` | E-mail original |
| `email_normalizado` | `lower(trim(email))` — usado para deduplicar |
| `telefone_e164` | Telefone em formato `+55DDDNÚMERO` (único na base) |
| `ddd` | DDD (2 dígitos) |
| `uf` / `regiao` / `cidade_estimada` | Deduzidos do DDD |
| `origem_id` | Aponta para a tabela `origens` (de onde o lead veio) |
| `opt_in_email` | Consentimento de e-mail |
| `primeira_captura_em` | Data de entrada (inscrição/lead/captura) |
| `tags` | Marcadores (ex: `telefone_revisar`, `telefone_duplicado`) |
| `status_aquecimento`, `score`, `unsubscribed_email`, `resend_contact_id` | Operacionais (preenchidos ao longo do uso) |

Regras de integridade:
- **`email_normalizado` é único** (não entra e-mail repetido).
- **`telefone_e164` é único** (telefone repetido é anulado, não duplica o lead).

---

## 2. Padrão de entrada — tabela `stg_import` (o CSV que você importa)

Sempre estas 10 colunas, nesta ordem:

```
nome, email, telefone, ddd, uf, regiao, cidade, origem, captura, tag
```

- `telefone` já vem em `+55DDDNÚMERO` (ou vazio).
- `origem` é o nome legível da origem (ex: "Abaixo-assinado: Aumento da pena mínima").
- `captura` é a data (`YYYY-MM-DD HH:MM:SS`).
- `tag` é um marcador único ou vazio.

Esse CSV é **gerado na normalização** — não é o arquivo cru da fonte.

---

## 3. Processo reutilizável (todo lote novo)

1. **Me manda o CSV/Excel cru da fonte** (qualquer formato).
2. Eu limpo, dedup, enriqueço por DDD e devolvo: um **CSV no padrão de entrada** + eventuais ajustes de SQL.
3. Você roda **`05a_criar_staging.sql`** (cria/limpa `stg_import`).
4. **Table Editor → `stg_import` → Import data from CSV** → seleciona o CSV.
5. Você roda **`05b_mover_para_base.sql`** (dedup contra o que já existe + move para `leads` + trilha de consentimento).
6. Recarrega painel/monitor.

O passo 2 é o único que muda por fonte (o mapeamento das colunas). Os passos 3–6 são **sempre iguais**.

---

## 4. Como cada fonte já foi mapeada

| Fonte | Colunas de origem | Viram no padrão |
|---|---|---|
| **Sympla** (palestras) | `Nome`+`Sobrenome`, `Email`, `Telefone (DDD + número)`, `Data compra` | `nome`, `email`, `telefone`, `captura` |
| **Meta Lead Ads** (abaixo-assinados) | `full_name` / `Nome e Sobrenome`, `email`, `phone_number`, `created_time` | `nome`, `email`, `telefone`, `captura` |
| **Formulário de captura** (site) | payload do widget | grava direto na `leads` via `/api/capture` |

Fonte nova = só descrever as colunas dela; o resto do fluxo não muda.

-- =====================================================================
-- CRM Ana — Fase 33: validação de e-mail mais ESTRITA
-- A validação anterior aceitava caracteres que o Resend recusa (ex.: `*`,
-- acentos) — um único desses derruba o lote inteiro. Aqui apertamos o
-- email_ok() para o conjunto real de e-mail e re-limpamos a base.
-- Idempotente. Rode depois do 32.
-- =====================================================================

create or replace function public.email_ok(v text)
returns boolean language sql immutable as $$
  select v is not null
     and v ~* '^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$'
$$;

-- re-limpa: tira do pool de envio quem não passa na validação estrita
update public.leads
   set email_normalizado = null, updated_at = now()
 where email_normalizado is not null
   and not public.email_ok(email_normalizado);

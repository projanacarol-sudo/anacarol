-- =====================================================================
-- CRM Ana — LIGAR o relatório de eventos automático (2×/dia: 9h e 18h BRT)
--
-- COMO USAR (leva 30 segundos):
--   1) Troque   COLE_AQUI_SUA_ENGINE_KEY   pela MESMA chave ENGINE_KEY que
--      você já usa no Cloudflare (a que protege o motor de e-mail).
--   2) (opcional) confira a URL — já está com o seu domínio.
--   3) Rode este arquivo inteiro no SQL Editor do Supabase. Pronto.
--
-- Este arquivo JÁ ESTÁ DESCOMENTADO — é só trocar a chave e apertar Run.
-- Rodar de novo não duplica: ele remove o agendamento anterior antes de criar.
-- =====================================================================

-- garante as extensões do agendador (já existem se o motor de e-mail roda)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- remove um agendamento anterior com o mesmo nome (evita duplicar)
select cron.unschedule('relatorio-eventos')
where exists (select 1 from cron.job where jobname = 'relatorio-eventos');

-- agenda: 12h e 21h UTC  ==  9h e 18h no horário de Brasília
select cron.schedule('relatorio-eventos', '0 12,21 * * *', $cron$
  select net.http_post(
    url     := 'https://lp.anacarolinaoliveira.com.br/api/relatorio-eventos',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-engine-key', 'COLE_AQUI_SUA_ENGINE_KEY'
               )
  );
$cron$);

-- conferir se ficou agendado:
--   select jobname, schedule, active from cron.job where jobname = 'relatorio-eventos';
-- desligar depois, se quiser:
--   select cron.unschedule('relatorio-eventos');
-- =====================================================================
-- FIM
-- =====================================================================

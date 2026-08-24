-- =====================================================================
-- CRM Ana — Fase 35: gravação em lote dos contatos do Kommo (backfill)
-- Recebe um array [{nome,email,telefone,kommo_id?}] e grava cada um via
-- kommo_lead (unificação). Uma chamada = uma página do Kommo (evita estourar
-- o limite de sub-requisições do Cloudflare). Idempotente.
-- Requer a fase 34 (kommo_lead).
-- =====================================================================
create or replace function public.kommo_backfill(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0; ok int := 0; v uuid;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    n := n + 1;
    v := public.kommo_lead(
           coalesce(r->>'nome',''), coalesce(r->>'email',''),
           coalesce(r->>'telefone',''), nullif(r->>'kommo_id',''));
    if v is not null then ok := ok + 1; end if;
  end loop;
  return jsonb_build_object('recebidos', n, 'gravados', ok);
end; $$;

grant execute on function public.kommo_backfill(jsonb) to service_role;

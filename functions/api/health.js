/** Health check: GET /api/health -> {"ok":true} */
export async function onRequestGet() {
  return new Response(
    JSON.stringify({ ok: true, service: "crm-ana", ts: new Date().toISOString() }),
    { headers: { "Content-Type": "application/json" } }
  );
}

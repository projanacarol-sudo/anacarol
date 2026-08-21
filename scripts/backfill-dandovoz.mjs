#!/usr/bin/env node
/**
 * Backfill: lê os cadastros que JÁ existem no DandoVoz (NocoBase) e envia
 * cada um para o CRM (endpoint /api/dandovoz), reaproveitando a mesma
 * dedup/idempotência do webhook.
 *
 * Como usar (Node 18+):
 *   DANDOVOZ_API="https://sistema.dandovoz.com.br" \
 *   DANDOVOZ_TOKEN="<API_KEY_do_NocoBase>" \
 *   CRM_URL="https://anacarol.pages.dev/api/dandovoz" \
 *   DANDOVOZ_KEY="<mesmo_segredo_do_endpoint>" \
 *   node scripts/backfill-dandovoz.mjs --dry     # só mostra os 5 primeiros
 *
 *   ...sem --dry para importar de verdade.
 *
 * Opcionais:
 *   COLECAO=cadastro         (nome da coleção no NocoBase)
 *   PAGE_SIZE=200
 *   APPENDS="tipo_municipe,cidade_municipe,origem_cadastro_municipe"  (relações a expandir)
 */

const API      = (process.env.DANDOVOZ_API || "").replace(/\/+$/, "");
const TOKEN    = process.env.DANDOVOZ_TOKEN || "";
const CRM_URL  = process.env.CRM_URL || "";
const CRM_KEY  = process.env.DANDOVOZ_KEY || "";
const COLECAO  = process.env.COLECAO || "cadastro";
const PAGE_SZ  = Number(process.env.PAGE_SIZE || 200);
const APPENDS  = (process.env.APPENDS || "tipo_municipe,cidade_municipe,origem_cadastro_municipe")
                   .split(",").map(s => s.trim()).filter(Boolean);
const DRY      = process.argv.includes("--dry");

if (!API || !TOKEN) { console.error("Faltam DANDOVOZ_API e/ou DANDOVOZ_TOKEN"); process.exit(1); }
if (!DRY && (!CRM_URL || !CRM_KEY)) { console.error("Faltam CRM_URL e/ou DANDOVOZ_KEY (necessários fora do --dry)"); process.exit(1); }

// pega um "rótulo" de campo que pode ser string OU objeto (relação NocoBase)
function label(v) {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object") {
    for (const k of ["nome", "label", "title", "name", "value", "text", "nome_municipe"]) {
      if (v[k] != null && String(v[k]).trim() !== "") return String(v[k]);
    }
    if (v.id != null) return String(v.id);
  }
  return "";
}

function mapear(rec) {
  return {
    dandovoz_id: rec.id != null ? String(rec.id) : "",
    nome:     label(rec.nome_municipe),
    telefone: label(rec.telefone_municipe),
    email:    label(rec.email_municipe),
    cidade:   label(rec.cidade_municipe),
    bairro:   label(rec.bairro_municipe),
    tipo:     label(rec.tipo_municipe),
    origem:   label(rec.origem_cadastro_municipe),
  };
}

async function buscarPagina(page) {
  const u = new URL(`${API}/api/${COLECAO}:list`);
  u.searchParams.set("page", String(page));
  u.searchParams.set("pageSize", String(PAGE_SZ));
  u.searchParams.set("sort", "id");
  for (const a of APPENDS) u.searchParams.append("appends[]", a);
  const r = await fetch(u, { headers: { Authorization: "Bearer " + TOKEN } });
  if (!r.ok) throw new Error(`NocoBase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function enviar(rec) {
  const r = await fetch(CRM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-dandovoz-key": CRM_KEY },
    body: JSON.stringify(rec),
  });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok && d.ok, status: r.status, d };
}

(async () => {
  let page = 1, total = 0, enviados = 0, erros = 0, vistos = 0;
  while (true) {
    const resp = await buscarPagina(page);
    const rows = resp.data || [];
    total = (resp.meta && resp.meta.count) || total;
    if (!rows.length) break;

    for (const rec of rows) {
      vistos++;
      const m = mapear(rec);
      if (DRY) {
        if (vistos <= 5) console.log(JSON.stringify(m, null, 2));
        continue;
      }
      if (!m.nome && !m.telefone && !m.email) { continue; }
      try {
        const res = await enviar(m);
        if (res.ok) enviados++; else { erros++; console.error("Falhou id", m.dandovoz_id, res.status, res.d); }
      } catch (e) { erros++; console.error("Erro id", m.dandovoz_id, e.message); }
    }

    if (DRY) { console.log(`\n[dry] amostra dos 5 primeiros de ${total || rows.length} registros. Sem enviar.`); break; }
    if (rows.length < PAGE_SZ) break;
    page++;
  }
  if (!DRY) console.log(`\nConcluído. Enviados: ${enviados} · Erros: ${erros} · Total lido: ${vistos}`);
})().catch(e => { console.error("FALHA:", e.message); process.exit(1); });

/**
 * Web Push (VAPID + aes128gcm) usando Web Crypto — compatível com Cloudflare.
 * Sem dependências externas. Implementa:
 *   - VAPID JWT (ES256)                              RFC 8292
 *   - Criptografia de payload aes128gcm              RFC 8291 / RFC 8188
 *
 * Uso: await sendWebPush(env, subscription, payloadObj)
 *   subscription = { endpoint, keys:{ p256dh, auth } }  (base64url)
 *   env precisa de: VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT (mailto:... ou https://...)
 */

/* ---------- base64url helpers ---------- */
export function b64urlToBytes(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4; if (pad) s += "=".repeat(4 - pad);
  const bin = atob(s); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
export function bytesToB64url(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = ""; for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const enc = (s) => new TextEncoder().encode(s);
function concat(...arrs) {
  let len = 0; for (const a of arrs) len += a.length;
  const out = new Uint8Array(len); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

/* ---------- HKDF (extract+expand em uma chamada do Web Crypto) ---------- */
async function hkdf(ikm, salt, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/* ---------- VAPID JWT (ES256) ---------- */
function originOf(url) { const u = new URL(url); return u.origin; }

async function importVapidPrivate(env) {
  const pub = b64urlToBytes(env.VAPID_PUBLIC); // 65 bytes: 0x04 || X(32) || Y(32)
  const x = bytesToB64url(pub.slice(1, 33));
  const y = bytesToB64url(pub.slice(33, 65));
  const jwk = { kty: "EC", crv: "P-256", d: env.VAPID_PRIVATE, x, y, ext: true, key_ops: ["sign"] };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

export async function vapidAuthHeader(env, endpoint) {
  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: originOf(endpoint),
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, // 12h
    sub: env.VAPID_SUBJECT || "mailto:contato@anacarolinaoliveira.com.br",
  };
  const signingInput = bytesToB64url(enc(JSON.stringify(header))) + "." + bytesToB64url(enc(JSON.stringify(payload)));
  const key = await importVapidPrivate(env);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc(signingInput));
  const token = signingInput + "." + bytesToB64url(new Uint8Array(sig));
  return "vapid t=" + token + ", k=" + env.VAPID_PUBLIC;
}

/* ---------- Criptografia aes128gcm ---------- */
export async function encryptPayload(payloadBytes, uaPublicB64, authSecretB64) {
  const uaPublic = b64urlToBytes(uaPublicB64);   // 65
  const authSecret = b64urlToBytes(authSecretB64); // 16
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // par efêmero (servidor) ECDH P-256
  const asKp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKp.publicKey)); // 65

  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKp.privateKey, 256)); // 32

  // IKM = HKDF(ikm=ecdhSecret, salt=authSecret, info="WebPush: info\0"||uaPublic||asPublic, 32)
  const authInfo = concat(enc("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(ecdhSecret, authSecret, authInfo, 32);

  // CEK e NONCE (RFC 8188)
  const cekBytes = await hkdf(ikm, salt, enc("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(ikm, salt, enc("Content-Encoding: nonce\0"), 12);

  const cek = await crypto.subtle.importKey("raw", cekBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const plain = concat(payloadBytes, new Uint8Array([0x02])); // delimitador de registro (sem padding)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, cek, plain));

  // header do content-coding: salt(16) || rs(4, BE) || idlen(1)=65 || asPublic(65)
  const rs = new Uint8Array([0, 0, 0x10, 0]); // 4096
  const body = concat(salt, rs, new Uint8Array([65]), asPublic, ct);
  return body;
}

/* ---------- Envio ---------- */
export async function sendWebPush(env, subscription, payloadObj) {
  const endpoint = subscription.endpoint;
  const p256dh = subscription.keys ? subscription.keys.p256dh : subscription.p256dh;
  const auth = subscription.keys ? subscription.keys.auth : subscription.auth;
  const payloadBytes = enc(typeof payloadObj === "string" ? payloadObj : JSON.stringify(payloadObj));

  const body = await encryptPayload(payloadBytes, p256dh, auth);
  const authorization = await vapidAuthHeader(env, endpoint);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": authorization,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "TTL": "86400",
      "Urgency": "normal",
    },
    body,
  });
  // 404/410 = assinatura morta (o chamador deve remover do banco)
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}

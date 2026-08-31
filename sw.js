/* CRM Ana — Service Worker (PWA + Web Push) */
const VERSION = "crm-ana-v1";

self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });

/* Rede-primeiro simples: nunca serve dados velhos do CRM.
   (sem cache de páginas — só deixa o app instalável e online) */
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  // deixa o navegador cuidar; só um fallback amigável para navegação offline
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).catch(() =>
        new Response(
          "<meta charset='utf-8'><div style='font-family:system-ui;padding:40px;text-align:center;color:#7a2418'><h2>Sem conexão</h2><p>Reabra quando estiver online.</p></div>",
          { headers: { "Content-Type": "text/html; charset=utf-8" } }
        )
      )
    );
  }
});

/* ---- PUSH ---- */
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { data = { title: "CRM Ana", body: e.data ? e.data.text() : "" }; }
  const title = data.title || "CRM — Ana Carolina";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || "/painel.html" },
    vibrate: [80, 40, 80],
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

/* ---- clique na notificação: foca uma aba aberta ou abre a URL ---- */
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/painel.html";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        try {
          const u = new URL(c.url);
          if (u.pathname === new URL(url, u.origin).pathname && "focus" in c) return c.focus();
        } catch (_) {}
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

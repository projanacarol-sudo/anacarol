/**
 * CRM Ana — Widget de Captura (Fase 2)
 * ---------------------------------------------------------------------
 * Cole este script em qualquer página de captura da Ana. Ele desenha um
 * formulário (nome, e-mail, WhatsApp) com opt-in, envia para o Worker e
 * mostra a mensagem de sucesso ou redireciona.
 *
 * USO — coloque onde o formulário deve aparecer:
 *
 *   <div id="captura-ana"></div>
 *   <script src="https://SEU-WORKER.workers.dev/widget-captura.js"
 *           data-endpoint="https://SEU-WORKER.workers.dev/api/capture"
 *           data-form="palestra-sp"
 *           data-target="#captura-ana"
 *           data-titulo="Receba os conteúdos da Ana Carolina"
 *           data-botao="Quero receber"
 *           data-optin="Autorizo receber e-mails e mensagens da Ana Carolina."
 *           data-redirect="https://site.com/obrigado"></script>
 *
 * Também funciona hospedando este arquivo como estático (Cloudflare Pages)
 * e apontando o src para lá. O único parâmetro obrigatório é data-endpoint.
 * ---------------------------------------------------------------------
 */
(function () {
  var script = document.currentScript;
  if (!script) return;

  var cfg = {
    endpoint: script.getAttribute("data-endpoint"),
    form: script.getAttribute("data-form") || "",
    target: script.getAttribute("data-target") || "",
    titulo: script.getAttribute("data-titulo") || "Fique por dentro",
    botao: script.getAttribute("data-botao") || "Enviar",
    optin: script.getAttribute("data-optin") ||
      "Autorizo o contato por e-mail e WhatsApp e concordo com a política de privacidade.",
    sucesso: script.getAttribute("data-sucesso") || "Pronto! Você foi cadastrado(a). 🎉",
    redirect: script.getAttribute("data-redirect") || "",
    cor: script.getAttribute("data-cor") || "#128C7E",
    pedirTelefone: script.getAttribute("data-telefone") !== "false",
  };

  if (!cfg.endpoint) {
    console.error("[widget-captura] data-endpoint é obrigatório.");
    return;
  }

  // Container -------------------------------------------------------
  var mount;
  if (cfg.target) {
    mount = document.querySelector(cfg.target);
  }
  if (!mount) {
    mount = document.createElement("div");
    script.parentNode.insertBefore(mount, script);
  }

  // Estilos (escopados por prefixo cap-) ----------------------------
  injectCSS(cfg.cor);

  // HTML ------------------------------------------------------------
  mount.innerHTML =
    '<form class="cap-form" novalidate>' +
      '<h3 class="cap-titulo">' + esc(cfg.titulo) + "</h3>" +
      '<div class="cap-msg" role="alert" hidden></div>' +
      '<label class="cap-label">Nome' +
        '<input class="cap-input" name="nome" type="text" autocomplete="name" required></label>' +
      '<label class="cap-label">E-mail' +
        '<input class="cap-input" name="email" type="email" autocomplete="email" required></label>' +
      (cfg.pedirTelefone
        ? '<label class="cap-label">WhatsApp (com DDD)' +
          '<input class="cap-input" name="telefone" type="tel" inputmode="numeric" ' +
          'autocomplete="tel" placeholder="(11) 99999-9999"></label>'
        : "") +
      '<label class="cap-optin"><input type="checkbox" name="opt_in_email" required> ' +
        '<span>' + esc(cfg.optin) + "</span></label>" +
      // honeypot invisível anti-spam
      '<input class="cap-hp" type="text" name="_gotcha" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<button class="cap-btn" type="submit">' + esc(cfg.botao) + "</button>" +
    "</form>";

  var form = mount.querySelector(".cap-form");
  var msg = mount.querySelector(".cap-msg");
  var btn = mount.querySelector(".cap-btn");

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    hide(msg);

    var data = {
      nome: form.nome.value,
      email: form.email.value,
      telefone: cfg.pedirTelefone ? form.telefone.value : "",
      opt_in_email: form.opt_in_email.checked,
      texto_optin: cfg.optin,
      form: cfg.form,
      origem_url: location.href,
      redirect: cfg.redirect,
      _gotcha: form._gotcha.value,
    };

    if (!data.email || !data.opt_in_email) {
      return show(msg, "Preencha o e-mail e marque a autorização.", true);
    }

    btn.disabled = true;
    btn.textContent = "Enviando...";

    fetch(cfg.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (res) {
        if (res && res.ok) {
          if (res.redirect) { location.href = res.redirect; return; }
          form.reset();
          show(msg, cfg.sucesso, false);
        } else {
          show(msg, "Não foi possível cadastrar agora. Tente novamente.", true);
        }
      })
      .catch(function () {
        show(msg, "Erro de conexão. Tente novamente.", true);
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = cfg.botao;
      });
  });

  /* helpers */
  function show(el, text, isErr) {
    el.textContent = text;
    el.className = "cap-msg " + (isErr ? "cap-err" : "cap-ok");
    el.hidden = false;
  }
  function hide(el) { el.hidden = true; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function injectCSS(cor) {
    if (document.getElementById("cap-style")) return;
    var css =
      ".cap-form{max-width:420px;margin:0 auto;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;" +
      "display:flex;flex-direction:column;gap:12px;padding:22px;border:1px solid #e5e9ec;border-radius:14px;background:#fff}" +
      ".cap-titulo{margin:0 0 4px;font-size:18px;color:#14202a}" +
      ".cap-label{display:flex;flex-direction:column;gap:5px;font-size:13px;color:#41505a;font-weight:600}" +
      ".cap-input{padding:11px 12px;border:1px solid #cfd8dd;border-radius:9px;font-size:15px;color:#14202a}" +
      ".cap-input:focus{outline:none;border-color:" + cor + ";box-shadow:0 0 0 3px " + cor + "22}" +
      ".cap-optin{display:flex;gap:9px;align-items:flex-start;font-size:12.5px;color:#54636d;line-height:1.4;font-weight:400}" +
      ".cap-optin input{margin-top:2px}" +
      ".cap-btn{margin-top:4px;padding:13px;border:0;border-radius:9px;background:" + cor + ";color:#fff;" +
      "font-size:15px;font-weight:700;cursor:pointer}" +
      ".cap-btn:disabled{opacity:.6;cursor:default}" +
      ".cap-msg{padding:10px 12px;border-radius:9px;font-size:13.5px}" +
      ".cap-ok{background:#eaf7f3;color:#0f7a63}" +
      ".cap-err{background:#fdecea;color:#b3392f}" +
      ".cap-hp{position:absolute!important;left:-9999px!important;width:1px;height:1px;opacity:0}";
    var st = document.createElement("style");
    st.id = "cap-style";
    st.textContent = css;
    document.head.appendChild(st);
  }
})();

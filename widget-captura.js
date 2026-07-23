/**
 * CRM Ana — Widget de Captura (Fase 2)
 * ---------------------------------------------------------------------
 * Formulário embed (nome, e-mail, WhatsApp) com opt-in, máscara de
 * telefone ao digitar e validação de DDD. Envia ao Worker/Function e
 * mostra sucesso ou redireciona.
 *
 * USO:
 *   <div id="captura-ana"></div>
 *   <script src="https://SEU-PROJETO.pages.dev/widget-captura.js"
 *           data-endpoint="/api/capture"
 *           data-form="palestra-sp"
 *           data-target="#captura-ana"></script>
 *
 * Único obrigatório: data-endpoint.
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

  // DDDs válidos do Brasil (mesma lista do banco ddd_geo) ------------
  var DDDS = {
    11:1,12:1,13:1,14:1,15:1,16:1,17:1,18:1,19:1,21:1,22:1,24:1,27:1,28:1,
    31:1,32:1,33:1,34:1,35:1,37:1,38:1,41:1,42:1,43:1,44:1,45:1,46:1,47:1,
    48:1,49:1,51:1,53:1,54:1,55:1,61:1,62:1,63:1,64:1,65:1,66:1,67:1,68:1,
    69:1,71:1,73:1,74:1,75:1,77:1,79:1,81:1,82:1,83:1,84:1,85:1,86:1,87:1,
    88:1,89:1,91:1,92:1,93:1,94:1,95:1,96:1,97:1,98:1,99:1
  };

  var mount = cfg.target ? document.querySelector(cfg.target) : null;
  if (!mount) {
    mount = document.createElement("div");
    script.parentNode.insertBefore(mount, script);
  }

  injectCSS(cfg.cor);

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
          'autocomplete="tel" placeholder="(11) 99999-9999" maxlength="16">' +
          '<span class="cap-hint" data-hint hidden></span></label>'
        : "") +
      '<label class="cap-optin"><input type="checkbox" name="opt_in_email" required> ' +
        '<span>' + esc(cfg.optin) + "</span></label>" +
      '<input class="cap-hp" type="text" name="_gotcha" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<button class="cap-btn" type="submit">' + esc(cfg.botao) + "</button>" +
    "</form>";

  var form = mount.querySelector(".cap-form");
  var msg = mount.querySelector(".cap-msg");
  var btn = mount.querySelector(".cap-btn");
  var tel = form.telefone || null;
  var hint = mount.querySelector("[data-hint]");

  // Máscara + validação de telefone ---------------------------------
  if (tel) {
    tel.addEventListener("input", function () {
      var caretEnd = tel.selectionStart === tel.value.length;
      tel.value = maskPhone(tel.value);
      if (caretEnd) tel.setSelectionRange(tel.value.length, tel.value.length);
      applyPhoneState(false);
    });
    tel.addEventListener("blur", function () { applyPhoneState(true); });
  }

  function phoneStatus() {
    var d = onlyDigits(tel.value);
    if (!d) return "empty";
    if (d.length < 10) return "partial";
    if (d.length > 11) return "invalid";
    if (!DDDS[d.slice(0, 2)]) return "ddd";     // DDD inexistente
    return "valid";                              // 10 (fixo) ou 11 (celular) ok
  }

  function applyPhoneState(showPartialError) {
    if (!tel) return;
    var st = phoneStatus();
    tel.classList.remove("cap-ok-input", "cap-err-input");
    hint.hidden = false;
    hint.className = "cap-hint";
    if (st === "valid") {
      tel.classList.add("cap-ok-input");
      hint.classList.add("cap-hint-ok");
      hint.textContent = "✓ Número válido";
    } else if (st === "ddd") {
      tel.classList.add("cap-err-input");
      hint.classList.add("cap-hint-err");
      hint.textContent = "DDD não existe. Confira os 2 primeiros dígitos.";
    } else if (st === "invalid") {
      tel.classList.add("cap-err-input");
      hint.classList.add("cap-hint-err");
      hint.textContent = "Número muito longo.";
    } else if (st === "partial") {
      if (showPartialError) {
        tel.classList.add("cap-err-input");
        hint.classList.add("cap-hint-err");
        hint.textContent = "Número incompleto.";
      } else {
        hint.hidden = true;
      }
    } else {
      hint.hidden = true; // vazio
    }
  }

  // Submit ----------------------------------------------------------
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    hide(msg);

    if (tel && onlyDigits(tel.value)) {
      var st = phoneStatus();
      if (st !== "valid") {
        applyPhoneState(true);
        tel.focus();
        return show(msg, "Confira o WhatsApp: o número está incompleto ou o DDD é inválido.", true);
      }
    }

    var data = {
      nome: form.nome.value,
      email: form.email.value,
      telefone: tel ? tel.value : "",
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
          if (hint) hint.hidden = true;
          if (tel) tel.classList.remove("cap-ok-input", "cap-err-input");
          show(msg, cfg.sucesso, false);
        } else {
          show(msg, "Não foi possível cadastrar agora. Tente novamente.", true);
        }
      })
      .catch(function () { show(msg, "Erro de conexão. Tente novamente.", true); })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = cfg.botao;
      });
  });

  /* ---------- helpers ---------- */
  function onlyDigits(s) { return String(s || "").replace(/\D/g, "").slice(0, 11); }

  // Formata: (XX) XXXX-XXXX (fixo, 10) ou (XX) XXXXX-XXXX (celular, 11)
  function maskPhone(v) {
    var d = onlyDigits(v);
    if (d.length === 0) return "";
    if (d.length <= 2) return "(" + d;
    if (d.length <= 6) return "(" + d.slice(0, 2) + ") " + d.slice(2);
    if (d.length <= 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
    return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
  }

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
      ".cap-ok-input{border-color:#1aa179!important;box-shadow:0 0 0 3px #1aa17922!important}" +
      ".cap-err-input{border-color:#e0574c!important;box-shadow:0 0 0 3px #e0574c22!important}" +
      ".cap-hint{font-size:12px;font-weight:600;margin-top:1px}" +
      ".cap-hint-ok{color:#0f8a63}" +
      ".cap-hint-err{color:#c0392b}" +
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

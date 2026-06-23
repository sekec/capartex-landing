/* =========================================================================
   PRÉMIOVÁ BYLINNÁ LANDING PAGE – logika
   - Odeslání e-mailů do Google Sheets přes Google Apps Script Web App
   - Google Analytics 4 (GA4) eventy přes bezpečný helper trackEvent()
   - Validace, stavy tlačítka, ochrana proti duplicitě v rámci session
   ========================================================================= */

(function () {
  "use strict";

  /* =======================================================================
     KONFIGURACE – ZDE SE MĚNÍ DŮLEŽITÉ HODNOTY
     =======================================================================

     1) GOOGLE APPS SCRIPT ENDPOINT
        Vložte URL své nasazené Web App (viz README, sekce Google Apps Script).
        Dokud zůstane placeholder, formulář se NEodešle na server, ale
        uživateli se zobrazí potvrzení a event se změří (tzv. „dry run“).

     2) GA4 Measurement ID se nastavuje v index.html (window.GA4_MEASUREMENT_ID).

     3) KONTAKTNÍ E-MAIL a TEXTY se mění v index.html.
  */
  const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbw5J1qB9kW6IKhpc6ECNJaXV18dNG58qd7ME0_P66hr3_377WTEBoqQgvoATmoeA--k2A/exec";

  // Texty hlášek (snadno editovatelné na jednom místě).
  const MESSAGES = {
    invalid: "Zadejte prosím platný e-mail.",
    success: "Děkujeme. Jste na seznamu zájemců.",
    error: "Něco se nepovedlo. Zkuste to prosím znovu.",
    duplicate: "Tento e-mail už máme. Děkujeme!",
    sending: "Odesílám…",
  };

  /* =======================================================================
     GA4 – bezpečný helper
     =======================================================================
     trackEvent() zavolá gtag() pouze pokud existuje (tj. GA4 je načteno
     s reálným Measurement ID). Pokud GA4 není k dispozici, funkce tiše
     skončí a nic se nerozbije.

     JAK NAJÍT EVENTY V GA4:
       - Realtime: GA4 → Reports → Realtime → "Event count by Event name"
       - DebugView: GA4 → Admin → DebugView (vyžaduje debug režim)
       - Standardní reporty: Reports → Engagement → Events (s ~24h zpožděním)
       - Konverze: Admin → Events → označit "lead_form_submit_success"
         jako konverzi (mark as key event / conversion).
  */
  function trackEvent(eventName, params) {
    try {
      if (typeof window.gtag === "function" && !isGaPlaceholder()) {
        window.gtag("event", eventName, params || {});
      }
      // Tichý debug do konzole (nepovinné, neovlivní produkci).
      // console.debug("[trackEvent]", eventName, params);
    } catch (e) {
      /* GA nikdy nesmí shodit stránku */
    }
  }

  function isGaPlaceholder() {
    var id = window.GA4_MEASUREMENT_ID;
    return !id || id.indexOf("XXXXXXXXXX") !== -1;
  }

  /* =======================================================================
     UTM + kontextové parametry
     =======================================================================
     Načteme UTM z URL jednou a sdílíme je napříč eventy i odesláním.
  */
  function getQueryParam(name) {
    var params = new URLSearchParams(window.location.search);
    return params.get(name) || "";
  }

  var UTM = {
    utm_source: getQueryParam("utm_source"),
    utm_medium: getQueryParam("utm_medium"),
    utm_campaign: getQueryParam("utm_campaign"),
    utm_content: getQueryParam("utm_content"),
    utm_term: getQueryParam("utm_term"),
  };

  // Společné parametry pro GA4 eventy.
  function baseEventParams(formLocation) {
    return {
      form_location: formLocation || "",
      page_path: window.location.pathname,
      utm_source: UTM.utm_source,
      utm_medium: UTM.utm_medium,
      utm_campaign: UTM.utm_campaign,
      device_width: window.innerWidth || 0,
    };
  }

  /* =======================================================================
     Validace e-mailu (front-end)
     ======================================================================= */
  function isValidEmail(email) {
    if (!email) return false;
    // Jednoduchý, ale praktický vzor: něco@něco.tld
    var re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    return re.test(String(email).trim().toLowerCase());
  }

  /* =======================================================================
     Ochrana proti opakovanému odeslání stejného e-mailu v session
     ======================================================================= */
  var SUBMITTED_KEY = "lead_submitted_emails";

  function getSubmittedEmails() {
    try {
      return JSON.parse(sessionStorage.getItem(SUBMITTED_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }

  function markEmailSubmitted(email) {
    try {
      var list = getSubmittedEmails();
      var normalized = String(email).trim().toLowerCase();
      if (list.indexOf(normalized) === -1) {
        list.push(normalized);
        sessionStorage.setItem(SUBMITTED_KEY, JSON.stringify(list));
      }
    } catch (e) {
      /* sessionStorage nemusí být dostupné (např. privátní režim) */
    }
  }

  function isAlreadySubmitted(email) {
    var normalized = String(email).trim().toLowerCase();
    return getSubmittedEmails().indexOf(normalized) !== -1;
  }

  /* =======================================================================
     Stavová hláška ve formuláři
     ======================================================================= */
  function setStatus(form, message, type) {
    var el = form.querySelector(".form-status");
    if (!el) return;
    el.textContent = message;
    el.classList.remove("is-success", "is-error");
    if (type === "success") el.classList.add("is-success");
    if (type === "error") el.classList.add("is-error");
  }

  /* =======================================================================
     Sestavení payloadu pro Google Sheets
     ======================================================================= */
  function buildPayload(email, formLocation) {
    return {
      email: String(email).trim(),
      source: formLocation,                     // "hero_form" / "footer_form"
      timestamp: new Date().toISOString(),
      page: window.location.href,
      userAgent: navigator.userAgent,
      utm_source: UTM.utm_source,
      utm_medium: UTM.utm_medium,
      utm_campaign: UTM.utm_campaign,
      utm_content: UTM.utm_content,
      utm_term: UTM.utm_term,
      referrer: document.referrer || "",
      screenWidth: window.screen ? window.screen.width : window.innerWidth,
      screenHeight: window.screen ? window.screen.height : window.innerHeight,
      language: navigator.language || "",
    };
  }

  /* =======================================================================
     Odeslání na Google Apps Script
     =======================================================================
     Použijeme text/plain content-type → Apps Script doGet/doPost přijme
     tělo bez CORS preflightu (jednoduchý request). Apps Script si JSON
     naparsuje z e.postData.contents.
  */
  function sendToSheets(payload) {
    var isPlaceholder =
      !GOOGLE_SCRIPT_URL ||
      GOOGLE_SCRIPT_URL.indexOf("PASTE_YOUR") !== -1;

    // Dry run: bez endpointu jen simulujeme úspěch (pro lokální vývoj).
    if (isPlaceholder) {
      return Promise.resolve({ result: "success", dryRun: true });
    }

    return fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      // text/plain = "simple request" → žádný CORS preflight z GitHub Pages.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json().catch(function () {
        // Apps Script někdy vrací bez korektního JSON headeru – tolerujeme.
        return { result: "success" };
      });
    });
  }

  /* =======================================================================
     Obsluha odeslání formuláře (sdílená pro oba formuláře)
     ======================================================================= */
  function handleSubmit(form, event) {
    event.preventDefault();

    var formLocation = form.getAttribute("data-form-location") || "unknown_form";
    var input = form.querySelector('input[type="email"]');
    var button = form.querySelector('button[type="submit"]');
    var email = input ? input.value : "";

    // 1) GA4: pokus o odeslání
    trackEvent("lead_form_submit_attempt", baseEventParams(formLocation));

    // 2) Validace
    if (!isValidEmail(email)) {
      setStatus(form, MESSAGES.invalid, "error");
      trackEvent("lead_form_submit_error", Object.assign(
        baseEventParams(formLocation), { error_reason: "invalid_email" }
      ));
      if (input) input.focus();
      return;
    }

    // 3) Ochrana proti duplicitě v rámci session
    if (isAlreadySubmitted(email)) {
      setStatus(form, MESSAGES.duplicate, "success");
      input.value = "";
      return;
    }

    // 4) Stav „odesílám“
    var originalLabel = button ? button.textContent : "";
    if (button) {
      button.disabled = true;
      button.textContent = MESSAGES.sending;
    }
    setStatus(form, "", null);

    var payload = buildPayload(email, formLocation);

    sendToSheets(payload)
      .then(function () {
        // Úspěch
        markEmailSubmitted(email);
        setStatus(form, MESSAGES.success, "success");
        if (input) input.value = "";
        trackEvent("lead_form_submit_success", baseEventParams(formLocation));
      })
      .catch(function () {
        // Chyba odeslání
        setStatus(form, MESSAGES.error, "error");
        trackEvent("lead_form_submit_error", Object.assign(
          baseEventParams(formLocation), { error_reason: "network" }
        ));
      })
      .finally(function () {
        if (button) {
          button.disabled = false;
          button.textContent = originalLabel;
        }
      });
  }

  /* =======================================================================
     Inicializace po načtení DOM
     ======================================================================= */
  function init() {
    // Aktuální rok v patičce.
    var yearEl = document.getElementById("year");
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    // Napojení obou formulářů na stejnou logiku.
    var forms = document.querySelectorAll(".lead-form");
    forms.forEach(function (form) {
      form.addEventListener("submit", function (e) {
        handleSubmit(form, e);
      });
    });

    // CTA kliknutí (cta_click).
    document.querySelectorAll(".cta-button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var loc = btn.getAttribute("data-cta") || "";
        trackEvent("cta_click", Object.assign(
          baseEventParams(loc + "_form"), { cta_id: loc }
        ));
      });
    });

    // Nav kliknutí (nav_click).
    document.querySelectorAll(".nav-link").forEach(function (link) {
      link.addEventListener("click", function () {
        trackEvent("nav_click", Object.assign(
          baseEventParams(""), { nav_target: link.getAttribute("data-nav") || link.textContent }
        ));
      });
    });

    setupReveal();
    setupViewportEvents();
  }

  /* =======================================================================
     Reveal animace při scrollu (IntersectionObserver)
     ======================================================================= */
  function setupReveal() {
    var revealEls = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      revealEls.forEach(function (el) { el.classList.add("is-visible"); });
      return;
    }

    // Decentní stagger: prvky ve stejné mřížce se odhalují postupně.
    document.querySelectorAll(".card-grid, .audience-grid").forEach(function (grid) {
      var items = grid.querySelectorAll(".reveal");
      items.forEach(function (el, i) {
        el.style.transitionDelay = (i * 80) + "ms";
      });
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
    revealEls.forEach(function (el) { io.observe(el); });
  }

  /* =======================================================================
     GA4 viewport eventy (sekce a formuláře v zorném poli)
     =======================================================================
       - lead_form_view          – formulář se objevil ve viewportu
       - ingredient_section_view – sekce složení
       - audience_section_view   – sekce „pro koho“
     Každý event se odešle jen jednou (once).
  */
  function setupViewportEvents() {
    if (!("IntersectionObserver" in window)) return;

    function observeOnce(selector, callback) {
      var el = document.querySelector(selector);
      if (!el) return;
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            callback(entry.target);
            io.disconnect();
          }
        });
      }, { threshold: 0.3 });
      io.observe(el);
    }

    // lead_form_view – sledujeme oba formuláře zvlášť.
    document.querySelectorAll(".lead-form").forEach(function (form) {
      var loc = form.getAttribute("data-form-location") || "";
      var seen = false;
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && !seen) {
            seen = true;
            trackEvent("lead_form_view", baseEventParams(loc));
            io.disconnect();
          }
        });
      }, { threshold: 0.4 });
      io.observe(form);
    });

    // ingredient_section_view
    observeOnce("#slozeni", function () {
      trackEvent("ingredient_section_view", baseEventParams("ingredients"));
    });

    // audience_section_view
    observeOnce("#pro-koho", function () {
      trackEvent("audience_section_view", baseEventParams("audience"));
    });
  }

  // Spuštění.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

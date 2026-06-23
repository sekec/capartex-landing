/* =========================================================================
   PRE-LAUNCH LANDING PAGE – logika
   - Sběr e-mailů do Google Sheets přes Google Apps Script Web App
   - GA4 eventy přes bezpečný helper trackEvent() (žádný název produktu)
   - Validace, honeypot, stavy tlačítka, FAQ akordeon, sticky mobilní CTA
   ========================================================================= */

(function () {
  "use strict";

  /* =======================================================================
     KONFIGURACE
     - GOOGLE_SCRIPT_URL: endpoint pro ukládání e-mailů (Apps Script /exec).
       Při placeholderu „PASTE_YOUR…“ se data neodešlou (UI funguje, ale
       reálné ukládání chybí – nutno doplnit endpoint).
     - GA4 Measurement ID se nastavuje v index.html.
     ======================================================================= */
  const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbw5J1qB9kW6IKhpc6ECNJaXV18dNG58qd7ME0_P66hr3_377WTEBoqQgvoATmoeA--k2A/exec";

  // Texty hlášek (snadno editovatelné na jednom místě).
  const MESSAGES = {
    invalid: "Zadejte prosím platný e-mail.",
    success: "Jste na seznamu. Jakmile bude první série připravená, pošleme vám diskrétní zprávu před veřejným spuštěním.",
    error: "Něco se nepovedlo. Zkuste to prosím znovu.",
    duplicate: "Tento e-mail už máme. Děkujeme!",
    sending: "Odesílám…",
  };

  /* =======================================================================
     GA4 – bezpečný helper
     trackEvent() zavolá gtag() jen pokud existuje (reálné Measurement ID).
     Jak najít eventy: GA4 → Reports → Realtime → Event count by Event name.
     ======================================================================= */
  function trackEvent(eventName, params) {
    try {
      if (typeof window.gtag === "function" && !isGaPlaceholder()) {
        window.gtag("event", eventName, params || {});
      }
    } catch (e) { /* analytika nikdy nesmí shodit stránku */ }
  }
  function isGaPlaceholder() {
    var id = window.GA4_MEASUREMENT_ID;
    return !id || id.indexOf("XXXXXXXXXX") !== -1;
  }

  /* =======================================================================
     UTM + kontextové parametry
     ======================================================================= */
  function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name) || "";
  }
  var UTM = {
    utm_source: getQueryParam("utm_source"),
    utm_medium: getQueryParam("utm_medium"),
    utm_campaign: getQueryParam("utm_campaign"),
    utm_content: getQueryParam("utm_content"),
    utm_term: getQueryParam("utm_term"),
  };
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
     Validace e-mailu
     ======================================================================= */
  function isValidEmail(email) {
    if (!email) return false;
    var re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    return re.test(String(email).trim().toLowerCase());
  }

  /* =======================================================================
     Ochrana proti opakovanému odeslání v rámci session
     ======================================================================= */
  var SUBMITTED_KEY = "lead_submitted_emails";
  function getSubmittedEmails() {
    try { return JSON.parse(sessionStorage.getItem(SUBMITTED_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function markEmailSubmitted(email) {
    try {
      var list = getSubmittedEmails();
      var n = String(email).trim().toLowerCase();
      if (list.indexOf(n) === -1) { list.push(n); sessionStorage.setItem(SUBMITTED_KEY, JSON.stringify(list)); }
    } catch (e) { /* sessionStorage nedostupné */ }
  }
  function isAlreadySubmitted(email) {
    return getSubmittedEmails().indexOf(String(email).trim().toLowerCase()) !== -1;
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
     Payload pro Google Sheets
     ======================================================================= */
  function buildPayload(email, formLocation) {
    return {
      email: String(email).trim(),
      source: formLocation,
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
     Odeslání na Google Apps Script (text/plain = bez CORS preflightu)
     ======================================================================= */
  function sendToSheets(payload) {
    var isPlaceholder = !GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL.indexOf("PASTE_YOUR") !== -1;
    if (isPlaceholder) {
      // Backend není nastavený – nevytváříme falešný funkční stav.
      return Promise.reject(new Error("missing_endpoint"));
    }
    return fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json().catch(function () { return { result: "success" }; });
    });
  }

  /* =======================================================================
     Obsluha odeslání formuláře (sdílená pro oba formuláře)
     ======================================================================= */
  function handleSubmit(form, event) {
    event.preventDefault();
    var formLocation = form.getAttribute("data-form-location") || "unknown_form";
    var input = form.querySelector('input[type="email"]');
    var honeypot = form.querySelector('input[name="website"]');
    var button = form.querySelector('button[type="submit"]');
    var email = input ? input.value : "";

    // Honeypot: vyplněné pole = bot → tiše zahodit.
    if (honeypot && honeypot.value.trim() !== "") return;

    trackEvent("email_submit_attempt", baseEventParams(formLocation));

    if (!isValidEmail(email)) {
      setStatus(form, MESSAGES.invalid, "error");
      trackEvent("email_submit_error", Object.assign(baseEventParams(formLocation), { error_reason: "invalid_email" }));
      if (input) input.focus();
      return;
    }

    if (isAlreadySubmitted(email)) {
      setStatus(form, MESSAGES.duplicate, "success");
      if (input) input.value = "";
      return;
    }

    var originalLabel = button ? button.innerHTML : "";
    if (button) { button.disabled = true; button.textContent = MESSAGES.sending; }
    setStatus(form, "", null);

    sendToSheets(buildPayload(email, formLocation))
      .then(function () {
        markEmailSubmitted(email);
        setStatus(form, MESSAGES.success, "success");
        if (input) input.value = "";
        trackEvent("email_submit_success", baseEventParams(formLocation));
      })
      .catch(function (err) {
        setStatus(form, MESSAGES.error, "error");
        var reason = (err && err.message === "missing_endpoint") ? "missing_endpoint" : "network";
        trackEvent("email_submit_error", Object.assign(baseEventParams(formLocation), { error_reason: reason }));
      })
      .finally(function () {
        if (button) { button.disabled = false; button.innerHTML = originalLabel; }
      });
  }

  /* =======================================================================
     Generické CTA eventy (data-ev), kromě FAQ (řeší se zvlášť).
     ======================================================================= */
  function setupCtaTracking() {
    document.querySelectorAll("[data-ev]").forEach(function (el) {
      if (el.classList.contains("faq-q")) return; // FAQ má vlastní logiku
      el.addEventListener("click", function () {
        var ev = el.getAttribute("data-ev");
        var loc = el.getAttribute("data-analytics") || "";
        trackEvent(ev, Object.assign(baseEventParams(loc), { cta_id: loc }));
      });
    });
  }

  /* =======================================================================
     FAQ akordeon (přístupné: aria-expanded) + event faq_open při otevření.
     ======================================================================= */
  function setupFaq() {
    document.querySelectorAll(".faq-q").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var item = btn.closest(".faq-item");
        var willOpen = !item.classList.contains("open");
        item.classList.toggle("open", willOpen);
        btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
        if (willOpen) {
          trackEvent("faq_open", Object.assign(baseEventParams("faq"), {
            question: (btn.textContent || "").trim().slice(0, 80)
          }));
        }
      });
    });
  }

  /* =======================================================================
     Reveal animace (IntersectionObserver) se staggerem.
     ======================================================================= */
  function setupReveal() {
    var els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("is-visible"); });
      return;
    }
    document.querySelectorAll(".pillars").forEach(function (grid) {
      grid.querySelectorAll(".reveal").forEach(function (el, i) { el.style.transitionDelay = (i * 80) + "ms"; });
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
    els.forEach(function (el) { io.observe(el); });
  }

  /* =======================================================================
     hero_form_view – formulář v hero se objevil ve viewportu (jednou).
     ======================================================================= */
  function setupHeroFormView() {
    if (!("IntersectionObserver" in window)) return;
    var heroForm = document.querySelector('.lead-form[data-form-location="hero_form"]');
    if (!heroForm) return;
    var seen = false;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && !seen) {
          seen = true;
          trackEvent("hero_form_view", baseEventParams("hero_form"));
          io.disconnect();
        }
      });
    }, { threshold: 0.4 });
    io.observe(heroForm);
  }

  /* =======================================================================
     Sticky mobilní CTA – zobrazí se, když není vidět žádný formulář.
     ======================================================================= */
  function setupStickyCta() {
    var sticky = document.querySelector(".sticky-cta");
    if (!sticky || !("IntersectionObserver" in window)) return;
    var heroForm = document.querySelector('.lead-form[data-form-location="hero_form"]');
    var finalSection = document.getElementById("zapis");
    var heroVisible = true, finalVisible = false;

    function update() {
      var show = !heroVisible && !finalVisible;
      sticky.classList.toggle("is-visible", show);
      sticky.setAttribute("aria-hidden", show ? "false" : "true");
      document.body.classList.toggle("has-sticky-cta", show);
    }
    if (heroForm) {
      new IntersectionObserver(function (es) {
        heroVisible = es[0].isIntersecting; update();
      }, { threshold: 0.2 }).observe(heroForm);
    }
    if (finalSection) {
      new IntersectionObserver(function (es) {
        finalVisible = es[0].isIntersecting; update();
      }, { threshold: 0.2 }).observe(finalSection);
    }
  }

  /* =======================================================================
     Inicializace
     ======================================================================= */
  function init() {
    var yearEl = document.getElementById("year");
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    document.querySelectorAll(".lead-form").forEach(function (form) {
      form.addEventListener("submit", function (e) { handleSubmit(form, e); });
    });

    setupCtaTracking();
    setupFaq();
    setupReveal();
    setupHeroFormView();
    setupStickyCta();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

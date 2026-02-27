// content.js
// SharePoint FormServer CUW134 auto-fill (x/t3/t4/t5) + follow-up date (today+7)
// Inject via manifest.json on:
//   http://erieshare/sites/formsmgmt/CommlForms/_layouts/15/FormServer.aspx*

(() => {
  "use strict";

  // ============================================================
  // CONFIG
  // ============================================================
  const PARAM_X = "x";
  const PARAM_T3 = "t3";
  const PARAM_T4 = "t4";
  const PARAM_T5 = "t5";

  const FIELD_6CHAR = "FormControl_V1_I1_S1_I1_T1";
  const FIELD_DATE  = "FormControl_V1_I1_S2_I3_T1"; // today+7 (guarded)
  const FIELD_T3    = "FormControl_V1_I1_S2_I3_T3";
  const FIELD_T4    = "FormControl_V1_I1_S2_I3_T4"; // insured name
  const FIELD_T5    = "FormControl_V1_I1_S2_I3_T5"; // claim date

  const POLL_MS = 400;
  const MAX_POLLS = 200; // ~80s max

  const ONCE_FLAG = "__erie_form_autofill_done_v4";
  const DEBUG = true;

  // ============================================================
  // HELPERS
  // ============================================================
  function log(...args) {
    if (DEBUG) console.log("[content.js][cuw134_autofill]", ...args);
  }

  function getParam(name) {
    try {
      return new URL(window.location.href).searchParams.get(name);
    } catch {
      return null;
    }
  }

  function normalizeSix(v) { return String(v || "").trim().slice(0, 6); }
  function normalize41(v)  { return String(v || "").trim().slice(0, 41); }
  function normalizeInsured(v){ return String(v || "").trim().slice(0, 50); }
  function normalizeDate(v) { return String(v || "").trim(); }

  function formatM_D_YYYY(d) {
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const y = d.getFullYear();
    return `${m}/${day}/${y}`;
  }

  function oneWeekFromTodayString() {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + 7);
    return formatM_D_YYYY(d);
  }

  // Detect obvious "not actually the form" situations (login/error pages)
  function looksLikeLoginOrErrorPage() {
    const href = String(location.href || "").toLowerCase();
    const title = String(document.title || "").toLowerCase();
    const bodyText = String(document.body?.innerText || "").toLowerCase();

    // Heuristics: tune as needed
    if (href.includes("login") || href.includes("signin") || href.includes("auth")) return true;
    if (title.includes("sign in") || title.includes("login")) return true;

    const indicators = [
      "you are not authorized",
      "access denied",
      "an unexpected error has occurred",
      "something went wrong",
      "please sign in",
      "claims-based authentication",
      "session expired"
    ];
    return indicators.some(s => bodyText.includes(s));
  }

  // Walk prototype chain to find a value setter (InfoPath widgets compatibility)
  function setNativeValue(el, value) {
    try {
      let proto = el;
      while (proto) {
        const desc = Object.getOwnPropertyDescriptor(proto, "value");
        if (desc && typeof desc.set === "function") {
          desc.set.call(el, value);
          return true;
        }
        proto = Object.getPrototypeOf(proto);
      }
      el.value = value;
      return true;
    } catch {
      try { el.value = value; return true; } catch { return false; }
    }
  }

  function fireMinimal(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setValueNoFocus(el, value) {
    if (!el) return false;
    const ok = setNativeValue(el, value);
    if (ok) fireMinimal(el);
    return ok;
  }

  function getTargets() {
    return {
      elX: document.getElementById(FIELD_6CHAR),
      elDate: document.getElementById(FIELD_DATE),
      elT3: document.getElementById(FIELD_T3),
      elT4: document.getElementById(FIELD_T4),
      elT5: document.getElementById(FIELD_T5),
    };
  }

  function anyTargetPresent(t) {
    return !!(t.elX || t.elDate || t.elT3 || t.elT4 || t.elT5);
  }

  // ============================================================
  // MAIN FILL
  // ============================================================
  function tryFillOnce() {
    if (window[ONCE_FLAG]) return true;

    // Don’t run on login/error-ish pages
    if (looksLikeLoginOrErrorPage()) {
      log("Detected login/error page; not filling.");
      window[ONCE_FLAG] = true;
      return true;
    }

    const t = getTargets();
    if (!anyTargetPresent(t)) return false; // keep waiting

    const x  = normalizeSix(getParam(PARAM_X));
    const t3 = normalize41(getParam(PARAM_T3));
    const t4 = normalizeInsured(getParam(PARAM_T4));
    const t5 = normalizeDate(getParam(PARAM_T5));

    // Strong date gating:
    // - only when any params exist (looks like a launch)
    // - only exact field id
    // - only if blank
    const hasAnyParams = !!(x || t3 || t4 || t5);
    const isExactDateField = !!(t.elDate && t.elDate.id === FIELD_DATE);
    const isBlankDate = !!(t.elDate && String(t.elDate.value || "").trim() === "");

    log("URL:", window.location.href);
    log("params:", { x, t3, t4, t5 });
    log("fields present:", {
      elX: !!t.elX,
      elDate: !!t.elDate,
      elT3: !!t.elT3,
      elT4: !!t.elT4,
      elT5: !!t.elT5,
    });
    log("date gate:", { hasAnyParams, isExactDateField, isBlankDate });

    let didAnything = false;

    if (x && t.elX)   didAnything = setValueNoFocus(t.elX, x) || didAnything;

    if (isExactDateField && hasAnyParams && isBlankDate) {
      didAnything = setValueNoFocus(t.elDate, oneWeekFromTodayString()) || didAnything;
    }

    if (t3 && t.elT3) didAnything = setValueNoFocus(t.elT3, t3) || didAnything;
    if (t4 && t.elT4) didAnything = setValueNoFocus(t.elT4, t4) || didAnything;
    if (t5 && t.elT5) didAnything = setValueNoFocus(t.elT5, t5) || didAnything;

    window[ONCE_FLAG] = true;
    log(didAnything ? "done (filled)" : "done (nothing filled)");
    return true;
  }

  // ============================================================
  // START (wait for page to actually finish loading first)
  // ============================================================
  function startPolling() {
    let polls = 0;
    const timer = setInterval(() => {
      polls++;

      // If the document is still loading, don’t even try yet.
      if (document.readyState !== "complete") return;

      if (tryFillOnce() || polls >= MAX_POLLS) {
        clearInterval(timer);
        log("stopped polling. polls=", polls);
      }
    }, POLL_MS);
  }

  startPolling();
})();
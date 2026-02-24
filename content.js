// content.js
// SharePoint FormServer CUW134 auto-fill (x/t3/t4/t5) + follow-up date (today+7)
// Inject via manifest.json on:
//   http://erieshare/sites/formsmgmt/CommlForms/_layouts/15/FormServer.aspx*

(() => {
  // ============================================================
  // CONFIG
  // ============================================================
  const PARAM_X = "x";
  const PARAM_T3 = "t3";
  const PARAM_T4 = "t4";
  const PARAM_T5 = "t5";

  const FIELD_6CHAR = "FormControl_V1_I1_S1_I1_T1";
  const FIELD_DATE = "FormControl_V1_I1_S2_I3_T1"; // today+7
  const FIELD_T3 = "FormControl_V1_I1_S2_I3_T3";
  const FIELD_T4 = "FormControl_V1_I1_S2_I3_T4"; // insured name
  const FIELD_T5 = "FormControl_V1_I1_S2_I3_T5"; // claim date

  const POLL_MS = 400;
  const MAX_POLLS = 120;

  // One-run guard
  const ONCE_FLAG = "__erie_form_autofill_done_v3";

  // Set true to debug in console on the SharePoint form page
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

  function normalizeSix(v) {
    return String(v || "").trim().slice(0, 6);
  }

  function normalize41(v) {
    return String(v || "").trim().slice(0, 41);
  }

  function normalizeInsured(v) {
    return String(v || "").trim().slice(0, 50);
  }

  function normalizeDate(v) {
    return String(v || "").trim();
  }

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
      try {
        el.value = value;
        return true;
      } catch {
        return false;
      }
    }
  }

  function fireMinimal(el) {
    // No focus/blur to avoid scroll jumps
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setValueNoFocus(el, value) {
    if (!el) return false;
    const ok = setNativeValue(el, value);
    if (ok) fireMinimal(el);
    return ok;
  }

  // ============================================================
  // MAIN FILL
  // ============================================================
  function tryFillOnce() {
    if (window[ONCE_FLAG]) return true;

    const elX = document.getElementById(FIELD_6CHAR);
    const elDate = document.getElementById(FIELD_DATE);
    const elT3 = document.getElementById(FIELD_T3);
    const elT4 = document.getElementById(FIELD_T4);
    const elT5 = document.getElementById(FIELD_T5);

    const targetsPresent = [elX, elDate, elT3, elT4, elT5].filter(Boolean).length;
    const ready =
      (elDate && (elX || elT3 || elT4 || elT5)) || targetsPresent >= 2;

    if (!ready) return false;

    const x = normalizeSix(getParam(PARAM_X));
    const t3 = normalize41(getParam(PARAM_T3));
    const t4 = normalizeInsured(getParam(PARAM_T4));
    const t5 = normalizeDate(getParam(PARAM_T5));

    log("URL:", window.location.href);
    log("params:", { x, t3, t4, t5 });
    log("fields present:", {
      elX: !!elX,
      elDate: !!elDate,
      elT3: !!elT3,
      elT4: !!elT4,
      elT5: !!elT5,
    });

    let didAnything = false;

    if (x && elX) didAnything = setValueNoFocus(elX, x) || didAnything;
    if (elDate) didAnything = setValueNoFocus(elDate, oneWeekFromTodayString()) || didAnything;
    if (t3 && elT3) didAnything = setValueNoFocus(elT3, t3) || didAnything;
    if (t4 && elT4) didAnything = setValueNoFocus(elT4, t4) || didAnything;
    if (t5 && elT5) didAnything = setValueNoFocus(elT5, t5) || didAnything;

    window[ONCE_FLAG] = true;
    log(didAnything ? "done (filled)" : "done (nothing filled)");
    return true;
  }

  // ============================================================
  // START
  // ============================================================
  let polls = 0;
  const timer = setInterval(() => {
    polls++;
    if (tryFillOnce() || polls >= MAX_POLLS) {
      clearInterval(timer);
      log("stopped polling. polls=", polls);
    }
  }, POLL_MS);
})();
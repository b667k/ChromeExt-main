(() => {
  // ============================================================
  // CONFIG
  // ============================================================
  const PARAM_X  = "x";
  const PARAM_T3 = "t3";
  const PARAM_T4 = "t4";
  const PARAM_T5 = "t5";

  const FIELD_6CHAR = "FormControl_V1_I1_S1_I1_T1";
  const FIELD_DATE  = "FormControl_V1_I1_S2_I3_T1"; // today+7
  const FIELD_T3    = "FormControl_V1_I1_S2_I3_T3";
  const FIELD_T4    = "FormControl_V1_I1_S2_I3_T4"; // insured name
  const FIELD_T5    = "FormControl_V1_I1_S2_I3_T5"; // claim date

  const POLL_MS = 400;
  const MAX_POLLS = 120;

  // One-run guard
  const ONCE_FLAG = "__erie_form_autofill_done_v2";

  // ============================================================
  // HELPERS
  // ============================================================
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

  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && typeof desc.set === "function") {
      desc.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  function fireMinimal(el) {
    // DO NOT focus/blur. That’s what causes scroll jumps/fighting.
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setValueNoFocus(el, value) {
    if (!el) return false;
    setNativeValue(el, value);
    fireMinimal(el);
    return true;
  }

  // ============================================================
  // MAIN FILL (NO FOCUS, STOP ASAP)
  // ============================================================
  function tryFillOnce() {
    if (window[ONCE_FLAG]) return true;

    const elX    = document.getElementById(FIELD_6CHAR);
    const elDate = document.getElementById(FIELD_DATE);
    const elT3   = document.getElementById(FIELD_T3);
    const elT4   = document.getElementById(FIELD_T4);
    const elT5   = document.getElementById(FIELD_T5);

    // Wait until the form controls exist (at least the date field usually exists when ready)
    if (!elDate && !elX && !elT3 && !elT4 && !elT5) return false;

    const x  = normalizeSix(getParam(PARAM_X));
    const t3 = normalize41(getParam(PARAM_T3));
    const t4 = normalizeInsured(getParam(PARAM_T4));
    const t5 = normalizeDate(getParam(PARAM_T5));

    if (x && elX)   setValueNoFocus(elX, x);
    if (elDate)     setValueNoFocus(elDate, oneWeekFromTodayString());
    if (t3 && elT3) setValueNoFocus(elT3, t3);
    if (t4 && elT4) setValueNoFocus(elT4, t4);
    if (t5 && elT5) setValueNoFocus(elT5, t5);

    // Mark done immediately so we never touch the page again
    window[ONCE_FLAG] = true;
    return true;
  }

  let polls = 0;
  const timer = setInterval(() => {
    polls++;
    if (tryFillOnce() || polls >= MAX_POLLS) {
      clearInterval(timer);
    }
  }, POLL_MS);
})();
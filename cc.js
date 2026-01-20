// cc.js (FULL UPDATED - frame-aware + strong reset + latest-wins + req-aware RUN_NOW + PING + visible-input-only +
//          wait-not-loading + blur-commit + active-element latch)

(() => {
  const DEBUG = true;
  const LOG = {
    info: (...a) => DEBUG && console.log("[TM]", ...a),
    warn: (...a) => console.warn("[TM]", ...a),
    err:  (...a) => DEBUG && console.error("[TM]", ...a),
    click: (...a) => DEBUG && console.log("[TM-CLICK]", ...a),
  };

  function shouldProcessThisTab() {
    try {
      return new URLSearchParams(location.search || "").get("process") === "true";
    } catch {
      return false;
    }
  }

  function birthReq() {
    try { return new URLSearchParams(location.search || "").get("tm_t") || ""; }
    catch { return ""; }
  }

  // We want the message listener to exist even if we decide not to run automation
  const IS_PROCESS = shouldProcessThisTab();

  /** timings */
  const WAIT_STEP_MS = 35;
  const WAIT_GW_READY_MS = 25000;

  const WAIT_INPUT_MS = 12000;
  const WAIT_SIMPLE_SCREEN_MS = 7000;

  const WAIT_ROW0_MS = 14000;
  const WAIT_LOSS_MENU_MS = 18000;
  const WAIT_LOSS_SCREEN_MS = 20000;

  const POST_CLICK_CHECK_MS = 1400;
  const ROW0_RETRY_COUNT = 28;
  const ROW0_RETRY_GAP_MS = 85;

  const RESET_TO_SIMPLE_ROUNDS = 16;

  // Search submit reliability
  const SEARCH_START_WAIT_MS = 2200;
  const SEARCH_TRIES = 4;

  /** selectors */
  const SIMPLE_CLAIM_INPUT =
    'input[name="SimpleClaimSearch-SimpleClaimSearchScreen-SimpleClaimSearchDV-ClaimNumber"]';

  const SIMPLE_SEARCH_SCREEN_MARKERS = [
    "#SimpleClaimSearch-SimpleClaimSearchScreen",
    "[id*='SimpleClaimSearchScreen']",
    "[id*='SimpleClaimSearch']",
  ];

  const SEARCH_TAB_SEL =
    "#TabBar-SearchTab.gw-action--inner[role='menuitem'], div.gw-action--inner[role='menuitem'][data-gw-shortcut*='TabBar-SearchTab']";
  const SEARCH_TAB_FALLBACKS = [
    "#TabBar-SearchTab",
    "[id='TabBar-SearchTab']",
    "[data-gw-shortcut*='TabBar-SearchTab']",
  ];

  const SIMPLE_SEARCH_BTN =
    "#SimpleClaimSearch-SimpleClaimSearchScreen-SimpleClaimSearchDV-ClaimSearchAndResetInputSet-Search";
  const SIMPLE_SEARCH_BTN_INNER =
    "#SimpleClaimSearch-SimpleClaimSearchScreen-SimpleClaimSearchDV-ClaimSearchAndResetInputSet-Search .gw-actionable--inner";

  const RESULTS_LV =
    "#SimpleClaimSearch-SimpleClaimSearchScreen-SimpleClaimSearchResultsLV";

  const ROW0 =
    "#SimpleClaimSearch-SimpleClaimSearchScreen-SimpleClaimSearchResultsLV-0-ClaimNumber_button";

  const LOSS_DETAILS_MENUITEM_SELECTOR =
    "div.gw-action--inner[role='menuitem'][data-gw-shortcut*='Claim-MenuLinks-Claim_ClaimLossDetailsGroup']";
  const LOSS_DETAILS_MENUITEM_ID_FALLBACK =
    "[id*='Claim-MenuLinks-Claim_ClaimLossDetailsGroup'][role='menuitem'], [data-gw-shortcut*='Claim_ClaimLossDetailsGroup'][role='menuitem']";

  const LOSS_DETAILS_SCREENS = [
    "#ClaimLossDetails-ClaimLossDetailsScreen",
    "#ClaimLossDetailsScreen",
    "[id*='ClaimLossDetailsScreen']",
  ];

  const CLAIM_OPEN_MARKERS = [
    LOSS_DETAILS_MENUITEM_SELECTOR,
    LOSS_DETAILS_MENUITEM_ID_FALLBACK,
    "#Claim-MenuLinks",
    "[id^='Claim-MenuLinks']",
    "#Claim-ClaimScreen",
    "[id*='ClaimScreen']",
  ];

  const CLAIM_SCREEN_MARKERS = [
    "#Claim-ClaimScreen",
    "[id*='ClaimScreen']",
    "#Claim-MenuLinks",
    "[id^='Claim-MenuLinks']",
  ];

  // best-effort loading markers
  const GW_LOADING_MARKERS = [
    ".gw-loading",
    ".gw-mask",
    ".gw-mask--active",
    ".gw-LoadingWidget",
    "[class*='gw-mask']",
    "[class*='loading']",
    "[aria-busy='true']",
  ];

  /** utils */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
  }

  async function waitSel(selector, timeoutMs, { mustBeVisible = false } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const el = document.querySelector(selector);
      if (el && (!mustBeVisible || isVisible(el))) return el;
      await sleep(WAIT_STEP_MS);
    }
    return null;
  }

  async function waitAny(selectors, timeoutMs, opts) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el && (!opts?.mustBeVisible || isVisible(el))) return el;
      }
      await sleep(WAIT_STEP_MS);
    }
    return null;
  }

  function hasGuidewireUi() {
    return (
      !!document.querySelector("#TabBar-SearchTab") ||
      !!document.querySelector("[data-gw-shortcut*='TabBar-SearchTab']") ||
      !!document.querySelector("[id*='TabBar']")
    );
  }

  // With all_frames:true, this prevents non-UI frames from running loops.
  const IS_UI_FRAME = hasGuidewireUi();

  async function waitForNotLoading(timeoutMs = 9000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      let any = false;
      for (const sel of GW_LOADING_MARKERS) {
        const el = document.querySelector(sel);
        if (el && isVisible(el)) { any = true; break; }
      }
      if (!any) return true;
      await sleep(60);
    }
    return false;
  }

  async function hardClick(el, label = "") {
    if (!el) return false;
    try { el.scrollIntoView({ behavior: "auto", block: "center" }); } catch {}
    try { el.focus(); } catch {}

    const rect = el.getBoundingClientRect();
    const cx = Math.floor(rect.left + rect.width / 2);
    const cy = Math.floor(rect.top + rect.height / 2);
    LOG.click("hardClick", label, { cx, cy });

    const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: 1 };
    try { el.dispatchEvent(new PointerEvent("pointerdown", opts)); } catch {}
    try { el.dispatchEvent(new MouseEvent("mousedown", opts)); } catch {}
    try { el.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0 })); } catch {}
    try { el.dispatchEvent(new MouseEvent("mouseup", { ...opts, buttons: 0 })); } catch {}
    try { el.dispatchEvent(new MouseEvent("click", { ...opts, buttons: 0 })); } catch {}
    try { el.click(); } catch {}

    // extra keyboard activation (GW likes this)
    try {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keyup",   { key: "Enter", code: "Enter", bubbles: true }));
    } catch {}

    await sleep(35);
    return true;
  }

  function setInputValueNative(input, value) {
    if (!input) return;

    const setter =
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set ||
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, "value")?.set;

    try { input.focus(); } catch {}

    // user-like clear
    try {
      input.select?.();
      document.execCommand?.("delete");
    } catch {}

    // clear
    try {
      if (setter) setter.call(input, "");
      else input.value = "";
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch {}

    // set
    try {
      if (setter) setter.call(input, value);
      else input.value = value;

      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      input.dispatchEvent(new Event("change", { bubbles: true }));

      // commit
      input.dispatchEvent(new Event("blur", { bubbles: true }));
      try { input.blur(); } catch {}
    } catch {}
  }

  function getInputValue(input) {
    try { return (input?.value ?? "").trim(); } catch { return ""; }
  }

  async function pressEnterIn(el) {
    if (!el) return;
    try { el.focus(); } catch {}
    try {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keyup",   { key: "Enter", code: "Enter", bubbles: true }));
    } catch {}
  }

  function isOnClaimScreen() {
    return CLAIM_SCREEN_MARKERS.some((s) => !!document.querySelector(s));
  }

  function isOnLossDetails() {
    return LOSS_DETAILS_SCREENS.some((s) => !!document.querySelector(s));
  }

  function isOnSimpleSearchScreenNow() {
    return SIMPLE_SEARCH_SCREEN_MARKERS.some((s) => {
      const el = document.querySelector(s);
      return !!el && isVisible(el);
    });
  }

  async function refindSimpleClaimInput() {
    // Require screen presence to avoid grabbing stale/hidden DV inputs
    if (!isOnSimpleSearchScreenNow()) return null;

    const all = Array.from(document.querySelectorAll(SIMPLE_CLAIM_INPUT));
    const vis = all.find(isVisible);
    if (vis) return vis;

    return await waitSel(SIMPLE_CLAIM_INPUT, WAIT_INPUT_MS, { mustBeVisible: true });
  }

  function searchLooksStarted() {
    if (document.querySelector(ROW0)) return true;
    if (document.querySelector(RESULTS_LV)) return true;

    const outer = document.querySelector(SIMPLE_SEARCH_BTN);
    if (outer) {
      const ariaDis = outer.getAttribute("aria-disabled");
      if (ariaDis === "true") return true;
      if (outer.disabled) return true;
      if (outer.classList.contains("gw-disabled") || outer.classList.contains("gw-disabled--true")) return true;
    }

    for (const sel of GW_LOADING_MARKERS) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return true;
    }
    return false;
  }

  /** state */
  let running = false;
  let lastSeenKick = -1;

  async function getState() {
    return await chrome.storage.local.get(["handoff", "ownerReq", "lastReq", "kick"]);
  }
  async function setLastReq(req) {
    await chrome.storage.local.set({ lastReq: req });
  }

  async function stillOwner(req) {
    const s = await getState();
    return s.ownerReq === req && s.handoff?.req === req;
  }

  async function shouldContinueForReq(req) {
    return await stillOwner(req);
  }

  /** latch that stops immediately if a newer req arrives */
  async function setAndLatchClaimValue(value, {
    latchMs = 1100,
    checkEveryMs = 70,
    logLabel = "ClaimInput",
    req = null,
    quietAfterFirstFix = true
  } = {}) {
    const t0 = Date.now();
    let loggedOnce = false;

    while (Date.now() - t0 < latchMs) {
      if (req && !(await shouldContinueForReq(req))) return false;

      const input = await refindSimpleClaimInput();
      if (!input) return false;

      try {
        input.setAttribute("autocomplete", "off");
        input.setAttribute("autocorrect", "off");
        input.setAttribute("autocapitalize", "off");
        input.setAttribute("spellcheck", "false");
      } catch {}

      // Don’t fight GW while it’s yanking focus during hydration
      try { input.focus(); } catch {}
      await sleep(15);
      if (document.activeElement !== input) {
        await sleep(checkEveryMs);
        continue;
      }

      const cur = getInputValue(input);
      if (cur !== value) {
        if (!quietAfterFirstFix || !loggedOnce) {
          LOG.warn(`${logLabel}: value mismatch, fixing`, "cur=", cur, "want=", value);
          loggedOnce = true;
        }
        setInputValueNative(input, value);
        await sleep(45);
        await pressEnterIn(input);
      }

      await sleep(checkEveryMs);
    }

    if (req && !(await shouldContinueForReq(req))) return false;

    const input = await refindSimpleClaimInput();
    return !!input && getInputValue(input) === value;
  }

  async function waitForGuidewireReady() {
    return (
      document.querySelector(SEARCH_TAB_SEL) ||
      (await waitAny([SEARCH_TAB_SEL, ...SEARCH_TAB_FALLBACKS], WAIT_GW_READY_MS))
    );
  }

  function findClaimMenuItem() {
    const nodes = Array.from(document.querySelectorAll('[role="menuitem"], .gw-action--inner[role="menuitem"]'))
      .filter(isVisible);
    const re = /(simple\s*claim|claim\s*search|claim)/i;
    for (const el of nodes) {
      const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (re.test(txt)) return el;
    }
    return null;
  }

  /**
   * Strong reset:
   * - clicks Search tab twice
   * - waits for mask to clear
   * - clicks Claim/Search menu item
   * - waits for Simple Search markers + input
   */
  async function ensureOnSimpleSearch() {
    const tab = await waitForGuidewireReady();
    if (!tab) return null;

    for (let i = 0; i < RESET_TO_SIMPLE_ROUNDS; i++) {
      await hardClick(tab, "SearchTab");
      await sleep(140);
      await waitForNotLoading(9000);

      await hardClick(tab, "SearchTab(2)");
      await sleep(200);
      await waitForNotLoading(9000);

      const claimItem = findClaimMenuItem();
      if (claimItem) {
        await hardClick(claimItem, "MenuItem:Claim");
        await sleep(220);
        await waitForNotLoading(9000);
      }

      await waitAny(SIMPLE_SEARCH_SCREEN_MARKERS, WAIT_SIMPLE_SCREEN_MS).catch(() => null);

      const input = await refindSimpleClaimInput();
      if (input) {
        await waitForNotLoading(9000);
        return input;
      }

      await sleep(220);
    }
    return null;
  }

  async function clickSearchOnce() {
    const outer = document.querySelector(SIMPLE_SEARCH_BTN) || await waitSel(SIMPLE_SEARCH_BTN, 2600);
    if (outer) await hardClick(outer, "SearchBtn(outer)");

    const inner = document.querySelector(SIMPLE_SEARCH_BTN_INNER) || await waitSel(SIMPLE_SEARCH_BTN_INNER, 2600);
    if (inner) await hardClick(inner, "SearchBtn(inner)");
  }

  async function submitSearchReliable(claim, req) {
    for (let i = 1; i <= SEARCH_TRIES; i++) {
      if (!(await shouldContinueForReq(req))) return false;

      LOG.info(`Search submit attempt ${i}/${SEARCH_TRIES}`);

      await waitForNotLoading(9000);

      await setAndLatchClaimValue(claim, {
        latchMs: 340,
        checkEveryMs: 70,
        logLabel: "PreSearchLatch",
        req
      });

      await clickSearchOnce();

      const input = await refindSimpleClaimInput();
      if (input) await pressEnterIn(input);

      const started = await waitAny([ROW0, RESULTS_LV, ...GW_LOADING_MARKERS], SEARCH_START_WAIT_MS);
      if (started || searchLooksStarted()) return true;

      await sleep(240);
    }
    return false;
  }

  async function openClaimFromRow0_Fast(req) {
    for (let i = 1; i <= ROW0_RETRY_COUNT; i++) {
      if (!(await shouldContinueForReq(req))) return false;

      const row0El = document.querySelector(ROW0);
      if (!row0El) return false;

      LOG.info(`CC: Row0 click attempt ${i}/${ROW0_RETRY_COUNT}`);
      await hardClick(row0El, "Row0");

      const opened = await waitAny(CLAIM_OPEN_MARKERS, POST_CLICK_CHECK_MS);
      if (opened) return true;

      await sleep(ROW0_RETRY_GAP_MS);
    }
    return false;
  }

  async function clickLossDetailsReliable(req) {
    if (!(await shouldContinueForReq(req))) return false;

    const el = await waitAny(
      [LOSS_DETAILS_MENUITEM_SELECTOR, LOSS_DETAILS_MENUITEM_ID_FALLBACK],
      WAIT_LOSS_MENU_MS,
      { mustBeVisible: true }
    );
    if (!el) return false;

    await hardClick(el, "LossDetailsMenuItem");
    if (!isOnLossDetails()) {
      await sleep(260);
      await hardClick(el, "LossDetailsMenuItem(retry)");
    }
    return true;
  }

  /** scheduler */
  let scheduled = false;
  function schedule(ms = 0) {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      runLoop();
    }, ms);
  }

  /** main loop */
  async function runLoop() {
    if (running) return;
    running = true;

    try {
      while (true) {
        const { handoff, ownerReq, lastReq, kick } = await getState();
        if (!handoff?.claim || !handoff?.req) return;
        if (ownerReq !== handoff.req) return;

        // latest-wins: only process a new kick or a new req
        if (lastReq === handoff.req && kick === lastSeenKick) return;

        lastSeenKick = kick;

        const req = handoff.req;
        const claim = handoff.claim;

        LOG.info("CC run start", {
          claim, req, kick,
          birthReq: birthReq(),
          onClaimScreen: isOnClaimScreen(),
          frame: window === window.top ? "top" : "child",
          uiFrame: IS_UI_FRAME
        });

        const input = await ensureOnSimpleSearch();
        if (!input) {
          LOG.warn("No Simple Claim input; retrying soon");
          await sleep(650);
          continue;
        }

        if (!(await stillOwner(req))) {
          LOG.warn("Owner changed; switching immediately");
          schedule(0);
          return;
        }

        await waitForNotLoading(9000);

        const latched = await setAndLatchClaimValue(claim, {
          latchMs: 1250,
          checkEveryMs: 70,
          logLabel: "ClaimInput",
          req
        });

        if (!latched) {
          LOG.warn("Could not latch claim value (or req changed); retrying soon");
          await sleep(420);
          continue;
        }

        if (!(await stillOwner(req))) {
          LOG.warn("Owner changed after setting input; switching immediately");
          schedule(0);
          return;
        }

        const fired = await submitSearchReliable(claim, req);
        if (!fired) {
          LOG.warn("Search did not appear to start; retrying soon");
          await sleep(600);
          continue;
        }

        // Post-submit GW can rehydrate old values; short re-latch
        await setAndLatchClaimValue(claim, {
          latchMs: 720,
          checkEveryMs: 85,
          logLabel: "PostSearchClaimInput",
          req
        });

        if (!(await stillOwner(req))) {
          LOG.warn("Owner changed after search; switching immediately");
          schedule(0);
          return;
        }

        const row0 = await waitSel(ROW0, WAIT_ROW0_MS, { mustBeVisible: true });
        if (!row0) {
          LOG.warn("No row0 yet; retrying soon");
          await sleep(650);
          continue;
        }

        const opened = await openClaimFromRow0_Fast(req);
        if (!opened) {
          LOG.warn("Row0 didn't open claim; retrying soon");
          await sleep(650);
          continue;
        }

        if (!(await stillOwner(req))) {
          LOG.warn("Owner changed after opening claim; switching immediately");
          schedule(0);
          return;
        }

        const clicked = await clickLossDetailsReliable(req);
        if (!clicked) {
          LOG.warn("Could not click Loss Details; retrying soon");
          await sleep(750);
          continue;
        }

        const ok = isOnLossDetails() || !!(await waitAny(LOSS_DETAILS_SCREENS, WAIT_LOSS_SCREEN_MS));
        if (!ok) {
          LOG.warn("Loss Details not detected; retrying soon");
          await sleep(800);
          continue;
        }

        await setLastReq(req);
        LOG.info("✅ SUCCESS", claim, req, "kick", kick);
        return;
      }
    } catch (e) {
      LOG.err("Run crashed:", e?.message || e);
      schedule(900);
    } finally {
      running = false;
    }
  }

  // req-aware RUN_NOW gate
  async function shouldRunForReq(targetReq) {
    const { handoff, ownerReq } = await chrome.storage.local.get(["handoff", "ownerReq"]);
    return !!handoff?.req && handoff.req === targetReq && ownerReq === targetReq;
  }

  // One listener (PING + RUN_NOW)
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "PING_TM") {
      try {
        sendResponse({
          ok: true,
          process: IS_PROCESS,
          ui: IS_UI_FRAME,
          birthReq: birthReq(),
          frame: window === window.top ? "top" : "child"
        });
      } catch {}
      return;
    }

    if (msg?.type !== "RUN_NOW") return;
    if (!IS_PROCESS || !IS_UI_FRAME) return;

    if (msg.req) {
      shouldRunForReq(msg.req).then((ok) => {
        if (!ok) {
          LOG.warn("Ignoring stale RUN_NOW", { msgReq: msg.req });
          return;
        }
        schedule(0);
      });
      return;
    }

    schedule(0);
  });

  // Only the real process+UI frame should run automation
  if (!IS_PROCESS || !IS_UI_FRAME) return;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.ownerReq || changes.kick) schedule(0);
  });

  // kick off
  schedule(650);
  schedule(1600);
})();

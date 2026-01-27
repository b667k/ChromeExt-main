// cc.js (FULL UPDATED - STUCK-FIX + POLLING + AGGRESSIVE NAV + RACE FIX)

(() => {
  const DEBUG = false;
const LOG = DEBUG
  ? {
      info:  (...a) => console.log("[TM]", ...a),
      warn:  (...a) => console.warn("[TM]", ...a),
      err:   (...a) => console.error("[TM]", ...a),
      click: (...a) => console.log("[TM-CLICK]", ...a),
    }
  : { info(){}, warn(){}, err(){}, click(){} };

  // --- Initial Environment Checks ---

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

  function hasGuidewireUi() {
    return (
      !!document.querySelector("#TabBar-SearchTab") ||
      !!document.querySelector("[data-gw-shortcut*='TabBar-SearchTab']") ||
      !!document.querySelector("[id*='TabBar']") ||
      !!document.querySelector(".gw-UiLayer")
    );
  }

  // --- Configuration ---

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
  
  // Increased reset rounds to handle slow transitions
  const RESET_TO_SIMPLE_ROUNDS = 25; 
  const SEARCH_START_WAIT_MS = 2200;
  const SEARCH_TRIES = 4;

  // --- Selectors ---

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

  const GW_LOADING_MARKERS = [
    ".gw-loading",
    ".gw-mask",
    ".gw-mask--active",
    ".gw-LoadingWidget",
    "[class*='gw-mask']",
    "[class*='loading']",
    "[aria-busy='true']",
  ];

  // --- Utils ---

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

    try {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keyup",   { key: "Enter", code: "Enter", bubbles: true }));
    } catch {}

    await sleep(35);
    return true;
  }

  function setInputValueNative(input, value) {
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set ||
                   Object.getOwnPropertyDescriptor(HTMLElement.prototype, "value")?.set;

    try { input.focus(); } catch {}

    const clear = () => {
        try { input.select?.(); document.execCommand?.("delete"); } catch {}
        try {
          if (setter) setter.call(input, "");
          else input.value = "";
          input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
        } catch {}
    };

    clear();
    input.dispatchEvent(new Event("blur", { bubbles: true })); // Trigger validation
    try { input.blur(); } catch {}
    try { input.focus(); } catch {}

    try {
      if (setter) setter.call(input, value);
      else input.value = value;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
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
      if (outer.getAttribute("aria-disabled") === "true") return true;
      if (outer.disabled || outer.classList.contains("gw-disabled")) return true;
    }
    for (const sel of GW_LOADING_MARKERS) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return true;
    }
    return false;
  }

  // --- State Management ---

  let running = false;
  let hasPendingRun = false; 
  let lastSeenKick = -1;
  let lastRunTime = 0;

  async function getState() {
    return await chrome.storage.local.get(["handoff", "ownerReq", "lastReq", "lastClaim", "kick"]);
  }

  async function setSuccessState(req, claim) {
    await chrome.storage.local.set({ lastReq: req, lastClaim: claim });
  }

  async function stillOwner(req) {
    const s = await getState();
    return s.ownerReq === req && s.handoff?.req === req;
  }

  // --- Critical Navigation ---

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

  // AGGRESSIVE RESET: Hammer the Search Tab until the input appears
  async function ensureOnSimpleSearch() {
    let tab = await waitForGuidewireReady();
    if (!tab) return null;

    for (let i = 0; i < RESET_TO_SIMPLE_ROUNDS; i++) {
      // 1. Check if we are already there
      if (isOnSimpleSearchScreenNow()) {
          const input = await refindSimpleClaimInput();
          if (input) return input;
      }

      // 2. Click Search Tab
      tab = document.querySelector(SEARCH_TAB_SEL) || document.querySelector(SEARCH_TAB_FALLBACKS[0]);
      if (tab) {
          await hardClick(tab, "SearchTab");
          await sleep(150);
          await waitForNotLoading(3000);
      }

      // 3. Occasionally try clicking the dropdown menu item directly if the tab click is stuck
      if (i % 3 === 0) {
        const claimItem = findClaimMenuItem();
        if (claimItem) {
            await hardClick(claimItem, "MenuItem:Claim");
            await sleep(250);
            await waitForNotLoading(5000);
        }
      }

      await sleep(200);
    }
    return null;
  }

  // --- Automation Steps ---

  async function clickSearchOnce() {
    const outer = document.querySelector(SIMPLE_SEARCH_BTN) || await waitSel(SIMPLE_SEARCH_BTN, 2600);
    if (outer) await hardClick(outer, "SearchBtn(outer)");

    const inner = document.querySelector(SIMPLE_SEARCH_BTN_INNER) || await waitSel(SIMPLE_SEARCH_BTN_INNER, 2600);
    if (inner) await hardClick(inner, "SearchBtn(inner)");
  }

  async function setAndLatchClaimValue(value, { latchMs = 1100, checkEveryMs = 70, req = null } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < latchMs) {
      if (req && !(await stillOwner(req))) return false;
      
      const input = await refindSimpleClaimInput();
      if (!input) return false;

      try { input.focus(); } catch {}
      await sleep(15);
      
      if (document.activeElement !== input) {
        await sleep(checkEveryMs);
        continue;
      }

      if (getInputValue(input) !== value) {
        setInputValueNative(input, value);
        await sleep(45);
        await pressEnterIn(input);
      }
      await sleep(checkEveryMs);
    }
    const input = await refindSimpleClaimInput();
    return !!input && getInputValue(input) === value;
  }

  async function submitSearchReliable(claim, req) {
    for (let i = 1; i <= SEARCH_TRIES; i++) {
      if (!(await stillOwner(req))) return false;

      LOG.info(`Search submit attempt ${i}`);
      await waitForNotLoading(9000);

      await setAndLatchClaimValue(claim, { latchMs: 340, req });
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
      if (!(await stillOwner(req))) return false;
      const row0El = document.querySelector(ROW0);
      if (!row0El) return false;

      await hardClick(row0El, "Row0");
      const opened = await waitAny(CLAIM_OPEN_MARKERS, POST_CLICK_CHECK_MS);
      if (opened) return true;
      await sleep(ROW0_RETRY_GAP_MS);
    }
    return false;
  }

  async function clickLossDetailsReliable(req) {
    if (!(await stillOwner(req))) return false;
    const el = await waitAny([LOSS_DETAILS_MENUITEM_SELECTOR, LOSS_DETAILS_MENUITEM_ID_FALLBACK], WAIT_LOSS_MENU_MS, { mustBeVisible: true });
    if (!el) return false;

    await hardClick(el, "LossDetailsMenuItem");
    if (!isOnLossDetails()) {
      await sleep(260);
      await hardClick(el, "LossDetailsMenuItem(retry)");
    }
    return true;
  }

  // --- Scheduler & Watchdog ---

  let scheduled = false;
  function schedule(ms = 0) {
    if (running) {
      hasPendingRun = true;
      return;
    }
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      runLoop();
    }, ms);
  }

  // --- Main Loop ---

  async function runLoop() {
    if (running) { hasPendingRun = true; return; }
    
    // STUCK BREAKER: If last run started > 45s ago and we are still here, something is wrong.
    // But since we just set running=true, we rely on the logic below to clear it.
    running = true;
    lastRunTime = Date.now();
    hasPendingRun = false;

    try {
      while (true) {
        // Watchdog check inside loop
        if (Date.now() - lastRunTime > 45000) {
            LOG.warn("Watchdog: Run taking too long, aborting to reset state.");
            return;
        }

        const { handoff, ownerReq, lastReq, lastClaim, kick } = await getState();

        if (!handoff?.claim || !handoff?.req) return;
        if (ownerReq !== handoff.req) return;

        // Logic: If (Req AND Claim) match last success -> Do nothing (wait for kick)
        const alreadyDone = (lastReq === handoff.req && lastClaim === handoff.claim);
        if (alreadyDone && kick === lastSeenKick) return;

        lastSeenKick = kick;
        const req = handoff.req;
        const claim = handoff.claim;

        if (!hasGuidewireUi()) {
           LOG.warn("UI not ready, waiting...");
           await sleep(500);
           continue; 
        }

        LOG.info("CC STARTING", { claim, req });

        const input = await ensureOnSimpleSearch();
        if (!input) {
          LOG.warn("Could not find Search Input after navigation retries");
          await sleep(650);
          continue;
        }

        if (!(await stillOwner(req))) return;
        await waitForNotLoading(9000);

        if (!(await setAndLatchClaimValue(claim, { latchMs: 1250, req }))) {
            LOG.warn("Latch failed"); await sleep(420); continue;
        }

        if (!(await stillOwner(req))) return;

        if (!(await submitSearchReliable(claim, req))) {
            LOG.warn("Search submit failed"); await sleep(600); continue;
        }

        await setAndLatchClaimValue(claim, { latchMs: 720, req }); // Short latch post-click

        if (!(await stillOwner(req))) return;

        const row0 = await waitSel(ROW0, WAIT_ROW0_MS, { mustBeVisible: true });
        if (!row0) {
            LOG.warn("Row0 missing"); await sleep(650); continue;
        }

        if (!(await openClaimFromRow0_Fast(req))) {
            LOG.warn("Open claim failed"); await sleep(650); continue;
        }

        if (!(await stillOwner(req))) return;

        if (!(await clickLossDetailsReliable(req))) {
            LOG.warn("Loss Details click failed"); await sleep(750); continue;
        }

        const ok = isOnLossDetails() || !!(await waitAny(LOSS_DETAILS_SCREENS, WAIT_LOSS_SCREEN_MS));
        if (!ok) {
            LOG.warn("Loss Details screen not reached"); await sleep(800); continue;
        }

        await setSuccessState(req, claim);
        LOG.info("✅ SUCCESS", claim);
        return;
      }
    } catch (e) {
      LOG.err("CRASH:", e);
      schedule(1000);
    } finally {
      running = false;
      if (hasPendingRun) {
        LOG.info("Pending run detected, restarting.");
        schedule(100);
      }
    }
  }

  // --- Triggers ---

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "PING_TM") {
      sendResponse({ ok: true, process: shouldProcessThisTab(), ui: hasGuidewireUi() });
      return;
    }
    if (msg?.type === "RUN_NOW" && shouldProcessThisTab()) {
      schedule(0);
    }
  });

  if (!shouldProcessThisTab()) return;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.ownerReq || changes.kick || changes.handoff)) schedule(0);
  });

  // POLLING: Force check every 1s to catch missed triggers
  setInterval(() => schedule(0), 1000);

  schedule(500);
})();

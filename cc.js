// cc.js (FULL UPDATED - STUCK-FIX + POLLING + AGGRESSIVE NAV + RACE FIX
//        + RUN MODE SETTINGS: full | claim_only | copy_only)

(() => {
  const DEBUG = true;
  const LOG = DEBUG
    ? {
      info: (...a) => console.log("[TM]", ...a),
      warn: (...a) => console.warn("[TM]", ...a),
      err: (...a) => console.error("[TM]", ...a),
      click: (...a) => console.log("[TM-CLICK]", ...a),
    }
    : { info() { }, warn() { }, err() { }, click() { } };

  // --- Settings ---
  const SETTINGS_KEY = "settings_v1";
  const DEFAULT_SETTINGS = { runMode: "full" }; // full | claim_only | copy_only
  let cachedRunMode = DEFAULT_SETTINGS.runMode;

  async function loadRunMode() {
    if (!contextAlive) return cachedRunMode;
    try {
      const data = await chrome.storage.sync.get(SETTINGS_KEY);
      const mode = data?.[SETTINGS_KEY]?.runMode || DEFAULT_SETTINGS.runMode;
      cachedRunMode = mode;
      return mode;
    } catch (e) {
      LOG.err("loadRunMode error:", e);
      if (isContextDead(e)) contextAlive = false;
      cachedRunMode = DEFAULT_SETTINGS.runMode;
      return cachedRunMode;
    }
  }

  // Keep cache fresh if user changes settings while CC tab is open
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      if (changes[SETTINGS_KEY]) {
        const next = changes[SETTINGS_KEY]?.newValue?.runMode;
        if (next) cachedRunMode = next;
      }
    });
  } catch (e) {
    LOG.err("chrome.storage.onChanged.addListener error:", e);
  }

  // --- Initial Environment Checks ---
  function shouldProcessThisTab() {
    try {
      return new URLSearchParams(location.search || "").get("process") === "true";
    } catch {
      return false;
    }
  }

  function birthReq() {
    try {
      return new URLSearchParams(location.search || "").get("tm_t") || "";
    } catch {
      return "";
    }
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
  const WAIT_ROW0_MS = 14000;
  const WAIT_LOSS_MENU_MS = 18000;
  const WAIT_LOSS_SCREEN_MS = 20000;
  const POST_CLICK_CHECK_MS = 1400;
  const ROW0_RETRY_COUNT = 10; // Reduced to prevent excessive spamming
  const ROW0_RETRY_GAP_MS = 200; // Increased delay between retries

  const RESET_TO_SIMPLE_ROUNDS = 25;
  const SEARCH_START_WAIT_MS = 2200;
  const SEARCH_TRIES = 3; // Reduced attempts

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

  // Fast: Wait for Guidewire click overlay to be removed (MutationObserver, no polling)
  function waitUntilClickable() {
    return new Promise((resolve) => {
      const o = document.getElementById("gw-click-overlay");
      if (!o || !o.classList.contains("gw-disable-click")) return resolve();

      new MutationObserver((m, obs) => {
        if (!o.classList.contains("gw-disable-click")) {
          obs.disconnect();
          resolve();
        }
      }).observe(o, { attributes: true, attributeFilter: ["class"] });
    });
  }

  // Fast: Wait for element using MutationObserver (no polling overhead)
  // timeoutMs = 0 means wait indefinitely (like scripts version)
  function waitForElm(selector, timeoutMs = 10000) {
    return new Promise((resolve) => {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);

      let timeoutId;
      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          if (timeoutId) clearTimeout(timeoutId);
          resolve(el);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      // Add timeout fallback (only if timeoutMs > 0)
      if (timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          observer.disconnect();
          resolve(null);
        }, timeoutMs);
      }
      // If timeoutMs is 0, wait indefinitely (like scripts version)
    });
  }

  // Fast: Wait for element with specific text content using MutationObserver
  // timeoutMs = 0 means wait indefinitely (like scripts version)
  async function waitForText(selector, expectedText, timeoutMs = 10000) {
    const el = await waitForElm(selector, timeoutMs);
    if (!el) return null;

    if (el.textContent.includes(expectedText)) {
      return el;
    }

    return new Promise((resolve) => {
      let timeoutId;
      const observer = new MutationObserver(() => {
        if (el.textContent.includes(expectedText)) {
          observer.disconnect();
          if (timeoutId) clearTimeout(timeoutId);
          resolve(el);
        }
      });

      observer.observe(el, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      // Add timeout fallback (only if timeoutMs > 0)
      if (timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          observer.disconnect();
          resolve(null);
        }, timeoutMs);
      }
      // If timeoutMs is 0, wait indefinitely (like scripts version)
    });
  }

  // Fast: Use MutationObserver-based waitForElm when possible, fallback to polling for visibility checks
  async function waitSel(selector, timeoutMs, { mustBeVisible = false } = {}) {
    if (!mustBeVisible) {
      // Fast path: use MutationObserver
      return await waitForElm(selector, timeoutMs);
    }
    // Visibility check requires polling
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const el = document.querySelector(selector);
      if (el && isVisible(el)) return el;
      await sleep(WAIT_STEP_MS);
    }
    return null;
  }

  async function waitAny(selectors, timeoutMs, opts) {
    if (!opts?.mustBeVisible) {
      // Fast path: check all selectors with MutationObserver
      for (const s of selectors) {
        const el = await waitForElm(s, 100); // Quick check
        if (el) return el;
      }
      // If none found quickly, wait for first one
      return new Promise((resolve) => {
        let timeoutId;
        const observers = [];
        const cleanup = () => {
          if (timeoutId) clearTimeout(timeoutId);
          observers.forEach(obs => obs.disconnect());
        };
        
        const checkAll = () => {
          for (const s of selectors) {
            const el = document.querySelector(s);
            if (el) {
              cleanup();
              return resolve(el);
            }
          }
        };
        
        const observer = new MutationObserver(checkAll);
        observer.observe(document.body, { childList: true, subtree: true });
        observers.push(observer);
        
        if (timeoutMs > 0) {
          timeoutId = setTimeout(() => {
            cleanup();
            resolve(null);
          }, timeoutMs);
        }
      });
    }
    // Visibility check requires polling
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el && isVisible(el)) return el;
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

  async function copyTextToClipboard(text) {
    const value = String(text || "").trim();
    if (!value) return false;

    // Try modern clipboard API first
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch { }

    // Fallback: hidden textarea + execCommand
    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);

      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return !!ok;
    } catch {
      return false;
    }
  }


  // Fast: Optimized click handler (based on scripts version, with logging)
  async function robustClick(el, label = "") {
    if (!el) return false;
    
    // Wait for Guidewire click overlay to be removed before clicking
    await waitUntilClickable();
    
    const rect = el.getBoundingClientRect();
    const cx = Math.floor(rect.left + rect.width / 2);
    const cy = Math.floor(rect.top + rect.height / 2);
    LOG.click("robustClick", label, { cx, cy });

    const opts = {
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy,
    };
    
    try { el.focus(); } catch { }
    try { el.dispatchEvent(new PointerEvent("pointerdown", opts)); } catch { }
    try { el.dispatchEvent(new MouseEvent("mousedown", opts)); } catch { }
    try { el.dispatchEvent(new PointerEvent("pointerup", opts)); } catch { }
    try { el.dispatchEvent(new MouseEvent("mouseup", opts)); } catch { }
    try { el.dispatchEvent(new MouseEvent("click", opts)); } catch { }
    try { el.click(); } catch { }

    await sleep(35);
    return true;
  }

  // Fast: Simple text insertion (matches scripts version for speed)
  function insertText(str, input = document.activeElement) {
    if (!input) return;
    input.value = str.trim();
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function setInputValueNative(input, value) {
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set ||
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, "value")?.set;

    try { input.focus(); } catch { }

    const clear = () => {
      try { input.select?.(); document.execCommand?.("delete"); } catch { }
      try {
        if (setter) setter.call(input, "");
        else input.value = "";
        input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
      } catch { }
    };

    clear();
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    try { input.blur(); } catch { }
    try { input.focus(); } catch { }

    try {
      if (setter) setter.call(input, value);
      else input.value = value;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("blur", { bubbles: true }));
      try { input.blur(); } catch { }
    } catch { }
  }

  function getInputValue(input) {
    try { return (input?.value ?? "").trim(); } catch { return ""; }
  }

  async function pressEnterIn(el) {
    if (!el) return;
    try { el.focus(); } catch { }
    try {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
    } catch { }
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
  let automationDisabled = false; // Flag to stop interfering after success
  let failureCount = 0; // Track consecutive failures for same claim
  let lastFailedClaim = ""; // Track which claim we're failing on
  let contextAlive = true; // False when extension context is invalidated — stops all loops
  let processedUrlKey = ""; // "tm_t|claimNumber" we already completed (prevents infinite URL re-runs)
  let urlBasedRun = false; // True when current run is URL-triggered (skip stillOwner checks)

  function isContextDead(e) {
    return e && String(e.message || e).includes("Extension context invalidated");
  }

  async function getState() {
    if (!contextAlive) return {};
    try {
      return await chrome.storage.local.get(["handoff", "ownerReq", "lastReq", "lastClaim", "kick"]);
    } catch (e) {
      LOG.err("getState error:", e);
      if (isContextDead(e)) contextAlive = false;
      return {};
    }
  }

  async function setSuccessState(req, claim) {
    if (!contextAlive) return;
    try {
      await chrome.storage.local.set({ lastReq: req, lastClaim: claim });
    } catch (e) {
      if (isContextDead(e)) contextAlive = false;
    }
  }

  async function stillOwner(req) {
    if (urlBasedRun) return true; // URL-based runs (VBS) bypass storage ownership check
    if (!contextAlive) return false;
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

  async function ensureOnSimpleSearch() {
    let tab = await waitForGuidewireReady();
    if (!tab) return null;

    for (let i = 0; i < RESET_TO_SIMPLE_ROUNDS; i++) {
      if (isOnSimpleSearchScreenNow()) {
        const input = await refindSimpleClaimInput();
        if (input) return input;
      }

      tab = document.querySelector(SEARCH_TAB_SEL) || document.querySelector(SEARCH_TAB_FALLBACKS[0]);
      if (tab) {
        await robustClick(tab, "SearchTab");
        await sleep(150);
        await waitForNotLoading(3000);
      }

      if (i % 3 === 0) {
        const claimItem = findClaimMenuItem();
        if (claimItem) {
          await robustClick(claimItem, "MenuItem:Claim");
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
    if (outer) await robustClick(outer, "SearchBtn(outer)");

    const inner = document.querySelector(SIMPLE_SEARCH_BTN_INNER) || await waitSel(SIMPLE_SEARCH_BTN_INNER, 2600);
    if (inner) await robustClick(inner, "SearchBtn(inner)");
  }

  async function setAndLatchClaimValue(value, { latchMs = 1100, checkEveryMs = 70, req = null } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < latchMs) {
      if (req && !(await stillOwner(req))) return false;

      const input = await refindSimpleClaimInput();
      if (!input) return false;

      try { input.focus(); } catch { }
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

      await robustClick(row0El, "Row0");
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

    await robustClick(el, "LossDetailsMenuItem");
    if (!isOnLossDetails()) {
      await sleep(260);
      await robustClick(el, "LossDetailsMenuItem(retry)");
    }
    return true;
  }

  // --- Scheduler & Watchdog ---
  let scheduled = false;
  function schedule(ms = 0) {
    if (!contextAlive) return;
    if (running) { hasPendingRun = true; return; }
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; if (contextAlive) runLoop(); }, ms);
  }

  // --- Main Loop ---
  async function runLoop() {
    if (running) { hasPendingRun = true; return; }

    running = true;
    lastRunTime = Date.now();
    hasPendingRun = false;

    try {
      let loopCount = 0;
      while (true) {
        loopCount++;
        if (loopCount > 10) {
          LOG.warn("Too many loops, stopping to prevent spamming.");
          return;
        }
        if (Date.now() - lastRunTime > 45000) {
          LOG.warn("Watchdog: Run taking too long, aborting to reset state.");
          return;
        }

        if (!contextAlive) return;

        // If automation is disabled after success, only check for genuinely NEW claims
        if (automationDisabled) {
          const urlParams = new URLSearchParams(location.search);
          const urlClaim = urlParams.get("claimNumber") || "";
          const urlReq = birthReq();
          if (urlClaim) {
            // Only re-enable for a genuinely NEW URL claim (different key)
            const urlKey = urlReq + "|" + urlClaim;
            if (processedUrlKey === urlKey) {
              return; // Same URL claim we already completed
            }
            LOG.info("New URL-based claim detected while disabled, re-enabling.");
            automationDisabled = false;
          } else {
            const { handoff, lastReq, lastClaim, kick } = await getState();
            const targetClaim = (handoff?.claim && handoff?.req === urlReq) ? handoff.claim : "";
            const targetReq = (handoff?.claim && handoff?.req === urlReq) ? handoff.req : "";
            if (!targetClaim) return;
            const alreadyDone = (lastReq === targetReq && lastClaim === targetClaim);
            if (alreadyDone && kick === lastSeenKick) {
              return;
            }
            // New storage-based claim detected
            automationDisabled = false;
          }
        }

        const { handoff, ownerReq, lastReq, lastClaim, kick } = await getState();

        // 1. Determine target claim and request ID
        // Priority: URL parameters > Storage (Latest handoff)
        const urlParams = new URLSearchParams(location.search);
        const urlClaim = urlParams.get("claimNumber") || "";
        const urlReq = birthReq(); // tm_t from URL

        let targetClaim = "";
        let targetReq = "";

        if (urlClaim) {
          // If claimNumber is in URL, trust it (robust fallback for interop with VBS)
          targetClaim = urlClaim;
          targetReq = urlReq;
        } else if (handoff?.claim && handoff?.req === urlReq) {
          // Otherwise, only process if the storage handoff matches this tab's URL ID
          targetClaim = handoff.claim;
          targetReq = handoff.req;
        }

        if (!targetClaim) return;

        // 2. Global "latest wins" check
        // If there's an active ownerReq in storage that is NEWER/DIFFERENT than our current targetReq,
        // we might be an old tab that should stop. 
        // Note: We allow VBS hardcoded IDs to bypass this if they are the current tab.
        if (ownerReq && ownerReq !== targetReq && !urlClaim) {
          LOG.warn("Handoff mismatch, stopping. ownerReq:", ownerReq, "targetReq:", targetReq);
          return;
        }

        const alreadyDone = (lastReq === targetReq && lastClaim === targetClaim);
        const fromUrl = !!urlClaim;
        LOG.info("Already done check:", alreadyDone, "kick check:", kick === lastSeenKick, "fromUrl:", fromUrl, "lastReq:", lastReq, "targetReq:", targetReq, "lastClaim:", lastClaim, "targetClaim:", targetClaim);

        // URL-based claims (VBS): only allow if we haven't already processed this exact URL
        if (fromUrl) {
          const urlKey = urlReq + "|" + targetClaim;
          if (processedUrlKey === urlKey) {
            LOG.info("Already processed this URL claim (" + targetClaim + "), skipping.");
            return;
          }
          LOG.info("Claim from URL detected, proceeding with automation.");
          if (lastFailedClaim !== targetClaim) {
            failureCount = 0;
            lastFailedClaim = "";
          }
        } else if (alreadyDone && kick === lastSeenKick) {
          LOG.info("Already processed this claim, skipping.");
          return;
        }
        
        // If we've failed too many times on this claim, don't keep trying
        if (failureCount >= 3 && lastFailedClaim === targetClaim) {
          LOG.warn("Skipping - too many failures for this claim:", targetClaim);
          return;
        }

        lastSeenKick = kick;
        urlBasedRun = fromUrl;
        const req = targetReq;
        const claim = targetClaim;

        // Load runMode each run (cached + cheap). Default: full
        const runMode = await loadRunMode(); // full | claim_only | copy_only
        LOG.info("RunMode:", runMode, "Claim:", claim);

        // copy_only: stop early (we'll implement actual clipboard copy later)
        // copy_only: copy claim number to clipboard, then stop (no navigation)
        // copy_only: just log, don't attempt to copy again (portal did it) and don't navigate
        if (runMode === "copy_only") {
          await setSuccessState(req, claim);
          automationDisabled = true;
          processedUrlKey = urlReq + "|" + claim;
          LOG.info("✅ SUCCESS (copy_only - no nav)", claim);
          return;
        }

        LOG.info("Proceeding with automation...");

        // Skip initial delay if fast path already tried (URL-based claims)
        if (!fromUrl) {
          LOG.info("Waiting for page to stabilize...");
          await sleep(2000); // Give extra time for page to load
        }

        LOG.info("Checking hasGuidewireUi...");
        if (!hasGuidewireUi()) {
          LOG.warn("Guidewire UI not detected, sleeping and retrying...");
          await sleep(500);
          continue;
        }
        LOG.info("Guidewire UI detected, proceeding to ensureOnSimpleSearch...");

        const input = await ensureOnSimpleSearch();
        if (!input) {
          LOG.warn("Failed to ensure on simple search, sleeping and retrying...");
          await sleep(650);
          continue;
        }
        LOG.info("On simple search screen, proceeding...");

        if (!(await stillOwner(req))) return;
        await waitForNotLoading(9000);

        LOG.info("Attempting to set claim value:", claim);
        if (!(await setAndLatchClaimValue(claim, { latchMs: 1250, req }))) { 
          LOG.warn("Failed to set claim value, retrying...");
          await sleep(420); 
          continue; 
        }
        if (!(await stillOwner(req))) return;

        LOG.info("Submitting search for claim:", claim);
        if (!(await submitSearchReliable(claim, req))) {
          LOG.warn("Search failed after retries.");
          failureCount++;
          lastFailedClaim = claim;
          // If we've failed 3+ times on the same claim, stop trying
          if (failureCount >= 3) {
            LOG.err("Too many failures for claim:", claim, "- stopping automation for this claim.");
            await setSuccessState(req, claim);
            automationDisabled = true;
            processedUrlKey = urlReq + "|" + claim;
            return;
          }
          await sleep(1000);
          continue;
        }

        // Reset failure count on success
        if (lastFailedClaim !== claim) {
          failureCount = 0;
          lastFailedClaim = "";
        }

        await setAndLatchClaimValue(claim, { latchMs: 720, req });
        if (!(await stillOwner(req))) return;

        LOG.info("Waiting for search results (row0)...");
        const row0 = await waitSel(ROW0, WAIT_ROW0_MS, { mustBeVisible: true });
        if (!row0) { 
          LOG.warn("Row0 not found, retrying...");
          await sleep(650); 
          continue; 
        }
        LOG.info("Row0 found, search successful!");

        // claim_only: stop after results row is present (search completed)
        if (runMode === "claim_only") {
          failureCount = 0;
          lastFailedClaim = "";
          await setSuccessState(req, claim);
          automationDisabled = true;
          processedUrlKey = urlReq + "|" + claim;
          LOG.info("✅ SUCCESS (claim_only)", claim);
          return;
        }

        // full: continue existing behavior
        if (!(await openClaimFromRow0_Fast(req))) { await sleep(650); continue; }
        if (!(await stillOwner(req))) return;

        if (!(await clickLossDetailsReliable(req))) { await sleep(750); continue; }

        const ok = isOnLossDetails() || !!(await waitAny(LOSS_DETAILS_SCREENS, WAIT_LOSS_SCREEN_MS));
        if (!ok) { await sleep(800); continue; }

        failureCount = 0;
        lastFailedClaim = "";
        await setSuccessState(req, claim);
        automationDisabled = true;
        processedUrlKey = urlReq + "|" + claim;
        LOG.info("✅ SUCCESS (full)", claim);
        return;
      }
    } catch (e) {
      LOG.err("CRASH:", e);
      if (isContextDead(e)) contextAlive = false;
      if (contextAlive) schedule(1000);
    } finally {
      running = false;
      urlBasedRun = false;
      if (hasPendingRun && contextAlive) schedule(100);
    }
  }

  // --- FAST PATH: Direct execution for URL-based claims (like scripts version) ---
  async function fastPathForUrlClaim() {
    const urlParams = new URLSearchParams(location.search);
    const targetClaim = urlParams.get("TargetClaim") || urlParams.get("claimNumber") || "";
    const targetPage = urlParams.get("TargetPage") || "";
    
    if (!targetClaim) return false; // Not a URL-based claim
    
    LOG.info("🚀 FAST PATH: Starting direct execution (no delays, no polling)");
    
    // Simple navigation to search screen (exactly like scripts version)
    async function goToSearchScreen() {
      const SSS_SEARCH_CLAIMS_TITLEBAR = "#SimpleClaimSearch-SimpleClaimSearchScreen-ttlBar";
      let el = document.querySelector(SSS_SEARCH_CLAIMS_TITLEBAR);
      if (!el) {
        const SSS_SEARCH_TAB_BTN = "#TabBar-SearchTab div";
        let search_tab_btn = await waitForElm(SSS_SEARCH_TAB_BTN, 0); // No timeout - wait indefinitely like scripts
        if (search_tab_btn) await robustClick(search_tab_btn, "SearchTab");
      }
    }
    
    try {
      // Navigate to search screen
      await goToSearchScreen();
      
      // Enter claim number (exactly like scripts version)
      const SSS_CLAIM_INPUT = 'input[name="SimpleClaimSearch-SimpleClaimSearchScreen-SimpleClaimSearchDV-ClaimNumber"]';
      const claim_input = await waitForElm(SSS_CLAIM_INPUT, 0); // No timeout - wait indefinitely
      if (!claim_input) {
        LOG.warn("Fast path: Could not find claim input");
        return false;
      }
      
      await robustClick(claim_input, "ClaimInput");
      insertText(targetClaim);
      
      // Click search button (exactly like scripts version)
      const SSS_CLAIM_SEARCH_BTN = "#SimpleClaimSearch-SimpleClaimSearchScreen-SimpleClaimSearchDV-ClaimSearchAndResetInputSet-Search";
      const claim_search_btn = await waitForElm(SSS_CLAIM_SEARCH_BTN, 0); // No timeout
      if (!claim_search_btn) {
        LOG.warn("Fast path: Could not find search button");
        return false;
      }
      
      await robustClick(claim_search_btn, "SearchBtn");
      
      // Wait for search results to appear (wait for results list container first)
      const RESULTS_LV = "#SimpleClaimSearch-SimpleClaimSearchScreen-SimpleClaimSearchResultsLV";
      const resultsList = await waitForElm(RESULTS_LV, 0); // Wait for results list to appear
      if (!resultsList) {
        LOG.warn("Fast path: Results list did not appear");
        return false;
      }
      
      // Wait for ROW0 (first result) to appear - this is more reliable than waiting for text
      const ROW0 = "#SimpleClaimSearch-SimpleClaimSearchScreen-SimpleClaimSearchResultsLV-0-ClaimNumber_button";
      const row0El = await waitForElm(ROW0, 0); // Wait for first result button to appear
      if (!row0El) {
        LOG.warn("Fast path: Row0 (first result) did not appear");
        return false;
      }
      
      // Verify the claim number matches (optional check, but helpful)
      const row0Text = row0El.textContent || "";
      if (row0Text.includes(targetClaim)) {
        LOG.info("Fast path: Found matching claim in row0, clicking...");
      } else {
        LOG.info("Fast path: Row0 found but claim number doesn't match, clicking anyway...");
      }
      
      await robustClick(row0El, "ResultClaim");
      
      // Navigate to target page if specified (exactly like scripts version)
      if (targetPage) {
        const CS_MENU_LINKS = "#Claim-MenuLinks";
        let menu_links_container = await waitForElm(CS_MENU_LINKS, 0); // No timeout
        if (menu_links_container) {
          for (const el of menu_links_container.children) {
            let label_text = el.querySelector("div.gw-label")?.innerText.trim();
            if (label_text === targetPage) {
              await robustClick(el.children[0], "MenuLink:" + targetPage);
              break;
            }
          }
        }
      }
      
      // Reset URL (exactly like scripts version)
      history.pushState({}, "", window.location.origin + window.location.pathname);
      LOG.info("✅ FAST PATH SUCCESS:", targetClaim);
      return true;
    } catch (e) {
      LOG.err("Fast path error:", e);
      return false;
    }
  }

  // --- Triggers ---
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg?.type === "PING_TM") {
        sendResponse({ ok: true, process: shouldProcessThisTab(), ui: hasGuidewireUi() });
        return;
      }
      if (msg?.type === "RUN_NOW" && shouldProcessThisTab()) {
        schedule(0);
      }
    });
  } catch (e) {
    LOG.err("chrome.runtime.onMessage.addListener error:", e);
  }

  if (!shouldProcessThisTab()) return;

  // Check for URL-based claim FIRST and disable slow path immediately
  const urlParams = new URLSearchParams(location.search);
  const hasUrlClaim = !!(urlParams.get("TargetClaim") || urlParams.get("claimNumber"));
  
  if (hasUrlClaim) {
    // Immediately disable slow path to prevent race condition
    const targetClaim = urlParams.get("TargetClaim") || urlParams.get("claimNumber") || "";
    const urlReq = birthReq();
    processedUrlKey = urlReq + "|" + targetClaim;
    automationDisabled = true; // Disable slow path immediately
    
    LOG.info("🚀 URL-based claim detected, disabling slow path, running fast path only");
    
    // Run fast path immediately (like scripts version - no delays, no polling)
    fastPathForUrlClaim().then((success) => {
      if (success) {
        LOG.info("✅ FAST PATH SUCCESS - completed without slow path interference");
      } else {
        LOG.warn("Fast path failed, but slow path is disabled. Re-enabling slow path for retry.");
        // Re-enable slow path only if fast path completely failed
        automationDisabled = false;
        processedUrlKey = "";
        schedule(1000); // Give it a moment then try slow path
      }
    });
  } else {
    // No URL claim, use normal slow path
    LOG.info("No URL claim detected, using normal slow path");
  }

  // Ask background to close duplicate CC process tabs (handles VBS opening new tabs each time)
  try {
    chrome.runtime.sendMessage({ type: "CLAIM_PROCESS_TAB" }, () => {
      void chrome.runtime.lastError; // Suppress error if background not ready yet
    });
  } catch {}

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (!contextAlive) return;
      if (area === "local" && (changes.ownerReq || changes.kick || changes.handoff)) schedule(0);
    });
  } catch (e) {
    LOG.err("chrome.storage.onChanged.addListener (local) error:", e);
  }

  // Polling interval - but only if not already running and not disabled
  // Reduced frequency for URL-based claims (they use fast path)
  setInterval(() => {
    if (!running && !automationDisabled && contextAlive) {
      // Check if we have a URL claim - if so, use longer interval (fast path handles it)
      const urlParams = new URLSearchParams(location.search);
      const hasUrlClaim = !!(urlParams.get("TargetClaim") || urlParams.get("claimNumber"));
      schedule(hasUrlClaim ? 5000 : 2000); // Less frequent polling for URL claims
    }
  }, 2000);

  // init settings cache once
  // Only schedule slow path if we don't have a URL claim (fast path handles those)
  const urlParamsCheck = new URLSearchParams(location.search);
  const hasUrlClaimCheck = !!(urlParamsCheck.get("TargetClaim") || urlParamsCheck.get("claimNumber"));
  if (!hasUrlClaimCheck) {
    loadRunMode().finally(() => schedule(500));
  } else {
    loadRunMode(); // Just cache it, don't start slow path
  }
})();

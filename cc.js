// cc.js
// FULL FIX: carry x/t3/t5/openCUW134 from ClaimCenter URL -> navigate to Loss Details -> scrape driver -> open CUW134 (HTTP) with x/t3/t4/t5
// Notes:
// - Requires VBA to open ClaimCenter with &x=...&t3=...&t5=...&openCUW134=1
// - Keeps SharePoint/FormServer base as HTTP (per your requirement)
// - Uses a robust “wait for driver cell” gate instead of relying on ClaimLossDetails container IDs

"use strict";

// ============================================================
// CONFIG
// ============================================================

// CUW134 Form URL base (HTTP per requirement)
const CUW134_URL_BASE =
  "http://erieshare/sites/formsmgmt/CommlForms/_layouts/15/FormServer.aspx";

// Target page key (from VBA)
const TARGET_PAGE_LOSS_DETAILS = "loss_details";

// ============================================================
// CUW134 URL builder
// ============================================================
function buildCUW134Url(driverName, pubc6, puurText41, dolDate) {
  const url = new URL(CUW134_URL_BASE);
  url.searchParams.set(
    "XsnLocation",
    "/sites/formsmgmt/CommlForms/CUW134/forms/template.xsn%3Fopenin=browser"
  );

  if (pubc6) url.searchParams.set("x", pubc6);
  if (driverName) url.searchParams.set("t4", driverName);
  if (puurText41) url.searchParams.set("t3", puurText41);
  if (dolDate) url.searchParams.set("t5", dolDate);

  return url.toString();
}

// ============================================================
// Loss Details scraping
// ============================================================
function getDriverNameFromLossDetails() {
  // Primary selector (Vehicle Incidents LV Driver cell)
  const driverEl = document.querySelector(
    '[id*="EditableVehicleIncidentsLV"][id*="-Driver"]'
  );
  if (driverEl) {
    const name = driverEl.textContent?.trim();
    if (name) {
      console.log("[cc.js] CUW134 - Found driver name:", name);
      return name;
    }
  }

  // Fallback selectors
  const selectors = [
    'div[id*="Driver"][class*="TextValueWidget"]',
    'div[id*="Driver"] .gw-value-readonly-wrapper',
    '[id*="Driver"] .gw-vw--value',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const name = el.textContent?.trim();
      if (name) {
        console.log("[cc.js] CUW134 - Found driver name (fallback):", name);
        return name;
      }
    }
  }

  return null;
}

function getLossPartyFromLossDetails() {
  const lossPartyEl = document.querySelector(
    '[id*="EditableVehicleIncidentsLV"][id*="-LossParty"]'
  );
  if (lossPartyEl) {
    const lossParty = lossPartyEl.textContent?.trim();
    console.log("[cc.js] CUW134 - Found Loss Party:", lossParty);
    return lossParty;
  }
  return null;
}

// ============================================================
// Param handling (x/t3/t5 + openCUW134) from ClaimCenter URL
// ============================================================
function getCUW134ParamsFromUrl() {
  const p = new URLSearchParams(window.location.search);
  return {
    pubc6: p.get("x") || null,
    t3: p.get("t3") || null,
    t5: p.get("t5") || null,
    open: (p.get("openCUW134") || "").toLowerCase() === "1",
  };
}

function stashCUW134Params() {
  const params = getCUW134ParamsFromUrl();
  globalThis._cuw134Params = params;
  return params;
}

function getStashedOrUrlParams() {
  return globalThis._cuw134Params || getCUW134ParamsFromUrl();
}

// ============================================================
// CUW134 open (same tab)
// ============================================================
async function openCUW134Form() {
  console.log("[cc.js] CUW134 - Attempting to open CUW134...");

  const driverName = getDriverNameFromLossDetails();
  const lossParty = getLossPartyFromLossDetails();

  // You can enhance this later if you need insured vs driver based on lossParty
  const insuredName = driverName;

  if (!insuredName) {
    console.warn("[cc.js] CUW134 - Could not find driver name in Loss Details.");
    alert(
      "Could not find driver name in Loss Details. Please ensure you are on the Loss Details page."
    );
    return false;
  }

  const { pubc6, t3, t5 } = getStashedOrUrlParams();

  console.log("[cc.js] CUW134 - Using params:", { pubc6, t3, t5, lossParty });

  const url = buildCUW134Url(insuredName, pubc6, t3, t5);
  console.log("[cc.js] CUW134 - Opening URL:", url);

  // Open in SAME tab
  window.location.href = url;
  return true;
}

// ============================================================
// Generic helpers
// ============================================================
async function robustClick(el) {
  if (!el) return;
  await waitUntilClickable();
  const rect = el.getBoundingClientRect();
  const cx = Math.floor(rect.left + rect.width / 2);
  const cy = Math.floor(rect.top + rect.height / 2);
  const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };
  el.focus();
  el.dispatchEvent(new PointerEvent("pointerdown", opts));
  el.dispatchEvent(new MouseEvent("mousedown", opts));
  el.dispatchEvent(new PointerEvent("pointerup", opts));
  el.dispatchEvent(new MouseEvent("mouseup", opts));
  el.dispatchEvent(new MouseEvent("click", opts));
  el.click();
}

function waitForElm(selector) {
  return new Promise((resolve) => {
    const now = document.querySelector(selector);
    if (now) return resolve(now);

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

async function waitForText(selector, expectedText, timeoutMs = 10000) {
  const checkNow = () => {
    const el = document.querySelector(selector);
    if (el && (el.textContent || "").includes(expectedText)) return el;
    return null;
  };

  const immediate = checkNow();
  if (immediate) return immediate;

  return new Promise((resolve) => {
    let timeoutId = null;
    const observer = new MutationObserver(() => {
      const match = checkNow();
      if (match) {
        observer.disconnect();
        if (timeoutId) clearTimeout(timeoutId);
        resolve(match);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeoutMs);
    }
  });
}

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

function insertText(str, input = document.activeElement) {
  if (!input) return;
  input.value = String(str || "").trim();
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Robust “wait for a selector” loop with timeout (used for Loss Details readiness)
async function waitForAny(selector, timeoutMs = 25000, pollMs = 300) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const el = document.querySelector(selector);
    if (el) return el;
    await sleep(pollMs);
  }
  return null;
}

// ============================================================
// Settings (runMode)
// ============================================================
const SETTINGS_KEY = "settings_v1";
const DEFAULT_SETTINGS = { runMode: "full" }; // full | claim_only | copy_only

async function getRunMode() {
  try {
    const data = await chrome.storage.sync.get(SETTINGS_KEY);
    return data?.[SETTINGS_KEY]?.runMode || DEFAULT_SETTINGS.runMode;
  } catch {
    return DEFAULT_SETTINGS.runMode;
  }
}

// ============================================================
// Navigation helpers
// ============================================================
async function goToSearchScreen() {
  const SSS_SEARCH_CLAIMS_TITLEBAR =
    "#SimpleClaimSearch-SimpleClaimSearchScreen-ttlBar";

  const el = document.querySelector(SSS_SEARCH_CLAIMS_TITLEBAR);
  if (el) return;

  const SSS_SEARCH_TAB_BTN = "#TabBar-SearchTab div";
  const search_tab_btn =
    document.querySelector(SSS_SEARCH_TAB_BTN) ||
    (await waitForElm(SSS_SEARCH_TAB_BTN));
  await robustClick(search_tab_btn);
}

function normalizeLabel(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
}

// ============================================================
// DEBUG: Log current URL and page state
// ============================================================
function debugLogPageState() {
  const url = window.location.href;
  const pathname = window.location.pathname;
  const search = window.location.search;

  console.log("=== [cc.js] DEBUG: Page State ===");
  console.log("Full URL:", url);
  console.log("Pathname:", pathname);
  console.log("Search params:", search);
  console.log("Stashed CUW134 params:", globalThis._cuw134Params || null);
  console.log("=============================");

  try {
    const cookies = document.cookie;
    console.log(
      "[cc.js] DEBUG: Cookies present:",
      cookies.length > 0 ? "YES" : "NO"
    );
  } catch (e) {
    console.log("[cc.js] DEBUG: Could not read cookies:", e.message);
  }

  console.log("[cc.js] DEBUG: document.readyState:", document.readyState);
  console.log("[cc.js] DEBUG: document.title:", document.title);

  if (document.body) {
    console.log(
      "[cc.js] DEBUG: body.innerText (first 200 chars):",
      (document.body.innerText || "").substring(0, 200)
    );
  }
  console.log("=================================");
}

// ============================================================
// Session checks (kept from your version)
// ============================================================
function isSessionInvalid() {
  const url = window.location.href.toLowerCase();
  const pathname = window.location.pathname.toLowerCase();

  console.log("[cc.js] DEBUG: Checking session validity...");
  console.log("[cc.js] DEBUG: Current URL:", window.location.href);

  if (
    url.includes("login") ||
    url.includes("auth") ||
    url.includes("signin") ||
    url.includes("/login.")
  ) {
    console.log("[cc.js] DEBUG: Session INVALID - URL contains login/auth");
    return true;
  }

  if (
    pathname.includes("session") ||
    pathname.includes("expired") ||
    pathname.endsWith("/login")
  ) {
    console.log("[cc.js] DEBUG: Session INVALID - pathname indicates session issue");
    return true;
  }

  const pageText = (document.body?.innerText || "").toLowerCase();
  const timeoutIndicators = [
    "session expired",
    "your session has expired",
    "please log in again",
    "session timeout",
    "re-login required",
    "authentication required",
    "login to continue",
  ];

  for (const indicator of timeoutIndicators) {
    if (pageText.includes(indicator)) {
      console.log("[cc.js] DEBUG: Session INVALID - Page contains:", indicator);
      return true;
    }
  }

  console.log("[cc.js] DEBUG: Session appears VALID");
  return false;
}

async function waitForValidSession(timeoutMs = 300000) {
  console.log("[cc.js] Session - Waiting for session to become valid...");

  return new Promise((resolve, reject) => {
    let timeoutId = null;
    let observer = null;
    let urlCheckInterval = null;

    const checkValid = () => {
      if (!isSessionInvalid()) {
        console.log("[cc.js] Session - Session is now VALID");
        setTimeout(() => {
          if (timeoutId) clearTimeout(timeoutId);
          if (observer) observer.disconnect();
          if (urlCheckInterval) clearInterval(urlCheckInterval);
          resolve(true);
        }, 1500);
        return true;
      }
      return false;
    };

    if (checkValid()) return;

    timeoutId = setTimeout(() => {
      if (observer) observer.disconnect();
      if (urlCheckInterval) clearInterval(urlCheckInterval);
      reject(new Error("Session timeout - did not become valid within 5 minutes"));
    }, timeoutMs);

    observer = new MutationObserver(() => setTimeout(checkValid, 500));
    try {
      observer.observe(document.body, { childList: true, subtree: true });
    } catch {}

    let lastUrl = window.location.href;
    urlCheckInterval = setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        checkValid();
      }
    }, 1000);
  });
}

async function ensureSession() {
  if (!isSessionInvalid()) return true;
  try {
    await waitForValidSession();
    return true;
  } catch (e) {
    console.error("[cc.js] Session - Failed:", e.message);
    return false;
  }
}

// ============================================================
// MAIN AUTOMATION
// ============================================================
async function runAutomation() {
  // Stash CUW134 params early (before any URL cleanup)
  const cuwParams = stashCUW134Params();

  const PARAMS = new URLSearchParams(window.location.search);

  // Claim number may come in multiple names
  let TARGET_CLAIM = PARAMS.get("TargetClaim") || PARAMS.get("claimNumber");
  if (!TARGET_CLAIM && globalThis._claimFromMessage) TARGET_CLAIM = globalThis._claimFromMessage;
  if (!TARGET_CLAIM) return;

  const runMode = await getRunMode();
  if (runMode === "copy_only") {
    history.pushState({}, "", window.location.origin + window.location.pathname);
    return;
  }

  // Go to search screen
  await goToSearchScreen();

  // Search and open claim
  const SSS_CLAIM_INPUT =
    'input[name="SimpleClaimSearch-SimpleClaimSearchScreen-SimpleClaimSearchDV-ClaimNumber"]';
  const SSS_CLAIM_SEARCH_BTN =
    "#SimpleClaimSearch-SimpleClaimSearchScreen-SimpleClaimSearchDV-ClaimSearchAndResetInputSet-Search";
  const SSS_RESULT_BUTTON =
    "#SimpleClaimSearch-SimpleClaimSearchScreen-SimpleClaimSearchResultsLV-0-ClaimNumber_button";

  const claim_input = await waitForElm(SSS_CLAIM_INPUT);
  await robustClick(claim_input);
  insertText(TARGET_CLAIM);

  const claim_search_btn = await waitForElm(SSS_CLAIM_SEARCH_BTN);
  await robustClick(claim_search_btn);

  if (runMode === "claim_only") {
    history.pushState({}, "", window.location.origin + window.location.pathname);
    return;
  }

  let result_claim_btn = await waitForText(SSS_RESULT_BUTTON, TARGET_CLAIM, 6000);
  if (!result_claim_btn) {
    await robustClick(claim_search_btn);
    result_claim_btn = await waitForText(SSS_RESULT_BUTTON, TARGET_CLAIM, 6000);
  }
  if (!result_claim_btn) result_claim_btn = await waitForElm(SSS_RESULT_BUTTON);
  await robustClick(result_claim_btn);

  // Target page (Loss Details)
  let TARGET_PAGE_RAW = PARAMS.get("TargetPage");
  if (!TARGET_PAGE_RAW && globalThis._targetPageFromMessage) {
    TARGET_PAGE_RAW = globalThis._targetPageFromMessage;
  }
  if (!TARGET_PAGE_RAW) {
    history.pushState({}, "", window.location.origin + window.location.pathname);
    return;
  }

  const desired = normalizeLabel(TARGET_PAGE_RAW);
  const desiredWords = desired.split(" ").filter(Boolean);

  // Open left menu item
  const CS_MENU_LINKS = "#Claim-MenuLinks";
  const menu_links_container = await waitForElm(CS_MENU_LINKS);

  const labels = Array.from(
    menu_links_container.querySelectorAll(
      "div.gw-label, span.gw-label, a.gw-label, li.gw-menu-item, a[role='menuitem'], li a"
    )
  );

  console.log("[cc.js] Debug - TargetPage:", TARGET_PAGE_RAW, "normalized:", desired);

  let clicked = false;

  // Strategy 1: exact
  for (const lbl of labels) {
    const labelText = normalizeLabel(lbl?.innerText);
    if (labelText && labelText === desired) {
      const clickable =
        lbl.closest('a, button, [role="menuitem"]') ||
        lbl.closest("li") ||
        lbl.parentElement;
      if (clickable) {
        await robustClick(clickable);
        clicked = true;
      }
      break;
    }
  }

  // Strategy 2: contains
  if (!clicked) {
    for (const lbl of labels) {
      const labelText = normalizeLabel(lbl?.innerText);
      if (labelText && labelText.includes(desired)) {
        const clickable =
          lbl.closest('a, button, [role="menuitem"]') ||
          lbl.closest("li") ||
          lbl.parentElement;
        if (clickable) {
          await robustClick(clickable);
          clicked = true;
        }
        break;
      }
    }
  }

  // Strategy 3: all words
  if (!clicked) {
    for (const lbl of labels) {
      const labelText = normalizeLabel(lbl?.innerText);
      if (!labelText) continue;

      const allWordsFound =
        desiredWords.length > 0 && desiredWords.every((w) => labelText.includes(w));

      if (allWordsFound) {
        const clickable =
          lbl.closest('a, button, [role="menuitem"]') ||
          lbl.closest("li") ||
          lbl.parentElement;
        if (clickable) {
          await robustClick(clickable);
          clicked = true;
        }
        break;
      }
    }
  }

  // Strategy 4: fuzzy significant word
  if (!clicked) {
    const significantWords = desiredWords.filter(
      (w) => w.length > 3 && !["and", "the", "for", "with"].includes(w)
    );
    for (const lbl of labels) {
      const labelText = normalizeLabel(lbl?.innerText);
      if (!labelText) continue;

      const anyFound = significantWords.some((w) => labelText.includes(w));
      if (anyFound) {
        const clickable =
          lbl.closest('a, button, [role="menuitem"]') ||
          lbl.closest("li") ||
          lbl.parentElement;
        if (clickable) {
          await robustClick(clickable);
          clicked = true;
        }
        break;
      }
    }
  }

  if (!clicked) {
    console.warn("[cc.js] TargetPage not found:", TARGET_PAGE_RAW);
    history.pushState({}, "", window.location.origin + window.location.pathname);
    return;
  }

  // ============================================================
  // KEY FIX: if openCUW134=1, wait for Loss Details driver cell then open CUW134
  // ============================================================
  const shouldOpen = !!cuwParams.open;
  const isLossDetails = normalizeLabel(TARGET_PAGE_RAW) === TARGET_PAGE_LOSS_DETAILS;

  if (shouldOpen && isLossDetails) {
    console.log("[cc.js] CUW134 - openCUW134=1 detected. Waiting for Driver cell...");

    const driverCell = await waitForAny(
      '[id*="EditableVehicleIncidentsLV"][id*="-Driver"]',
      30000
    );

    if (!driverCell) {
      console.warn("[cc.js] CUW134 - Driver cell not found after navigation. Aborting.");
      return;
    }

    // Give UI a beat to populate text
    await sleep(800);

    await openCUW134Form();
    return;
  }

  // Clean URL (only if we didn't redirect away)
  history.pushState({}, "", window.location.origin + window.location.pathname);
}

// ============================================================
// Runner with retries
// ============================================================
async function runAutomationWithSessionHandling() {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 3000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[cc.js] Attempt ${attempt}/${MAX_RETRIES}`);
      debugLogPageState();

      const ok = await ensureSession();
      if (!ok) throw new Error("Session validation failed");

      await runAutomation();
      console.log("[cc.js] Automation completed.");
      return true;
    } catch (e) {
      console.warn(`[cc.js] Attempt ${attempt} failed:`, e.message);

      const retryable =
        /session|login|auth|timeout|Cannot read properties|Failed to find/i.test(
          String(e.message || "")
        );

      if (retryable && attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      return false;
    }
  }
  return false;
}

// ============================================================
// IIFE entry point
// ============================================================
(async () => {
  const PARAMS = new URLSearchParams(window.location.search);
  const TARGET_CLAIM = PARAMS.get("TargetClaim") || PARAMS.get("claimNumber");

  if (!TARGET_CLAIM) return;

  console.log("[cc.js] Loaded for claim:", TARGET_CLAIM);

  // Stash params ASAP so even if URL gets cleaned later we keep x/t3/t5/open
  stashCUW134Params();

  await runAutomationWithSessionHandling();
})();

// ============================================================
// Message listener (RUN_NOW / OPEN_CUW134)
// ============================================================
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "PING_TM") {
      sendResponse({ ok: true, process: true });
      return true;
    }

    if (msg?.type === "RUN_NOW") {
      console.log("[cc.js] RUN_NOW received.");

      if (msg.claim) globalThis._claimFromMessage = msg.claim;
      if (msg.targetPage) globalThis._targetPageFromMessage = msg.targetPage;

      // Allow service worker to pass CUW params too (optional)
      if (msg.x || msg.t3 || msg.t5 || msg.openCUW134) {
        globalThis._cuw134Params = {
          pubc6: msg.x || null,
          t3: msg.t3 || null,
          t5: msg.t5 || null,
          open: String(msg.openCUW134 || "0") === "1",
        };
      } else {
        stashCUW134Params();
      }

      runAutomationWithSessionHandling()
        .then((result) => sendResponse({ ok: true, result }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));

      return true;
    }

    if (msg?.type === "OPEN_CUW134") {
      console.log("[cc.js] OPEN_CUW134 received.");
      openCUW134Form()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    return false;
  });
} catch (e) {
  console.warn("[cc.js] Message listener setup failed:", e);
}
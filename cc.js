// cc.js
// FULL FIX (hardened):
// - Carries x/t3/t5/openCUW134 from ClaimCenter URL (and/or message) across SPA nav using sessionStorage
// - Navigates to Loss Details
// - Waits for Driver value to be present (robust gate)
// - Scrapes Driver and opens CUW134 (HTTP) with x/t3/t4/t5
// - Avoids "runs only after reload" issues by:
//   * not relying solely on initial IIFE params existing at document_idle
//   * supporting RUN_NOW message as primary trigger
//   * stashing params immediately and persistently
// - Keeps SharePoint/FormServer base as HTTP (per requirement)

"use strict";

// ============================================================
// CONFIG
// ============================================================

// CUW134 Form URL base (HTTP per requirement)
const CUW134_URL_BASE =
  "http://erieshare/sites/formsmgmt/CommlForms/_layouts/15/FormServer.aspx";

// Target page key (from VBA) - normalizeLabel converts "_" to " ", so use space
const TARGET_PAGE_LOSS_DETAILS = "loss details";

// Session storage keys (survive SPA nav within the tab)
const SS_KEY_CUW_PARAMS = "cuw134Params_v1";
const SS_KEY_LAST_OPEN = "cuw134LastOpen_v1"; // debounce so it doesn't re-open in loops

// ============================================================
// CUW134 URL builder
// ============================================================
function buildCUW134Url(driverName, pubc6, puurText41, dolDate) {
  // Build manually to avoid double-encoding %3F in XsnLocation chain
  let finalUrl =
    CUW134_URL_BASE +
    "?XsnLocation=" +
    encodeURIComponent("/sites/formsmgmt/CommlForms/CUW134/forms/template.xsn") +
    "%3Fopenin=browser";

  if (pubc6) finalUrl += "&x=" + encodeURIComponent(pubc6);
  if (driverName) finalUrl += "&t4=" + encodeURIComponent(driverName);
  if (puurText41) finalUrl += "&t3=" + encodeURIComponent(puurText41);
  if (dolDate) finalUrl += "&t5=" + encodeURIComponent(dolDate);

  return finalUrl;
}

// ============================================================
// Param handling (x/t3/t5 + openCUW134) from ClaimCenter URL / messages
// Persisted in sessionStorage to survive SPA navigation.
// ============================================================
function getCUW134ParamsFromUrl() {
  const p = new URLSearchParams(window.location.search);
  return {
    pubc6: p.get("x") || null,
    t3: p.get("t3") || null,
    t5: p.get("t5") || null,
    open: String(p.get("openCUW134") || "").toLowerCase() === "1",
  };
}

function readCUW134ParamsFromSession() {
  try {
    const raw = sessionStorage.getItem(SS_KEY_CUW_PARAMS);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    return {
      pubc6: obj.pubc6 || null,
      t3: obj.t3 || null,
      t5: obj.t5 || null,
      open: !!obj.open,
    };
  } catch {
    return null;
  }
}

function writeCUW134ParamsToSession(params) {
  try {
    sessionStorage.setItem(SS_KEY_CUW_PARAMS, JSON.stringify(params || {}));
  } catch {}
}

function stashCUW134Params(prefer = null) {
  // prefer: optional object from message payload, else URL, else session (merge)
  const fromUrl = getCUW134ParamsFromUrl();
  const fromSession = readCUW134ParamsFromSession() || {
    pubc6: null,
    t3: null,
    t5: null,
    open: false,
  };

  const merged = {
  pubc6:
    (prefer && prefer.pubc6) ||
    fromUrl.pubc6 ||
    fromSession.pubc6 ||
    null,

  t3:
    (prefer && prefer.t3) ||
    fromUrl.t3 ||
    fromSession.t3 ||
    null,

  t5:
    (prefer && prefer.t5) ||
    fromUrl.t5 ||
    fromSession.t5 ||
    null,

  open:
    typeof prefer?.open === "boolean"
      ? prefer.open
      : fromUrl.open ?? fromSession.open ?? false,
};

  // Keep also in memory for quick access
  globalThis._cuw134Params = merged;

  // Persist
  writeCUW134ParamsToSession(merged);

  return merged;
}

function getStashedOrUrlParams() {
  return (
    globalThis._cuw134Params ||
    readCUW134ParamsFromSession() ||
    getCUW134ParamsFromUrl()
  );
}

// ============================================================
// Loss Details scraping (robust)
// ============================================================
function pickNameFromText(text) {
  const name = String(text || "").trim();
  if (!name) return null;
  if (name.length < 2 || name.length > 80) return null;

  // Exclude labels
  const low = name.toLowerCase();
  if (low.includes("driver") || low.includes("claim") || low.includes("loss")) {
    // not perfect, but prevents obvious misreads
    if (name.includes(":")) return null;
  }

  return name;
}

function getDriverNameFromLossDetails() {
  console.log("[cc.js] CUW134 - Looking for driver name...");

  try {
    // Find the row containing "Insured's loss"
    const rows = document.querySelectorAll("#ClaimLossDetails-ClaimLossDetailsScreen-LossDetailsPanelSet-LossDetailsCardCV-LossDetailsDV-EditableVehicleIncidentsLV tbody tr");
    
    let targetRow = null;
    for (const row of rows) {
      if (row.innerText.includes("Insured's loss")) {
        targetRow = row;
        break;
      }
    }
    
    if (!targetRow) {
      console.log("[cc.js] CUW134 - Could not find Insured's loss row");
      return null;
    }
    
    // Find the Driver field within this specific row
    const driverEl = targetRow.querySelector('[id*="-Driver"] .gw-value-readonly-wrapper, [id*="-Driver"] .gw-vw--value');
    if (driverEl) {
      const driverName = driverEl.innerText.trim();
      console.log("[cc.js] CUW134 - Found Insured's loss driver:", driverName);
      const candidate = pickNameFromText(driverName);
      if (candidate) return candidate;
    }
  } catch (e) {
    console.log("[cc.js] CUW134 - Error finding driver:", e.message);
  }

  console.log("[cc.js] CUW134 - Could not find driver name");
  return null;
}

function getLossPartyFromLossDetails() {
  try {
    const rows = document.querySelectorAll("#ClaimLossDetails-ClaimLossDetailsScreen-LossDetailsPanelSet-LossDetailsCardCV-LossDetailsDV-EditableVehicleIncidentsLV tbody tr");
    
    for (const row of rows) {
      if (row.innerText.includes("Insured's loss")) {
        // Get the LossParty text from this row
        const lossPartyEl = row.querySelector('[id*="-LossParty"]');
        if (lossPartyEl) {
          const lossParty = lossPartyEl.innerText.trim();
          console.log("[cc.js] CUW134 - Found Loss Party:", lossParty);
          return lossParty;
        }
      }
    }
  } catch (e) {
    console.log("[cc.js] CUW134 - Error finding loss party:", e.message);
  }
  
  return null;
}

// ============================================================
// CUW134 open (same tab)
// ============================================================
function debounceOpenKey(params, driverName) {
  // Prevent loops: store a short-lived signature
  try {
    const sig = JSON.stringify({
      href: location.href,
      pubc6: params?.pubc6 || null,
      t3: params?.t3 || null,
      t5: params?.t5 || null,
      driver: driverName || null,
    });
    const last = sessionStorage.getItem(SS_KEY_LAST_OPEN);
    if (last && last === sig) return false;
    sessionStorage.setItem(SS_KEY_LAST_OPEN, sig);
  } catch {}
  return true;
}

async function openCUW134Form() {
  console.log("[cc.js] CUW134 - Attempting to open CUW134...");

  const driverName = getDriverNameFromLossDetails();
  const lossParty = getLossPartyFromLossDetails();

  // You can enhance logic later (insured vs driver based on lossParty)
  const insuredName = driverName;

  if (!insuredName) {
    console.warn("[cc.js] CUW134 - Could not find driver name in Loss Details.");
    alert(
      "Could not find driver name in Loss Details. Ensure you are on Loss Details and the Vehicle Incident row is expanded/visible."
    );
    return false;
  }

  const { pubc6, t3, t5 } = getStashedOrUrlParams();
  const params = { pubc6, t3, t5 };

  console.log("[cc.js] CUW134 - Using params:", { ...params, lossParty });

  if (!debounceOpenKey(params, insuredName)) {
    console.log("[cc.js] CUW134 - Debounced (already opened with same signature).");
    return false;
  }

  const url = buildCUW134Url(insuredName, pubc6, t3, t5);
  console.log("[cc.js] CUW134 - Opening URL:", url);

  window.location.href = url;
  return true;
}

// ============================================================
// Generic helpers
// ============================================================
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntilClickable() {
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

async function robustClick(el) {
  if (!el) return;
  await waitUntilClickable();

  const rect = el.getBoundingClientRect();
  const cx = Math.floor(rect.left + rect.width / 2);
  const cy = Math.floor(rect.top + rect.height / 2);
  const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };

  try {
    el.focus();
  } catch {}

  try {
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
  } catch {}

  try {
    el.click();
  } catch {}
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

// Robust "wait for a selector" loop with timeout (used for Loss Details readiness)
async function waitForAny(selector, timeoutMs = 25000, pollMs = 250) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const el = document.querySelector(selector);
    if (el) return el;
    await sleep(pollMs);
  }
  return null;
}

function insertText(str, input = document.activeElement) {
  if (!input) return;
  input.value = String(str || "").trim();
  input.dispatchEvent(new Event("input", { bubbles: true }));
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
  console.log("=== [cc.js] DEBUG: Page State ===");
  console.log("Full URL:", window.location.href);
  console.log("Pathname:", window.location.pathname);
  console.log("Search params:", window.location.search);

  console.log("In-memory CUW134 params:", globalThis._cuw134Params || null);
  console.log("Session CUW134 params:", readCUW134ParamsFromSession() || null);

  console.log("[cc.js] document.readyState:", document.readyState);
  console.log("[cc.js] document.title:", document.title);
  console.log("=================================");
}

// ============================================================
// Session checks (kept from your version, minor hardening)
// ============================================================
function isSessionInvalid() {
  const url = window.location.href.toLowerCase();
  const pathname = window.location.pathname.toLowerCase();

  if (
    url.includes("login") ||
    url.includes("auth") ||
    url.includes("signin") ||
    url.includes("/login.")
  ) {
    return true;
  }

  if (
    pathname.includes("session") ||
    pathname.includes("expired") ||
    pathname.endsWith("/login")
  ) {
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

  return timeoutIndicators.some((indicator) => pageText.includes(indicator));
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
        }, 1200);
        return true;
      }
      return false;
    };

    if (checkValid()) return;

    timeoutId = setTimeout(() => {
      if (observer) observer.disconnect();
      if (urlCheckInterval) clearInterval(urlCheckInterval);
      reject(
        new Error("Session timeout - did not become valid within 5 minutes")
      );
    }, timeoutMs);

    observer = new MutationObserver(() => setTimeout(checkValid, 400));
    try {
      observer.observe(document.body, { childList: true, subtree: true });
    } catch {}

    let lastUrl = window.location.href;
    urlCheckInterval = setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        checkValid();
      }
    }, 800);
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
async function runAutomation(input = {}) {
  // Always stash params early; prefer message payload if present
  stashCUW134Params(input?.cuwParams || null);

  const PARAMS = new URLSearchParams(window.location.search);

  // Claim number may come in multiple names
  let TARGET_CLAIM =
    input?.claim ||
    PARAMS.get("TargetClaim") ||
    PARAMS.get("claimNumber") ||
    globalThis._claimFromMessage ||
    null;

  if (!TARGET_CLAIM) {
    console.log("[cc.js] No target claim; skipping.");
    return false;
  }

  const runMode = await getRunMode();
  if (runMode === "copy_only") {
    // Clean URL but keep stashed params in session
    history.pushState({}, "", window.location.origin + window.location.pathname);
    return true;
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
    return true;
  }

  let result_claim_btn = await waitForText(SSS_RESULT_BUTTON, TARGET_CLAIM, 6500);
  if (!result_claim_btn) {
    await robustClick(claim_search_btn);
    result_claim_btn = await waitForText(SSS_RESULT_BUTTON, TARGET_CLAIM, 6500);
  }
  if (!result_claim_btn) result_claim_btn = await waitForElm(SSS_RESULT_BUTTON);
  await robustClick(result_claim_btn);

  // Target page (Loss Details)
  let TARGET_PAGE_RAW =
    input?.targetPage ||
    PARAMS.get("TargetPage") ||
    globalThis._targetPageFromMessage ||
    null;

  if (!TARGET_PAGE_RAW) {
    console.log("[cc.js] No target page; done after opening claim.");
    history.pushState({}, "", window.location.origin + window.location.pathname);
    return true;
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

  const clickLabel = async (lbl) => {
    const clickable =
      lbl.closest('a, button, [role="menuitem"]') ||
      lbl.closest("li") ||
      lbl.parentElement;
    if (clickable) {
      await robustClick(clickable);
      return true;
    }
    return false;
  };

  // Strategy 1: exact match
  for (const lbl of labels) {
    const labelText = normalizeLabel(lbl?.innerText);
    if (labelText && labelText === desired) {
      clicked = await clickLabel(lbl);
      break;
    }
  }

  // Strategy 2: contains desired
  if (!clicked) {
    for (const lbl of labels) {
      const labelText = normalizeLabel(lbl?.innerText);
      if (labelText && labelText.includes(desired)) {
        clicked = await clickLabel(lbl);
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
        clicked = await clickLabel(lbl);
        break;
      }
    }
  }

  // Strategy 4: any significant word
  if (!clicked) {
    const significantWords = desiredWords.filter(
      (w) => w.length > 3 && !["and", "the", "for", "with"].includes(w)
    );
    for (const lbl of labels) {
      const labelText = normalizeLabel(lbl?.innerText);
      if (!labelText) continue;

      const anyFound = significantWords.some((w) => labelText.includes(w));
      if (anyFound) {
        clicked = await clickLabel(lbl);
        break;
      }
    }
  }

  if (!clicked) {
    console.warn("[cc.js] TargetPage not found:", TARGET_PAGE_RAW);
    history.pushState({}, "", window.location.origin + window.location.pathname);
    return false;
  }

  // Wait for page to load after clicking menu item
  await sleep(1200);

  // ============================================================
  // If openCUW134=1 AND we targeted Loss Details, wait for Driver value then open CUW134
  // ============================================================
  const stashed = getStashedOrUrlParams();
  const shouldOpen = !!stashed.open;
  const isLossDetails = normalizeLabel(TARGET_PAGE_RAW) === TARGET_PAGE_LOSS_DETAILS;

  console.log("[cc.js] CUW134 check - shouldOpen:", shouldOpen, "isLossDetails:", isLossDetails);

  if (shouldOpen && isLossDetails) {
    console.log("[cc.js] CUW134 - openCUW134=1 detected. Waiting for Driver value...");

    // Wait for the Insured's loss row to have driver value populated
    const okText = await (async () => {
      const start = Date.now();
      while (Date.now() - start < 15000) {
        // Use same logic as getDriverNameFromLossDetails
        const rows = document.querySelectorAll("#ClaimLossDetails-ClaimLossDetailsScreen-LossDetailsPanelSet-LossDetailsCardCV-LossDetailsDV-EditableVehicleIncidentsLV tbody tr");
        
        for (const row of rows) {
          if (row.innerText.includes("Insured's loss")) {
            const driverEl = row.querySelector('[id*="-Driver"] .gw-value-readonly-wrapper, [id*="-Driver"] .gw-vw--value');
            if (driverEl) {
              const txt = pickNameFromText(driverEl.innerText);
              if (txt) {
                console.log("[cc.js] CUW134 - Driver value populated:", txt);
                return true;
              }
            }
          }
        }
        await sleep(250);
      }
      return false;
    })();

    if (!okText) {
      console.warn("[cc.js] CUW134 - Driver value never populated. Aborting.");
      return false;
    }

    await sleep(300);
    await openCUW134Form();
    return true; // no URL cleanup; we redirected
  }

  // Clean URL (only if we didn't redirect away)
  history.pushState({}, "", window.location.origin + window.location.pathname);
  return true;
}

// ============================================================
// Runner with retries
// ============================================================
async function runAutomationWithSessionHandling(input = {}) {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 2500;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[cc.js] Attempt ${attempt}/${MAX_RETRIES}`);
      debugLogPageState();

      const ok = await ensureSession();
      if (!ok) throw new Error("Session validation failed");

      await runAutomation(input);
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
// Optional IIFE entry point (kept, but not required)
// Runs only if a claim param is present at load time.
// ============================================================
(async () => {
  try {
    // Stash params ASAP so even if URL gets cleaned later we keep x/t3/t5/open
    stashCUW134Params();

    const PARAMS = new URLSearchParams(window.location.search);
    const TARGET_CLAIM = PARAMS.get("TargetClaim") || PARAMS.get("claimNumber");

    if (!TARGET_CLAIM) return;

    console.log("[cc.js] Loaded for claim:", TARGET_CLAIM);
    await runAutomationWithSessionHandling({ claim: TARGET_CLAIM });
  } catch (e) {
    console.warn("[cc.js] IIFE failed:", e?.message || e);
  }
})();

// ============================================================
// Message listener (RUN_NOW / OPEN_CUW134 / PING_TM)
// ============================================================
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "PING_TM") {
      // Helpful for service worker handshake + debugging which frame answered
      sendResponse({
        ok: true,
        href: location.href,
        title: document.title,
        readyState: document.readyState,
      });
      return true;
    }

    if (msg?.type === "RUN_NOW") {
      console.log("[cc.js] RUN_NOW received.");

      if (msg.claim) globalThis._claimFromMessage = msg.claim;
      if (msg.targetPage) globalThis._targetPageFromMessage = msg.targetPage;

      // Allow service worker to pass CUW params too (preferred)
      const cuwParams = {
        pubc6: msg.x || null,
        t3: msg.t3 || null,
        t5: msg.t5 || null,
        open: String(msg.openCUW134 || "0") === "1",
      };

      // Persist them immediately
      stashCUW134Params(cuwParams);

      runAutomationWithSessionHandling({
        claim: msg.claim || null,
        targetPage: msg.targetPage || null,
        cuwParams,
      })
        .then((result) => sendResponse({ ok: true, result }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));

      return true; // async response
    }

    if (msg?.type === "OPEN_CUW134") {
      console.log("[cc.js] OPEN_CUW134 received.");
      // Ensure we have latest stashed params before opening
      stashCUW134Params();

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
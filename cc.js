// cc.js - UPDATED: robust TargetPage matching + DEBUG URL logging
// DEBUG: Added detailed URL and session state logging to diagnose timeout issues

async function robustClick(el) {
  if (!el) return;
  await waitUntilClickable();
  const rect = el.getBoundingClientRect();
  const cx = Math.floor(rect.left + rect.width / 2);
  const cy = Math.floor(rect.top + rect.height / 2);
  const opts = {
    bubbles: true,
    cancelable: true,
    clientX: cx,
    clientY: cy,
  };
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
    if (document.querySelector(selector)) {
      return resolve(document.querySelector(selector));
    }
    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) {
        observer.disconnect();
        resolve(document.querySelector(selector));
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  });
}

async function waitForText(selector, expectedText, timeoutMs = 10000) {
  const checkNow = () => {
    const el = document.querySelector(selector);
    if (el && (el.textContent || "").includes(expectedText)) {
      return el;
    }
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

async function goToSearchScreen() {
  const SSS_SEARCH_CLAIMS_TITLEBAR =
    "#SimpleClaimSearch-SimpleClaimSearchScreen-ttlBar";
  let el = document.querySelector(SSS_SEARCH_CLAIMS_TITLEBAR);
  if (!el) {
    const SSS_SEARCH_TAB_BTN = "#TabBar-SearchTab div";
    let search_tab_btn =
      document.querySelector(SSS_SEARCH_TAB_BTN) ||
      (await waitForElm(SSS_SEARCH_TAB_BTN));
    await robustClick(search_tab_btn);
  }
}

// Normalize strings so URL params like "loss details" or "loss_details"
// match UI labels like "Loss Details".
function normalizeLabel(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
}

// -----------------------
// DEBUG: Log current URL and page state
// -----------------------
function debugLogPageState() {
  const url = window.location.href;
  const pathname = window.location.pathname;
  const search = window.location.search;

  console.log("=== [cc.js] DEBUG: Page State ===");
  console.log("Full URL:", url);
  console.log("Pathname:", pathname);
  console.log("Search params:", search);
  console.log("=============================");

  // Log cookies for this domain
  try {
    const cookies = document.cookie;
    console.log(
      "[cc.js] DEBUG: Cookies present:",
      cookies.length > 0 ? "YES" : "NO"
    );
    if (cookies.length > 0) {
      // Show cookie names (not values) for debugging
      const cookieNames = cookies
        .split(";")
        .map((c) => c.trim().split("=")[0]);
      console.log("[cc.js] DEBUG: Cookie names:", cookieNames.join(", "));
    }
  } catch (e) {
    console.log("[cc.js] DEBUG: Could not read cookies:", e.message);
  }

  // Log document ready state
  console.log("[cc.js] DEBUG: document.readyState:", document.readyState);
  console.log("[cc.js] DEBUG: document.title:", document.title);

  // Log body content info
  if (document.body) {
    console.log(
      "[cc.js] DEBUG: body.childElementCount:",
      document.body.childElementCount
    );
    console.log(
      "[cc.js] DEBUG: body.innerText (first 200 chars):",
      (document.body.innerText || "").substring(0, 200)
    );
  }
  console.log("=================================");
}

// -----------------------
// SESSION CHECK - Check session/cookies instead of login page
// -----------------------

/**
 * Check if the session is valid by examining the page state
 * Returns true if session appears valid, false if session seems invalid/redirected
 */
function isSessionInvalid() {
  const url = window.location.href.toLowerCase();
  const pathname = window.location.pathname.toLowerCase();

  // DEBUG: Log what we're checking
  console.log("[cc.js] DEBUG: Checking session validity...");
  console.log("[cc.js] DEBUG: Current URL:", window.location.href);
  console.log("[cc.js] DEBUG: Current pathname:", pathname);

  // Check 1: URL redirects to login/auth
  if (
    url.includes("login") ||
    url.includes("auth") ||
    url.includes("signin") ||
    url.includes("/login.")
  ) {
    console.log("[cc.js] DEBUG: Session INVALID - URL contains login/auth");
    return true;
  }

  // Check 2: URL has unexpected paths (like /login.do, /session expired, etc)
  if (
    pathname.includes("session") ||
    pathname.includes("expired") ||
    pathname.endsWith("/login")
  ) {
    console.log(
      "[cc.js] DEBUG: Session INVALID - pathname indicates session issue"
    );
    return true;
  }

  // Check 3: Look for common session-timeout indicators in the page
  const pageText = (document.body?.innerText || "").toLowerCase();

  // Common timeout/session expired messages
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

  // Check 4: No claim-related elements found (suggests not on expected page)
  // Wait for Claim menu or search to be present
  const hasClaimMenu =
    document.querySelector("#Claim-MenuLinks") ||
    document.querySelector("[id*='ClaimScreen']");
  const hasSearchScreen =
    document.querySelector("#SimpleClaimSearch-SimpleClaimSearchScreen-ttlBar") ||
    document.querySelector("#TabBar-SearchTab");

  console.log("[cc.js] DEBUG: Has Claim menu:", !!hasClaimMenu);
  console.log("[cc.js] DEBUG: Has Search screen:", !!hasSearchScreen);

  // If we have neither, might be on an unexpected page
  if (!hasClaimMenu && !hasSearchScreen && document.readyState === "complete") {
    // Give it a moment - could be still loading
    console.log(
      "[cc.js] DEBUG: WARNING - No Claim menu or Search screen found"
    );
    // Don't immediately return invalid - could be still loading
  }

  console.log("[cc.js] DEBUG: Session appears VALID");
  return false;
}

/**
 * Wait for session to become valid (wait for redirect after login or page load)
 * Returns a promise that resolves when session is valid
 */
async function waitForValidSession(timeoutMs = 300000) {
  // 5 minute timeout
  console.log(
    "[cc.js] Session - Session may be invalid, waiting for it to become valid..."
  );

  return new Promise((resolve, reject) => {
    let timeoutId = null;
    let observer = null;
    let urlCheckInterval = null;

    const checkValid = () => {
      if (!isSessionInvalid()) {
        console.log(
          "[cc.js] Session - Session is now VALID, proceeding with automation"
        );

        // Give the page a moment to load the content
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

    // Check immediately in case session is already valid
    if (checkValid()) return;

    // Set up timeout
    timeoutId = setTimeout(() => {
      if (observer) observer.disconnect();
      if (urlCheckInterval) clearInterval(urlCheckInterval);
      console.warn("[cc.js] Session - Session wait timeout after 5 minutes");
      reject(
        new Error(
          "Session timeout - session did not become valid within 5 minutes"
        )
      );
    }, timeoutMs);

    // Watch for DOM changes that indicate session became valid
    observer = new MutationObserver((mutations) => {
      setTimeout(() => {
        checkValid();
      }, 500);
    });

    try {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "id"],
      });
    } catch (e) {
      // Body might not be ready yet
      console.log("[cc.js] DEBUG: Could not observe body, trying window...");
    }

    // Also check on URL changes (SPAs may change URL without DOM mutations)
    let lastUrl = window.location.href;
    urlCheckInterval = setInterval(() => {
      if (window.location.href !== lastUrl) {
        console.log(
          "[cc.js] DEBUG: URL changed from:",
          lastUrl,
          "to:",
          window.location.href
        );
        lastUrl = window.location.href;
        checkValid();
      }
    }, 1000);

    // Clean up function
    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (observer) observer.disconnect();
      if (urlCheckInterval) clearInterval(urlCheckInterval);
    };

    // Override resolve to clean up
    const originalResolve = resolve;
    resolve = (val) => {
      cleanup();
      originalResolve(val);
    };
  });
}

/**
 * Main session check function - call this before running any automation
 * Returns true if session is valid, waits for session if needed
 */
async function ensureSession() {
  // Quick check first - if session is valid, we're good
  if (!isSessionInvalid()) {
    console.log("[cc.js] Session - Already valid");
    return true;
  }

  // Session seems invalid - wait for it to become valid
  try {
    await waitForValidSession();
    return true;
  } catch (error) {
    console.error("[cc.js] Session - Failed:", error.message);
    return false;
  }
}

/**
 * Main automation runner with session handling and auto-retry
 * This function contains all the automation logic and handles session issues
 */
async function runAutomation() {
  //
  // NAVIGATING TO CLAIM.
  //

  // SELECTOR CONSTANTS
  const SSS_CLAIM_INPUT =
    'input[name="SimpleClaimSearch-SimpleClaimSearchScreen-SimpleClaimSearchDV-ClaimNumber"]';
  const SSS_CLAIM_SEARCH_BTN =
    "#SimpleClaimSearch-SimpleClaimSearchScreen-SimpleClaimSearchDV-ClaimSearchAndResetInputSet-Search";
  const SSS_RESULT_BUTTON =
    "#SimpleClaimSearch-SimpleClaimSearchScreen-SimpleClaimSearchResultsLV-0-ClaimNumber_button";

  // Extract URL params.
  const PARAMS = new URLSearchParams(window.location.search);

  // UPDATED: allow fallback to claim passed in via RUN_NOW message
  let TARGET_CLAIM = PARAMS.get("TargetClaim") || PARAMS.get("claimNumber");
  if (!TARGET_CLAIM && globalThis._claimFromMessage) {
    TARGET_CLAIM = globalThis._claimFromMessage;
  }

  if (!TARGET_CLAIM) return;

  const runMode = await getRunMode();

  // copy_only: keep opening ClaimCenter tab, but do not run any CC automation.
  if (runMode === "copy_only") {
    history.pushState({}, "", window.location.origin + window.location.pathname);
    return;
  }

  // Navigate to the search screen.
  await goToSearchScreen();

  // Enter the claim number into the search box.
  const claim_input = await waitForElm(SSS_CLAIM_INPUT);
  await robustClick(claim_input);
  insertText(TARGET_CLAIM);

  // Click the search button.
  const claim_search_btn = await waitForElm(SSS_CLAIM_SEARCH_BTN);
  await robustClick(claim_search_btn);

  // claim_only: search claim but do not click row0/result.
  if (runMode === "claim_only") {
    history.pushState({}, "", window.location.origin + window.location.pathname);
    return;
  }

  // Click on the resulting claim.
  let result_claim_btn = await waitForText(SSS_RESULT_BUTTON, TARGET_CLAIM, 6000);
  if (!result_claim_btn) {
    // First-run fallback: trigger search one more time internally so user doesn't need to click again.
    await robustClick(claim_search_btn);
    result_claim_btn = await waitForText(SSS_RESULT_BUTTON, TARGET_CLAIM, 6000);
  }
  if (!result_claim_btn) {
    result_claim_btn = await waitForElm(SSS_RESULT_BUTTON);
  }
  await robustClick(result_claim_btn);

  //
  // NAVIGATING TO PAGE IN CLAIM.
  //

  // UPDATED: allow fallback to targetPage passed in via RUN_NOW message
  let TARGET_PAGE_RAW = PARAMS.get("TargetPage");
  if (!TARGET_PAGE_RAW && globalThis._targetPageFromMessage) {
    TARGET_PAGE_RAW = globalThis._targetPageFromMessage;
  }

  if (!TARGET_PAGE_RAW) {
    // Reset URL.
    history.pushState({}, "", window.location.origin + window.location.pathname);
    return;
  }

  const desired = normalizeLabel(TARGET_PAGE_RAW);
  const desiredWords = desired.split(" ").filter((w) => w.length > 0);
  const CS_MENU_LINKS = "#Claim-MenuLinks";
  const menu_links_container = await waitForElm(CS_MENU_LINKS);

  // Find all labels under the menu container - also try additional selectors
  // to be more robust across different ClaimCenter versions
  const labels = Array.from(
    menu_links_container.querySelectorAll(
      "div.gw-label, span.gw-label, a.gw-label, li.gw-menu-item, a[role='menuitem'], li a"
    )
  );

  // Debug: log all available labels for troubleshooting
  console.log(
    "[cc.js] Debug - TargetPage sought:",
    TARGET_PAGE_RAW,
    "-> normalized:",
    desired,
    "-> words:",
    desiredWords
  );
  console.log(
    "[cc.js] Debug - Found labels:",
    labels.map((l) => l.innerText?.trim()).filter(Boolean)
  );

  let clicked = false;

  // Strategy 1: Exact match (original behavior)
  for (const lbl of labels) {
    const labelText = normalizeLabel(lbl?.innerText);
    if (!labelText) continue;

    if (labelText === desired) {
      console.log("[cc.js] Debug - Exact match found:", lbl.innerText);
      // Click nearest meaningful clickable wrapper
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

  // Strategy 2: Partial match - if label contains the full desired text
  if (!clicked) {
    for (const lbl of labels) {
      const labelText = normalizeLabel(lbl?.innerText);
      if (!labelText) continue;

      if (labelText.includes(desired)) {
        console.log(
          "[cc.js] Debug - Partial match (contains) found:",
          lbl.innerText
        );
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

  // Strategy 3: Individual word match - match if ALL desired words are present in label
  // This handles cases like "claim overview summary" matching "Overview"
  if (!clicked) {
    for (const lbl of labels) {
      const labelText = normalizeLabel(lbl?.innerText);
      if (!labelText) continue;

      // Check if all desired words are found in the label
      const allWordsFound = desiredWords.every((word) => labelText.includes(word));

      if (allWordsFound && desiredWords.length > 0) {
        console.log(
          "[cc.js] Debug - Word match found:",
          lbl.innerText,
          "matched words:",
          desiredWords
        );
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

  // Strategy 4: Fuzzy match - match if at least one significant word matches
  // Filter out common words that aren't distinctive
  const significantWords = desiredWords.filter(
    (w) => w.length > 3 && !["and", "the", "for", "with"].includes(w)
  );

  if (!clicked && significantWords.length > 0) {
    for (const lbl of labels) {
      const labelText = normalizeLabel(lbl?.innerText);
      if (!labelText) continue;

      // Check if at least one significant word matches
      const anyWordFound = significantWords.some((word) => labelText.includes(word));

      if (anyWordFound) {
        console.log(
          "[cc.js] Debug - Fuzzy match found:",
          lbl.innerText,
          "matched significant words:",
          significantWords
        );
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

  // Reset URL (always)
  history.pushState({}, "", window.location.origin + window.location.pathname);

  // Optional debug
  if (!clicked) {
    console.warn(
      "[cc.js] TargetPage not found:",
      TARGET_PAGE_RAW,
      "(normalized:",
      desired,
      ")"
    );
  }
}

/**
 * Watch for session refresh (page reload due to session expiry)
 * Returns a promise that resolves when the page has re-authenticated
 */
function watchForSessionRefresh(initialUrl, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    let timeoutId = setTimeout(() => {
      observer.disconnect();
      reject(new Error("Session refresh timeout"));
    }, timeoutMs);

    const observer = new MutationObserver((mutations) => {
      // Check if the page has reloaded or redirected
      if (window.location.href !== initialUrl) {
        // Page URL changed - could be session refresh
        console.log(
          "[cc.js] Session - Detected URL change, waiting for stabilization..."
        );

        // Wait a bit for the new page to settle
        setTimeout(() => {
          clearTimeout(timeoutId);
          observer.disconnect();
          resolve(true);
        }, 2000);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  });
}

/**
 * Run automation with session handling and auto-retry
 * Handles session expiry by detecting page reloads and waiting for re-authentication
 */
async function runAutomationWithSessionHandling() {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 3000;

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(
        `[cc.js] Session - Automation attempt ${attempt} of ${MAX_RETRIES}`
      );

      // DEBUG: Log page state at start of each attempt
      debugLogPageState();

      // Capture URL before automation
      const urlBefore = window.location.href;

      // Check and ensure session is valid
      const sessionOk = await ensureSession();
      if (!sessionOk) {
        console.warn("[cc.js] Session - Failed to establish valid session");
        lastError = new Error("Session validation failed");
        continue;
      }

      // Run the automation
      await runAutomation();

      // If we get here, automation completed successfully
      console.log("[cc.js] Session - Automation completed successfully");
      return true;
    } catch (error) {
      lastError = error;
      console.warn(
        `[cc.js] Session - Automation attempt ${attempt} failed:`,
        error.message
      );

      // Check if this might be a session-related error
      const isSessionError =
        error.message?.includes("session") ||
        error.message?.includes("login") ||
        error.message?.includes("auth") ||
        error.message?.includes("timeout") ||
        error.message?.includes("Failed to find") ||
        error.message?.includes("Cannot read properties");

      if (isSessionError && attempt < MAX_RETRIES) {
        console.log(`[cc.js] Session - Retrying after ${RETRY_DELAY_MS}ms...`);
        await sleep(RETRY_DELAY_MS);

        // Check if page has refreshed (session was reset)
        try {
          await watchForSessionRefresh(window.location.href, 30000);
          console.log("[cc.js] Session - Page refreshed, re-establishing session...");
        } catch (refreshError) {
          console.warn(
            "[cc.js] Session - No page refresh detected, retrying anyway"
          );
        }
      }
    }
  }

  // All retries exhausted
  console.error("[cc.js] Session - All automation attempts failed:", lastError?.message);
  return false;
}

// Helper sleep function
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Main IIFE entry point
(async () => {
  // Check if this is a process URL (has automation request)
  const PARAMS = new URLSearchParams(window.location.search);
  const TARGET_CLAIM = PARAMS.get("TargetClaim") || PARAMS.get("claimNumber");

  // Only run automation if there's a target claim
  if (!TARGET_CLAIM) return;

  // DEBUG: Log initial page state
  console.log("[cc.js] DEBUG: Content script loaded for claim:", TARGET_CLAIM);
  debugLogPageState();

  // Run with session handling and auto-retry
  await runAutomationWithSessionHandling();
})();

// Message listener for service worker commands
// This handles RUN_NOW messages from the service worker
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Handle ping from service worker to check if content script is alive
    if (msg?.type === "PING_TM") {
      sendResponse({ ok: true, process: true });
      return true;
    }

    // Handle RUN_NOW command - service worker tells us to run automation
    if (msg?.type === "RUN_NOW") {
      console.log("[cc.js] Received RUN_NOW command, starting automation...");

      // NEW: Pull optional claim + targetPage off the message and store globally
      if (msg.claim) {
        console.log("[cc.js] Using claim from message:", msg.claim);
        globalThis._claimFromMessage = msg.claim;
      }
      if (msg.targetPage) {
        console.log("[cc.js] Using targetPage from message:", msg.targetPage);
        globalThis._targetPageFromMessage = msg.targetPage;
      }

      // DEBUG: Log page state when RUN_NOW is received
      debugLogPageState();

      // Run automation with session handling
      runAutomationWithSessionHandling()
        .then((result) => {
          sendResponse({ ok: true, result });
        })
        .catch((err) => {
          sendResponse({ ok: false, error: err.message });
        });

      // Return true to indicate we'll respond asynchronously
      return true;
    }

    return false;
  });
} catch (e) {
  console.warn("[cc.js] Message listener setup failed:", e);
}
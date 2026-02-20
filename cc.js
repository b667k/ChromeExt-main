// cc.js - UPDATED: robust TargetPage matching (case/spacing/underscore tolerant)

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
// SESSION CHECK - Wait for login if not authenticated
// -----------------------

/**
 * Check if the user is on a ClaimCenter login page
 * Returns true if already authenticated, false if on login page
 */
function isOnLoginPage() {
  // Check URL for login indicators
  const url = window.location.href.toLowerCase();
  if (url.includes('login') || url.includes('auth') || url.includes('signin')) {
    return true;
  }

  // Check for login form elements (Guidewire typically has these)
  const loginForm = document.querySelector('form[name="loginForm"], form[id*="login"], form[class*="login"]');
  if (loginForm) {
    return true;
  }

  // Check for username/password fields on what looks like a login page
  const usernameField = document.querySelector('input[name="username"], input[name="userid"], input[id*="username"], input[id*="userid"]');
  const passwordField = document.querySelector('input[type="password"]');

  // If we have both username and password fields, likely on login page
  if (usernameField && passwordField) {
    return true;
  }

  // Check for Guidewire-specific login elements
  const gwLogin = document.querySelector('.gw-login, #gw-login, [class*="LoginScreen"]');
  if (gwLogin) {
    return true;
  }

  return false;
}

/**
 * Wait for user to complete login
 * Returns a promise that resolves when authentication is complete
 */
async function waitForLogin(timeoutMs = 300000) { // 5 minute timeout
  console.log("[cc.js] Session - Not logged in, waiting for login...");

  return new Promise((resolve, reject) => {
    let timeoutId = null;
    let observer = null;

    const checkAuthenticated = () => {
      // If no longer on login page, user has authenticated
      if (!isOnLoginPage()) {
        console.log("[cc.js] Session - Login detected, proceeding with automation");
        
        // Give the page a moment to load the authenticated content
        setTimeout(() => {
          if (timeoutId) clearTimeout(timeoutId);
          if (observer) observer.disconnect();
          resolve(true);
        }, 1500);
        
        return true;
      }
      return false;
    };

    // Check immediately in case login already completed
    if (checkAuthenticated()) return;

    // Set up timeout
    timeoutId = setTimeout(() => {
      if (observer) observer.disconnect();
      console.warn("[cc.js] Session - Login wait timeout after 5 minutes");
      reject(new Error("Login timeout - user did not authenticate within 5 minutes"));
    }, timeoutMs);

    // Watch for DOM changes that indicate login succeeded
    observer = new MutationObserver((mutations) => {
      // Debounce the check slightly
      setTimeout(() => {
        checkAuthenticated();
      }, 500);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "id"]
    });

    // Also check on URL changes (SPAs may change URL without DOM mutations)
    let lastUrl = window.location.href;
    const urlCheckInterval = setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        checkAuthenticated();
      }
    }, 1000);

    // Clean up interval when resolved
    const originalResolve = resolve;
    resolve = (val) => {
      clearInterval(urlCheckInterval);
      originalResolve(val);
    };
  });
}

/**
 * Main session check function - call this before running any automation
 * Returns true if session is valid, waits for login if needed
 */
async function ensureSession() {
  // Quick check first - if not on login page, we're good
  if (!isOnLoginPage()) {
    console.log("[cc.js] Session - Already authenticated");
    return true;
  }

  // We're on login page - wait for user to authenticate
  try {
    await waitForLogin();
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
  const TARGET_CLAIM = PARAMS.get("TargetClaim") || PARAMS.get("claimNumber");

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
  let result_claim_btn = await waitForText(
    SSS_RESULT_BUTTON,
    TARGET_CLAIM,
    6000
  );
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

  const TARGET_PAGE_RAW = PARAMS.get("TargetPage");
  if (!TARGET_PAGE_RAW) {
    // Reset URL.
    history.pushState({}, "", window.location.origin + window.location.pathname);
    return;
  }

  const desired = normalizeLabel(TARGET_PAGE_RAW);
  const desiredWords = desired.split(" ").filter(w => w.length > 0);
  const CS_MENU_LINKS = "#Claim-MenuLinks";
  const menu_links_container = await waitForElm(CS_MENU_LINKS);

  // Find all labels under the menu container - also try additional selectors
  // to be more robust across different ClaimCenter versions
  const labels = Array.from(
    menu_links_container.querySelectorAll("div.gw-label, span.gw-label, a.gw-label, li.gw-menu-item, a[role='menuitem'], li a")
  );

  // Debug: log all available labels for troubleshooting
  console.log("[cc.js] Debug - TargetPage sought:", TARGET_PAGE_RAW, "-> normalized:", desired, "-> words:", desiredWords);
  console.log("[cc.js] Debug - Found labels:", labels.map(l => l.innerText?.trim()).filter(Boolean));

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
        console.log("[cc.js] Debug - Partial match (contains) found:", lbl.innerText);
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
      const allWordsFound = desiredWords.every(word => labelText.includes(word));
      
      if (allWordsFound && desiredWords.length > 0) {
        console.log("[cc.js] Debug - Word match found:", lbl.innerText, "matched words:", desiredWords);
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
  const significantWords = desiredWords.filter(w => 
    w.length > 3 && !['and', 'the', 'for', 'with'].includes(w)
  );
  
  if (!clicked && significantWords.length > 0) {
    for (const lbl of labels) {
      const labelText = normalizeLabel(lbl?.innerText);
      if (!labelText) continue;

      // Check if at least one significant word matches
      const anyWordFound = significantWords.some(word => labelText.includes(word));
      
      if (anyWordFound) {
        console.log("[cc.js] Debug - Fuzzy match found:", lbl.innerText, "matched significant words:", significantWords);
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
    console.warn("[cc.js] TargetPage not found:", TARGET_PAGE_RAW, "(normalized:", desired, ")");
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
        console.log("[cc.js] Session - Detected URL change, waiting for stabilization...");
        
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
      console.log(`[cc.js] Session - Automation attempt ${attempt} of ${MAX_RETRIES}`);
      
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
      console.warn(`[cc.js] Session - Automation attempt ${attempt} failed:`, error.message);
      
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
          console.warn("[cc.js] Session - No page refresh detected, retrying anyway");
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
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Main IIFE entry point
(async () => {
  // Check if this is a process URL (has automation request)
  const PARAMS = new URLSearchParams(window.location.search);
  const TARGET_CLAIM = PARAMS.get("TargetClaim") || PARAMS.get("claimNumber");
  
  // Only run automation if there's a target claim
  if (!TARGET_CLAIM) return;
  
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

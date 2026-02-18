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

(async () => {
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
  const CS_MENU_LINKS = "#Claim-MenuLinks";
  const menu_links_container = await waitForElm(CS_MENU_LINKS);

  // Find all labels under the menu container, match by normalized text
  const labels = Array.from(
    menu_links_container.querySelectorAll("div.gw-label")
  );

  let clicked = false;
  for (const lbl of labels) {
    const labelText = normalizeLabel(lbl?.innerText);
    if (!labelText) continue;

    if (labelText === desired) {
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

  // Reset URL (always)
  history.pushState({}, "", window.location.origin + window.location.pathname);

  // Optional debug
  if (!clicked) {
    console.warn("[cc.js] TargetPage not found:", TARGET_PAGE_RAW);
  }
})();

// Minimal message listener for service worker
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "PING_TM") {
      sendResponse({ ok: true, process: true });
      return true;
    }
    return false;
  });
} catch (e) {}

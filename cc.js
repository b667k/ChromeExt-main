// cc.js - FAST VERSION (matches scripts/claimcenter.js exactly - no slow path)

async function robustClick(el) {
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
    const observer = new MutationObserver((mutations) => {
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

async function waitForText(selector, expectedText) {
  // First wait for the element to exist
  const el = await waitForElm(selector);
  if (!el) return null;

  // Check if text already matches
  if (el.textContent && el.textContent.includes(expectedText)) {
    return el;
  }

  // Wait for text to appear (exactly like scripts version, but with periodic check as backup)
  return new Promise((resolve) => {
    let resolved = false;
    
    const checkAndResolve = () => {
      if (resolved) return;
      if (el.textContent && el.textContent.includes(expectedText)) {
        resolved = true;
        observer.disconnect();
        if (intervalId) clearInterval(intervalId);
        resolve(el);
      }
    };

    const observer = new MutationObserver(checkAndResolve);

    observer.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Periodic check as backup (in case MutationObserver misses it)
    const intervalId = setInterval(checkAndResolve, 100);
    
    // Also check immediately in case text was set between element creation and observer setup
    checkAndResolve();
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
  input.value = str.trim();
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function goToSearchScreen() {
  const SSS_SEARCH_CLAIMS_TITLEBAR =
    "#SimpleClaimSearch-SimpleClaimSearchScreen-ttlBar";
  let el = document.querySelector(SSS_SEARCH_CLAIMS_TITLEBAR);
  if (!el) {
    const SSS_SEARCH_TAB_BTN = "#TabBar-SearchTab div";
    let search_tab_btn = document.querySelector(SSS_SEARCH_TAB_BTN);
    if (search_tab_btn) await robustClick(search_tab_btn);
  }
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

  if (!TARGET_CLAIM) {
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

  // Wait for search results to load, then click on the resulting claim.
  // Use waitForText (exactly like scripts version) - it waits for element AND text
  const result_claim_btn = await waitForText(SSS_RESULT_BUTTON, TARGET_CLAIM);
  await robustClick(result_claim_btn);
  console.log("Clicked");

  //
  // NAVIGATING TO PAGE IN CLAIM.
  //

  const TARGET_PAGE = PARAMS.get("TargetPage");
  if (!TARGET_PAGE) {
    // Reset URL.
    history.pushState({}, "", window.location.origin + window.location.pathname);
    return;
  }
  const CS_MENU_LINKS = "#Claim-MenuLinks";

  let menu_links_container = await waitForElm(CS_MENU_LINKS);
  for (const el of menu_links_container.children) {
    let label_text = el.querySelector("div.gw-label")?.innerText.trim();
    console.log(label_text);

    if (label_text === TARGET_PAGE) {
      console.log("WAS A MATCH.");
      await robustClick(el.children[0]);
      break;
    }
  }

  // Reset URL.
  history.pushState({}, "", window.location.origin + window.location.pathname);
})();

// Minimal message listener for service worker ping (prevents console errors)
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "PING_TM") {
      sendResponse({ ok: true, process: true });
      return true;
    }
    return false;
  });
} catch (e) {
  // Ignore if extension context is invalidated
}

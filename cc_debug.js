// cc_debug.js
// DEBUG VERSION - Adds detailed logging to diagnose CUW134 flow issues
// Copy this content to replace cc.js temporarily for debugging

"use strict";

const CUW134_URL_BASE =
  "http://erieshare/sites/formsmgmt/CommlForms/_layouts/15/FormServer.aspx";

const TARGET_PAGE_LOSS_DETAILS = "loss details";

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

function getDriverNameFromLossDetails() {
  console.log("[cc_debug] === GETTING DRIVER NAME ===");
  
  // PRIMARY: Try the standard selector first
  const driverEl = document.querySelector(
    '[id*="EditableVehicleIncidentsLV"][id*="-Driver"]'
  );
  if (driverEl) {
    const name = driverEl.textContent?.trim();
    console.log("[cc_debug] Primary selector found element:", driverEl);
    console.log("[cc_debug] Primary selector text:", name);
    if (name) return name;
  }

  // FALLBACK: Try all potential driver-related elements
  console.log("[cc_debug] Trying fallback selectors...");
  
  // Get ALL elements with "Driver" in their ID
  const allDriverElements = document.querySelectorAll('[id*="Driver"]');
  console.log(`[cc_debug] Found ${allDriverElements.length} elements with "Driver" in ID`);
  
  allDriverElements.forEach((el, idx) => {
    console.log(`[cc_debug] Driver element ${idx}: id=${el.id}, text=${el.textContent?.trim().substring(0,50)}`);
  });

  // Try common patterns
  const fallbackSelectors = [
    'div[id*="Driver"][class*="TextValueWidget"]',
    'div[id*="Driver"] .gw-value-readonly-wrapper',
    '[id*="Driver"] .gw-vw--value',
    '[id*="Driver"] span',
    '[id*="Driver"] div',
    'td[id*="Driver"]',
    '.gw-value-readonly[id*="Driver"]',
  ];

  for (const sel of fallbackSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const name = el.textContent?.trim();
      console.log(`[cc_debug] Fallback "${sel}" found:`, name);
      if (name && name.length > 2 && !name.includes('"')) {
        return name;
      }
    }
  }

  // ULTIMATE FALLBACK: Look at ALL table cells in Vehicle Incidents
  console.log("[cc_debug] Trying table cell scan...");
  const cells = document.querySelectorAll('td, div[class*="Cell"], div[class*="cell"]');
  cells.forEach((cell, idx) => {
    const text = cell.textContent?.trim();
    const id = cell.id || '';
    if (id.toLowerCase().includes('driver') || (text && text.length > 3 && text.length < 60)) {
      // Check if it's in a vehicle incidents section
      const parent = cell.closest('[id*="Vehicle"]') || cell.closest('[class*="Vehicle"]');
      if (parent) {
        console.log(`[cc_debug] Potential driver cell ${idx}: id=${id}, text=${text.substring(0,50)}`);
      }
    }
  });

  console.log("[cc_debug] === DRIVER NOT FOUND ===");
  return null;
}

function getLossPartyFromLossDetails() {
  const lossPartyEl = document.querySelector(
    '[id*="EditableVehicleIncidentsLV"][id*="-LossParty"]'
  );
  if (lossPartyEl) {
    const lossParty = lossPartyEl.textContent?.trim();
    console.log("[cc_debug] Found Loss Party:", lossParty);
    return lossParty;
  }
  return null;
}

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
  console.log("[cc_debug] Stashed params:", params);
  return params;
}

function getStashedOrUrlParams() {
  return globalThis._cuw134Params || getCUW134ParamsFromUrl();
}

async function openCUW134Form() {
  console.log("[cc_debug] === OPENING CUW134 ===");

  const driverName = getDriverNameFromLossDetails();
  const lossParty = getLossPartyFromLossDetails();

  console.log("[cc_debug] Driver found:", driverName);
  console.log("[cc_debug] Loss Party:", lossParty);

  if (!driverName) {
    alert("DEBUG: Could not find driver name. Check console for details.");
    return false;
  }

  const { pubc6, t3, t5 } = getStashedOrUrlParams();

  console.log("[cc_debug] Params:", { pubc6, t3, t5, lossParty });

  const url = buildCUW134Url(driverName, pubc6, t3, t5);
  console.log("[cc_debug] Final URL:", url);

  window.location.href = url;
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAnyDebug(selector, timeoutMs = 30000, pollMs = 500) {
  console.log(`[cc_debug] Waiting for: ${selector}`);
  const start = Date.now();
  let attempts = 0;
  
  while (Date.now() - start < timeoutMs) {
    attempts++;
    const el = document.querySelector(selector);
    if (el) {
      console.log(`[cc_debug] Found after ${attempts} attempts`);
      return el;
    }
    if (attempts % 10 === 0) {
      console.log(`[cc_debug] Still waiting... (${Math.round((Date.now()-start)/1000)}s)`);
    }
    await sleep(pollMs);
  }
  console.log(`[cc_debug] TIMEOUT after ${attempts} attempts`);
  return null;
}

async function robustClick(el) {
  if (!el) return;
  await sleep(100);
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

function insertText(str, input = document.activeElement) {
  if (!input) return;
  input.value = String(str || "").trim();
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function normalizeLabel(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
}

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

async function runAutomation() {
  console.log("[cc_debug] === STARTING AUTOMATION ===");
  
  const cuwParams = stashCUW134Params();
  console.log("[cc_debug] CUW params:", cuwParams);

  const PARAMS = new URLSearchParams(window.location.search);
  let TARGET_CLAIM = PARAMS.get("claimNumber");
  if (!TARGET_CLAIM && globalThis._claimFromMessage) TARGET_CLAIM = globalThis._claimFromMessage;
  if (!TARGET_CLAIM) {
    console.log("[cc_debug] No claim number, exiting");
    return;
  }

  console.log("[cc_debug] Target claim:", TARGET_CLAIM);

  // Go to search screen
  await goToSearchScreen();

  // Search and open claim
  const SSS_CLAIM_INPUT =
    'input[name="SimpleClaimSearch-SimpleClaimSearchScreen-SimpleClaimSearchDV-ClaimNumber"]';
  const SSS_CLAIM_SEARCH_BTN =
    "#SimpleClaimSearch-SimpleClaimSearchScreen-SimpleClaimSearchDV-ClaimSearchAndResetInputSet-Search";
  const SSS_RESULT_BUTTON =
    "#SimpleClaimSearch-SimpleClaimSearchScreen-SimpleClaimSearchResultsLV-0-ClaimNumber_button";

  console.log("[cc_debug] Waiting for claim input...");
  const claim_input = await waitForElm(SSS_CLAIM_INPUT);
  await robustClick(claim_input);
  insertText(TARGET_CLAIM);

  console.log("[cc_debug] Clicking search...");
  const claim_search_btn = await waitForElm(SSS_CLAIM_SEARCH_BTN);
  await robustClick(claim_search_btn);

  // Wait for results to appear
  await sleep(2000);
  
  console.log("[cc_debug] Looking for search results...");
  
  // Strategy 1: Try the standard selector
  let result_claim_btn = await waitForText(SSS_RESULT_BUTTON, TARGET_CLAIM, 8000);
  
  // Strategy 2: If not found, look for any link/button containing the claim number
  if (!result_claim_btn) {
    console.log("[cc_debug] Standard selector failed, trying alternative...");
    const allLinks = document.querySelectorAll('a, button');
    for (const link of allLinks) {
      const text = link.textContent?.trim() || '';
      const id = link.id || '';
      if (text.includes(TARGET_CLAIM) || id.includes(TARGET_CLAIM)) {
        console.log("[cc_debug] Found link containing claim:", text.substring(0, 50), id);
        result_claim_btn = link;
        break;
      }
    }
  }
  
  // Strategy 3: Look for table rows in results
  if (!result_claim_btn) {
    console.log("[cc_debug] Trying table row approach...");
    const rows = document.querySelectorAll('tr, div[class*="Row"]');
    for (const row of rows) {
      const text = row.textContent || '';
      if (text.includes(TARGET_CLAIM)) {
        console.log("[cc_debug] Found row with claim:", text.substring(0, 100));
        // Try to find a clickable element in this row
        const clickable = row.querySelector('a, button, [role="button"]');
        if (clickable) {
          result_claim_btn = clickable;
          break;
        }
      }
    }
  }

  if (!result_claim_btn) {
    console.log("[cc_debug] DUMPING PAGE HTML for debugging...");
    console.log(document.body.innerHTML.substring(0, 5000));
    alert("Could not find claim result. Check console for details.");
    return;
  }

  console.log("[cc_debug] Clicking claim result...");
  await robustClick(result_claim_btn);
  
  // Wait for claim to fully load
  await sleep(3000);

  console.log("[cc_debug] Claim opened, navigating to Loss Details...");

  // Target page
  let TARGET_PAGE_RAW = PARAMS.get("TargetPage");
  if (!TARGET_PAGE_RAW && globalThis._targetPageFromMessage) {
    TARGET_PAGE_RAW = globalThis._targetPageFromMessage;
  }
  if (!TARGET_PAGE_RAW) {
    console.log("[cc_debug] No TargetPage, exiting");
    return;
  }

  const desired = normalizeLabel(TARGET_PAGE_RAW);
  console.log("[cc_debug] Target page normalized:", desired);

  // Open left menu item
  const CS_MENU_LINKS = "#Claim-MenuLinks";
  const menu_links_container = await waitForElm(CS_MENU_LINKS);

  const labels = Array.from(
    menu_links_container.querySelectorAll(
      "div.gw-label, span.gw-label, a.gw-label, li.gw-menu-item, a[role='menuitem'], li a"
    )
  );

  console.log("[cc_debug] Found menu items:", labels.length);

  let clicked = false;

  // Try exact match
  for (const lbl of labels) {
    const labelText = normalizeLabel(lbl?.innerText);
    if (labelText && labelText === desired) {
      console.log("[cc_debug] Clicking (exact):", labelText);
      const clickable = lbl.closest('a, button, [role="menuitem"]') || lbl.closest("li") || lbl.parentElement;
      await robustClick(clickable);
      clicked = true;
      break;
    }
  }

  // Try contains
  if (!clicked) {
    for (const lbl of labels) {
      const labelText = normalizeLabel(lbl?.innerText);
      if (labelText && labelText.includes(desired)) {
        console.log("[cc_debug] Clicking (contains):", labelText);
        const clickable = lbl.closest('a, button, [role="menuitem"]') || lbl.closest("li") || lbl.parentElement;
        await robustClick(clickable);
        clicked = true;
        break;
      }
    }
  }

  if (!clicked) {
    console.log("[cc_debug] Could not find menu item for:", desired);
    return;
  }

  // Wait for Loss Details to load
  await sleep(2000);
  
  // ============================================================
  // KEY CHECK: if openCUW134=1, try to open CUW134
  // ============================================================
  const shouldOpen = !!cuwParams.open;
  const isLossDetails = normalizeLabel(TARGET_PAGE_RAW) === TARGET_PAGE_LOSS_DETAILS;

  console.log("[cc_debug] shouldOpen:", shouldOpen, "isLossDetails:", isLossDetails);

  if (shouldOpen && isLossDetails) {
    console.log("[cc_debug] Waiting for Driver cell...");
    
    // Wait with debug logging
    const driverCell = await waitForAnyDebug(
      '[id*="EditableVehicleIncidentsLV"][id*="-Driver"]',
      30000
    );

    if (!driverCell) {
      console.warn("[cc_debug] Driver cell not found. Let me scan the page...");
      
      // Debug: dump all IDs on page
      const allIds = document.querySelectorAll('[id]');
      console.log(`[cc_debug] Total elements with ID: ${allIds.length}`);
      
      let foundAny = false;
      allIds.forEach(el => {
        const id = el.id.toLowerCase();
        if (id.includes('vehicle') || id.includes('incident') || id.includes('driver')) {
          console.log(`[cc_debug] Relevant ID: ${el.id}`);
          foundAny = true;
        }
      });
      
      if (!foundAny) {
        console.log("[cc_debug] No vehicle/incident/driver IDs found on page");
      }
      
      alert("DEBUG: Could not find driver cell. Check console for page IDs.");
      return;
    }

    console.log("[cc_debug] Driver cell found! Waiting for text...");
    await sleep(1000);

    await openCUW134Form();
    return;
  }

  console.log("[cc_debug] Done (no CUW134 open requested)");
}

async function runAutomationWithSessionHandling() {
  try {
    console.log("[cc_debug] Starting automation...");
    await runAutomation();
    console.log("[cc_debug] Automation completed.");
  } catch (e) {
    console.error("[cc_debug] Error:", e);
    alert("DEBUG Error: " + e.message);
  }
}

// Entry point
(async () => {
  const PARAMS = new URLSearchParams(window.location.search);
  const TARGET_CLAIM = PARAMS.get("claimNumber");

  if (!TARGET_CLAIM) {
    console.log("[cc_debug] No claim number in URL, not running");
    return;
  }

  console.log("[cc_debug] === CLAIM CENTER DEBUG LOADED ===");
  console.log("[cc_debug] Claim:", TARGET_CLAIM);
  
  stashCUW134Params();
  
  await runAutomationWithSessionHandling();
})();

// portal.js (FULL - runs safely even if injected into page; uses extension APIs only if available)
(() => {
  const DEBUG = false;
  const log = (...a) => DEBUG && console.log("[P2CC]", ...a);

  // --- Detect whether we're in a REAL extension context (content script) ---
  // Note: window.chrome can exist on pages, but extension APIs (runtime.id + storage) won't.
  const hasExtApi =
    typeof chrome !== "undefined" &&
    !!chrome?.runtime?.id &&
    !!chrome?.storage &&
    typeof chrome?.storage?.local?.get === "function" &&
    typeof chrome?.storage?.local?.set === "function";

  // If you want to *require* extension context, flip this to true and we will exit early.
  const REQUIRE_EXTENSION_CONTEXT = false;

  if (REQUIRE_EXTENSION_CONTEXT && !hasExtApi) {
    console.warn("[P2CC] Not running as extension content script; exiting.");
    return;
  }

  // ---- Suppress the common teardown rejection noise ----
  window.addEventListener("unhandledrejection", (e) => {
    const msg = String(e?.reason?.message || e?.reason || "");
    if (msg.includes("Extension context invalidated")) {
      e.preventDefault();
    }
  });

  // Mark content script as "alive" until navigation/unload
  let alive = true;
  const kill = () => (alive = false);
  window.addEventListener("pagehide", kill, { once: true });
  window.addEventListener("beforeunload", kill, { once: true });

  // --- Settings ---
  const SETTINGS_KEY = "settings_v1";
  const DEFAULT_SETTINGS = { runMode: "full" };

  // ---- Safe extension API wrappers (no-ops if not in extension context) ----
  function safeSyncGet(key) {
    return new Promise((resolve) => {
      try {
        if (!alive) return resolve(null);
        if (!hasExtApi) return resolve(null);
        if (!chrome?.storage?.sync?.get) return resolve(null);

        chrome.storage.sync.get(key, (data) => {
          if (!alive) return resolve(null);
          if (chrome?.runtime?.lastError) return resolve(null);
          resolve(data || null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  function safeLocalGet(keys) {
    return new Promise((resolve) => {
      try {
        if (!alive) return resolve(null);
        if (!hasExtApi) return resolve(null);
        if (!chrome?.storage?.local?.get) return resolve(null);

        chrome.storage.local.get(keys, (data) => {
          if (!alive) return resolve(null);
          if (chrome?.runtime?.lastError) return resolve(null);
          resolve(data || null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  function safeLocalSet(obj) {
    return new Promise((resolve) => {
      try {
        if (!alive) return resolve(false);
        if (!hasExtApi) return resolve(false);
        if (!chrome?.storage?.local?.set) return resolve(false);

        chrome.storage.local.set(obj, () => {
          if (!alive) return resolve(false);
          if (chrome?.runtime?.lastError) return resolve(false);
          resolve(true);
        });
      } catch {
        resolve(false);
      }
    });
  }

  function safeSendMessage(msg) {
    try {
      if (!alive) return false;
      if (!hasExtApi) return false;
      if (!chrome?.runtime?.sendMessage) return false;
      chrome.runtime.sendMessage(msg, () => {});
      return true;
    } catch {
      return false;
    }
  }

  async function getRunMode() {
    // If not extension context, fall back to full mode so UI still works.
    if (!hasExtApi) return DEFAULT_SETTINGS.runMode;
    const data = await safeSyncGet(SETTINGS_KEY);
    return data?.[SETTINGS_KEY]?.runMode || DEFAULT_SETTINGS.runMode;
  }

  function getBtnLabel(mode) {
    if (mode === "copy_only") return "Copy Claim #";
    if (mode === "claim_only") return "Search ECC (Stops at Claim)";
    return "Search ECC (Full)";
  }

  function updateButtonLabels(mode) {
    const btns = document.querySelectorAll("#p2ccBtn");
    const txt = getBtnLabel(mode);
    btns.forEach((b) => (b.textContent = txt));
  }

  function getClaimNumberFromTaskDescription() {
    const el = document.querySelector("#taskDescription");
    const text = el?.innerText?.trim() || "";
    const m = text.match(/\b([A-Za-z]\d{11})\b/);
    return m ? m[1] : "";
  }

  function getPolicyNumberFromTaskDescription() {
    const el = document.querySelector("#taskDescription");
    const text = el?.innerText?.trim() || "";
    const m = text.match(/\b([A-Z]\d{6,12})\b/);
    const claim = getClaimNumberFromTaskDescription();
    if (m && m[1] && m[1] !== claim) return m[1];
    return "";
  }

  function uniqueReq() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // Helper for mixed contexts (HTTP/HTTPS)
  async function copyToClipboard(text) {
    const value = String(text || "").trim();
    if (!value) return false;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (e) {
      log("navigator.clipboard failed", e);
    }

    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      ta.setAttribute("readonly", "");
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) {
      log("execCommand failed", e);
      return false;
    }
  }

  // --- Container creation & normalization ---
  function ensureContainer() {
    // First, check if the full custom section exists
    let section = document.querySelector("#tm-custom-mainframe-section");
    let c = document.querySelector("#tm-custom-mainframe-buttons");

    if (!section) {
      // Create the full section if it doesn't exist
      section = document.createElement("div");
      section.id = "tm-custom-mainframe-section";
      section.className = "row top-buffer col-xs-12";
      section.style.marginTop = "10px";
      section.innerHTML = `
        <label class="row paddingleftVI">Custom Scripts</label>
        <div class="row paddingleftVI">
          <div class="col-xs-12 top-buffer" id="tm-custom-mainframe-buttons" style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding-right: 0px;">
          </div>
        </div>
      `;

      // Find the PUUR buttons container to insert after
      const puurInput = document.querySelector('input[value="LoadPUUR"]');
      const puurDiv = puurInput ? puurInput.closest('div.row.top-buffer.col-xs-12') : null;
      if (puurDiv) {
        puurDiv.parentNode.insertBefore(section, puurDiv.nextSibling);
      } else {
        // Fallback: append to body
        (document.body || document.documentElement).appendChild(section);
      }

      c = section.querySelector("#tm-custom-mainframe-buttons");
    }

    // If section exists but c doesn't, something wrong, but assume it does
    if (!c) {
      c = document.querySelector("#tm-custom-mainframe-buttons");
      if (!c) {
        // Last resort
        c = document.createElement("div");
        c.id = "tm-custom-mainframe-buttons";
        (document.body || document.documentElement).appendChild(c);
      }
    }

    // Ensure the section has proper spacing
    section.style.marginBottom = "25px";

    // Apply consistent layout styles
    c.style.display = "flex";
    c.style.flexWrap = "wrap";
    c.style.alignItems = "center";
    c.style.gap = "8px";
    c.style.paddingRight = "0";

    return c;
  }

  // Normalize any form wrappers and inline styles inserted by server/markup.
  function normalizeExistingWrappers(container) {
    if (!container) return;
    // Normalize forms (the page may wrap some buttons in forms)
    const forms = Array.from(container.querySelectorAll("form"));
    forms.forEach((f) => {
      // remove inline margins that create uneven spacing
      f.style.marginRight = "0";
      f.style.marginBottom = "0";
      // ensure form uses inline-flex so it participates in container gap properly
      f.style.display = "inline-flex";
      f.style.alignItems = "center";
      f.style.padding = "0";
      f.style.border = "0";
      f.style.background = "transparent";
      // normalize contained button if present
      const b = f.querySelector("button");
      if (b) {
        b.style.margin = "0";
        b.style.boxSizing = "border-box";
      }
    });

    // Normalize any inline margins on direct children (buttons that were added by server)
    Array.from(container.children).forEach((ch) => {
      if (ch.tagName && ch.tagName.toLowerCase() !== "form") {
        if (ch.style) {
          ch.style.marginRight = "0";
          ch.style.marginBottom = "0";
        }
      }
    });

    // Ensure consistent button sizing and reset any inline spacing on buttons.
    const buttons = Array.from(container.querySelectorAll("button"));
    buttons.forEach((btn) => {
      // Choose a consistent min width that fits label text but creates an even visual.
      btn.style.minWidth = btn.style.minWidth || "150px";
      // if the page already set padding, don't overwrite unless empty
      btn.style.padding = btn.style.padding || "10px 14px";
      btn.style.margin = "0 0 5px 0";
      btn.style.boxSizing = "border-box";
    });
  }

  // --- PA Auto Support ---
  let lastPromptedClaim = "";

  function getDriverStatusFromTaskDescription() {
    const td = document.querySelector("#taskDescription");
    const text = td?.innerText || "";
    if (/\bDD\b/.test(text) || /Default Driver/i.test(text) || /Unknown Driver/i.test(text)) {
      return "DD";
    }
    return "";
  }

  async function triggerHandoff() {
    try {
      if (!alive) return;

      const claim = getClaimNumberFromTaskDescription();
      if (!claim) {
        alert("Could not find Claim # in #taskDescription.");
        return;
      }

      const mode = await getRunMode();
      if (!alive) return;

      // Always allow copy mode, even without extension context
      if (mode === "copy_only" || !hasExtApi) {
        const success = await copyToClipboard(claim);
        if (success) {
          const btn = document.querySelector("#p2ccBtn");
          if (btn) {
            const originalText = btn.textContent;
            btn.textContent = "Copied!";
            setTimeout(() => {
              if (alive && document.contains(btn)) btn.textContent = originalText;
            }, 1500);
          }
        }
      }

      // If we don't have extension APIs, we cannot write extension storage or message background.
      // (We already copied the claim above, which is still useful.)
      if (!hasExtApi) return;

      const req = uniqueReq();
      const policy = getPolicyNumberFromTaskDescription();

      const res = await safeLocalGet(["kick"]);
      if (!alive) return;

      const kick = Number(res?.kick || 0) + 1;

      await safeLocalSet({
        handoff: { claim, policy, req, ts: Date.now() },
        ownerReq: req,
        kick,
      });

      if (!alive) return;

      safeSendMessage({ type: "OPEN_CC", req });
    } catch {
      return;
    }
  }

  function checkPaAutoTriggers() {
    const claim = getClaimNumberFromTaskDescription();
    if (!claim || claim === lastPromptedClaim) return;

    const status = getDriverStatusFromTaskDescription();
    if (status === "DD") {
      lastPromptedClaim = claim;

      const message =
        `PA AUTO FLOWCHART TRACE:\n` +
        `1. Driver on claim: Default Driver (DD)\n` +
        `2. Driver listed on policy: Unknown / needs verification\n\n` +
        `ACTION:\n` +
        `1. Check ECC/PUDR for driver name.\n` +
        `2. If not listed, begin Claim by Unknown Driver procedure.\n` +
        `3. If listed, continue flowchart as normal.\n\n` +
        `OPEN ECC NOW?\n` +
        `Click Yes to open ECC ClaimCenter in Google Chrome (passes claim # in the URL).`;

      if (confirm(message)) triggerHandoff();
    }
  }

  function createBbsWrapperForPath(filePath) {
    /* Generates a .bbs wrapper for .vbs scripts to allow auto-execution. */
    return `Sub Main()

  Dim bzhao

  Set bzhao = CreateObject("BZWhll.WhllObj")

  bzhao.Connect

  bzhao.RunScript "${filePath}"

End Sub`;
  }

  function baseNameNoExt(path) {
    return path
      .split(/[\\/]/) // handle Windows or Unix paths
      .pop() // get filename
      .replace(/\.[^.]+$/, ""); // remove last extension
  }

  function downloadTextFile({ content, downloadName }) {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function addButton(container) {
    if (!alive) return;
    if (!container) return;

    // Add P2CC button if not already present
    if (!container.querySelector("#p2ccBtn")) {
      const form = document.createElement("form");
      form.action = "javascript:void(0)";
      form.method = "post";
      form.style.display = "inline-block";
      form.style.marginRight = "6px";
      form.style.marginBottom = "6px";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = "p2ccBtn";

      const mode = await getRunMode();
      if (!alive) return;

      btn.textContent = getBtnLabel(mode);
      btn.className = "btn btn-primary-variant btn-mainframe";
      btn.style.minWidth = "150px";
      btn.style.padding = "10px 14px";
      btn.style.boxSizing = "border-box";
      btn.style.margin = "0";

      let cooldown = false;
      btn.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (cooldown) return;
          cooldown = true;
          setTimeout(() => (cooldown = false), 300);
          triggerHandoff();
        },
        true
      );

      form.addEventListener(
        "submit",
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        },
        true
      );

      form.appendChild(btn);
      container.appendChild(form);
    }

    // Add the "Check 3rd year" button if not already present
    if (!container.querySelector("#check3rdYearBtn")) {
      const form = document.createElement("form");
      form.action = "javascript:void(0)";
      form.method = "post";
      form.style.display = "inline-block";
      form.style.marginRight = "6px";
      form.style.marginBottom = "6px";

      const checkBtn = document.createElement("button");
      checkBtn.type = "button";
      checkBtn.id = "check3rdYearBtn";
      checkBtn.textContent = "Check 3rd year";
      checkBtn.className = "btn btn-primary-variant btn-mainframe";
      checkBtn.style.minWidth = "150px";
      checkBtn.style.padding = "10px 14px";
      checkBtn.style.boxSizing = "border-box";
      checkBtn.style.margin = "0";

      checkBtn.addEventListener("click", () => {
        const filePath = "I:\\Apprentice's Scripts\\3-year-loss-scope.vbs";
        const content = createBbsWrapperForPath(filePath);
        const downloadName = `${baseNameNoExt(filePath)}.bbs`;
        downloadTextFile({ content, downloadName });
      });

      form.addEventListener(
        "submit",
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        },
        true
      );

      form.appendChild(checkBtn);
      container.appendChild(form);
    }


  }

  function tryAdd() {
    if (!alive) return;
    const c = ensureContainer();
    // Normalize any forms / inline styles the page might have added
    normalizeExistingWrappers(c);
    addButton(c);
    checkPaAutoTriggers();
  }

  // --- Init ---

  // Only attach storage listener if actually in extension context
  try {
    if (hasExtApi && chrome?.storage?.onChanged?.addListener) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (!alive) return;
        if (area === "sync" && changes[SETTINGS_KEY]) {
          const newMode = changes[SETTINGS_KEY].newValue?.runMode || DEFAULT_SETTINGS.runMode;
          updateButtonLabels(newMode);
        }
      });
    }
  } catch {
    // ignore
  }

  tryAdd();

  // Throttled observer
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (!alive || scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      tryAdd();
    }, 200);
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();

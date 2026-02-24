// portal.js (FULL - runs safely even if injected into page; uses extension APIs only if available)
(() => {
  const DEBUG = false;
  const log = (...a) => DEBUG && console.log("[P2CC]", ...a);

  const hasExtApi =
    typeof chrome !== "undefined" &&
    !!chrome?.runtime?.id &&
    !!chrome?.storage &&
    typeof chrome?.storage?.local?.get === "function" &&
    typeof chrome?.storage?.local?.set === "function";

  const REQUIRE_EXTENSION_CONTEXT = false;

  if (REQUIRE_EXTENSION_CONTEXT && !hasExtApi) {
    console.warn("[P2CC] Not running as extension content script; exiting.");
    return;
  }

  window.addEventListener("unhandledrejection", (e) => {
    const msg = String(e?.reason?.message || e?.reason || "");
    if (msg.includes("Extension context invalidated")) e.preventDefault();
  });

  let alive = true;
  const kill = () => (alive = false);
  window.addEventListener("pagehide", kill, { once: true });
  window.addEventListener("beforeunload", kill, { once: true });

  const SETTINGS_KEY = "settings_v1";
  const DEFAULT_SETTINGS = {
    runMode: "full",
    buttons: { p2cc: true, thirdYear: true },
    autoDropdown: true,
  };

  function normalizeSettings(raw) {
    const runMode = raw?.runMode || DEFAULT_SETTINGS.runMode;
    const b = raw?.buttons || {};
    const autoDropdown =
      typeof raw?.autoDropdown === "boolean" ? raw.autoDropdown : DEFAULT_SETTINGS.autoDropdown;
    return {
      runMode,
      buttons: {
        p2cc: typeof b.p2cc === "boolean" ? b.p2cc : DEFAULT_SETTINGS.buttons.p2cc,
        thirdYear: typeof b.thirdYear === "boolean" ? b.thirdYear : DEFAULT_SETTINGS.buttons.thirdYear,
      },
      autoDropdown,
    };
  }

  function safeSyncGet(key) {
    return new Promise((resolve) => {
      try {
        if (!alive || !hasExtApi || !chrome?.storage?.sync?.get) return resolve(null);
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
        if (!alive || !hasExtApi || !chrome?.storage?.local?.get) return resolve(null);
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
        if (!alive || !hasExtApi || !chrome?.storage?.local?.set) return resolve(false);
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
      if (!alive || !hasExtApi || !chrome?.runtime?.sendMessage) return false;
      chrome.runtime.sendMessage(msg, () => {});
      return true;
    } catch {
      return false;
    }
  }

  async function getSettings() {
    if (!hasExtApi) return { ...DEFAULT_SETTINGS };
    const data = await safeSyncGet(SETTINGS_KEY);
    return normalizeSettings(data?.[SETTINGS_KEY] || null);
  }

  function getBtnLabel(mode) {
    if (mode === "copy_only") return "Copy Claim #";
    if (mode === "claim_only") return "Copy & Paste Claim";
    return "Open Claim in ECC";
  }

  function updateButtonLabels(mode) {
    document.querySelectorAll("#p2ccBtn").forEach((b) => (b.textContent = getBtnLabel(mode)));
  }

  function removeButtonById(buttonId) {
    const btn = document.querySelector(`#${buttonId}`);
    if (!btn) return;
    const form = btn.closest("form");
    if (form?.parentNode) form.parentNode.removeChild(form);
    else if (btn.parentNode) btn.parentNode.removeChild(btn);
  }

  function setSectionVisibility(anyEnabled) {
    const section = document.querySelector("#tm-custom-mainframe-section");
    if (!section) return;
    section.style.display = anyEnabled ? "" : "none";
  }

  function getClaimNumberFromClaimSection() {
    // Find the "Claim Number:" label and get the adjacent value
    // HTML structure:
    // <p class="col-xs-3 text-right" style="font-weight: bold;">Claim Number:</p>
    // <p class="col-xs-9 text-left">A00007469531</p>
    const labels = Array.from(document.querySelectorAll("p"));
    
    for (const label of labels) {
      const text = label?.innerText?.trim() || "";
      if (text === "Claim Number:") {
        // Get the next sibling element (should be the claim number value)
        const nextSibling = label.nextElementSibling;
        if (nextSibling) {
          const claimNumber = nextSibling?.innerText?.trim() || "";
          if (claimNumber && /^[A-Za-z]\d{11}$/.test(claimNumber)) {
            return claimNumber;
          }
        }
      }
    }
    return "";
  }

  function getClaimNumberFromTaskDescription() {
    // First try: get from #taskDescription (existing method)
    const el = document.querySelector("#taskDescription");
    const claimNumber = el?.innerText?.trim()?.split(" ")?.[0]?.trim() || "";
    if (claimNumber && /^[A-Za-z]\d{11}$/.test(claimNumber)) return claimNumber;
    const text = el?.innerText?.trim() || "";
    const m = text.match(/\b([A-Za-z]\d{11})\b/);
    if (m) return m[1];

    // Second try: get from Claim Number section (new fallback)
    const claimFromSection = getClaimNumberFromClaimSection();
    if (claimFromSection) return claimFromSection;

    return "";
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

  async function copyToClipboard(text) {
    const value = String(text || "").trim();
    if (!value) return false;

    try {
      if (navigator.clipboard?.writeText) {
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

  function ensureContainer() {
    let section = document.querySelector("#tm-custom-mainframe-section");
    let c = document.querySelector("#tm-custom-mainframe-buttons");

    if (!section) {
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

      const puurInput = document.querySelector('input[value="LoadPUUR"]');
      const puurDiv = puurInput ? puurInput.closest("div.row.top-buffer.col-xs-12") : null;
      if (puurDiv) puurDiv.parentNode.insertBefore(section, puurDiv.nextSibling);
      else (document.body || document.documentElement).appendChild(section);

      c = section.querySelector("#tm-custom-mainframe-buttons");
    }

    if (!c) {
      c = document.querySelector("#tm-custom-mainframe-buttons");
      if (!c) {
        c = document.createElement("div");
        c.id = "tm-custom-mainframe-buttons";
        (document.body || document.documentElement).appendChild(c);
      }
    }

    section.style.marginBottom = "25px";
    c.style.display = "flex";
    c.style.flexWrap = "wrap";
    c.style.alignItems = "center";
    c.style.gap = "8px";
    c.style.paddingRight = "0";

    return c;
  }

  function normalizeExistingWrappers(container) {
    if (!container) return;

    Array.from(container.querySelectorAll("form")).forEach((f) => {
      f.style.marginRight = "0";
      f.style.marginBottom = "0";
      f.style.display = "inline-flex";
      f.style.alignItems = "center";
      f.style.padding = "0";
      f.style.border = "0";
      f.style.background = "transparent";
      const b = f.querySelector("button");
      if (b) {
        b.style.margin = "0";
        b.style.boxSizing = "border-box";
      }
    });

    Array.from(container.children).forEach((ch) => {
      if (ch.tagName && ch.tagName.toLowerCase() !== "form") {
        if (ch.style) {
          ch.style.marginRight = "0";
          ch.style.marginBottom = "0";
        }
      }
    });

    Array.from(container.querySelectorAll("button")).forEach((btn) => {
      btn.style.minWidth = btn.style.minWidth || "150px";
      btn.style.padding = btn.style.padding || "10px 14px";
      btn.style.margin = "0 0 5px 0";
      btn.style.boxSizing = "border-box";
    });
  }

  let lastPromptedClaim = "";

  function getDriverStatusFromTaskDescription() {
    const td = document.querySelector("#taskDescription");
    const text = td?.innerText || "";
    if (/\bDD\b/.test(text) || /Default Driver/i.test(text) || /Unknown Driver/i.test(text)) return "DD";
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

      const { runMode: mode } = await getSettings();
      if (!alive) return;

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
    return `Sub Main()

  Dim bzhao

  Set bzhao = CreateObject("BZWhll.WhllObj")

  bzhao.Connect

  bzhao.RunScript "${filePath}"

End Sub`;
  }

  function baseNameNoExt(path) {
    return path.split(/[\\/]/).pop().replace(/\.[^.]+$/, "");
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

  // Flag to track if autoDropdown has already run
  let autoDropdownRun = false;

  // Auto Dropdown function - expands the Mainframe System Interactions dropdown
  function autoExpandMainframe() {
    console.log("Auto-expanded Mainframe System Interactions dropdown.");
    const div = document.querySelector("#Mainframediv");
    if (div) {
      div.click();
    }
  }

  async function runAutoDropdown() {
    if (!alive) return;
    if (autoDropdownRun) return; // Only run once

    const settings = await getSettings();
    if (!alive) return;

    if (settings.autoDropdown) {
      autoExpandMainframe();
      autoDropdownRun = true; // Mark as run so it doesn't run again
    }
  }

  async function addButtons(container) {
    if (!alive || !container) return;

    const settings = await getSettings();
    if (!alive) return;

    const mode = settings.runMode || DEFAULT_SETTINGS.runMode;
    const showP2cc = !!settings.buttons?.p2cc;
    const show3rd = !!settings.buttons?.thirdYear;
    const anyEnabled = showP2cc || show3rd;

    setSectionVisibility(anyEnabled);

    if (!showP2cc) removeButtonById("p2ccBtn");
    if (!show3rd) removeButtonById("check3rdYearBtn");

    if (showP2cc && !container.querySelector("#p2ccBtn")) {
      const form = document.createElement("form");
      form.action = "javascript:void(0)";
      form.method = "post";
      form.style.display = "inline-block";
      form.style.marginRight = "6px";
      form.style.marginBottom = "6px";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = "p2ccBtn";
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
    } else if (showP2cc) {
      updateButtonLabels(mode);
    }

    if (show3rd && !container.querySelector("#check3rdYearBtn")) {
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
    normalizeExistingWrappers(c);
    addButtons(c);
    checkPaAutoTriggers();
    runAutoDropdown();
  }

  // ✅ Live updates without reload:
  // 1) Storage changes
  try {
    if (hasExtApi && chrome?.storage?.onChanged?.addListener) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (!alive) return;
        if (area === "sync" && changes[SETTINGS_KEY]) {
          tryAdd();
        }
      });
    }
  } catch {}

  // 2) Direct message from popup (immediate)
  try {
    if (hasExtApi && chrome?.runtime?.onMessage?.addListener) {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (!alive) return false;
        if (msg?.type === "P2CC_SETTINGS_UPDATED") {
          // Ensure async operations complete before returning
          (async () => {
            try {
              await tryAdd();
            } catch (e) {
              log("Error in tryAdd from message:", e);
            }
          })();
          return true; // Keep message channel open for async response
        }
        return false;
      });
    }
  } catch {}

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

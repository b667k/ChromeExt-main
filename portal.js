// portal.js (UPDATED - create container if missing)
(() => {
  const DEBUG = false;
  const log = (...a) => DEBUG && console.log("[P2CC]", ...a);

  // --- Settings ---
  const SETTINGS_KEY = "settings_v1";
  const DEFAULT_SETTINGS = { runMode: "full" };

  async function getRunMode() {
    try {
      const data = await chrome.storage.sync.get(SETTINGS_KEY);
      return data?.[SETTINGS_KEY]?.runMode || DEFAULT_SETTINGS.runMode;
    } catch {
      return DEFAULT_SETTINGS.runMode;
    }
  }

  function getBtnLabel(mode) {
    if (mode === "copy_only") return "Copy Claim #";
    if (mode === "claim_only") return "Search ECC (Stops at Claim)";
    return "Search ECC (Full)";
  }

  function updateButtonLabels(mode) {
    const btns = document.querySelectorAll("#p2ccBtn");
    const txt = getBtnLabel(mode);
    btns.forEach(b => b.textContent = txt);
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
    // Attempt to find a policy-like string (e.g. Q101...) if present
    // Adjust regex as needed for your specific policy formats
    const m = text.match(/\b([A-Z]\d{6,12})\b/);
    if (m && m[1] !== getClaimNumberFromTaskDescription()) {
      return m[1];
    }
    return "";
  }

  function uniqueReq() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // Helper for mixed contexts (HTTP/HTTPS)
  async function copyToClipboard(text) {
    const value = String(text || "").trim();
    if (!value) return false;

    // 1. Try modern API (if secure context)
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (e) {
      log("navigator.clipboard failed", e);
    }

    // 2. Fallback: textarea + execCommand
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
    // 1) Use existing container if present
    let c = document.querySelector("#tm-custom-mainframe-buttons");
    if (c) return c;

    // 2) Otherwise, create our own container
    c = document.createElement("div");
    c.id = "tm-custom-mainframe-buttons";

    // Styling: keep it subtle and non-breaking
    c.style.display = "inline-flex";
    c.style.alignItems = "center";
    c.style.gap = "6px";
    c.style.marginLeft = "6px";

    // 3) Prefer inserting near taskDescription
    const td = document.querySelector("#taskDescription");
    if (td) {
      // Put it right after taskDescription (or inside its parent)
      const parent = td.parentElement || td;
      parent.appendChild(c);
      log("created container near #taskDescription");
      return c;
    }

    // 4) Fallback: put it at top of body
    (document.body || document.documentElement).prepend(c);
    log("created container in body");
    return c;
  }

  // --- PA Auto Support ---
  let lastPromptedClaim = "";

  function getDriverStatusFromTaskDescription() {
    const td = document.querySelector("#taskDescription");
    const text = td?.innerText || "";
    // VBScript logic: isDefaultDriver = (Me.DriverNum = "DD")
    // Also matching literals "Default Driver" or "Unknown Driver"
    if (/\bDD\b/.test(text) || /Default Driver/i.test(text) || /Unknown Driver/i.test(text)) {
      return "DD";
    }
    return "";
  }

  async function triggerHandoff() {
    const claim = getClaimNumberFromTaskDescription();
    if (!claim) {
      alert("Could not find Claim # in #taskDescription.");
      return;
    }

    const currentMode = await getRunMode();
    if (currentMode === "copy_only") {
      const success = await copyToClipboard(claim);
      if (success) {
        // Find existing button for visual feedback if possible
        const btn = document.querySelector("#p2ccBtn");
        if (btn) {
          const originalText = btn.textContent;
          btn.textContent = "Copied!";
          setTimeout(() => btn.textContent = originalText, 1500);
        }
      } else {
        alert("Clipboard copy failed. Context might be insecure.");
      }
    }

    const req = uniqueReq();
    chrome.storage.local.get(["kick"], (res) => {
      const oldKick = Number(res?.kick || 0);
      const kick = oldKick + 1;
      const policy = getPolicyNumberFromTaskDescription();
      const payload = {
        handoff: { claim, policy, req, ts: Date.now() },
        ownerReq: req,
        kick,
      };

      chrome.storage.local.set(payload, () => {
        try {
          chrome.runtime.sendMessage({ type: "OPEN_CC", req }, () => { });
        } catch {
          // ignore
        }
      });
    });
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

      if (confirm(message)) {
        triggerHandoff();
      }
    }
  }

  async function addButton(container) {
    if (!container || container.querySelector("#p2ccBtn")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "p2ccBtn";
    const mode = await getRunMode();
    btn.textContent = getBtnLabel(mode);
    btn.className = "btn btn-primary-variant btn-mainframe";
    btn.style.marginLeft = "6px";

    let cooldown = false;

    btn.addEventListener(
      "click",
      async (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (cooldown) return;
        cooldown = true;
        setTimeout(() => (cooldown = false), 300);

        triggerHandoff();
      },
      true
    );

    container.appendChild(btn);
    log("button added");
  }

  function tryAdd() {
    const c = ensureContainer();
    addButton(c);
    checkPaAutoTriggers();
  }

  // --- Init ---

  // Watch for settings changes to update labels live
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes[SETTINGS_KEY]) {
      const newMode = changes[SETTINGS_KEY].newValue?.runMode || DEFAULT_SETTINGS.runMode;
      updateButtonLabels(newMode);
    }
  });

  // Try immediately
  tryAdd();

  // Watch for changes (task switches / slow renders)
  const observer = new MutationObserver(() => {
    tryAdd();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  log("Observer started");
})();

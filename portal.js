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

  function ensureContainer() {
    let c = document.querySelector("#tm-custom-mainframe-buttons");
    if (c) return c;

    c = document.createElement("div");
    c.id = "tm-custom-mainframe-buttons";
    c.style.display = "inline-flex";
    c.style.alignItems = "center";
    c.style.gap = "6px";
    c.style.marginLeft = "6px";

    const td = document.querySelector("#taskDescription");
    if (td) {
      const parent = td.parentElement || td;
      parent.appendChild(c);
      return c;
    }

    (document.body || document.documentElement).prepend(c);
    return c;
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

  async function addButton(container) {
    if (!alive) return;
    if (!container || container.querySelector("#p2ccBtn")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "p2ccBtn";

    const mode = await getRunMode();
    if (!alive) return;

    btn.textContent = getBtnLabel(mode);
    btn.className = "btn btn-primary-variant btn-mainframe";
    btn.style.marginLeft = "6px";

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

    container.appendChild(btn);
  }

  function tryAdd() {
    if (!alive) return;
    const c = ensureContainer();
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

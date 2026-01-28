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

  function uniqueReq() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

        const claim = getClaimNumberFromTaskDescription();
        if (!claim) {
          alert("Could not find Claim # in #taskDescription.");
          return;
        }

        // If copy_only, we handle it here because sw.js blocks it (and we can do it faster + feedback)
        const currentMode = await getRunMode();
        if (currentMode === "copy_only") {
          try {
            await navigator.clipboard.writeText(claim);
            const originalText = btn.textContent;
            btn.textContent = "Copied!";
            setTimeout(() => btn.textContent = originalText, 1500);
          } catch (err) {
            alert("Clipboard copy failed: " + err);
          }
          // We do NOT send OPEN_CC because sw.js will just ignore it anyway
          return;
        }

        const req = uniqueReq();

        chrome.storage.local.get(["kick"], (res) => {
          const oldKick = Number(res?.kick || 0);
          const kick = oldKick + 1;

          const payload = {
            handoff: { claim, req, ts: Date.now() },
            ownerReq: req,
            kick,
          };

          chrome.storage.local.set(payload, () => {
            const err = chrome.runtime.lastError;
            if (err) {
              // optional: keep warnings off unless DEBUG
              log("storage.set warning", err?.message || err);
            } else {
              log("handoff set", { claim, req, kick });
            }

            try {
              chrome.runtime.sendMessage({ type: "OPEN_CC", req }, () => {
                // ignore context invalidation etc.
              });
            } catch {
              // ignore
            }
          });
        });
      },
      true
    );

    container.appendChild(btn);
    log("button added");
  }

  function tryAdd() {
    const c = ensureContainer();
    addButton(c);
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

// portal.js (FULL UPDATED - Persistent Observer + fire-and-forget)
(() => {
  const DEBUG = true;
  const log = (...a) => DEBUG && console.log("[P2CC]", ...a);

  function getClaimNumberFromTaskDescription() {
    const el = document.querySelector("#taskDescription");
    const text = el?.innerText?.trim() || "";
    const m = text.match(/\b([A-Za-z]\d{11})\b/);
    return m ? m[1] : "";
  }

  function uniqueReq() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function addButton(container) {
    // 1. Safety check: if container missing or button already exists, stop.
    if (!container || container.querySelector("#p2ccBtn")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "p2ccBtn";
    btn.textContent = "Search ECC (Extension)";
    btn.className = "btn btn-primary-variant btn-mainframe";
    btn.style.marginLeft = "6px";

    // tiny cooldown to prevent accidental double clicks
    let cooldown = false;

    btn.addEventListener(
      "click",
      (e) => {
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

        const req = uniqueReq();

        // IMPORTANT: fire-and-forget. Do not await.
        chrome.storage.local.get(["kick"], (res) => {
          const oldKick = Number(res?.kick || 0);
          const kick = oldKick + 1;

          const payload = {
            handoff: { claim, req, ts: Date.now() },
            ownerReq: req,
            kick
          };

          chrome.storage.local.set(payload, () => {
            const err = chrome.runtime.lastError;
            if (err) {
              console.warn("[P2CC] storage.set warning", err?.message || err);
            } else {
              log("handoff set", { claim, req, kick });
            }

            // Also fire-and-forget message to SW.
            try {
              chrome.runtime.sendMessage({ type: "OPEN_CC", req }, (resp) => {
                const msgErr = chrome.runtime.lastError;
                if (msgErr) {
                  // Suppress irrelevant context invalidation errors
                  return;
                }
              });
            } catch (e2) {
              // Ignore immediate context errors
            }
          });
        });
      },
      true
    );

    container.appendChild(btn);
    log("button added");
  }

  // --- OBSERVER LOGIC ---

  function tryAdd() {
    const c = document.querySelector("#tm-custom-mainframe-buttons");
    if (c) addButton(c);
  }

  // 1. Try immediately
  tryAdd();

  // 2. Watch for changes (if the user switches tasks or the page is slow)
  const observer = new MutationObserver(() => {
    tryAdd();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  log("Observer started");
})();

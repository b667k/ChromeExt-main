// portal.js (FULL UPDATED - fire-and-forget to avoid "Extension context invalidated")
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
              // If Portal is mid-rerender, this can happen. Still try to OPEN_CC.
              console.warn("[P2CC] storage.set warning", err?.message || err);
            } else {
              log("handoff set", { claim, req, kick });
            }

            // Also fire-and-forget message to SW.
            try {
              chrome.runtime.sendMessage({ type: "OPEN_CC", req }, (resp) => {
                const msgErr = chrome.runtime.lastError;
                if (msgErr) {
                  // This is the key: if context dies, this callback might never run.
                  // If it runs and errors, log it; user can click again.
                  console.warn("[P2CC] sendMessage warning", msgErr?.message || msgErr);
                  return;
                }
                log("OPEN_CC resp", resp);
              });
            } catch (e2) {
              console.warn("[P2CC] sendMessage threw", e2?.message || e2);
            }
          });
        });
      },
      true
    );

    container.appendChild(btn);
    log("button added");
  }

  async function init() {
    for (let i = 0; i < 200; i++) {
      const c = document.querySelector("#tm-custom-mainframe-buttons");
      if (c) {
        addButton(c);
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    log("container not found");
  }

  init();
})();

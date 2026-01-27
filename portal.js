// portal.js (UPDATED - create container if missing)
(() => {
  const DEBUG = false;
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

  function addButton(container) {
    if (!container || container.querySelector("#p2ccBtn")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "p2ccBtn";
    btn.textContent = "Search ECC";
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

        const claim = getClaimNumberFromTaskDescription();
        if (!claim) {
          alert("Could not find Claim # in #taskDescription.");
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

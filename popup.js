// popup.js
// Tabs + Settings (saved) + Settings “Copy claim now” + Feedback -> opens Outlook email draft

const TO_EMAIL = "blaine.oler@erieinsurance.com";

// -------------------- Settings (sync) --------------------
const SETTINGS_KEY = "settings_v1";
const DEFAULT_SETTINGS = { runMode: "full" }; // full | claim_only | copy_only

async function loadSettings() {
  try {
    const data = await chrome.storage.sync.get(SETTINGS_KEY);
    return data?.[SETTINGS_KEY] || { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings(next) {
  const safe = {
    runMode: (next?.runMode || DEFAULT_SETTINGS.runMode),
  };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: safe });
}

// -------------------- Clipboard (popup context) --------------------
async function getHandoffInfo() {
  try {
    const data = await chrome.storage.local.get("handoff");
    return {
      claim: (data?.handoff?.claim || "").trim(),
      policy: (data?.handoff?.policy || "").trim()
    };
  } catch {
    return { claim: "", policy: "" };
  }
}

// Pre-fetch immediately so copy is synchronous
getHandoffInfo().then((info) => {
  CACHED_CLAIM = info.claim;
});

async function copyToClipboardFromPopup(text) {
  const value = String(text || "").trim();
  if (!value) return false;

  // Modern API
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { }

  // Fallback
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return !!ok;
  } catch {
    return false;
  }
}

// -------------------- Status helper --------------------
function setStatus(msg, kind = "") {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = msg || "";
  el.className = "status " + (kind || "");
}

// -------------------- Settings UI wiring --------------------
async function initSettings() {
  const radios = Array.from(document.querySelectorAll('input[name="runMode"]'));
  if (radios.length === 0) return;

  // Load -> apply
  const settings = await loadSettings();
  const mode = settings.runMode || DEFAULT_SETTINGS.runMode;

  const match = radios.find((r) => r.value === mode);
  if (match) match.checked = true;

  // OPTIONAL: If you add a button in HTML like:
  // <button id="copyClaimNow" type="button">Copy claim</button>
  // this will wire it up automatically (won't error if missing).
  const copyBtn = document.getElementById("copyClaimNow");

  async function doCopyClaim() {
    // Attempt synchronous read first to satisfy clipboard API
    const info = await getHandoffInfo();
    const claim = CACHED_CLAIM || info.claim;
    if (!claim) {
      setStatus("No claim found to copy yet.", "err");
      return;
    }
    const ok = await copyToClipboardFromPopup(claim);
    setStatus(ok ? `Copied claim number: ${claim}` : "Couldn’t copy to clipboard.", ok ? "ok" : "err");
  }

  if (copyBtn) {
    copyBtn.addEventListener("click", () => doCopyClaim());
  }

  // Save on change
  radios.forEach((r) => {
    r.addEventListener("change", async () => {
      const selected = radios.find((x) => x.checked)?.value || DEFAULT_SETTINGS.runMode;
      try {
        await saveSettings({ runMode: selected });

        // If they choose copy_only, we attempt copy immediately (nice UX)
        if (selected === "copy_only") {
          await doCopyClaim();
        } else {
          // Clear any prior "Copied" message when switching modes
          setStatus("", "");
        }
      } catch (e) {
        console.error(e);
        setStatus("Couldn’t save settings.", "err");
      }
    });
  });
}

// -------------------- Mail helpers --------------------
function buildMailto(to, subject, body) {
  return (
    "mailto:" +
    encodeURIComponent(to) +
    "?subject=" +
    encodeURIComponent(subject) +
    "&body=" +
    encodeURIComponent(body)
  );
}

function fbTypeLabel(v) {
  if (v === "issue") return "Issue";
  if (v === "suggestion") return "Suggestion";
  if (v === "question") return "Question";
  return "Feedback";
}

function leadIn(v) {
  if (v === "issue") return "I ran into an issue using the Portal ↔ ClaimCenter extension:";
  if (v === "suggestion") return "I have a suggestion for improving the Portal ↔ ClaimCenter extension:";
  if (v === "question") return "I have a quick question about the Portal ↔ ClaimCenter extension:";
  return "I wanted to share some feedback about the Portal ↔ ClaimCenter extension:";
}

function safeUserUrl(url) {
  if (!url) return "";
  if (url.startsWith("chrome://")) return ""; // looks bad in email
  return url;
}

// Removed getActiveTabInfo as it is no longer used for URL logic


// -------------------- Tabs --------------------
function initTabs() {
  const tabSettings = document.getElementById("tabSettings");
  const tabFeedback = document.getElementById("tabFeedback");
  const panelSettings = document.getElementById("panelSettings");
  const panelFeedback = document.getElementById("panelFeedback");
  if (!tabSettings || !tabFeedback || !panelSettings || !panelFeedback) return;

  function setTab(active) {
    const isSettings = active === "settings";

    tabSettings.classList.toggle("active", isSettings);
    tabFeedback.classList.toggle("active", !isSettings);

    tabSettings.setAttribute("aria-selected", String(isSettings));
    tabFeedback.setAttribute("aria-selected", String(!isSettings));

    panelSettings.classList.toggle("active", isSettings);
    panelFeedback.classList.toggle("active", !isSettings);

    // Clear any prior status when switching tabs
    setStatus("", "");
  }

  tabSettings.addEventListener("click", () => setTab("settings"));
  tabFeedback.addEventListener("click", () => setTab("feedback"));
}

// -------------------- Feedback Email Draft --------------------
async function openFeedbackEmailDraft() {
  const typeEl = document.getElementById("fbType");
  const msgEl = document.getElementById("fbMessage");
  const includeUrlEl = document.getElementById("fbIncludeUrl");
  const sendBtn = document.getElementById("fbSend");

  const fbType = (typeEl?.value || "other").trim();
  const msgText = (msgEl?.value || "").trim();

  if (!msgText) {
    setStatus("Please type your message first.", "err");
    return;
  }

  if (sendBtn) sendBtn.disabled = true;
  setStatus("Opening email draft…");

  try {
    // const tabInfo = await getActiveTabInfo();  <-- No longer need tab info
    const kind = fbTypeLabel(fbType);
    const subject = `Portal ↔ ClaimCenter Extension — ${kind}`;

    const info = await getHandoffInfo();
    const includeData = includeUrlEl && includeUrlEl.checked; // Reusing this ID for "Include Data"

    const dataBlock = [];
    if (includeData) {
      if (info.policy) dataBlock.push(`Policy: ${info.policy}`);
    }

    const body = [
      "Hi Blaine,",
      "",
      leadIn(fbType),
      "",
      msgText,
      "",
      dataBlock.length > 0 ? "Context:" : "",
      ...dataBlock,
      "",
      "Thanks!",
    ]
      .filter(Boolean)
      .join("\n");

    const mailtoUrl = buildMailto(TO_EMAIL, subject, body);
    await chrome.tabs.create({ url: mailtoUrl });

    if (msgEl) msgEl.value = "";
    setStatus("Draft opened in Outlook — click Send.", "ok");
  } catch (e) {
    console.error(e);
    setStatus("Couldn’t open the email draft.", "err");
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

function initFeedbackButtons() {
  const clearBtn = document.getElementById("fbClear");
  const sendBtn = document.getElementById("fbSend");
  const msgEl = document.getElementById("fbMessage");

  if (clearBtn && msgEl) {
    clearBtn.addEventListener("click", () => {
      msgEl.value = "";
      setStatus("", "");
    });
  }
  if (sendBtn) {
    sendBtn.addEventListener("click", () => openFeedbackEmailDraft());
  }
}

// -------------------- Init --------------------
document.addEventListener("DOMContentLoaded", async () => {
  // Version pill
  try {
    const m = chrome.runtime.getManifest();
    const v = document.getElementById("extVersion");
    if (v) v.textContent = m?.version || "—";
  } catch { }

  initTabs();
  initFeedbackButtons();
  await initSettings(); // ✅ makes settings actually save/load + enables clipboard copy
});

// popup.js
// Tabs + Settings UI (no behavior yet) + Feedback -> opens Outlook email draft

const TO_EMAIL = "blaine.oler@erieinsurance.com";

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

function setStatus(msg, kind = "") {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = msg || "";
  el.className = "status " + (kind || "");
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

async function getActiveTabInfo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? { url: tab.url || "", title: tab.title || "" } : { url: "", title: "" };
}

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
    const tabInfo = await getActiveTabInfo();
    const kind = fbTypeLabel(fbType);

    const subject = `Portal ↔ ClaimCenter Extension — ${kind}`;

    const urlToInclude =
      includeUrlEl && includeUrlEl.checked ? safeUserUrl(tabInfo.url) : "";

    const body = [
      "Hi Blaine,",
      "",
      leadIn(fbType),
      "",
      msgText,
      "",
      urlToInclude ? "Where I was when it happened:" : "",
      urlToInclude ? urlToInclude : "",
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
document.addEventListener("DOMContentLoaded", () => {
  // Version pill
  try {
    const m = chrome.runtime.getManifest();
    const v = document.getElementById("extVersion");
    if (v) v.textContent = m?.version || "—";
  } catch {}

  initTabs();
  initFeedbackButtons();
});

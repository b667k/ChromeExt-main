// popup.js
// Settings (saved) + Clipboard + Target Page toggle + Button visibility toggles

const SETTINGS_KEY_V1 = "settings_v1";
const SETTINGS_KEY_V2 = "settings_v2"; // legacy (migration source)

const DEFAULT_SETTINGS = {
  runMode: "full", // full | claim_only | copy_only
  targetPage: "claim_overview_summary",
  buttons: {
    p2cc: true,
    thirdYear: true,
  },
};

function normalizeSettings(raw) {
  const runMode = raw?.runMode || DEFAULT_SETTINGS.runMode;

  const targetPage =
    raw?.targetPage !== undefined && raw?.targetPage !== null && raw?.targetPage !== ""
      ? raw.targetPage
      : DEFAULT_SETTINGS.targetPage;

  const buttonsRaw = raw?.buttons || {};
  const buttons = {
    p2cc: typeof buttonsRaw.p2cc === "boolean" ? buttonsRaw.p2cc : DEFAULT_SETTINGS.buttons.p2cc,
    thirdYear:
      typeof buttonsRaw.thirdYear === "boolean"
        ? buttonsRaw.thirdYear
        : DEFAULT_SETTINGS.buttons.thirdYear,
  };

  return { runMode, targetPage, buttons };
}

async function loadSettings() {
  try {
    const d1 = await chrome.storage.sync.get(SETTINGS_KEY_V1);
    if (d1?.[SETTINGS_KEY_V1]) return normalizeSettings(d1[SETTINGS_KEY_V1]);

    const d2 = await chrome.storage.sync.get(SETTINGS_KEY_V2);
    if (d2?.[SETTINGS_KEY_V2]) {
      const migrated = normalizeSettings(d2[SETTINGS_KEY_V2]);
      await chrome.storage.sync.set({ [SETTINGS_KEY_V1]: migrated });
      return migrated;
    }

    return { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings(next) {
  const safe = normalizeSettings(next);
  await chrome.storage.sync.set({ [SETTINGS_KEY_V1]: safe });

  // Broadcast: force content scripts to refresh immediately (no reload)
  try {
    chrome.runtime.sendMessage({ type: "P2CC_SETTINGS_UPDATED" }, () => {});
  } catch {}

  // Optional: if you have "tabs" permission, this will target the active tab too.
  // Safe to call even if permission is missing (it will just throw and be caught).
  try {
    if (chrome.tabs?.query && chrome.tabs?.sendMessage) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs?.[0]?.id;
        if (tabId != null) {
          chrome.tabs.sendMessage(tabId, { type: "P2CC_SETTINGS_UPDATED" }, () => {});
        }
      });
    }
  } catch {}
}

// -------------------- Clipboard (popup context) --------------------
let CACHED_CLAIM = "";

async function getHandoffInfo() {
  try {
    const data = await chrome.storage.local.get("handoff");
    return {
      claim: (data?.handoff?.claim || "").trim(),
      policy: (data?.handoff?.policy || "").trim(),
    };
  } catch {
    return { claim: "", policy: "" };
  }
}

getHandoffInfo().then((info) => {
  CACHED_CLAIM = info.claim;
});

async function copyToClipboardFromPopup(text) {
  const value = String(text || "").trim();
  if (!value) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {}

  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
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

// -------------------- Settings Tab label helper --------------------
function getPrimaryButtonLabelForMode(mode) {
  if (mode === "copy_only") return "Copy Claim #";
  if (mode === "claim_only") return "Copy & Paste Claim";
  return "Open Claim in ECC";
}

function updateSettingsTabPrimaryLabel(mode) {
  const el = document.getElementById("p2ccLabel");
  if (!el) return;
  el.textContent = getPrimaryButtonLabelForMode(mode);
}

// -------------------- Settings UI wiring --------------------
async function initSettings() {
  const radios = Array.from(document.querySelectorAll('input[name="runMode"]'));
  if (radios.length === 0) return;

  const targetRow = document.getElementById("targetPageRow");
  const targetSelect = document.getElementById("targetPage");

  const toggleP2cc = document.getElementById("toggle_p2cc");
  const toggle3rd = document.getElementById("toggle_3rdyear");

  function applyTargetVisibility(runMode) {
    const show = runMode === "full";
    if (targetRow) targetRow.hidden = !show;
  }

  const settings = await loadSettings();
  const mode = settings.runMode || DEFAULT_SETTINGS.runMode;

  const match = radios.find((r) => r.value === mode);
  if (match) match.checked = true;

  if (targetSelect) targetSelect.value = settings.targetPage || DEFAULT_SETTINGS.targetPage;

  if (toggleP2cc) toggleP2cc.checked = !!settings.buttons?.p2cc;
  if (toggle3rd) toggle3rd.checked = !!settings.buttons?.thirdYear;

  applyTargetVisibility(mode);
  updateSettingsTabPrimaryLabel(mode);

  async function doCopyClaim() {
    const info = await getHandoffInfo();
    const claim = CACHED_CLAIM || info.claim;
    if (!claim) {
      setStatus("No claim found to copy yet.", "err");
      return;
    }
    const ok = await copyToClipboardFromPopup(claim);
    setStatus(ok ? `Copied claim number: ${claim}` : "Couldn’t copy to clipboard.", ok ? "ok" : "err");
  }

  async function persistAll() {
    const selectedMode = radios.find((x) => x.checked)?.value || DEFAULT_SETTINGS.runMode;

    await saveSettings({
      runMode: selectedMode,
      targetPage: targetSelect ? (targetSelect.value || DEFAULT_SETTINGS.targetPage) : DEFAULT_SETTINGS.targetPage,
      buttons: {
        p2cc: toggleP2cc ? !!toggleP2cc.checked : DEFAULT_SETTINGS.buttons.p2cc,
        thirdYear: toggle3rd ? !!toggle3rd.checked : DEFAULT_SETTINGS.buttons.thirdYear,
      },
    });
  }

  if (targetSelect) {
    targetSelect.addEventListener("change", async () => {
      try {
        await persistAll();
      } catch (e) {
        console.error(e);
        setStatus("Couldn’t save target page.", "err");
      }
    });
  }

  radios.forEach((r) => {
    r.addEventListener("change", async () => {
      const selected = radios.find((x) => x.checked)?.value || DEFAULT_SETTINGS.runMode;
      updateSettingsTabPrimaryLabel(selected);

      try {
        await persistAll();
        applyTargetVisibility(selected);

        if (selected === "copy_only") await doCopyClaim();
        else setStatus("", "");
      } catch (e) {
        console.error(e);
        setStatus("Couldn’t save settings.", "err");
      }
    });
  });

  [toggleP2cc, toggle3rd].forEach((t) => {
    if (!t) return;
    t.addEventListener("change", async () => {
      try {
        await persistAll();
        setStatus("", "");
      } catch (e) {
        console.error(e);
        setStatus("Couldn’t save settings.", "err");
      }
    });
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const m = chrome.runtime.getManifest();
    const v = document.getElementById("extVersion");
    if (v) v.textContent = m?.version || "—";
  } catch {}

  await initSettings();
});

// sw.js (HARDENED - initial complete check + process-tab targeting + ping-then-run + latest-wins)

const CC_ORIGIN = "https://cc-prod-gwcpprod.erie.delta4-andromeda.guidewire.net";
const CC_URL_BASE = `${CC_ORIGIN}/ClaimCenter.do`;

const DEBUG = true;
const log = (...a) => DEBUG && console.log("[SW]", ...a);
const warn = (...a) => console.warn("[SW]", ...a);

function buildCcUrl(req) {
  const u = new URL(CC_URL_BASE);
  u.searchParams.set("tm_t", String(req));
  u.searchParams.set("process", "true");
  return u.toString();
}

function isProcessUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.origin === CC_ORIGIN && u.searchParams.get("process") === "true";
  } catch {
    return false;
  }
}

async function findExistingProcessTab() {
  const tabs = await chrome.tabs.query({ url: `${CC_ORIGIN}/*` });

  // Prefer a tab that already has process=true so we don’t hijack a user’s normal CC tab
  const proc = tabs.find((t) => t.url && isProcessUrl(t.url));
  if (proc) return proc;

  // If none, you can either:
  // (A) create a new tab (safer), OR
  // (B) reuse the first ClaimCenter tab (your original behavior).
  // I recommend (A). So return null here.
  return null;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForTabComplete(tabId, timeoutMs = 25000) {
  // ✅ initial check prevents missing “complete”
  try {
    const t = await chrome.tabs.get(tabId);
    if (t?.status === "complete") return true;
  } catch {}

  return new Promise((resolve) => {
    let done = false;
    const t0 = Date.now();

    const finish = (ok) => {
      if (done) return;
      done = true;
      try { chrome.tabs.onUpdated.removeListener(onUpd); } catch {}
      resolve(ok);
    };

    const onUpd = (updatedTabId, info) => {
      if (updatedTabId !== tabId) return;
      if (info.status === "complete") finish(true);
    };

    chrome.tabs.onUpdated.addListener(onUpd);

    (function tick() {
      if (done) return;
      if (Date.now() - t0 > timeoutMs) return finish(false);
      setTimeout(tick, 250);
    })();
  });
}

async function stillLatestReq(req) {
  try {
    const { ownerReq, handoff } = await chrome.storage.local.get(["ownerReq", "handoff"]);
    return ownerReq === req && handoff?.req === req;
  } catch {
    return false;
  }
}

// Promise wrapper that returns {ok, err}
async function trySend(tabId, payload) {
  try {
    const resp = await chrome.tabs.sendMessage(tabId, payload);
    return { ok: true, resp };
  } catch (e) {
    return { ok: false, err: String(e?.message || e) };
  }
}

// More reliable than blind RUN_NOW: wait until the content script is actually alive.
async function pingThenRun(tabId, req, attempts = 12) {
  for (let i = 0; i < attempts; i++) {
    const ping = await trySend(tabId, { type: "PING_TM" });

    if (ping.ok) {
      const run = await trySend(tabId, { type: "RUN_NOW", req });
      if (run.ok) return { delivered: true, reason: "ping_ok_run_ok" };

      warn("RUN_NOW failed after ping ok", { err: run.err });
      // small retry even if ping worked (rare timing issues)
    } else {
      // Most common error here: "Could not establish connection. Receiving end does not exist."
      if (DEBUG) warn("PING failed", { i: i + 1, err: ping.err });
    }

    await sleep(250 + i * 50);
  }

  return { delivered: false, reason: "no_receiver_after_retries" };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type !== "OPEN_CC") return;

    const req = msg.req;
    const url = buildCcUrl(req);

    // Optionally re-assert ownerReq to reduce race windows
    // (Portal sets it, but this helps if portal storage.set hiccups)
    try { await chrome.storage.local.set({ ownerReq: req }); } catch {}

    let tab = await findExistingProcessTab();

    if (!tab) {
      tab = await chrome.tabs.create({ url, active: true });
      log("created process CC tab", tab.id);
    } else {
      await chrome.tabs.update(tab.id, { url, active: true });
      log("updated process CC tab", tab.id);
    }

    // Wait for navigation to finish so cc.js (document_idle) can run
    const completed = await waitForTabComplete(tab.id, 25000);
    log("tab complete?", completed, tab.id);

    // Latest-wins: don’t run stale req
    if (!(await stillLatestReq(req))) {
      log("Skipping stale req (newer request exists)", { req });
      sendResponse({ ok: true, tabId: tab.id, skipped: true, completed, delivered: false });
      return;
    }

    // Deliver: ping until receiver exists, then RUN_NOW(req)
    const result = await pingThenRun(tab.id, req, 12);

    // Re-check latest-wins after delivery attempts
    if (!(await stillLatestReq(req))) {
      log("Delivery finished but req no longer latest", { req });
      sendResponse({ ok: true, tabId: tab.id, skipped: true, completed, delivered: false });
      return;
    }

    log("RUN_NOW delivered?", result.delivered, result.reason, tab.id);
    sendResponse({ ok: true, tabId: tab.id, completed, delivered: result.delivered, reason: result.reason });
  })().catch((e) => {
    console.error("[SW] OPEN_CC failed", e);
    sendResponse({ ok: false, error: String(e?.message || e) });
  });

  return true;
});

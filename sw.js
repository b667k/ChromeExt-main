// sw.js (HARDENED - initial complete check + process-tab targeting + ping-then-run + latest-wins
//        + RUN MODE short-circuit for copy_only
//        + FEEDBACK OUTBOX + optional Native Messaging flush)

const CC_ORIGIN = "https://cc-prod-gwcpprod.erie.delta4-andromeda.guidewire.net";
const CC_URL_BASE = `${CC_ORIGIN}/ClaimCenter.do`;

// Track the CC automation tab so we can reuse it even after SPA navigation changes its URL
let processTabId = null;

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === processTabId) processTabId = null;
});

const DEBUG = true;
const log = (...a) => DEBUG && console.log("[SW]", ...a);
const warn = (...a) => console.warn("[SW]", ...a);

// -----------------------
// SETTINGS (sync)
// -----------------------
const SETTINGS_KEY = "settings_v1";
const DEFAULT_SETTINGS = { runMode: "full" }; // full | claim_only | copy_only

async function getRunMode() {
  try {
    const data = await chrome.storage.sync.get(SETTINGS_KEY);
    return data?.[SETTINGS_KEY]?.runMode || DEFAULT_SETTINGS.runMode;
  } catch {
    return DEFAULT_SETTINGS.runMode;
  }
}

// -----------------------
// CLAIMCENTER AUTOMATION
// -----------------------
function buildCcUrl(req, claim) {
  const u = new URL(CC_URL_BASE);
  u.searchParams.set("tm_t", String(req));
  u.searchParams.set("process", "true");
  if (claim) u.searchParams.set("claimNumber", String(claim));
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
  // First: check our stored tab ID (survives SPA URL changes)
  if (processTabId != null) {
    try {
      const stored = await chrome.tabs.get(processTabId);
      if (stored && stored.url && stored.url.startsWith(CC_ORIGIN)) {
        return stored;
      }
    } catch {
      processTabId = null; // Tab was closed or doesn't exist
    }
  }

  const tabs = await chrome.tabs.query({ url: `${CC_ORIGIN}/*` });

  // Prefer a tab that already has process=true so we don’t hijack a user’s normal CC tab
  const proc = tabs.find((t) => t.url && isProcessUrl(t.url));
  if (proc) return proc;

  // If none, create a new process tab (safer)
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
  } catch { }

  return new Promise((resolve) => {
    let done = false;
    const t0 = Date.now();

    const finish = (ok) => {
      if (done) return;
      done = true;
      try {
        chrome.tabs.onUpdated.removeListener(onUpd);
      } catch { }
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

// -----------------------
// FEEDBACK OUTBOX
// -----------------------
const OUTBOX_KEY = "feedback_outbox_v1";

// Change this to your native host name once installed.
// If native messaging isn't installed, flush calls will fail and we just keep queueing.
const NATIVE_HOST_NAME = "com.erie.feedback";

async function getOutbox() {
  const data = await chrome.storage.local.get(OUTBOX_KEY);
  return Array.isArray(data[OUTBOX_KEY]) ? data[OUTBOX_KEY] : [];
}

async function setOutbox(items) {
  await chrome.storage.local.set({ [OUTBOX_KEY]: items });
}

async function enqueueFeedback(entry) {
  const outbox = await getOutbox();
  outbox.push(entry);
  await setOutbox(outbox);
  return outbox.length;
}

async function flushOutboxToNative() {
  const outbox = await getOutbox();
  if (outbox.length === 0) return { sent: 0, remaining: 0 };

  await flushFeedbackToNativeHost(outbox);

  // Clear only after success
  await setOutbox([]);
  return { sent: outbox.length, remaining: 0 };
}

async function flushFeedbackToNativeHost(items) {
  const payload = { kind: "feedback_batch", items };

  const response = await new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, payload, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      resolve(resp);
    });
  });

  if (!response || response.ok !== true) {
    throw new Error(response?.error || "Native host returned failure");
  }

  return response;
}

// Optional: periodically attempt flush (best-effort). Requires "alarms" permission if you enable this.
async function tryBackgroundFlushBestEffort() {
  try {
    const res = await flushOutboxToNative();
    if (res.sent > 0) log("background flush sent", res.sent);
  } catch (e) {
    // expected if offline or native host not installed
    if (DEBUG) warn("background flush failed (will retry later)", String(e?.message || e));
  }
}

// -----------------------
// SINGLE onMessage LISTENER (handles both OPEN_CC + feedback)
// -----------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    // ---- ClaimCenter automation ----
    if (msg?.type === "OPEN_CC") {
      // ✅ If user selected copy_only, we do NOT open ClaimCenter.
      // Copy happens in popup.js in a user-gesture context.
      // we allow copy_only to proceed so it opens the tab, but cc.js will halt.


      const req = msg.req;
      let claim = "";
      try {
        const data = await chrome.storage.local.get("handoff");
        if (data?.handoff?.req === req) {
          claim = data.handoff.claim;
        }
      } catch { }

      const url = buildCcUrl(req, claim);

      // Optionally re-assert ownerReq to reduce race windows
      try {
        await chrome.storage.local.set({ ownerReq: req });
      } catch { }

      let tab = await findExistingProcessTab();

      if (!tab) {
        tab = await chrome.tabs.create({ url, active: true });
        processTabId = tab.id;
        log("created process CC tab", tab.id);
      } else {
        await chrome.tabs.update(tab.id, { url, active: true });
        processTabId = tab.id;
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
      sendResponse({
        ok: true,
        tabId: tab.id,
        completed,
        delivered: result.delivered,
        reason: result.reason,
      });
      return;
    }

    // ---- Process tab registration (closes duplicate CC process tabs) ----
    if (msg?.type === "CLAIM_PROCESS_TAB") {
      const tabId = sender.tab?.id;
      if (tabId) {
        const tabs = await chrome.tabs.query({ url: `${CC_ORIGIN}/*` });
        for (const t of tabs) {
          if (t.id !== tabId && t.url && isProcessUrl(t.url)) {
            try { await chrome.tabs.remove(t.id); } catch {}
          }
        }
        processTabId = tabId;
      }
      sendResponse({ ok: true });
      return;
    }

    // ---- Feedback: popup queues one item ----
    if (msg?.type === "FEEDBACK_QUEUED") {
      const entry = msg.payload;
      const count = await enqueueFeedback(entry);

      // Best-effort immediate flush attempt
      try {
        await flushFeedbackToNativeHost([entry]);
        // If flush succeeded, also remove it from outbox (since it’s now sent to file)
        const outbox = await getOutbox();
        const remaining = outbox.filter((x) => x?.id !== entry?.id);
        await setOutbox(remaining);

        sendResponse({ ok: true, queued: count, flushed: true });
      } catch (e) {
        // Keep in outbox for retry
        sendResponse({ ok: true, queued: count, flushed: false, error: String(e?.message || e) });
      }
      return;
    }

    // ---- Feedback: force flush everything queued ----
    if (msg?.type === "FEEDBACK_FLUSH_OUTBOX") {
      try {
        const res = await flushOutboxToNative();
        sendResponse({ ok: true, ...res });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
      return;
    }

    // default
    sendResponse({ ok: false, error: "Unhandled message type" });
  })().catch((e) => {
    console.error("[SW] onMessage handler failed", e);
    sendResponse({ ok: false, error: String(e?.message || e) });
  });

  return true;
});

// Optional: attempt a best-effort flush on extension startup (won’t hurt if it fails)
tryBackgroundFlushBestEffort();

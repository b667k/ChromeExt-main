# Chrome Extension Error Explanations

## Error 1: "Could not establish connection. Receiving end does not exist"

**Location:** chrome-extension://.../serviceWorker.js

**Cause:** The service worker (sw.js) is trying to send messages to the ClaimCenter content script (cc.js), but the content script hasn't been injected yet or is not responding.

**This is EXPECTED and HANDLED** - The service worker has retry logic in the `pingThenRun` function:

```
javascript
// Most common error here: "Could not establish connection. Receiving end does not exist."
consecutiveFailures++;
if (DEBUG) warn("PING failed", { i: i + 1, err: ping.err, consecutive: consecutiveFailures });

// If we have multiple consecutive failures, might be a session reload
// Give the page more time to settle
if (consecutiveFailures >= 3) {
  log("Multiple ping failures - possibly session reload, waiting longer...");
  await sleep(1500); // Extra wait on potential session reload
}
```

This happens when:
- The ClaimCenter tab is still loading (content script hasn't injected yet)
- The user navigates away from ClaimCenter
- The SPA (Single Page Application) hasn't fully initialized the content script
- Session timeout/reload occurred
- The tab was closed

---

## Error 2: "No tab with id: 715071500"

**Cause:** Related to Error #1 - the service worker is trying to communicate with a tab that was closed or no longer exists. This is a side effect of the retry mechanism.

---

## Error 3: "Frame with ID 0 was removed"

**Location:** chrome-extension://.../serviceWorker.js:1

**Cause:** Chrome extension service worker issue related to communication with iframes/frames that have been removed. This can happen when:
- The ClaimCenter page is an SPA that recreates frames during navigation
- The page reloads during session timeout

---

## Error 4: "$ is not defined"

**Location:** ViewItem?viewItemID=56036620&viewItemLinkID=56036620&tabname=work&ItemType=Claims&takeAction=false:155:1

**Cause:** jQuery is not loaded on the Portal page. Looking at portal.js, it doesn't use jQuery - this error is from:
- The Portal website itself expecting jQuery
- Another script on the page that depends on jQuery
- A script that was supposed to be loaded but failed

---

## Error 5: "was preloaded using link preload but not used within a few seconds"

**Cause:** The browser preloaded a resource (likely a script, stylesheet, or image) using `<link rel="preload">` but didn't use it within a few seconds of the page load. This is a performance warning, not an error.

**Fix (if needed):** Ensure preload `as` values are correct and the resource is actually used on initial page load.

---

## Error 6: "loaded over an insecure connection"

**URL:** http://erieweb/UnderwritingPortal/Home/GetScript

**Cause:** Mixed content security warning - the portal is loading scripts over HTTP instead of HTTPS.

**Impact:** This is a security issue. Scripts loaded over HTTP can be intercepted and modified by attackers.

**Fix:** The server configuration needs to serve these scripts over HTTPS, or the extension's host_permissions in manifest.json need to be updated if this is a new endpoint.

---

## Summary

| Error | Type | Cause | Solution |
|-------|------|-------|----------|
| "Could not establish connection" | Expected | Content script not ready | Handled by retry logic |
| "No tab with id" | Expected | Tab closed during retry | Handled by retry logic |
| "Frame with ID 0 removed" | Expected | SPA navigation | Handled by retry logic |
| "$ is not defined" | Page issue | jQuery not loaded | Fix in Portal website |
| "preloaded but not used" | Warning | Resource not used | Check preload usage |
| "insecure connection" | Security | HTTP vs HTTPS | Fix server config |

The "Could not establish connection" errors are **normal behavior** for this extension. The code already handles these scenarios with the retry mechanism in `pingThenRun()` function.

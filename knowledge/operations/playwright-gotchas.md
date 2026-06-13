---
type: Runbook
title: Playwright MCP Gotchas
description: Known flakiness patterns and workarounds for driving the storybook demo via Playwright MCP.
tags: [playwright, testing, mcp, browser-automation, flakiness]
timestamp: 2026-06-13T00:00:00Z
target_url: http://100.104.9.90:8790
---

# Playwright MCP Gotchas

Playing against `http://100.104.9.90:8790` via Playwright MCP. Flaky. Use patterns below.

## Pre-Navigate: Kill Stale Chrome

```powershell
# PowerShell — run BEFORE each browser_navigate call
Get-Process | Where-Object { $_.MainWindowTitle -match 'ms-playwright-mcp' } | Stop-Process -Force
# or
taskkill /F /IM chrome.exe /FI "WINDOWTITLE eq *ms-playwright-mcp*"
```

Stale chrome.exe from prior MCP sessions blocks port/profile -> navigate hangs or returns wrong page.

## Mid-Session Browser Death

Browser dies mid-session (no error, just stops). Fix: re-navigate to last known URL. No state recovery needed if using the fast-walk pattern below.

## Profile Lock: "Browser is already in use"

Symptom: MCP errors with profile lock message.  
Fix: kill all chrome.exe -> retry. Same kill command as above.

## State Does NOT Persist on Fresh Profile

Create-flow state (KidPicker selections, etc.) lives in memory/session only. Fresh profile = blank state. Must re-walk from KidPicker on every new session.

## Fast Walk Pattern (KidPicker -> Station 6 in ONE call)

Instead of sequential MCP tool calls (slow, each is a round-trip), use a single `browser_evaluate` with inline delays:

```javascript
// Single browser_evaluate call
await (async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Click by textContent
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Kid Name');
  btn.click();
  await sleep(400);

  // Set <select> value
  const sel = document.querySelector('select#age-group');
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  nativeSetter.call(sel, '8-10');
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(350);

  // Set <input> value (React/Svelte need native setter + input event)
  const inp = document.querySelector('input#name');
  const inpSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  inpSetter.call(inp, 'Alex');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(400);

  // ... continue through Station 6
})();
```

Delay 350-500ms between steps. Shorter -> framework hasn't re-rendered.

## Images: Invisible to Accessibility Snapshot

Decoration `<img alt="">` = invisible in `browser_snapshot` accessibility tree. Don't use snapshot to verify images.  
Verify via evaluate:

```javascript
const imgs = [...document.querySelectorAll('img')];
const results = imgs.map(img => ({ src: img.src, complete: img.complete, naturalWidth: img.naturalWidth }));
// Pass: complete === true && naturalWidth > 0
```

## Verify Downloads

Monkeypatch before triggering download action:

```javascript
let captured = null;
const orig = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function() {
  captured = { download: this.download, href: this.href };
  // don't call orig — prevents actual browser download dialog
};

// ... trigger download action ...

// Verify
const res = await fetch(captured.href);
const blob = await res.blob();
console.log({ type: blob.type, size: blob.size, filename: captured.download });
// Pass: size > 0, type matches expected (e.g. application/pdf)
```

## Related

- [Run the Demo](/operations/run-the-demo.md)
- [Acceptance Gates](/operations/acceptance-gates.md)
- [Plain HTTP Constraints](/operations/plain-http-constraints.md)

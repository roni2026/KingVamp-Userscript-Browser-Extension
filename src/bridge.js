// KingVamp Bridge v3.0.0 — ISOLATED world content script.
// Jobs:
//  1. Relay GM API calls from page (MAIN world) to the background engine.
//  2. Relay background events (XHR responses, value-change events, menu
//     command triggers) into the page.
//  3. Firefox fallback: execute injected userscript code in the MAIN world
//     via a <script> element (Firefox can't use scripting.executeScript
//     with world:"MAIN" from a background script).
//  4. Hijack clicks on *.user.js links so installs go through KingVamp.

// ── 1+2. Classic message relay ────────────────────────────────────
window.addEventListener('message', async (e) => {
  if (!e.data?.__kv) return;
  const { rid, type, data, scriptId } = e.data;
  try {
    const result = await chrome.runtime.sendMessage({ __kvApi: true, type, data, scriptId });
    const payload = { __kvR: rid };
    if (chrome.runtime.lastError) payload.err = chrome.runtime.lastError.message;
    else { payload.val = result?.val; payload.err = result?.err; }
    window.postMessage(payload, '*');
  } catch (err) {
    window.postMessage({ __kvR: rid, err: err.message }, '*');
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 3. Firefox MAIN-world injection relay
  if (msg?.__kvInject) {
    runInPage(msg.__kvInject.code).then(
      () => sendResponse({ __kvInjectDone: { rid: msg.__kvInject.rid } }),
      (err) => sendResponse({ __kvInjectDone: { rid: msg.__kvInject.rid, err: String(err && err.message || err) } })
    );
    return true;
  }
  // 2. Forward background events into the page
  if (msg.__kvXR !== undefined || msg.__kvVC || msg.__kvCmd || msg.__kvNotif || msg.__kvDL) {
    window.postMessage(msg, '*');
  }
});

function runInPage(code) {
  return new Promise((resolve, reject) => {
    const go = () => {
      try {
        const el = document.createElement('script');
        el.textContent = code;
        el.onload = () => { el.remove(); resolve(); };
        el.onerror = () => { el.remove(); reject(new Error('Script element threw')); };
        (document.head || document.documentElement || document).appendChild(el);
      } catch (e) { reject(e); }
    };
    if (document.documentElement) go();
    else document.addEventListener('DOMContentLoaded', go, { once: true });
  });
}

// ── 4. .user.js link interception (Tampermonkey-style) ───────────
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0) return;
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // bypass: modifier-click opens normally
  const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
  if (!a) return;
  const href = a.href || '';
  if (!/(\.user\.js)([?#]|$)/i.test(href)) return;
  e.preventDefault();
  e.stopPropagation();
  chrome.runtime.sendMessage({ type: 'INSTALL_URL', url: href }).catch(() => {});
}, true);
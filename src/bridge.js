// KingVamp bridge - isolated content script.
// 1) Relays GM API calls between page-world userscripts and the background.
// 2) Applies "hidden element" rules at document_start and keeps them applied.
(function () {
  'use strict';
  const PREFIX = 'kingvamp:';

  // ---------------- GM relay ----------------
  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || typeof d.ch !== 'string' || !d.ch.startsWith(PREFIX) || d.dir !== 'q') return;

    const sid = d.ch.slice(PREFIX.length);
    let result;
    try {
      result = chrome.runtime.sendMessage({
        kv: true, api: d.api, args: d.args || [], sid: sid, pageUrl: location.href
      });
    } catch (e) {
      if (d.id) window.postMessage({ ch: d.ch, dir: 'r', id: d.id, error: String(e && e.message || e) }, '*');
      return;
    }
    if (!d.id) { result.catch(() => {}); return; }
    result.then((res) => {
      if (res && res.error) {
        window.postMessage({ ch: d.ch, dir: 'r', id: d.id, error: res.error }, '*');
      } else {
        window.postMessage({ ch: d.ch, dir: 'r', id: d.id, value: res ? res.value : null }, '*');
      }
    }).catch((err) => {
      window.postMessage({ ch: d.ch, dir: 'r', id: d.id, error: String(err && err.message || err) }, '*');
    });
  });

  // background -> page (menu commands, value sync)
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.kv !== true) return;
    if (msg.api === 'kvMenuRun') {
      window.postMessage({ ch: PREFIX + msg.sid, dir: 'kv-cmd', id: msg.cmdId }, '*');
    } else if (msg.api === 'kvValSync') {
      window.postMessage({ ch: PREFIX + msg.sid, dir: 'kv-sync', changes: msg.changes }, '*');
    }
  });

  // ---------------- hidden element rules ----------------
  let hideRules = [];
  let hideStyle = null;
  let hideObserver = null;

  function ensureHideStyle() {
    if (hideStyle) return hideStyle;
    hideStyle = document.createElement('style');
    hideStyle.id = 'kingvamp-hiderules';
    (document.head || document.documentElement).appendChild(hideStyle);
    return hideStyle;
  }

  function applyHideRules() {
    if (!hideRules.length) return;
    ensureHideStyle().textContent = hideRules.join(',\n') + ' { display: none !important; }';
    // catch elements the site re-creates or that load late
    if (!hideObserver) {
      let scheduled = false;
      hideObserver = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
          scheduled = false;
          for (const sel of hideRules) {
            try {
              document.querySelectorAll(sel).forEach((el) => {
                if (el.style.display !== 'none') el.style.setProperty('display', 'none', 'important');
              });
            } catch (e) {}
          }
        });
      });
      hideObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  async function loadHideRules() {
    try {
      const res = await chrome.runtime.sendMessage({ kv: true, api: 'getHideRules', args: [location.hostname] });
      hideRules = (res && res.value) || [];
      applyHideRules();
    } catch (e) { /* extension context gone */ }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.hiderules) loadHideRules();
  });

  loadHideRules();
})();

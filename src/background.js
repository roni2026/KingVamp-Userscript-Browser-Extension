// KingVamp background service worker - the engine.
// Injects userscripts (CSP-immune), answers GM API calls, logs network
// activity and script logs, manages menu commands, hide-rules, blocklist.
import './match.js';
const KV = globalThis.KVMatch;

const DEFAULT_SETTINGS = { globalEnabled: true, autoUpdate: true, badgeCount: true };

async function getStore(key, def) {
  const o = await chrome.storage.local.get(key);
  return o[key] !== undefined ? o[key] : def;
}
async function getScripts() { return getStore('scripts', {}); }
async function getSettings() { return Object.assign({}, DEFAULT_SETTINGS, await getStore('settings', {})); }

// ---------------------------------------------------------------------------
// MAIN-world bootstrap (serialized into pages; must be self-contained)
// ---------------------------------------------------------------------------
function kingvampBoot(payload) {
  try {
    const s = payload.s;
    const CH = 'kingvamp:' + s.id;
    let seq = 0;
    const pending = new Map();
    const menuCmds = new Map();
    let cmdSeq = 0;
    const valListeners = {};

    window.addEventListener('message', (ev) => {
      if (ev.source !== window) return;
      const d = ev.data;
      if (!d || d.ch !== CH) return;
      if (d.dir === 'r') {
        const p = pending.get(d.id);
        if (!p) return;
        pending.delete(d.id);
        if (d.error) p.rej(new Error(d.error)); else p.res(d.value);
      } else if (d.dir === 'kv-cmd') {
        const f = menuCmds.get(d.id);
        if (f) { try { f(); } catch (e) { console.error('[KingVamp] menu command: ' + (e && e.message || e)); } }
      } else if (d.dir === 'kv-sync') {
        const ch = d.changes || {};
        for (const k of Object.keys(ch)) {
          const old = store[k];
          if (ch[k].n === undefined) delete store[k]; else store[k] = ch[k].n;
          (valListeners[k] || []).slice().forEach((cb) => {
            try { cb(k, old, ch[k].n, true); } catch (e) {}
          });
        }
      }
    });

    function call(api, args) {
      return new Promise((res, rej) => {
        const id = ++seq;
        pending.set(id, { res, rej });
        window.postMessage({ ch: CH, dir: 'q', id: id, api: api, args: args }, '*');
      });
    }
    function fire(api, args) {
      window.postMessage({ ch: CH, dir: 'q', id: 0, api: api, args: args }, '*');
    }

    // ---- network monitor: attribute page requests to this script ----
    function netHit(u) {
      try { fire('netHit', [new URL(u, location.href).hostname]); } catch (e) {}
    }
    try {
      if (!window.__kvNet) window.__kvNet = {};
      if (!window.__kvNet[s.id]) {
        window.__kvNet[s.id] = true;
        const of = window.fetch;
        if (of) {
          window.fetch = function () {
            try { netHit(typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url) || ''); } catch (e) {}
            return of.apply(this, arguments);
          };
        }
        const oo = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (m, u) {
          try { netHit(u); } catch (e) {}
          return oo.apply(this, arguments);
        };
      }
    } catch (e) {}

    // ---- GM value store (preloaded snapshot = synchronous legacy API) ----
    const store = Object.assign({}, payload.values);
    const resources = payload.resources || {};

    const GM = {
      info: { script: { name: s.name, version: s.version }, scriptHandler: 'KingVamp', version: '1.1.0' },
      getValue: (k, d) => (k in store ? store[k] : d),
      setValue: (k, v) => { store[k] = v; call('valueSet', [k, v]).catch(() => {}); },
      deleteValue: (k) => { delete store[k]; call('valueDel', [k]).catch(() => {}); },
      listValues: () => Object.keys(store),
      addValueChangeListener: (key, cb) => {
        (valListeners[key] = valListeners[key] || []).push(cb);
        return cb;
      },
      removeValueChangeListener: (id) => {
        for (const k of Object.keys(valListeners)) {
          const i = valListeners[k].indexOf(id);
          if (i >= 0) valListeners[k].splice(i, 1);
        }
      },
      log: function () {
        fire('log', ['log', Array.from(arguments).map(String).join(' ')]);
      },
      addStyle: (css) => {
        const el = document.createElement('style');
        el.textContent = css;
        (document.head || document.documentElement).appendChild(el);
        return el;
      },
      getResourceText: (n) => (n in resources ? resources[n] : null),
      getResourceURL: (n) => (n in resources ? 'data:text/plain;base64,' + btoa(unescape(encodeURIComponent(resources[n]))) : null),
      openInTab: (url, active) => call('openTab', [url, active !== false]),
      notification: (a, b, c, d) => {
        const o = typeof a === 'object' ? a : { text: a, title: b, image: c, onclick: d };
        return call('notify', [o]);
      },
      setClipboard: (text) => {
        const ta = document.createElement('textarea');
        ta.value = String(text);
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
        document.documentElement.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        ta.remove();
      },
      xmlhttpRequest: (details) => {
        const plain = {};
        for (const k in details) if (typeof details[k] !== 'function') plain[k] = details[k];
        call('xhr', [plain])
          .then((r) => { if (details.onload) details.onload(r); })
          .catch((e) => { if (details.onerror) details.onerror({ error: String(e) }); });
        return { abort: function () {} };
      },
      download: (a, b) => {
        const o = typeof a === 'object' ? a : { url: a, name: b };
        return call('download', [o]);
      },
      registerMenuCommand: (name, fn) => {
        const id = ++cmdSeq;
        menuCmds.set(id, fn);
        fire('menuReg', [s.id + ':' + id, name]);
        return id;
      },
      unregisterMenuCommand: (id) => {
        menuCmds.delete(id);
        fire('menuUnreg', [s.id + ':' + id]);
      }
    };

    const started = performance.now();
    const run = new Function(
      'GM', 'GM_info', 'unsafeWindow',
      'GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues',
      'GM_addValueChangeListener', 'GM_removeValueChangeListener', 'GM_log',
      'GM_addStyle', 'GM_getResourceText', 'GM_getResourceURL',
      'GM_openInTab', 'GM_notification', 'GM_setClipboard',
      'GM_xmlhttpRequest', 'GM_download',
      'GM_registerMenuCommand', 'GM_unregisterMenuCommand',
      '"use strict";\n' + payload.code
    );
    run(
      GM, GM.info, window,
      GM.getValue, GM.setValue, GM.deleteValue, GM.listValues,
      GM.addValueChangeListener, GM.removeValueChangeListener, GM.log,
      GM.addStyle, GM.getResourceText, GM.getResourceURL,
      GM.openInTab, GM.notification, GM.setClipboard,
      GM.xmlhttpRequest, GM.download,
      GM.registerMenuCommand, GM.unregisterMenuCommand
    );
    fire('ran', [Math.round(performance.now() - started)]);
  } catch (e) {
    try {
      console.error('[KingVamp] ' + (payload && payload.s && payload.s.name) + ': ' + (e && e.message || e));
      window.postMessage({ ch: 'kingvamp:' + payload.s.id, dir: 'q', id: 0, api: 'log', args: ['error', String(e && e.stack || e)] }, '*');
    } catch (e2) {}
  }
}
// ---------------------------------------------------------------------------
// Element picker (injected on demand into the active tab, isolated world)
// ---------------------------------------------------------------------------
function kingvampPicker() {
  if (window.__kvPicking) return;
  window.__kvPicking = true;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #e1062c;background:rgba(225,6,44,.15);display:none';
  const tip = document.createElement('div');
  tip.textContent = 'KingVamp: click anything to hide it forever · Esc to cancel';
  tip.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2147483647;background:#0a0a0f;color:#fff;padding:8px 16px;border:1px solid #e1062c;border-radius:0 0 10px 10px;font:13px -apple-system,sans-serif';
  document.documentElement.appendChild(ov);
  document.documentElement.appendChild(tip);
  let cur = null;
  function selectorFor(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let n = el;
    while (n && n !== document.body && n !== document.documentElement && parts.length < 5) {
      let p = n.tagName.toLowerCase();
      if (n.classList && n.classList.length) p += '.' + Array.from(n.classList).slice(0, 2).map((c) => CSS.escape(c)).join('.');
      const sibs = n.parentElement ? Array.from(n.parentElement.children).filter((c) => c.tagName === n.tagName) : [];
      if (sibs.length > 1) p += ':nth-of-type(' + (sibs.indexOf(n) + 1) + ')';
      parts.unshift(p);
      try { if (document.querySelectorAll(parts.join('>')).length === 1) return parts.join('>'); } catch (e) {}
      n = n.parentElement;
    }
    return parts.join('>');
  }
  function move(e) {
    cur = e.target;
    if (!cur || !cur.getBoundingClientRect) return;
    const r = cur.getBoundingClientRect();
    ov.style.display = 'block';
    ov.style.left = r.left + 'px'; ov.style.top = r.top + 'px';
    ov.style.width = r.width + 'px'; ov.style.height = r.height + 'px';
  }
  function key(e) { if (e.key === 'Escape') cleanup(); }
  function click(e) {
    e.preventDefault(); e.stopPropagation();
    const sel = cur ? selectorFor(cur) : null;
    cleanup();
    if (sel) chrome.runtime.sendMessage({ kv: true, api: 'addHideRule', args: [location.hostname, sel] }).catch(() => {});
  }
  function cleanup() {
    ov.remove(); tip.remove();
    window.removeEventListener('mousemove', move, true);
    window.removeEventListener('click', click, true);
    window.removeEventListener('keydown', key, true);
    window.__kvPicking = false;
  }
  window.addEventListener('mousemove', move, true);
  window.addEventListener('click', click, true);
  window.addEventListener('keydown', key, true);
}

// ---------------------------------------------------------------------------
// Injection
// ---------------------------------------------------------------------------
const RUNAT_ORDER = { 'document-start': 0, 'document-end': 1, 'document-ready': 1, 'document-idle': 2 };

async function injectForTab(details, phase) {
  try {
    const settings = await getSettings();
    if (!settings.globalEnabled) return;
    let host = '';
    try { host = new URL(details.url).hostname; } catch (e) { return; }
    const blacklist = await getStore('blacklist', []);
    if (blacklist.includes(host)) return;

    const scripts = await getScripts();
    const list = Object.values(scripts).filter((sc) => {
      if (!sc.enabled) return false;
      if (details.frameId !== 0 && sc.noframes) return false;
      if (!KV.urlMatches(details.url, sc)) return false;
      const want = RUNAT_ORDER[sc.runAt] !== undefined ? RUNAT_ORDER[sc.runAt] : 1;
      return want === phase;
    });
    if (!list.length) return;

    let injected = 0;
    for (const sc of list) {
      try {
        const values = await getStore('val:' + sc.id, {});
        const code = (sc.requireCode ? sc.requireCode + '\n;\n' : '') + sc.code;
        await chrome.scripting.executeScript({
          target: { tabId: details.tabId, frameIds: [details.frameId] },
          world: 'MAIN',
          injectImmediately: true,
          func: kingvampBoot,
          args: [{ s: { id: sc.id, name: sc.name, version: sc.version }, code, values, resources: sc.resources || {} }]
        });
        injected++;
      } catch (e) { /* restricted page or closed tab */ }
    }

    if (injected && details.frameId === 0 && settings.badgeCount) {
      try {
        await chrome.action.setBadgeBackgroundColor({ color: '#e1062c', tabId: details.tabId });
        await chrome.action.setBadgeText({ text: String(injected), tabId: details.tabId });
      } catch (e) {}
    }
  } catch (e) {}
}

chrome.webNavigation.onCommitted.addListener((d) => {
  maybeRedirectToInstaller(d);
  if (d.frameId === 0) clearMenusForTab(d.tabId);
  injectForTab(d, 0);
});
chrome.webNavigation.onDOMContentLoaded.addListener((d) => injectForTab(d, 1));
chrome.webNavigation.onCompleted.addListener((d) => injectForTab(d, 2));

// .user.js install detection - opening a userscript URL shows the installer
function maybeRedirectToInstaller(details) {
  if (details.frameId !== 0) return;
  const url = details.url;
  if (!/\.user\.js([?#]|$)/.test(url)) return;
  if (url.startsWith(chrome.runtime.getURL(''))) return;
  const target = chrome.runtime.getURL('pages/install.html') + '#src=' + encodeURIComponent(url);
  chrome.tabs.update(details.tabId, { url: target }).catch(() => {});
}
// ---------------------------------------------------------------------------
// Menu commands (per-tab, session storage) and script log buffer
// ---------------------------------------------------------------------------
async function getMenus() {
  return (await chrome.storage.session.get('menus')).menus || {};
}
async function clearMenusForTab(tabId) {
  const menus = await getMenus();
  if (menus[tabId]) { delete menus[tabId]; await chrome.storage.session.set({ menus }); }
}
chrome.tabs.onRemoved.addListener((tabId) => clearMenusForTab(tabId));

async function addLog(sid, level, text) {
  const buf = await getStore('logbuf', {});
  const arr = buf[sid] || [];
  arr.push({ t: Date.now(), lvl: level, msg: String(text).slice(0, 500) });
  while (arr.length > 100) arr.shift();
  buf[sid] = arr;
  await chrome.storage.local.set({ logbuf: buf });
}

async function logNet(sid, host) {
  if (!sid || !host) return;
  const log = await getStore('netlog', {});
  const e = log[sid] || { total: 0, domains: {}, lastAt: 0 };
  e.total++;
  e.domains[host] = (e.domains[host] || 0) + 1;
  const keys = Object.keys(e.domains);
  if (keys.length > 200) delete e.domains[keys[0]];
  e.lastAt = Date.now();
  log[sid] = e;
  await chrome.storage.local.set({ netlog: log });
}

// ---------------------------------------------------------------------------
// GM API backend + message router
// ---------------------------------------------------------------------------
async function handleApi(msg, sender) {
  const a = msg.args || [];
  const tabId = sender.tab && sender.tab.id;
  switch (msg.api) {
    case 'valueSet': {
      const key = 'val:' + msg.sid;
      const v = await getStore(key, {});
      v[a[0]] = a[1];
      await chrome.storage.local.set({ [key]: v });
      return null;
    }
    case 'valueDel': {
      const key = 'val:' + msg.sid;
      const v = await getStore(key, {});
      delete v[a[0]];
      await chrome.storage.local.set({ [key]: v });
      return null;
    }
    case 'openTab':
      await chrome.tabs.create({ url: a[0], active: a[1] !== false, openerTabId: tabId });
      return null;
    case 'notify': {
      const o = a[0] || {};
      await chrome.notifications.create({
        type: 'basic', iconUrl: 'icons/icon128.png',
        title: String(o.title || 'KingVamp script'),
        message: String(o.text || o.message || '')
      });
      return null;
    }
    case 'xhr': {
      const d = a[0] || {};
      try { await logNet(msg.sid, new URL(d.url, msg.pageUrl).hostname); } catch (e) {}
      const resp = await fetch(d.url, {
        method: d.method || 'GET',
        headers: d.headers || {},
        body: d.data !== undefined ? d.data : null,
        credentials: d.anonymous ? 'omit' : 'include'
      });
      const text = await resp.text();
      let headers = '';
      resp.headers.forEach((v, k) => { headers += k + ': ' + v + '\r\n'; });
      let parsed = text;
      if (d.responseType === 'json') { try { parsed = JSON.parse(text); } catch (e) {} }
      return { status: resp.status, statusText: resp.statusText, responseHeaders: headers, responseText: text, response: parsed, readyState: 4, finalUrl: resp.url };
    }
    case 'download': {
      const o = a[0] || {};
      await chrome.downloads.download({ url: o.url, filename: o.name || undefined, saveAs: false });
      return null;
    }
    case 'netHit':
      await logNet(msg.sid, a[0]);
      return null;
    case 'log':
      await addLog(msg.sid, a[0] || 'log', a[1] || '');
      return null;
    case 'menuReg': {
      if (tabId == null) return null;
      const menus = await getMenus();
      const forTab = menus[tabId] || {};
      forTab[a[0]] = { sid: msg.sid, name: String(a[1] || 'Command') };
      menus[tabId] = forTab;
      await chrome.storage.session.set({ menus });
      return null;
    }
    case 'menuUnreg': {
      if (tabId == null) return null;
      const menus = await getMenus();
      if (menus[tabId]) { delete menus[tabId][a[0]]; await chrome.storage.session.set({ menus }); }
      return null;
    }
    case 'getMenuCommands': {
      const menus = await getMenus();
      const forTab = menus[a[0]] || {};
      const scripts = await getScripts();
      return Object.entries(forTab).map(([cmdId, m]) => ({
        cmdId, name: m.name, scriptName: scripts[m.sid] ? scripts[m.sid].name : 'Script'
      }));
    }
    case 'runMenuCommand': {
      const menus = await getMenus();
      const m = (menus[a[0]] || {})[a[1]];
      if (!m) return null;
      await chrome.tabs.sendMessage(a[0], { kv: true, api: 'kvMenuRun', sid: m.sid, cmdId: a[1] });
      return null;
    }
    case 'ran': {
      const stats = await getStore('stats', {});
      const st = stats[msg.sid] || { runs: 0, lastRun: 0, totalMs: 0 };
      st.runs++;
      st.lastRun = Date.now();
      st.totalMs += a[0] || 0;
      stats[msg.sid] = st;
      await chrome.storage.local.set({ stats });
      return null;
    }
    case 'getScriptsFor': {
      const scripts = await getScripts();
      const stats = await getStore('stats', {});
      return Object.values(scripts)
        .filter((sc) => KV.urlMatches(a[0], sc))
        .map((sc) => ({ id: sc.id, name: sc.name, version: sc.version, enabled: sc.enabled, runs: (stats[sc.id] || {}).runs || 0 }));
    }
    case 'fetchText': {
      const r = await fetch(a[0]);
      if (!r.ok) throw new Error('Could not download (HTTP ' + r.status + ')');
      return await r.text();
    }
    case 'checkUpdates':
      return await checkUpdates();
    case 'startPicker':
      await chrome.scripting.executeScript({ target: { tabId: a[0] }, func: kingvampPicker });
      return null;
    case 'addHideRule': {
      const rules = await getStore('hiderules', {});
      const arr = rules[a[0]] || [];
      if (!arr.includes(a[1])) arr.push(a[1]);
      rules[a[0]] = arr;
      await chrome.storage.local.set({ hiderules: rules });
      try {
        await chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title: 'KingVamp', message: 'Hidden on ' + a[0] + '. Manage it in Dashboard → Tools.' });
      } catch (e) {}
      return null;
    }
    case 'getHideRules': {
      const rules = await getStore('hiderules', {});
      return rules[a[0]] || [];
    }
    case 'removeHideRule': {
      const rules = await getStore('hiderules', {});
      rules[a[0]] = (rules[a[0]] || []).filter((x) => x !== a[1]);
      if (!rules[a[0]].length) delete rules[a[0]];
      await chrome.storage.local.set({ hiderules: rules });
      return null;
    }
    case 'getBlacklist':
      return await getStore('blacklist', []);
    case 'setBlacklisted': {
      const list = await getStore('blacklist', []);
      const host = a[0], blocked = a[1];
      const next = blocked ? [...new Set(list.concat([host]))] : list.filter((h) => h !== host);
      await chrome.storage.local.set({ blacklist: next });
      return next;
    }
    default:
      throw new Error('Unknown API: ' + msg.api);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.kv !== true) return;
  handleApi(msg, sender)
    .then((value) => sendResponse({ value: value === undefined ? null : value }))
    .catch((e) => sendResponse({ error: String(e && e.message || e) }));
  return true;
});
// ---------------------------------------------------------------------------
// Cross-tab GM value sync (GM_addValueChangeListener)
// ---------------------------------------------------------------------------
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) setupAlarm();
  for (const key of Object.keys(changes)) {
    if (!key.startsWith('val:')) continue;
    const sid = key.slice(4);
    const nv = changes[key].newValue || {}, ov = changes[key].oldValue || {};
    const diff = {};
    for (const k of new Set(Object.keys(nv).concat(Object.keys(ov)))) diff[k] = { o: ov[k], n: nv[k] };
    chrome.tabs.query({}).then((tabs) => {
      for (const t of tabs) {
        chrome.tabs.sendMessage(t.id, { kv: true, api: 'kvValSync', sid, changes: diff }).catch(() => {});
      }
    }).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Update checker (@updateURL / @downloadURL, version compare)
// ---------------------------------------------------------------------------
async function checkUpdates() {
  const scripts = await getScripts();
  const result = { checked: 0, updated: [], failed: [] };
  for (const sc of Object.values(scripts)) {
    const metaUrl = sc.updateURL || sc.downloadURL;
    if (!metaUrl) continue;
    result.checked++;
    try {
      const metaCode = await (await fetch(metaUrl)).text();
      const meta = KV.parseMetadata(metaCode);
      if (meta.version && KV.semverGt(meta.version, sc.version)) {
        const fullCode = sc.downloadURL ? await (await fetch(sc.downloadURL)).text() : metaCode;
        const full = KV.parseMetadata(fullCode);
        sc.code = fullCode;
        sc.version = full.version || meta.version;
        sc.updatedAt = Date.now();
        result.updated.push(sc.name);
      }
    } catch (e) {
      result.failed.push(sc.name);
    }
  }
  await chrome.storage.local.set({ scripts });
  return result;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'kv-update') checkUpdates().catch(() => {});
});

async function setupAlarm() {
  const settings = await getSettings();
  if (settings.autoUpdate) chrome.alarms.create('kv-update', { periodInMinutes: 720 });
  else chrome.alarms.clear('kv-update');
}
setupAlarm();

// Keyboard shortcut (Cmd/Ctrl+Shift+K) opens the dashboard.
chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === 'open-dashboard') chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard.html') });
});

// Open the dashboard on first install.
chrome.runtime.onInstalled.addListener((d) => {
  if (d.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard.html') });
});

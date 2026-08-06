// KingVamp dashboard - scripts, privacy guard, console logs, tools, AI writer.
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const KV = window.KVMatch;

  function send(msg) {
    return chrome.runtime.sendMessage(Object.assign({ kv: true }, msg)).then((r) => {
      if (r && r.error) throw new Error(r.error);
      return r && r.value;
    });
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ago = (t) => {
    if (!t) return 'never';
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  };

  // ---------------- tabs ----------------
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
    $$('main > section').forEach((sec) => sec.classList.toggle('hidden', sec.id !== 'tab-' + t.dataset.tab));
    if (t.dataset.tab === 'privacy') renderPrivacy();
    if (t.dataset.tab === 'logs') renderLogs();
    if (t.dataset.tab === 'tools') renderTools();
  }));

  // ---------------- settings ----------------
  async function loadSettings() {
    const s = Object.assign({ globalEnabled: true, autoUpdate: true, badgeCount: true }, (await chrome.storage.local.get('settings')).settings || {});
    $('#globalToggle').checked = s.globalEnabled;
    $('#freezeLabel').textContent = s.globalEnabled ? 'Active' : 'Frozen';
    $('#setGlobal').checked = s.globalEnabled;
    $('#setAutoUpdate').checked = s.autoUpdate;
    $('#setBadge').checked = s.badgeCount;
    return s;
  }
  async function saveSettings(patch) {
    const s = Object.assign({ globalEnabled: true, autoUpdate: true, badgeCount: true }, (await chrome.storage.local.get('settings')).settings || {});
    Object.assign(s, patch);
    await chrome.storage.local.set({ settings: s });
    loadSettings();
  }
  $('#globalToggle').addEventListener('change', (e) => saveSettings({ globalEnabled: e.target.checked }));
  $('#setGlobal').addEventListener('change', (e) => saveSettings({ globalEnabled: e.target.checked }));
  $('#setAutoUpdate').addEventListener('change', (e) => saveSettings({ autoUpdate: e.target.checked }));
  $('#setBadge').addEventListener('change', (e) => saveSettings({ badgeCount: e.target.checked }));

  // ---------------- scripts list + filter row ----------------
  async function loadFilters() {
    const f = (await chrome.storage.local.get('filters')).filters || {};
    if (f.q) $('#search').value = f.q;
    if (f.site) $('#siteFilter').value = f.site;
    if (f.status) $('#statusFilter').value = f.status;
    if (f.sort) $('#sortBy').value = f.sort;
  }
  function saveFilters() {
    chrome.storage.local.set({
      filters: {
        q: $('#search').value,
        site: $('#siteFilter').value,
        status: $('#statusFilter').value,
        sort: $('#sortBy').value
      }
    });
  }

  async function renderScripts() {
    const data = await chrome.storage.local.get(['scripts', 'stats']);
    const scripts = Object.values(data.scripts || {});
    const stats = data.stats || {};
    const q = ($('#search').value || '').toLowerCase();
    const siteQ = ($('#siteFilter').value || '').toLowerCase();
    const status = $('#statusFilter').value;
    const sortBy = $('#sortBy').value;
    const list = $('#scriptList');
    list.innerHTML = '';

    const shown = scripts.filter((s) => {
      if (q && !(s.name || '').toLowerCase().includes(q) && !(s.description || '').toLowerCase().includes(q)) return false;
      if (status === 'enabled' && !s.enabled) return false;
      if (status === 'disabled' && s.enabled) return false;
      if (siteQ) {
        const sites = (s.matches || []).concat(s.includes || []).join(' ').toLowerCase();
        if (!sites.includes(siteQ)) return false;
      }
      return true;
    });

    if (sortBy === 'updated') shown.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    else if (sortBy === 'lastrun') shown.sort((a, b) => ((stats[b.id] || {}).lastRun || 0) - ((stats[a.id] || {}).lastRun || 0));
    else if (sortBy === 'runs') shown.sort((a, b) => ((stats[b.id] || {}).runs || 0) - ((stats[a.id] || {}).runs || 0));
    else shown.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    $('#filterCount').textContent = scripts.length
      ? 'Showing ' + shown.length + ' of ' + scripts.length + ' script' + (scripts.length === 1 ? '' : 's')
      : '';

    if (!scripts.length) {
      list.innerHTML = '<div class="empty-state"><h2>No scripts yet</h2><p>Try a ready-made recipe in the Tools tab, let the AI Script Writer build one, or install any .user.js from the web.</p></div>';
      return;
    }
    if (!shown.length) {
      list.innerHTML = '<div class="empty-state"><p>No scripts match your filters.</p></div>';
      return;
    }

    for (const sc of shown) {
      const st = stats[sc.id] || {};
      const avg = st.runs ? Math.round((st.totalMs || 0) / st.runs) : 0;
      const card = document.createElement('div');
      card.className = 'script-card' + (sc.enabled ? '' : ' disabled');
      const sites = (sc.matches || []).concat(sc.includes || []).slice(0, 3);
      card.innerHTML =
        '<span class="switch"><input type="checkbox" ' + (sc.enabled ? 'checked' : '') + '><span class="track"></span></span>' +
        '<div class="grow"><h3>' + esc(sc.name || 'Unnamed script') + ' <span class="tag">v' + esc(sc.version || '?') + '</span></h3>' +
        '<div class="meta">' + esc(sc.description || '') + '</div>' +
        '<div class="meta">' + sites.map((s) => '<span class="tag">' + esc(s) + '</span>').join('') +
        ' &middot; ran ' + (st.runs || 0) + 'x' + (st.runs ? ' &middot; avg ' + avg + 'ms' : '') +
        ' &middot; last ' + ago(st.lastRun) + '</div></div>' +
        '<div class="btns">' +
        '<button class="btn small" data-act="edit">Edit</button>' +
        (sc.downloadURL || sc.updateURL ? '<button class="btn small" data-act="update">Update</button>' : '') +
        '<button class="btn small danger" data-act="del">Delete</button></div>';

      card.querySelector('input[type=checkbox]').addEventListener('change', async (e) => {
        const all = (await chrome.storage.local.get('scripts')).scripts || {};
        if (all[sc.id]) { all[sc.id].enabled = e.target.checked; await chrome.storage.local.set({ scripts: all }); }
        renderScripts();
      });
      card.querySelector('[data-act=edit]').addEventListener('click', () => { location.href = 'editor.html#id=' + sc.id; });
      const upd = card.querySelector('[data-act=update]');
      if (upd) upd.addEventListener('click', async () => {
        upd.disabled = true; upd.textContent = '...';
        try { await send({ api: 'checkUpdates', args: [] }); } catch (e) {}
        renderScripts();
      });
      card.querySelector('[data-act=del]').addEventListener('click', async () => {
        if (!confirm('Delete "' + (sc.name || 'this script') + '"? This cannot be undone.')) return;
        const all = (await chrome.storage.local.get('scripts')).scripts || {};
        delete all[sc.id];
        await chrome.storage.local.set({ scripts: all });
        renderScripts();
      });
      list.appendChild(card);
    }
  }
  $('#search').addEventListener('input', () => { saveFilters(); renderScripts(); });
  $('#siteFilter').addEventListener('input', () => { saveFilters(); renderScripts(); });
  $('#statusFilter').addEventListener('change', () => { saveFilters(); renderScripts(); });
  $('#sortBy').addEventListener('change', () => { saveFilters(); renderScripts(); });
  $('#btnNew').addEventListener('click', () => { location.href = 'editor.html#new='; });

  // ---------------- import / export ----------------
  async function fetchRequires(meta) {
    let code = '';
    const resources = {};
    for (const url of meta.require || []) {
      try { code += '\n;// @require ' + url + '\n' + (await send({ api: 'fetchText', args: [url] })); } catch (e) {}
    }
    for (const r of meta.resource || []) {
      try { resources[r.name] = await send({ api: 'fetchText', args: [r.url] }); } catch (e) {}
    }
    return { code, resources };
  }

  async function saveScriptCode(code, sourceUrl) {
    const meta = KV.parseMetadata(code);
    if (!meta.name) throw new Error('No ==UserScript== block found in file');
    const all = (await chrome.storage.local.get('scripts')).scripts || {};
    const existing = Object.values(all).find((s) => s.namespace && s.namespace === meta.namespace && s.name === meta.name);
    const id = existing ? existing.id : (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    const requires = await fetchRequires(meta);
    all[id] = {
      id, name: meta.name, namespace: meta.namespace, version: meta.version || '1.0',
      description: meta.description, author: meta.author,
      matches: meta.matches, includes: meta.includes, excludes: meta.excludes,
      grants: meta.grants, runAt: meta.runAt || 'document-end', noframes: meta.noframes,
      updateURL: meta.updateURL, downloadURL: meta.downloadURL || sourceUrl || '',
      require: meta.require, requireCode: requires.code, resources: requires.resources,
      enabled: true, code, sourceUrl: sourceUrl || '',
      createdAt: existing ? existing.createdAt : Date.now(), updatedAt: Date.now()
    };
    await chrome.storage.local.set({ scripts: all });
  }

  $('#btnImport').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    let count = 0, failed = 0;
    for (const f of files) {
      try {
        if (/\.zip$/i.test(f.name)) {
          const zip = await JSZip.loadAsync(f);
          for (const name of Object.keys(zip.files)) {
            if (/\.user\.js$/i.test(name)) {
              try { await saveScriptCode(await zip.files[name].async('string'), ''); count++; } catch (e2) { failed++; }
            }
          }
        } else {
          await saveScriptCode(await f.text(), '');
          count++;
        }
      } catch (e2) { failed++; }
    }
    alert('Import finished: ' + count + ' script(s) added' + (failed ? ', ' + failed + ' skipped' : '') + '.');
    e.target.value = '';
    renderScripts();
  });

  $('#btnExport').addEventListener('click', async () => {
    const scripts = Object.values((await chrome.storage.local.get('scripts')).scripts || {});
    if (!scripts.length) { alert('Nothing to export yet.'); return; }
    const zip = new JSZip();
    for (const sc of scripts) zip.file((sc.name || 'script').replace(/[^\w.-]+/g, '_') + '.user.js', sc.code);
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'kingvamp-backup.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  $('#btnUpdates').addEventListener('click', async () => {
    const b = $('#btnUpdates');
    b.disabled = true; b.textContent = 'Checking...';
    try {
      const r = await send({ api: 'checkUpdates', args: [] });
      alert('Checked ' + r.checked + ' script(s). ' +
        (r.updated.length ? 'Updated: ' + r.updated.join(', ') : 'Everything is up to date.') +
        (r.failed.length ? ' Failed: ' + r.failed.join(', ') : ''));
    } catch (e) { alert('Update check failed: ' + e.message); }
    b.disabled = false; b.textContent = 'Check updates';
    renderScripts();
  });

  // ---------------- privacy guard ----------------
  async function renderPrivacy() {
    const data = await chrome.storage.local.get(['netlog', 'scripts']);
    const log = data.netlog || {};
    const scripts = data.scripts || {};
    const box = $('#netTable');
    const ids = Object.keys(log).filter((id) => log[id].total > 0);
    if (!ids.length) {
      box.innerHTML = '<div class="empty-state"><p>No network activity recorded yet.<br>When any script talks to the internet, you will see exactly where it went, right here.</p></div>';
      return;
    }
    let html = '<table><tr><th>Script</th><th>Servers contacted</th><th>Requests</th><th>Last activity</th></tr>';
    for (const id of ids.sort((a, b) => log[b].lastAt - log[a].lastAt)) {
      const e = log[id];
      const name = scripts[id] ? scripts[id].name : '(deleted script)';
      const domains = Object.entries(e.domains).sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([d, n]) => '<span class="tag">' + esc(d) + ' &times;' + n + '</span>').join(' ');
      html += '<tr><td><b>' + esc(name) + '</b></td><td>' + domains + '</td><td>' + e.total + '</td><td>' + ago(e.lastAt) + '</td></tr>';
    }
    box.innerHTML = html + '</table>';
  }
  $('#btnClearLog').addEventListener('click', async () => {
    await chrome.storage.local.set({ netlog: {} });
    renderPrivacy();
  });
  // ---------------- console logs ----------------
  async function renderLogs() {
    const data = await chrome.storage.local.get(['logbuf', 'scripts']);
    const buf = data.logbuf || {};
    const scripts = data.scripts || {};
    const box = $('#logView');
    const ids = Object.keys(buf).filter((id) => buf[id].length);
    if (!ids.length) {
      box.innerHTML = '<div class="empty-state"><p>Nothing here yet.<br>When scripts log messages or hit errors, they show up here.</p></div>';
      return;
    }
    box.innerHTML = '';
    for (const id of ids) {
      const name = scripts[id] ? scripts[id].name : '(deleted script)';
      const group = document.createElement('div');
      group.className = 'log-group';
      group.innerHTML = '<h3>' + esc(name) + '</h3>';
      for (const e of buf[id].slice(-30).reverse()) {
        const line = document.createElement('div');
        line.className = 'log-line' + (e.lvl === 'error' ? ' error' : '');
        line.innerHTML = '<span class="t">' + new Date(e.t).toLocaleTimeString() + '</span><span class="m"></span>';
        line.querySelector('.m').textContent = e.msg;
        group.appendChild(line);
      }
      box.appendChild(group);
    }
  }
  $('#btnClearLogs').addEventListener('click', async () => {
    await chrome.storage.local.set({ logbuf: {} });
    renderLogs();
  });

  // ---------------- tools: recipes ----------------
  const RECIPES = [
    {
      slug: 'dark-mode', name: 'Dark mode everywhere',
      desc: 'Gives every site a dark look. Easy on the eyes at night.',
      code: [
        '// ==UserScript==',
        '// @name         Dark mode everywhere',
        '// @namespace    kingvamp.recipe.dark-mode',
        '// @version      1.0',
        '// @description  Gives every site a dark look.',
        '// @match        *://*/*',
        '// @grant        GM_addStyle',
        '// @run-at       document-start',
        '// ==/UserScript==',
        "GM_addStyle('html { filter: invert(0.92) hue-rotate(180deg) !important; background: #111 !important; } img, video, iframe, [style*=background-image] { filter: invert(1) hue-rotate(180deg) !important; }');"
      ].join('\n')
    },
    {
      slug: 'allow-copy', name: 'Allow copy, select & right-click',
      desc: 'Stops sites from blocking text selection, copying and the right-click menu.',
      code: [
        '// ==UserScript==',
        '// @name         Allow copy, select & right-click',
        '// @namespace    kingvamp.recipe.allow-copy',
        '// @version      1.0',
        '// @description  Re-enables text selection, copying and right-click everywhere.',
        '// @match        *://*/*',
        '// @grant        GM_addStyle',
        '// @run-at       document-start',
        '// ==/UserScript==',
        "GM_addStyle('* { -webkit-user-select: text !important; user-select: text !important; }');",
        "['contextmenu','copy','cut','selectstart'].forEach(function(ev){",
        "  window.addEventListener(ev, function(e){ e.stopImmediatePropagation(); }, true);",
        "});"
      ].join('\n')
    },
    {
      slug: 'video-speed', name: 'Video speed keys',
      desc: 'Press [ and ] to slow down or speed up any video, D resets to normal.',
      code: [
        '// ==UserScript==',
        '// @name         Video speed keys',
        '// @namespace    kingvamp.recipe.video-speed',
        '// @version      1.0',
        '// @description  [ slows down, ] speeds up, D resets video speed.',
        '// @match        *://*/*',
        '// @grant        none',
        '// @run-at       document-end',
        '// ==/UserScript==',
        "document.addEventListener('keydown', function(e){",
        "  if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;",
        "  var v = document.querySelector('video');",
        "  if (!v) return;",
        "  if (e.key === ']') v.playbackRate = Math.min(4, v.playbackRate + 0.25);",
        "  if (e.key === '[') v.playbackRate = Math.max(0.25, v.playbackRate - 0.25);",
        "  if (e.key.toLowerCase() === 'd') v.playbackRate = 1;",
        "});"
      ].join('\n')
    },
    {
      slug: 'no-leave-popup', name: 'No "are you sure you want to leave" popups',
      desc: 'Blocks those annoying dialogs when closing a tab.',
      code: [
        '// ==UserScript==',
        '// @name         No leave-confirmation popups',
        '// @namespace    kingvamp.recipe.no-leave-popup',
        '// @version      1.0',
        '// @description  Blocks are-you-sure-you-want-to-leave dialogs.',
        '// @match        *://*/*',
        '// @grant        none',
        '// @run-at       document-start',
        '// ==/UserScript==',
        "window.addEventListener('beforeunload', function(e){",
        "  e.stopImmediatePropagation();",
        "  delete e.returnValue;",
        "}, true);"
      ].join('\n')
    },
    {
      slug: 'auto-scroll', name: 'Auto-scroll (hands-free reading)',
      desc: 'Press A to start/stop slow automatic scrolling. Shift+A scrolls faster.',
      code: [
        '// ==UserScript==',
        '// @name         Auto-scroll',
        '// @namespace    kingvamp.recipe.auto-scroll',
        '// @version      1.0',
        '// @description  Press A to toggle auto-scroll, Shift+A for faster.',
        '// @match        *://*/*',
        '// @grant        none',
        '// @run-at       document-end',
        '// ==/UserScript==',
        "var timer = null, speed = 1;",
        "document.addEventListener('keydown', function(e){",
        "  if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;",
        "  if (e.key.toLowerCase() !== 'a') return;",
        "  if (timer) { clearInterval(timer); timer = null; return; }",
        "  speed = e.shiftKey ? 4 : 1;",
        "  timer = setInterval(function(){ window.scrollBy(0, speed); }, 30);",
        "});"
      ].join('\n')
    }
  ];

  async function renderTools() {
    const all = Object.values((await chrome.storage.local.get('scripts')).scripts || {});
    const box = $('#recipes');
    box.innerHTML = '';
    for (const r of RECIPES) {
      const added = all.some((s) => s.namespace === 'kingvamp.recipe.' + r.slug);
      const div = document.createElement('div');
      div.className = 'recipe';
      div.innerHTML = '<div class="grow"><b>' + esc(r.name) + '</b><div class="desc">' + esc(r.desc) + '</div></div>';
      const btn = document.createElement('button');
      btn.className = 'btn small' + (added ? '' : ' primary');
      btn.textContent = added ? 'Added' : 'Add';
      btn.disabled = added;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try { await saveScriptCode(r.code, ''); } catch (e) {}
        renderTools();
        renderScripts();
      });
      div.appendChild(btn);
      box.appendChild(div);
    }

    // hidden elements
    const rules = (await chrome.storage.local.get('hiderules')).hiderules || {};
    const hl = $('#hideList');
    const hosts = Object.keys(rules);
    hl.innerHTML = hosts.length ? '' : '<span class="muted">Nothing hidden yet. Use "Hide an element" from the KingVamp toolbar popup on any page.</span>';
    for (const hostName of hosts) {
      const div = document.createElement('div');
      div.className = 'host-block';
      div.innerHTML = '<h4>' + esc(hostName) + '</h4>';
      for (const sel of rules[hostName]) {
        const chip = document.createElement('span');
        chip.className = 'sel-chip';
        chip.textContent = sel.length > 60 ? sel.slice(0, 60) + '...' : sel;
        const x = document.createElement('button');
        x.textContent = 'x';
        x.title = 'Unhide this element';
        x.addEventListener('click', async () => {
          await send({ api: 'removeHideRule', args: [hostName, sel] });
          renderTools();
        });
        chip.appendChild(x);
        div.appendChild(chip);
      }
      hl.appendChild(div);
    }

    renderBlocklist();
  }

  // ---------------- tools: blocklist ----------------
  async function renderBlocklist() {
    const list = await send({ api: 'getBlacklist', args: [] });
    const bl = $('#blockList');
    bl.innerHTML = (list && list.length) ? '' : '<span class="muted">No blocked sites.</span>';
    for (const hostName of list || []) {
      const chip = document.createElement('span');
      chip.className = 'sel-chip';
      chip.textContent = hostName;
      const x = document.createElement('button');
      x.textContent = 'x';
      x.title = 'Unblock this site';
      x.addEventListener('click', async () => {
        await send({ api: 'setBlacklisted', args: [hostName, false] });
        renderBlocklist();
      });
      chip.appendChild(x);
      bl.appendChild(chip);
    }
  }
  $('#btnBlock').addEventListener('click', async () => {
    const hostName = $('#blockInput').value.trim().toLowerCase();
    if (!hostName) return;
    await send({ api: 'setBlacklisted', args: [hostName, true] });
    $('#blockInput').value = '';
    renderBlocklist();
  });

  // ---------------- AI writer ----------------
  $('#btnAi').addEventListener('click', async () => {
    const prompt = $('#aiPrompt').value.trim();
    const status = $('#aiStatus');
    if (!prompt) { status.textContent = 'Describe what the script should do first.'; return; }
    const btn = $('#btnAi');
    btn.disabled = true;
    status.textContent = 'Writing your script...';
    try {
      const resp = await fetch(window.ADEMI_AI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + window.ADEMI_AI_KEY },
        body: JSON.stringify({
          model: window.ADEMI_AI_MODEL,
          messages: [
            { role: 'system', content: 'You are KingVamp, a userscript generator. Reply with ONLY a complete userscript: a ==UserScript== block (with @name, @namespace, @version, @description, @match, @grant, @run-at) followed by clean working JavaScript. No markdown fences, no explanations, just the script.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.4
        })
      });
      if (resp.status === 402 || resp.status === 403) {
        status.textContent = 'The AI wallet for this app is out of tokens or paused. You can top it up from the AI wallet in Ademi.';
        return;
      }
      if (!resp.ok) throw new Error('AI request failed (HTTP ' + resp.status + ')');
      const data = await resp.json();
      let code = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();
      code = code.replace(/^```(?:javascript|js)?\s*/i, '').replace(/```\s*$/, '').trim();
      if (!/==UserScript==/.test(code)) throw new Error('The AI did not return a valid userscript. Try rephrasing.');
      await chrome.storage.local.set({ 'kv:draft': code });
      status.textContent = 'Done - opening in the editor for your review.';
      location.href = 'editor.html#draft';
    } catch (e) {
      status.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  });

  // ---------------- storage usage ----------------
  if (chrome.storage.local.getBytesInUse) {
    chrome.storage.local.getBytesInUse(null, (b) => {
      $('#storageUsed').textContent = (b / 1024).toFixed(1) + ' KB used by scripts, values and logs';
    });
  }

  loadSettings();
  loadFilters().then(renderScripts);
})();

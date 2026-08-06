// KingVamp editor - CodeMirror editor, safety scan, per-script settings.
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const KV = window.KVMatch;

  function send(msg) {
    return chrome.runtime.sendMessage(Object.assign({ kv: true }, msg)).then((r) => {
      if (r && r.error) throw new Error(r.error);
      return r && r.value;
    });
  }

  const TEMPLATE = (match) => `// ==UserScript==
// @name         My KingVamp script
// @namespace    kingvamp.local
// @version      1.0
// @description  What this script does
// @author       You
// @match        ${match || '*://*/*'}
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';
  // Your code here. Example:
  // document.body.style.border = '3px solid #e1062c';
})();
`;

  const cm = CodeMirror.fromTextArea($('#code'), {
    mode: 'javascript',
    theme: 'dracula',
    lineNumbers: true,
    indentUnit: 2,
    tabSize: 2,
    lineWrapping: false,
    autofocus: true
  });

  let scriptId = null;

  async function load() {
    const hash = location.hash || '';
    if (hash.startsWith('#id=')) {
      scriptId = hash.slice(4);
      const all = (await chrome.storage.local.get('scripts')).scripts || {};
      const sc = all[scriptId];
      if (sc) {
        cm.setValue(sc.code);
        $('#edTitle').textContent = sc.name || 'Edit script';
        $('#userIncludes').value = (sc.userIncludes || []).join('\n');
        $('#userExcludes').value = (sc.userExcludes || []).join('\n');
        const vals = (await chrome.storage.local.get('val:' + scriptId))['val:' + scriptId] || {};
        $('#valuesJson').value = JSON.stringify(vals, null, 2);
        return;
      }
    }
    if (hash === '#draft') {
      const d = await chrome.storage.local.get('kv:draft');
      if (d['kv:draft']) {
        cm.setValue(d['kv:draft']);
        await chrome.storage.local.remove('kv:draft');
        $('#edTitle').textContent = 'AI draft - review before saving';
        return;
      }
    }
    if (hash.startsWith('#new=')) {
      cm.setValue(TEMPLATE(decodeURIComponent(hash.slice(5))));
      return;
    }
    cm.setValue(TEMPLATE('*://*/*'));
  }

  function renderAudit(findings) {
    const box = $('#auditPanel');
    box.innerHTML = '<b style="font-size:12px">Safety scan:</b>';
    for (const f of findings) {
      const div = document.createElement('div');
      div.className = 'finding ' + f.level;
      div.innerHTML = '<span class="dot"></span><div><b>' + f.title + '</b><p>' + f.detail + '</p></div>';
      box.appendChild(div);
    }
  }

  async function save(closeAfter) {
    const code = cm.getValue();
    const meta = KV.parseMetadata(code);
    if (!meta.name) { alert('Your script needs a ==UserScript== block with at least @name and @match.'); return; }
    if (!meta.matches.length && !meta.includes.length) { alert('Add at least one @match or @include so KingVamp knows where to run it.'); return; }

    $('#btnSave').disabled = true;
    try {
      let requireCode = '';
      const resources = {};
      for (const url of meta.require || []) {
        try { requireCode += '\n;// @require ' + url + '\n' + (await send({ api: 'fetchText', args: [url] })); } catch (e) {}
      }
      for (const r of meta.resource || []) {
        try { resources[r.name] = await send({ api: 'fetchText', args: [r.url] }); } catch (e) {}
      }

      const all = (await chrome.storage.local.get('scripts')).scripts || {};
      const existing = scriptId ? all[scriptId] : Object.values(all).find((s) => s.namespace && s.namespace === meta.namespace && s.name === meta.name);
      const id = existing ? existing.id : (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
      all[id] = {
        id, name: meta.name, namespace: meta.namespace, version: meta.version || '1.0',
        description: meta.description, author: meta.author,
        matches: meta.matches, includes: meta.includes, excludes: meta.excludes,
        grants: meta.grants, runAt: meta.runAt || 'document-end', noframes: meta.noframes,
        updateURL: meta.updateURL, downloadURL: meta.downloadURL,
        require: meta.require, requireCode, resources,
        userIncludes: existing ? existing.userIncludes || [] : [],
        userExcludes: existing ? existing.userExcludes || [] : [],
        enabled: existing ? existing.enabled : true, code,
        sourceUrl: existing ? existing.sourceUrl || '' : '',
        createdAt: existing ? existing.createdAt : Date.now(), updatedAt: Date.now()
      };
      await chrome.storage.local.set({ scripts: all });
      scriptId = id;
      $('#edTitle').textContent = meta.name;
      $('#savedNote').textContent = 'Saved ' + new Date().toLocaleTimeString();
      setTimeout(() => { $('#savedNote').textContent = ''; }, 3000);
      renderAudit(window.KVAudit.audit(code));
      if (closeAfter) window.close();
    } finally {
      $('#btnSave').disabled = false;
    }
  }

  // settings panel
  $('#btnSettings').addEventListener('click', () => {
    document.body.classList.toggle('settings-open');
  });
  $('#btnSaveSettings').addEventListener('click', async () => {
    const note = $('#settingsNote');
    if (!scriptId) { note.textContent = 'Save the script first, then adjust settings.'; return; }
    const lines = (v) => v.split('\n').map((s) => s.trim()).filter(Boolean);
    let vals = {};
    const rawVals = $('#valuesJson').value.trim();
    if (rawVals) {
      try { vals = JSON.parse(rawVals); }
      catch (e) { note.textContent = 'Stored data is not valid JSON - fix it and try again.'; return; }
    }
    const all = (await chrome.storage.local.get('scripts')).scripts || {};
    if (all[scriptId]) {
      all[scriptId].userIncludes = lines($('#userIncludes').value);
      all[scriptId].userExcludes = lines($('#userExcludes').value);
      await chrome.storage.local.set({ scripts: all, ['val:' + scriptId]: vals });
      note.textContent = 'Settings saved.';
      setTimeout(() => { note.textContent = ''; }, 2500);
    }
  });

  $('#btnSave').addEventListener('click', () => save(false));
  $('#btnCancel').addEventListener('click', () => window.close());
  $('#btnDelete').addEventListener('click', async () => {
    if (!scriptId) { window.close(); return; }
    if (!confirm('Delete this script? This cannot be undone.')) return;
    const all = (await chrome.storage.local.get('scripts')).scripts || {};
    delete all[scriptId];
    await chrome.storage.local.set({ scripts: all });
    location.href = 'dashboard.html';
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(false); }
  });

  load();
})();

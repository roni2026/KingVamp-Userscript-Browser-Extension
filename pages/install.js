// KingVamp installer - fetches a .user.js, scans it, and installs on approval.
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const KV = window.KVMatch;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function send(msg) {
    return chrome.runtime.sendMessage(Object.assign({ kv: true }, msg)).then((r) => {
      if (r && r.error) throw new Error(r.error);
      return r && r.value;
    });
  }

  async function boot() {
    const main = $('#main');
    const hash = location.hash || '';
    if (!hash.startsWith('#src=')) {
      main.innerHTML = '<div class="err">No script URL given.</div>';
      return;
    }
    const src = decodeURIComponent(hash.slice(5));
    let code;
    try {
      code = await send({ api: 'fetchText', args: [src] });
    } catch (e) {
      main.innerHTML = '<div class="err">Could not download the script:<br>' + esc(e.message) + '</div>';
      return;
    }
    const meta = KV.parseMetadata(code);
    if (!meta.name) {
      main.innerHTML = '<div class="err">This file has no ==UserScript== block, so it is not a userscript.</div>';
      return;
    }
    const findings = window.KVAudit.audit(code);
    const worst = findings.some((f) => f.level === 'risk') ? 'risk' : findings.some((f) => f.level === 'warn') ? 'warn' : 'ok';

    main.innerHTML =
      '<h1>' + esc(meta.name) + ' <span class="tag">v' + esc(meta.version || '?') + '</span></h1>' +
      '<div class="sub">' + esc(meta.description || 'No description') +
      (meta.author ? ' &middot; by ' + esc(meta.author) : '') + '<br>from ' + esc(src) + '</div>' +
      '<div class="grid"><div class="panel"><b>Runs on</b><div style="margin:8px 0">' +
      (meta.matches.concat(meta.includes).map((m) => '<span class="tag">' + esc(m) + '</span>').join('') || '<span class="muted">nowhere (no @match)</span>') +
      '</div><b>KingVamp safety check</b><div id="findings"></div></div>' +
      '<div><b>Source code</b><pre class="code">' + esc(code.slice(0, 20000)) + (code.length > 20000 ? '\n... (truncated preview)' : '') + '</pre></div></div>' +
      '<div class="actions">' +
      '<button class="btn primary" id="btnInstall">' + (worst === 'risk' ? 'Install anyway (risky)' : 'Install') + '</button>' +
      '<button class="btn" id="btnCancel">Cancel</button>' +
      '<span class="muted" id="status" style="align-self:center"></span></div>';

    const fbox = $('#findings');
    for (const f of findings) {
      const div = document.createElement('div');
      div.className = 'finding ' + f.level;
      div.innerHTML = '<span class="dot"></span><div><b>' + esc(f.title) + '</b><p>' + esc(f.detail) + '</p></div>';
      fbox.appendChild(div);
    }

    $('#btnCancel').addEventListener('click', () => window.close());
    $('#btnInstall').addEventListener('click', async () => {
      const btn = $('#btnInstall');
      btn.disabled = true;
      $('#status').textContent = 'Installing...';
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
        const existing = Object.values(all).find((s) => s.namespace && s.namespace === meta.namespace && s.name === meta.name);
        const id = existing ? existing.id : (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
        all[id] = {
          id, name: meta.name, namespace: meta.namespace, version: meta.version || '1.0',
          description: meta.description, author: meta.author,
          matches: meta.matches, includes: meta.includes, excludes: meta.excludes,
          grants: meta.grants, runAt: meta.runAt || 'document-end', noframes: meta.noframes,
          updateURL: meta.updateURL, downloadURL: meta.downloadURL || src,
          require: meta.require, requireCode, resources,
          enabled: true, code, sourceUrl: src,
          createdAt: existing ? existing.createdAt : Date.now(), updatedAt: Date.now()
        };
        await chrome.storage.local.set({ scripts: all });
        main.innerHTML = '<div class="panel" style="text-align:center;padding:50px">' +
          '<h1>Installed</h1><p class="muted">' + esc(meta.name) + ' is now active. Visit a matching site to see it work.</p>' +
          '<p><a href="dashboard.html">Open the dashboard</a></p></div>';
      } catch (e) {
        $('#status').textContent = 'Install failed: ' + e.message;
        btn.disabled = false;
      }
    });
  }

  boot();
})();

// KingVamp popup - scripts on this tab, script commands, element hider,
// per-site block switch, master freeze switch.
(async function () {
  'use strict';
  const $ = (s) => document.querySelector(s);

  function send(msg) {
    return chrome.runtime.sendMessage(Object.assign({ kv: true }, msg)).then((r) => {
      if (r && r.error) throw new Error(r.error);
      return r && r.value;
    });
  }

  const store = await chrome.storage.local.get(['settings', 'blacklist']);
  const settings = Object.assign({ globalEnabled: true }, store.settings || {});
  const blacklist = store.blacklist || [];

  const gt = $('#globalToggle');
  gt.checked = settings.globalEnabled;
  $('#freezeLabel').textContent = settings.globalEnabled ? 'Active' : 'Frozen';
  gt.addEventListener('change', async () => {
    settings.globalEnabled = gt.checked;
    await chrome.storage.local.set({ settings });
    $('#freezeLabel').textContent = gt.checked ? 'Active' : 'Frozen';
    render();
  });

  let tab = null;
  try { tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0]; } catch (e) {}
  let host = '';
  try { host = new URL(tab.url).hostname; } catch (e) {}
  if (host) $('#siteHost').textContent = host;

  // per-site block switch
  const siteToggle = $('#siteToggle');
  const blocked = blacklist.includes(host);
  siteToggle.checked = !blocked;
  if (!host) siteToggle.disabled = true;
  siteToggle.addEventListener('change', async () => {
    await send({ api: 'setBlacklisted', args: [host, !siteToggle.checked] });
    render();
  });

  async function render() {
    const list = $('#list');
    list.innerHTML = '';
    const off = !settings.globalEnabled || blacklist.includes(host);
    if (off) {
      list.innerHTML = '<div class="empty">' +
        (!settings.globalEnabled ? 'All scripts are frozen.<br>Flip the switch above to wake KingVamp.'
          : 'KingVamp is blocked on ' + host + '.<br>Flip the site switch below to allow it here.') + '</div>';
    } else if (!tab || !/^https?:/.test(tab.url || '')) {
      list.innerHTML = '<div class="empty">No scripts can run on this page.</div>';
    } else {
      let matched = [];
      try { matched = (await send({ api: 'getScriptsFor', args: [tab.url] })) || []; } catch (e) {}
      if (!matched.length) {
        list.innerHTML = '<div class="empty">No scripts match this site yet.</div>';
      }
      for (const sc of matched) {
        const row = document.createElement('div');
        row.className = 'script-row';
        row.innerHTML = '<div class="info"><div class="name"></div><div class="sub">v' + (sc.version || '?') +
          ' &middot; ran ' + (sc.runs || 0) + 'x</div></div>';
        row.querySelector('.name').textContent = sc.name || 'Unnamed script';
        const sw = document.createElement('span');
        sw.className = 'switch';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!sc.enabled;
        cb.addEventListener('change', async () => {
          const all = (await chrome.storage.local.get('scripts')).scripts || {};
          if (all[sc.id]) { all[sc.id].enabled = cb.checked; await chrome.storage.local.set({ scripts: all }); }
        });
        const tr = document.createElement('span');
        tr.className = 'track';
        sw.append(cb, tr);
        row.appendChild(sw);
        list.appendChild(row);
      }
    }

    // script menu commands registered by scripts on this page
    const cmdSection = $('#cmdSection');
    const cmdList = $('#cmdList');
    cmdList.innerHTML = '';
    let cmds = [];
    if (tab && tab.id != null) {
      try { cmds = (await send({ api: 'getMenuCommands', args: [tab.id] })) || []; } catch (e) {}
    }
    cmdSection.classList.toggle('hidden', !cmds.length);
    for (const c of cmds) {
      const b = document.createElement('button');
      b.className = 'btn cmd-row';
      b.innerHTML = '<span class="who"></span>';
      b.insertBefore(document.createTextNode(c.name), b.firstChild);
      b.querySelector('.who').textContent = ' — ' + c.scriptName;
      b.addEventListener('click', async () => {
        try { await send({ api: 'runMenuCommand', args: [tab.id, c.cmdId] }); } catch (e) {}
        window.close();
      });
      cmdList.appendChild(b);
    }
  }

  $('#openDash').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard.html') });
  });
  $('#newForSite').addEventListener('click', () => {
    let origin = '*://*/*';
    try { const u = new URL(tab.url); origin = u.protocol + '//' + u.host + '/*'; } catch (e) {}
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/editor.html') + '#new=' + encodeURIComponent(origin) });
  });
  $('#hideEl').addEventListener('click', async () => {
    if (tab && tab.id != null) {
      try { await send({ api: 'startPicker', args: [tab.id] }); } catch (e) {}
    }
    window.close();
  });

  render();
})();

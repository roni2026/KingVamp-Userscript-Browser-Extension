// KingVamp Install Detector v3.0.0 — content script.
// When the current page IS a userscript source (*.user.js or raw text
// starting with a ==UserScript== block), show an install banner so one
// click installs it — just like Tampermonkey's install flow.
(() => {
  'use strict';
  if (window.top !== window) return; // top frame only
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  if (document.getElementById('kv-install-bar')) return;

  const path = location.pathname.toLowerCase();
  const looksUserJs = /\.user\.js\/?$/.test(path);
  const text = (document.body && document.body.innerText) || '';
  const isRawMeta = !looksUserJs && /^\s*\/\/\s*==UserScript==/.test(text);
  if (!looksUserJs && !isRawMeta) return;

  const nameMatch = text.match(/^\s*\/\/\s*@name\s+(.+)$/m);
  const name = nameMatch ? nameMatch[1].trim() : (path.split('/').pop() || 'this userscript');
  const versionMatch = text.match(/^\s*\/\/\s*@version\s+(.+)$/m);
  const version = versionMatch ? versionMatch[1].trim() : '';

  const bar = document.createElement('div');
  bar.id = 'kv-install-bar';
  const style = document.createElement('style');
  style.textContent = `
#kv-install-bar{position:fixed;top:0;left:0;right:0;z-index:2147483647;display:flex;align-items:center;gap:14px;padding:10px 18px;background:#12121e;color:#eceaf2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;border-bottom:2px solid #e1062c;box-shadow:0 4px 24px rgba(0,0,0,.45)}
#kv-install-bar .kv-ico{width:30px;height:30px;border-radius:8px;background:rgba(225,6,44,.15);border:1px solid rgba(225,6,44,.4);display:flex;align-items:center;justify-content:center;font-weight:800;color:#e1062c;flex-shrink:0}
#kv-install-bar .kv-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
#kv-install-bar .kv-name{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#kv-install-bar .kv-sub{color:#8b8aa0;font-size:11.5px}
#kv-install-bar .kv-btn{background:#e1062c;color:#fff;border:none;border-radius:6px;padding:7px 16px;font-size:12.5px;font-weight:700;cursor:pointer;flex-shrink:0}
#kv-install-bar .kv-btn:hover{filter:brightness(1.15)}
#kv-install-bar .kv-btn.kv-ghost{background:transparent;color:#8b8aa0;border:1px solid #2e2e4a}
#kv-install-bar .kv-btn.kv-ok{background:#16a34a}
#kv-install-bar.kv-done{display:none}`;
  document.head.appendChild(style);

  bar.innerHTML = `
    <div class="kv-ico">KV</div>
    <div class="kv-txt">
      <div class="kv-name">${escapeHtml(name)}${version ? ' <span style="color:#8b8aa0;font-weight:500">v' + escapeHtml(version) + '</span>' : ''}</div>
      <div class="kv-sub">Userscript detected — install it with KingVamp</div>
    </div>
    <button class="kv-btn kv-ghost" id="kv-install-cancel">Dismiss</button>
    <button class="kv-btn" id="kv-install-go">Install</button>`;

  document.documentElement.appendChild(bar);

  let done = false;
  const finish = () => { bar.classList.add('kv-done'); setTimeout(() => bar.remove(), 800); };
  document.getElementById('kv-install-cancel').addEventListener('click', finish);
  document.getElementById('kv-install-go').addEventListener('click', async () => {
    const btn = document.getElementById('kv-install-go');
    btn.textContent = 'Installing…'; btn.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'INSTALL_FROM_PAGE', url: location.href, code: text });
      if (res?.ok) {
        btn.textContent = '✓ Installed'; btn.classList.add('kv-ok');
        const openBtn = document.createElement('button');
        openBtn.className = 'kv-btn kv-ghost';
        openBtn.textContent = 'Open Dashboard';
        openBtn.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' }));
        bar.insertBefore(openBtn, btn);
        setTimeout(() => { bar.querySelector('.kv-name').textContent = res.name || name; }, 0);
      } else {
        btn.textContent = 'Failed'; btn.disabled = false;
      }
    } catch (e) {
      btn.textContent = 'Failed'; btn.disabled = false;
    }
  });

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
})();
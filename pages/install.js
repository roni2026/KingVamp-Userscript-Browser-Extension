// KingVamp Install Page v3.0.0
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const msg = (type, data={}) => chrome.runtime.sendMessage({ type, ...data });
const GM_PERM_DESCRIPTIONS = {
  GM_getValue:['💾','Storage Read','Read persistent key-value data saved by this script'],
  GM_setValue:['💾','Storage Write','Write persistent data that survives page reloads'],
  GM_deleteValue:['💾','Storage Delete','Delete stored data for this script'],
  GM_listValues:['💾','Storage List','List all stored keys for this script'],
  GM_xmlhttpRequest:['🌐','Cross-Origin Requests','Make HTTP requests to any domain, bypassing CORS restrictions'],
  GM_notification:['🔔','Notifications','Show browser desktop notifications'],
  GM_openInTab:['📎','Open Tabs','Open new browser tabs programmatically'],
  GM_setClipboard:['📋','Clipboard Write','Write text to the system clipboard'],
  GM_download:['⬇️','File Download','Download files to your device'],
  GM_addStyle:['🎨','Style Injection','Inject custom CSS into pages'],
  GM_log:['📝','Console Logging','Write messages to the KingVamp console'],
  GM_getResourceText:['📦','Resource Access','Read pre-loaded @resource files'],
  GM_getResourceURL:['📦','Resource URL','Get data URLs for @resource files'],
  GM_registerMenuCommand:['🔧','Menu Commands','Add commands to the KingVamp popup menu'],
  'GM_cookie.list':['🍪','Cookie Read','Read cookies for the current domain'],
  'GM_cookie.set':['🍪','Cookie Write','Set cookies for the current domain'],
  'GM_cookie.delete':['🍪','Cookie Delete','Delete cookies for the current domain'],
  GM_addValueChangeListener:['👁','Value Monitoring','Monitor GM value changes across tabs'],
  GM_info:['ℹ️','Script Info','Read script metadata and KingVamp version info'],
  unsafeWindow:['⚠️','Unsafe Window','Direct access to the page window object, bypassing sandbox'],
};
async function init() {
  const params = new URLSearchParams(location.search);
  const scriptUrl = params.get('url');
  const inlineCode = params.get('code') ? decodeURIComponent(params.get('code')) : null;
  let code = inlineCode;
  if (scriptUrl && !code) {
    try { const res = await fetch(scriptUrl); if (!res.ok) throw new Error('HTTP ' + res.status); code = await res.text(); }
    catch(e) { document.getElementById('root').innerHTML = `<div class="install-card"><div style="padding:32px;text-align:center;color:var(--red)"><div style="font-size:24px;margin-bottom:12px">⚠</div><div style="font-weight:700;margin-bottom:8px">Failed to load script</div><div style="font-size:12px;color:var(--muted)">${esc(e.message)}</div></div></div>`; return; }
  }
  if (!code) { document.getElementById('root').innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted)">No script specified.</div>'; return; }
  const [meta, scanResults, scripts] = await Promise.all([msg('PARSE_META', { code }), msg('SCAN_SCRIPT', { code }), msg('GET_SCRIPTS')]);
  const existing = Object.values(scripts).find(s => s.meta?.name === meta.name && s.meta?.namespace === meta.namespace);
  const isUpdate = !!existing;
  const grants = meta.grant || [], matches = [...(meta.match||[]), ...(meta.include||[])], requires = meta.require || [];
  const dangers = (scanResults||[]).filter(r => r.sev === 'danger'), warnings = (scanResults||[]).filter(r => r.sev === 'warn');
  const icon = meta.icon ? `<img src="${esc(meta.icon)}" alt="" onerror="this.outerHTML='<span>${(meta.name||'?')[0].toUpperCase()}</span>'">` : `<span>${(meta.name||'?')[0].toUpperCase()}</span>`;
  document.getElementById('root').innerHTML = `
    <div class="install-card">
      ${isUpdate ? `<div class="install-update-notice"><span>⚡</span> This script is already installed. Installing will update it to v${esc(meta.version||'?')} (current: v${esc(existing?.meta?.version||'?')}).</div>` : ''}
      <div class="install-header">
        <div class="install-icon">${icon}</div>
        <div style="flex:1;min-width:0">
          <div class="install-title">${esc(meta.name||'Unnamed Script')}</div>
          <div class="install-desc">${esc(meta.description||'No description provided.')}</div>
          <div class="install-badges">
            ${meta.version ? `<span class="badge badge-muted">v${esc(meta.version)}</span>` : ''}
            ${meta.author ? `<span class="badge badge-purple">by ${esc(meta.author)}</span>` : ''}
            ${isUpdate ? `<span class="badge badge-yellow">Update</span>` : `<span class="badge badge-green">New</span>`}
            ${dangers.length ? `<span class="badge badge-red">⚠ Security Risk</span>` : ''}
          </div>
        </div>
      </div>
      <dl class="install-meta">
        <div class="install-meta-cell"><dt>Namespace</dt><dd>${esc(meta.namespace||'—')}</dd></div>
        <div class="install-meta-cell"><dt>Run At</dt><dd>${esc(meta['run-at']||'document-idle')}</dd></div>
        <div class="install-meta-cell"><dt>Matches</dt><dd>${matches.length} pattern${matches.length!==1?'s':''}</dd></div>
        <div class="install-meta-cell"><dt>@require</dt><dd>${requires.length} librar${requires.length!==1?'ies':'y'}</dd></div>
        <div class="install-meta-cell"><dt>Source</dt><dd style="word-break:break-all">${scriptUrl ? `<a href="${esc(scriptUrl)}" style="color:var(--blue)">${esc(new URL(scriptUrl).hostname)}</a>` : 'Local'}</dd></div>
        ${meta.updateURL ? `<div class="install-meta-cell"><dt>Auto-Update</dt><dd>Enabled</dd></div>` : ''}
      </dl>
      ${scanResults?.length ? `<div class="scan-issues" style="display:block"><h3>⚠ Safety Scan — ${scanResults.length} finding${scanResults.length!==1?'s':''}</h3>${scanResults.map(r=>`<div class="scan-item"><span class="scan-sev ${r.sev}">${r.sev}</span><span class="scan-msg" style="font-size:12px">${esc(r.msg)}</span></div>`).join('')}</div>` : ''}
      ${grants.length ? `<div class="permissions"><h3>Requested Permissions (${grants.length})</h3>${grants.map(g=>{const info=GM_PERM_DESCRIPTIONS[g]||['🔧',g,'Custom permission'];return `<div class="perm-item"><div class="perm-icon">${info[0]}</div><div><div class="perm-name">${esc(info[1])}</div><div class="perm-desc">${esc(info[2])}</div></div></div>`;}).join('')}</div>` : ''}
      ${matches.length ? `<div class="permissions"><h3>Runs on (${matches.length} pattern${matches.length!==1?'s':''})</h3>${matches.map(m=>`<div style="font-family:var(--mono);font-size:12px;padding:5px 0;border-bottom:1px solid var(--border);color:var(--muted)">${esc(m)}</div>`).join('')}</div>` : ''}
      <div class="install-code"><h3>Source Code <button class="btn ghost sm" id="btnToggleCode">Show</button></h3><div class="code-preview" id="codePreview" style="display:none"><textarea id="codeArea">${esc(code)}</textarea></div></div>
      <div class="install-actions">
        ${dangers.length ? `<div style="flex:1;font-size:12px;color:var(--red)">⚠ This script has security risk patterns. Install only if you trust the source.</div>` : '<div style="flex:1"></div>'}
        <button class="btn" id="btnCancel">Cancel</button>
        <button class="btn" id="btnEdit">Edit Before Installing</button>
        <button class="btn primary${dangers.length?' danger':''}" id="btnInstall">${isUpdate ? 'Update Script' : 'Install Script'}</button>
      </div>
    </div>`;
  document.getElementById('btnToggleCode').addEventListener('click', function() {
    const preview = document.getElementById('codePreview'), shown = preview.style.display !== 'none';
    preview.style.display = shown ? 'none' : 'block'; this.textContent = shown ? 'Show' : 'Hide';
    if (!shown && !window._cmInit) { window._cmInit = true; CodeMirror.fromTextArea(document.getElementById('codeArea'), { mode: 'javascript', theme: 'dracula', readOnly: true, lineNumbers: true }); }
  });
  document.getElementById('btnCancel').addEventListener('click', () => window.close());
  document.getElementById('btnEdit').addEventListener('click', () => { chrome.tabs.create({ url: chrome.runtime.getURL('pages/editor.html') + '?code=' + encodeURIComponent(code) }); window.close(); });
  document.getElementById('btnInstall').addEventListener('click', async () => {
    const btn = document.getElementById('btnInstall'); btn.disabled = true; btn.textContent = 'Installing…';
    try { await msg('SAVE_SCRIPT', { code, sourceUrl: scriptUrl || 'install-page' }); btn.textContent = isUpdate ? '✓ Updated!' : '✓ Installed!'; btn.className = 'btn success'; setTimeout(() => window.close(), 1200); }
    catch(e) { btn.textContent = 'Failed: ' + e.message; btn.disabled = false; }
  });
}
init().catch(console.error);

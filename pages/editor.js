// KingVamp Editor v2.0.0
const $ = id => document.getElementById(id);
const msg = (type, data={}) => chrome.runtime.sendMessage({ type, ...data });
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
let cm, scriptId = null, isDirty = false, currentMeta = {};
const params = new URLSearchParams(location.search);
const GM_COMPLETIONS = ['GM_getValue','GM_setValue','GM_deleteValue','GM_listValues','GM_addStyle','GM_log','GM_xmlhttpRequest','GM_notification','GM_openInTab','GM_setClipboard','GM_download','GM_getResourceText','GM_getResourceURL','GM_registerMenuCommand','GM_unregisterMenuCommand','GM_addValueChangeListener','GM_removeValueChangeListener','GM_cookie','GM_info','GM.getValue','GM.setValue','GM.xmlHttpRequest','GM.notification','unsafeWindow'];
async function init() {
  initEditor();
  const id = params.get('id'), isNew = params.get('new') === '1', host = params.get('host') || '', preCode = params.get('code') ? decodeURIComponent(params.get('code')) : null;
  if (id) {
    scriptId = id;
    const scripts = await msg('GET_SCRIPTS');
    const s = scripts[id];
    if (s) { cm.setValue(s.code || ''); loadMeta(s.meta || {}); $('editorTitle').textContent = s.meta?.name || id; showScriptInfo(s); isDirty = false; setDirty(false); }
  } else {
    const defaultCode = preCode || (await msg('BUILD_DEFAULT', { host }));
    cm.setValue(defaultCode || '');
    syncMetaFromCode();
    setDirty(false);
  }
  bindButtons();
  bindMetaFields();
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); } });
}
function initEditor() {
  cm = CodeMirror.fromTextArea($('editor'), {
    mode: 'javascript', theme: 'dracula', lineNumbers: true, tabSize: 2, indentWithTabs: false,
    autoCloseBrackets: true, matchBrackets: true, lineWrapping: false,
    extraKeys: {
      'Ctrl-/': 'toggleComment', 'Cmd-/': 'toggleComment',
      'Ctrl-F': 'findPersistent', 'Cmd-F': 'findPersistent',
      'Ctrl-H': 'replace', 'Cmd-H': 'replace',
      'Tab': cm => { const sel = cm.getSelection(); if (sel) cm.indentSelection('add'); else cm.replaceSelection('  '); },
      'Shift-Tab': cm => cm.indentSelection('subtract'),
    },
    hintOptions: { hint: gmHint, completeSingle: false },
  });
  cm.on('change', () => { setDirty(true); updateStatusBar(); });
  cm.on('cursorActivity', updateStatusBar);
  updateStatusBar();
}
function gmHint(cm) {
  const cur = cm.getCursor(), token = cm.getTokenAt(cur), word = token.string;
  const list = GM_COMPLETIONS.filter(c => c.startsWith(word));
  return { list, from: CodeMirror.Pos(cur.line, token.start), to: CodeMirror.Pos(cur.line, token.end) };
}
function setDirty(d) { isDirty = d; $('statusDirty').classList.toggle('visible', d); }
function updateStatusBar() { const cur = cm.getCursor(); $('statusLine').textContent = `Ln ${cur.line+1}, Col ${cur.ch+1}`; $('statusLines').textContent = `${cm.lineCount()} lines`; }
function loadMeta(meta) {
  currentMeta = { ...meta };
  $('mName').value = meta.name || ''; $('mVersion').value = meta.version || ''; $('mDesc').value = meta.description || ''; $('mAuthor').value = meta.author || ''; $('mNs').value = meta.namespace || ''; $('mRunAt').value = meta['run-at'] || 'document-idle'; $('mIcon').value = meta.icon || ''; $('mUpdateUrl').value = meta.updateURL || '';
  renderMatchList('matchList', meta.match || [], '@match');
  renderMatchList('excludeList', meta['exclude-match'] || meta.exclude || [], '@exclude-match');
  renderMatchList('requireList', meta.require || [], '@require');
  renderGrants(meta.grant || []);
}
function renderMatchList(listId, items, label) {
  const el = $(listId);
  el.innerHTML = items.map((v,i) => `<div class="match-row"><input type="text" value="${esc(v)}" data-label="${label}" data-idx="${i}" placeholder="${label} pattern"><button class="btn ghost sm" data-rm-list="${listId}" data-rm-idx="${i}">×</button></div>`).join('');
  el.querySelectorAll('input').forEach(inp => inp.addEventListener('change', syncMetaToCode));
  el.querySelectorAll('[data-rm-list]').forEach(btn => { btn.addEventListener('click', () => { btn.closest('.match-row').remove(); syncMetaToCode(); }); });
}
function renderGrants(grants) {
  $('grantList').innerHTML = grants.map((g,i) => `<div style="display:flex;align-items:center;gap:4px"><span style="flex:1;font-family:var(--mono);font-size:11px">${esc(g)}</span><button class="btn ghost sm" data-rm-grant="${i}" style="padding:2px 6px">×</button></div>`).join('');
  $('grantList').querySelectorAll('[data-rm-grant]').forEach(btn => { btn.addEventListener('click', () => { btn.closest('div').remove(); syncMetaToCode(); }); });
}
function getListValues(listId) { return [...$(listId).querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean); }
function getGrants() { return [...$('grantList').querySelectorAll('span')].map(s => s.textContent.trim()).filter(Boolean); }
function syncMetaToCode() {
  const meta = buildMetaFromSidebar(), newHeader = buildMetaBlock(meta), code = cm.getValue();
  const block = code.match(/\/\/\s*==UserScript==[\s\S]*?\/\/\s*==\/UserScript==/);
  if (block) { const updated = code.replace(block[0], newHeader); const cur = cm.getCursor(); cm.setValue(updated); cm.setCursor(cur); }
  else cm.setValue(newHeader + '\n\n' + code);
  setDirty(true);
}
function syncMetaFromCode() { msg('PARSE_META', { code: cm.getValue() }).then(meta => { if (meta && meta.name) loadMeta(meta); }); }
function buildMetaFromSidebar() {
  return { name: $('mName').value || 'Unnamed Script', namespace: $('mNs').value || 'https://kingvamp.local/', version: $('mVersion').value || '1.0.0', description: $('mDesc').value || '', author: $('mAuthor').value || '', 'run-at': $('mRunAt').value || 'document-idle', icon: $('mIcon').value || '', updateURL: $('mUpdateUrl').value || '', match: getListValues('matchList'), 'exclude-match': getListValues('excludeList'), require: getListValues('requireList'), grant: getGrants() };
}
function buildMetaBlock(meta) {
  const lines = ['// ==UserScript=='];
  const addLine = (key, val) => { if (val) lines.push(`// @${key.padEnd(20)} ${val}`); };
  addLine('name', meta.name); addLine('namespace', meta.namespace); addLine('version', meta.version); addLine('description', meta.description); addLine('author', meta.author); addLine('icon', meta.icon);
  (meta.match || []).forEach(v => addLine('match', v));
  (meta['exclude-match'] || []).forEach(v => addLine('exclude-match', v));
  (meta.require || []).forEach(v => addLine('require', v));
  (meta.grant || []).forEach(v => addLine('grant', v));
  addLine('run-at', meta['run-at']); addLine('updateURL', meta.updateURL);
  lines.push('// ==/UserScript==');
  return lines.join('\n');
}
function bindMetaFields() {
  ['mName','mVersion','mDesc','mAuthor','mNs','mRunAt','mIcon','mUpdateUrl'].forEach(id => { $(id)?.addEventListener('change', syncMetaToCode); });
  $('btnAddMatch').addEventListener('click', () => addMatchRow('matchList'));
  $('btnAddExclude').addEventListener('click', () => addMatchRow('excludeList'));
  $('btnAddRequire').addEventListener('click', () => addMatchRow('requireList', 'https://cdnjs.cloudflare.com/ajax/libs/'));
  $('grantAdd').addEventListener('change', e => { const val = e.target.value; if (!val) return; const grants = getGrants(); if (!grants.includes(val)) { grants.push(val); renderGrants(grants); syncMetaToCode(); } e.target.value = ''; });
}
function addMatchRow(listId, placeholder) {
  const container = $(listId), div = document.createElement('div'); div.className = 'match-row';
  const inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = placeholder || '*://*/*'; inp.addEventListener('change', syncMetaToCode);
  const btn = document.createElement('button'); btn.className = 'btn ghost sm'; btn.textContent = '×'; btn.addEventListener('click', () => { div.remove(); syncMetaToCode(); });
  div.appendChild(inp); div.appendChild(btn); container.appendChild(div); inp.focus();
}
function bindButtons() {
  $('btnSave').addEventListener('click', save);
  $('btnDash').addEventListener('click', () => { if (isDirty && !confirm('Unsaved changes. Leave?')) return; chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard.html') }); window.close(); });
  $('btnUndo').addEventListener('click', () => cm.undo());
  $('btnRedo').addEventListener('click', () => cm.redo());
  $('btnFind').addEventListener('click', () => cm.execCommand('findPersistent'));
  $('btnScanNow').addEventListener('click', runScan);
  $('btnFormat').addEventListener('click', formatCode);
}
async function save() {
  const code = cm.getValue(); if (!code.trim()) return;
  const result = await msg('SAVE_SCRIPT', { code, sourceUrl: scriptId ? undefined : 'editor' });
  if (result?.id) { scriptId = result.id; $('editorTitle').textContent = result.script?.meta?.name || scriptId; setDirty(false); $('statusSaved').textContent = 'Saved ' + new Date().toLocaleTimeString(); runScan(); }
}
async function runScan() {
  const results = await msg('SCAN_SCRIPT', { code: cm.getValue() }) || [];
  const el = $('scanResults');
  if (!results.length) { el.innerHTML = '<div class="scan-ok"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> No threats detected</div>'; }
  else { el.innerHTML = results.map(r => `<div class="scan-item-sm"><span class="scan-sev-sm ${r.sev}">${r.sev}</span><span style="font-size:11px">${esc(r.msg)}</span></div>`).join(''); }
}
function formatCode() {
  try {
    const code = cm.getValue(); let level = 0, result = [];
    for (const line of code.split('\n')) { const trimmed = line.trim(); if (!trimmed) { result.push(''); continue; } if (trimmed.startsWith('}') || trimmed.startsWith(']') || trimmed.startsWith(')')) level = Math.max(0, level-1); result.push('  '.repeat(level) + trimmed); if (trimmed.endsWith('{') || trimmed.endsWith('[') || trimmed.endsWith('(')) level++; }
    const cur = cm.getCursor(); cm.setValue(result.join('\n')); cm.setCursor(cur);
  } catch {}
}
function showScriptInfo(s) {
  $('scriptInfoBox').style.display = '';
  const rows = [['Runs',(s.runCount||0).toLocaleString()],['Errors',(s.errorCount||0).toLocaleString()],['Installed',new Date(s.installed||0).toLocaleDateString()],['Updated',new Date(s.updated||0).toLocaleDateString()]];
  $('scriptInfo').innerHTML = rows.map(([k,v]) => `<dt style="color:var(--muted2);font-size:10px;text-transform:uppercase;letter-spacing:0.5px">${k}</dt><dd style="font-size:11px">${v}</dd>`).join('');
}
loadMeta({});
init().catch(console.error);

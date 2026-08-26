// KingVamp Editor v3.0.0 — Tampermonkey-class code editor
// CodeMirror 5 based: syntax highlighting, line numbers, live lint with
// error markers in the gutter, code folding, find/replace, goto line,
// keymap presets (default/sublime/vim/emacs), themes, formatting.
const $ = id => document.getElementById(id);
const msg = (type, data = {}) => chrome.runtime.sendMessage({ type, ...data });
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let cm, scriptId = null, isDirty = false, currentMeta = {}, settings = {};
let annotations = [], errFilter = 'all', lintEnabled = true, saveTimer = null;
const params = new URLSearchParams(location.search);

const GM_API = ['GM_getValue','GM_setValue','GM_deleteValue','GM_listValues','GM_addStyle','GM_log','GM_xmlhttpRequest','GM_notification','GM_openInTab','GM_setClipboard','GM_download','GM_getResourceText','GM_getResourceURL','GM_registerMenuCommand','GM_unregisterMenuCommand','GM_addValueChangeListener','GM_removeValueChangeListener','GM_getTab','GM_saveTab','GM_getTabs','GM_cookie','GM_info','unsafeWindow','GM'];
const JS_KEYWORDS = ['var','let','const','function','return','if','else','for','while','do','switch','case','break','continue','new','delete','typeof','instanceof','in','of','class','extends','super','this','try','catch','finally','throw','async','await','yield','import','export','default','from','null','true','false','undefined','NaN','Infinity','document','window','location','navigator','history','fetch','XMLHttpRequest','Promise','Object','Array','String','Number','Boolean','Date','RegExp','Math','JSON','console','setTimeout','setInterval','clearTimeout','clearInterval','requestAnimationFrame','localStorage','sessionStorage','Element','Node','HTMLElement','MutationObserver','URL','Blob','FileReader','FormData','atob','btoa'];
const GM_COMPLETIONS = [...GM_API, ...JS_KEYWORDS];
const THEMES = ['dracula','monokai','material','solarized dark','solarized light','default'];
const KEYMAPS = ['default','sublime','vim','emacs'];

// ── Editor init ───────────────────────────────────────────────────
async function init() {
  const s = await msg('GET_SETTINGS');
  settings = s || {};
  applyEditorDefaults();
  initEditor();

  const id = params.get('id'), isNew = params.get('new') === '1', host = params.get('host') || '';
  const preCode = params.get('code') ? decodeURIComponent(params.get('code')) : null;
  if (id) {
    scriptId = id;
    const scripts = await msg('GET_SCRIPTS');
    const sc = scripts[id];
    if (sc) {
      cm.setValue(sc.code || '');
      loadMeta(sc.meta || {});
      $('editorTitle').textContent = sc.meta?.name || id;
      showScriptInfo(sc);
      isDirty = false; setDirty(false);
    }
  } else {
    const defaultCode = preCode || (await msg('BUILD_DEFAULT', { host }));
    cm.setValue(defaultCode || '');
    syncMetaFromCode();
    setDirty(false);
  }
  bindToolbar();
  bindMetaFields();
  bindSettingsPop();
  // Global save shortcut — works regardless of editor keymap (incl. vim)
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  });
  window.addEventListener('resize', () => cm.refresh());
  cm.refresh();
  setTimeout(() => cm.refresh(), 150);
  runScanSoon();
}
function applyEditorDefaults() {
  settings = {
    editorTheme: 'dracula', editorKeymap: 'default', editorTabSize: 2,
    editorFontSize: 13, editorWrap: false, editorLint: true, editorAutoSave: false,
    ...settings,
  };
  lintEnabled = settings.editorLint !== false;
}
function initEditor() {
  const tabSize = parseInt(settings.editorTabSize) || 2;
  cm = CodeMirror.fromTextArea($('editor'), {
    mode: 'javascript',
    theme: settings.editorTheme || 'dracula',
    keyMap: settings.editorKeymap || 'default',
    lineNumbers: true,
    firstLineNumber: 1,
    tabSize,
    indentUnit: tabSize,
    indentWithTabs: false,
    lineWrapping: !!settings.editorWrap,
    autoCloseBrackets: true,
    matchBrackets: true,
    styleActiveLine: { nonEmpty: false },
    gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter', 'CodeMirror-lint-markers'],
    foldGutter: true,
    foldOptions: { rangeFinder: CodeMirror.fold.combine(CodeMirror.fold.brace, CodeMirror.fold.comment, CodeMirror.fold.indent) },
    highlightSelectionMatches: { showToken: /\w+/, annotateScrollbar: true },
    lint: {
      getAnnotations: (cm2, updateLinting) => kvLint(cm2, updateLinting),
      async: true,
      onUpdateLinting: (unsorted, sorted) => { annotations = sorted || []; renderErrorPanel(); updateErrStatus(); },
    },
    hintOptions: { hint: gmHint, completeSingle: false, alignWithWord: true },
    extraKeys: {
      'Ctrl-/': 'toggleComment', 'Cmd-/': 'toggleComment',
      'Ctrl-F': 'findPersistent', 'Cmd-F': 'findPersistent',
      'Ctrl-H': 'replace', 'Cmd-H': 'replace',
      'Ctrl-G': 'jumpToLine', 'Cmd-G': 'jumpToLine',
      'F8': () => jumpErr(1), 'Shift-F8': () => jumpErr(-1),
      'Ctrl-]': 'indentMore', 'Ctrl-[': 'indentLess',
      'Ctrl-Space': 'autocomplete',
      'Tab': cm2 => { const sel = cm2.getSelection(); if (sel) cm2.indentSelection('add'); else cm2.replaceSelection(cm2.getOption('indentUnit') === 2 ? '  ' : '\t'); },
      'Shift-Tab': cm2 => cm2.indentSelection('subtract'),
      'Cmd-D': () => duplicateLine(), 'Ctrl-D': () => duplicateLine(),
      'Cmd-Shift-D': () => deleteLine(), 'Ctrl-Shift-D': () => deleteLine(),
      'Cmd-L': 'selectLine', 'Ctrl-L': 'selectLine',
      'Ctrl-Shift-F': () => formatCode(), 'Cmd-Shift-F': () => formatCode(),
      'Ctrl-Enter': () => saveAndClose(), 'Cmd-Enter': () => saveAndClose(),
      'F11': cm2 => { cm2.setOption('fullScreen', !cm2.getOption('fullScreen')); },
    },
  });
  cm.setOption('fontSize', settings.editorFontSize + 'px');
  document.querySelector('.CodeMirror').style.fontSize = (settings.editorFontSize || 13) + 'px';
  cm.on('change', () => {
    setDirty(true);
    updateStatusBar();
    if (settings.editorAutoSave) { clearTimeout(saveTimer); saveTimer = setTimeout(save, 1500); }
  });
  cm.on('cursorActivity', updateStatusBar);
  cm.on('keyHandled', updateStatusBar);
  updateStatusBar();
}
function gmHint(cm2) {
  const cur = cm2.getCursor();
  const line = cm2.getLine(cur.line) || '';
  const token = cm2.getTokenAt(cur);
  // Inside the ==UserScript== metadata block: suggest @keys
  if (/^\s*\/\//.test(line) && (token.string.startsWith('@') || /^\s*\/\/\s*@?$/.test(line))) {
    const word = token.string.startsWith('@') ? token.string.slice(1) : '';
    const list = META_KEYS.filter(k => k.startsWith(word)).map(k => '@' + k);
    if (list.length) return { list, from: CodeMirror.Pos(cur.line, token.start), to: CodeMirror.Pos(cur.line, token.end) };
  }
  const word = token.string;
  const list = GM_COMPLETIONS.filter(c => c.toLowerCase().startsWith(word.toLowerCase())).slice(0, 40);
  return { list, from: CodeMirror.Pos(cur.line, token.start), to: CodeMirror.Pos(cur.line, token.end) };
}

// ── Live lint: JSHint + metadata block checks ────────────────────
const META_KEYS = ['name','namespace','version','description','author','match','include','exclude','exclude-match','require','resource','grant','connect','run-at','noframes','unwrap','sandbox','icon','icon64','iconURL','icon64URL','updateURL','downloadURL','supportURL','homepage','homepageURL','license','contributionURL','contributionAmount','compatible','antifeature','inject-into','require-gm'];
const KNOWN_AT_KEYS = new Set(META_KEYS);

function kvLint(cm2, updateLinting) {
  const code = cm2.getValue();
  const out = [];
  if (!code.trim()) { updateLinting(out); return; }
  // 1) JSHint syntax & style
  if (window.JSHINT) {
    const globals = {}; GM_API.forEach(g => globals[g] = true);
    JSHINT(code, {
      esversion: 11, browser: true, devel: true, undef: false, unused: false,
      strict: false, asi: true, eqeqeq: false, boss: true, laxbreak: true,
      globals,
    });
    (JSHINT.errors || []).forEach(err => {
      if (!err || !err.reason) return;
      const sev = /^W/.test(err.code || '') ? 'warning' : 'error';
      const line = Math.max(0, (err.line || 1) - 1);
      const len = cm2.getLine(line).length;
      const ch = Math.max(0, Math.min((err.character || 1) - 1, len));
      const from = { line, ch }, to = { line, ch: Math.min(len, ch + 1) };
      if (to.ch === from.ch && len > 0) to.ch = from.ch + 1;
      out.push({ from, to, message: `${err.code || ''} ${err.reason}`.trim(), severity: sev });
    });
  }
  // 2) ==UserScript== metadata block checks
  out.push(...metaLint(cm2, code));
  updateLinting(out);
}
function metaLint(cm2, code) {
  const out = [];
  const mm = code.match(/\/\/\s*==UserScript==\s*\n([\s\S]*?)\n\s*\/\/\s*==\/UserScript==/);
  const firstLine = (() => { for (let i = 0; i < cm2.lineCount(); i++) if (cm2.getLine(i).includes('==UserScript==')) return i; return 0; })();
  const toPos = (line, msg, sev) => {
    const len = cm2.getLine(line)?.length || 0;
    return { from: { line, ch: 0 }, to: { line, ch: len || 1 }, message: msg, severity: sev };
  };
  if (!mm) {
    out.push(toPos(0, 'Info Missing ==UserScript== metadata block. The script will be stored but has no name/matches.', 'info'));
    return out;
  }
  const blockText = mm[1];
  const blockStart = code.indexOf('// ==UserScript==');
  const lines = code.slice(0, blockStart).split('\n');
  const metaStart = lines.length - 1; // line index of "// ==UserScript=="
  const rows = blockText.split('\n');
  const keyLines = {};      // key -> line offset (0-based inside block)
  const seen = [];
  const keys = [];
  rows.forEach((ln, i) => {
    const m = ln.match(/^\s*\/\/\s*@([a-zA-Z-]+)(?:\s+(.*))?$/);
    if (!m) return;
    const key = m[1].toLowerCase(), val = (m[2] || '').trim();
    keys.push({ key, val, absLine: metaStart + 1 + i });
    if (seen.includes(key)) out.push(toPos(metaStart + 1 + i, `Warning Duplicate @${key} key — only the last one is used.`, 'warning'));
    seen.push(key);
  });
  const have = k => keys.some(x => x.key === k);
  if (!have('name')) out.push(toPos(metaStart, 'Warning Missing @name — the script has no display name.', 'warning'));
  if (!have('version')) out.push(toPos(metaStart, 'Warning Missing @version — update checks will not work.', 'warning'));
  if (!have('match') && !have('include')) out.push(toPos(metaStart, 'Warning No @match/@include — the script will never run. Add @match *://*/* to run everywhere.', 'warning'));
  for (const { key, val, absLine } of keys) {
    if (!KNOWN_AT_KEYS.has(key)) out.push(toPos(absLine, `Info Unknown metadata key @${key}.`, 'info'));
    if ((key === 'match' || key === 'include' || key === 'exclude' || key === 'exclude-match') && val) {
      const ok = val === '<all_urls>' || val === '*' || val.includes('://') || val.includes('/');
      if (!ok) out.push(toPos(absLine, `Error Invalid ${key === 'match' ? '@match' : '@' + key} pattern "${val}". Expected e.g. *://*.example.com/*`, 'error'));
    }
    if (key === 'run-at' && !['document-start','document-end','document-body','document-idle','context-menu'].includes(val)) {
      out.push(toPos(absLine, `Warning Unknown @run-at value "${val}".`, 'warning'));
    }
  }
  return out;
}

// ── Error panel & status ─────────────────────────────────────────
function renderErrorPanel() {
  const list = annotations.filter(a => errFilter === 'all' || a.severity === errFilter);
  const panel = $('errorPanel');
  const errs = annotations.filter(a => a.severity === 'error').length;
  const warns = annotations.filter(a => a.severity === 'warning').length;
  const infos = annotations.filter(a => a.severity === 'info').length;
  if (!annotations.length || !lintEnabled) { panel.classList.remove('open'); $('errList').innerHTML = ''; return; }
  $('errSummary').textContent = `${annotations.length} issue${annotations.length !== 1 ? 's' : ''} · ${errs} err · ${warns} warn · ${infos} info`;
  if (!list.length) { $('errList').innerHTML = `<div class="err-empty">✓ No ${errFilter === 'all' ? '' : errFilter + 's'} — clean</div>`; return; }
  $('errList').innerHTML = list.map((a, i) =>
    `<div class="err-row" data-i="${i}"><span class="e-sev ${a.severity}">${a.severity}</span><span class="e-pos">${a.from.line + 1}:${a.from.ch + 1}</span><span class="e-msg">${esc(a.message)}</span></div>`
  ).join('');
  $('errList').querySelectorAll('.err-row').forEach(el => el.addEventListener('click', () => {
    const a = list[el.dataset.i]; if (!a) return;
    cm.setCursor({ line: a.from.line, ch: a.from.ch }); cm.focus();
  }));
}
function updateErrStatus() {
  const errs = annotations.filter(a => a.severity === 'error').length;
  const warns = annotations.filter(a => a.severity === 'warning').length;
  const e = $('statusErrors'), w = $('statusWarns');
  e.textContent = `${errs} error${errs !== 1 ? 's' : ''}`; e.style.color = errs ? 'var(--red)' : 'var(--muted2)';
  w.textContent = `${warns} warning${warns !== 1 ? 's' : ''}`; w.style.color = warns ? 'var(--yellow)' : 'var(--muted2)';
  $('lintDot').textContent = lintEnabled ? '✓' : '✕';
  $('btnLintToggle').classList.toggle('active', !lintEnabled);
}
function jumpErr(dir) {
  if (!annotations.length) return;
  const cur = cm.getCursor();
  const idx = annotations.findIndex(a => a.from.line > cur.line || (a.from.line === cur.line && a.from.ch >= cur.ch));
  let a;
  if (dir > 0) {
    a = annotations[idx === -1 ? 0 : idx];
  } else {
    const prev = idx === -1 ? annotations.length - 1 : idx - 1;
    a = annotations[prev < 0 ? annotations.length - 1 : prev];
  }
  cm.setCursor({ line: a.from.line, ch: a.from.ch }); cm.focus();
  openErrorPanel();
}

// ── Formatting ────────────────────────────────────────────────────
function formatCode() {
  if (!window.js_beautify) return;
  const cur = cm.getCursor();
  const out = window.js_beautify(cm.getValue(), {
    indent_size: parseInt(settings.editorTabSize) || 2,
    indent_char: ' ',
    preserve_newlines: true,
    max_preserve_newlines: 2,
    brace_style: 'collapse',
    space_before_conditional: true,
    end_with_newline: false,
  });
  cm.setValue(out);
  cm.setCursor({ line: Math.min(cur.line, cm.lineCount() - 1), ch: 0 });
  setDirty(true);
}
function duplicateLine() {
  const cur = cm.getCursor();
  const line = cm.getLine(cur.line);
  cm.replaceRange(line + '\n', { line: cur.line, ch: 0 }, { line: cur.line, ch: 0 });
}
function deleteLine() {
  const cur = cm.getCursor();
  cm.replaceRange('', { line: cur.line, ch: 0 }, { line: cur.line + 1, ch: 0 });
}

// ── Overflow-menu actions ─────────────────────────────────────────
function exportCode() {
  const code = cm.getValue();
  const name = ($('mName').value || 'script').replace(/[^\w.-]+/g, '_');
  const blob = new Blob([code], { type: 'text/javascript' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name + '.user.js';
  a.click();
  URL.revokeObjectURL(a.href);
  $('overflowPop').classList.remove('open');
}
function copyCode() {
  const code = cm.getValue();
  navigator.clipboard.writeText(code).then(() => { $('statusSaved').textContent = 'Copied'; }).catch(() => {});
  $('overflowPop').classList.remove('open');
}
function stripTrailingWhitespace() {
  let removed = 0;
  const cur = cm.getCursor();
  cm.eachLine(l => { const txt = l.text; if (/[ \t]+$/.test(txt)) { cm.replaceRange('', { line: l.lineNo, ch: txt.replace(/[ \t]+$/, '').length }, { line: l.lineNo, ch: txt.length }); removed++; } });
  cm.setCursor(cur);
  if (removed) { setDirty(true); $('statusSaved').textContent = `Trimmed ${removed} line${removed !== 1 ? 's' : ''}`; } else $('statusSaved').textContent = 'No trailing whitespace';
  $('overflowPop').classList.remove('open');
}
function sortLines() {
  const sel = cm.getSelection();
  const from = cm.getCursor('from'), to = cm.getCursor('to');
  const start = from.line, end = sel ? to.line : from.line;
  const lines = [];
  for (let i = start; i <= end; i++) lines.push(cm.getLine(i));
  lines.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  cm.replaceRange(lines.join('\n'), { line: start, ch: 0 }, { line: end, ch: cm.getLine(end).length });
  setDirty(true);
  $('overflowPop').classList.remove('open');
}
async function saveAndClose() {
  await save();
  if (!isDirty) { chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard.html') }); window.close(); }
}

// ── Status bar ────────────────────────────────────────────────────
function setDirty(d) { isDirty = d; $('statusDirty').classList.toggle('visible', d); }
function updateStatusBar() {
  const cur = cm.getCursor();
  $('statusLine').textContent = `Ln ${cur.line + 1}, Col ${cur.ch + 1}`;
  $('statusLines').textContent = `${cm.lineCount()} lines`;
  const words = cm.getValue().trim() ? cm.getValue().trim().split(/\s+/).length : 0;
  $('statusWords').textContent = `${words.toLocaleString()} words`;
  const sel = cm.getSelection();
  const selEl = $('statusSel');
  if (sel) { selEl.style.display = ''; selEl.textContent = `${sel.length} selected`; } else selEl.style.display = 'none';
}

// ── Toolbar ───────────────────────────────────────────────────────
function openErrorPanel() { $('errorPanel').classList.add('open'); }
function bindToolbar() {
  $('btnUndo').addEventListener('click', () => cm.undo());
  $('btnRedo').addEventListener('click', () => cm.redo());
  $('btnFormat').addEventListener('click', formatCode);
  $('btnFind').addEventListener('click', () => cm.execCommand('findPersistent'));
  $('btnReplace').addEventListener('click', () => cm.execCommand('replace'));
  $('btnGoto').addEventListener('click', () => cm.execCommand('jumpToLine'));
  $('btnComment').addEventListener('click', () => cm.execCommand('toggleComment'));
  $('btnFoldAll').addEventListener('click', () => cm.execCommand('foldAll'));
  $('btnUnfoldAll').addEventListener('click', () => cm.execCommand('unfoldAll'));
  $('btnPrevErr').addEventListener('click', () => { jumpErr(-1); });
  $('btnNextErr').addEventListener('click', () => { jumpErr(1); });
  $('btnLintToggle').addEventListener('click', () => {
    lintEnabled = !lintEnabled;
    settings.editorLint = lintEnabled;
    msg('SAVE_SETTINGS', { settings });
    cm.setOption('lint', lintEnabled ? {
      getAnnotations: (cm2, update) => kvLint(cm2, update),
      async: true,
      onUpdateLinting: (u, s) => { annotations = s || []; renderErrorPanel(); updateErrStatus(); },
    } : false);
    if (!lintEnabled) { annotations = []; renderErrorPanel(); updateErrStatus(); }
    updateErrStatus();
  });
  $('btnScanNow').addEventListener('click', runScan);
  $('btnFullscreen').addEventListener('click', () => cm.setOption('fullScreen', !cm.getOption('fullScreen')));
  $('btnSettings').addEventListener('click', e => { e.stopPropagation(); $('settingsPop').classList.toggle('open'); $('overflowPop').classList.remove('open'); });
  $('btnOverflow').addEventListener('click', e => { e.stopPropagation(); $('overflowPop').classList.toggle('open'); $('settingsPop').classList.remove('open'); });
  $('opExport').addEventListener('click', exportCode);
  $('opCopy').addEventListener('click', copyCode);
  $('opTrailing').addEventListener('click', stripTrailingWhitespace);
  $('opSortLines').addEventListener('click', sortLines);
  $('opSaveClose').addEventListener('click', saveAndClose);
  $('btnSidebar').addEventListener('click', () => { $('sidebar').classList.toggle('collapsed'); setTimeout(() => cm.refresh(), 180); });
  $('btnDash').addEventListener('click', () => {
    if (isDirty && !confirm('Unsaved changes. Leave?')) return;
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard.html') });
    window.close();
  });
  $('btnSave').addEventListener('click', save);
  $('btnErrClose').addEventListener('click', () => $('errorPanel').classList.remove('open'));
  $('statusErrors').addEventListener('click', openErrorPanel);
  $('statusWarns').addEventListener('click', openErrorPanel);
  document.querySelectorAll('.err-filter .err-chip').forEach(chip => chip.addEventListener('click', () => {
    document.querySelectorAll('.err-filter .err-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    errFilter = chip.dataset.filter;
    renderErrorPanel();
    openErrorPanel();
  }));
  document.addEventListener('click', e => { if (!$('settingsPop').contains(e.target) && e.target.id !== 'btnSettings') $('settingsPop').classList.remove('open'); if (!$('overflowPop').contains(e.target) && e.target.id !== 'btnOverflow') $('overflowPop').classList.remove('open'); });
}
function bindSettingsPop() {
  $('setTheme').value = settings.editorTheme; $('setKeymap').value = settings.editorKeymap;
  $('setTabSize').value = String(settings.editorTabSize);
  $('setFontSize').value = String(settings.editorFontSize);
  $('setWrap').checked = !!settings.editorWrap;
  $('setLint').checked = lintEnabled;
  $('setAutoSave').checked = !!settings.editorAutoSave;
  $('setTheme').addEventListener('change', e => { cm.setOption('theme', e.target.value); savePref({ editorTheme: e.target.value }); });
  $('setKeymap').addEventListener('change', e => { cm.setOption('keyMap', e.target.value); $('statusKeymap').textContent = e.target.value; if (e.target.value === 'vim') setTimeout(() => cm.refresh(), 50); savePref({ editorKeymap: e.target.value }); });
  $('setTabSize').addEventListener('change', e => { cm.setOption('tabSize', +e.target.value); cm.setOption('indentUnit', +e.target.value); savePref({ editorTabSize: +e.target.value }); });
  $('setFontSize').addEventListener('change', e => { document.querySelector('.CodeMirror').style.fontSize = e.target.value + 'px'; savePref({ editorFontSize: +e.target.value }); });
  $('setWrap').addEventListener('change', e => { cm.setOption('lineWrapping', e.target.checked); savePref({ editorWrap: e.target.checked }); });
  $('setLint').addEventListener('change', e => { settings.editorLint = e.target.checked; lintEnabled = e.target.checked; savePref({ editorLint: e.target.checked }); });
  $('setAutoSave').addEventListener('change', e => savePref({ editorAutoSave: e.target.checked }));
  $('btnResetEditor').addEventListener('click', () => {
    const defs = { editorTheme: 'dracula', editorKeymap: 'default', editorTabSize: 2, editorFontSize: 13, editorWrap: false, editorLint: true, editorAutoSave: false };
    Object.assign(settings, defs);
    msg('SAVE_SETTINGS', { settings });
    location.reload();
  });
  $('statusKeymap').textContent = settings.editorKeymap;
}
function savePref(patch) {
  Object.assign(settings, patch);
  msg('SAVE_SETTINGS', { settings });
}

// ── Save ──────────────────────────────────────────────────────────
async function save() {
  const code = cm.getValue();
  if (!code.trim()) return;
  const result = await msg('SAVE_SCRIPT', { code, sourceUrl: scriptId ? undefined : 'editor' });
  if (result?.id) {
    scriptId = result.id;
    $('editorTitle').textContent = result.script?.meta?.name || scriptId;
    setDirty(false);
    $('statusSaved').textContent = 'Saved ' + new Date().toLocaleTimeString();
    runScan();
  }
}

// ── Safety scan (sidebar) ────────────────────────────────────────
async function runScanSoon() { setTimeout(runScan, 600); }
async function runScan() {
  const results = await msg('SCAN_SCRIPT', { code: cm.getValue() }) || [];
  const el = $('scanResults');
  if (!results.length) {
    el.innerHTML = '<div class="scan-ok"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> No threats detected</div>';
  } else {
    el.innerHTML = results.map(r => `<div class="scan-item-sm"><span class="scan-sev-sm ${r.sev}">${r.sev}</span><span style="font-size:11px">${esc(r.msg)}</span></div>`).join('');
  }
}

// ── Metadata sidebar ──────────────────────────────────────────────
function loadMeta(meta) {
  currentMeta = { ...meta };
  $('mName').value = meta.name || ''; $('mVersion').value = meta.version || '';
  $('mDesc').value = meta.description || ''; $('mAuthor').value = meta.author || '';
  $('mNs').value = meta.namespace || '';
  $('mRunAt').value = ['document-start','document-body','document-end','document-idle'].includes(meta['run-at']) ? meta['run-at'] : 'document-idle';
  $('mIcon').value = meta.icon || ''; $('mUpdateUrl').value = meta.updateURL || '';
  $('mHomepage').value = meta.homepageURL || meta.homepage || '';
  $('mSupport').value = meta.supportURL || '';
  $('mLicense').value = meta.license || '';
  $('mNoFrames').checked = !!meta.noframes && meta.noframes !== 'false';
  renderMatchList('matchList', meta.match || [], '@match');
  renderMatchList('excludeList', meta['exclude-match'] || meta.exclude || [], '@exclude-match');
  renderMatchList('connectList', meta.connect || [], '@connect');
  renderMatchList('requireList', meta.require || [], '@require');
  renderMatchList('resourceList', meta.resource || [], '@resource');
  renderGrants(meta.grant || []);
}
function renderMatchList(listId, items, label) {
  const el = $(listId);
  el.innerHTML = items.map((v, i) => `<div class="match-row"><input type="text" value="${esc(v)}" data-label="${label}" data-idx="${i}" placeholder="${label} pattern"><button class="btn ghost sm" data-rm-list="${listId}" data-rm-idx="${i}">×</button></div>`).join('');
  el.querySelectorAll('input').forEach(inp => inp.addEventListener('change', syncMetaToCode));
  el.querySelectorAll('[data-rm-list]').forEach(btn => { btn.addEventListener('click', () => { btn.closest('.match-row').remove(); syncMetaToCode(); }); });
}
function renderGrants(grants) {
  $('grantList').innerHTML = grants.map((g, i) => `<div style="display:flex;align-items:center;gap:4px"><span style="flex:1;font-family:var(--mono);font-size:11px">${esc(g)}</span><button class="btn ghost sm" data-rm-grant="${i}" style="padding:2px 6px">×</button></div>`).join('');
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
  return {
    name: $('mName').value || 'Unnamed Script', namespace: $('mNs').value || 'https://kingvamp.local/',
    version: $('mVersion').value || '1.0.0', description: $('mDesc').value || '',
    author: $('mAuthor').value || '', 'run-at': $('mRunAt').value || 'document-idle',
    icon: $('mIcon').value || '', updateURL: $('mUpdateUrl').value || '',
    homepageURL: $('mHomepage').value || '', supportURL: $('mSupport').value || '',
    license: $('mLicense').value || '', noframes: $('mNoFrames').checked,
    match: getListValues('matchList'), 'exclude-match': getListValues('excludeList'),
    connect: getListValues('connectList'), require: getListValues('requireList'),
    resource: getListValues('resourceList'), grant: getGrants(),
  };
}
function buildMetaBlock(meta) {
  const lines = ['// ==UserScript=='];
  const addLine = (key, val) => { if (val) lines.push(`// @${key.padEnd(20)} ${val}`); };
  addLine('name', meta.name); addLine('namespace', meta.namespace);
  addLine('version', meta.version); addLine('description', meta.description);
  addLine('author', meta.author); addLine('icon', meta.icon);
  addLine('homepageURL', meta.homepageURL); addLine('supportURL', meta.supportURL);
  addLine('license', meta.license);
  (meta.match || []).forEach(v => addLine('match', v));
  (meta['exclude-match'] || []).forEach(v => addLine('exclude-match', v));
  (meta.connect || []).forEach(v => addLine('connect', v));
  (meta.require || []).forEach(v => addLine('require', v));
  (meta.resource || []).forEach(v => addLine('resource', v));
  (meta.grant || []).forEach(v => addLine('grant', v));
  addLine('run-at', meta['run-at']); addLine('updateURL', meta.updateURL);
  if (meta.noframes) lines.push('// @noframes');
  lines.push('// ==/UserScript==');
  return lines.join('\n');
}
function bindMetaFields() {
  ['mName','mVersion','mDesc','mAuthor','mNs','mRunAt','mIcon','mUpdateUrl','mHomepage','mSupport','mLicense','mNoFrames'].forEach(id => { $(id)?.addEventListener('change', syncMetaToCode); });
  $('btnAddMatch').addEventListener('click', () => addMatchRow('matchList'));
  $('btnAddExclude').addEventListener('click', () => addMatchRow('excludeList'));
  $('btnAddConnect').addEventListener('click', () => addMatchRow('connectList', 'example.com'));
  $('btnAddRequire').addEventListener('click', () => addMatchRow('requireList', 'https://cdnjs.cloudflare.com/ajax/libs/'));
  $('btnAddResource').addEventListener('click', () => addMatchRow('resourceList', 'name https://…/file'));
  $('btnMatchSite').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
      try { const u = new URL(t.url); addMatchRow('matchList', `*://${u.hostname}/*`); } catch {}
    });
  });
  $('grantAdd').addEventListener('change', e => {
    const val = e.target.value; if (!val) return;
    const grants = getGrants();
    if (!grants.includes(val)) { grants.push(val); renderGrants(grants); syncMetaToCode(); }
    e.target.value = '';
  });
}
function addMatchRow(listId, placeholder) {
  const container = $(listId), div = document.createElement('div');
  div.className = 'match-row';
  const inp = document.createElement('input');
  inp.type = 'text'; inp.placeholder = placeholder || '*://*/*'; inp.value = placeholder && placeholder.includes('*') ? placeholder : '';
  inp.addEventListener('change', syncMetaToCode);
  const btn = document.createElement('button');
  btn.className = 'btn ghost sm'; btn.textContent = '×';
  btn.addEventListener('click', () => { div.remove(); syncMetaToCode(); });
  div.appendChild(inp); div.appendChild(btn); container.appendChild(div);
  inp.focus();
}
function showScriptInfo(s) {
  $('scriptInfoBox').style.display = '';
  const rows = [['Runs', (s.runCount || 0).toLocaleString()], ['Errors', (s.errorCount || 0).toLocaleString()], ['Installed', new Date(s.installed || 0).toLocaleDateString()], ['Updated', new Date(s.updated || 0).toLocaleDateString()]];
  $('scriptInfo').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

loadMeta({});
init().catch(console.error);
// KingVamp Background Engine v3.0.0 — cross-browser userscript manager core.
// Chromium (Chrome/Edge/Brave/Opera): MAIN-world injection via chrome.scripting.
// Firefox: MAIN-world injection relayed through the bridge content script.

// ── Browser detection (Firefox limits: no service worker, no world:"MAIN") ──
let isFirefox = null;
async function detectFirefox() {
  if (isFirefox !== null) return isFirefox;
  try {
    if (typeof chrome.runtime.getBrowserInfo === 'function') {
      const info = await chrome.runtime.getBrowserInfo();
      isFirefox = info.name === 'Firefox';
    } else isFirefox = false;
  } catch { isFirefox = false; }
  return isFirefox;
}

function safeSend(message) {
  try { const p = chrome.runtime.sendMessage(message); if (p && typeof p.catch === 'function') p.catch(() => {}); } catch {}
}

// ── Metadata Parser ──────────────────────────────────────────────
function parseMeta(code) {
  const block = code.match(/\/\/\s*==UserScript==\s*\n([\s\S]*?)\n\s*\/\/\s*==\/UserScript==/);
  if (!block) return { name: 'Unnamed Script' };
  const multi = ['match','include','exclude','exclude-match','require','resource','grant','connect','antifeature'];
  const meta = {};
  for (const line of block[1].split('\n')) {
    const m = line.match(/^\s*\/\/\s*@([A-Za-z-]+)(?:\s+(.*?))?\s*$/);
    if (!m) continue;
    const [,key,val] = m;
    const lk = key.toLowerCase();
    if (multi.includes(lk)) { meta[lk] = meta[lk] || []; meta[lk].push((val||'').trim()); }
    else if (lk === 'noframes') meta.noframes = true;
    else if (lk === 'unwrap') meta.unwrap = true;
    else meta[lk] = (val||'').trim();
  }
  if (!meta.name) meta.name = 'Unnamed Script';
  return meta;
}

async function buildDefaultMeta(host) {
  const settings = await getSettings();
  const runAt = ['document-start','document-body','document-end','document-idle'].includes(settings.defaultRunAt) ? settings.defaultRunAt : 'document-idle';
  return `// ==UserScript==
// @name         New Script for ${host || 'All Sites'}
// @namespace    https://kingvamp.local/
// @version      1.0.0
// @description  Describe what this script does
// @author       You
// @match        ${host ? `*://${host}/*` : '*://*/*'}
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_log
// @run-at       ${runAt}
// ==/UserScript==

(function () {
  'use strict';
  GM_log('Script running on ' + location.href);
})();`;
}

// ── ID generator ─────────────────────────────────────────────────
const genId = () => 'kv' + Math.random().toString(36).slice(2,9) + Date.now().toString(36);

// ── URL Pattern Matching ──────────────────────────────────────────
function matchPattern(pat, url) {
  if (pat === '<all_urls>' || pat === '*') return true;
  try {
    if (pat.includes('://')) {
      const schemeEnd = pat.indexOf('://');
      const scheme = pat.slice(0, schemeEnd);
      const rest = pat.slice(schemeEnd + 3);
      const slashIdx = rest.indexOf('/');
      const host = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
      const path = slashIdx === -1 ? '/*' : '/' + rest.slice(slashIdx + 1);
      const u = new URL(url);
      const proto = u.protocol.slice(0, -1);
      if (scheme !== '*' && scheme !== proto) return false;
      if (host !== '*') {
        if (host.startsWith('*.')) {
          const sfx = host.slice(2);
          // TLD wildcards like *://*.example.*/ (matches example.com, example.org, sub.example.co.uk…)
          if (sfx.endsWith('.*')) {
            const tld = sfx.slice(0, -2);
            const parts = u.hostname.split('.');
            const idx = parts.findIndex(p => p === tld);
            return idx !== -1 && idx <= parts.length - 2;
          }
          if (u.hostname !== sfx && !u.hostname.endsWith('.' + sfx)) return false;
        } else if (host !== u.hostname) return false;
      }
      const pr = new RegExp('^' + path.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*') + '$');
      return pr.test(u.pathname + u.search);
    }
    const gr = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?/g,'.') + '$');
    return gr.test(url);
  } catch { return false; }
}

function scriptMatchesUrl(script, url) {
  if (!script.enabled) return false;
  const m = script.meta || {};
  for (const ex of [...(m.exclude||[]), ...(m['exclude-match']||[])]) {
    if (matchPattern(ex, url)) return false;
  }
  for (const p of [...(m.match||[]), ...(m.include||[])]) {
    if (matchPattern(p, url)) return true;
  }
  return false;
}

// ── Storage Helpers ───────────────────────────────────────────────
const get = (key) => chrome.storage.local.get(key).then(r => r[key]);
const set = (key, val) => chrome.storage.local.set({ [key]: val });

async function getScripts() { return (await get('scripts')) || {}; }
async function saveScripts(s) { return set('scripts', s); }
async function getSettings() {
  const s = (await get('settings')) || {};
  return { globalEnabled:true, autoUpdate:true, showBadge:true, logLimit:500, updateInterval:12, aiModel:'', aiKey:'', editorTheme:'dracula', editorKeymap:'default', editorTabSize:2, editorFontSize:13, editorWrap:false, editorLint:true, editorAutoSave:false, logLevel:'all', defaultRunAt:'document-idle', ...s };
}
async function getSiteSettings() { return (await get('siteSettings')) || {}; }

// ── Logging ───────────────────────────────────────────────────────
const LOG_PRIO = { error: 0, warn: 1, info: 2, log: 3 };

async function addLog(entry) {
  const settings = await getSettings();
  const level = settings.logLevel || 'all';
  const entryPrio = LOG_PRIO[entry.level] ?? 3;
  if (level !== 'all' && entryPrio > (LOG_PRIO[level] ?? 0)) return;
  let logs = (await get('kv_logs')) || [];
  logs.unshift({ ...entry, id: genId(), ts: Date.now() });
  if (logs.length > (settings.logLimit || 500)) logs.length = settings.logLimit;
  await set('kv_logs', logs);
  safeSend({ _kv: 'LOG_NEW', entry: logs[0] });
}

async function addNetLog(entry) {
  let log = (await get('kv_netlog')) || [];
  log.unshift({ ...entry, id: genId(), ts: Date.now() });
  if (log.length > 500) log.length = 500;
  await set('kv_netlog', log);
  safeSend({ _kv: 'NET_NEW', entry: log[0] });
}

// ── Safety Scanner ────────────────────────────────────────────────
const SCAN_RULES = [
  { re: /eval\s*\(/, sev:'warn', msg:'Uses eval() — executes arbitrary code' },
  { re: /new\s+Function\s*\(/, sev:'warn', msg:'Uses new Function() — similar risk to eval()' },
  { re: /document\.write\s*\(/, sev:'warn', msg:'Uses document.write() — may break page layout' },
  { re: /innerHTML\s*=(?!=)/, sev:'info', msg:'Assigns innerHTML — potential XSS if content is unescaped' },
  { re: /window\.location\s*=/, sev:'warn', msg:'Redirects the browser window' },
  { re: /crypto\s*\.\s*(subtle|getRandomValues)/i, sev:'info', msg:'Uses Web Crypto API' },
  { re: /mining|hashrate|monero|xmr|cryptonight/i, sev:'danger', msg:'Possible crypto-miner pattern detected' },
  { re: /password|passwd|credential/i, sev:'warn', msg:'References sensitive credential fields' },
  { re: /fetch\s*\(|XMLHttpRequest/, sev:'info', msg:'Makes network requests' },
  { re: /localStorage|sessionStorage/, sev:'info', msg:'Accesses local browser storage directly' },
  { re: /document\.cookie/, sev:'info', msg:'Reads or modifies cookies directly' },
  { re: /unsafeWindow/, sev:'warn', msg:'Uses unsafeWindow — bypasses sandbox isolation' },
  { re: /GM_xmlhttpRequest|GM\.xmlHttpRequest/, sev:'info', msg:'Makes cross-origin XHR requests via GM API' },
  { re: /atob\s*\(|btoa\s*\(/, sev:'info', msg:'Uses base64 encoding/decoding' },
];

function scanScript(code) {
  return SCAN_RULES.filter(r => r.re.test(code)).map(({ sev, msg }) => ({ sev, msg }));
}

// ── @require & @resource Loaders ──────────────────────────────────
const requireCache = new Map();

async function loadRequire(url) {
  if (requireCache.has(url)) return requireCache.get(url);
  try {
    const r = await fetch(url, { cache: 'force-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const code = await r.text();
    requireCache.set(url, code);
    return code;
  } catch (e) {
    console.warn('[KV] @require failed:', url, e.message);
    return `/* @require failed: ${url} */`;
  }
}

async function loadResources(meta) {
  const resources = {};
  for (const entry of (meta.resource || [])) {
    const [name, url] = entry.split(/\s+/);
    if (!name || !url) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const blob = await res.blob();
      const dataUrl = await new Promise(resolve => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.readAsDataURL(blob);
      });
      resources[name] = { dataUrl, mimeType: blob.type, url };
    } catch (e) {
      console.warn('[KV] @resource failed:', name, e.message);
    }
  }
  return resources;
}

// ── GM API Code Builder (grant-gated, Tampermonkey-style) ─────────
function buildGmBoilerplate(scriptId, meta, resources) {
  const grants = (meta.grant || []).map(g => g.trim()).filter(Boolean);
  const infoBlock = `const unsafeWindow=window;
const GM_info={
  script:{id:_kvId,name:${JSON.stringify(meta.name||'')},namespace:${JSON.stringify(meta.namespace||'')},version:${JSON.stringify(meta.version||'')},description:${JSON.stringify(meta.description||'')},matches:${JSON.stringify(meta.match||[])},grants:${JSON.stringify(grants)},updateURL:${JSON.stringify(meta.updateURL||'')},downloadURL:${JSON.stringify(meta.downloadURL||'')},supportURL:${JSON.stringify(meta.supportURL||'')},homepageURL:${JSON.stringify(meta.homepageURL||meta.homepage||'')},license:${JSON.stringify(meta.license||'')},noframes:${JSON.stringify(!!meta.noframes)}},
  scriptHandler:'KingVamp',scriptHandlerVersion:'3.0.0',version:'3.0.0',
  isIncognito:false,downloadMode:'native',
};`;
  const noGrant = grants.includes('none') || grants.length === 0;
  // Tampermonkey behaviour: with @grant none, GM_info stays available
  if (noGrant) return `// @grant none — only GM_info is injected
const _kvId=${JSON.stringify(scriptId)};
${infoBlock}`;
  const has = name => grants.includes(name);

  const body = [];
  body.push(
`const _kvId=${JSON.stringify(scriptId)};
const _kvRes=${JSON.stringify(resources||{})};
const _kvCall=(type,data)=>new Promise((res,rej)=>{
  const rid=Math.random().toString(36).slice(2);
  const fn=e=>{
    if(e.data?.__kvR!==rid)return;
    window.removeEventListener('message',fn);
    e.data.err?rej(new Error(e.data.err)):res(e.data.val);
  };
  window.addEventListener('message',fn);
  window.postMessage({__kv:1,rid,scriptId:_kvId,type,data},'*');
  setTimeout(()=>{window.removeEventListener('message',fn)},15000);
});
${infoBlock}`
  );

  const apis = {
    GM_getValue: "const GM_getValue=(k,d)=>_kvCall('gv',{k,d});",
    GM_setValue: "const GM_setValue=(k,v)=>_kvCall('sv',{k,v});",
    GM_deleteValue: "const GM_deleteValue=k=>_kvCall('dv',{k});",
    GM_listValues: "const GM_listValues=()=>_kvCall('lv',{});",
    GM_addValueChangeListener: `const GM_addValueChangeListener=(k,cb)=>{
  const lid=Math.random().toString(36).slice(2);
  _kvCall('avcl',{k,lid});
  window.addEventListener('message',e=>{
    if(e.data?.__kvVC?.sid===_kvId&&e.data.__kvVC.k===k)
      cb(k,e.data.__kvVC.o,e.data.__kvVC.n,e.data.__kvVC.r);
  });
  return lid;};`,
    GM_removeValueChangeListener: "const GM_removeValueChangeListener=lid=>_kvCall('rvcl',{lid});",
    GM_addStyle: "const GM_addStyle=css=>{const el=document.createElement('style');el.textContent=css;(document.head||document.documentElement).appendChild(el);return el};",
    GM_log: `const GM_log=(...a)=>{const msg=a.map(x=>typeof x==='object'?JSON.stringify(x):String(x)).join(' ');console.log('[GM]',msg);_kvCall('log',{level:'log',msg})};`,
    GM_notification: `const GM_notification=(d,done,click,timeout)=>{
  let o; let onDone=done;
  if(typeof d==='string'){
    o={text:d};
    if(typeof done==='string')o.title=done;
    o.timeout=(typeof click==='number'?click:(typeof timeout==='number'?timeout:0))||0;
    if(typeof done==='function')onDone=done;
    if(typeof click==='function')o.onclick=click;
    if(typeof timeout==='function')onDone=timeout;
  } else { o=d; if(o.ondone)onDone=o.ondone; }
  const nid=Math.random().toString(36).slice(2);
  _kvCall('notify',{...o,nid});
  const fin=(...a)=>{try{onDone?.(...a)}catch{}};
  setTimeout(fin,o.timeout||8000);
  window.addEventListener('message',function h(e){
    if(e.data?.__kvNotif?.nid!==nid)return;
    window.removeEventListener('message',h);
    const ev=e.data.__kvNotif;
    if(ev.type==='click'){try{o.onclick?.(ev.obj)}catch{}}
    else {try{o.ondone?.(ev.obj)}catch{}}
  });};`,
    GM_openInTab: "const GM_openInTab=(url,o)=>_kvCall('openTab',{url,opts:o||{}});",
    GM_setClipboard: "const GM_setClipboard=(data,type)=>_kvCall('clip',{data,type:type||'text'});",
    GM_download: `const GM_download=(d)=>{
  const o=typeof d==='string'?{url:d}:d;
  const did=Math.random().toString(36).slice(2);
  _kvCall('dl',{...o,did});
  window.addEventListener('message',function h(e){
    if(e.data?.__kvDL?.did!==did)return;
    window.removeEventListener('message',h);
    const ev=e.data.__kvDL;
    if(ev.ok){try{o.onload?.(ev)}catch{}}
    else if(ev.aborted){try{o.onabort?.()}catch{}}
    else {try{o.onerror?.(ev)}catch{}}
  });};`,
    GM_getResourceText: `const GM_getResourceText=name=>{const r=_kvRes[name];if(!r)return null;try{return atob(r.dataUrl.split(',')[1])}catch{return null}};`,
    GM_getResourceURL: "const GM_getResourceURL=name=>_kvRes[name]?.dataUrl||null;",
    GM_registerMenuCommand: `const GM_registerMenuCommand=(name,fn,ak)=>{
  _kvCall('regCmd',{name,ak});
  window.addEventListener('message',e=>{if(e.data?.__kvCmd?.n===name&&e.data.__kvCmd.sid===_kvId)fn()});
  return name;};`,
    GM_unregisterMenuCommand: "const GM_unregisterMenuCommand=name=>_kvCall('unregCmd',{name});",
    GM_getTab: "const GM_getTab=()=>_kvCall('getTab',{});",
    GM_saveTab: "const GM_saveTab=t=>_kvCall('saveTab',{t});",
    GM_getTabs: "const GM_getTabs=()=>_kvCall('getTabs',{});",
    GM_xmlhttpRequest: `const GM_xmlhttpRequest=details=>{
  const xid=Math.random().toString(36).slice(2);
  window.postMessage({__kv:1,rid:xid,scriptId:_kvId,type:'xhr',data:{
    method:details.method||'GET',url:details.url,
    headers:details.headers,body:details.data,
    responseType:details.responseType||'text',timeout:details.timeout,xid
  }},'*');
  window.addEventListener('message',function h(e){
    if(e.data?.__kvXR!==xid)return;
    window.removeEventListener('message',h);
    const ev=e.data.event,r=e.data.response;
    if(ev==='load')details.onload?.(r);
    else if(ev==='error')details.onerror?.(r);
    else if(ev==='abort')details.onabort?.();
    else if(ev==='timeout')details.ontimeout?.();
  });
  return{abort:()=>_kvCall('xhrAbort',{xid})};};`,
  };
  const cookieParts = [];
  if (has('GM_cookie.list')) cookieParts.push("  list:(d,cb)=>_kvCall('cookie',{action:'list',...d}).then(r=>cb(r,null)).catch(e=>cb(null,e.message)),");
  if (has('GM_cookie.set')) cookieParts.push("  set:(d,cb)=>_kvCall('cookie',{action:'set',...d}).then(r=>cb(r,null)).catch(e=>cb(null,e.message)),");
  if (has('GM_cookie.delete')) cookieParts.push("  delete:(d,cb)=>_kvCall('cookie',{action:'delete',...d}).then(r=>cb(r,null)).catch(e=>cb(null,e.message)),");
  if (cookieParts.length) body.push(`const GM_cookie={\n${cookieParts.join('\n')}\n};`);

  for (const name of Object.keys(apis)) if (has(name)) body.push(apis[name]);

  const gmObjEntries = [];
  if (has('GM_getValue')) gmObjEntries.push('getValue:GM_getValue');
  if (has('GM_setValue')) gmObjEntries.push('setValue:GM_setValue');
  if (has('GM_deleteValue')) gmObjEntries.push('deleteValue:GM_deleteValue');
  if (has('GM_listValues')) gmObjEntries.push('listValues:GM_listValues');
  if (has('GM_xmlhttpRequest')) gmObjEntries.push('xmlHttpRequest:GM_xmlhttpRequest');
  if (has('GM_notification')) gmObjEntries.push('notification:GM_notification');
  if (has('GM_openInTab')) gmObjEntries.push('openInTab:GM_openInTab');
  if (has('GM_setClipboard')) gmObjEntries.push('setClipboard:GM_setClipboard');
  if (has('GM_getResourceText')) gmObjEntries.push('getResourceText:GM_getResourceText');
  if (has('GM_getResourceURL')) gmObjEntries.push('getResourceUrl:GM_getResourceURL');
  if (has('GM_registerMenuCommand')) gmObjEntries.push('registerMenuCommand:GM_registerMenuCommand');
  if (has('GM_unregisterMenuCommand')) gmObjEntries.push('unregisterMenuCommand:GM_unregisterMenuCommand');
  if (has('GM_getTab')) gmObjEntries.push('getTab:GM_getTab');
  if (has('GM_saveTab')) gmObjEntries.push('saveTab:GM_saveTab');
  if (has('GM_getTabs')) gmObjEntries.push('getTabs:GM_getTabs');
  if (has('GM_download')) gmObjEntries.push('download:GM_download');
  if (has('GM_log')) gmObjEntries.push('log:GM_log');
  if (cookieParts.length) gmObjEntries.push('cookie:GM_cookie');
  gmObjEntries.push('info:GM_info');
  if (gmObjEntries.length) body.push(`const GM={\n  ${gmObjEntries.join(',\n  ')},\n};`);

  return body.join('\n');
}

// ── Script Injection ──────────────────────────────────────────────
async function buildAndInject(tabId, frameId, script, injectImmediately) {
  const meta = script.meta || {};
  const requireCodes = await Promise.all((meta.require || []).map(loadRequire));
  const gm = buildGmBoilerplate(script.id, meta, script.resources || {});

  const wrapped = meta.unwrap
    ? `${gm}
/* @require */
${requireCodes.join('\n')}
/* ${meta.name||script.id} */
${script.code}`
    : `(function(){\n"use strict";\n${gm}\n/* @require */\n${requireCodes.join('\n')}\n/* ${meta.name||script.id} */\n${script.code}\n})();`;

  try {
    if (await detectFirefox()) {
      await injectViaBridge(tabId, frameId, wrapped);
    } else {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        world: 'MAIN',
        func: code => { try { (0, eval)(code); } catch (e) { console.error('[KV]', e.message); } },
        args: [wrapped],
        injectImmediately,
      });
    }
    const scripts = await getScripts();
    if (scripts[script.id]) { scripts[script.id].runCount = (scripts[script.id].runCount||0)+1; scripts[script.id].lastRun = Date.now(); await saveScripts(scripts); }
    await addLog({ scriptId: script.id, scriptName: meta.name||script.id, level:'info', msg:'Injected at '+(meta['run-at']||'document-idle'), url:'' });
  } catch (e) {
    await addLog({ scriptId: script.id, scriptName: meta.name||script.id, level:'error', msg: e.message, url:'' });
    const scripts = await getScripts();
    if (scripts[script.id]) { scripts[script.id].errorCount = (scripts[script.id].errorCount||0)+1; await saveScripts(scripts); }
  }
}

// Firefox can't inject into the MAIN world from the background; relay the
// code through the bridge content script, which runs it via a <script> tag.
// The bridge's sendResponse resolves this promise directly.
function injectViaBridge(tabId, frameId, code) {
  return new Promise((resolve, reject) => {
    const rid = genId();
    const timer = setTimeout(() => reject(new Error('Injection relay timeout')), 8000);
    chrome.tabs.sendMessage(tabId, { __kvInject: { rid, code } }, { frameId })
      .then(res => {
        clearTimeout(timer);
        if (res?.__kvInjectDone?.err) reject(new Error(res.__kvInjectDone.err));
        else resolve();
      })
      .catch(err => { clearTimeout(timer); reject(err); });
  });
}

const RUN_AT = { 'document-start':'start','document-body':'end','document-end':'end','document-idle':'idle' };

async function injectForTab(tabId, url, frameId, phase) {
  const settings = await getSettings();
  if (!settings.globalEnabled) return;
  try { if (!new URL(url).protocol.startsWith('http')) return; } catch { return; }
  const hostname = new URL(url).hostname;
  const siteSettings = await getSiteSettings();
  if (siteSettings[hostname]?.disabled) return;
  const scripts = await getScripts();
  const matching = Object.values(scripts).filter(s => scriptMatchesUrl(s, url));
  for (const script of matching) {
    if (script.meta?.noframes && frameId !== 0) continue;
    const runAt = script.meta?.['run-at'];
    if (runAt === 'context-menu') continue; // only started from the context menu
    const phase2 = RUN_AT[runAt] || 'idle';
    if (phase2 !== phase) continue;
    buildAndInject(tabId, frameId, script, phase === 'start').catch(console.error);
  }
  if (phase === 'end') updateBadge(tabId, matching.length);
}

async function updateBadge(tabId, count) {
  const settings = await getSettings();
  if (!settings.showBadge || !settings.globalEnabled || !count) {
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    return;
  }
  chrome.action.setBadgeText({ tabId, text: String(count) }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#e1062c' }).catch(() => {});
}

// ── GM API Message Handler ────────────────────────────────────────
const activeXhrs = new Map();
const notifCallbacks = new Map();   // notificationId -> { tabId, nid }
const dlCallbacks = new Map();      // downloadId -> { tabId, did }

function isConnectAllowed(meta, pageHost, targetUrl) {
  const connects = (meta?.connect || []).map(c => c.trim()).filter(Boolean);
  if (connects.includes('*')) return { ok: true };
  let targetHost;
  try { targetHost = new URL(targetUrl).hostname; } catch { return { ok: false, msg: 'GM_xmlhttpRequest: invalid target URL' }; }
  if (connects.includes(targetHost)) return { ok: true };
  if (pageHost && (pageHost === targetHost || targetHost.endsWith('.' + pageHost))) return { ok: true };
  return { ok: false, msg: `GM_xmlhttpRequest: request to "${targetHost}" is not allowed. Add "@connect ${targetHost}" (or "@connect *") to the script metadata.` };
}

async function handleApi(msg, sender) {
  const { type, data, scriptId } = msg;

  if (type === 'gv') { const store = (await get('kv_store'))||{}; return store[scriptId+':'+data.k]??data.d; }
  if (type === 'sv') {
    const store = (await get('kv_store'))||{};
    const old = store[scriptId+':'+data.k];
    store[scriptId+':'+data.k] = data.v;
    await set('kv_store', store);
    broadcastVC(scriptId, data.k, old, data.v, false);
    return true;
  }
  if (type === 'dv') { const store=(await get('kv_store'))||{}; delete store[scriptId+':'+data.k]; await set('kv_store',store); return true; }
  if (type === 'lv') { const store=(await get('kv_store'))||{}; const pre=scriptId+':'; return Object.keys(store).filter(k=>k.startsWith(pre)).map(k=>k.slice(pre.length)); }
  if (type === 'getTab') { const store=(await get('kv_tabs'))||{}; const sid=store[scriptId]||{}; return sender.tab ? (sid[sender.tab.id]||{}) : {}; }
  if (type === 'saveTab') { const store=(await get('kv_tabs'))||{}; store[scriptId]=store[scriptId]||{}; if (sender.tab) store[scriptId][sender.tab.id]=data.t||{}; await set('kv_tabs',store); return true; }
  if (type === 'getTabs') { const store=(await get('kv_tabs'))||{}; return store[scriptId]||{}; }
  if (type === 'log') { const scripts=await getScripts(); const name=scripts[scriptId]?.meta?.name||scriptId; await addLog({scriptId,scriptName:name,level:data.level||'log',msg:data.msg,url:sender.url||''}); return true; }
  if (type === 'notify') {
    const nid = data.nid || genId();
    const options = { type:'basic', iconUrl:'../icons/icon48.png', title:data.title||'KingVamp Script', message:data.text||data.message||'', silent:!!data.silent, priority:Number(data.priority)||0 };
    if (data.tag) options.tag = String(data.tag);
    chrome.notifications.create(nid, options);
    notifCallbacks.set(nid, { tabId: sender.tab?.id, nid });
    return true;
  }
  if (type === 'openTab') { chrome.tabs.create({url:data.url,active:data.opts?.active!==false}); return true; }
  if (type === 'clip') { await set('kv_clipboard',data.data); return true; }
  if (type === 'dl') {
    // Note: saveAs/filename supported everywhere; incognito/conflictAction ignored on Firefox.
    try {
      const download = await chrome.downloads.download({ url:data.url, filename:data.name || undefined, saveAs:!!data.saveAs });
      dlCallbacks.set(download, { tabId: sender.tab?.id, did: data.did });
    } catch (e) {
      if (sender.tab?.id !== undefined) chrome.tabs.sendMessage(sender.tab.id, { __kvDL: { did: data.did, ok:false, err:e.message } }).catch(()=>{});
    }
    return true;
  }
  if (type === 'regCmd') {
    const scripts = await getScripts();
    if (scripts[scriptId]) { scripts[scriptId].menuCommands=scripts[scriptId].menuCommands||{}; scripts[scriptId].menuCommands[data.name]={name:data.name,ak:data.ak}; await saveScripts(scripts); }
    return true;
  }
  if (type === 'unregCmd') { const scripts=await getScripts(); if(scripts[scriptId]?.menuCommands){delete scripts[scriptId].menuCommands[data.name];await saveScripts(scripts);} return true; }
  if (type === 'xhr') {
    const scripts = await getScripts();
    const script = scripts[scriptId];
    const pageHost = (() => { try { return new URL(sender.url||'').hostname; } catch { return ''; } })();
    const allowed = isConnectAllowed(script?.meta, pageHost, data.url);
    if (!allowed.ok) throw new Error(allowed.msg);
    const ctrl = new AbortController();
    activeXhrs.set(data.xid, ctrl);
    const t0 = Date.now();
    const tabId = sender.tab?.id;
    let timedOut = false;
    const timer = data.timeout ? setTimeout(() => { timedOut = true; ctrl.abort(); }, data.timeout) : null;
    try {
      const res = await fetch(data.url, { method:data.method||'GET', headers:data.headers, body:data.body||undefined, signal:ctrl.signal });
      const dur = Date.now()-t0;
      let resp;
      if (data.responseType === 'json') resp = await res.json();
      else if (data.responseType === 'arraybuffer') {
        const buf = await res.arrayBuffer();
        let bin = ''; const bytes = new Uint8Array(buf); const CH = 0x8000;
        for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
        resp = { base64: btoa(bin), byteLength: bytes.length };
      } else if (data.responseType === 'blob') {
        const blob = await res.blob();
        resp = await new Promise(resolve => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.readAsDataURL(blob); });
        resp = { dataUrl: resp };
      } else resp = await res.text();
      const response = { status:res.status, statusText:res.statusText, responseText:typeof resp==='string'?resp:'', response:resp, finalUrl:res.url, readyState:4, responseHeaders:[...res.headers.entries()].map(([k,v])=>`${k}: ${v}`).join('\r\n') };
      addNetLog({scriptId,method:data.method,url:data.url,status:res.status,dur,size:typeof resp==='string'?resp.length:0});
      if (tabId) chrome.tabs.sendMessage(tabId, {__kvXR:data.xid,event:'load',response}).catch(()=>{});
    } catch(e) {
      const event = timedOut ? 'timeout' : (e.name==='AbortError' ? 'abort' : 'error');
      if (tabId) chrome.tabs.sendMessage(tabId, {__kvXR:data.xid,event,response:{error:e.message}}).catch(()=>{});
      addNetLog({scriptId,method:data.method,url:data.url,status:0,dur:Date.now()-t0,size:0});
    } finally { if (timer) clearTimeout(timer); activeXhrs.delete(data.xid); }
    return true;
  }
  if (type === 'xhrAbort') { activeXhrs.get(data.xid)?.abort(); return true; }
  if (type === 'cookie') {
    const { action, ...rest } = data; const u = sender.url||'';
    if (action==='list') return chrome.cookies.getAll({url:u,...rest});
    if (action==='set') return chrome.cookies.set({url:u,...rest});
    if (action==='delete') return chrome.cookies.remove({url:u,name:rest.name});
    return null;
  }
  return null;
}

function broadcastVC(scriptId, k, o, n, remote) {
  chrome.tabs.query({}).then(tabs => {
    for (const t of tabs) chrome.tabs.sendMessage(t.id, {__kvVC:{sid:scriptId,k,o,n,r:remote}}).catch(()=>{});
  });
}

// ── Script Install ────────────────────────────────────────────────
async function installScript(code, sourceUrl) {
  const meta = parseMeta(code);
  const scripts = await getScripts();
  const existId = Object.keys(scripts).find(id => scripts[id].meta?.name===meta.name && scripts[id].meta?.namespace===meta.namespace);
  const id = existId || genId();
  const existing = scripts[id] || {};
  const resources = await loadResources(meta);
  const scanResults = scanScript(code);
  scripts[id] = { ...existing, id, code, meta, enabled: existing.enabled!==undefined?existing.enabled:true, installed: existing.installed||Date.now(), updated: Date.now(), sourceUrl: sourceUrl||existing.sourceUrl||'', resources, scanResults, runCount: existing.runCount||0, errorCount: existing.errorCount||0, menuCommands: existing.menuCommands||{}, tags: existing.tags||[] };
  await saveScripts(scripts);
  await addLog({ scriptId:id, scriptName:meta.name, level:'info', msg: existId?`Updated to v${meta.version||'?'}`:'Installed', url: sourceUrl||'' });
  return { id, script: scripts[id], isUpdate: !!existId };
}

// ── Auto-Updater ──────────────────────────────────────────────────
function semverGt(a, b) {
  if (!a || !b) return false;
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i]||0) > (pb[i]||0)) return true;
    if ((pa[i]||0) < (pb[i]||0)) return false;
  }
  return false;
}

async function checkUpdates() {
  const settings = await getSettings();
  if (!settings.autoUpdate) return;
  const scripts = await getScripts();
  let updated = 0;
  for (const s of Object.values(scripts)) {
    const url = s.meta?.updateURL || s.meta?.downloadURL;
    if (!url) continue;
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) continue;
      const code = await res.text();
      const newMeta = parseMeta(code);
      if (semverGt(newMeta.version, s.meta?.version)) {
        await installScript(code, url);
        updated++;
        chrome.notifications.create({ type:'basic', iconUrl:'../icons/icon48.png', title:'KingVamp — Updated', message:`${newMeta.name} updated to v${newMeta.version}` });
      }
    } catch {}
  }
  if (updated) await addLog({ scriptId:'', scriptName:'Updater', level:'info', msg:`Checked ${Object.values(scripts).length} scripts, updated ${updated}`, url:'' });
  return updated;
}

function refreshUpdateAlarm() {
  getSettings().then(s => {
    const mins = Math.max(30, (parseInt(s.updateInterval) || 12) * 60);
    chrome.alarms.create('kv_autoupdate', { periodInMinutes: mins });
  }).catch(() => {});
}

// ── Install interception ──────────────────────────────────────────
function openInstallPage(url) {
  chrome.tabs.create({ url: chrome.runtime.getURL('pages/install.html?url=' + encodeURIComponent(url)) });
}

// ── Element Picker ────────────────────────────────────────────────
const PICKER_CODE = `(function(){
  if(window.__kvPickerActive)return;
  window.__kvPickerActive=true;
  let hovered=null;
  const hl=document.createElement('div');
  hl.style.cssText='position:fixed;pointer-events:none;z-index:2147483647;outline:2px solid #e1062c;background:rgba(225,6,44,0.08);transition:all 0.1s;border-radius:2px;';
  document.body.appendChild(hl);
  const tip=document.createElement('div');
  tip.style.cssText='position:fixed;z-index:2147483647;background:#e1062c;color:#fff;font-family:monospace;font-size:11px;padding:3px 8px;border-radius:3px;pointer-events:none;white-space:nowrap;';
  document.body.appendChild(tip);
  function move(e){
    hovered=e.target;
    const r=hovered.getBoundingClientRect();
    Object.assign(hl.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});
    tip.style.left=r.left+'px';tip.style.top=(r.top-22)+'px';
    tip.textContent=hovered.tagName.toLowerCase()+(hovered.id?'#'+hovered.id:'')+(hovered.className&&typeof hovered.className==='string'?'.'+hovered.className.trim().split(/\\s+/).join('.'):'');
  }
  function click(e){
    e.preventDefault();e.stopPropagation();
    const sel=tip.textContent;
    cleanup();
    chrome.runtime.sendMessage({type:'HIDE_ELEMENT',selector:sel,url:location.hostname});
  }
  function keydown(e){if(e.key==='Escape')cleanup();}
  function cleanup(){hl.remove();tip.remove();window.__kvPickerActive=false;document.removeEventListener('mousemove',move,true);document.removeEventListener('click',click,true);document.removeEventListener('keydown',keydown,true);}
  document.addEventListener('mousemove',move,true);
  document.addEventListener('click',click,true);
  document.addEventListener('keydown',keydown,true);
})();`;

// ── Event Listeners ───────────────────────────────────────────────
chrome.webNavigation.onCommitted.addListener(({ tabId, url, frameId }) => { injectForTab(tabId, url, frameId, 'start'); });
chrome.webNavigation.onDOMContentLoaded.addListener(({ tabId, url, frameId }) => { injectForTab(tabId, url, frameId, 'end'); });
chrome.webNavigation.onCompleted.addListener(({ tabId, url, frameId }) => { injectForTab(tabId, url, frameId, 'idle'); });
chrome.commands.onCommand.addListener(cmd => { if (cmd === 'open-dashboard') chrome.runtime.openOptionsPage(); });
chrome.alarms.create('kv_autoupdate', { periodInMinutes: 720 });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'kv_autoupdate') checkUpdates(); });

// ── Context menus: install entries + @run-at context-menu scripts ──
function toMenuPattern(pattern) {
  if (pattern === '<all_urls>') return '<all_urls>';
  const p = String(pattern || '');
  if (p.startsWith('/')) return undefined;              // regex patterns can't map to MV3 menus
  if (!p.includes('://')) return undefined;
  return p;
}
async function rebuildScriptMenus() {
  try { await chrome.contextMenus.removeAll(); } catch {}
  chrome.contextMenus.create({ id: 'kv-install-link', title: 'Install userscript with KingVamp', contexts: ['link'], documentUrlPatterns: ['http://*/*', 'https://*/*'] });
  chrome.contextMenus.create({ id: 'kv-install-page', title: 'Install this userscript with KingVamp', contexts: ['page'], documentUrlPatterns: ['http://*/*', 'https://*/*'] });
  const scripts = await getScripts();
  const ctxScripts = Object.values(scripts).filter(s => s.enabled && s.meta?.['run-at'] === 'context-menu').slice(0, 12);
  if (!ctxScripts.length) return;
  chrome.contextMenus.create({ id: 'kv-run-menu', title: '▶ Run userscript', contexts: ['page', 'frame', 'link', 'selection'] });
  for (const s of ctxScripts) {
    const patterns = (s.meta?.match || []).map(toMenuPattern).filter(Boolean).slice(0, 30);
    chrome.contextMenus.create({ id: 'kv-run-' + s.id, parentId: 'kv-run-menu', title: s.meta?.name || s.id, contexts: ['page', 'frame', 'link', 'selection'], documentUrlPatterns: patterns.length ? patterns : undefined });
  }
}
async function runContextMenuScript(tabId, scriptId) {
  const scripts = await getScripts();
  const s = scripts[scriptId];
  if (!s || !s.enabled) return;
  await buildAndInject(tabId, 0, s, true);
}

chrome.runtime.onInstalled.addListener(() => { rebuildScriptMenus().catch(() => {}); });
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'kv-install-link' && info.linkUrl) openInstallPage(info.linkUrl);
  else if (info.menuItemId === 'kv-install-page' && tab?.url) openInstallPage(tab.url);
  else if (typeof info.menuItemId === 'string' && info.menuItemId.startsWith('kv-run-') && tab?.id !== undefined) runContextMenuScript(tab.id, info.menuItemId.slice(7)).catch(console.error);
});

// ── GM_notification / GM_download event forwarding to the page ────
chrome.notifications.onClosed.addListener(nid => {
  const cb = notifCallbacks.get(nid); if (!cb) return;
  notifCallbacks.delete(nid);
  if (cb.tabId !== undefined) chrome.tabs.sendMessage(cb.tabId, { __kvNotif: { nid: cb.nid, type: 'close', obj: {} } }).catch(() => {});
});
chrome.notifications.onClicked.addListener(nid => {
  const cb = notifCallbacks.get(nid); if (!cb) return;
  notifCallbacks.delete(nid);
  if (cb.tabId !== undefined) chrome.tabs.sendMessage(cb.tabId, { __kvNotif: { nid: cb.nid, type: 'click', obj: {} } }).catch(() => {});
});
chrome.downloads.onChanged.addListener(d => {
  const cb = d.id !== undefined ? dlCallbacks.get(d.id) : null;
  if (!cb || !d.state) return;
  if (d.state.current === 'complete') { dlCallbacks.delete(d.id); if (cb.tabId !== undefined) chrome.tabs.sendMessage(cb.tabId, { __kvDL: { did: cb.did, ok: true, downloadId: d.id } }).catch(() => {}); }
  else if (d.state.current === 'interrupted') { dlCallbacks.delete(d.id); if (cb.tabId !== undefined) chrome.tabs.sendMessage(cb.tabId, { __kvDL: { did: cb.did, ok: false, err: d.error || 'interrupted' } }).catch(() => {}); }
});

// ── Message Router ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.__kvApi) {
    handleApi(msg, sender).then(val => reply({ val })).catch(e => reply({ err: e.message }));
    return true;
  }
  const H = {
    GET_SCRIPTS: () => getScripts(),
    SAVE_SCRIPT: async () => { const r = await installScript(msg.code, msg.sourceUrl); rebuildScriptMenus().catch(() => {}); return r; },
    DELETE_SCRIPT: async () => { const s=await getScripts(); delete s[msg.id]; await saveScripts(s); rebuildScriptMenus().catch(() => {}); return {ok:true}; },
    TOGGLE_SCRIPT: async () => { const s=await getScripts(); if(s[msg.id]){s[msg.id].enabled=msg.enabled;await saveScripts(s);} rebuildScriptMenus().catch(() => {}); return {ok:true}; },
    GET_LOGS: () => get('kv_logs').then(l => l||[]),
    CLEAR_LOGS: async () => { await set('kv_logs',[]); return {ok:true}; },
    GET_NETLOG: () => get('kv_netlog').then(l => l||[]),
    CLEAR_NETLOG: async () => { await set('kv_netlog',[]); return {ok:true}; },
    GET_SETTINGS: () => getSettings(),
    SAVE_SETTINGS: async () => { await set('settings',msg.settings); refreshUpdateAlarm(); return {ok:true}; },
    GET_SITE_SETTINGS: () => getSiteSettings(),
    SAVE_SITE_SETTINGS: async () => { await set('siteSettings',msg.siteSettings); return {ok:true}; },
    GET_TAB_SCRIPTS: async () => { const [scripts,siteSettings]=await Promise.all([getScripts(),getSiteSettings()]); return {scripts:Object.values(scripts).filter(s=>scriptMatchesUrl(s,msg.url)),siteSettings}; },
    SCAN_SCRIPT: () => Promise.resolve(scanScript(msg.code)),
    PARSE_META: () => Promise.resolve(parseMeta(msg.code)),
    BUILD_DEFAULT: () => buildDefaultMeta(msg.host),
    CHECK_UPDATES: () => checkUpdates().then(n=>({ok:true,updated:n})),
    CHECK_UPDATE_SCRIPT: async () => {
      const scripts = await getScripts(); const s = scripts[msg.id];
      if (!s) return { ok:false, err:'Script not found' };
      const url = s.meta?.updateURL || s.meta?.downloadURL;
      if (!url) return { ok:false, err:'This script has no @updateURL' };
      const res = await fetch(url, { cache:'no-cache' });
      if (!res.ok) return { ok:false, err:'Update check failed: HTTP ' + res.status };
      const code = await res.text();
      const nm = parseMeta(code);
      if (semverGt(nm.version, s.meta?.version)) { const r = await installScript(code, url); return { ok:true, updated:true, name:nm.name, current:s.meta?.version, latest:nm.version }; }
      return { ok:true, updated:false, name:nm.name, current:s.meta?.version, latest:nm.version };
    },
    DUPLICATE_SCRIPT: async () => {
      const scripts = await getScripts(); const s = scripts[msg.id];
      if (!s) return { ok:false, err:'Script not found' };
      const code = String(s.code).replace(/(\/\/\s*@name\s+)(.+)/, (m, p, rest) => `${p}${rest.trim()} (copy)`);
      const r = await installScript(code, s.sourceUrl || 'duplicate');
      return { ok:true, id:r.id, name:r.script?.meta?.name, isUpdate:r.isUpdate };
    },
    RESET_STATS: async () => { const scripts=await getScripts(); if(scripts[msg.id]){ scripts[msg.id].runCount=0; scripts[msg.id].errorCount=0; await saveScripts(scripts);} return {ok:true}; },
    GET_STORAGE: async () => { const store=(await get('kv_store'))||{}; const pre=msg.id+':'; const out={}; for(const[k,v]of Object.entries(store))if(k.startsWith(pre))out[k.slice(pre.length)]=v; return out; },
    CLEAR_STORAGE: async () => { const store=(await get('kv_store'))||{}; const pre=msg.id+':'; for(const k of Object.keys(store))if(k.startsWith(pre))delete store[k]; await set('kv_store',store); return {ok:true}; },
    EXEC_CMD: () => { chrome.tabs.sendMessage(msg.tabId,{__kvCmd:{n:msg.name,sid:msg.scriptId}}).catch(()=>{}); return Promise.resolve(true); },
    INJECT_PICKER: async () => { await chrome.scripting.executeScript({target:{tabId:msg.tabId},func:code=>{(0,eval)(code)},args:[PICKER_CODE]}); return {ok:true}; },
    HIDE_ELEMENT: async () => { const store=(await get('kv_hides'))||{}; store[msg.url]=store[msg.url]||[]; if(!store[msg.url].includes(msg.selector))store[msg.url].push(msg.selector); await set('kv_hides',store); return {ok:true}; },
    GET_HIDES: () => get('kv_hides').then(h=>h||{}),
    CLEAR_HIDE: async () => { const store=(await get('kv_hides'))||{}; if(msg.selector){store[msg.url]=(store[msg.url]||[]).filter(s=>s!==msg.selector);if(!store[msg.url]?.length)delete store[msg.url];}else delete store[msg.url]; await set('kv_hides',store); return {ok:true}; },
    INJECT_HIDES: async () => { const store=(await get('kv_hides'))||{}; const sels=store[msg.hostname]||[]; if(!sels.length)return{ok:true}; await chrome.scripting.insertCSS({target:{tabId:msg.tabId},css:sels.map(s=>s+'{display:none!important}').join('\n')}); return {ok:true}; },
    INSTALL_URL: () => { openInstallPage(msg.url); return Promise.resolve({ok:true}); },
    OPEN_DASHBOARD: async () => { await chrome.runtime.openOptionsPage(); return {ok:true}; },
    INSTALL_FROM_PAGE: async () => {
      if (!msg.code || !String(msg.code).trim()) return { ok:false, err:'No userscript code received' };
      const r = await installScript(String(msg.code), msg.url || 'page');
      return { ok:true, id:r.id, name:r.script?.meta?.name || 'Script', isUpdate:r.isUpdate };
    },
  };
  if (msg.type && H[msg.type]) { H[msg.type]().then(reply).catch(e=>reply({err:e.message})); return true; }
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'loading' || !tab.url?.startsWith('http')) return;
  try { const hostname = new URL(tab.url).hostname; const store=(await get('kv_hides'))||{}; const sels=store[hostname]||[]; if(sels.length)await chrome.scripting.insertCSS({target:{tabId},css:sels.map(s=>s+'{display:none!important}').join('\n')}); } catch {}
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.kv_store) return;
  const { oldValue: ov={}, newValue: nv={} } = changes.kv_store;
  for (const k of new Set([...Object.keys(ov), ...Object.keys(nv)])) {
    if (ov[k] !== nv[k]) { const [sid,...rest]=k.split(':'); broadcastVC(sid,rest.join(':'),ov[k],nv[k],true); }
  }
});

console.log('[KingVamp] Engine v3.0.0 ready — cross-browser mode');
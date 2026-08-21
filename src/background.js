// KingVamp Background Service Worker v2.0.0

// ── Metadata Parser ──────────────────────────────────────────────
function parseMeta(code) {
  const block = code.match(/\/\/\s*==UserScript==\s*\n([\s\S]*?)\n\s*\/\/\s*==\/UserScript==/);
  if (!block) return { name: 'Unnamed Script' };
  const multi = ['match','include','exclude','exclude-match','require','resource','grant','connect'];
  const meta = {};
  for (const line of block[1].split('\n')) {
    const m = line.match(/^\s*\/\/\s*@(\S+)\s+(.*?)\s*$/);
    if (!m) continue;
    const [,key,val] = m;
    if (multi.includes(key)) { meta[key] = meta[key] || []; meta[key].push(val); }
    else meta[key] = val;
  }
  if (!meta.name) meta.name = 'Unnamed Script';
  return meta;
}

function buildDefaultMeta(host) {
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
// @run-at       document-idle
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
  return { globalEnabled:true, autoUpdate:true, showBadge:true, logLimit:500, updateInterval:12, aiModel:'', aiKey:'', ...s };
}
async function getSiteSettings() { return (await get('siteSettings')) || {}; }

// ── Logging ───────────────────────────────────────────────────────
async function addLog(entry) {
  let logs = (await get('kv_logs')) || [];
  logs.unshift({ ...entry, id: genId(), ts: Date.now() });
  const settings = await getSettings();
  if (logs.length > (settings.logLimit || 500)) logs.length = settings.logLimit;
  await set('kv_logs', logs);
  chrome.runtime.sendMessage({ _kv: 'LOG_NEW', entry: logs[0] }).catch(() => {});
}

async function addNetLog(entry) {
  let log = (await get('kv_netlog')) || [];
  log.unshift({ ...entry, id: genId(), ts: Date.now() });
  if (log.length > 500) log.length = 500;
  await set('kv_netlog', log);
  chrome.runtime.sendMessage({ _kv: 'NET_NEW', entry: log[0] }).catch(() => {});
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

// ── GM API Code Builder ───────────────────────────────────────────
function buildGmBoilerplate(scriptId, meta, resources) {
  const grants = meta.grant || [];
  const noGrant = grants.includes('none') || grants.length === 0;
  if (noGrant) return '// @grant none — no GM API injected\n';

  return `
const _kvId=${JSON.stringify(scriptId)};
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
  setTimeout(()=>{window.removeEventListener('message',fn)},10000);
});
const unsafeWindow=window;
const GM_info={
  script:{id:_kvId,name:${JSON.stringify(meta.name||'')},namespace:${JSON.stringify(meta.namespace||'')},version:${JSON.stringify(meta.version||'')},description:${JSON.stringify(meta.description||'')},matches:${JSON.stringify(meta.match||[])},grants:${JSON.stringify(grants)}},
  scriptHandler:'KingVamp',scriptHandlerVersion:'2.0.0',version:'2.0.0',
  isIncognito:false,downloadMode:'native',
};
const GM_getValue=(k,d)=>_kvCall('gv',{k,d});
const GM_setValue=(k,v)=>_kvCall('sv',{k,v});
const GM_deleteValue=k=>_kvCall('dv',{k});
const GM_listValues=()=>_kvCall('lv',{});
const GM_addValueChangeListener=(k,cb)=>{
  const lid=Math.random().toString(36).slice(2);
  _kvCall('avcl',{k,lid});
  window.addEventListener('message',e=>{
    if(e.data?.__kvVC?.sid===_kvId&&e.data.__kvVC.k===k)
      cb(k,e.data.__kvVC.o,e.data.__kvVC.n,e.data.__kvVC.r);
  });
  return lid;
};
const GM_removeValueChangeListener=lid=>_kvCall('rvcl',{lid});
const GM_addStyle=css=>{const el=document.createElement('style');el.textContent=css;(document.head||document.documentElement).appendChild(el);return el};
const GM_log=(...a)=>{const msg=a.map(x=>typeof x==='object'?JSON.stringify(x):String(x)).join(' ');console.log('[GM]',msg);_kvCall('log',{level:'log',msg})};
const GM_notification=(d,done)=>{const o=typeof d==='string'?{text:d}:d;_kvCall('notify',o);if(done)setTimeout(done,100)};
const GM_openInTab=(url,o)=>_kvCall('openTab',{url,opts:o||{}});
const GM_setClipboard=(data,type)=>_kvCall('clip',{data,type:type||'text'});
const GM_download=(d)=>_kvCall('dl',typeof d==='string'?{url:d}:d);
const GM_getResourceText=name=>{const r=_kvRes[name];if(!r)return null;try{return atob(r.dataUrl.split(',')[1])}catch{return null}};
const GM_getResourceURL=name=>_kvRes[name]?.dataUrl||null;
const GM_registerMenuCommand=(name,fn,ak)=>{
  _kvCall('regCmd',{name,ak});
  window.addEventListener('message',e=>{if(e.data?.__kvCmd?.n===name&&e.data.__kvCmd.sid===_kvId)fn()});
  return name;
};
const GM_unregisterMenuCommand=name=>_kvCall('unregCmd',{name});
const GM_xmlhttpRequest=details=>{
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
  return{abort:()=>_kvCall('xhrAbort',{xid})};
};
const GM_cookie={
  list:(d,cb)=>_kvCall('cookie',{action:'list',...d}).then(r=>cb(r,null)).catch(e=>cb(null,e.message)),
  set:(d,cb)=>_kvCall('cookie',{action:'set',...d}).then(r=>cb(r,null)).catch(e=>cb(null,e.message)),
  delete:(d,cb)=>_kvCall('cookie',{action:'delete',...d}).then(r=>cb(r,null)).catch(e=>cb(null,e.message)),
};
const GM={
  getValue:GM_getValue,setValue:GM_setValue,deleteValue:GM_deleteValue,listValues:GM_listValues,
  xmlHttpRequest:GM_xmlhttpRequest,notification:GM_notification,openInTab:GM_openInTab,
  setClipboard:GM_setClipboard,getResourceText:GM_getResourceText,getResourceUrl:GM_getResourceURL,
  registerMenuCommand:GM_registerMenuCommand,unregisterMenuCommand:GM_unregisterMenuCommand,
  download:GM_download,cookie:GM_cookie,info:GM_info,log:GM_log,
};`;
}

// ── Script Injection ──────────────────────────────────────────────
async function buildAndInject(tabId, frameId, script, injectImmediately) {
  const meta = script.meta || {};
  const requireCodes = await Promise.all((meta.require || []).map(loadRequire));
  const gm = buildGmBoilerplate(script.id, meta, script.resources || {});

  const wrapped = `(function(){\n"use strict";\n${gm}\n/* @require */\n${requireCodes.join('\n')}\n/* ${meta.name||script.id} */\n${script.code}\n})();`;

  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: 'MAIN',
      func: code => { try { (0,eval)(code); } catch(e) { console.error('[KV]',e.message); } },
      args: [wrapped],
      injectImmediately,
    });
    const scripts = await getScripts();
    if (scripts[script.id]) { scripts[script.id].runCount = (scripts[script.id].runCount||0)+1; scripts[script.id].lastRun = Date.now(); await saveScripts(scripts); }
    await addLog({ scriptId: script.id, scriptName: meta.name||script.id, level:'info', msg:'Injected at '+(meta['run-at']||'document-idle'), url:'' });
  } catch (e) {
    await addLog({ scriptId: script.id, scriptName: meta.name||script.id, level:'error', msg: e.message, url:'' });
    const scripts = await getScripts();
    if (scripts[script.id]) { scripts[script.id].errorCount = (scripts[script.id].errorCount||0)+1; await saveScripts(scripts); }
  }
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
    const runAt = RUN_AT[script.meta?.['run-at']] || 'idle';
    if (runAt !== phase) continue;
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
  if (type === 'log') { const scripts=await getScripts(); const name=scripts[scriptId]?.meta?.name||scriptId; await addLog({scriptId,scriptName:name,level:data.level||'log',msg:data.msg,url:sender.url||''}); return true; }
  if (type === 'notify') { chrome.notifications.create({type:'basic',iconUrl:'../icons/icon48.png',title:data.title||'KingVamp Script',message:data.text||data.message||'',silent:!!data.silent}); return true; }
  if (type === 'openTab') { chrome.tabs.create({url:data.url,active:data.opts?.active!==false}); return true; }
  if (type === 'clip') { await set('kv_clipboard',data.data); return true; }
  if (type === 'dl') { chrome.downloads.download({url:data.url,filename:data.name,saveAs:!!data.saveAs}); return true; }
  if (type === 'regCmd') {
    const scripts = await getScripts();
    if (scripts[scriptId]) { scripts[scriptId].menuCommands=scripts[scriptId].menuCommands||{}; scripts[scriptId].menuCommands[data.name]={name:data.name,ak:data.ak}; await saveScripts(scripts); }
    return true;
  }
  if (type === 'unregCmd') { const scripts=await getScripts(); if(scripts[scriptId]?.menuCommands){delete scripts[scriptId].menuCommands[data.name];await saveScripts(scripts);} return true; }
  if (type === 'xhr') {
    const ctrl = new AbortController();
    activeXhrs.set(data.xid, ctrl);
    const t0 = Date.now();
    const tabId = sender.tab?.id;
    try {
      const res = await fetch(data.url, { method:data.method||'GET', headers:data.headers, body:data.body||undefined, signal:ctrl.signal });
      const dur = Date.now()-t0;
      let resp = data.responseType==='json' ? await res.json() : await res.text();
      const response = { status:res.status, statusText:res.statusText, responseText:typeof resp==='string'?resp:'', response:resp, finalUrl:res.url, readyState:4, responseHeaders:[...res.headers.entries()].map(([k,v])=>`${k}: ${v}`).join('\r\n') };
      addNetLog({scriptId,method:data.method,url:data.url,status:res.status,dur,size:typeof resp==='string'?resp.length:0});
      if (tabId) chrome.tabs.sendMessage(tabId, {__kvXR:data.xid,event:'load',response}).catch(()=>{});
    } catch(e) {
      if (tabId) chrome.tabs.sendMessage(tabId, {__kvXR:data.xid,event:e.name==='AbortError'?'abort':'error',response:{error:e.message}}).catch(()=>{});
      addNetLog({scriptId,method:data.method,url:data.url,status:0,dur:Date.now()-t0,size:0});
    } finally { activeXhrs.delete(data.xid); }
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
        chrome.notifications.create({ type:'basic', iconUrl:'../icons/icon48.png', title:'KingVamp — Updated', message:`${newMeta.name} updated to v${newMeta.version}` });
      }
    } catch {}
  }
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

// ── Message Router ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.__kvApi) {
    handleApi(msg, sender).then(val => reply({ val })).catch(e => reply({ err: e.message }));
    return true;
  }
  const H = {
    GET_SCRIPTS: () => getScripts(),
    SAVE_SCRIPT: () => installScript(msg.code, msg.sourceUrl),
    DELETE_SCRIPT: async () => { const s=await getScripts(); delete s[msg.id]; await saveScripts(s); return {ok:true}; },
    TOGGLE_SCRIPT: async () => { const s=await getScripts(); if(s[msg.id]){s[msg.id].enabled=msg.enabled;await saveScripts(s);} return {ok:true}; },
    GET_LOGS: () => get('kv_logs').then(l => l||[]),
    CLEAR_LOGS: async () => { await set('kv_logs',[]); return {ok:true}; },
    GET_NETLOG: () => get('kv_netlog').then(l => l||[]),
    CLEAR_NETLOG: async () => { await set('kv_netlog',[]); return {ok:true}; },
    GET_SETTINGS: () => getSettings(),
    SAVE_SETTINGS: async () => { await set('settings',msg.settings); return {ok:true}; },
    GET_SITE_SETTINGS: () => getSiteSettings(),
    SAVE_SITE_SETTINGS: async () => { await set('siteSettings',msg.siteSettings); return {ok:true}; },
    GET_TAB_SCRIPTS: async () => { const [scripts,siteSettings]=await Promise.all([getScripts(),getSiteSettings()]); return {scripts:Object.values(scripts).filter(s=>scriptMatchesUrl(s,msg.url)),siteSettings}; },
    SCAN_SCRIPT: () => Promise.resolve(scanScript(msg.code)),
    PARSE_META: () => Promise.resolve(parseMeta(msg.code)),
    BUILD_DEFAULT: () => Promise.resolve(buildDefaultMeta(msg.host)),
    CHECK_UPDATES: () => checkUpdates().then(()=>({ok:true})),
    GET_STORAGE: async () => { const store=(await get('kv_store'))||{}; const pre=msg.id+':'; const out={}; for(const[k,v]of Object.entries(store))if(k.startsWith(pre))out[k.slice(pre.length)]=v; return out; },
    CLEAR_STORAGE: async () => { const store=(await get('kv_store'))||{}; const pre=msg.id+':'; for(const k of Object.keys(store))if(k.startsWith(pre))delete store[k]; await set('kv_store',store); return {ok:true}; },
    EXEC_CMD: () => { chrome.tabs.sendMessage(msg.tabId,{__kvCmd:{n:msg.name,sid:msg.scriptId}}).catch(()=>{}); return Promise.resolve(true); },
    INJECT_PICKER: async () => { await chrome.scripting.executeScript({target:{tabId:msg.tabId},world:'MAIN',func:code=>{(0,eval)(code)},args:[PICKER_CODE]}); return {ok:true}; },
    HIDE_ELEMENT: async () => { const store=(await get('kv_hides'))||{}; store[msg.url]=store[msg.url]||[]; if(!store[msg.url].includes(msg.selector))store[msg.url].push(msg.selector); await set('kv_hides',store); return {ok:true}; },
    GET_HIDES: () => get('kv_hides').then(h=>h||{}),
    CLEAR_HIDE: async () => { const store=(await get('kv_hides'))||{}; if(msg.selector){store[msg.url]=(store[msg.url]||[]).filter(s=>s!==msg.selector);if(!store[msg.url]?.length)delete store[msg.url];}else delete store[msg.url]; await set('kv_hides',store); return {ok:true}; },
    INJECT_HIDES: async () => { const store=(await get('kv_hides'))||{}; const sels=store[msg.hostname]||[]; if(!sels.length)return{ok:true}; await chrome.scripting.insertCSS({target:{tabId:msg.tabId},css:sels.map(s=>s+'{display:none!important}').join('\n')}); return {ok:true}; },
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

console.log('[KingVamp] Service worker v2.0.0 ready');

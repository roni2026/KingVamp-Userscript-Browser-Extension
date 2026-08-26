// KingVamp Dashboard v3.0.0
const $ = id => document.getElementById(id);
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const msg = (type, data = {}) => chrome.runtime.sendMessage({ type, ...data });
const fmtTime = ts => new Date(ts).toLocaleTimeString();
const fmtDate = ts => new Date(ts).toLocaleDateString();
const fmtSize = b => b > 1048576 ? (b/1048576).toFixed(1)+'MB' : b > 1024 ? (b/1024).toFixed(1)+'KB' : b+'B';
const editorUrl = id => chrome.runtime.getURL('pages/editor.html') + (id ? '?id='+id : '?new=1');
let allScripts = {}, settings = {}, selectedId = null;
let logs = [], netlog = [];
const tabs = document.querySelectorAll('.tab');
const panes = document.querySelectorAll('.tab-pane');
function switchTab(name) {
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  panes.forEach(p => p.classList.toggle('active', p.id === 'pane-' + name));
  if (name === 'logs') loadLogs();
  if (name === 'network') loadNetlog();
  if (name === 'tools') loadTools();
  if (name === 'settings') loadSettings();
  if (name === 'ai') loadAiSettings();
  history.replaceState(null, '', '#' + name);
}
tabs.forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
async function init() {
  [allScripts, settings] = await Promise.all([msg('GET_SCRIPTS'), msg('GET_SETTINGS')]);
  const gt = $('globalToggle');
  gt.checked = settings.globalEnabled !== false;
  updateHdrStatus(gt.checked);
  gt.addEventListener('change', async () => { settings.globalEnabled = gt.checked; await msg('SAVE_SETTINGS', { settings }); updateHdrStatus(gt.checked); });
  renderScripts();
  const hash = location.hash.replace('#','') || 'scripts';
  switchTab(hash);
  chrome.runtime.onMessage.addListener(m => {
    if (m._kv === 'LOG_NEW') { logs.unshift(m.entry); renderLogRow(m.entry); updateTabCount('tabCountLogs', logs.length); }
    if (m._kv === 'NET_NEW') { netlog.unshift(m.entry); renderNetRow(m.entry); updateTabCount('tabCountNet', netlog.length); }
  });
  $('importFile').addEventListener('change', handleImportFiles);
  $('btnImport').addEventListener('click', () => $('importFile').click());
  $('btnExport').addEventListener('click', exportAllScripts);
  $('btnNew').addEventListener('click', () => chrome.tabs.create({ url: editorUrl() }));
  $('scriptSearch').addEventListener('input', renderScripts);
  $('scriptSort').addEventListener('change', renderScripts);
}
function updateHdrStatus(active) { const b = $('hdrStatus'); b.textContent = active ? 'Active' : 'Paused'; b.className = active ? 'badge badge-green' : 'badge badge-muted'; }
function updateTabCount(id, n) { const el = $(id); if (el) el.textContent = n || ''; }
function renderScripts() {
  const q = ($('scriptSearch')?.value || '').toLowerCase();
  const sort = $('scriptSort')?.value || 'name';
  const list = $('scriptList');
  let arr = Object.values(allScripts);
  if (q) arr = arr.filter(s => (s.meta?.name||'').toLowerCase().includes(q) || (s.meta?.description||'').toLowerCase().includes(q));
  arr.sort((a,b) => {
    if (sort === 'name') return (a.meta?.name||'').localeCompare(b.meta?.name||'');
    if (sort === 'installed') return (b.installed||0) - (a.installed||0);
    if (sort === 'updated') return (b.updated||0) - (a.updated||0);
    if (sort === 'runs') return (b.runCount||0) - (a.runCount||0);
    return 0;
  });
  updateTabCount('tabCountScripts', arr.length);
  const statsRow = $('statsRow');
  if (arr.length) {
    statsRow.style.display = '';
    const total=arr.length,enabled=arr.filter(s=>s.enabled).length,errors=arr.reduce((a,s)=>a+(s.errorCount||0),0),runs=arr.reduce((a,s)=>a+(s.runCount||0),0);
    statsRow.innerHTML = `<div class="stat-tile"><div class="stat-value">${total}</div><div class="stat-label">Scripts</div></div><div class="stat-tile"><div class="stat-value" style="color:var(--green)">${enabled}</div><div class="stat-label">Active</div></div><div class="stat-tile"><div class="stat-value" style="color:var(--muted)">${total-enabled}</div><div class="stat-label">Disabled</div></div><div class="stat-tile"><div class="stat-value">${runs}</div><div class="stat-label">Total Runs</div></div><div class="stat-tile"><div class="stat-value" style="color:${errors?'var(--red)':'var(--text)'}">${errors}</div><div class="stat-label">Errors</div></div>`;
  } else statsRow.style.display = 'none';
  if (!arr.length) { list.innerHTML = `<div class="empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg><div class="empty-title">${q?'No matching scripts':'No scripts installed'}</div><div class="empty-sub">${q?'Try a different search':'Click New Script or import a .user.js to get started'}</div></div>`; return; }
  list.innerHTML = arr.map(s => {
    const name=esc(s.meta?.name||s.id),desc=esc(s.meta?.description||''),ver=s.meta?.version?`<span class="badge badge-muted">v${esc(s.meta.version)}</span>`:'',runAt=s.meta?.['run-at']?`<span class="script-run-at">${esc(s.meta['run-at'])}</span>`:'',errs=s.errorCount?`<span class="badge badge-red">⚠ ${s.errorCount} err</span>`:'',runs=s.runCount?`<span style="font-size:10px;color:var(--muted2)">${s.runCount}×</span>`:'',icon=s.meta?.icon?`<img src="${esc(s.meta.icon)}" alt="" onerror="this.outerHTML='<span class=script-icon-letter>${(s.meta?.name||'?')[0].toUpperCase()}</span>'">`:`<span class="script-icon-letter">${(s.meta?.name||'?')[0].toUpperCase()}</span>`,matches=(s.meta?.match||[]).slice(0,2).map(m=>`<span class="tag">${esc(m)}</span>`).join('');
    return `<div class="script-row${selectedId===s.id?' selected':''}" data-id="${s.id}"><div class="script-icon">${icon}</div><div class="script-info"><div class="script-name">${name}</div><div class="script-meta">${ver}${runAt}${errs}${runs}</div>${desc?`<div style="font-size:11px;color:var(--muted);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${desc}</div>`:''}<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">${matches}</div></div><div class="script-actions"><button class="btn ghost icon" data-edit="${s.id}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button><label class="switch"><input type="checkbox" class="stoggle" data-id="${s.id}" ${s.enabled?'checked':''}><span class="track"></span></label></div></div>`;
  }).join('');
  list.querySelectorAll('.script-row').forEach(el => { el.addEventListener('click', e => { if(e.target.closest('button,label,input'))return; selectScript(el.dataset.id); }); });
  list.querySelectorAll('[data-edit]').forEach(el => el.addEventListener('click', () => chrome.tabs.create({ url: editorUrl(el.dataset.edit) })));
  list.querySelectorAll('.stoggle').forEach(el => el.addEventListener('change', async () => { await msg('TOGGLE_SCRIPT',{id:el.dataset.id,enabled:el.checked}); allScripts[el.dataset.id].enabled=el.checked; if(selectedId===el.dataset.id)showDetail(allScripts[el.dataset.id]); }));
}
function selectScript(id) { selectedId=id; document.querySelectorAll('.script-row').forEach(r=>r.classList.toggle('selected',r.dataset.id===id)); showDetail(allScripts[id]); }
function showDetail(s) {
  if (!s) return;
  const panel=$('detailPanel'); panel.classList.remove('hidden');
  const m=s.meta||{};
  $('detailName').textContent=m.name||s.id; $('detailNs').textContent=m.namespace||''; $('detailEnabled').checked=s.enabled!==false;
  $('detailIcon').innerHTML=m.icon?`<img src="${esc(m.icon)}" style="width:22px;height:22px;border-radius:4px" alt="">`:`<span class="script-icon-letter">${(m.name||'?')[0].toUpperCase()}</span>`;
  const rows=[['Version',m.version?`v${m.version}`:'—'],['Author',m.author||'—'],['Run at',m['run-at']||'document-idle'],['Installed',fmtDate(s.installed)],['Updated',fmtDate(s.updated)],['Total Runs',(s.runCount||0).toLocaleString()],['Errors',(s.errorCount||0).toLocaleString()],...(m.match||[]).map((v,i)=>[i===0?'Match':'',v])].filter(([,v])=>v!==undefined);
  $('detailMeta').innerHTML=rows.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  const scan=s.scanResults||[];
  $('detailScan').innerHTML=!scan.length?`<div class="scan-clean"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> No threats detected</div>`:scan.map(r=>`<div class="scan-item"><span class="scan-sev ${r.sev}">${r.sev}</span><span class="scan-msg">${esc(r.msg)}</span></div>`).join('');
  $('detailEnabled').onchange=async()=>{await msg('TOGGLE_SCRIPT',{id:s.id,enabled:$('detailEnabled').checked});allScripts[s.id].enabled=$('detailEnabled').checked;renderScripts();};
  $('detailEdit').onclick=()=>chrome.tabs.create({url:editorUrl(s.id)});
  $('detailExport').onclick=()=>exportScript(s);
  $('detailDelete').onclick=async()=>{ if(!confirm(`Delete "${m.name||s.id}"?`))return; await msg('DELETE_SCRIPT',{id:s.id}); delete allScripts[s.id]; panel.classList.add('hidden'); selectedId=null; renderScripts(); };
  $('detailClose').onclick=()=>{ panel.classList.add('hidden'); selectedId=null; document.querySelectorAll('.script-row').forEach(r=>r.classList.remove('selected')); };
}
async function loadLogs() {
  if (!logs.length) logs = await msg('GET_LOGS') || [];
  const filtered = filterLogs(); $('logList').innerHTML = ''; filtered.slice(0,300).forEach(l=>renderLogRow(l));
  updateTabCount('tabCountLogs', logs.length);
  $('btnClearLogs').onclick=async()=>{await msg('CLEAR_LOGS');logs=[];$('logList').innerHTML='';updateTabCount('tabCountLogs',0);};
  $('logSearch').oninput=renderFilteredLogs;
  ['fLog','fInfo','fWarn','fError'].forEach(id=>{const el=$(id);if(el)el.onchange=renderFilteredLogs;});
}
function filterLogs() {
  const q=($('logSearch')?.value||'').toLowerCase(),fLog=$('fLog')?.checked!==false,fInfo=$('fInfo')?.checked!==false,fWarn=$('fWarn')?.checked!==false,fErr=$('fError')?.checked!==false;
  return logs.filter(l=>{if(!fLog&&l.level==='log')return false;if(!fInfo&&l.level==='info')return false;if(!fWarn&&l.level==='warn')return false;if(!fErr&&l.level==='error')return false;if(q&&!(l.msg||'').toLowerCase().includes(q)&&!(l.scriptName||'').toLowerCase().includes(q))return false;return true;});
}
function renderFilteredLogs(){$('logList').innerHTML='';filterLogs().slice(0,300).forEach(renderLogRow);}
function renderLogRow(l){const el=document.createElement('div');el.className='log-row';el.innerHTML=`<span class="log-lv ${l.level||'log'}">${esc(l.level||'log')}</span><span class="log-time">${fmtTime(l.ts)}</span><span class="log-src">${esc((l.scriptName||'').slice(0,20))}</span><span class="log-msg">${esc(l.msg)}</span>`;$('logList')?.prepend(el);}
async function loadNetlog(){
  if(!netlog.length)netlog=await msg('GET_NETLOG')||[];
  $('netList').innerHTML='';netlog.slice(0,200).forEach(renderNetRow);updateTabCount('tabCountNet',netlog.length);updateNetStats();
  $('btnClearNet').onclick=async()=>{await msg('CLEAR_NETLOG');netlog=[];$('netList').innerHTML='';updateTabCount('tabCountNet',0);$('netStats').textContent='';};
  $('netSearch').oninput=()=>{const q=$('netSearch').value.toLowerCase();$('netList').innerHTML='';netlog.filter(l=>(l.url||'').toLowerCase().includes(q)).slice(0,200).forEach(renderNetRow);};
}
function updateNetStats(){if(!netlog.length)return;const ok=netlog.filter(l=>l.status>=200&&l.status<300).length,err=netlog.filter(l=>l.status===0||l.status>=400).length;$('netStats').textContent=`${netlog.length} requests · ${ok} ok · ${err} errors`;}
function renderNetRow(l){const status=l.status||0,cls=status>=200&&status<300?'ok':status>=400||status===0?'err':'pend',el=document.createElement('div');el.className='net-row';el.innerHTML=`<span class="net-method">${esc(l.method||'GET')}</span><span class="net-status ${cls}">${status||'—'}</span><span class="net-url" title="${esc(l.url||'')}">${esc(l.url||'')}</span><span class="net-script">${esc((allScripts[l.scriptId]?.meta?.name||l.scriptId||'').slice(0,18))}</span><span class="net-dur">${l.dur||0}ms</span><span class="net-size">${l.size?fmtSize(l.size):''}</span>`;$('netList')?.prepend(el);}
const RECIPES=[
  {name:'Auto-dismiss Cookie Banners',desc:'Hides cookie consent overlays on any site',code:`// ==UserScript==\n// @name         Cookie Banner Killer\n// @match        *://*/*\n// @run-at       document-end\n// @grant        GM_addStyle\n// ==/UserScript==\n(function(){\n  GM_addStyle('[class*="cookie"],[id*="cookie"],[class*="gdpr"],[class*="consent"],[id*="consent"],[class*="banner"]{display:none!important}');\n  new MutationObserver(()=>document.querySelectorAll('[class*="cookie"],[id*="cookie"]').forEach(el=>el.remove())).observe(document.body,{childList:true,subtree:true});\n})();`},
  {name:'Dark Mode Everywhere',desc:'Force dark colors on any webpage',code:`// ==UserScript==\n// @name         Universal Dark Mode\n// @match        *://*/*\n// @run-at       document-start\n// @grant        GM_addStyle\n// ==/UserScript==\n(function(){\n  GM_addStyle('html{filter:invert(1) hue-rotate(180deg)!important}img,video,picture,canvas{filter:invert(1) hue-rotate(180deg)!important}');\n})();`},
  {name:'URL Tracker Cleaner',desc:'Remove utm_*, fbclid, gclid tracking params',code:`// ==UserScript==\n// @name         URL Cleaner\n// @match        *://*/*\n// @run-at       document-start\n// @grant        none\n// ==/UserScript==\n(function(){\n  const PARAMS=['utm_source','utm_medium','utm_campaign','utm_term','utm_content','fbclid','gclid','msclkid'];\n  const url=new URL(location.href);let changed=false;\n  PARAMS.forEach(p=>{if(url.searchParams.has(p)){url.searchParams.delete(p);changed=true;}});\n  if(changed)history.replaceState(null,'',url.toString());\n})();`},
  {name:'YouTube Speed Controls',desc:'Fine-grained playback speed for YouTube',code:`// ==UserScript==\n// @name         YouTube Speed Controls\n// @match        *://www.youtube.com/*\n// @run-at       document-idle\n// @grant        GM_addStyle\n// ==/UserScript==\n(function(){\n  GM_addStyle('#kv-speed{position:fixed;bottom:80px;right:20px;z-index:9999;background:#0a0a12;border:1px solid #e1062c;border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:6px;font-family:monospace}#kv-speed button{background:#16162a;border:1px solid #2e2e4a;color:#fff;border-radius:4px;padding:4px 10px;cursor:pointer}#kv-speed button:hover{background:#e1062c}');\n  const box=document.createElement('div');box.id='kv-speed';\n  [0.5,0.75,1,1.25,1.5,1.75,2].forEach(s=>{const b=document.createElement('button');b.textContent=s+'x';b.onclick=()=>{const v=document.querySelector('video');if(v)v.playbackRate=s;};box.appendChild(b);});\n  document.body.appendChild(box);\n})();`},
  {name:'Back to Top Button',desc:'Adds a floating back-to-top button',code:`// ==UserScript==\n// @name         Back to Top Button\n// @match        *://*/*\n// @run-at       document-idle\n// @grant        GM_addStyle\n// ==/UserScript==\n(function(){\n  GM_addStyle('#kv-top{position:fixed;bottom:24px;right:24px;z-index:99999;width:40px;height:40px;border-radius:50%;background:#e1062c;color:#fff;border:none;cursor:pointer;font-size:18px;display:none;align-items:center;justify-content:center}');\n  const btn=document.createElement('button');btn.id='kv-top';btn.textContent='↑';btn.onclick=()=>window.scrollTo({top:0,behavior:'smooth'});\n  document.body.appendChild(btn);\n  window.addEventListener('scroll',()=>{btn.style.display=window.scrollY>300?'flex':'none'});\n})();`},
  {name:'Custom CSS Injector',desc:'Inject your own CSS into any site',code:`// ==UserScript==\n// @name         Custom CSS Injector\n// @match        *://*/*\n// @run-at       document-start\n// @grant        GM_addStyle\n// @grant        GM_getValue\n// ==/UserScript==\n(function(){\n  GM_getValue('custom_css','').then(css=>{if(css)GM_addStyle(css);});\n})();`},
];
async function loadTools(){
  $('recipeList').innerHTML=RECIPES.map((r,i)=>`<div class="recipe-item" data-idx="${i}"><div><div class="recipe-name">${esc(r.name)}</div><div class="recipe-desc">${esc(r.desc)}</div></div><button class="btn sm primary" data-idx="${i}">Use</button></div>`).join('');
  $('recipeList').querySelectorAll('[data-idx]').forEach(el=>{el.addEventListener('click',e=>{const btn=e.target.closest('button');if(!btn)return;const r=RECIPES[btn.dataset.idx];chrome.tabs.create({url:editorUrl()+'&code='+encodeURIComponent(r.code)});});});
  const hides=await msg('GET_HIDES')||{};
  const hideList=$('hideList');
  if(!Object.keys(hides).length){hideList.innerHTML='<span style="color:var(--muted);font-size:12px">No hidden elements yet.</span>';}else{hideList.innerHTML=`<table class="hide-table"><thead><tr><th>Site</th><th>Selector</th><th></th></tr></thead><tbody>${Object.entries(hides).flatMap(([site,sels])=>sels.map(sel=>`<tr><td>${esc(site)}</td><td>${esc(sel)}</td><td><button class="btn danger sm" data-site="${esc(site)}" data-sel="${esc(sel)}">×</button></td></tr>`)).join('')}</tbody></table>`;hideList.querySelectorAll('[data-site]').forEach(btn=>{btn.addEventListener('click',async()=>{await msg('CLEAR_HIDE',{url:btn.dataset.site,selector:btn.dataset.sel});loadTools();});});}
  const scripts=Object.values(allScripts),sel=$('storageScriptSel');
  sel.innerHTML=scripts.map(s=>`<option value="${s.id}">${esc(s.meta?.name||s.id)}</option>`).join('');
  const loadStorage=async()=>{const id=sel.value,data=await msg('GET_STORAGE',{id})||{};$('storageTbody').innerHTML=Object.entries(data).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(typeof v==='object'?JSON.stringify(v):String(v))}</td></tr>`).join('')||'<tr><td colspan="2" style="color:var(--muted)">No values stored</td></tr>';};
  sel.onchange=loadStorage;if(scripts.length)loadStorage();
  $('btnClearStorage').onclick=async()=>{if(!confirm('Clear all stored values for this script?'))return;await msg('CLEAR_STORAGE',{id:sel.value});loadStorage();};
  $('btnExportZip').onclick=()=>exportZip();$('btnExportJson').onclick=()=>exportJson();
  $('btnImportJson').onclick=()=>$('backupFile').click();$('backupFile').onchange=e=>importJson(e.target.files[0]);
  $('btnCheckUpdates').onclick=async()=>{$('btnCheckUpdates').textContent='Checking…';$('btnCheckUpdates').disabled=true;const r=await msg('CHECK_UPDATES');$('btnCheckUpdates').textContent='Check for Updates';$('btnCheckUpdates').disabled=false;$('updateResult').textContent=r?.updated?`Updated ${r.updated} script${r.updated!==1?'s':''} to the latest version.`:'All scripts are up to date.'};
}
let aiGenerated='';
async function loadAiSettings(){
  const s=await msg('GET_SETTINGS');
  $('aiKey').value=s.aiKey||'';$('aiEndpoint').value=s.aiEndpoint||'https://api.openai.com/v1/chat/completions';$('aiModel').value=s.aiModel||'gpt-4o';
  $('btnSaveAi').onclick=async()=>{await msg('SAVE_SETTINGS',{settings:{...s,aiKey:$('aiKey').value,aiEndpoint:$('aiEndpoint').value,aiModel:$('aiModel').value}});$('btnSaveAi').textContent='Saved!';setTimeout(()=>{$('btnSaveAi').textContent='Save API Settings';},1500);};
  $('btnAiGenerate').onclick=generateScript;
  $('btnAiInstall').onclick=async()=>{if(!aiGenerated)return;await msg('SAVE_SCRIPT',{code:aiGenerated});allScripts=await msg('GET_SCRIPTS');renderScripts();switchTab('scripts');};
}
async function generateScript(){
  const prompt=$('aiPrompt').value.trim();if(!prompt)return;
  const s=await msg('GET_SETTINGS'),apiKey=s.aiKey||'',endpoint=s.aiEndpoint||'https://api.openai.com/v1/chat/completions',model=s.aiModel||'gpt-4o';
  if(!apiKey){alert('Please configure your API key in the AI Settings section.');return;}
  const btn=$('btnAiGenerate');btn.disabled=true;btn.textContent='Generating…';
  const out=$('aiOutput');out.className='ai-output';out.textContent='Calling API…';
  try{
    const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${apiKey}`},body:JSON.stringify({model,messages:[{role:'system',content:'You are an expert userscript developer. Write a complete Tampermonkey-compatible userscript. Output ONLY raw code starting with // ==UserScript==.'},{role:'user',content:`Write a userscript that: ${prompt}${$('aiSite').value?`\nTarget site: ${$('aiSite').value}`:''}\nRun at: ${$('aiRunAt').value}`}],temperature:0.7})});
    if(!res.ok)throw new Error(`API error ${res.status}`);
    const data=await res.json();aiGenerated=(data.choices?.[0]?.message?.content||'').trim();
    out.textContent=aiGenerated;$('btnAiInstall').disabled=!aiGenerated;
  }catch(e){out.textContent='Error: '+e.message;aiGenerated='';}
  finally{btn.disabled=false;btn.textContent='Generate Script';}
}
async function loadSettings(){
  const s=await msg('GET_SETTINGS'),siteSettings=await msg('GET_SITE_SETTINGS')||{};
  $('setGlobal').checked=s.globalEnabled!==false;$('setBadge').checked=s.showBadge!==false;$('setAutoUpdate').checked=s.autoUpdate!==false;$('setLogLimit').value=s.logLimit||500;
  // editor settings
  $('setEdTheme').value=s.editorTheme||'dracula';$('setEdKeymap').value=s.editorKeymap||'default';
  $('setEdTabSize').value=String(s.editorTabSize||2);$('setEdFontSize').value=String(s.editorFontSize||13);
  $('setEdWrap').checked=!!s.editorWrap;$('setEdLint').checked=s.editorLint!==false;$('setEdAutoSave').checked=!!s.editorAutoSave;
  ['setEdTheme','setEdKeymap','setEdTabSize','setEdFontSize','setEdWrap','setEdLint','setEdAutoSave'].forEach(id=>{$(id).onchange=async()=>{const m={editorTheme:$('setEdTheme').value,editorKeymap:$('setEdKeymap').value,editorTabSize:+$('setEdTabSize').value,editorFontSize:+$('setEdFontSize').value,editorWrap:$('setEdWrap').checked,editorLint:$('setEdLint').checked,editorAutoSave:$('setEdAutoSave').checked};await msg('SAVE_SETTINGS',{settings:{...s,...m}});};});
  const blocked=Object.entries(siteSettings).filter(([,v])=>v?.disabled).map(([k])=>k);
  renderBlocklist(blocked,siteSettings);
  $('btnAddBlock').onclick=async()=>{const host=$('blocklistInput').value.trim().replace(/^https?:\/\//,'').split('/')[0];if(!host)return;siteSettings[host]={...siteSettings[host],disabled:true};await msg('SAVE_SITE_SETTINGS',{siteSettings});$('blocklistInput').value='';loadSettings();};
  chrome.storage.local.getBytesInUse(null,bytes=>{$('storageInfo').innerHTML=`<div class="setting-row"><div class="setting-info"><div class="setting-name">Local Storage Used</div><div class="setting-desc">Scripts, logs, values, settings</div></div><span style="font-family:var(--mono);font-size:13px">${(bytes/1024).toFixed(1)} KB</span></div>`;});
  $('btnSaveSettings').onclick=async()=>{const updated={...s,globalEnabled:$('setGlobal').checked,showBadge:$('setBadge').checked,autoUpdate:$('setAutoUpdate').checked,logLimit:parseInt($('setLogLimit').value)||500};await msg('SAVE_SETTINGS',{settings:updated});updateHdrStatus(updated.globalEnabled);$('btnSaveSettings').textContent='Saved!';setTimeout(()=>{$('btnSaveSettings').textContent='Save Settings';},1500);};
  $('btnResetSettings').onclick=async()=>{if(!confirm('Reset all settings to defaults?'))return;await msg('SAVE_SETTINGS',{settings:{globalEnabled:true,autoUpdate:true,showBadge:true,logLimit:500}});loadSettings();};
}
function renderBlocklist(blocked,siteSettings){
  const el=$('blocklistRows');if(!blocked.length){el.innerHTML='<div style="font-size:12px;color:var(--muted);padding:4px 0">No blocked domains</div>';return;}
  el.innerHTML=blocked.map(h=>`<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)"><span style="flex:1;font-family:var(--mono);font-size:12px">${esc(h)}</span><button class="btn danger sm" data-host="${esc(h)}">Remove</button></div>`).join('');
  el.querySelectorAll('[data-host]').forEach(btn=>{btn.onclick=async()=>{delete siteSettings[btn.dataset.host];await msg('SAVE_SITE_SETTINGS',{siteSettings});loadSettings();};});
}
async function handleImportFiles(e){
  for(const file of e.target.files){const code=await file.text();await msg('SAVE_SCRIPT',{code,sourceUrl:file.name});}
  allScripts=await msg('GET_SCRIPTS');renderScripts();e.target.value='';
}
function exportScript(s){const blob=new Blob([s.code],{type:'text/javascript'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(s.meta?.name||s.id).replace(/[^\w.-]/g,'_')+'.user.js';a.click();}
function exportAllScripts(){const scripts=Object.values(allScripts);if(!scripts.length)return;const blob=new Blob([scripts.map(s=>`// FILE: ${s.meta?.name||s.id}.user.js\n${s.code}`).join('\n\n// ---\n\n')],{type:'text/plain'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='KingVamp_scripts.txt';a.click();}
async function exportJson(){const blob=new Blob([JSON.stringify({version:'3.0.0',exported:new Date().toISOString(),scripts:allScripts},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='kingvamp-backup.json';a.click();}
async function exportZip(){const scripts=Object.values(allScripts),parts=['KingVamp Backup\n=====\n\n',JSON.stringify({version:'3.0.0',exported:new Date().toISOString()},null,2),'\n\n'];scripts.forEach(s=>parts.push(`\n--- ${s.meta?.name||s.id} ---\n${s.code}\n`));const blob=new Blob(parts,{type:'text/plain'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='kingvamp-backup.txt';a.click();}
async function importJson(file){if(!file)return;try{const data=JSON.parse(await file.text()),scripts=data.scripts||{};let count=0;for(const s of Object.values(scripts)){if(s.code){await msg('SAVE_SCRIPT',{code:s.code,sourceUrl:'backup'});count++;}}allScripts=await msg('GET_SCRIPTS');renderScripts();alert(`Imported ${count} scripts.`);}catch(e){alert('Import failed: '+e.message);}}
document.addEventListener('dragover',e=>e.preventDefault());
document.addEventListener('drop',async e=>{e.preventDefault();const files=[...e.dataTransfer.files].filter(f=>f.name.endsWith('.js'));for(const file of files)await msg('SAVE_SCRIPT',{code:await file.text(),sourceUrl:file.name});if(files.length){allScripts=await msg('GET_SCRIPTS');renderScripts();switchTab('scripts');}});
init().catch(console.error);

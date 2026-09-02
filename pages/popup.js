// KingVamp Popup v3.0.0
const $=id=>document.getElementById(id);
const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const msg=(type,data={})=>chrome.runtime.sendMessage({type,...data});
const editorUrl=id=>chrome.runtime.getURL('pages/editor.html')+(id?'?id='+id:'?new=1');
async function openEditorTab(opts = {}) {
  const base = chrome.runtime.getURL('pages/editor.html');
  const existing = await chrome.tabs.query({ url: base + '*' });
  if (existing.length) {
    await chrome.windows.update(existing[0].windowId, { focused: true });
    await chrome.tabs.update(existing[0].id, { active: true });
    chrome.runtime.sendMessage({ type: 'KV_OPEN_TAB', ...opts });
  } else {
    const p = new URLSearchParams();
    if (opts.id) p.set('id', opts.id); else p.set('new', '1');
    if (opts.host) p.set('host', opts.host);
    if (opts.code) p.set('code', opts.code);
    chrome.tabs.create({ url: base + '?' + p.toString() });
  }
}
const dashUrl=hash=>chrome.runtime.getURL('pages/dashboard.html')+(hash?'#'+hash:'');
let tab,url,hostname,scripts=[],siteSettings={},settings={},tabDataScripts=[],allScriptsCache=null;
let listMode='tab';
async function init(){
  [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  url=tab?.url||'';
  try{hostname=url?new URL(url).hostname:'';}catch{hostname='';}
  $('siteHost').textContent=hostname||'this page';
  const[cfg,tabData]=await Promise.all([msg('GET_SETTINGS'),url?msg('GET_TAB_SCRIPTS',{url}):null]);
  settings=cfg||{};scripts=tabData?.scripts||[];tabDataScripts=scripts;siteSettings=tabData?.siteSettings||{};
  fetchAllScripts().then(all=>{ if($('allCount')) $('allCount').textContent=all.length; });
  document.querySelectorAll('.seg-btn').forEach(b=>b.addEventListener('click',()=>setListMode(b.dataset.mode)));
  const gt=$('globalToggle');
  gt.checked=settings.globalEnabled!==false;
  setStatus(gt.checked);
  gt.addEventListener('change',async()=>{settings.globalEnabled=gt.checked;await msg('SAVE_SETTINGS',{settings});setStatus(gt.checked);});
  const st=$('siteToggle');
  st.checked=!siteSettings[hostname]?.disabled;
  st.addEventListener('change',async()=>{siteSettings[hostname]={...siteSettings[hostname],disabled:!st.checked};await msg('SAVE_SITE_SETTINGS',{siteSettings});});
  renderScripts();renderCommands();bindButtons();
  const errors=scripts.filter(s=>s.errorCount>0);
  if(errors.length){$('errorBanner').style.display='';$('errorBanner').textContent=`⚠ ${errors.length} script${errors.length>1?' have':' has'} recent errors — check the logs`;}
}
function setStatus(active){$('statusDot').classList.toggle('paused',!active);$('statusLabel').textContent=active?'Active':'Paused';}
async function fetchAllScripts(){ if(allScriptsCache)return allScriptsCache; const all=await msg('GET_SCRIPTS'); allScriptsCache=Object.values(all); return allScriptsCache; }
function renderScripts(){
  const list=$('scriptList');
  if(!scripts.length){list.innerHTML='<div class="no-scripts">'+(listMode==='tab'?'No scripts match this page':'No scripts installed')+'</div>';return;}
  list.innerHTML=scripts.map(s=>{
    const name=esc(s.meta?.name||s.id);
    const ver=s.meta?.version?`v${esc(s.meta.version)}`:'',runs=s.runCount?`<span class="run-badge">${s.runCount}×</span>`:'',errs=s.errorCount?`<span class="badge badge-red">${s.errorCount} err</span>`:'';
    const matchTag=listMode==='all'&&(s.meta?.match||[]).length?`<div style="font-family:var(--mono);font-size:9.5px;color:var(--muted2);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.meta.match[0])}</div>`:'';
    const icon=s.meta?.icon?`<img src="${esc(s.meta.icon)}" alt="" onerror="this.style.display='none'">`:`<div class="script-icon-letter">${(s.meta?.name||'?')[0].toUpperCase()}</div>`;
    return `<div class="script-row"><div class="script-icon">${icon}</div><div class="script-info"><div class="script-name" title="${name}">${name}</div><div class="script-meta">${ver?`<span>${ver}</span>`:''}${runs}${errs}</div>${matchTag}</div><div class="script-actions"><button class="btn ghost icon" data-edit="${s.id}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button><label class="switch"><input type="checkbox" class="stoggle" data-id="${s.id}" ${s.enabled?'checked':''}><span class="track"></span></label></div></div>`;
  }).join('');
  list.querySelectorAll('[data-edit]').forEach(el=>el.addEventListener('click',()=>{openEditorTab({ id: el.dataset.edit });window.close();}));
  list.querySelectorAll('.stoggle').forEach(el=>el.addEventListener('change',async()=>{await msg('TOGGLE_SCRIPT',{id:el.dataset.id,enabled:el.checked});const t=allScriptsCache?.find(x=>x.id===el.dataset.id);if(t){t.enabled=el.checked;t.runCount=(t.runCount||0);}if(listMode==='tab'){const sc=scripts.find(x=>x.id===el.dataset.id);if(sc)sc.enabled=el.checked;}}));
}
function setListMode(m){
  listMode=m;
  document.querySelectorAll('.seg-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));
  if(m==='all'){fetchAllScripts().then(all=>{scripts=all;renderScripts();renderCommands();});}
  else {scripts=tabDataScripts;renderScripts();renderCommands();}
}
function renderCommands(){
  const cmds=scripts.flatMap(s=>Object.values(s.menuCommands||{}).map(c=>({...c,sid:s.id,sname:s.meta?.name||s.id})));
  if(!cmds.length){$('cmdSection').style.display='none';return;}
  $('cmdSection').style.display='';
  $('cmdList').innerHTML=cmds.map(c=>`<div class="cmd-row"><span class="cmd-who">${esc(c.sname)}</span><button class="btn ghost" style="flex:1;text-align:left;justify-content:flex-start" data-cmd="${esc(c.name)}" data-sid="${c.sid}">${esc(c.name)}${c.ak?`<kbd style="margin-left:auto">${esc(c.ak)}</kbd>`:''}</button></div>`).join('');
  $('cmdList').querySelectorAll('[data-cmd]').forEach(el=>el.addEventListener('click',()=>msg('EXEC_CMD',{tabId:tab.id,name:el.dataset.cmd,scriptId:el.dataset.sid})));
}
function bindButtons(){
  $('btnHide').addEventListener('click',async()=>{await msg('INJECT_PICKER',{tabId:tab.id});window.close();});
  $('btnNew').addEventListener('click',()=>{openEditorTab({ host: hostname });window.close();});
  $('btnInstallUrl').addEventListener('click',()=>{const u=$('installUrl').value.trim();if(!u)return;if(!/^https?:\/\//i.test(u)){alert('Enter a full http(s) URL ending in .user.js');return;}chrome.tabs.create({url:chrome.runtime.getURL('pages/install.html?url='+encodeURIComponent(u))});window.close();});
  $('installUrl').addEventListener('keydown',e=>{if(e.key==='Enter')$('btnInstallUrl').click();});
  $('btnDash').addEventListener('click',()=>{chrome.runtime.openOptionsPage();window.close();});
  $('footLogs').addEventListener('click',e=>{e.preventDefault();chrome.tabs.create({url:dashUrl('logs')});window.close();});
  $('footSettings').addEventListener('click',e=>{e.preventDefault();chrome.tabs.create({url:dashUrl('settings')});window.close();});
}
init().catch(console.error);

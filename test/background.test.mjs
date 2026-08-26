// KingVamp engine tests — loads src/background.js in a VM with a stubbed
// chrome API and exercises the pure logic (metadata parsing, URL matching,
// update comparison, safety scanning, GM boilerplate, @connect policy).
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src/background.js'), 'utf8');

// ── chrome stub ───────────────────────────────────────────────────
const noop = () => {};
const storage = { local: { data: {}, async get(k) { return typeof k === 'string' ? { [k]: this.data[k] } : this.data; }, async set(obj) { Object.assign(this.data, obj); } }, onChanged: { addListener: noop } };
const onMsg = { addListener: noop };
const webNav = { onCommitted: { addListener: noop }, onDOMContentLoaded: { addListener: noop }, onCompleted: { addListener: noop } };
const chromeStub = {
  runtime: {
    onMessage: onMsg, onInstalled: { addListener: noop }, onStartup: { addListener: noop },
    sendMessage: noop, openOptionsPage: noop, getBrowserInfo: undefined,
  },
  webNavigation: webNav,
  commands: { onCommand: { addListener: noop } },
  alarms: { create: noop, onAlarm: { addListener: noop } },
  tabs: { onUpdated: { addListener: noop }, query: async () => [], create: noop, sendMessage: noop },
  storage,
  scripting: { executeScript: noop, insertCSS: noop },
  action: { setBadgeText: noop, setBadgeBackgroundColor: noop },
  notifications: { create: noop },
  downloads: { download: noop },
  cookies: { getAll: noop, set: noop, remove: noop },
  contextMenus: { removeAll: cb => cb && cb(), create: noop, onClicked: { addListener: noop } },
};
const ctx = createContext({ chrome: chromeStub, console, URL, Map, Set, setTimeout, clearTimeout, fetch: async () => { throw new Error('no network in tests'); } });
runInContext(src, ctx);

const { parseMeta, matchPattern, scriptMatchesUrl, semverGt, scanScript, buildGmBoilerplate, isConnectAllowed, buildDefaultMeta } = ctx;

let pass = 0, fail = 0;
function assert(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

console.log('parseMeta');
{
  const meta = parseMeta(`// ==UserScript==
// @name         Test Script
// @namespace    https://example.com/
// @version      1.2.3
// @match        *://*.example.com/*
// @match        https://other.org/*
// @exclude      *://bad.example.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @noframes
// @connect      api.example.com
// @run-at       document-start
// ==/UserScript==
console.log('hi');`);
  assert('name', meta.name === 'Test Script');
  assert('version', meta.version === '1.2.3');
  assert('multi match', Array.isArray(meta.match) && meta.match.length === 2);
  assert('multi grant', meta.grant.length === 2);
  assert('connect', meta.connect && meta.connect[0] === 'api.example.com');
  assert('noframes flag', meta.noframes === true);
  assert('run-at', meta['run-at'] === 'document-start');
  const noBlock = parseMeta('const x = 1;');
  assert('no block fallback', noBlock.name === 'Unnamed Script');
}

console.log('matchPattern');
{
  assert('exact host', matchPattern('https://example.com/*', 'https://example.com/a/b'));
  assert('wildcard subdomain', matchPattern('*://*.example.com/*', 'https://sub.example.com/x'));
  assert('apex matches *.pattern', matchPattern('*://*.example.com/*', 'https://example.com/x'));
  assert('wrong host rejected', !matchPattern('*://*.example.com/*', 'https://other.com/x'));
  assert('all_urls', matchPattern('<all_urls>', 'https://anything.io/path?q=1'));
  assert('scheme wildcard', matchPattern('*://example.com/*', 'http://example.com/'));
  assert('path with query', matchPattern('https://example.com/search*', 'https://example.com/search?q=hello'));
  assert('bare pattern (regex-ish)', matchPattern('https://example.com/*', 'https://example.com/'));
  assert('http only rejected for https pattern', !matchPattern('http://example.com/*', 'https://example.com/'));
}

console.log('scriptMatchesUrl');
{
  const s = { enabled: true, meta: { match: ['*://*.example.com/*'], exclude: ['*://bad.example.com/*'] } };
  assert('match', scriptMatchesUrl(s, 'https://ok.example.com/'));
  assert('excluded', !scriptMatchesUrl(s, 'https://bad.example.com/'));
  assert('disabled', !scriptMatchesUrl({ ...s, enabled: false }, 'https://ok.example.com/'));
  assert('no patterns', !scriptMatchesUrl({ enabled: true, meta: {} }, 'https://x.com/'));
}

console.log('semverGt');
{
  assert('newer', semverGt('2.0.0', '1.9.9'));
  assert('older', !semverGt('1.0.0', '2.0.0'));
  assert('equal', !semverGt('1.0.0', '1.0.0'));
  assert('patch bump', semverGt('1.0.1', '1.0.0'));
  assert('missing versions', !semverGt('', '1.0.0') && !semverGt('1.0.0', ''));
}

console.log('scanScript');
{
  const hits = scanScript('eval("x"); GM_xmlhttpRequest({url:"https://a.b"}); document.cookie;');
  const sevs = hits.map(h => h.sev);
  assert('eval warn', sevs.includes('warn'));
  assert('xhr info', sevs.includes('info'));
  assert('cookie info', sevs.includes('info'));
  assert('clean script', scanScript('console.log("nothing")').length === 0);
}

console.log('isConnectAllowed');
{
  const meta = { connect: ['api.example.com'] };
  assert('declared connect', isConnectAllowed(meta, 'site.com', 'https://api.example.com/v1').ok);
  assert('declared subdomain covers host', isConnectAllowed(meta, 'site.com', 'https://api.example.com.somethingelse.com/x').ok === false);
  assert('star connect', isConnectAllowed({ connect: ['*'] }, 'site.com', 'https://anywhere.io/').ok);
  assert('same origin', isConnectAllowed({}, 'site.com', 'https://site.com/x').ok);
  assert('denied third party', !isConnectAllowed({}, 'site.com', 'https://other.com/x').ok);
  assert('no @connect granted', !isConnectAllowed({}, 'site.com', 'https://api.example.com/v1').ok);
}

console.log('buildGmBoilerplate');
{
  const full = buildGmBoilerplate('kvt1', { name: 'S', grant: ['GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest', 'GM_getTab'] }, {});
  assert('granted API defined', full.includes('const GM_getValue=') && full.includes('const GM_xmlhttpRequest='));
  assert('granted tab API defined', full.includes('const GM_getTab='));
  assert('ungranted API omitted', !full.includes('const GM_notification=') && !full.includes('const GM_download='));
  assert('GM_info always present', full.includes('const GM_info='));
  assert('version stamped', full.includes('scriptHandlerVersion:\'3.0.0\''));
  const none = buildGmBoilerplate('kvt2', { name: 'S', grant: ['none'] }, {});
  assert('grant none → nothing injected', none.includes('no GM API injected') && !none.includes('const GM_getValue='));
  const empty = buildGmBoilerplate('kvt3', { name: 'S' }, {});
  assert('no grants → @grant none path', empty.includes('no GM API injected'));
}

console.log('buildDefaultMeta');
{
  const d = buildDefaultMeta('example.com');
  assert('default matches host', d.includes('@match        *://example.com/*'));
  const g = buildDefaultMeta('');
  assert('default matches all', g.includes('@match        *://*/*'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
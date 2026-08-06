// KingVamp shared helpers: userscript metadata parsing + URL matching.
// Works both as a classic script (extension pages) and inside the module service worker.
(function () {
  'use strict';

  function escapeRe(s) {
    return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }

  // Parse the ==UserScript== metadata block.
  function parseMetadata(code) {
    const meta = {
      name: '', namespace: '', version: '', description: '', author: '',
      matches: [], includes: [], excludes: [], grants: [],
      runAt: '', noframes: false, updateURL: '', downloadURL: '',
      require: [], resource: [], connect: [], icon: '', homepage: ''
    };
    const m = String(code).match(/==UserScript==([\s\S]*?)==\/UserScript==/);
    if (!m) return meta;
    for (const raw of m[1].split('\n')) {
      const lm = raw.match(/^\s*\/\/\s*@([a-zA-Z-]+)\s*(.*)$/);
      if (!lm) continue;
      const key = lm[1].toLowerCase();
      const val = lm[2].trim();
      switch (key) {
        case 'name': meta.name = val; break;
        case 'namespace': meta.namespace = val; break;
        case 'version': meta.version = val; break;
        case 'description': meta.description = val; break;
        case 'author': meta.author = val; break;
        case 'match': if (val) meta.matches.push(val); break;
        case 'include': if (val) meta.includes.push(val); break;
        case 'exclude': case 'exclude-match': if (val) meta.excludes.push(val); break;
        case 'grant': if (val) meta.grants.push(val); break;
        case 'run-at': meta.runAt = val; break;
        case 'noframes': meta.noframes = true; break;
        case 'updateurl': meta.updateURL = val; break;
        case 'downloadurl': meta.downloadURL = val; break;
        case 'require': if (val) meta.require.push(val); break;
        case 'resource': {
          const p = val.split(/\s+/);
          if (p.length >= 2) meta.resource.push({ name: p[0], url: p.slice(1).join(' ') });
          break;
        }
        case 'connect': if (val) meta.connect.push(val); break;
        case 'icon': meta.icon = val; break;
        case 'homepage': case 'homepageurl': case 'website': meta.homepage = val; break;
      }
    }
    return meta;
  }

  // Chrome-style match pattern: scheme://host/path  e.g. *://*.example.com/*
  function matchPattern(pattern, url) {
    if (!pattern) return false;
    if (pattern === '<all_urls>') return /^https?:\/\//.test(url);
    const m = pattern.match(/^(\*|http|https):\/\/([^/]*)(\/.*)$/);
    if (!m) return false;
    const scheme = m[1] === '*' ? 'https?' : m[1];
    let host;
    if (m[2] === '*') host = '[^/]+';
    else if (m[2].startsWith('*.')) host = '([^/]+\\.)?' + escapeRe(m[2].slice(2));
    else host = escapeRe(m[2]);
    const path = escapeRe(m[3]).replace(/\\\*/g, '.*');
    try { return new RegExp('^' + scheme + ':\\/\\/' + host + path + '$').test(url); }
    catch (e) { return false; }
  }

  // Tampermonkey-style @include rule: glob with * or /regex/.
  function includeMatches(rule, url) {
    if (!rule) return false;
    if (rule.length > 1 && rule.startsWith('/') && rule.lastIndexOf('/') > 0) {
      try {
        const i = rule.lastIndexOf('/');
        return new RegExp(rule.slice(1, i), rule.slice(i + 1)).test(url);
      } catch (e) { return false; }
    }
    try {
      const re = '^' + escapeRe(rule).replace(/\\\*/g, '.*') + '$';
      return new RegExp(re).test(url);
    } catch (e) { return false; }
  }

  // Does a script object apply to this URL?
  // Honors per-script user rules: userExcludes always win, userIncludes add sites.
  function urlMatches(url, script) {
    if (!/^https?:/.test(url)) return false;
    for (const e of (script.excludes || []).concat(script.userExcludes || [])) {
      if (matchPattern(e, url) || includeMatches(e, url)) return false;
    }
    for (const p of script.matches || []) if (matchPattern(p, url)) return true;
    for (const r of script.includes || []) if (includeMatches(r, url)) return true;
    for (const u of script.userIncludes || []) {
      if (matchPattern(u, url) || includeMatches(u, url)) return true;
    }
    return false;
  }

  // Is version a greater than version b? ("1.10.2" > "1.9.9")
  function semverGt(a, b) {
    const pa = String(a || '0').split(/[^0-9]+/).filter(Boolean).map(Number);
    const pb = String(b || '0').split(/[^0-9]+/).filter(Boolean).map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x > y) return true;
      if (x < y) return false;
    }
    return false;
  }

  globalThis.KVMatch = { parseMetadata, matchPattern, includeMatches, urlMatches, semverGt };
})();

// KingVamp Script Auditor - static safety scan, explained in plain language.
(function () {
  'use strict';

  function audit(code) {
    const findings = [];
    const src = String(code || '');

    if (/\beval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*['"]|setInterval\s*\(\s*['"]/.test(src)) {
      findings.push({ level: 'risk', title: 'Runs hidden code', detail: 'This script can build and run code on the fly, which makes it impossible to fully review. Malicious scripts use this to hide what they do.' });
    }
    if (/document\.cookie/.test(src)) {
      findings.push({ level: 'warn', title: 'Touches your cookies', detail: 'It reads or writes cookies. Cookies can hold your login sessions, so only keep scripts you trust with this.' });
    }
    if (/\batob\s*\(|fromCharCode|[A-Za-z0-9+/]{240,}={0,2}/.test(src)) {
      findings.push({ level: 'warn', title: 'Contains scrambled code', detail: 'Parts of this script are obfuscated (scrambled). Legitimate scripts rarely need to hide their code.' });
    }
    const urls = src.match(/https?:\/\/[a-z0-9.-]+/gi) || [];
    const domains = [...new Set(urls.map(u => u.replace(/^https?:\/\//, '')))].slice(0, 8);
    if (/GM_xmlhttpRequest|GM\.xmlhttpRequest|XMLHttpRequest|\bfetch\s*\(/.test(src)) {
      findings.push({ level: 'info', title: 'Makes network requests', detail: 'It talks to the internet' + (domains.length ? ': ' + domains.join(', ') : '') + '. Watch the Privacy Guard tab to see exactly where your data goes.' });
    }
    if (/localStorage|sessionStorage/.test(src)) {
      findings.push({ level: 'info', title: 'Reads site storage', detail: 'It reads data the website stored in your browser.' });
    }
    if (/coinhive|cryptonight|crypto-?miner|webminer/i.test(src)) {
      findings.push({ level: 'risk', title: 'Possible cryptominer', detail: 'This looks like it could mine cryptocurrency using your computer. Delete it unless you are absolutely sure.' });
    }
    if (/while\s*\(\s*!?\s*1\s*\)|while\s*\(\s*true\s*\)/.test(src)) {
      findings.push({ level: 'warn', title: 'Can freeze pages', detail: 'It contains an endless loop which can make pages unresponsive if misused.' });
    }
    if (!findings.length) {
      findings.push({ level: 'ok', title: 'Nothing suspicious found', detail: 'The automatic scan found no risky patterns. You can always watch real behavior in the Privacy Guard tab.' });
    }
    return findings;
  }

  globalThis.KVAudit = { audit };
})();

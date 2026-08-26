#!/usr/bin/env node
/**
 * KingVamp build script — packages the extension for every browser.
 *
 *   node scripts/build.mjs            # build dist/chrome + dist/firefox + zips
 *
 * - Chromium family (Chrome, Edge, Brave, Opera, Vivaldi): dist/chrome/
 *   uses manifest.json (MV3 service worker + MAIN-world injection).
 * - Firefox: dist/firefox/ uses manifest.firefox.json (MV3 event page +
 *   MAIN-world injection relayed via the bridge content script).
 * - Safari: run `xcrun safari-web-extension-converter dist/chrome` (Xcode) —
 *   the code is chrome/browser namespace compatible.
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const VERSION = '3.0.0';
const EXCLUDE = new Set(['.git', 'dist', 'node_modules', 'scripts', 'test', '.DS_Store']);

function copyAll(dest) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(root)) {
    if (EXCLUDE.has(name)) continue;
    const src = join(root, name);
    if (statSync(src).isDirectory()) cpSync(src, join(dest, name), { recursive: true });
    else cpSync(src, join(dest, name));
  }
}

function zip(dir, out) {
  try {
    execSync(`cd "${dir}" && zip -rq "${out}" . -x "*.DS_Store"`);
    return true;
  } catch { return false; }
}

console.log(`→ Building KingVamp v${VERSION} for all browsers…`);

copyAll(join(dist, 'chrome'));
console.log('  ✓ dist/chrome   (Chromium: Chrome / Edge / Brave / Opera)');

copyAll(join(dist, 'firefox'));
const ffManifest = JSON.parse(readFileSync(join(root, 'manifest.firefox.json'), 'utf8'));
writeFileSync(join(dist, 'firefox', 'manifest.json'), JSON.stringify(ffManifest, null, 2));
console.log('  ✓ dist/firefox  (Firefox 128+)');

if (zip(join(dist, 'chrome'), join(dist, `kingvamp-chrome-${VERSION}.zip`))) console.log(`  ✓ dist/kingvamp-chrome-${VERSION}.zip`);
if (zip(join(dist, 'firefox'), join(dist, `kingvamp-firefox-${VERSION}.zip`))) console.log(`  ✓ dist/kingvamp-firefox-${VERSION}.zip`);

console.log('\nDone. Install:');
console.log('  Chrome/Edge/Brave/Opera  → chrome://extensions → Developer mode → Load unpacked → dist/chrome');
console.log('  Firefox                  → about:debugging#/runtime/this-firefox → Load Temporary Add-on → dist/firefox/manifest.json');
console.log('  Safari                   → xcrun safari-web-extension-converter dist/chrome  (then build the Xcode project)');
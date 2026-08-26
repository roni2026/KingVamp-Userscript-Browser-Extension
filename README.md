# KingVamp v3.0.0

A privacy-first, **cross-browser userscript manager** — a Tampermonkey alternative that runs 100% on your own machine. No telemetry, no accounts, no external calls. Built from scratch, works with existing Tampermonkey/Greasemonkey scripts and `GM_*` APIs.

> Chrome · Edge · Brave · Opera · Vivaldi · Firefox 128+ · Safari (via converter)

---

## ✨ What it does

**Engine (Tampermonkey-parity)**

- Runs userscripts on `<all_urls>` with `@match` / `@include` / `@exclude` / `@exclude-match` / `@noframes` support (**TLD wildcards like `*://*.example.*/` included**), injected at `document-start` / `document-body` / `document-end` / `document-idle` / **`context-menu`** (right-click → ▶ Run userscript)
- Full `GM_*` API: `GM_getValue` / `GM_setValue` / `GM_deleteValue` / `GM_listValues` / `GM_addValueChangeListener` / `GM_getTab` / `GM_saveTab` / `GM_getTabs` / `GM_addStyle` / `GM_log` / `GM_xmlhttpRequest` (incl. `timeout`, `responseType: json|arraybuffer|blob`) / `GM_notification` (callbacks: `onclick`/`ondone`/`timeout`/`tag`) / `GM_openInTab` / `GM_setClipboard` / `GM_download` (callbacks: `onload`/`onerror`/`onabort`) / `GM_getResourceText` / `GM_getResourceURL` / `GM_registerMenuCommand` / `GM_unregisterMenuCommand` / `GM_cookie` / `GM_info` / `unsafeWindow` — **grant-gated**, only declared APIs are injected, and with `@grant none` `GM_info` stays available (Tampermonkey behaviour)
- `@require` libraries, `@resource` files, `@updateURL` / `@downloadURL` auto-updates (scheduled **or per-script** via the dashboard detail panel), `@unwrap` support
- `@connect` enforcement: `GM_xmlhttpRequest` only reaches origins you declare, exactly like Tampermonkey
- Trust helpers: safety scanner, **`@antifeature` disclosure on the install page**, script storage browser, backup/restore, per-script **Duplicate** / **Reset Stats** / **Check Update** actions
- Install interception: click any `*.user.js` link → KingVamp installs it; visit a raw `.user.js` page → install banner appears; right-click any link → "Install userscript with KingVamp"

**Advanced code editor (Tampermonkey-class)**

- Syntax-highlighted JavaScript with **line numbers**
- **Live linting — errors & warnings marked in the gutter, beside the line**, with squiggly underlines, hover tooltips and a clickable error panel
- Metadata-block validation (missing `@name`, no `@match`, invalid patterns, unknown keys, duplicates)
- Code folding (braces / comments / indentation), active-line highlight, bracket matching, auto-close brackets
- Find / replace (regex-capable, persistent panel), **go to line (Ctrl+G)**, toggle comments, duplicate/delete line, jump to next/previous error (F8 / Shift+F8)
- Theme picker (Dracula, Monokai, Material, Solarized), **keymap presets: Default / Sublime Text / Vim / Emacs**
- One-click format (js-beautify), fullscreen mode (F11), font size & tab size controls, word wrap
- `⋯` menu: **Export as .user.js, copy code, remove trailing whitespace, sort lines, Save & close (Ctrl+Enter)**
- **`@key` autocomplete inside the metadata block**, auto-save option, editable metadata sidebar (match, exclude, grant, require, resource, connect, run-at, URLs, license, `@noframes`)

**Popup & settings**

- **This Tab / All Scripts** toggle with counts, per-tab script list, menu commands with access-key hints, install-from-URL field
- Dashboard: log-level filter, **default `@run-at` for new scripts**, editor settings, per-script update check

**Dashboard**

- Script list with search/sort, per-site blocklist, master switch, run counts & error badges
- Console (log/info/warn/error filterable), Network monitor (every `GM_xmlhttpRequest`), hidden-elements manager, element picker
- AI script writer (bring your own API key), script templates, storage browser, backup/restore

---

## 📦 Installation

### Chromium — Chrome, Edge, Brave, Opera, Vivaldi

1. `git clone https://github.com/roni2026/KingVamp-Userscript-Browser-Extension`
2. Open `chrome://extensions` (Edge: `edge://extensions`)
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the repo folder (or `dist/chrome`)
5. Legend: `Ctrl+Shift+K` / `Cmd+Shift+K` opens the dashboard

### Firefox (128+)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `dist/firefox/manifest.json` (build it first: `npm run build`, or use the repo's `manifest.firefox.json` manually)
4. For a permanent install, submit `dist/firefox/` to [addons.mozilla.org](https://addons.mozilla.org)

> Firefox can't inject scripts into the page's MAIN world from a background service worker, so KingVamp automatically switches to its bridge relay: the userscript is executed via a `<script>` element from the content script. Same result, no CSP bypass needed.

### Safari

```bash
xcrun safari-web-extension-converter dist/chrome
```
Then open the generated Xcode project, run it, and enable the extension in Safari → Settings → Extensions. All extension code uses the standard `chrome`/`browser` namespaces so Safari's converter can translate it.

---

## ⌨️ Editor shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+S` / `Cmd+S` | Save (works in every keymap) |
| `Ctrl+F` / `Ctrl+H` | Find / Replace (persistent panels) |
| `Ctrl+G` | Go to line |
| `Ctrl+/` | Toggle comment |
| `Ctrl+Shift+F` | Format code |
| `F8` / `Shift+F8` | Next / previous error |
| `Ctrl+Shift+[` / `]` | Fold / unfold all |
| `Ctrl+Enter` | Save & close (back to dashboard) |
| `Ctrl+D` / `Ctrl+Shift+D` | Duplicate / delete line |
| `Ctrl+L` | Select line |
| `Ctrl+]` / `Ctrl+[` | Indent / outdent |
| `Ctrl+Space` | Autocomplete (GM APIs + JS) |
| `F11` | Fullscreen editor |

---

## 🛠️ Development

```bash
npm run check    # syntax-check every JS file
npm test         # run the engine logic test suite
npm run build    # build dist/chrome + dist/firefox and .zip bundles
```

**Architecture**

| File | Role |
| --- | --- |
| `src/background.js` | Engine: metadata parsing, URL matching, injection (MAIN world on Chromium, bridge relay on Firefox), GM API handlers, auto-updates, install interception, context menus, element picker |
| `src/bridge.js` | Content script: relays `GM_*` calls page ↔ background, executes Firefox MAIN-world injections, hijacks `.user.js` link clicks |
| `src/installDetect.js` | Content script: shows the install banner when a page *is* a userscript |
| `src/match.js`, `src/audit.js` | Shared metadata/matching and audit helpers |
| `pages/editor.html/js` | Advanced CodeMirror editor (lint, fold, keymaps, themes) |
| `pages/dashboard.html/js` | Script management, console, network, tools, AI, settings |
| `pages/popup.html/js` | Per-tab script list, menu commands, install-from-URL |
| `pages/install.html/js` | Install/update confirmation page |
| `lib/codemirror/` | Vendored CodeMirror 5 + addons + JSHint + js-beautify (offline, CSP-safe) |

**Manifests**

- `manifest.json` — Chromium (MV3 service worker + `world: "MAIN"` injection)
- `manifest.firefox.json` — Firefox (MV3 event page + bridge relay injection)
- `scripts/build.mjs` — generates `dist/chrome`, `dist/firefox` and zips

**Extending**

- GM APIs: add the function to `buildGmBoilerplate()` + its handler in `handleApi()` in `src/background.js`
- Lint rules: edit `kvLint()` / `metaLint()` in `pages/editor.js`
- Editor themes: drop a theme CSS into `lib/codemirror/theme/` and add an `<option>` in `pages/editor.html`

---

## 🔒 Privacy

KingVamp makes no network calls of its own except: fetching `@require`/`@resource`/`@updateURL` URLs your scripts declare, and calls you explicitly make through the AI writer. Everything (scripts, values, logs) stays in `chrome.storage.local`. There is no analytics, no phone-home, no account.

## License

MIT — see [LICENSE](LICENSE).
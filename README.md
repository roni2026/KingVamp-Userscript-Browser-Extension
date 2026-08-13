# KingVamp

A privacy-first userscript manager built as a Chrome extension from scratch — a Tampermonkey/Greasemonkey alternative that runs entirely on your own machine.

## Why this exists

Userscript managers like Tampermonkey are great, but they're closed source and you're trusting a third party with every site you run scripts on. KingVamp is built to do the same job — running custom JavaScript on any site you choose — without any of that data ever leaving your device. No telemetry, no external calls, no accounts.

## What it does

- Full userscript support with the standard `GM_*` API (`GM_setValue`, `GM_getValue`, `GM_addValueChangeListener`, and the rest) so existing Tampermonkey scripts mostly just work
- A code editor for writing and editing scripts directly in the extension (CodeMirror-based, with JavaScript syntax highlighting)
- Built-in safety scanner that checks a script before you run it
- A network monitor so you can see exactly what a running script is doing
- An AI script writer for generating userscripts from a plain description
- A dashboard for managing everything: installed scripts, logs, settings
- Dracula-themed UI throughout

## How it's built

Manifest V3 Chrome extension. `src/background.js` is the engine — it injects userscripts in a way that survives page CSP restrictions, handles all `GM_*` API calls from the background service worker, and manages logging, menu commands, and blocklists. `src/bridge.js` runs in the page itself at `document_start` to set up the communication channel scripts need. The dashboard, editor, popup, and install pages are plain HTML/JS under `pages/`.

## Installing

Load it unpacked: `chrome://extensions` → enable Developer mode → Load unpacked → select this folder. Use `Ctrl+Shift+K` (or `Cmd+Shift+K` on Mac) to open the dashboard once it's loaded.

## Background

This started as a set of Tampermonkey userscripts for Birchstreet (see [`BirchPort-Userscripts`](https://github.com/roni2026/BirchPort-Userscripts)) and grew into a full extension once it was clear a proper script manager was worth building from the ground up.

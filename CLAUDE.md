# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

JCRLattes is a Manifest V3 Chrome extension (vanilla JS, no framework, no bundler, no `package.json`) that annotates the Brazilian Lattes CV platform (CNPq) and the CNPq grant-proposal system with impact-factor (JCR) metrics, authorship analysis, and statistical reports. It also ships a standalone Python script for offline analysis of the extension's exported data.

**`dist/` is the source** — there is no build step. Chrome loads `dist/` directly as an unpacked extension, and edits are made straight to the files under `dist/scripts/`.

## Commands

- **Run/reload the extension**: `chrome://extensions/` → enable Developer Mode → "Load unpacked" → select `dist/`. After editing any file under `dist/`, reload the extension there and refresh the target tab.
- **Syntax-check a changed JS file** (do this automatically after every edit to a `.js` file, per `.agents/AGENTS.md` — don't ask first): `node -c dist/scripts/<file>.js`
- **No automated test suite exists.** Verification is manual: load the unpacked extension and open real or saved pages from `test_pages/` (sample Lattes CVs, "Produções e Orientações" pages, proposal PDFs — gitignored, kept locally for manual regression checks).
- **Python collaboration-graph tool** (independent of the extension, only shares its JSON data format):
  ```bash
  pip install networkx matplotlib
  cd tools
  python parse_jcr_backup.py jcr_lattes_database_backup.json --graph
  ```
  Options: `--target-custom-id "SIGLA"`, `--ignore-isolated`, `--target-researcher "Nome"`, or edit `tools/config.json` for defaults.

## Architecture

### Two independent content-script bundles, one shared core

`dist/manifest.json` injects two unrelated feature sets into two unrelated CNPq site families. Both share the same two base scripts, loaded first so their `window` globals exist before the page-specific script runs:

1. **`report_utils.js`** → `window.JCRReportUtils`: stateless-ish shared utilities — colors, number formatting, and all HTML generation for tables/graphs/histograms used by reports.
2. **`db_tools.js`** (largest file, ~5.3k lines) → `window.JCRDBTools`: the storage/database layer, settings, and license/authorization gating (`isUnlocked`, CA-member auth). Everything that touches `chrome.storage.local` for CV/proposal records goes through here.

Feature-specific scripts loaded after these two:
- **`content.js`** — runs on `buscatextual.cnpq.br/.../visualizacv.do` (an individual Lattes CV page). Parses the CV DOM, computes JCR/authorship metrics, injects the annotation UI, histograms, and settings panel directly into the page.
- **`producoes_parser.js` + `pdf.min.js`/`pdf.worker.min.js` (vendored PDF.js) + `picc_content.js`** — run on `efomento.cnpq.br` and `anexosform.cnpq.br` (the CNPq grant-proposal review system, referred to in comments as "piccTools" / Plataforma Carlos Chagas). `producoes_parser.js` converts the proposer's "Produções e Orientações" page into the *same* publication/patent/supervision schema `content.js` produces from a Lattes CV, so the shared report/graph code in `report_utils.js` works unmodified regardless of data source. `picc_content.js` extracts proposal/team data (including from embedded PDFs) and syncs team members' CVs into the same local database as `content.js`.

### Background service worker as the privileged hub

Content scripts run in the page's origin and can't cross-origin `fetch`, open tabs, or trigger downloads — `background.js` centralizes all of that via `chrome.runtime.onMessage` actions: `download_file`, `download_data`, `open_db_page` (opens the extension's own `db.html` — must be centralized here so it isn't opened in the CNPq page's own zoom/context), `fetch_url`/`fetch_arraybuffer` (with charset sniffing for CNPq's iso-8859-1/utf-8 mix), `fetch_rid_stats` (opens a hidden tab to ResearcherID/Web of Science and injects `extractMetrics` via `chrome.scripting.executeScript` to scrape H-index/citation stats), and `open_folder` (locates a downloaded file to reveal in the OS file manager).

### Standalone DB viewer page

`db.html` + `db_page.js` is a normal extension page (not a content script) that renders the local CV/proposal database by calling `window.JCRDBTools.viewDB()`. It's only ever opened via the background's `open_db_page` message, never directly from a content script.

### Storage conventions (`chrome.storage.local` only — no IndexedDB, no remote server)

- `jcr_lattes_settings` — per-report display settings (JCR thresholds, colors, toggles) set from `content.js`.
- `jcr_private_settings` — feature flags, notably `isUnlocked` (DB tools access).
- `jcr_cv:<id>` / `jcr_proc:<id>` — current per-record storage keys for CVs and proposals (`JCRDBTools.DB_SCHEMA_VERSION = 2`). `jcr_cv_database` is the legacy single-array key, kept only for migration.
- `jcr_ca_member_auth` — rolling 7-day authorization proving the user is a CNPq committee ("CA") member, set when they visit a "Planilha de Julgamento" page; gates the proposals UI in the popup and PDF-page tooling in `picc_content.js`.
- `jcr_picctools_disabled` — user opt-out for the proposal-review toolbar.
- All processing is local to the browser by design (see README's privacy claim) — don't introduce calls to external servers.

### Editing conventions seen in the code

- Files with `manual`/`editado`/`removedMembers` markers on team-member records (in `db_tools.js`) represent hand-edits by the reviewer; re-import/extraction logic must never silently overwrite these.
- `picc_content.js` has a `MOSTRAR_BOTAO_BRUTOS` debug flag for bulk-downloading raw HTML samples — must stay `false` in anything built for the Chrome Web Store.
- `pdf.min.js`/`pdf.worker.min.js` are vendored/minified third-party PDF.js builds — don't hand-edit them.

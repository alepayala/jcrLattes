# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

JCRLattes is a Manifest V3 Chrome extension (vanilla JS, no framework, no bundler, no `package.json`) that annotates the Brazilian Lattes CV platform (CNPq) and the CNPq grant-proposal system with impact-factor (JCR) metrics, authorship analysis, and statistical reports. It also ships a standalone Python reader for the extension's exported JSON, for offline analysis.

**`dist/` is the source** — there is no build step. Chrome loads `dist/` directly as an unpacked extension, and edits are made straight to the files under `dist/scripts/`.

## Commands

- **Run/reload the extension**: `chrome://extensions/` → enable Developer Mode → "Load unpacked" → select `dist/`. After editing any file under `dist/`, reload the extension there and refresh the target tab.
- **Syntax-check a changed JS file** (do this automatically after every edit to a `.js` file, per `.agents/AGENTS.md` — don't ask first): `node -c dist/scripts/<file>.js`
- **Run the unit tests**: `node --test` (from the repo root). Uses Node's built-in runner — no `package.json`, no dependencies, nothing to install. Run it after touching any pure helper.
- **Test suite scope**: `tests/` covers only the *pure* functions of `producoes_parser.js`, `report_utils.js`, `db_tools.js`, `picc_parser.js` and the three CV readers (`lattes_parser.js`, `lattes_parser_novo.js`, `lattes_api_parser.js`) — parsing, deduplication, key derivation, stats, HTML escaping, and the `mesclarEquipe` hand-edit contract. `tests/helpers/load.js` loads the extension scripts in Node by supplying a minimal `window` global; the production files are untouched and require no module system. Anything that needs the DOM, `chrome.*`, or a real page is **not** covered.
- **Everything else is still verified manually**: load the unpacked extension and open real or saved pages from `test_pages/` (sample Lattes CVs, "Produções e Orientações" pages, proposal PDFs — gitignored, kept locally for manual regression checks).
- **Python JSON reader** (`tools/parse_jcr_backup.py`; independent of the extension, only shares its JSON data format). Its purpose is to read the backup into Python structures (`load_backup`, `CVData`, `find_researcher`, `get_pub_id`) for any offline analysis; the collaboration graph (`--graph`, needs networkx/matplotlib) is an example of use. Reading needs no dependencies; the graph example runs as:
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
2. **`db_tools.js`** (largest file, ~5.3k lines) → `window.JCRDBTools`: the storage/database layer, settings, and authorization gating (CA-member auth). Everything that touches `chrome.storage.local` for CV/proposal records goes through here.

Feature-specific scripts loaded after these two:
- **`content.js`** — runs on an individual Lattes CV page, in **both** formats (on the new site the panel is compact — `PAGINA.painelCompacto`: summary cards inside the CV column, tables and charts collapsed): the old one (`buscatextual.cnpq.br/.../visualizacv.do`) and the new site (`busca-cv-lattes.cnpq.br/curriculo/<id>`, an Angular single-page app). It computes JCR/authorship metrics and injects the annotation UI, histograms, and settings panel. It does **not** parse the CV itself: the reading lives in the reader scripts below, chosen by URL at the top of the file (`LATTES_NOVO`, `LEITOR`, and `PAGINA`, which holds everything that depends on the page layout).
- **CV readers** — all return the same publication/supervision/patent/event objects, so nothing downstream knows the source:
  - `lattes_parser.js` → `window.JCRLattesParser`: the old page format. Its pure helpers are reused by the other two.
  - `lattes_parser_novo.js` → `window.JCRLattesParserNovo`: the new site's DOM. `prepararPagina()` opens the accordion sections and scrolls until the lazy article list is complete (the site only loads past 200 articles while the tab is visible).
  - `lattes_api_parser.js` → `window.JCRLattesApi`: the same CV from the JSON API the new site itself calls (`busca-cv-lattes-api.cnpq.br`). Used as a fallback when the page list is incomplete and by the DB page to refresh CVs without opening tabs. It rewrites each API item into the "parts" of the page reader and runs the same rules. `ATIVA: false` turns it off everywhere — the API is expected to be closed by CNPq.
- **`producoes_parser.js` + `pdf.min.js`/`pdf.worker.min.js` (vendored PDF.js) + `picc_content.js`** — run on `efomento.cnpq.br` and `anexosform.cnpq.br` (the CNPq grant-proposal review system, referred to in comments as "piccTools" / Plataforma Carlos Chagas). `producoes_parser.js` converts the proposer's "Produções e Orientações" page into the *same* publication/patent/supervision schema `content.js` produces from a Lattes CV, so the shared report/graph code in `report_utils.js` works unmodified regardless of data source. `picc_content.js` extracts proposal/team data (including from embedded PDFs) and syncs team members' CVs into the same local database as `content.js`.

### Background service worker as the privileged hub

Content scripts run in the page's origin and can't cross-origin `fetch`, open tabs, or trigger downloads — `background.js` centralizes all of that via `chrome.runtime.onMessage` actions: `download_file`, `download_data`, `open_db_page` (opens the extension's own `db.html` — must be centralized here so it isn't opened in the CNPq page's own zoom/context), `fetch_url`/`fetch_arraybuffer` (with charset sniffing for CNPq's iso-8859-1/utf-8 mix), `fetch_rid_stats` (opens a hidden tab to ResearcherID/Web of Science and injects `extractMetrics` via `chrome.scripting.executeScript` to scrape H-index/citation stats), and `open_folder` (locates a downloaded file to reveal in the OS file manager).

### Standalone DB viewer page

`db.html` + `db_page.js` is a normal extension page (not a content script) that renders the local CV/proposal database by calling `window.JCRDBTools.viewDB()`. It also loads the three CV readers, for the ⚡ bulk update through the API (`JCRDBTools.atualizarCvsPelaApi`). It's only ever opened via the background's `open_db_page` message, never directly from a content script.

### Storage conventions (`chrome.storage.local` only — no IndexedDB, no remote server)

- `jcr_lattes_settings` — the extension-wide options shared by the Lattes CV panel and the reports: JCR thresholds, custom period, author rank, colors, display filters (`toggles.jcr/author/period`, honored only while `lembrarFiltros` is on), plus CV-panel layout state (`toggles.tables` for the old page format and `toggles.tablesNovo` for the new site, where the blocks start collapsed; `painelRecolhido`; `sectionsCollapsed`). Both sides edit it through the same ⚙ dialog (`JCRReportUtils.dialogoOpcoesHTML`) and read it through `JCRReportUtils.opcoesEfetivas`; reports write with `salvarOpcoes` (a merge, never a full overwrite). The `highJcr`/`lowJcr` stored in each CV record are no longer used for display.
- `jcr_private_settings` — the DB tools' own settings (`autoSave`, export options). `isUnlocked` is still stored but always `true`: the option to hide the DB tools was removed.
- `jcr_cv:<id>` / `jcr_proc:<id>` — current per-record storage keys for CVs and proposals (`JCRDBTools.DB_SCHEMA_VERSION = 2`). `jcr_cv_database` is the legacy single-array key, kept only for migration.
- `jcr_ca_member_auth` — rolling 7-day authorization proving the user is a CNPq committee ("CA") member, set when they visit a "Planilha de Julgamento" page; gates the proposals UI in the popup and PDF-page tooling in `picc_content.js`.
- `jcr_picctools_disabled` — user opt-out for the proposal-review toolbar.
- All processing is local to the browser by design (see README's privacy claim) — don't introduce calls to external servers.

### Editing conventions seen in the code

- Files with `manual`/`editado`/`removedMembers` markers on team-member records (in `db_tools.js`) represent hand-edits by the reviewer; re-import/extraction logic must never silently overwrite these.
- `pdf.min.js`/`pdf.worker.min.js` are vendored/minified third-party PDF.js builds — don't hand-edit them.
- Authorship data the new Lattes site can't confirm is **switched off, not removed**: the flags at the top of `JCRReportUtils` (`MEDIA_DE_AUTORES_ATIVA`, `ULTIMO_AUTOR_ATIVO`, `POSICAO_DE_AUTOR_ATIVA`, `NUMERO_DE_AUTORES_ATIVO`, `GRANDES_COLABORACOES_ATIVAS`) hide the columns/filters (dashes + "Temporariamente desabilitado") while the values keep being read, computed and stored. Only "first author" is trusted. New code that shows or filters by one of these must honor its flag; `rankAlvoEfetivo()` is the target rank to use.
- The stored `cvLink` stays `http://lattes.cnpq.br/<id>` (it is an identifier matched by regex all over the proposal code); `JCRReportUtils.urlCurriculo()` turns it into the address that actually opens.
- A function whose comment starts with `ÓRFÃ PROPOSITAL — não remover.` is uncalled **on purpose**: an alternative rendering or variant kept ready for when it's wanted again. A dead-code sweep must leave these alone, and whoever changes the data shape they consume should keep them compiling. `grep -rn "ÓRFÃ PROPOSITAL" dist/` lists them.
- Any change to the JSON export/backup format in `db_tools.js` (the three exported files, the CV or proposal record fields, how researchers or articles are identified) must be mirrored in `tools/parse_jcr_backup.py` in the same change. It reads that JSON and copies the extension's rules (`normalizeName`, `_nomesCompativeis`, `isFullCv`, `_chaveArtigo`); left behind, it silently miscounts instead of failing.
- `chrome_store_description.md` is the public Chrome Web Store text and is pasted into the store form whole, so it holds nothing else. Keep it current: a user-visible feature added or changed gets its line there in the same change (in Portuguese, in the file's style). Never mention piccTools / the proposal-review tools in it. The submission-form material (permission justifications, release checklist) lives in `chrome_store_permissoes.md`.

# Notion Exporter (Chrome extension)

Exports the Notion page you are viewing — plus its child pages, linked and mentioned pages, and
database entries — to an **offline HTML or Markdown archive** in a ZIP. Collapsed toggle content is
included. It runs locally in Chrome with your existing Notion login: no API integration, no server, no
cloud services.

## Install

Requirements: macOS (or any OS with Chrome 120+), Node.js 20+ (developed with Node 24) and npm.

```bash
npm install
npm run build        # typecheck + production build into dist/
```

Load it in Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `dist/` folder.
4. Pin "Notion Exporter" from the puzzle-piece menu.

After rebuilding, click the reload icon on the extension's card.

## Use

1. Open a Notion page (`notion.so`, `app.notion.com`, or a public `*.notion.site` page) while signed in.
2. Click the extension. The popup shows the page title, URL and whether it is supported.
3. Choose **HTML**, **Markdown** or **Both**, adjust options if needed, and click **Export**.
4. A separate export window opens and reads pages there; your tab is never navigated. Progress shows
   pages done, queued, failed and assets downloaded. You can close the popup; the export continues.
5. When finished, the ZIP is saved to your Downloads folder. The popup shows **Export complete** or
   **Partial export**, plus the export report. **Download ZIP again** re-saves the last archive.

### Options

| Option | Default | Notes |
|---|---|---|
| Format | HTML | `Both` writes HTML and Markdown side by side. |
| Follow linked pages & mentions | on | Inline links, @-mentions, "link to page" blocks. |
| Include child pages | on | Subpages and child databases. |
| Include database entries | on | Rows visible in database views (clicks Notion's "Load more"). |
| Capture hidden toggle content | on | Opens collapsed toggles and toggle headings in the export window. |
| Capture linked external websites | **off** | Asks for permission to read websites. External pages are captured one level deep (their links are not followed). |
| Markdown expandable sections | Interactive | *Interactive*: `<details>`/`<summary>` HTML in Markdown (GitHub, Obsidian and VS Code render it; some viewers show raw tags). *Portable*: headings + content. |
| Advanced: max pages / depth | 500 / 20 | Reported in the export report when reached. |
| Advanced: concurrent pages / retries | 2 / 2 | Each concurrent slot is its own export window. |
| Advanced: max assets / MB per asset / total MB | 2000 / 25 / 1024 | Larger files are linked, not downloaded, and reported. |
| Advanced: page timeout | 180 s | Very long, toggle-heavy pages need more time. |
| Advanced: download images & files | on | |
| Advanced: re-collapse toggles | on | Leaves pages as they were. |
| Advanced: crawl pages in | Export window | *Background tabs* use inactive tabs in your current window instead. |

## Archive layout

```
notion-export/
  index.html | index.md          page tree + other linked pages + external pages
  style.css                      (HTML) shared offline stylesheet
  manifest.json                  machine-readable record of the export
  export-report.md (+ .html)     outcome, failures, skipped pages, unresolved links, asset problems
  pages/<title-slug>--<pageId>.html|.md
  assets/<name-slug>--<assetId>.<ext>
  external/<title-slug>--<hash>.html|.md
```

- Page files are named by title **and** Notion page ID, so identical titles never collide.
- All links between exported pages are relative and work offline. Links to pages that were not exported
  keep their original Notion URL.
- Each page shows its source URL and page ID. Markdown pages carry YAML front matter (`title`,
  `notion_id`, `source_url`, `status`, …) for knowledge-base tools.
- `manifest.json` contains the root page, settings, every page (ID, title, URL, paths, status, warnings,
  depth, how it was discovered), parent/child relationships, all relationships (child page, link,
  mention, link-to-page, database entry, synced block, external), assets (path, original URL, MIME,
  size, status), external pages, missing pages, unresolved references, limits hit and summary counts.

## Complete vs. partial

An export is **complete** only if every discovered page in scope was retrieved with no extraction
warnings, no limit was hit, and every asset was included. Otherwise it is **partial**, and
`export-report.md` lists exactly what is missing and why:

- failed pages (no access, login required, deleted, timeout, bot challenge)
- partially extracted pages (e.g. a toggle that would not open, a lazy image that never loaded, a
  database view with more rows than loaded)
- skipped pages (limits, cancellation, disabled relationship types)
- unresolved links, and assets not included (size limit, expired link, rate limiting)

## How it works

```
popup ─► service worker ─► Crawler (graph keyed by page ID; queue, limits, retries, cancel, resume)
                             └─► TabPool (export window / background tabs — never your active tab)
                                   └─► content script: probe → prepare (scroll, open toggles, load
                                        more rows) → extract RawPage → restore toggles
                           ─► Normalizer (RawPage → typed ExportPage model)
                           ─► AssetManager (validated fetch, dedupe, limits, IndexedDB)
                           ─► Renderers (HTML / Markdown from the model only)
                           ─► Archive builder (index, manifest, report) → JSZip → offscreen blob URL → Downloads
```

- **Adapter boundary.** All Notion DOM assumptions live in `src/content/notion-selectors.ts` and
  `notion-dom.ts`. They produce a `RawPage`; the rest of the pipeline never touches the DOM. A future
  adapter (e.g. the official Notion API with an integration token) can produce the same `RawPage`/`ExportPage`.
- **Identity.** Notion page IDs (32 hex) are the primary key. Links without an ID (vanity URLs,
  `notion.site/` roots) are visited and resolved by the page ID found in the DOM, then merged.
- **Resume.** Crawl state, extracted pages and asset blobs are saved to IndexedDB as the export runs.
  If Chrome stops the service worker mid-export, the popup offers **Resume**.

## Limitations

- **Depends on Notion's web UI.** Extraction reads the rendered DOM (`data-block-id`, block-type
  classes, ARIA attributes). Notion UI changes can break or degrade it. Selectors are centralized for
  quick fixes, and pages are marked partial rather than silently incomplete when detection fails.
- **Only what Notion renders.** Database rows hidden by the view's filters or grouping, rows beyond what
  "Load more" reveals, and content in unsupported embeds are not captured. Database properties come from
  table-view cells only. Page property panels on entry pages are not parsed yet.
- **Synced blocks.** The synced content is exported where it appears. The *source* page of a synced
  block cannot be identified from the DOM.
- **Unsupported blocks** (e.g. some newer block types or third-party embeds) are exported as plain text
  or links, with a warning.
- **Equations** are exported as TeX source (no math rendering offline).
- **Rendering throttling.** Chrome throttles hidden tabs. The default export window keeps pages
  rendering. If you minimize or fully cover it, lazy content may load slowly; affected pages are marked
  partial.
- **Speed.** Toggle-heavy or very long pages take time: one 131-toggle page took about 2–3 minutes
  to prepare. Notion may rate-limit image downloads (HTTP 429); the exporter backs off and reports
  anything it could not fetch.
- **Bot protection.** Public `notion.site` pages sit behind Cloudflare. Heavy repeated exporting can
  trigger a verification challenge; the page is retried and then reported.
- **External websites.** Best effort. Login walls, anti-bot protection, heavy client-side apps and
  non-standard accordions may not be captured. External pages are captured one level deep.
- **Memory.** The ZIP is assembled in memory. Very large exports (multiple GB of assets) may fail; keep
  the total-asset limit reasonable.
- **Redirect validation.** Only the final URL of an asset redirect chain can be inspected (see
  [docs/SECURITY.md](docs/SECURITY.md)).

## Troubleshooting

| Symptom | Fix |
|---|---|
| "No Notion page in this tab" | Open a Notion page view, not settings or the login page, then reopen the popup. |
| Root page fails with "Login required" | Sign in to Notion in **this** Chrome profile. Private pages need your session. |
| Pages fail with "No access" | Expected for pages you cannot open. They are listed in the report with original URLs. |
| "Blocked by Notion (verification challenge or rate limiting)" or "Page did not finish loading" | Open the page normally once, complete the check, and retry. Lower concurrency to 1. |
| Many images missing with HTTP 429 | Notion is rate-limiting. Re-run later or lower concurrency. |
| Toggles listed as "could not be opened" | Raise the page timeout (Advanced), and keep the export window visible. |
| Export window appears | That's by design: crawling happens there so your tab is untouched. Don't close it during an export; if you do, it is recreated. |
| Popup shows "Resume" | A previous export was interrupted. Resume it or discard it. |
| Nothing downloads | Check `chrome://downloads`. Chrome's "Ask where to save each file" setting shows a dialog. |
| External capture toggle turns itself off | The website-access permission was declined. Enable it again and accept the prompt. |

To debug, open `chrome://extensions` → Notion Exporter → *Inspect views: service worker*.

## Development

```bash
npm test                 # unit tests (Vitest + jsdom)
npm run typecheck
npm run build
npm run e2e              # real-Chrome end-to-end test against a simulated Notion site (needs a build)
HEADFUL=1 npm run e2e    # same, visible
```

`npm run e2e` loads `dist/` into Google Chrome (set `CHROME_PATH` if it isn't in `/Applications`), serves
synthetic Notion-like pages from a local HTTPS server mapped to `e2e.notion.site`, and checks ZIP
contents for four scenarios: recursive export, cancellation, resume after the service worker is
killed, and external FAQ capture. It needs no network and no Notion account.

```
src/
  shared/      model.ts (normalized model), raw.ts (adapter output), ids.ts, url-safety.ts, paths.ts,
               settings.ts, messages.ts, hash.ts, idb.ts
  content/     notion-selectors.ts, notion-dom.ts, notion-content.ts, external-dom.ts, external-content.ts,
               inline.ts, in-tab-fetch.ts
  normalize/   notion.ts, external.ts, common.ts
  crawler/     crawler.ts
  assets/      asset-manager.ts, asset-key.ts
  render/      html.ts, markdown.ts, context.ts, styles.ts
  archive/     archive.ts, report.ts, zip.ts
  background/  service-worker.ts, job.ts, fetchers.ts, tab-pool.ts, download.ts
  popup/, offscreen/
public/manifest.json, popup.html, offscreen.html
tests/          unit tests + sanitized synthetic fixtures
scripts/        build-content.mjs (IIFE content scripts), e2e-smoke.mjs, make-icons.mjs
docs/           SECURITY.md, MANUAL_TEST_CHECKLIST.md
```

See [docs/SECURITY.md](docs/SECURITY.md) for permissions and the security model, and
[docs/MANUAL_TEST_CHECKLIST.md](docs/MANUAL_TEST_CHECKLIST.md) for real-workspace testing.

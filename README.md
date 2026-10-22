<p align="center"><img src="public/icons/icon128.png" width="96" alt="Unfoldr icon"></p>

# Unfoldr — offline HTML & Markdown exporter for Notion

> **Unofficial.** Unfoldr is an independent personal project. It is not affiliated with, endorsed by, or
> sponsored by Notion Labs, Inc. "Notion" is a trademark of Notion Labs, Inc., used here only to
> describe what the extension works with. See [Disclaimers](#disclaimers).

A Chrome extension that exports the Notion page you are viewing — plus its child pages, linked and mentioned pages, and
database entries — to an **offline HTML or Markdown archive** in a ZIP. Collapsed toggle content is
included. It runs locally in Chrome with your existing Notion login: no API integration, no server, no
cloud services.

## Install

### From a release (no build tools needed)

1. Download **`Unfoldr-<version>-chrome.zip`** from the [latest release](https://github.com/raisv3n/Unfoldr/releases/latest)
   and unzip it. You get an `Unfoldr` folder. Keep it somewhere permanent: Chrome loads the extension
   from that folder every time it starts.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `Unfoldr` folder.
4. Pin "Unfoldr" from the puzzle-piece menu.

To update, download the new release, replace the folder's contents, and click the reload icon on the
extension's card. Each release lists a SHA-256 checksum; to verify your download:
`shasum -a 256 Unfoldr-<version>-chrome.zip`.

### From source

Requirements: Chrome 120+, Node.js 20+ (developed with Node 24) and npm.

```bash
npm install
npm run build        # typecheck + production build into dist/
```

Then load the `dist/` folder with **Load unpacked** as above. After rebuilding, click the reload icon on
the extension's card. While editing, `npm run watch` rebuilds `dist/` automatically on every save.

### Publishing a release (maintainer)

1. Bump `"version"` in both `public/manifest.json` and `package.json` (they must match).
2. Optionally write `.github/release-notes/v<version>.md`; otherwise the notes list the commits since the
   previous release.
3. Commit, then `git tag v<version> && git push origin main v<version>`.

GitHub Actions (`.github/workflows/release.yml`) installs from the lockfile, audits, runs the tests,
builds, and publishes `Unfoldr-<version>-chrome.zip` plus its `.sha256` to the release. To try the
packaging locally: `npm run package` → `release/`.

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

### Videos and embeds

Videos can't be stored in the archive (YouTube streams them). Each YouTube video (`youtube.com`,
`youtu.be`, `/embed/`, `/shorts/`, `/live/`) is exported as a **clickable thumbnail**: the thumbnail is
downloaded into `assets/` and links to the video. It shows offline and in viewers that block embedded
players (e.g. Renderooo, GitHub). Clicking it opens the video in your browser. In Markdown:

```md
[![▶ YouTube video](../assets/youtube-dqw4w9wgxcq--1a2b3c4d5e6f7a8b.jpg)](https://www.youtube.com/watch?v=dQw4w9WgXcQ)
```

Other embeds (Figma, Google Maps, tweets, …) are exported as links.

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

To debug, open `chrome://extensions` → Unfoldr → *Inspect views: service worker*.

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
scripts/        build-content.mjs (IIFE content scripts), e2e-smoke.mjs, watch.mjs, make-icons.py (icons from icon.png)
docs/           SECURITY.md, MANUAL_TEST_CHECKLIST.md
```

See [docs/SECURITY.md](docs/SECURITY.md) for permissions and the security model, and
[docs/MANUAL_TEST_CHECKLIST.md](docs/MANUAL_TEST_CHECKLIST.md) for real-workspace testing.

## Disclaimers

- **Not affiliated with Notion.** Unfoldr is an independent, unofficial tool. It is not affiliated with,
  endorsed by, or sponsored by Notion Labs, Inc. "Notion" and the Notion logo are trademarks of
  Notion Labs, Inc.; the name is used only to say what Unfoldr works with.
- **Your content, your responsibility.** Unfoldr only reads pages your own browser session can already
  open, and only saves them to your computer. Export only content you are allowed to keep a copy of,
  and follow [Notion's Terms](https://www.notion.com/terms) and your workspace's policies. Exported
  archives can contain private or confidential information — store and share them accordingly.
- **External websites** are visited only if you turn that option on. Respect those sites' terms and
  copyright; captured copies are for your personal, offline reference.
- **No warranty.** Unfoldr reads Notion's web interface, which can change at any time, so exports may be
  incomplete. Always check `export-report.md`, and don't rely on Unfoldr as your only backup. The
  software is provided "as is", without warranty of any kind — see [LICENSE](LICENSE).
- **Privacy.** Unfoldr has no server, analytics or telemetry, and never reads or stores your cookies or
  passwords. See [docs/SECURITY.md](docs/SECURITY.md).

## License

[MIT](LICENSE) © 2026 Aissa Alicaway

# Implementation Plan — Notion Exporter (Chrome MV3)

Status legend: [x] done and verified · [~] done, with documented limitations · [ ] outstanding

## Starting point

- Empty directory (no source, no git). Node 24, npm 11, Google Chrome 155 on macOS.
- Initialized a git repo and a TypeScript + Vite + Vitest project with exact pinned versions and a lockfile.

## Proof-of-concept findings (live public Notion pages in Chrome)

| Question | Finding | Consequence |
|---|---|---|
| Block markup | `[data-block-id]` + `notion-<type>-block`; text in `[data-content-editable-leaf]` | DOM adapter keys on data attributes. Selectors are centralized in `notion-selectors.ts`. |
| Page identity | Title block (`.notion-page-block` with `h1`) outside `.notion-page-content`. URLs may lack an ID (vanity slugs, `notion.site/` root). | Crawler resolves IDs after visiting and merges URL-keyed nodes into ID-keyed nodes. |
| Collapsed toggles | Children are **not in the DOM** until opened (`[role=button][aria-expanded=false]`) | Extractor opens toggles in a crawler tab and repeats for nested toggles. |
| Hosts | `notion.so` → `app.notion.com/p/…`; public pages on `*.notion.site` | All three host families supported. |
| Images | `/image/<encoded>` proxy **302 → `img.notionusercontent.com`** (signed `tok`) | CDN host added to permissions; `tok` redacted from manifest and report. |
| Virtualization | **Long pages unmount blocks** that scroll out of view (534 → 266 mounted blocks) | Blocks accumulate across scroll positions, merged by ID in page order (`accumulator.ts`). The extractor never scrolls in the same step as clicking. |
| Lazy images | `data:` GIF placeholder until in view | Uses `srcset`/`data-src`; otherwise reports "image had not loaded". |
| Rate limits | Image proxy returns HTTP 429 under load; heavy repeated loading leaves pages stuck loading | Shared back-off honoring `Retry-After`; 90 s per-asset timeout; rate-limit text detection; clear timeout messages. |
| Bot protection | `notion.site` serves a Cloudflare check to plain headless automation | Normal Chrome is unaffected. The automated e2e uses a simulated Notion site. |

## Phases

### Phase 1 — Foundation
- [x] package.json (pinned), lockfile, tsconfig (extension + node configs), Vite multi-entry build, IIFE content-script build
- [x] Manifest V3, icons, popup, offscreen document, typed message contracts
- [x] Vitest + jsdom

### Phase 2 — Current-page extraction (DOM adapter)
- [x] Page identity, icon, access states (login, no access, not found, challenge/rate limit)
- [x] Blocks: text, headings incl. toggle headings, bulleted/numbered/to-do lists, quote, callout, code (+language), divider, equation, simple table, image, file/pdf/video/audio, bookmark, embeds, columns, synced blocks, child page, link-to-page, inline and full-page databases
- [x] Rich text: bold/italic/strike/underline/code/color, links, page/user/date mentions, inline equations
- [x] Collapsed toggles opened in a controlled tab, nested; optional re-collapse
- [x] Scrolling with block accumulation for virtualized pages; "Load more" in database views
- [x] Verified on real public Notion pages: 131 collapsed toggles opened and captured (146 `<details>` sections)

### Phase 3 — Normalized model
- [x] Discriminated-union model (`src/shared/model.ts`); normalizer with URL validation, reference classification, warnings, partial status

### Phase 4 — Crawler
- [x] Graph keyed by page ID; URL-key alias resolution; every edge kept (including to already-processed pages)
- [x] BFS depth, page and depth limits (reported), bounded concurrency, retries with back-off, non-retryable access errors, cancellation
- [x] Snapshot/restore. Resume after a service-worker kill is verified in real Chrome.

### Phase 5 — Renderers
- [x] HTML: per-page files, index tree, stylesheet, `<details>`, relative links, backlinks, CSP meta, escaping
- [x] Markdown: front matter, relative links, interactive (`<details>`) and portable (headings) toggle modes, GFM tables, safe code fences, escaping

### Phase 6 — Assets
- [x] Validated fetch (scheme, private hosts, allowlist, final URL after redirects, MIME, streamed size cap, timeout), dedupe across signed and resized URLs, deterministic names, IndexedDB blobs
- [x] In-tab same-origin fallback; HTTP 429 back-off; SVG active-content refusal

### Phase 7 — ZIP
- [x] `notion-export/` layout, `manifest.json`, `export-report.md` (+ `.html`), path-traversal guard, JSZip, offscreen blob URL → `chrome.downloads`

### Phase 8 — External capture (opt-in)
- [x] Optional `https://*/*` permission requested only on opt-in, revocable from the popup
- [x] Readable content; `<details>`; ARIA accordions (hidden panels read without clicking); `<dl>`; FAQPage JSON-LD; safe-click policy for lazy panels only

### Phase 9 — Hardening
- [x] 113 unit tests (`npm test`), strict typecheck, production build
- [x] Real-Chrome e2e (`npm run e2e`, 61 checks) against a simulated Notion site: recursion, cycles, duplicate titles, inaccessible page, database, image, both formats, cancel, resume after service-worker kill, virtualized page, external FAQ capture. Passes headless and headful.
- [~] Live public-Notion runs: extraction, toggles, images and reporting verified. A final re-run after the virtualization fix was blocked by Notion rate-limiting this machine after repeated test loads. The fix is verified on the simulated virtualized page.
- [ ] Logged-in private workspace verification (needs your session — see `docs/MANUAL_TEST_CHECKLIST.md`)

## Remaining limitations (see README "Limitations")

- DOM adapter depends on Notion's UI markup.
- Database properties come from table-view cells only. Page property panels on entry pages are not parsed.
- Synced-block sources in other pages cannot be resolved from the DOM.
- Equations exported as TeX. Unsupported block types exported as text or links, with warnings.
- Redirect validation inspects the final URL only. DNS-based private-address detection is impossible in extensions.
- ZIP is built in memory; multi-GB exports may fail.
- Toggle-heavy pages are slow (minutes for 100+ toggles with many images).

## Follow-up improvements

1. Optional official-API adapter (integration token) behind the same `RawPage` interface, for exact database properties and synced-block sources.
2. Parse page property panels on database entry pages.
3. Streaming ZIP (e.g. writing to a File System Access handle) for very large exports.
4. Per-host external-capture permissions (request each discovered host) instead of `https://*/*`.
5. Incremental re-export (skip pages unchanged since a previous manifest).
6. Offline math rendering (bundled KaTeX CSS/fonts) as an option.

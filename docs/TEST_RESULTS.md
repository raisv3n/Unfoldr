# Test results

Recorded 2026-10-22 15:09 on macOS 26.6.2, Node v24.11.1, Google Chrome 155.0.8059.85 .

## Production build (`npm run build`)

```
✓ 34 modules transformed.
dist/offscreen.html                 0.21 kB │ gzip:  0.18 kB
dist/popup.html                     5.63 kB │ gzip:  1.71 kB
dist/assets/popup.css               4.91 kB │ gzip:  1.51 kB
dist/assets/offscreen.js            0.70 kB │ gzip:  0.38 kB
dist/assets/idb-cELhTGI6.js         1.66 kB │ gzip:  0.54 kB
dist/assets/settings-npqJIKOE.js    5.64 kB │ gzip:  2.03 kB
dist/assets/popup.js               10.02 kB │ gzip:  3.33 kB
dist/background.js                275.92 kB │ gzip: 68.45 kB
✓ built in 279ms
built dist/content/notion-content.js
built dist/content/external-content.js
```

## Unit tests (`npm test`)

```
 ✓ tests/accumulator.test.ts > mergeOrder > merges overlapping scroll windows in page order
 ✓ tests/accumulator.test.ts > mergeOrder > inserts blocks that appear before known ones (scrolling up / late-rendered blocks)
 ✓ tests/accumulator.test.ts > mergeOrder > appends disjoint windows
 ✓ tests/accumulator.test.ts > BlockAccumulator > keeps every block seen across virtualized windows, preferring the most complete rendering
 ✓ tests/urls-paths.test.ts > page ID extraction > https://www.notion.so/Notion-Official-83715d7703ee4b8699b5e659a4712dd8
 ✓ tests/urls-paths.test.ts > page ID extraction > https://www.notion.so/myteam/Notion-Official-83715d7703ee4b8699b5e659a4712dd8?pvs=4
 ✓ tests/urls-paths.test.ts > page ID extraction > https://www.notion.so/83715d7703ee4b8699b5e659a4712dd8
 ✓ tests/urls-paths.test.ts > page ID extraction > https://app.notion.com/p/notion/Notion-Official-83715d7703ee4b8699b5e659a4712dd8
 ✓ tests/urls-paths.test.ts > page ID extraction > https://notion.notion.site/Notion-Official-83715d7703ee4b8699b5e659a4712dd8
 ✓ tests/urls-paths.test.ts > page ID extraction > https://www.notion.so/83715d77-03ee-4b86-99b5-e659a4712dd8
 ✓ tests/urls-paths.test.ts > page ID extraction > https://www.notion.so/db-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?v=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb&p=83715d7703ee4b8699b5e659a4712dd8&pm=s
 ✓ tests/urls-paths.test.ts > page ID extraction > https://www.notion.so/Page-83715D7703EE4B8699B5E659A4712DD8
 ✓ tests/urls-paths.test.ts > page ID extraction > extracts block anchors
 ✓ tests/urls-paths.test.ts > page ID extraction > flags vanity slugs and non-page routes
 ✓ tests/urls-paths.test.ts > page ID extraction > normalizes IDs and builds canonical URLs
 ✓ tests/urls-paths.test.ts > page ID extraction > normalizes URLs for dedupe
 ✓ tests/urls-paths.test.ts > page ID extraction > decodes Notion image proxy URLs
 ✓ tests/urls-paths.test.ts > URL safety > allows only safe link schemes
 ✓ tests/urls-paths.test.ts > URL safety > blocks private host localhost
 ✓ tests/urls-paths.test.ts > URL safety > blocks private host foo.localhost
 ✓ tests/urls-paths.test.ts > URL safety > blocks private host 127.0.0.1
 ✓ tests/urls-paths.test.ts > URL safety > blocks private host 10.1.2.3
 ✓ tests/urls-paths.test.ts > URL safety > blocks private host 172.16.0.1
 ✓ tests/urls-paths.test.ts > URL safety > blocks private host 192.168.1.1
 ✓ tests/urls-paths.test.ts > URL safety > blocks private host 169.254.169.254
 ✓ tests/urls-paths.test.ts > URL safety > blocks private host 0.0.0.0
 ✓ tests/urls-paths.test.ts > URL safety > blocks private host [::1]
 ✓ tests/urls-paths.test.ts > URL safety > blocks private host [fd00::1]
 ✓ tests/urls-paths.test.ts > URL safety > blocks private host [fe80::1]
 ✓ tests/urls-paths.test.ts > URL safety > blocks private host [::ffff:127.0.0.1]
 ✓ tests/urls-paths.test.ts > URL safety > blocks private host printer.local
 ✓ tests/urls-paths.test.ts > URL safety > blocks private host intranet
 ✓ tests/urls-paths.test.ts > URL safety > blocks private host svc.internal
 ✓ tests/urls-paths.test.ts > URL safety > blocks private host 100.64.0.1
 ✓ tests/urls-paths.test.ts > URL safety > allows public host example.com
 ✓ tests/urls-paths.test.ts > URL safety > allows public host www.notion.so
 ✓ tests/urls-paths.test.ts > URL safety > allows public host 8.8.8.8
 ✓ tests/urls-paths.test.ts > URL safety > allows public host 172.32.0.1
 ✓ tests/urls-paths.test.ts > URL safety > checks fetch URLs against policy, scheme, port and credentials
 ✓ tests/urls-paths.test.ts > archive paths > slugifies deterministically
 ✓ tests/urls-paths.test.ts > archive paths > avoids collisions between identical titles via page ID
 ✓ tests/urls-paths.test.ts > archive paths > rejects unsafe path "../x"
 ✓ tests/urls-paths.test.ts > archive paths > rejects unsafe path "/abs"
 ✓ tests/urls-paths.test.ts > archive paths > rejects unsafe path "a/../b"
 ✓ tests/urls-paths.test.ts > archive paths > rejects unsafe path "a\\b"
 ✓ tests/urls-paths.test.ts > archive paths > rejects unsafe path "C:/x"
 ✓ tests/urls-paths.test.ts > archive paths > rejects unsafe path "a//b"
 ✓ tests/urls-paths.test.ts > archive paths > rejects unsafe path "a/./b"
 ✓ tests/urls-paths.test.ts > archive paths > rejects unsafe path "with space"
 ✓ tests/urls-paths.test.ts > archive paths > rejects unsafe path "nul\u0000"
 ✓ tests/urls-paths.test.ts > archive paths > computes relative paths
 ✓ tests/urls-paths.test.ts > hashing and asset keys > sha256 matches known vectors
 ✓ tests/urls-paths.test.ts > hashing and asset keys > dedupes signed and resized variants of the same asset
 ✓ tests/urls-paths.test.ts > settings > clamps and validates untrusted input
 ✓ tests/crawler.test.ts > Crawler > handles circular references and keeps every edge
 ✓ tests/crawler.test.ts > Crawler > deduplicates repeated references to the same page
 ✓ tests/crawler.test.ts > Crawler > respects the depth limit and reports it
 ✓ tests/crawler.test.ts > Crawler > respects the page-count limit and reports it
 ✓ tests/crawler.test.ts > Crawler > retries transient failures, gives up after maxRetries, and continues the crawl
 ✓ tests/crawler.test.ts > Crawler > tracks partial pages separately
 ✓ tests/crawler.test.ts > Crawler > resolves pages whose ID is unknown until visited (vanity URLs) without refetching
 ✓ tests/crawler.test.ts > Crawler > honors relationship toggles and records not-followed links
 ✓ tests/crawler.test.ts > Crawler > bounds concurrency
 ✓ tests/crawler.test.ts > Crawler > cancels, then resumes from a snapshot without refetching completed pages
 ✓ tests/crawler.test.ts > Crawler > captures external pages only when enabled, as leaves
 ✓ tests/archive.test.ts > archive builder > produces the expected HTML archive layout
 ✓ tests/archive.test.ts > archive builder > links pages with identical titles to distinct local files and includes toggle content
 ✓ tests/archive.test.ts > archive builder > writes a manifest with relationships, assets, missing pages and redacted URLs
 ✓ tests/archive.test.ts > archive builder > generates an export report naming failures, partial pages and unresolved links
 ✓ tests/archive.test.ts > archive builder > reports success only when nothing is missing
 ✓ tests/archive.test.ts > archive builder > emits only Markdown files for the markdown format, and both when requested
 ✓ tests/archive.test.ts > archive builder > redacts signed URL parameters
 ✓ tests/archive.test.ts > ZIP generation > round-trips archive files under the root folder
 ✓ tests/archive.test.ts > ZIP generation > refuses traversal paths
 ✓ tests/assets.test.ts > AssetManager > downloads once for duplicate references and records all referencing pages
 ✓ tests/assets.test.ts > AssetManager > reports access failures and uses the in-tab fallback when available
 ✓ tests/assets.test.ts > AssetManager > rejects HTML responses, oversized files, blocked hosts and private redirects
 ✓ tests/assets.test.ts > AssetManager > refuses SVGs with active content
 ✓ tests/assets.test.ts > AssetManager > enforces the asset count limit
 ✓ tests/assets.test.ts > AssetManager > retries transient network errors
 ↓ tests/live-snapshot.test.ts > live DOM snapshot > extracts a page
 ✓ tests/render.test.ts > HTML renderer > escapes source text and never emits scripts
 ✓ tests/render.test.ts > HTML renderer > rewrites internal links to relative local files and keeps unresolved originals
 ✓ tests/render.test.ts > HTML renderer > renders toggles as details/summary with all hidden content present
 ✓ tests/render.test.ts > HTML renderer > renders lists, tables, code and images with relative asset paths
 ✓ tests/render.test.ts > HTML renderer > keeps the original Notion URL and page ID
 ✓ tests/render.test.ts > HTML renderer > escapes helpers
 ✓ tests/render.test.ts > Markdown renderer > writes front matter with source URL and ID
 ✓ tests/render.test.ts > Markdown renderer > uses relative links between exported pages and keeps unresolved originals
 ✓ tests/render.test.ts > Markdown renderer > escapes Markdown control characters
 ✓ tests/render.test.ts > Markdown renderer > interactive mode uses details/summary with hidden content
 ✓ tests/render.test.ts > Markdown renderer > portable mode converts toggles to headings and content
 ✓ tests/render.test.ts > Markdown renderer > renders lists, tables and code fences safely
 ✓ tests/assets.test.ts > AssetManager > times out stalled requests instead of blocking the export
 ✓ tests/assets.test.ts > AssetManager > backs off on HTTP 429 using Retry-After, then succeeds
 ✓ tests/assets.test.ts > AssetManager > chooses extensions from MIME type, falling back to the URL
 ✓ tests/external.test.ts > external page extraction > extracts readable content and skips navigation, footer and scripts
 ✓ tests/external.test.ts > external page extraction > captures details, ARIA accordion (hidden panels), definition lists and JSON-LD FAQ
 ✓ tests/external.test.ts > external page extraction > does not treat form submit controls as accordions to click
 ✓ tests/external.test.ts > external page extraction > reports empty lazy panels and marks the page partial
 ✓ tests/external.test.ts > external page extraction > collects images as assets but ignores tracking pixels
 ✓ tests/external.test.ts > external page extraction > records outgoing links as references
 ✓ tests/notion-extract.test.ts > Notion DOM extraction + normalization > identifies the page from the title block (ignoring side peek)
 ✓ tests/notion-extract.test.ts > Notion DOM extraction + normalization > extracts rich text annotations, links, mentions and equations
 ✓ tests/notion-extract.test.ts > Notion DOM extraction + normalization > captures expanded toggle content including nested toggles
 ✓ tests/notion-extract.test.ts > Notion DOM extraction + normalization > marks the page partial when a toggle stayed collapsed
 ✓ tests/notion-extract.test.ts > Notion DOM extraction + normalization > maps common block types
 ✓ tests/notion-extract.test.ts > Notion DOM extraction + normalization > collects relationships of every kind
 ✓ tests/notion-extract.test.ts > Notion DOM extraction + normalization > extracts database rows with properties
 ✓ tests/notion-extract.test.ts > Notion DOM extraction + normalization > deduplicates assets that differ only by volatile params
 ✓ tests/notion-extract.test.ts > Notion DOM extraction + normalization > keeps raw script-looking text as text
 ✓ tests/notion-extract.test.ts > access-state detection > detects challenge, no access and not found pages
 ✓ tests/notion-extract.test.ts > full-page database > extracts rows when the page is a collection view
 ✓ tests/notion-extract.test.ts > lazy images and unknown wrappers > uses srcset/data-src over data: placeholders and reports unloaded images
 Test Files  8 passed | 1 skipped (9)
      Tests  113 passed | 1 skipped (114)
```

`tests/live-snapshot.test.ts` is skipped unless `NOTION_SNAPSHOT` points to a locally saved page DOM.

## Real-Chrome end-to-end (`npm run e2e`)

Runs the built extension in Google Chrome against a local HTTPS server that simulates Notion (`e2e.notion.site`). No network or Notion account is used.

```
  ✓ extension loads and its MV3 service worker starts
  ✓ popup renders without script errors
Scenario 1: recursive export (both formats, export window)
  ✓ export starts
  ✓ export finishes with a partial outcome (one page inaccessible)
  ✓ pages: 5 exported, 1 failed
  ✓ ZIP downloaded via chrome.downloads
  ✓ all files under notion-export/
  ✓ archive contains index.html
  ✓ archive contains index.md
  ✓ archive contains manifest.json
  ✓ archive contains export-report.md
  ✓ archive contains export-report.html
  ✓ archive contains style.css
  ✓ root page exported in HTML and Markdown
  ✓ collapsed toggle content captured (HTML)
  ✓ collapsed toggle content captured (Markdown)
  ✓ identical titles get distinct files
  ✓ internal links rewritten to relative paths
  ✓ inaccessible page keeps original URL
  ✓ database entries exported
  ✓ image asset downloaded and referenced relatively
  ✓ manifest root page ID
  ✓ manifest records cycle edge A → root
  ✓ manifest lists failed page with reason
  ✓ report names the inaccessible page
  ✓ report lists external link as unresolved
  ✓ cycle did not cause repeated visits
  ✓ user's tab was not navigated
  ✓ crawler windows closed after export
Scenario 2: cancel a large export (background tabs)
  ✓ large export starts
  ✓ export ends as cancelled
  ✓ cancelled before visiting all 31 pages
  ✓ partial archive still downloaded
  ✓ markdown-only archive has no HTML pages
  ✓ report explains cancellation
  ✓ background crawler tabs closed after cancel
Scenario 3: resume after the service worker is terminated
  ✓ export to be interrupted starts
  ✓ interrupted export is offered for resume
  ✓ orphaned crawler windows closed on restart
  ✓ resume starts
  ✓ resumed export completes all 31 pages
  ✓ completed pages were not fetched again
  ✓ resumed archive downloaded
Scenario 5: virtualized page (blocks unmount while scrolling)
  ✓ virtualized page export starts
  ✓ virtualized page export completes without warnings
  ✓ all 140 paragraphs captured across scroll positions
  ✓ all 10 collapsed toggles opened and captured
  ✓ page order preserved
Scenario 4: external FAQ capture (test build with host access pre-granted)
  ✓ export with external capture starts
  ✓ export with external page completes
  ✓ external page saved under external/
  ✓ native <details> content captured
  ✓ hidden ARIA panel captured without clicking
  ✓ lazy accordion content captured after safe click
  ✓ JSON-LD FAQ captured
  ✓ portable mode turns questions into headings
  ✓ purchase-like control never clicked
  ✓ navigation menu excluded
  ✓ Notion page links to the local external copy
  ✓ manifest lists captured external page
  ✓ external image downloaded
61/61 checks passed
```

## Live Notion checks (manual, public pages)

- `notion.notion.site` root page: snapshot extraction found 5 child pages, including a vanity-URL child resolved by block ID.
- "What's New" page in Chrome with the extension: all 131 collapsed toggles opened; 146 `<details>` sections and ~369 KB of Markdown with headings, lists, quotes and images. Large GIFs over 25 MB and HTTP 429 responses were reported as not included.
- Found and fixed from live runs: image proxy redirect to `img.notionusercontent.com` (host permission), lazy `data:` placeholders, block virtualization on long pages (accumulator), 429 back-off, asset timeouts.
- A final live re-run after the virtualization fix could not load the page (Notion rate-limiting this machine after repeated test loads). The fix is verified by e2e Scenario 5.
- Not yet verified: a logged-in private workspace (see MANUAL_TEST_CHECKLIST.md).

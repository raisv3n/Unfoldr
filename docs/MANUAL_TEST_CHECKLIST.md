# Manual Chrome test checklist

The automated suites cover extraction logic (jsdom fixtures), crawling, rendering, archives
(`npm test`), and the full extension pipeline in real Chrome against a **simulated** Notion site
(`npm run e2e`). These manual checks cover what automation cannot: your real, logged-in workspace.

Use a test workspace or non-sensitive pages. After each export, open `export-report.md` (or
`export-report.html`) in the ZIP. Unzip with Finder or `unzip` and open `notion-export/index.html` in Chrome.

Setup: `npm install && npm run build`, then load `dist/` at `chrome://extensions` (Developer mode → Load unpacked).

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 1 | Basic page | Open a page with headings, paragraphs, lists, a quote, a code block, a callout and a table. Export as HTML, then as Markdown. | Popup shows "Supported Notion page" with an ID prefix. Outcome **Export complete**. Formatting is preserved. The page shows its Notion URL and ID. `manifest.json` has the root ID. |
| 2 | Nested toggles | A page with collapsed toggles containing nested collapsed toggles and toggle headings. Leave them collapsed in your tab. | A separate export window opens and toggles expand there, not in your tab. The archive contains every nested answer. HTML uses `<details>`. Markdown "Interactive" uses `<details>`; "Portable" uses headings. Your own tab's toggles are unchanged. |
| 3 | Linked pages | A page linking to 3+ pages via inline links, @-mentions and "link to page" blocks. | All linked pages exported. Links in the archive open local files (work offline). "Linked from" sections appear. |
| 4 | Circular link | Page A links to B, and B links back to A. | Each page exported once. `manifest.json → relationships` contains both A→B and B→A. |
| 5 | Images and files | A page with uploaded images (PNG/GIF), a PDF attachment and an external image. | Files in `assets/` with correct extensions. Images render offline. Assets over the limit (default 25 MB) are listed under "Assets not included" with their original links. |
| 6 | Database | A page with an inline database (table view) whose rows have body content. Also export a full-page database. | Rows listed with visible properties. Each row page exported (with "Include database entries" on). Turning the toggle off records the rows as "not-followed". |
| 7 | Inaccessible page | Link to a page you can't access (e.g. a private page in another workspace). | Export finishes as **Partial**. The report's "Failed pages" lists it with "No access…". The link keeps the original Notion URL. |
| 8 | Identical titles | Two different pages both titled "Notes", linked from one page. | Two files `notes--<id1>.html` and `notes--<id2>.html`. Each link opens the right page. |
| 9 | External FAQ | Enable "Capture linked external websites" (accept Chrome's prompt). Export a page linking to a public FAQ page with accordions. | `external/` contains the FAQ with questions and answers. Forms and buy buttons are not clicked. Pages that fail or are bot-protected are listed in the report. Revoke access afterwards via Advanced → Revoke. |
| 10a | Large export | Root page with 50+ descendants. Lower **Max pages** to 20. | Progress counts update. The report says "Maximum page count reached". Skipped pages are listed. |
| 10b | Cancel | Start a large export and click **Cancel** after a few pages. | Ends as **Export cancelled — partial archive saved**. The ZIP contains completed pages, and the report says "Cancelled". Crawler windows close. |
| 11 | Resume (optional) | Start a large export, then go to `chrome://extensions` → service worker → Inspect → close DevTools, or wait until Chrome stops the worker. Reopen the popup. | If the worker restarted, the popup offers **Resume**. Resuming finishes without re-reading completed pages. |
| 12 | Not a Notion page | Open the popup on any other site. | "No Notion page in this tab". Export is disabled. |
| 13 | Logged out | Sign out of Notion in this Chrome profile and export a private page. | Root fails with "Login required". Outcome **Export failed**, with a clear message. |

Record Chrome version, macOS version, date, and pass/fail per row. Report extractor issues with the
page's block types, not its content.

Optional (developer): to check the extractor against a real page without sharing it, save the
page's DOM locally and run
`NOTION_SNAPSHOT=/path/page.html NOTION_SNAPSHOT_URL=<url> npx vitest run tests/live-snapshot.test.ts`.
Never commit snapshots.

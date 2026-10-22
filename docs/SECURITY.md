# Security, privacy and permissions

Notion Exporter runs entirely inside your Chrome profile. It has no backend, makes no analytics or
telemetry calls, and uses no AI or cloud services. Archives are written only to your Downloads folder.

## Permissions

| Permission | Why it is needed |
|---|---|
| `scripting` | Inject the extractor into crawler tabs (and, read-only, into the active Notion tab to show its status in the popup). Scripts are injected on demand; there are no always-on content scripts. |
| `storage`, `unlimitedStorage` | Settings, last result, and IndexedDB storage for extracted pages, downloaded assets and the finished ZIP (allows large exports and resume after a service-worker restart). |
| `downloads` | Save the ZIP to your Downloads folder. |
| `offscreen` | Service workers cannot create blob URLs; an offscreen document turns the stored ZIP into a blob URL for `chrome.downloads`. |
| Host access: `notion.so`, `*.notion.com`, `*.notion.site` | Read Notion pages in crawler tabs using your existing session. |
| Host access: `file.notion.so`, `*.notionusercontent.com`, `*.notion-static.com`, Notion's S3 buckets | Download images and attachments. Notion's `/image/` proxy redirects to `img.notionusercontent.com`. |
| Optional: `https://*/*` | **Only requested if you enable "Capture linked external websites".** Chrome shows a prompt; you can revoke it from the popup (Advanced → Revoke) or `chrome://extensions`. External hosts cannot be known in advance, so a narrower grant is not possible. |

Not requested: `tabs`, `cookies`, `webRequest`, `debugger`, `<all_urls>` (by default), `history`, `bookmarks`.

## Authentication and session handling

- The extension **never reads, stores or exports cookies or tokens.** Pages load in normal Chrome tabs, so
  Notion sees the same session as when you browse. Asset requests to Notion hosts are sent with
  `credentials: 'include'`, which lets Chrome attach your session cookies without the extension seeing them.
- No undocumented Notion API is called. Extraction reads the rendered page (DOM).
- Inaccessible pages (login, no access, deleted, verification challenge) are reported, never bypassed.
- Signed URL parameters (`signature`, `X-Amz-*`, `tok`, `expirationTimestamp` and similar) are removed from
  every URL written to `manifest.json` and the export report.

## Untrusted content

All Notion and website content is treated as untrusted:

- **No markup passthrough.** Extractors read text, attributes and structure into a typed model. Renderers
  build output only from that model and escape every string (`escapeHtml` / `escapeMd`).
- **No scripts in the archive.** Exported HTML contains no `<script>`. Every page also carries a
  `Content-Security-Policy` meta tag with `script-src 'none'`, `object-src 'none'`, `frame-src 'none'`.
  Embeds are written as links, never iframes.
- **URL scheme allowlist.** Only `http:`, `https:` and `mailto:` links are written. `javascript:`, `data:`,
  `file:` and links with embedded credentials are dropped, and a warning is recorded.
- **SVG.** SVG assets that contain scripts, event handlers, `foreignObject`, or external references are refused.
- **MIME checks.** HTML or JavaScript responses are never stored as assets. An HTML response where an image
  or file was expected is reported as an expired link or login page.
- **External pages** are visited in a crawler tab. JSON-LD is parsed with `JSON.parse`, never evaluated.
  HTML inside JSON-LD answers is parsed into an inert `<template>` with scripts removed.

## Network safety

Every fetch goes through `checkFetchUrl` (`src/shared/url-safety.ts`):

- `https:` only. Standard ports only. No credentials in URLs.
- Host must be in the request class's allowlist (Notion hosts for assets; any public host only when
  external capture is enabled and permitted).
- Blocked: `localhost`, private and reserved IPv4 ranges (10/8, 127/8, 169.254/16 incl. cloud metadata,
  172.16/12, 192.168/16, 100.64/10, 0/8, multicast), IPv6 loopback, link-local and ULA, IPv4-mapped IPv6,
  single-label hosts, and internal suffixes (`.local`, `.internal`, `.lan`, `.home.arpa`, …).
- **Redirects:** browser `fetch` follows redirects internally and does not expose intermediate hops to
  extensions. The final URL is validated **before the response body is read**, and the response is
  discarded if it lands on a blocked destination. External pages opened in tabs are checked the same way
  (final tab URL) before extraction.
- **Known limitation:** DNS is not visible to extensions, so a public hostname that resolves to a private
  address cannot be detected. Chrome's own Private Network Access protections still apply.
- Per-asset size limit (Content-Length check plus streaming byte counter), total size and count limits,
  and a 90 s timeout per asset.

## Archive safety

- Paths are generated from slugs (`[a-z0-9-]`) plus IDs and validated by `assertSafeArchivePath`, both when
  the file map is built and again when the ZIP is written. Absolute paths, `..`, backslashes, drive
  letters, control characters and empty segments are rejected (no zip-slip).
- Everything lives under a single `notion-export/` root folder.

## Interaction safety

- Notion: the exporter clicks only the toggle buttons that belong to toggle blocks and toggle headings, and
  Notion's own "Load more" pagination inside database views. It never edits content. Toggles it opened are
  re-collapsed afterwards (configurable).
- External sites: only `aria-expanded="false"` triggers whose controlled panel is **empty** are clicked,
  and only if the trigger is a button, is outside any `<form>`, is not a link to another page, and its
  label does not match purchase, account, submit or destructive wording (buy, checkout, pay, order,
  subscribe, sign in/out, delete, remove, submit, send, download, confirm, …).
- Only extension pages can control exports. The service worker ignores messages whose sender is not one of
  the extension's own pages.
- Crawling never uses your active tab. It uses a separate unfocused window (default) or inactive
  background tabs, which are closed after the export, and on restart if the service worker was killed.

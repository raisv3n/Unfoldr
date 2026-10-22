// End-to-end smoke test: loads the built extension (dist/) into real Chrome and runs exports
// against a local HTTPS server that simulates Notion's rendered DOM (lazy rendering, collapsed
// toggles that render children only when opened, a database, an inaccessible page, a cycle,
// duplicate titles, an image). No network access or Notion account is needed.
//
//   npm run build && npm run e2e            (headless)
//   HEADFUL=1 npm run e2e                   (watch it)
//   CHROME_PATH=/path/to/chrome npm run e2e

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import puppeteer from 'puppeteer-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const HOST = 'e2e.notion.site';
const EXT_HOST = 'faq.example-e2e.com';
const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(join(dist, 'manifest.json'))) throw new Error('dist/ not found — run `npm run build` first');

// ---- fixture pages ---------------------------------------------------------------------------

const id = (d) => d.repeat(12) + '4' + d.repeat(3) + '8' + d.repeat(15);
const uuid = (i) => `${i.slice(0, 8)}-${i.slice(8, 12)}-${i.slice(12, 16)}-${i.slice(16, 20)}-${i.slice(20)}`;
const R = id('1'), A = id('2'), B = id('3'), C = id('4'), D = id('5'), E = id('6'), BIG = id('7'), XR = id('8'), VIRT = id('9');
const bigChild = (n) => `a${String(n).padStart(3, '0')}${'0'.repeat(8)}40008${'0'.repeat(15)}`;
let blockSeq = 0;
const bid = () => uuid(`b${String(++blockSeq).padStart(31, '0')}`);

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const text = (html) => `<div data-block-id="${bid()}" class="notion-selectable notion-text-block"><div><div data-content-editable-leaf="true">${html}</div></div></div>`;
const toggle = (summary, childrenHtml) =>
  `<div data-block-id="${bid()}" class="notion-selectable notion-toggle-block"><div class="notion-list-item-box-left"><div role="button" tabindex="0" aria-expanded="false" aria-label="Open"></div></div><div data-content-editable-leaf="true">${summary}</div><div class="kids"></div><template class="kids-tpl">${childrenHtml}</template></div>`;
const childPage = (pid, title) =>
  `<div data-block-id="${uuid(pid)}" class="notion-selectable notion-page-block"><a href="/${title}-${pid}?pvs=25"><div class="notion-record-icon notranslate"><span>📄</span></div><div class="notranslate">${title}</div></a></div>`;

function shell(pid, title, content, extraScript = '') {
  // The page "hydrates" after a delay, like Notion's SPA; toggles render children only when opened.
  return `<!doctype html><html><head><title>${title} | Notion</title></head><body><div id="notion-app"></div>
<template id="frame"><main class="notion-frame"><div class="notion-scroller vertical" style="height:800px;overflow:auto">
<div data-block-id="${uuid(pid)}" class="notion-selectable notion-page-block"><h1 data-content-editable-leaf="true">${title}</h1></div>
<div class="notion-page-content">${content}</div></div></main></template>
<script>
setTimeout(() => document.getElementById('notion-app').appendChild(document.getElementById('frame').content.cloneNode(true)), 400);
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[role="button"][aria-expanded]'); if (!btn) return;
  const block = btn.closest('[data-block-id]');
  const kids = block.querySelector(':scope > .kids'), tpl = block.querySelector(':scope > template.kids-tpl');
  if (btn.getAttribute('aria-expanded') === 'false') { btn.setAttribute('aria-expanded', 'true'); setTimeout(() => kids.appendChild(tpl.content.cloneNode(true)), 250); }
  else { btn.setAttribute('aria-expanded', 'false'); kids.innerHTML = ''; }
});
${extraScript}
</script></body></html>`;
}

// Virtualized page: like Notion, only ~40 blocks around the scroll position are mounted at a time;
// toggle open state survives unmounting.
function virtualPage() {
  const items = Array.from({ length: 150 }, (_, i) => {
    const n = String(i).padStart(31, '0');
    return i % 15 === 0
      ? { id: uuid(`c${n}`), cid: uuid(`d${n}`), kind: 't', text: `Virtual question ${i}`, child: `Virtual hidden answer ${i}` }
      : { id: uuid(`c${n}`), kind: 'p', text: `Virtual paragraph ${i}` };
  });
  const script = `
const items = ${JSON.stringify(items)};
const open = {};
setTimeout(() => {
  const sc = document.querySelector('.notion-scroller'), content = document.querySelector('.notion-page-content');
  const html = (it) => it.kind === 'p'
    ? '<div data-block-id="' + it.id + '" class="notion-selectable notion-text-block" style="height:40px"><div data-content-editable-leaf="true">' + it.text + '</div></div>'
    : '<div data-block-id="' + it.id + '" class="notion-selectable notion-toggle-block" style="min-height:40px"><div class="notion-list-item-box-left"><div role="button" class="vt" aria-expanded="' + !!open[it.id] + '"></div></div><div data-content-editable-leaf="true">' + it.text + '</div><div>' +
      (open[it.id] ? '<div data-block-id="' + it.cid + '" class="notion-selectable notion-text-block"><div data-content-editable-leaf="true">' + it.child + '</div></div>' : '') + '</div></div>';
  const render = () => {
    const first = Math.max(0, Math.floor(sc.scrollTop / 40) - 10), last = Math.min(items.length, first + 40);
    content.innerHTML = '<div style="height:' + first * 40 + 'px"></div>' + items.slice(first, last).map(html).join('') + '<div style="height:' + (items.length - last) * 40 + 'px"></div>';
  };
  sc.addEventListener('scroll', render);
  content.addEventListener('click', (e) => {
    const btn = e.target.closest('.vt'); if (!btn) return;
    e.stopPropagation();
    open[btn.closest('[data-block-id]').dataset.blockId] = true;
    setTimeout(render, 200);
  }, true);
  render();
}, 600);`;
  return shell(VIRT, 'Virtual Page', '', script);
}

const pages = {
  [R]: () =>
    shell(R, 'Fixture Root', [
      text(`Intro with <a class="notion-link-token" href="/Notes-${A}">a link to notes</a>, a mention <span class="notion-page-mention-token notion-text-mention-token"><a href="/Secret-${B}">Secret Page</a></span> and <a class="notion-link-token" href="https://example.com/outside">an external link</a>.`),
      toggle('Collapsed question', text('Hidden answer text') + toggle('Nested collapsed', text('Deep hidden answer'))),
      childPage(C, 'Notes'),
      `<div data-block-id="${bid()}" class="notion-selectable notion-image-block"><div><img src="/image/https%3A%2F%2Fexample.com%2Fpic.png?table=block&amp;id=x&amp;width=800" alt="Pixel"></div></div>`,
      `<div data-block-id="${bid()}" class="notion-selectable notion-collection_view-block"><div><div data-content-editable-leaf="true">Tasks</div></div><div class="notion-table-view">
        <div class="notion-table-view-header-cell">Name</div><div class="notion-table-view-header-cell">Status</div>
        <div data-block-id="${uuid(D)}" class="notion-selectable notion-page-block notion-collection-item"><div class="notion-table-view-cell">Task D</div><div class="notion-table-view-cell">Done</div></div>
        <div data-block-id="${uuid(E)}" class="notion-selectable notion-page-block notion-collection-item"><div class="notion-table-view-cell">Task E</div><div class="notion-table-view-cell">Todo</div></div>
      </div></div>`,
    ].join('\n')),
  [A]: () => shell(A, 'Notes', text(`Back to <a class="notion-link-token" href="/Fixture-Root-${R}">the root</a> (cycle).`)),
  [C]: () => shell(C, 'Notes', text('Child page with the same title as another page.')),
  [D]: () => shell(D, 'Task D', text('Database entry D body.')),
  [E]: () => shell(E, 'Task E', text(`Entry E links to <a class="notion-link-token" href="/Task-D-${D}">Task D</a>.`)),
  [BIG]: () => shell(BIG, 'Big Page', Array.from({ length: 30 }, (_, i) => childPage(bigChild(i), `Child ${i}`)).join('\n')),
};
pages[VIRT] = virtualPage;
pages[XR] = () => shell(XR, 'Links Out', text(`See the <a class="notion-link-token" href="https://${EXT_HOST}/faq">vendor FAQ</a>.`));
for (let i = 0; i < 30; i++) pages[bigChild(i)] = () => shell(bigChild(i), `Child ${i}`, text(`Child ${i} body.`));

const EXTERNAL_FAQ = `<!doctype html><html><head><title>Vendor FAQ</title>
<script type="application/ld+json">{"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Structured-only question?","acceptedAnswer":{"@type":"Answer","text":"<p>Structured answer.</p>"}}]}</script></head>
<body><nav>Menu</nav><main><h1>Vendor FAQ</h1><p>Intro paragraph for the FAQ page.</p>
<details><summary>Native question?</summary><p>Native answer.</p></details>
<h3><button aria-expanded="false" aria-controls="p1">Hidden panel question?</button></h3><div id="p1" hidden><p>Hidden panel answer.</p></div>
<h3><button aria-expanded="false" aria-controls="p2" id="lazy">Lazy question?</button></h3><div id="p2" hidden></div>
<button aria-expanded="false" aria-controls="p3" onclick="location.href='/purchase'">Buy now</button><div id="p3"></div>
<img src="/logo.png" alt="Logo"></main>
<script>document.getElementById('lazy').addEventListener('click', () => { setTimeout(() => { document.getElementById('p2').innerHTML = '<p>Lazy answer loaded on click.</p>'; }, 200); });</script>
</body></html>`;

const requests = [];
function handler(req, res) {
  const url = new URL(req.url, `https://${HOST}`);
  requests.push(url.pathname);
  if (req.headers.host?.startsWith(EXT_HOST)) {
    if (url.pathname === '/faq') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(EXTERNAL_FAQ);
    }
    if (url.pathname === '/logo.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(PNG);
    }
    res.writeHead(404);
    return res.end();
  }
  if (url.pathname.startsWith('/image/')) {
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length });
    return res.end(PNG);
  }
  const m = /([0-9a-f]{32})$/.exec(url.pathname);
  const pid = m?.[1];
  if (pid === B) {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<!doctype html><html><head><title>Notion</title></head><body><div id="notion-app"><p>No access to this page</p><button>Request access</button></div></body></html>');
  }
  const page = pid && pages[pid];
  if (!page) {
    res.writeHead(404, { 'content-type': 'text/html' });
    return res.end('<!doctype html><title>Not found</title><body>This content does not exist</body>');
  }
  const delay = pid.startsWith('a') ? 1200 : 0; // slow children for the cancellation scenario
  setTimeout(() => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page());
  }, delay);
}

// ---- harness ---------------------------------------------------------------------------------

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
}

const work = mkdtempSync(join(tmpdir(), 'notion-exporter-e2e-'));
const downloads = join(work, 'downloads');
const profile = join(work, 'profile');
mkdirSync(downloads);
mkdirSync(join(profile, 'Default'), { recursive: true });
writeFileSync(join(profile, 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false } }));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(work, 'key.pem'), '-out', join(work, 'cert.pem'), '-days', '1', '-subj', `/CN=${HOST}`], { stdio: 'ignore' });
const server = createServer({ key: readFileSync(join(work, 'key.pem')), cert: readFileSync(join(work, 'cert.pem')) }, handler);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// Test-only copy of the build with https://*/* pre-granted: the optional-permission prompt used in
// real use cannot be accepted under automation.
const distExt = join(work, 'dist-external');
execFileSync('cp', ['-R', dist, distExt]);
const extManifest = JSON.parse(readFileSync(join(distExt, 'manifest.json'), 'utf8'));
extManifest.host_permissions.push('https://*/*');
writeFileSync(join(distExt, 'manifest.json'), JSON.stringify(extManifest));
const useExternalBuild = process.env.E2E_EXTERNAL !== '0';

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: !process.env.HEADFUL,
  pipe: true,
  protocolTimeout: 60000,
  enableExtensions: [useExternalBuild ? distExt : dist],
  userDataDir: profile,
  args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1:${port}, MAP ${EXT_HOST} 127.0.0.1:${port}`, '--ignore-certificate-errors', '--no-first-run', '--no-default-browser-check'],
});

let exitCode = 0;
try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 15000 });
  const extId = new URL(swTarget.url()).host;
  check('extension loads and its MV3 service worker starts', !!extId);
  const cdp = await browser.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads }).catch(() => undefined);

  // The "user's" tab showing the root page — it must not be hijacked by the crawler.
  const userTab = (await browser.pages())[0] ?? (await browser.newPage());
  await userTab.goto(`https://${HOST}/Fixture-Root-${R}`);
  const popup = await browser.newPage();
  const popupErrors = [];
  popup.on('pageerror', (e) => popupErrors.push(e.message));
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.waitForSelector('#export-form');
  check('popup renders without script errors', popupErrors.length === 0, popupErrors.join('; '));
  const baselineTargets = (await browser.pages()).length;

  const send = (msg) => popup.evaluate((m) => chrome.runtime.sendMessage(m), msg);
  const waitDone = async (timeoutMs) => {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const st = await send({ type: 'getStatus' });
      const p = st.progress;
      if (p && ['done', 'cancelled', 'error'].includes(p.phase)) return p;
      if (Date.now() > end) throw new Error(`Timed out; last phase ${p?.phase}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  };
  const newestZip = async (before) => {
    for (let i = 0; i < 40; i++) {
      const z = readdirSync(downloads).filter((f) => f.endsWith('.zip') && !before.includes(f));
      if (z.length) return join(downloads, z[0]);
      await new Promise((r) => setTimeout(r, 250));
    }
    return undefined;
  };

  // ---- Scenario 1: full export, both formats, separate export window -------------------------
  console.log('\nScenario 1: recursive export (both formats, export window)');
  const settings = { format: 'both', concurrency: 2, maxRetries: 1, crawlSurface: 'window', pageTimeoutSec: 40, markdownToggleMode: 'interactive' };
  const before1 = readdirSync(downloads);
  const start = await send({ type: 'startExport', tabUrl: `https://${HOST}/Fixture-Root-${R}`, tabTitle: 'Fixture Root', settings });
  check('export starts', start.ok, start.error);
  const p1 = await waitDone(120000);
  if (p1.outcome !== 'partial') console.log(p1.error ?? '', p1.reportMarkdown ?? '');
  check('export finishes with a partial outcome (one page inaccessible)', p1.phase === 'done' && p1.outcome === 'partial', `${p1.phase}/${p1.outcome} ${p1.error ?? ''}`);
  check('pages: 5 exported, 1 failed', p1.pages.completed + p1.pages.partial === 5 && p1.pages.failed === 1, JSON.stringify(p1.pages));
  const zipPath = await newestZip(before1);
  check('ZIP downloaded via chrome.downloads', !!zipPath);
  if (zipPath) {
    const zip = await JSZip.loadAsync(readFileSync(zipPath));
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    const read = (n) => zip.file(n)?.async('string');
    check('all files under notion-export/', names.every((n) => n.startsWith('notion-export/')));
    for (const f of ['index.html', 'index.md', 'manifest.json', 'export-report.md', 'export-report.html', 'style.css']) check(`archive contains ${f}`, names.includes(`notion-export/${f}`));
    const rootHtml = await read(`notion-export/pages/fixture-root--${R}.html`);
    const rootMd = await read(`notion-export/pages/fixture-root--${R}.md`);
    check('root page exported in HTML and Markdown', !!rootHtml && !!rootMd);
    check('collapsed toggle content captured (HTML)', !!rootHtml?.includes('Hidden answer text') && !!rootHtml?.includes('Deep hidden answer'));
    check('collapsed toggle content captured (Markdown)', !!rootMd?.includes('Deep hidden answer') && !!rootMd?.includes('<details>'));
    check('identical titles get distinct files', names.includes(`notion-export/pages/notes--${A}.html`) && names.includes(`notion-export/pages/notes--${C}.html`));
    check('internal links rewritten to relative paths', !!rootHtml?.includes(`href="notes--${A}.html"`) && !!rootMd?.includes(`(notes--${A}.md)`));
    check('inaccessible page keeps original URL', !!rootHtml?.includes(`https://${HOST}/Secret-${B}`));
    check('database entries exported', names.includes(`notion-export/pages/task-d--${D}.html`) && names.includes(`notion-export/pages/task-e--${E}.md`));
    const img = names.find((n) => n.startsWith('notion-export/assets/') && n.endsWith('.png'));
    check('image asset downloaded and referenced relatively', !!img && !!rootHtml?.includes(`src="../${img.replace('notion-export/', '')}"`));
    const manifest = JSON.parse(await read('notion-export/manifest.json'));
    check('manifest root page ID', manifest.root.pageId === R);
    check('manifest records cycle edge A → root', manifest.relationships.some((e) => e.from === A && e.to === R));
    check('manifest lists failed page with reason', manifest.missing.some((m) => m.key === B && /inaccessible/.test(m.reason)));
    const report = await read('notion-export/export-report.md');
    check('report names the inaccessible page', /Failed pages \(1\)/.test(report) && report.includes('No access'));
    check('report lists external link as unresolved', report.includes('external capture disabled'));
    check('cycle did not cause repeated visits', requests.filter((p) => p.endsWith(R)).length <= 3, String(requests.filter((p) => p.endsWith(R)).length));
  }
  const userUrl = userTab.url();
  check("user's tab was not navigated", userUrl === `https://${HOST}/Fixture-Root-${R}`, userUrl);
  await new Promise((r) => setTimeout(r, 500));
  check('crawler windows closed after export', (await browser.pages()).length === baselineTargets, `${(await browser.pages()).length} vs ${baselineTargets}`);

  // ---- Scenario 2: cancellation with background tabs ------------------------------------------
  console.log('\nScenario 2: cancel a large export (background tabs)');
  await send({ type: 'dismissResult' });
  const before2 = readdirSync(downloads);
  const start2 = await send({ type: 'startExport', tabUrl: `https://${HOST}/Big-Page-${BIG}`, settings: { format: 'markdown', concurrency: 2, crawlSurface: 'background-tab', downloadAssets: false } });
  check('large export starts', start2.ok, start2.error);
  for (let i = 0; i < 60; i++) {
    const st = await send({ type: 'getStatus' });
    if ((st.progress?.pages.completed ?? 0) >= 3) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await send({ type: 'cancelExport' });
  const p2 = await waitDone(60000);
  if (p2.outcome !== 'cancelled') console.log(p2.error ?? '', p2.reportMarkdown ?? '');
  check('export ends as cancelled', p2.phase === 'cancelled' && p2.outcome === 'cancelled', `${p2.phase}/${p2.outcome} ${p2.error ?? ''}`);
  check('cancelled before visiting all 31 pages', p2.pages.completed < 31 && p2.pages.skipped > 0, JSON.stringify(p2.pages));
  const zip2 = await newestZip(before2);
  check('partial archive still downloaded', !!zip2);
  if (zip2) {
    const z = await JSZip.loadAsync(readFileSync(zip2));
    const n = Object.keys(z.files);
    check('markdown-only archive has no HTML pages', n.some((f) => f.endsWith('.md')) && !n.some((f) => f.endsWith('.html')));
    check('report explains cancellation', (await z.file('notion-export/export-report.md').async('string')).includes('Cancelled'));
  }
  await new Promise((r) => setTimeout(r, 500));
  check('background crawler tabs closed after cancel', (await browser.pages()).length === baselineTargets);

  // ---- Scenario 3: service worker killed mid-export, then resumed -----------------------------
  console.log('\nScenario 3: resume after the service worker is terminated');
  await send({ type: 'dismissResult' });
  const before3 = readdirSync(downloads);
  requests.length = 0;
  const start3 = await send({ type: 'startExport', tabUrl: `https://${HOST}/Big-Page-${BIG}`, settings: { format: 'html', concurrency: 2, crawlSurface: 'window', downloadAssets: false } });
  check('export to be interrupted starts', start3.ok, start3.error);
  let doneBeforeKill = 0;
  for (let i = 0; i < 60; i++) {
    const st = await send({ type: 'getStatus' });
    doneBeforeKill = st.progress?.pages.completed ?? 0;
    if (doneBeforeKill >= 6) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 1500)); // let the debounced snapshot persist
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'));
  await cdp.send('Target.closeTarget', { targetId: sw._targetId }).catch(() => undefined);
  if (process.env.E2E_DEBUG) console.log('    killed service worker after', doneBeforeKill, 'pages');
  await new Promise((r) => setTimeout(r, 1500));
  const st3 = await send({ type: 'getStatus' }); // wakes a fresh service worker
  if (process.env.E2E_DEBUG) console.log('    status after restart', JSON.stringify(st3).slice(0, 300));
  check('interrupted export is offered for resume', !!st3.progress?.resumable, JSON.stringify(st3.progress?.phase));
  await new Promise((r) => setTimeout(r, 1000));
  check('orphaned crawler windows closed on restart', (await browser.pages()).length === baselineTargets, `${(await browser.pages()).length} vs ${baselineTargets}`);
  const fetchedBefore = new Set(requests.filter((p) => /[0-9a-f]{32}$/.test(p)));
  requests.length = 0;
  const resumed = await send({ type: 'resumeExport' });
  check('resume starts', resumed.ok, resumed.error);
  const p3 = await waitDone(120000);
  check('resumed export completes all 31 pages', p3.phase === 'done' && p3.pages.completed === 31, `${p3.phase} ${JSON.stringify(p3.pages)} ${p3.error ?? ''}`);
  const refetched = requests.filter((p) => fetchedBefore.has(p) && !p.endsWith(BIG)).length;
  check('completed pages were not fetched again', refetched <= 2, `${refetched} refetched (in-flight pages may be retried)`);
  check('resumed archive downloaded', !!(await newestZip(before3)));

  // ---- Scenario 5: virtualized long page ------------------------------------------------------
  console.log('\nScenario 5: virtualized page (blocks unmount while scrolling)');
  await send({ type: 'dismissResult' });
  const before5 = readdirSync(downloads);
  const start5 = await send({ type: 'startExport', tabUrl: `https://${HOST}/Virtual-Page-${VIRT}`, settings: { format: 'markdown', crawlSurface: 'window', markdownToggleMode: 'interactive' } });
  check('virtualized page export starts', start5.ok, start5.error);
  const p5 = await waitDone(120000);
  check('virtualized page export completes without warnings', p5.phase === 'done' && p5.outcome === 'success', `${p5.phase}/${p5.outcome} ${p5.error ?? ''}`);
  const zip5 = await newestZip(before5);
  if (zip5) {
    const z = await JSZip.loadAsync(readFileSync(zip5));
    const md = await z.file(`notion-export/pages/virtual-page--${VIRT}.md`).async('string');
    const paras = Array.from({ length: 150 }, (_, i) => i).filter((i) => i % 15 !== 0);
    const missing = paras.filter((i) => !md.includes(`Virtual paragraph ${i}\n`));
    check('all 140 paragraphs captured across scroll positions', missing.length === 0, `missing ${missing.slice(0, 10).join(',')}`);
    const answers = Array.from({ length: 10 }, (_, k) => k * 15).filter((i) => !md.includes(`Virtual hidden answer ${i}`));
    check('all 10 collapsed toggles opened and captured', answers.length === 0, `missing ${answers.join(',')}`);
    check('page order preserved', md.indexOf('Virtual paragraph 1\n') < md.indexOf('Virtual paragraph 74\n') && md.indexOf('Virtual paragraph 74\n') < md.indexOf('Virtual paragraph 149\n'));
  } else check('virtualized page archive downloaded', false);

  // ---- Scenario 4: external website capture ---------------------------------------------------
  console.log('\nScenario 4: external FAQ capture (test build with host access pre-granted)');
  await send({ type: 'dismissResult' });
  const before4 = readdirSync(downloads);
  requests.length = 0;
  const start4 = await send({ type: 'startExport', tabUrl: `https://${HOST}/Links-Out-${XR}`, settings: { format: 'markdown', captureExternal: true, crawlSurface: 'window', markdownToggleMode: 'portable' } });
  check('export with external capture starts', start4.ok, start4.error);
  const p4 = await waitDone(90000);
  check('export with external page completes', p4.phase === 'done', `${p4.phase}/${p4.outcome} ${p4.error ?? ''}`);
  const zip4 = await newestZip(before4);
  if (zip4) {
    const z = await JSZip.loadAsync(readFileSync(zip4));
    const extFile = Object.keys(z.files).find((n) => n.startsWith('notion-export/external/') && n.endsWith('.md'));
    check('external page saved under external/', !!extFile);
    const md = extFile ? await z.file(extFile).async('string') : '';
    check('native <details> content captured', md.includes('Native answer.'));
    check('hidden ARIA panel captured without clicking', md.includes('Hidden panel answer.'));
    check('lazy accordion content captured after safe click', md.includes('Lazy answer loaded on click.'));
    check('JSON-LD FAQ captured', md.includes('Structured answer.'));
    check('portable mode turns questions into headings', /^#{2,6} Native question\?$/m.test(md));
    check('purchase-like control never clicked', !requests.includes('/purchase'));
    check('navigation menu excluded', !md.includes('Menu'));
    const root = await z.file(`notion-export/pages/links-out--${XR}.md`).async('string');
    check('Notion page links to the local external copy', /\]\(\.\.\/external\/vendor-faq--[0-9a-f]{16}\.md\)/.test(root));
    const manifest = JSON.parse(await z.file('notion-export/manifest.json').async('string'));
    check('manifest lists captured external page', manifest.externalPages.some((e) => e.exported && e.url.includes(EXT_HOST)));
    check('external image downloaded', Object.keys(z.files).some((n) => n.startsWith('notion-export/assets/logo--')));
  } else check('external capture archive downloaded', false);
} catch (e) {
  console.error(e);
  check('e2e run completed without exceptions', false, e.message);
} finally {
  await browser.close().catch(() => undefined);
  server.close();
  rmSync(work, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) exitCode = 1;
process.exit(exitCode);

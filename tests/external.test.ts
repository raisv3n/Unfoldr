import { describe, expect, it } from 'vitest';
import { extractExternalPage, isSafeToggleTrigger } from '../src/content/external-dom';
import { normalizeExternalPage } from '../src/normalize/external';
import type { Block } from '../src/shared/model';
import { domFrom } from './helpers';

const HTML = `<!doctype html><html><head><title>Example FAQ</title>
<script>window.evil = 1</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
  {"@type":"Question","name":"Is there a JSON-LD only question?","acceptedAnswer":{"@type":"Answer","text":"<p>Yes, <b>only</b> here.</p><script>alert(1)<\\/script>"}},
  {"@type":"Question","name":"What is native details?","acceptedAnswer":{"@type":"Answer","text":"Duplicate of HTML"}}]}</script>
</head><body>
<nav><a href="/home">Home</a></nav>
<main>
  <h1>Help Center FAQ</h1>
  <p>Intro with <a href="/docs">docs</a> and <strong>bold</strong>.</p>
  <details><summary>What is native details?</summary><p>Native answer.</p><ul><li>Point A</li><li>Point B</li></ul></details>
  <div class="accordion">
    <h3><button aria-expanded="false" aria-controls="panel-1" id="q1">How do accordions work?</button></h3>
    <div id="panel-1" role="region" hidden><p>Hidden accordion answer.</p></div>
    <h3><button aria-expanded="false" aria-controls="panel-2">Lazy question?</button></h3>
    <div id="panel-2" role="region" hidden></div>
  </div>
  <dl><dt>Term question?</dt><dd>Definition answer.</dd></dl>
  <img src="/img/diagram.png" alt="Diagram">
  <img src="https://tracker.example/pixel.gif" width="1">
  <form><button aria-expanded="false" aria-controls="x">Submit order</button></form>
  <table><tr><th>Plan</th><th>Price</th></tr><tr><td>Free</td><td>$0</td></tr></table>
</main>
<footer>Footer text</footer>
</body></html>`;

function flat(blocks: Block[]): Block[] {
  return blocks.flatMap((b) => [b, ...flat(b.children ?? [])]);
}

describe('external page extraction', () => {
  const doc = domFrom(HTML, 'https://help.example.com/faq');
  const raw = extractExternalPage(doc, 'https://help.example.com/faq');
  const page = normalizeExternalPage(raw, 'https://help.example.com/faq', '2026-01-01T00:00:00Z');
  const all = flat(page.blocks);
  const toggles = all.filter((b): b is Extract<Block, { type: 'toggle' }> => b.type === 'toggle');
  const text = JSON.stringify(page.blocks);

  it('extracts readable content and skips navigation, footer and scripts', () => {
    expect(page.title).toBe('Help Center FAQ');
    expect(page.source).toBe('external');
    expect(page.key).toMatch(/^ext:[0-9a-f]{16}$/);
    expect(text).toContain('Intro with ');
    expect(text).not.toContain('Footer text');
    expect(text).not.toContain('window.evil');
    expect(text).not.toContain('alert(1)');
    expect(all.some((b) => b.type === 'table')).toBe(true);
  });

  it('captures details, ARIA accordion (hidden panels), definition lists and JSON-LD FAQ', () => {
    const summaries = toggles.map((t) => t.text.map((r) => (r.type === 'equation' ? '' : r.text)).join(''));
    expect(summaries).toEqual(expect.arrayContaining(['What is native details?', 'How do accordions work?', 'Lazy question?', 'Term question?', 'Is there a JSON-LD only question?']));
    expect(summaries.filter((s) => s === 'What is native details?').length).toBe(1);
    expect(text).toContain('Native answer.');
    expect(text).toContain('Hidden accordion answer.');
    expect(text).toContain('Definition answer.');
    expect(text).toContain('Yes, only here.');
  });

  it('does not treat form submit controls as accordions to click', () => {
    const btn = doc.querySelector('form button')!;
    expect(isSafeToggleTrigger(btn)).toBe(false);
    expect(isSafeToggleTrigger(doc.querySelector('#q1')!)).toBe(true);
    const buy = domFrom('<button aria-expanded="false" aria-controls="p">Buy now</button><div id="p"></div>').querySelector('button')!;
    expect(isSafeToggleTrigger(buy)).toBe(false);
  });

  it('reports empty lazy panels and marks the page partial', () => {
    expect(page.status).toBe('partial');
    expect(page.warnings.join(' ')).toMatch(/1 expandable section/);
  });

  it('collects images as assets but ignores tracking pixels', () => {
    expect(page.assets.map((a) => a.originalUrl)).toEqual(['https://help.example.com/img/diagram.png']);
  });

  it('records outgoing links as references', () => {
    expect(page.references.some((r) => r.url === 'https://help.example.com/docs')).toBe(true);
  });
});

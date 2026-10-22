// External website adapter: readable content + expandable sections → RawPage.
// Pure DOM functions (jsdom-testable). Never evaluates page scripts; JSON-LD is parsed as data.

import type { RawBlock, RawInline, RawPage } from '../shared/raw';
import { extractInline } from './inline';

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'NAV', 'FOOTER', 'ASIDE', 'FORM', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'IFRAME', 'CANVAS', 'OBJECT', 'EMBED', 'DIALOG', 'VIDEO', 'AUDIO']);
const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'PRE', 'BLOCKQUOTE', 'FIGURE', 'DETAILS', 'DL', 'HR', 'IMG', 'NAV', 'ASIDE', 'FOOTER', 'FORM']);
/** Controls the exporter must never activate. */
const DANGEROUS = /(buy|purchase|checkout|pay|order|cart|subscribe|sign\s*(in|up|out)|log\s*(in|out)|register|delete|remove|cancel|submit|send|download|install|accept|agree|confirm|unsubscribe|book|donate|share|print)/i;

interface Ctx {
  baseUrl: string;
  panels: Map<Element, Element>;
  panelSet: Set<Element>;
  consumed: Set<Element>;
  counter: { n: number };
  depth: number;
}

function newId(ctx: Ctx): string {
  return `x${(ctx.counter.n++).toString(36)}`;
}

function isHidden(el: Element): boolean {
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return true;
  const style = (el.getAttribute('style') ?? '').replace(/\s/g, '').toLowerCase();
  return style.includes('display:none') || style.includes('visibility:hidden');
}

function hasBlockDescendant(el: Element): boolean {
  return Array.from(el.querySelectorAll('*')).some((d) => BLOCK_TAGS.has(d.tagName.toUpperCase()));
}

function inline(el: Element | null | undefined, ctx: Ctx): RawInline[] {
  return extractInline(el, { baseUrl: ctx.baseUrl, notion: false });
}

function plain(runs: RawInline[]): string {
  return runs.map((r) => r.text).join('').replace(/\s+/g, ' ').trim();
}

function trimRuns(runs: RawInline[]): RawInline[] {
  const out = runs.map((r) => ({ ...r, text: r.text.replace(/\s+/g, ' ') })).filter((r) => r.text);
  if (out[0]) out[0].text = out[0].text.replace(/^\s+/, '');
  const last = out[out.length - 1];
  if (last) last.text = last.text.replace(/\s+$/, '');
  return out.filter((r) => r.text);
}

function absUrl(href: string | null, base: string): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

/** ARIA accordion triggers mapped to their controlled panels. */
export function findAccordionPanels(root: ParentNode, doc: Document): Map<Element, Element> {
  const map = new Map<Element, Element>();
  for (const trigger of Array.from(root.querySelectorAll('[aria-controls][aria-expanded]'))) {
    const ids = (trigger.getAttribute('aria-controls') ?? '').split(/\s+/).filter(Boolean);
    const panel = ids.length === 1 ? doc.getElementById(ids[0]!) : null;
    if (panel && !panel.contains(trigger) && !trigger.contains(panel)) map.set(trigger, panel);
  }
  return map;
}

/** Whether a trigger is safe to click (only to reveal lazily-rendered accordion panels). */
export function isSafeToggleTrigger(el: Element): boolean {
  const tag = el.tagName.toUpperCase();
  const role = el.getAttribute('role');
  if (tag !== 'BUTTON' && role !== 'button' && tag !== 'SUMMARY') return false;
  if (el.closest('form')) return false;
  if (tag === 'BUTTON' && (el.getAttribute('type') ?? 'submit').toLowerCase() === 'submit' && el.closest('form')) return false;
  if (el.closest('a[href]:not([href^="#"])')) return false;
  if (el.hasAttribute('onclick') && /location|submit|fetch|open\(/i.test(el.getAttribute('onclick') ?? '')) return false;
  const label = `${el.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''}`.trim();
  if (!label || label.length > 300 || DANGEROUS.test(label)) return false;
  return el.getAttribute('aria-expanded') === 'false';
}

function convertChildren(parent: Element, ctx: Ctx): RawBlock[] {
  const out: RawBlock[] = [];
  let pending: Node[] = [];
  const flush = () => {
    if (!pending.length) return;
    const wrapper = parent.ownerDocument.createElement('span');
    pending.forEach((n) => wrapper.appendChild(n.cloneNode(true)));
    const runs = trimRuns(inline(wrapper, ctx));
    if (plain(runs)) out.push({ id: newId(ctx), type: 'html:p', text: runs, children: [] });
    pending = [];
  };
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === 3) {
      pending.push(node);
      continue;
    }
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    const isInline = !BLOCK_TAGS.has(tag) && !SKIP.has(tag) && !ctx.panels.has(el) && !ctx.panelSet.has(el) && !hasBlockDescendant(el);
    if (isInline) {
      pending.push(el);
      continue;
    }
    flush();
    out.push(...convertElement(el, ctx));
  }
  flush();
  return out;
}

function toggleFrom(summary: RawInline[], children: RawBlock[], ctx: Ctx, type: string): RawBlock {
  return { id: newId(ctx), type, text: summary, children, expanded: true, toggleable: true };
}

function convertElement(el: Element, ctx: Ctx): RawBlock[] {
  if (ctx.depth > 60) return [];
  const tag = el.tagName.toUpperCase();
  const nested: Ctx = { ...ctx, depth: ctx.depth + 1 };

  // Accordion trigger: emit question + its (possibly hidden) panel as a toggle.
  const panel = ctx.panels.get(el);
  if (panel) {
    if (ctx.consumed.has(panel)) return [];
    ctx.consumed.add(panel);
    const summary = trimRuns(inline(el, ctx));
    return [toggleFrom(summary, convertChildren(panel, nested), ctx, 'html:accordion')];
  }
  if (ctx.panelSet.has(el)) {
    if (ctx.consumed.has(el)) return [];
    // Panel appears before its trigger in the DOM: emit it when the trigger is reached.
    const trigger = [...ctx.panels.entries()].find(([, p]) => p === el)?.[0];
    if (trigger && el.ownerDocument.contains(trigger)) return [];
  }
  if (SKIP.has(tag)) return [];
  if (isHidden(el) && !el.closest('details')) return [];

  switch (tag) {
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6': {
      // Accordion pattern: <h3><button aria-controls=…>Question</button></h3>
      const trigger = Array.from(el.querySelectorAll('*')).find((d) => ctx.panels.has(d));
      if (trigger) return convertElement(trigger, ctx);
      const text = trimRuns(inline(el, ctx));
      return plain(text) ? [{ id: newId(ctx), type: 'html:h', level: Number(tag[1]), text, children: [] }] : [];
    }
    case 'P': {
      const text = trimRuns(inline(el, ctx));
      const imgs = Array.from(el.querySelectorAll('img')).flatMap((i) => convertElement(i, nested));
      return [...(plain(text) ? [{ id: newId(ctx), type: 'html:p', text, children: [] }] : []), ...imgs];
    }
    case 'UL':
    case 'OL': {
      const items: RawBlock[] = [];
      for (const li of Array.from(el.children).filter((c) => c.tagName.toUpperCase() === 'LI')) {
        const inlineNodes = liInlineContent(li);
        const text = trimRuns(inline(inlineNodes, ctx));
        const children = Array.from(li.children)
          .filter((c) => BLOCK_TAGS.has(c.tagName.toUpperCase()))
          .flatMap((c) => convertElement(c, nested));
        if (plain(text) || children.length) items.push({ id: newId(ctx), type: 'html:li', ordered: tag === 'OL', text, children });
      }
      return items;
    }
    case 'PRE':
      return [{ id: newId(ctx), type: 'html:pre', code: el.textContent ?? '', language: /language-([\w+#-]+)/.exec(el.querySelector('code')?.className ?? el.className)?.[1], children: [] }];
    case 'BLOCKQUOTE':
      return [{ id: newId(ctx), type: 'html:blockquote', text: [], children: convertChildren(el, nested) }];
    case 'HR':
      return [{ id: newId(ctx), type: 'html:hr', children: [] }];
    case 'IMG': {
      const src = absUrl(el.getAttribute('src') ?? el.getAttribute('data-src'), ctx.baseUrl);
      const w = Number(el.getAttribute('width') ?? '0');
      if (!src || !/^https?:/.test(src) || (w > 0 && w < 4)) return [];
      return [{ id: newId(ctx), type: 'html:img', src, alt: el.getAttribute('alt') ?? undefined, children: [] }];
    }
    case 'FIGURE': {
      const img = el.querySelector('img');
      const blocks = img ? convertElement(img, nested) : convertChildren(el, nested);
      const cap = el.querySelector('figcaption');
      if (blocks[0] && cap) blocks[0].caption = trimRuns(inline(cap, ctx));
      return blocks;
    }
    case 'TABLE': {
      const rows = Array.from(el.querySelectorAll('tr')).map((tr) => Array.from(tr.querySelectorAll('th, td')).map((c) => trimRuns(inline(c, ctx))));
      return rows.length ? [{ id: newId(ctx), type: 'html:table', tableRows: rows, tableHeader: !!el.querySelector('thead, tr:first-child th'), children: [] }] : [];
    }
    case 'DETAILS': {
      const summaryEl = Array.from(el.children).find((c) => c.tagName.toUpperCase() === 'SUMMARY');
      const body = el.ownerDocument.createElement('div');
      Array.from(el.childNodes).forEach((n) => {
        if (n !== summaryEl) body.appendChild(n.cloneNode(true));
      });
      return [toggleFrom(trimRuns(inline(summaryEl, ctx)), convertChildren(body, nested), ctx, 'html:details')];
    }
    case 'DL': {
      const out: RawBlock[] = [];
      let current: RawBlock | undefined;
      for (const c of Array.from(el.children)) {
        const t = c.tagName.toUpperCase();
        if (t === 'DT') {
          current = toggleFrom(trimRuns(inline(c, ctx)), [], ctx, 'html:dl');
          out.push(current);
        } else if (t === 'DD' && current) {
          current.children.push(...convertChildren(c, nested));
        }
      }
      return out;
    }
    default:
      return convertChildren(el, nested);
  }
}

/** Inline-only content of a list item (excluding nested lists/blocks). */
function liInlineContent(li: Element): Element {
  const span = li.ownerDocument.createElement('span');
  for (const n of Array.from(li.childNodes)) {
    if (n.nodeType === 1 && BLOCK_TAGS.has((n as Element).tagName.toUpperCase())) continue;
    span.appendChild(n.cloneNode(true));
  }
  return span;
}

interface FaqItem {
  question: string;
  answer: string;
}

/** FAQPage structured data (JSON-LD), parsed as data only. */
export function extractJsonLdFaq(doc: Document): FaqItem[] {
  const items: FaqItem[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const o = node as Record<string, unknown>;
    const type = o['@type'];
    const isFaq = type === 'FAQPage' || (Array.isArray(type) && type.includes('FAQPage'));
    if (isFaq) {
      const main = Array.isArray(o.mainEntity) ? o.mainEntity : o.mainEntity ? [o.mainEntity] : [];
      for (const q of main as Record<string, unknown>[]) {
        const answer = q?.acceptedAnswer as Record<string, unknown> | undefined;
        const question = typeof q?.name === 'string' ? q.name : '';
        const text = typeof answer?.text === 'string' ? answer.text : '';
        if (question && text) items.push({ question, answer: text });
      }
    }
    if (o['@graph']) visit(o['@graph']);
  };
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      visit(JSON.parse(s.textContent ?? ''));
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
  return items;
}

function htmlToText(html: string, doc: Document): string {
  // <template> content is inert: no script execution, no resource loading.
  const t = doc.createElement('template');
  t.innerHTML = html;
  t.content.querySelectorAll('script, style, template, noscript').forEach((n) => n.remove());
  t.content.querySelectorAll('br, p, li, div').forEach((n) => n.appendChild(doc.createTextNode('\n')));
  return (t.content.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

export function pickContentRoot(doc: Document): Element {
  const candidates = Array.from(doc.querySelectorAll('main, [role="main"], article'));
  const best = candidates.sort((a, b) => (b.textContent?.length ?? 0) - (a.textContent?.length ?? 0))[0];
  return best && (best.textContent?.trim().length ?? 0) > 200 ? best : (doc.body ?? doc.documentElement);
}

export function extractExternalPage(doc: Document, url: string): RawPage {
  const baseUrl = doc.location?.href ?? url;
  const root = pickContentRoot(doc);
  const panels = findAccordionPanels(doc, doc);
  const ctx: Ctx = { baseUrl, panels, panelSet: new Set(panels.values()), consumed: new Set(), counter: { n: 0 }, depth: 0 };
  const blocks = convertChildren(root, ctx);
  const notes: string[] = [];

  // Panels referenced by triggers outside the content root are still exported.
  for (const [trigger, panel] of ctx.panels) {
    if (ctx.consumed.has(panel) || !root.contains(panel)) continue;
    ctx.consumed.add(panel);
    blocks.push(toggleFrom(trimRuns(inline(trigger, ctx)), convertChildren(panel, ctx), ctx, 'html:accordion'));
  }
  const emptyPanels = [...ctx.panels.values()].filter((p) => !(p.textContent ?? '').trim()).length;
  if (emptyPanels) notes.push(`${emptyPanels} expandable section(s) had no content in the page (possibly loaded on demand).`);

  const faq = extractJsonLdFaq(doc);
  if (faq.length) {
    const existing = new Set(JSON.stringify(blocks).toLowerCase().match(/"text":"[^"]{0,200}/g) ?? []);
    const missing = faq.filter((f) => ![...existing].some((e) => e.includes(f.question.toLowerCase().slice(0, 40))));
    if (missing.length) {
      blocks.push({ id: newId(ctx), type: 'html:h', level: 2, text: [{ text: 'FAQ (structured data)' }], children: [] });
      for (const f of missing) {
        const answer = htmlToText(f.answer, doc);
        blocks.push(toggleFrom([{ text: f.question }], answer.split(/\n{2,}/).map((p) => ({ id: newId(ctx), type: 'html:p', text: [{ text: p }], children: [] })), ctx, 'html:faq'));
      }
    }
  }

  const title = (doc.querySelector('h1')?.textContent ?? '').trim() || doc.title.trim() || new URL(baseUrl).hostname;
  return {
    adapter: 'external-dom',
    url,
    finalUrl: baseUrl,
    title: title.replace(/\s+/g, ' ').slice(0, 200),
    blocks,
    properties: [],
    diagnostics: { blockCount: ctx.counter.n, collapsedRemaining: emptyPanels, togglesOpened: 0, virtualizationSuspected: false, notes },
  };
}

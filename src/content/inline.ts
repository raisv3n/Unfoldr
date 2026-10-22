// Converts an inline DOM subtree into RawInline runs (text + annotations + links/mentions).
// Reads attributes and inline styles only (no layout), so it works in jsdom and in hidden tabs.

import type { RawInline } from '../shared/raw';
import { NOTION } from './notion-selectors';

type Ann = Omit<RawInline, 'text'>;

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'SVG', 'TEMPLATE', 'NOSCRIPT', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'IFRAME', 'OBJECT', 'CANVAS']);
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\))$/i;

export interface InlineOptions {
  baseUrl: string;
  /** Enable Notion token handling (mentions, equations, inline code containers). */
  notion: boolean;
}

function absUrl(href: string | null, base: string): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

function styleAnn(el: Element): Ann {
  const style = (el.getAttribute('style') || '').toLowerCase();
  const ann: Ann = {};
  if (!style) return ann;
  const fw = /font-weight\s*:\s*(\w+)/.exec(style)?.[1];
  if (fw && (fw === 'bold' || fw === 'bolder' || Number(fw) >= 600)) ann.bold = true;
  if (/font-style\s*:\s*italic/.test(style)) ann.italic = true;
  const deco = /text-decoration(?:-line)?\s*:\s*([^;]+)/.exec(style)?.[1] ?? '';
  if (deco.includes('line-through')) ann.strike = true;
  if (deco.includes('underline')) ann.underline = true;
  if (/font-family\s*:[^;]*mono/.test(style)) ann.code = true;
  const color = /(?:^|;)\s*color\s*:\s*([^;]+)/.exec(style)?.[1]?.trim();
  if (color && SAFE_COLOR.test(color)) ann.color = color;
  return ann;
}

function tagAnn(el: Element): Ann {
  switch (el.tagName) {
    case 'B':
    case 'STRONG':
      return { bold: true };
    case 'I':
    case 'EM':
      return { italic: true };
    case 'S':
    case 'DEL':
    case 'STRIKE':
      return { strike: true };
    case 'U':
    case 'INS':
      return { underline: true };
    case 'CODE':
    case 'KBD':
    case 'SAMP':
      return { code: true };
    default:
      return {};
  }
}

function texOf(el: Element): string {
  const ann = el.querySelector(NOTION.texAnnotation);
  return (ann?.textContent ?? el.getAttribute('data-equation') ?? el.textContent ?? '').trim();
}

function mentionText(el: Element): string {
  // Drop icon-only descendants (emoji/img icons) so the label stays clean.
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(`${NOTION.recordIcon}, img, svg`).forEach((n) => n.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function sameAnn(a: RawInline, b: RawInline): boolean {
  return (
    !a.mention && !b.mention && !a.equation && !b.equation &&
    !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.strike === !!b.strike &&
    !!a.underline === !!b.underline && !!a.code === !!b.code && a.color === b.color && a.href === b.href
  );
}

export function extractInline(root: Element | null | undefined, opts: InlineOptions): RawInline[] {
  if (!root) return [];
  const out: RawInline[] = [];
  const push = (run: RawInline) => {
    if (!run.text && !run.equation) return;
    const last = out[out.length - 1];
    if (last && sameAnn(last, run)) last.text += run.text;
    else out.push(run);
  };

  function walkChildren(el: Element, ann: Ann): void {
    el.childNodes.forEach((child) => walk(child, ann));
  }

  function walk(node: Node, ann: Ann): void {
    if (node.nodeType === 3) {
      push({ ...ann, text: node.nodeValue ?? '' });
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (SKIP_TAGS.has(tag)) return;
    if (tag === 'BR') {
      push({ ...ann, text: '\n' });
      return;
    }
    if (tag === 'IMG') {
      // Inline emoji images (custom emoji) keep their alt text.
      const alt = el.getAttribute('alt');
      if (alt && alt.length <= 8) push({ ...ann, text: alt });
      return;
    }
    if (opts.notion) {
      if (el.matches(NOTION.equationToken) || el.classList.contains('katex')) {
        push({ ...ann, text: '', equation: texOf(el) });
        return;
      }
      if (el.matches(NOTION.pageMention)) {
        const a = el.matches('a[href]') ? el : el.querySelector('a[href]');
        const href = absUrl(a?.getAttribute('href') ?? null, opts.baseUrl);
        const targetId = el.getAttribute('data-block-id') ?? a?.getAttribute('data-block-id') ?? undefined;
        push({ ...ann, text: mentionText(el) || 'Untitled', mention: 'page', href, targetId });
        return;
      }
      if (el.matches(NOTION.userMention)) {
        push({ ...ann, text: mentionText(el), mention: 'user' });
        return;
      }
      if (el.matches(NOTION.dateMention)) {
        push({ ...ann, text: mentionText(el), mention: 'date' });
        return;
      }
      if (el.matches(NOTION.inlineCode)) {
        walkChildren(el, { ...ann, code: true });
        return;
      }
    } else if (el.getAttribute('aria-hidden') === 'true') {
      return;
    }
    let next: Ann = { ...ann, ...tagAnn(el), ...styleAnn(el) };
    if (tag === 'A') {
      const href = absUrl(el.getAttribute('href'), opts.baseUrl);
      if (href) next = { ...next, href };
    }
    walkChildren(el, next);
  }

  walkChildren(root, {});
  return out;
}

export function inlineToPlain(runs: RawInline[]): string {
  return runs.map((r) => (r.equation ? r.equation : r.text)).join('');
}

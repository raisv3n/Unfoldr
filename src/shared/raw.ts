// Raw, adapter-specific representation produced by content scripts.
// Plain JSON (it crosses chrome.runtime messaging). The normalizer turns it into the model.

export interface RawInline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  underline?: boolean;
  code?: boolean;
  color?: string;
  /** Absolute href when the run is a link or mention. */
  href?: string;
  /** Set for mention tokens. */
  mention?: 'page' | 'user' | 'date' | 'other';
  /** Notion page/block ID embedded in the token (data-block-id etc.), when available. */
  targetId?: string;
  /** TeX source for inline equations. */
  equation?: string;
}

export interface RawTableCollection {
  title: string;
  columns: string[];
  rows: { id?: string; href?: string; title: string; cells: string[] }[];
  /** True if a "load more"/virtualization hint suggests rows may be missing. */
  maybeIncomplete: boolean;
  viewType?: string;
  href?: string;
}

export interface RawBlock {
  id: string;
  /**
   * Source type token. For Notion: the `<type>` from `notion-<type>-block` (e.g. `toggle`, `sub_header`).
   * For external pages: `html:<tag>` or one of `html:accordion`, `html:faq`.
   */
  type: string;
  text?: RawInline[];
  children: RawBlock[];
  checked?: boolean;
  language?: string;
  href?: string;
  src?: string;
  alt?: string;
  name?: string;
  icon?: string;
  title?: string;
  description?: string;
  caption?: RawInline[];
  code?: string;
  equation?: string;
  /** For toggles/toggle headings: whether children were available (expanded) at extraction time. */
  expanded?: boolean;
  /** Toggle-able heading marker. */
  toggleable?: boolean;
  /** Heading level for html headings (1-6). */
  level?: number;
  ordered?: boolean;
  tableRows?: RawInline[][][];
  tableHeader?: boolean;
  collection?: RawTableCollection;
}

export type AccessState = 'ready' | 'loading' | 'login_required' | 'no_access' | 'not_found' | 'challenge' | 'unsupported';

export interface RawPage {
  adapter: 'notion-dom' | 'external-dom';
  url: string;
  /** Final URL after redirects, as seen by the page. */
  finalUrl: string;
  pageId?: string;
  title: string;
  icon?: string;
  blocks: RawBlock[];
  properties: { name: string; value: string }[];
  /** Database shown as the page itself (full-page database). */
  collection?: RawTableCollection;
  diagnostics: {
    blockCount: number;
    collapsedRemaining: number;
    togglesOpened: number;
    virtualizationSuspected: boolean;
    notes: string[];
  };
}

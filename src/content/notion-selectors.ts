// Every Notion DOM assumption lives here. Prefer data-* attributes and ARIA over styling classes.
// The `notion-<type>-block` class is used only to read the block type token.

export const NOTION = {
  frame: 'main.notion-frame, .notion-frame',
  peek: '.notion-peek-renderer',
  pageContent: '.notion-page-content',
  scroller: '.notion-scroller.vertical, .notion-scroller',
  block: '[data-block-id]',
  leaf: '[data-content-editable-leaf]',
  toggleButton: '[role="button"][aria-expanded]',
  recordIcon: '.notion-record-icon',
  pageMention: '.notion-page-mention-token, .notion-link-mention-token',
  userMention: '.notion-user-mention-token',
  dateMention: '.notion-date-mention-token, .notion-reminder-mention-token',
  equationToken: '.notion-text-equation-token',
  inlineCode: '.notion-inline-code-container',
  texAnnotation: 'annotation[encoding="application/x-tex"]',
  collectionItem: '.notion-collection-item',
  tableViewHeaderCell: '.notion-table-view-header-cell',
  tableViewCell: '.notion-table-view-cell',
  collectionViewTypes: [
    'notion-table-view',
    'notion-board-view',
    'notion-gallery-view',
    'notion-list-view',
    'notion-calendar-view',
    'notion-timeline-view',
  ],
} as const;

/** Block types whose own toggle button reveals children. */
export const TOGGLE_CAPABLE = new Set(['toggle', 'header', 'sub_header', 'sub_sub_header']);

/** Block types whose descendants must not be treated as child blocks. */
export const OPAQUE_BLOCKS = new Set(['page', 'alias', 'collection_view', 'collection_view_page', 'table', 'table_row', 'link_preview', 'breadcrumb']);

/** Phrases (lowercase) Notion shows for inaccessible states. English only — best effort. */
export const ACCESS_PHRASES = {
  noAccess: ['no access to this page', "you don't have access", 'you do not have access', 'request access', 'ask the owner for access'],
  notFound: ['this content does not exist', 'page not found', "this page doesn't exist", 'this page does not exist', 'was deleted'],
  challenge: ['just a moment', 'verify you are human', 'checking your browser'],
  rateLimited: ['too many requests', 'rate limited', 'you have been rate limited', 'please try again later'],
};

export const LOAD_MORE = /^\s*(load|show)\s+(\d+\s+)?more\b/i;

export const CODE_LANGUAGES = [
  'abap', 'arduino', 'bash', 'basic', 'c', 'clojure', 'coffeescript', 'c++', 'c#', 'css', 'dart', 'diff', 'docker', 'elixir',
  'elm', 'erlang', 'flow', 'fortran', 'f#', 'gherkin', 'glsl', 'go', 'graphql', 'groovy', 'haskell', 'html', 'java',
  'javascript', 'json', 'julia', 'kotlin', 'latex', 'less', 'lisp', 'livescript', 'lua', 'makefile', 'markdown', 'markup',
  'matlab', 'mermaid', 'nix', 'objective-c', 'ocaml', 'pascal', 'perl', 'php', 'plain text', 'powershell', 'prolog',
  'protobuf', 'python', 'r', 'reason', 'ruby', 'rust', 'sass', 'scala', 'scheme', 'scss', 'shell', 'solidity', 'sql', 'swift',
  'toml', 'typescript', 'vb.net', 'verilog', 'vhdl', 'visual basic', 'webassembly', 'xml', 'yaml', 'java/c/c++/c#',
];

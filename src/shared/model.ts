// Normalized content model shared by the crawler, asset manager, renderers and archive builder.
// It is independent of the extraction adapter (Notion DOM, external DOM, future API adapter)
// and of the output format. Renderers consume only these types.

/** 32 lowercase hex characters, no dashes. */
export type PageId = string;

/** Key used by the crawler/archive for any exportable page (Notion page ID or `ext:<hash>`). */
export type PageKey = string;

export type TextColor = string;

export interface Annotations {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  code?: boolean;
  color?: TextColor;
}

export type LinkTarget =
  | { kind: 'page'; pageId: PageId; url: string; blockId?: string }
  | { kind: 'external'; url: string }
  | { kind: 'unresolved'; url: string };

export type RichText =
  | { type: 'text'; text: string; annotations: Annotations; link?: LinkTarget }
  | { type: 'mention'; mention: 'page'; text: string; pageId: PageId; url: string; annotations: Annotations }
  | { type: 'mention'; mention: 'user' | 'date' | 'other'; text: string; annotations: Annotations }
  | { type: 'equation'; expression: string; annotations: Annotations };

export interface AssetRef {
  /** Stable ID derived from the dedupe key (see assets/asset-key.ts). */
  assetId: string;
  /** URL the asset manager fetches (may be a Notion proxy URL). */
  fetchUrl: string;
  /** Original/source URL kept for the manifest and as fallback link. */
  originalUrl: string;
  kind: 'image' | 'file' | 'video' | 'audio' | 'pdf';
  name?: string;
}

export type ReferenceKind =
  | 'child_page'
  | 'child_database'
  | 'link_to_page'
  | 'link'
  | 'mention'
  | 'database_entry'
  | 'synced_block'
  | 'external';

export interface PageReference {
  kind: ReferenceKind;
  /** Notion page ID when known from the URL/DOM. */
  pageId?: PageId;
  url: string;
  title?: string;
  /** Block in the *source* page that holds the reference. */
  blockId?: string;
}

export interface PropertyValue {
  name: string;
  value: string;
}

export interface DatabaseEntry {
  pageId?: PageId;
  url: string;
  title: string;
  properties: PropertyValue[];
}

interface BlockBase {
  id: string;
  children?: Block[];
}

export type Block =
  | (BlockBase & { type: 'paragraph'; text: RichText[] })
  | (BlockBase & { type: 'heading'; level: 1 | 2 | 3; text: RichText[]; toggleable: boolean })
  | (BlockBase & { type: 'bulleted_list_item'; text: RichText[] })
  | (BlockBase & { type: 'numbered_list_item'; text: RichText[] })
  | (BlockBase & { type: 'to_do'; text: RichText[]; checked: boolean })
  | (BlockBase & { type: 'toggle'; text: RichText[] })
  | (BlockBase & { type: 'quote'; text: RichText[] })
  | (BlockBase & { type: 'callout'; text: RichText[]; icon?: string })
  | (BlockBase & { type: 'code'; code: string; language?: string; caption?: RichText[] })
  | (BlockBase & { type: 'divider' })
  | (BlockBase & { type: 'equation'; expression: string })
  | (BlockBase & { type: 'table'; rows: RichText[][][]; hasHeaderRow: boolean })
  | (BlockBase & { type: 'image'; asset?: AssetRef; url: string; alt?: string; caption?: RichText[] })
  | (BlockBase & { type: 'file'; asset?: AssetRef; url: string; name: string; caption?: RichText[] })
  | (BlockBase & {
      type: 'embed';
      url: string;
      caption?: RichText[];
      /** Recognized video provider; renderers show `thumbnail` as a clickable preview. */
      provider?: 'youtube';
      thumbnail?: AssetRef;
    })
  | (BlockBase & { type: 'bookmark'; url: string; title?: string; description?: string })
  | (BlockBase & { type: 'child_page'; pageId?: PageId; url: string; title: string; icon?: string })
  | (BlockBase & { type: 'link_to_page'; pageId?: PageId; url: string; title: string })
  | (BlockBase & {
      type: 'child_database';
      title: string;
      pageId?: PageId;
      url?: string;
      columns: string[];
      entries: DatabaseEntry[];
      /** False when the view may not show all rows (pagination/virtualization/filters). */
      complete: boolean;
    })
  | (BlockBase & { type: 'synced_block'; role: 'original' | 'reference'; sourceBlockId?: string })
  | (BlockBase & { type: 'column_list' })
  | (BlockBase & { type: 'column' })
  | (BlockBase & { type: 'table_of_contents' })
  | (BlockBase & { type: 'unsupported'; sourceType: string; text: RichText[] });

export type BlockType = Block['type'];

export type PageStatus = 'complete' | 'partial';

export interface ExportPage {
  /** Notion page ID, or `ext:<hash>` for external pages. */
  key: PageKey;
  source: 'notion' | 'external';
  pageId?: PageId;
  title: string;
  url: string;
  icon?: string;
  blocks: Block[];
  properties: PropertyValue[];
  references: PageReference[];
  assets: AssetRef[];
  warnings: string[];
  status: PageStatus;
  extractedAt: string;
}

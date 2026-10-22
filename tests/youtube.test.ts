import { describe, expect, it } from 'vitest';
import type { Site, SiteEntry } from '../src/render/context';
import { renderHtmlPage } from '../src/render/html';
import { renderMarkdownPage } from '../src/render/markdown';
import type { Block, ExportPage } from '../src/shared/model';
import { isYouTubeThumbnailHost, youTubeThumbnailUrl, youTubeVideoId } from '../src/shared/youtube';

const ID = 'dQw4w9WgXcQ';

describe('youTubeVideoId', () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s&list=PL123`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/embed/${ID}?start=10`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}`,
  ])('recognizes %s', (url) => expect(youTubeVideoId(url)).toBe(ID));

  it.each([
    'https://www.youtube.com/channel/UC123',
    'https://www.youtube.com/watch?v=short',
    `https://evil.example/watch?v=${ID}`,
    `https://youtube.com.evil.example/watch?v=${ID}`,
    `javascript:alert('${ID}')`,
  ])('rejects %s', (url) => expect(youTubeVideoId(url)).toBeUndefined());

  it('builds thumbnail URLs on the single allowed host', () => {
    expect(youTubeThumbnailUrl(ID)).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
    expect(isYouTubeThumbnailHost('i.ytimg.com')).toBe(true);
    expect(isYouTubeThumbnailHost('evil.ytimg.com.example')).toBe(false);
  });
});

describe('YouTube embed rendering', () => {
  const thumb = { assetId: 'thumb1', fetchUrl: youTubeThumbnailUrl(ID), originalUrl: youTubeThumbnailUrl(ID), kind: 'image' as const, name: `youtube-${ID}` };
  const block = (withThumb: boolean, caption?: string): Block => ({
    id: 'v1',
    type: 'embed',
    url: `https://www.youtube.com/watch?v=${ID}`,
    provider: 'youtube',
    thumbnail: withThumb ? thumb : undefined,
    caption: caption ? [{ type: 'text', text: caption, annotations: {} }] : undefined,
  });
  const page = (b: Block): ExportPage => ({ key: 'a'.repeat(32), source: 'notion', pageId: 'a'.repeat(32), title: 'P', url: 'https://www.notion.so/x', blocks: [b], properties: [], references: [], assets: [], warnings: [], status: 'complete', extractedAt: '' });
  const site = (ext: 'md' | 'html', downloaded: boolean): Site => {
    const entry: SiteEntry = { key: 'a'.repeat(32), title: 'P', path: `pages/p--x.${ext}`, url: '', source: 'notion', status: 'complete', children: [] };
    return { entries: new Map([[entry.key, entry]]), resolve: () => undefined, assetPath: (id) => (downloaded && id === 'thumb1' ? `assets/youtube-${ID.toLowerCase()}--thumb1.jpg` : undefined), backlinks: () => [], reportPath: `export-report.${ext}`, indexPath: `index.${ext}`, stylesheetPath: ext === 'html' ? 'style.css' : undefined };
  };

  it('Markdown: clickable local thumbnail linking to the video, with the caption as label', () => {
    const md = renderMarkdownPage(page(block(true, 'Intro talk')), site('md', true), 'pages/p--x.md', { toggleMode: 'interactive' });
    expect(md).toContain(`[![▶ Intro talk](../assets/youtube-${ID.toLowerCase()}--thumb1.jpg)](https://www.youtube.com/watch?v=${ID})`);
    expect(md).toContain(`▶ [Intro talk](https://www.youtube.com/watch?v=${ID})`);
  });

  it('Markdown: plain video link when the thumbnail was not downloaded', () => {
    const md = renderMarkdownPage(page(block(true)), site('md', false), 'pages/p--x.md', { toggleMode: 'interactive' });
    expect(md).toContain(`▶ [YouTube video](https://www.youtube.com/watch?v=${ID})`);
    expect(md).not.toContain('![');
  });

  it('HTML: thumbnail link, no iframe', () => {
    const html = renderHtmlPage(page(block(true)), site('html', true), 'pages/p--x.html');
    expect(html).toContain(`<a href="https://www.youtube.com/watch?v=${ID}" class="video-thumb"`);
    expect(html).toContain(`src="../assets/youtube-${ID.toLowerCase()}--thumb1.jpg"`);
    expect(html).not.toMatch(/<iframe/i);
  });
});

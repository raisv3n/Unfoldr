import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

export function loadFixture(name: string, url: string): Document {
  const html = readFileSync(resolve(__dirname, 'fixtures', name), 'utf8');
  return new JSDOM(html, { url }).window.document;
}

export function domFrom(html: string, url = 'https://example.com/page'): Document {
  return new JSDOM(html, { url }).window.document;
}

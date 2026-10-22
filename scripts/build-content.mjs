// Builds content scripts as self-contained IIFE bundles into dist/content/.
import { build } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entries = {
  'notion-content': 'src/content/notion-content.ts',
  'external-content': 'src/content/external-content.ts',
};

for (const [name, entry] of Object.entries(entries)) {
  await build({
    root,
    configFile: false,
    publicDir: false,
    logLevel: 'warn',
    build: {
      outDir: resolve(root, 'dist/content'),
      emptyOutDir: false,
      target: 'chrome120',
      minify: false,
      lib: { entry: resolve(root, entry), formats: ['iife'], name: name.replace(/-/g, '_'), fileName: () => `${name}.js` },
    },
  });
  console.log(`built dist/content/${name}.js`);
}

import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Main build: popup + offscreen pages and the module service worker.
// Content scripts are built separately as IIFE bundles by scripts/build-content.mjs,
// because chrome.scripting.executeScript cannot inject ES modules.
export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120',
    sourcemap: false,
    minify: false,
    modulePreload: false,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        offscreen: resolve(__dirname, 'offscreen.html'),
        background: resolve(__dirname, 'src/background/service-worker.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});

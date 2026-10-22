// Rebuilds dist/ whenever a source file changes: `npm run watch` (Ctrl+C to stop).
// After each rebuild, click the reload icon on the extension's card in chrome://extensions.
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targets = ['src', 'public', 'popup.html', 'offscreen.html', 'vite.config.ts', 'scripts/build-content.mjs'];

let timer;
let running = false;
let pending = false;

function build() {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  const started = Date.now();
  const child = spawn('npm', ['run', 'build', '--silent'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = '';
  child.stderr.on('data', (d) => (errors += d));
  child.on('close', (code) => {
    const time = new Date().toLocaleTimeString();
    if (code === 0) console.log(`[${time}] ✓ rebuilt dist/ in ${((Date.now() - started) / 1000).toFixed(1)}s — reload the extension in Chrome`);
    else console.error(`[${time}] ✗ build failed:\n${errors}`);
    running = false;
    if (pending) {
      pending = false;
      build();
    }
  });
}

for (const t of targets) {
  watch(resolve(root, t), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(build, 300);
  });
}
console.log('Watching for changes… (Ctrl+C to stop)');
build();

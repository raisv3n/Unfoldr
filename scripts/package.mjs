// Packages the built extension (dist/) as release/Unfoldr-<version>-chrome.zip.
//   npm run package                     (builds first)
//   RELEASE_TAG=v0.2.0 node scripts/package.mjs   (also checks the tag matches the version)
// The ZIP contains an `Unfoldr/` folder ready for chrome://extensions → Load unpacked.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const source = JSON.parse(readFileSync(join(root, 'public/manifest.json'), 'utf8'));
const version = manifest.version;

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
if (version !== source.version) fail(`dist/ is stale: built version ${version}, source version ${source.version}. Run npm run build.`);
if (pkg.version !== version) fail(`Version mismatch: package.json ${pkg.version} vs manifest ${version}. Keep them equal.`);
const tag = process.env.RELEASE_TAG;
if (tag && tag !== `v${version}`) fail(`Tag ${tag} doesn't match manifest version ${version} (expected v${version}).`);

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

const zip = new JSZip();
const fixedDate = new Date('2026-01-01T00:00:00Z'); // reproducible archives
for (const file of files(dist).sort()) {
  const rel = relative(dist, file).split('\\').join('/');
  if (rel.endsWith('.map') || rel.split('/').some((s) => s.startsWith('.'))) continue;
  zip.file(`Unfoldr/${rel}`, readFileSync(file), { date: fixedDate });
}
const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });

const outDir = join(root, 'release');
mkdirSync(outDir, { recursive: true });
const name = `Unfoldr-${version}-chrome.zip`;
writeFileSync(join(outDir, name), data);
const sha = createHash('sha256').update(data).digest('hex');
writeFileSync(join(outDir, `${name}.sha256`), `${sha}  ${name}\n`);
console.log(`✓ release/${name} (${(data.length / 1024).toFixed(0)} KB)\n  SHA-256 ${sha}`);

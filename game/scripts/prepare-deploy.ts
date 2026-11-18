/**
 * `bun run deploy:prepare` — copy `build/web-desktop` (built by the editor) into `deploy/`,
 * patch `index.html`, add the files in `web/` (icon, OG, `_headers`) and check the M7 budget.
 * (< 15 MB) + Cloudflare static assets (≤ 25 MiB/file, ≤ 20 000 file).
 */
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchIndexHtml } from './lib/deploy-html';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUILD = join(ROOT, 'build', 'web-desktop');
const WEB = join(ROOT, 'web');
const OUT = join(ROOT, 'deploy');

const BUDGET_BYTES = 15 * 1024 * 1024;
const CF_FILE_LIMIT_BYTES = 25 * 1024 * 1024;
const CF_FILE_COUNT_LIMIT = 20_000;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

if (!existsSync(join(BUILD, 'index.html'))) {
  console.error(`No ${relative(ROOT, BUILD)}/index.html yet — build web-desktop with Cocos Creator first.`);
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
cpSync(BUILD, OUT, { recursive: true });
cpSync(WEB, OUT, { recursive: true });
rmSync(join(OUT, 'favicon.ico'), { force: true });

const indexPath = join(OUT, 'index.html');
writeFileSync(
  indexPath,
  patchIndexHtml(readFileSync(indexPath, 'utf8'), {
    title: 'Yokai Field — top-down roguelite',
    description:
      'Dodge-first pixel roguelite in the browser: auto-fire, clear 9 rooms, pick skills, beat 3 bosses. Built with Cocos Creator and the Ninja Adventure pack.',
    origin: 'https://yokai.lukeinc.tech',
    ogImagePath: '/og.png',
  }),
);

const files = walk(OUT).filter((path) => !path.endsWith('_headers'));
const sizes = files.map((path) => ({ path, bytes: statSync(path).size }));
const total = sizes.reduce((sum, file) => sum + file.bytes, 0);
const largest = sizes.reduce((max, file) => (file.bytes > max.bytes ? file : max));

const problems: string[] = [];
if (total > BUDGET_BYTES) problems.push(`total ${(total / 1048576).toFixed(1)} MB > 15 MB`);
if (largest.bytes > CF_FILE_LIMIT_BYTES) problems.push(`${relative(OUT, largest.path)} > 25 MiB`);
if (files.length > CF_FILE_COUNT_LIMIT) problems.push(`${files.length} file > 20 000`);
if (!existsSync(join(OUT, 'og.png'))) problems.push('missing web/og.png');

console.log(
  `deploy/: ${files.length} files, ${(total / 1048576).toFixed(2)} MB, largest ${relative(OUT, largest.path)} ${(largest.bytes / 1048576).toFixed(2)} MB`,
);
if (problems.length > 0) {
  console.error(`Cannot deploy: ${problems.join('; ')}`);
  process.exit(1);
}

/**
 * Ticket #95 acceptance (M21 close-out, spec #90, ADR-028).
 *
 * M21 ships: the full Village loop (Title → Village → villager → Shop Interior → Shopkeeper buy →
 * Village → Dojo swap + Skill Codex → North Gate run → result → Village) is proven in a real
 * `web-desktop` release build at 1920×1080, 1280×720 and 1024×768 in `vi` and `en`, the proof is
 * recorded (screenshots + the M21 status paragraph), the M21 docs say Done / `implemented`, and the
 * committed `game/deploy/` bundle passes the Cloudflare gates.
 *
 * Seam: the repo artifacts the browser proof and `bun run deploy:prepare` leave behind. The loop's
 * behaviour itself is covered by the #91–#94 acceptance tests in `tests/core/hub/`; what this file
 * cannot see is whether the browser run really happened (the verifier re-runs it).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '../../..');
const DEPLOY = join(REPO_ROOT, 'game/deploy');
const SCREENS = join(REPO_ROOT, 'docs/research/2026-11-m21-screens');

const VIEWPORTS = ['1920x1080', '1280x720', '1024x768'] as const;
const LOCALES = ['vi', 'en'] as const;

/** One screenshot per loop step, `vi` at 1920×1080: `<step>-vi-1920x1080.png`. */
const LOOP_STEPS = [
  'title',
  'village',
  'villager-dialog',
  'shop-interior',
  'shopkeeper-dialog',
  'meta-shop-bought',
  'dojo-codex',
  'dojo-swapped',
  'gate-chapter-select',
  'run',
  'result',
  'village-return',
] as const;

/** The label-heavy screens, at every viewport × locale: `<step>-<locale>-<viewport>.png`. */
const MATRIX_STEPS = ['shopkeeper-dialog', 'dojo-codex'] as const;

const CF_FILE_LIMIT_BYTES = 25 * 1024 * 1024;
const CF_FILE_COUNT_LIMIT = 20_000;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function read(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

/** The milestone section of `docs/milestones/m16-m21.md`, from its `## M<n> ` heading to the next one. */
function milestoneSection(milestone: string): string {
  const sections = read('docs/milestones/m16-m21.md').split(/^## /m).slice(1);
  return sections.find((section) => section.startsWith(`${milestone} `)) ?? '';
}

/** From the `**Status:` line to the end of the section (the proof paragraph). */
function statusParagraph(milestone: string): string {
  const section = milestoneSection(milestone);
  const start = section.search(/^\*\*Status:/m);
  return start < 0 ? '' : section.slice(start);
}

describe('#95 browser proof screenshots', () => {
  it('has one screenshot per loop step (vi, 1920×1080)', () => {
    expect(existsSync(SCREENS), 'docs/research/2026-11-m21-screens/ exists').toBe(true);
    for (const step of LOOP_STEPS) {
      const file = join(SCREENS, `${step}-vi-1920x1080.png`);
      expect(existsSync(file), `${step}-vi-1920x1080.png`).toBe(true);
    }
  });

  it('has the Shopkeeper dialog and the Skill Codex at every viewport in vi and en', () => {
    for (const step of MATRIX_STEPS) {
      for (const locale of LOCALES) {
        for (const viewport of VIEWPORTS) {
          const name = `${step}-${locale}-${viewport}.png`;
          expect(existsSync(join(SCREENS, name)), name).toBe(true);
        }
      }
    }
  });

  it('every screenshot is a real PNG', () => {
    const pngs = existsSync(SCREENS) ? readdirSync(SCREENS).filter((name) => name.endsWith('.png')) : [];
    expect(pngs.length).toBeGreaterThanOrEqual(LOOP_STEPS.length + MATRIX_STEPS.length * 5);
    for (const name of pngs) {
      const bytes = readFileSync(join(SCREENS, name));
      expect(bytes.subarray(0, 8).toString('hex'), `${name} PNG signature`).toBe('89504e470d0a1a0a');
      expect(bytes.length, `${name} is not an empty capture`).toBeGreaterThan(10_000);
    }
  });
});

describe('#95 M21 docs', () => {
  it('marks M21 Done with the recorded browser + deploy proof', () => {
    expect(milestoneSection('M21'), 'M21 section').not.toBe('');
    const status = statusParagraph('M21');
    expect(status, 'M21 status line').toMatch(/^\*\*Status: ✅ Done \(2026-11-\d{2}\)/);
    for (const viewport of ['1920×1080', '1280×720', '1024×768']) {
      expect(status, `M21 proof names ${viewport}`).toContain(viewport);
    }
    expect(status, 'M21 proof names the vi/en check').toMatch(/`vi`[^\n]*`en`|`en`[^\n]*`vi`/);
    expect(status, 'M21 proof records deploy:prepare').toContain('deploy:prepare');
    expect(status, 'M21 proof points to the screenshots').toContain('docs/research/2026-11-m21-screens/');
    // Every milestone M16–M20 stays Done.
    for (const milestone of ['M16', 'M17', 'M18', 'M19', 'M20']) {
      expect(statusParagraph(milestone), `${milestone} status line`).toMatch(/^\*\*Status: ✅ Done/);
    }
  });

  it('marks M21 Done in the milestone overview table', () => {
    const row =
      read('docs/milestones.md')
        .split('\n')
        .find((line) => line.startsWith('| **M21** |')) ?? '';
    expect(row, 'M21 overview row').toContain('✅ Done');
    expect(row, 'M21 overview row').not.toContain('Planned');
  });

  it('sets the M21 GDD status to `implemented` in the module and in the GDD index', () => {
    const header =
      read('docs/gdd/m21-village-hub.md')
        .split('\n')
        .find((line) => line.startsWith('**Status:**')) ?? '';
    expect(header, 'm21-village-hub.md status header').toMatch(/^\*\*Status:\*\* `implemented`/);

    const indexRow =
      read('docs/gdd.md')
        .split('\n')
        .find((line) => line.includes('](gdd/m21-village-hub.md)')) ?? '';
    expect(indexRow, 'docs/gdd.md M21 index row').toMatch(/\|\s*`implemented`\s*\|\s*$/);
  });

  it('says M0–M21 shipped in AGENTS.md', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('M0–M21 done');
    expect(agents).not.toContain('**M21** is designed');
  });
});

describe('#95 deploy bundle', () => {
  it('passes the Cloudflare static asset gates and carries the village', () => {
    expect(existsSync(join(DEPLOY, 'index.html')), 'game/deploy/index.html').toBe(true);
    expect(existsSync(join(DEPLOY, 'og.png')), 'game/deploy/og.png').toBe(true);

    const files = walk(DEPLOY).filter((path) => !path.endsWith('_headers'));
    expect(files.length).toBeLessThanOrEqual(CF_FILE_COUNT_LIMIT);
    for (const path of files) {
      expect(statSync(path).size, `${path} < 25 MiB`).toBeLessThan(CF_FILE_LIMIT_BYTES);
    }

    const html = readFileSync(join(DEPLOY, 'index.html'), 'utf8');
    expect(html).toContain('<title>Yokai Field');
    // The village map and the shop interior are in the shipped resources bundle.
    const resources = readFileSync(join(DEPLOY, 'assets/resources/config.json'), 'utf8');
    expect(resources).toContain('village-hub');
    expect(resources).toContain('shop-interior');
  });
});

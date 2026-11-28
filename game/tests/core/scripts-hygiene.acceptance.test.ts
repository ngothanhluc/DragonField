/**
 * Only re-runnable tooling stays in `scripts/`: historical milestone staging scripts (they need the
 * gitignored `art-source/` pack or absolute paths, and `stage:art` regenerated every asset uuid)
 * are gone, nothing depends on them, and no doc points at them. Git history keeps the old files.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME = join(HERE, '..', '..');
const REPO = join(GAME, '..');
const SCRIPTS = join(GAME, 'scripts');
const LIB = join(SCRIPTS, 'lib');
const SELF = fileURLToPath(import.meta.url);

/** Script files that must no longer exist (git history keeps them). */
const RETIRED_FILES = [
  'scripts/stage-m6-assets.ts',
  'scripts/stage-m8-audio.ts',
  'scripts/stage-m9-monsters.ts',
  'scripts/stage-m12-assets.ts',
  'scripts/stage-m13-icons.ts',
  'scripts/stage-m13-monsters.ts',
  'scripts/stage-m14-characters.ts',
  'scripts/stage-m18-monsters.ts',
  'scripts/stage-m19-art.ts',
  'scripts/stage-m21-assets.ts',
  'scripts/stage-atmosphere.ts',
  'scripts/stage-water.ts',
  'scripts/stage-boss-pool.ts',
  'scripts/lib/stage-tileset.ts',
  'scripts/lib/m21-manifest.ts',
] as const;

/** Package scripts removed with them. */
const RETIRED_PACKAGE_SCRIPTS = ['stage:art', 'stage:audio', 'stage:m9', 'stage:m18'] as const;

/** Strings no doc or source comment may still contain. */
const RETIRED_MENTIONS = [
  ...RETIRED_FILES.map((file) => basename(file, '.ts')).filter((name) => name !== 'm21-manifest'),
  'lib/m21-manifest',
  ...RETIRED_PACKAGE_SCRIPTS,
];

function walk(dir: string, accept: (path: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path, accept));
    else if (accept(path)) out.push(path);
  }
  return out;
}

const isTs = (path: string): boolean => path.endsWith('.ts') && !path.endsWith('.d.ts');
const isMd = (path: string): boolean => path.endsWith('.md');

function packageScripts(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(GAME, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  return pkg.scripts;
}

/** Relative `./` / `../` import specifiers of a TS file. */
function relativeImports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return Array.from(text.matchAll(/from\s+'(\.{1,2}\/[^']+)'/g), (match) => match[1]!);
}

function resolveTs(from: string, spec: string): string {
  const base = resolve(dirname(from), spec);
  return base.endsWith('.ts') ? base : `${base}.ts`;
}

describe('#114 retired staging scripts', () => {
  it('no test imports a top-level script (only scripts/lib/* modules)', () => {
    const offenders: string[] = [];
    for (const test of walk(join(GAME, 'tests'), isTs)) {
      for (const spec of relativeImports(test)) {
        const target = resolveTs(test, spec);
        const rel = relative(SCRIPTS, target);
        if (rel.startsWith('..')) continue; // not under scripts/
        if (!rel.startsWith(`lib/`)) offenders.push(`${relative(GAME, test)} -> scripts/${rel}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the retired script files are deleted', () => {
    const remaining = RETIRED_FILES.filter((file) => existsSync(join(GAME, file)));
    expect(remaining).toEqual([]);
  });

  it('the only stage-* script left is the live Gemini pipeline (stage:gen)', () => {
    const stageScripts = readdirSync(SCRIPTS).filter((name) => name.startsWith('stage-'));
    expect(stageScripts).toEqual(['stage-gemini-art.ts']);
  });

  it('no package script rewrites asset uuids: stage:art and the milestone stagers are gone', () => {
    const names = Object.keys(packageScripts());
    expect(names.filter((name) => (RETIRED_PACKAGE_SCRIPTS as readonly string[]).includes(name))).toEqual([]);
  });

  it('every `bun run scripts/<file>` package script points at an existing file', () => {
    const missing: string[] = [];
    for (const [name, command] of Object.entries(packageScripts())) {
      for (const match of command.matchAll(/bun run (scripts\/\S+\.ts)/g)) {
        if (!existsSync(join(GAME, match[1]!))) missing.push(`${name}: ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every package script that needs art-source/ is documented as such in AGENTS.md', () => {
    const agents = readFileSync(join(REPO, 'AGENTS.md'), 'utf8').split('\n');
    const undocumented: string[] = [];
    for (const [name, command] of Object.entries(packageScripts())) {
      const match = /bun run (scripts\/\S+\.ts)/.exec(command);
      if (!match || !existsSync(join(GAME, match[1]!))) continue;
      if (!readFileSync(join(GAME, match[1]!), 'utf8').includes('art-source')) continue;
      const documented = agents.some((line) => line.includes(name) && line.includes('art-source'));
      if (!documented) undocumented.push(name);
    }
    expect(undocumented).toEqual([]);
  });

  it('every scripts/lib module is still used by a remaining script (no test-only or orphan libs)', () => {
    const reached = new Set<string>();
    const queue = readdirSync(SCRIPTS)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => join(SCRIPTS, name));
    while (queue.length > 0) {
      const file = queue.pop()!;
      for (const spec of relativeImports(file)) {
        const target = resolveTs(file, spec);
        if (dirname(target) !== LIB || reached.has(target) || !existsSync(target)) continue;
        reached.add(target);
        queue.push(target);
      }
    }
    const orphans = walk(LIB, isTs)
      .filter((file) => !reached.has(file))
      .map((file) => relative(GAME, file));
    expect(orphans).toEqual([]);
  });

  it('AGENTS.md, docs and source comments mention no retired script', () => {
    const files = [
      join(REPO, 'AGENTS.md'),
      join(REPO, 'README.md'),
      ...walk(join(REPO, 'docs'), isMd),
      ...walk(join(REPO, '.claude', 'skills'), isMd),
      ...walk(join(GAME, 'scripts'), isTs),
      ...walk(join(GAME, 'tests'), isTs).filter((file) => file !== SELF),
      ...walk(join(GAME, 'assets', 'scripts'), isTs),
    ].filter((file) => existsSync(file));
    const hits: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const mention of RETIRED_MENTIONS) {
          if (line.includes(mention)) hits.push(`${relative(REPO, file)}:${index + 1}: ${mention}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });
});

/**
 * Emit `assets/scripts/core/enemies/tuning.generated.ts` from `config/tuning.json`.
 *
 * Run with bun:
 *
 * ```bash
 * bun run gen           # regenerate the generated file
 * bun run check:config  # check only, exit 1 when the file drifts or is missing
 * ```
 *
 * Why this script exists: `config/tuning.json` sits **outside `assets/`** so Cocos
 * does not treat tuning numbers as an asset — a JSON import from inside `assets/` may not
 * survive the editor's script bundle step, and we have no way to verify that from
 * the CLI. Instead, the JSON is compiled ahead of time into a plain TS module
 * (`tuning.generated.ts`), which is certainly bundled like every other script.
 *
 * The script only reads/writes files and calls `parseTuning()` — it keeps **no** copy of the
 * validation rules, so JSON valid at generate time is JSON valid at runtime.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseTuning,
  type TuningConfig,
} from '../assets/scripts/core/enemies/tuning-schema';

/** Repo path of the source and target, used for readable error messages. */
const CONFIG_RELATIVE_PATH = 'config/tuning.json';
const OUTPUT_RELATIVE_PATH = 'assets/scripts/core/enemies/tuning.generated.ts';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONFIG_PATH = join(PROJECT_ROOT, CONFIG_RELATIVE_PATH);
const OUTPUT_PATH = join(PROJECT_ROOT, OUTPUT_RELATIVE_PATH);

const HEADER =
  '// AUTO-GENERATED from game/config/tuning.json — do not edit. Run: bun run gen';
const NOTE = [
  '//',
  '// Validated balance numbers from `config/tuning.json`. Edit the JSON then run `bun run gen`;',
  '// `bun run check:config` blocks this file from drifting from the source.',
].join('\n');

/** Read + validate the source JSON. Throws `parseTuning` errors, which already carry context. */
function readTuning(): TuningConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (error) {
    throw new Error(
      `cannot read ${CONFIG_RELATIVE_PATH}: ${(error as Error).message}`,
    );
  }
  return parseTuning(raw);
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Print an object as a TS literal, keeping `parseTuning`'s key order.
 *
 * Formatting intentionally matches Prettier defaults (2 spaces, unquoted keys when they are
 * identifiers, trailing commas) so `bun run format` does not create false "drift".
 */
function renderObject(source: Record<string, unknown>, indent: string): string {
  const lines: string[] = ['{'];
  for (const [key, value] of Object.entries(source)) {
    const printedKey = IDENTIFIER.test(key) ? key : JSON.stringify(key);
    lines.push(
      `${indent}  ${printedKey}: ${renderValue(value, `${indent}  `)},`,
    );
  }
  lines.push(`${indent}}`);
  return lines.join('\n');
}

function renderValue(value: unknown, indent: string): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map(
      (item) => `${indent}  ${renderValue(item, `${indent}  `)},`,
    );
    return `[\n${items.join('\n')}\n${indent}]`;
  }
  if (typeof value === 'object')
    return renderObject(value as Record<string, unknown>, indent);

  throw new Error(`cannot print a value of type ${typeof value} into a TS module`);
}

/** Content of the generated file. Deterministic: same JSON → same bytes. */
function renderModule(tuning: TuningConfig): string {
  return `${HEADER}\n${NOTE}\n\nexport const TUNING_DATA = ${renderObject(
    tuning as unknown as Record<string, unknown>,
    '',
  )} as const;\n`;
}

/** First drifting line + drift count, enough to see that `bun run gen` is needed. */
function describeDrift(expected: string, actual: string): string {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const length = Math.max(expectedLines.length, actualLines.length);
  const mismatches: number[] = [];

  for (let index = 0; index < length; index += 1) {
    if (expectedLines[index] !== actualLines[index]) mismatches.push(index);
  }

  if (mismatches.length === 0) return '';

  const first = mismatches[0] ?? 0;
  const lineNumber = first + 1;
  const expectedLine = expectedLines[first] ?? '<end of file>';
  const actualLine = actualLines[first] ?? '<end of file>';

  return [
    `${OUTPUT_RELATIVE_PATH} has drifted from ${CONFIG_RELATIVE_PATH} (${mismatches.length} differing line(s)).`,
    `  line ${lineNumber} expected: ${expectedLine}`,
    `  line ${lineNumber} actual: ${actualLine}`,
    `  Run \`bun run gen\` to regenerate.`,
  ].join('\n');
}

function check(expected: string): boolean {
  let actual: string;
  try {
    actual = readFileSync(OUTPUT_PATH, 'utf8');
  } catch {
    console.error(
      `${OUTPUT_RELATIVE_PATH} has not been generated from ${CONFIG_RELATIVE_PATH}.\n  Run \`bun run gen\` to create it.`,
    );
    return false;
  }

  if (actual === expected) return true;

  console.error(describeDrift(expected, actual));
  return false;
}

function main(args: readonly string[]): number {
  const unknownFlags = args.filter((arg) => arg !== '--check');
  if (unknownFlags.length > 0) {
    console.error(
      `unsupported argument: ${unknownFlags.join(' ')}\nUsage: bun run scripts/gen-tuning.ts [--check]`,
    );
    return 1;
  }

  let tuning: TuningConfig;
  try {
    tuning = readTuning();
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }

  const expected = renderModule(tuning);

  if (args.includes('--check')) {
    if (check(expected)) {
      console.log(`${OUTPUT_RELATIVE_PATH} matches ${CONFIG_RELATIVE_PATH}.`);
      return 0;
    }
    return 1;
  }

  writeFileSync(OUTPUT_PATH, expected, 'utf8');
  console.log(`Generated ${OUTPUT_RELATIVE_PATH} from ${CONFIG_RELATIVE_PATH}.`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));

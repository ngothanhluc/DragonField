import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TUNING_DATA } from '../../assets/scripts/core/enemies/tuning.generated';

/**
 * Stale gate: `tuning.generated.ts` must be a faithful print of
 * `config/tuning.json`.
 *
 * `bun run check:config` already compares byte-by-byte before tsc runs, but this test
 * also locks it at the **semantic** level: anyone editing the generated file (or the JSON) by hand
 * and forgetting `bun run gen` goes red immediately, with a message naming the source file.
 */
const CONFIG_PATH = new URL('../../config/tuning.json', import.meta.url);
const GENERATED_PATH = new URL(
  '../../assets/scripts/core/enemies/tuning.generated.ts',
  import.meta.url,
);

const config: unknown = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const generatedSource = readFileSync(GENERATED_PATH, 'utf8');

describe('tuning sync — generated code matches config/tuning.json', () => {
  it('the exported object of the generated module deep-equals the source JSON', () => {
    expect(TUNING_DATA).toEqual(config);
  });

  it('the JSON version appears in the generated module', () => {
    const version = (config as { version?: unknown }).version;
    expect(typeof version).toBe('number');
    expect(TUNING_DATA.version).toBe(version);
  });

  it('the generated file carries an AUTO-GENERATED header and mentions bun run gen', () => {
    expect(generatedSource).toContain(
      '// AUTO-GENERATED from game/config/tuning.json — do not edit. Run: bun run gen',
    );
  });
});

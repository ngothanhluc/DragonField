/**
 * Validated balance tuning numbers, used by the game.
 *
 * The single source is `game/config/tuning.json` — **outside `assets/`**, so Cocos
 * does not treat it as an asset and never touches it while bundling scripts. From that JSON,
 * `scripts/gen-tuning.ts` emits `tuning.generated.ts` (a plain TS module),
 * and this file only imports that module:
 *
 * ```text
 * config/tuning.json  --bun run gen-->  core/enemies/tuning.generated.ts
 *                                              |
 *                                              v
 *                                        core/enemies/tuning.ts
 * ```
 *
 * Why not import the JSON directly: everything under `assets/` is content of the
 * asset DB, and we cannot verify from the CLI that a JSON import survives
 * the editor's script bundle step. A TS module certainly does.
 *
 * AGENTS rule 3 — "tuning numbers live outside code, never hardcoded". Changing balance =
 * edit `config/tuning.json` then run `bun run gen`; `bun run check:config` blocks a
 * generated file that drifts from the JSON.
 *
 * `parseTuning()` still runs here as a defence layer: a broken generated file throws at
 * load time instead of quietly `undefined` → `NaN` → 0-health enemies. The validation
 * rules live in `tuning-schema.ts`, shared with the generate script.
 *
 * No `cc` import, no file reads, no time — pure `core/`.
 * A test wanting another number set calls `parseTuning(structuredClone(…))` on a
 * copy, never mutating the exported object.
 */
import { TUNING_DATA } from './tuning.generated';
import {
  parseTuning,
  type CombatTuning,
  type EnemiesTuning,
  type FeelTuning,
  type NavigationTuning,
  type TuningConfig,
} from './tuning-schema';

export * from './tuning-schema';

/**
 * Raw object emitted from `config/tuning.json`, kept so tests can check
 * "number in code = number in JSON".
 */
export const TUNING_SOURCE: unknown = TUNING_DATA;

/** Every validated tuning number. */
export const TUNING: TuningConfig = parseTuning(TUNING_SOURCE);

/** Player combat numbers — `config.ts` derives `DEFAULT_COMBAT` from here. */
export const COMBAT_TUNING: CombatTuning = TUNING.combat;

/** Enemy numbers — `behaviours.ts`, `waves.ts` and the sim read from here. */
export const ENEMY_TUNING: EnemiesTuning = TUNING.enemies;

/** Per-chapter scale factors — `behaviours.ts` reads them when computing health/damage. */
export const CHAPTER_TUNING = TUNING.chapters;

/** Enemy navigation numbers (#34) — the sim and the game adapter read them. */
export const NAVIGATION_TUNING: NavigationTuning = TUNING.navigation;

/** Juice numbers (ticket #2) — the `game/` adapter reads them; `core/feel/` only takes numbers as parameters. */
export const FEEL_TUNING: FeelTuning = TUNING.feel;

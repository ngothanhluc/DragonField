/**
 * Clean, conflict-free manifest merge helper for M21 NPC and village animal animations.
 *
 * Appends or updates ONLY M21-owned keys (`npc.<id>*` and `animal.bird`) at the end of
 * `animations.json` while leaving every existing entry in the manifest untouched in both content
 * and key order. Validated with `validateManifest` before returning.
 */
import {
  DIRECTIONS,
  validateManifest,
  type AnimationManifest,
  type Direction,
  type SpriteEntry,
} from '../../assets/scripts/core/art/manifest';

/** Non-playable village NPC ids staged from `Actor/Character/`. */
export const M21_NPC_SOURCES = [
  { id: 'villager-1', packFolder: 'Villager' },
  { id: 'villager-2', packFolder: 'Villager2' },
  { id: 'villager-3', packFolder: 'Villager3' },
  { id: 'villager-4', packFolder: 'Villager4' },
  { id: 'villager-5', packFolder: 'Woman' },
  { id: 'shopkeeper', packFolder: 'OldMan' },
  { id: 'dojo-master', packFolder: 'Master' },
] as const;

export type M21NpcId = (typeof M21_NPC_SOURCES)[number]['id'];

export const M21_NPC_IDS: readonly M21NpcId[] = M21_NPC_SOURCES.map((entry) => entry.id);

export interface MeasuredSheetFoot {
  readonly sheet: string;
  readonly footPx: number;
}

/**
 * Build the deterministic map of M21 sprite entries given measured `footPx` values per sheet path
 * (relative to `game/assets/`, e.g. `resources/art/npc/villager-1/villager-1.png`).
 */
export function buildM21SpriteEntries(
  footBySheet: ReadonlyMap<string, number>,
): Record<string, SpriteEntry> {
  const footOf = (sheet: string): number => {
    const measured = footBySheet.get(sheet);
    if (measured === undefined) {
      throw new Error(`m21-manifest: missing measured footPx for "${sheet}"`);
    }
    return measured;
  };

  const out: Record<string, SpriteEntry> = {};

  for (const { id } of M21_NPC_SOURCES) {
    const baseDir = `resources/art/npc/${id}`;
    const lookSheet = `${baseDir}/${id}.png`;
    out[`npc.${id}`] = {
      sheet: lookSheet,
      frameWidth: 16,
      frameHeight: 16,
      layout: 'strip',
      directions: [],
      frames: 4,
      fps: 2,
      loop: true,
      anchor: 'feet',
      footPx: footOf(lookSheet),
    };

    for (const dir of DIRECTIONS) {
      const standSheet = `${baseDir}/${id}-stand-${dir}.png`;
      out[`npc.${id}-stand.${dir}`] = {
        sheet: standSheet,
        frameWidth: 16,
        frameHeight: 16,
        layout: 'strip',
        directions: [dir],
        frames: 1,
        fps: 1,
        loop: true,
        anchor: 'feet',
        footPx: footOf(standSheet),
      };

      const stepSheet = `${baseDir}/${id}-step-${dir}.png`;
      out[`npc.${id}-step.${dir}`] = {
        sheet: stepSheet,
        frameWidth: 16,
        frameHeight: 16,
        layout: 'strip',
        directions: [dir],
        frames: 4,
        fps: 6,
        loop: true,
        anchor: 'feet',
        footPx: footOf(stepSheet),
      };
    }
  }

  const birdSheet = 'resources/art/characters/animals/bird.png';
  out['animal.bird'] = {
    sheet: birdSheet,
    frameWidth: 16,
    frameHeight: 16,
    layout: 'grid',
    directions: [],
    frames: 2,
    fps: 6,
    loop: true,
    anchor: 'feet',
    footPx: footOf(birdSheet),
  };

  return out;
}

/** All manifest keys owned by M21 staging (`npc.<id>*` + `animal.bird`). */
export function m21ManifestKeys(): readonly string[] {
  const keys: string[] = [];
  for (const { id } of M21_NPC_SOURCES) {
    keys.push(`npc.${id}`);
    for (const dir of DIRECTIONS as readonly Direction[]) {
      keys.push(`npc.${id}-stand.${dir}`);
      keys.push(`npc.${id}-step.${dir}`);
    }
  }
  keys.push('animal.bird');
  return keys;
}

/**
 * Non-destructively merge M21 entries into an existing raw `animations.json` object:
 * - Preserves all non-M21 keys and their exact insertion order.
 * - Appends M21 keys cleanly at the bottom.
 * - Validates the resulting manifest via `validateManifest`.
 */
export function mergeM21ManifestEntries(
  existingRaw: unknown,
  m21Entries: Readonly<Record<string, SpriteEntry>>,
): AnimationManifest {
  const validatedExisting = validateManifest(existingRaw);
  const owned = new Set(Object.keys(m21Entries));

  const mergedSprites: Record<string, SpriteEntry> = {};
  for (const [key, entry] of Object.entries(validatedExisting.sprites)) {
    if (owned.has(key)) continue;
    mergedSprites[key] = entry;
  }
  for (const [key, entry] of Object.entries(m21Entries)) {
    mergedSprites[key] = entry;
  }

  return validateManifest({
    version: validatedExisting.version,
    sprites: mergedSprites,
  });
}

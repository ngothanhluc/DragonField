/**
 * Prop catalogue (M9, ticket #35): what a room may place, how it is drawn, and what part of it
 * blocks. "What looks solid is solid": a solid prop's collider becomes an obstacle at parse time.
 *
 * STUB written with the red acceptance test: the catalogue is empty. The executor fills it and
 * implements the helpers; the exported names and signatures are the agreed seam.
 */
import type { TileRect } from './obstacle-visuals';

/** What a prop is, for collider rules and later depth/cover rules (#36). */
export type PropKind =
  | 'tree'
  | 'rock'
  | 'house'
  | 'stump'
  | 'structure'
  | 'bush'
  | 'grass'
  | 'flower'
  | 'decor';

export interface PropDef {
  /** Unique within its chapter, e.g. `tree-green`. Referenced by `.tmx` `prop` objects. */
  readonly key: string;
  readonly kind: PropKind;
  /** Resource path of the sheet, like `resources/art/tilesets/TilesetNature.png`. */
  readonly sheet: string;
  /** Sprite cell in the sheet, pixels, top-left origin. */
  readonly rect: TileRect;
  /** `true` = blocks walkers and bullets through its collider. */
  readonly solid: boolean;
  /**
   * The blocking part, pixels **relative to `rect`**'s top-left; `null` when not solid.
   * A tree blocks only at its trunk, a house at its ground-floor walls, a rock at its base.
   */
  readonly collider: TileRect | null;
  /** Part drawn above actors and faded when someone is under it (tree canopy, roof) — used by #36. */
  readonly overlay?: TileRect;
  /** Walk-in cover (tall grass, bushes) — used by #36. */
  readonly cover?: boolean;
}

/** Catalogue per chapter number. */
export const PROP_CATALOGUE: Readonly<Record<number, readonly PropDef[]>> = {
  1: [],
  2: [],
  3: [],
};

export function propDef(chapter: number, key: string): PropDef | undefined {
  return PROP_CATALOGUE[chapter]?.find((def) => def.key === key);
}

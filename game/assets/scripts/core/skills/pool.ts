/**
 * The 20-skill pool — frozen v1 (docs/gdd.md §6).
 *
 * A skill card is only **data**: the mechanical effect lives in `tags`, not in
 * the id or name. That lets `derived-stats.ts` stack every skill without
 * a per-skill `switch` table, and adding a skill = adding one entry.
 *
 * File/folder names: kebab-case; the id matches the kebab-cased skill name.
 */

export const RARITIES = ['common', 'rare', 'epic'] as const;

export type Rarity = (typeof RARITIES)[number];

/**
 * One mechanical effect of a skill. Every tag means "each stack adds this much";
 * tags that stack multiplicatively have their formula documented in `derived-stats.ts`.
 */
export type SkillTag =
  /** Flat damage added per shot. */
  | { readonly kind: 'damage-add'; readonly amount: number }
  /** Adds to the fire-rate factor: rate = base × (1 + Σ amount × stack). */
  | { readonly kind: 'fire-rate-mult'; readonly amount: number }
  /** Adds projectiles per shot (firing at ±12°). */
  | { readonly kind: 'projectile-add'; readonly amount: number }
  /** Bullets pass through 1 more enemy per stack. */
  | { readonly kind: 'pierce-add' }
  /** Adds crit chance; `multiplier` is the damage factor on a crit. */
  | { readonly kind: 'crit-chance'; readonly chance: number; readonly multiplier: number }
  /** Adds max hearts. */
  | { readonly kind: 'max-hearts'; readonly amount: number }
  /** Heals hearts each time a room is cleared. */
  | { readonly kind: 'heal-per-room'; readonly amount: number }
  /** Blocks 1 hit per charge, recharging after `cooldownMs`. */
  | { readonly kind: 'shield'; readonly cooldownMs: number }
  /** Enemies touching the player take `damage`. */
  | { readonly kind: 'thorns'; readonly damage: number }
  /** Adds to the move-speed factor: speed = base × (1 + Σ amount × stack). */
  | { readonly kind: 'move-speed-mult'; readonly amount: number }
  /** Multiplies the i-frame per stack: i-frame = base × amount^stack. */
  | { readonly kind: 'iframe-mult'; readonly amount: number }
  /** Hits slow the enemy. */
  | { readonly kind: 'slow-on-hit'; readonly factor: number; readonly durationMs: number }
  /** Deals damage over time. */
  | { readonly kind: 'poison'; readonly dps: number; readonly durationMs: number }
  /** Heals a percentage of damage dealt. */
  | { readonly kind: 'lifesteal'; readonly percent: number }
  /** Adds to the gold pickup factor. */
  | { readonly kind: 'gold-mult'; readonly amount: number }
  /** Adds weight to high rarities (see the formula in `roll.ts`). */
  | { readonly kind: 'luck-add'; readonly amount: number }
  /** Damage bonus while the enemy is below `threshold` health. */
  | { readonly kind: 'execute'; readonly threshold: number; readonly bonus: number }
  /** The bullet bounces to another enemy `bounces` times. */
  | { readonly kind: 'ricochet-add'; readonly bounces: number }
  /** The bullet tracks its target. */
  | { readonly kind: 'homing-add' }
  /** The bullet explodes in an AoE on hit. */
  | { readonly kind: 'explosive'; readonly radiusTiles: number; readonly damageRatio: number };

export interface SkillDef {
  readonly id: string;
  readonly name: string;
  /** Two-letter abbreviation for the HUD. Hand-written because automatic initials collide (Sharpen/Shield). */
  readonly short: string;
  readonly rarity: Rarity;
  readonly maxStacks: number;
  readonly tags: readonly SkillTag[];
}

/** Exactly the 20 GDD §6 skills, keeping table order for easy cross-checking. */
export const SKILLS: readonly SkillDef[] = [
  {
    id: 'sharpen',
    short: 'SH',
    name: 'Sharpen',
    rarity: 'common',
    maxStacks: 5,
    tags: [{ kind: 'damage-add', amount: 1 }],
  },
  {
    id: 'rapid-fire',
    short: 'RF',
    name: 'Rapid Fire',
    rarity: 'common',
    maxStacks: 5,
    tags: [{ kind: 'fire-rate-mult', amount: 0.25 }],
  },
  {
    id: 'twin-shot',
    short: 'TW',
    name: 'Twin Shot',
    rarity: 'rare',
    maxStacks: 3,
    tags: [{ kind: 'projectile-add', amount: 1 }],
  },
  {
    id: 'piercing',
    short: 'PR',
    name: 'Piercing',
    rarity: 'rare',
    maxStacks: 3,
    tags: [{ kind: 'pierce-add' }],
  },
  {
    id: 'ricochet',
    short: 'RI',
    name: 'Ricochet',
    rarity: 'epic',
    maxStacks: 2,
    tags: [{ kind: 'ricochet-add', bounces: 1 }],
  },
  {
    id: 'homing',
    short: 'HO',
    name: 'Homing',
    rarity: 'epic',
    maxStacks: 1,
    tags: [{ kind: 'homing-add' }],
  },
  {
    id: 'explosive',
    short: 'XP',
    name: 'Explosive',
    rarity: 'rare',
    maxStacks: 3,
    tags: [{ kind: 'explosive', radiusTiles: 1.5, damageRatio: 0.5 }],
  },
  {
    id: 'crit-eye',
    short: 'CE',
    name: 'Crit Eye',
    rarity: 'rare',
    maxStacks: 3,
    tags: [{ kind: 'crit-chance', chance: 0.15, multiplier: 2 }],
  },
  {
    id: 'vitality',
    short: 'VI',
    name: 'Vitality',
    rarity: 'common',
    maxStacks: 5,
    // The GDD also lists "heal 1 heart now": that is a pickup-time effect handled by the run,
    // not a persistent stat, so tags cannot express it.
    tags: [{ kind: 'max-hearts', amount: 1 }],
  },
  {
    id: 'second-wind',
    short: '2W',
    name: 'Second Wind',
    rarity: 'epic',
    maxStacks: 2,
    tags: [{ kind: 'heal-per-room', amount: 2 }],
  },
  {
    id: 'shield',
    short: 'SD',
    name: 'Shield',
    rarity: 'rare',
    maxStacks: 3,
    tags: [{ kind: 'shield', cooldownMs: 20_000 }],
  },
  {
    id: 'thorns',
    short: 'TH',
    name: 'Thorns',
    rarity: 'rare',
    maxStacks: 3,
    tags: [{ kind: 'thorns', damage: 2 }],
  },
  {
    id: 'swift',
    short: 'SW',
    name: 'Swift',
    rarity: 'common',
    maxStacks: 5,
    tags: [{ kind: 'move-speed-mult', amount: 0.1 }],
  },
  {
    id: 'long-iframe',
    short: 'IF',
    name: 'Long i-frame',
    rarity: 'rare',
    maxStacks: 2,
    tags: [{ kind: 'iframe-mult', amount: 1.375 }],
  },
  {
    id: 'freeze',
    short: 'FR',
    name: 'Freeze',
    rarity: 'rare',
    maxStacks: 2,
    tags: [{ kind: 'slow-on-hit', factor: 0.4, durationMs: 1000 }],
  },
  {
    id: 'poison',
    short: 'PO',
    name: 'Poison',
    rarity: 'rare',
    maxStacks: 2,
    tags: [{ kind: 'poison', dps: 1, durationMs: 3000 }],
  },
  {
    id: 'lifesteal',
    short: 'LS',
    name: 'Lifesteal',
    rarity: 'epic',
    maxStacks: 2,
    tags: [{ kind: 'lifesteal', percent: 0.05 }],
  },
  {
    id: 'greed',
    short: 'GR',
    name: 'Greed',
    rarity: 'common',
    maxStacks: 4,
    tags: [{ kind: 'gold-mult', amount: 0.25 }],
  },
  {
    id: 'luck',
    short: 'LK',
    name: 'Luck',
    rarity: 'rare',
    maxStacks: 3,
    tags: [{ kind: 'luck-add', amount: 0.01 }],
  },
  {
    id: 'executioner',
    short: 'EX',
    name: 'Executioner',
    rarity: 'epic',
    maxStacks: 2,
    tags: [{ kind: 'execute', threshold: 0.3, bonus: 0.5 }],
  },
];

const SKILLS_BY_ID: ReadonlyMap<string, SkillDef> = new Map(SKILLS.map((s) => [s.id, s]));

/** Look up a skill by id. An unknown id is a bug (typo / old pool) so it throws. */
export function getSkill(id: string): SkillDef {
  const skill = SKILLS_BY_ID.get(id);
  if (skill === undefined) {
    throw new Error(`Skill does not exist in the pool: "${id}"`);
  }
  return skill;
}

export interface OwnedSkillStacks {
  readonly def: SkillDef;
  readonly stacks: number;
}

/**
 * Effective stack count of each owned skill.
 *
 * - Floors and clamps into [0, maxStacks]: a broken save or a double-add cannot
 *   push stats past the cap.
 * - Skips ids not in the pool instead of throwing: a save from an old pool must still open a run.
 * - Iterates in `SKILLS` order, not Map order, so the result is deterministic.
 */
export function resolveOwnedSkills(owned: ReadonlyMap<string, number>): OwnedSkillStacks[] {
  const result: OwnedSkillStacks[] = [];

  for (const def of SKILLS) {
    const stacks = clampStacks(owned.get(def.id) ?? 0, def.maxStacks);
    if (stacks > 0) result.push({ def, stacks });
  }

  return result;
}

/** Total luck points held (each Luck stack = 0.01 points). Used by `rollChoices`. */
export function luckPoints(owned: ReadonlyMap<string, number>): number {
  let total = 0;

  for (const skill of resolveOwnedSkills(owned)) {
    for (const tag of skill.def.tags) {
      if (tag.kind === 'luck-add') total += tag.amount * skill.stacks;
    }
  }

  return total;
}

function clampStacks(raw: number, maxStacks: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(Math.floor(raw), maxStacks);
}

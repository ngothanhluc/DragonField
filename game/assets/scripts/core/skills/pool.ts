/**
 * Pure-combat skill pool — 27 skills across 4 pillars (M13, ADR-022).
 *
 * Zero economy, gold, XP, or luck cards live here: every card directly advances combat
 * offense, elemental status, defense, or mobility/dash & signature active skills.
 *
 * A skill card is only **data**: the mechanical effect lives in `tags`, not in the id or name,
 * so `derived-stats.ts` stacks every skill & Evolution uniformly without a per-id `switch`.
 */

export const SKILL_PILLARS = ['weapon', 'elemental', 'defense', 'mobility'] as const;

export type SkillPillar = (typeof SKILL_PILLARS)[number];

/** Base skill rarities obtainable from normal level-up rolls and mid-run shops. */
export const BASE_RARITIES = ['common', 'rare', 'epic'] as const;

export type BaseRarity = (typeof BASE_RARITIES)[number];

/** All card rarities, including `'legendary'` for unlocked Evolutions (M13, ADR-022). */
export const RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;

export type Rarity = (typeof RARITIES)[number];

/**
 * One mechanical effect of a skill or Evolution. Every tag means "each stack adds this much";
 * tags that stack multiplicatively have their formula documented in `derived-stats.ts`.
 */
export type SkillTag =
  /** Flat damage added per shot. */
  | { readonly kind: 'damage-add'; readonly amount: number }
  /** Adds to the fire-rate factor: rate = base × (1 + Σ amount × stack). */
  | { readonly kind: 'fire-rate-mult'; readonly amount: number }
  /** Adds projectiles per shot (firing at ±12°). */
  | { readonly kind: 'projectile-add'; readonly amount: number }
  /** Bullets pass through `amount` (default 1) more enemies per stack. */
  | { readonly kind: 'pierce-add'; readonly amount?: number }
  /** Adds crit chance; `multiplier` is the damage factor on a crit. */
  | { readonly kind: 'crit-chance'; readonly chance: number; readonly multiplier: number }
  /** Adds max hearts (and heals that amount immediately on pickup). */
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
  /** Deals poison damage over time. */
  | { readonly kind: 'poison'; readonly dps: number; readonly durationMs: number }
  /** Deals burn damage over time. */
  | { readonly kind: 'burn'; readonly dps: number; readonly durationMs: number }
  /** Arcs lightning to up to `arcs` nearby enemies within `rangeTiles` on hit. */
  | {
      readonly kind: 'shock-arc';
      readonly arcs: number;
      readonly damageRatio: number;
      readonly rangeTiles: number;
    }
  /** Bonus damage ratio against enemies afflicted by any status effect. */
  | { readonly kind: 'status-amp'; readonly bonusRatio: number }
  /** Heals a percentage of damage dealt. */
  | { readonly kind: 'lifesteal'; readonly percent: number }
  /** Damage bonus while the enemy is below `threshold` health. */
  | { readonly kind: 'execute'; readonly threshold: number; readonly bonus: number }
  /** The bullet bounces to another enemy `bounces` times. */
  | { readonly kind: 'ricochet-add'; readonly bounces: number }
  /** The bullet tracks its target. */
  | { readonly kind: 'homing-add' }
  /** The bullet explodes in an AoE on hit. */
  | { readonly kind: 'explosive'; readonly radiusTiles: number; readonly damageRatio: number }
  /** Chance (0..1) to ward off incoming hit damage. */
  | { readonly kind: 'damage-reduction'; readonly chance: number }
  /** Multiplies Shield recharge cooldown per stack (`factor^stack`). */
  | { readonly kind: 'shield-recharge-mult'; readonly factor: number }
  /** Multiplies Dash cooldown per stack (`factor^stack`). */
  | { readonly kind: 'dash-cooldown-mult'; readonly factor: number }
  /** Adds to Dash speed factor: speed = base × (1 + Σ amount × stack). */
  | { readonly kind: 'dash-speed-mult'; readonly amount: number }
  /** Emits a radial damage burst when dashing. */
  | { readonly kind: 'dash-nova'; readonly radiusTiles: number; readonly damage: number }
  /** Temporary fire-rate bonus after dashing. */
  | { readonly kind: 'post-dash-fire-rate'; readonly bonus: number; readonly durationMs: number }
  /** Multiplies Signature Active cooldown per stack (`factor^stack`). */
  | { readonly kind: 'active-cooldown-mult'; readonly factor: number }
  /** Adds to Signature Active power factor: power = 1 + Σ amount × stack. */
  | { readonly kind: 'active-power-mult'; readonly amount: number };

/** Common card definition shared by base skills (`BaseSkillDef`) and Legendary Evolutions (`EvolutionDef`). */
export interface SkillDef {
  readonly id: string;
  readonly name: string;
  /** Two-letter abbreviation for the HUD. Hand-written because automatic initials collide. */
  readonly short: string;
  readonly rarity: Rarity;
  readonly maxStacks: number;
  readonly tags: readonly SkillTag[];
  readonly pillar?: SkillPillar;
  readonly requires?: readonly [string, string];
  readonly minStacksEach?: number;
}

/** One of the 27 base pure-combat skills organized by pillar. */
export interface BaseSkillDef extends SkillDef {
  readonly pillar: SkillPillar;
  readonly rarity: BaseRarity;
}

/**
 * The 27 pure-combat skills across 4 pillars:
 * - Weapon / Offense (9)
 * - Elemental / Status (6)
 * - Defense / Survival (6)
 * - Mobility / Dash & Active (6)
 */
export const SKILLS: readonly BaseSkillDef[] = [
  // --- Pillar 1: Weapon / Offense (9) ---
  {
    id: 'sharpen',
    short: 'SH',
    name: 'Sharpen',
    pillar: 'weapon',
    rarity: 'common',
    maxStacks: 5,
    tags: [{ kind: 'damage-add', amount: 1 }],
  },
  {
    id: 'rapid-fire',
    short: 'RF',
    name: 'Rapid Fire',
    pillar: 'weapon',
    rarity: 'common',
    maxStacks: 5,
    tags: [{ kind: 'fire-rate-mult', amount: 0.25 }],
  },
  {
    id: 'twin-shot',
    short: 'TW',
    name: 'Twin Shot',
    pillar: 'weapon',
    rarity: 'rare',
    maxStacks: 3,
    tags: [{ kind: 'projectile-add', amount: 1 }],
  },
  {
    id: 'piercing',
    short: 'PR',
    name: 'Piercing',
    pillar: 'weapon',
    rarity: 'rare',
    maxStacks: 3,
    tags: [{ kind: 'pierce-add' }],
  },
  {
    id: 'ricochet',
    short: 'RI',
    name: 'Ricochet',
    pillar: 'weapon',
    rarity: 'epic',
    maxStacks: 2,
    tags: [{ kind: 'ricochet-add', bounces: 1 }],
  },
  {
    id: 'homing',
    short: 'HO',
    name: 'Homing',
    pillar: 'weapon',
    rarity: 'epic',
    maxStacks: 1,
    tags: [{ kind: 'homing-add' }],
  },
  {
    id: 'explosive',
    short: 'XP',
    name: 'Explosive',
    pillar: 'weapon',
    rarity: 'rare',
    maxStacks: 3,
    tags: [{ kind: 'explosive', radiusTiles: 1.5, damageRatio: 0.5 }],
  },
  {
    id: 'crit-eye',
    short: 'CE',
    name: 'Crit Eye',
    pillar: 'weapon',
    rarity: 'common',
    maxStacks: 3,
    tags: [{ kind: 'crit-chance', chance: 0.15, multiplier: 2 }],
  },
  {
    id: 'executioner',
    short: 'EX',
    name: 'Executioner',
    pillar: 'weapon',
    rarity: 'epic',
    maxStacks: 2,
    tags: [{ kind: 'execute', threshold: 0.3, bonus: 0.5 }],
  },

  // --- Pillar 2: Elemental / Status (6) ---
  {
    id: 'freeze',
    short: 'FR',
    name: 'Freeze',
    pillar: 'elemental',
    rarity: 'rare',
    maxStacks: 2,
    tags: [{ kind: 'slow-on-hit', factor: 0.4, durationMs: 1000 }],
  },
  {
    id: 'poison',
    short: 'PO',
    name: 'Poison',
    pillar: 'elemental',
    rarity: 'rare',
    maxStacks: 2,
    tags: [{ kind: 'poison', dps: 1, durationMs: 3000 }],
  },
  {
    id: 'ignite',
    short: 'IG',
    name: 'Ignite',
    pillar: 'elemental',
    rarity: 'rare',
    maxStacks: 3,
    tags: [{ kind: 'burn', dps: 1.5, durationMs: 2500 }],
  },
  {
    id: 'chain-lightning',
    short: 'CL',
    name: 'Chain Lightning',
    pillar: 'elemental',
    rarity: 'epic',
    maxStacks: 2,
    tags: [{ kind: 'shock-arc', arcs: 2, damageRatio: 0.45, rangeTiles: 4 }],
  },
  {
    id: 'lifesteal',
    short: 'LS',
    name: 'Lifesteal',
    pillar: 'elemental',
    rarity: 'epic',
    maxStacks: 2,
    tags: [{ kind: 'lifesteal', percent: 0.05 }],
  },
  {
    id: 'corrosive',
    short: 'CO',
    name: 'Corrosive',
    pillar: 'elemental',
    rarity: 'rare',
    maxStacks: 2,
    tags: [{ kind: 'status-amp', bonusRatio: 0.25 }],
  },

  // --- Pillar 3: Defense / Survival (6) ---
  {
    id: 'vitality',
    short: 'VI',
    name: 'Vitality',
    pillar: 'defense',
    rarity: 'common',
    maxStacks: 5,
    tags: [{ kind: 'max-hearts', amount: 1 }],
  },
  {
    id: 'second-wind',
    short: '2W',
    name: 'Second Wind',
    pillar: 'defense',
    rarity: 'epic',
    maxStacks: 2,
    tags: [{ kind: 'heal-per-room', amount: 2 }],
  },
  {
    id: 'shield',
    short: 'SD',
    name: 'Shield',
    pillar: 'defense',
    rarity: 'rare',
    maxStacks: 3,
    tags: [{ kind: 'shield', cooldownMs: 20_000 }],
  },
  {
    id: 'thorns',
    short: 'TH',
    name: 'Thorns',
    pillar: 'defense',
    rarity: 'rare',
    maxStacks: 3,
    tags: [{ kind: 'thorns', damage: 2 }],
  },
  {
    id: 'long-iframe',
    short: 'IF',
    name: 'Long i-frame',
    pillar: 'defense',
    rarity: 'rare',
    maxStacks: 2,
    tags: [{ kind: 'iframe-mult', amount: 1.375 }],
  },
  {
    id: 'iron-skin',
    short: 'IS',
    name: 'Iron Skin',
    pillar: 'defense',
    rarity: 'common',
    maxStacks: 3,
    tags: [
      { kind: 'damage-reduction', chance: 0.12 },
      { kind: 'shield-recharge-mult', factor: 0.85 },
    ],
  },

  // --- Pillar 4: Mobility / Dash & Active (6) ---
  {
    id: 'swift',
    short: 'SW',
    name: 'Swift',
    pillar: 'mobility',
    rarity: 'common',
    maxStacks: 5,
    tags: [{ kind: 'move-speed-mult', amount: 0.1 }],
  },
  {
    id: 'phantom-dash',
    short: 'PD',
    name: 'Phantom Dash',
    pillar: 'mobility',
    rarity: 'rare',
    maxStacks: 3,
    tags: [{ kind: 'dash-cooldown-mult', factor: 0.82 }],
  },
  {
    id: 'dash-nova',
    short: 'DN',
    name: 'Dash Nova',
    pillar: 'mobility',
    rarity: 'rare',
    maxStacks: 3,
    tags: [{ kind: 'dash-nova', radiusTiles: 2.2, damage: 2 }],
  },
  {
    id: 'shadow-conduit',
    short: 'SC',
    name: 'Shadow Conduit',
    pillar: 'mobility',
    rarity: 'rare',
    maxStacks: 3,
    tags: [{ kind: 'active-cooldown-mult', factor: 0.82 }],
  },
  {
    id: 'arcane-surge',
    short: 'AS',
    name: 'Arcane Surge',
    pillar: 'mobility',
    rarity: 'epic',
    maxStacks: 2,
    tags: [{ kind: 'active-power-mult', amount: 0.35 }],
  },
  {
    id: 'afterimage',
    short: 'AI',
    name: 'Afterimage',
    pillar: 'mobility',
    rarity: 'common',
    maxStacks: 3,
    tags: [
      { kind: 'dash-speed-mult', amount: 0.15 },
      { kind: 'post-dash-fire-rate', bonus: 0.35, durationMs: 1500 },
    ],
  },
];

const SKILLS_BY_ID: ReadonlyMap<string, BaseSkillDef> = new Map(SKILLS.map((s) => [s.id, s]));

/** Look up a base skill by id. An unknown id is a bug (typo / old pool) so it throws. */
export function getSkill(id: string): BaseSkillDef {
  const skill = SKILLS_BY_ID.get(id);
  if (skill === undefined) {
    throw new Error(`Skill does not exist in the pool: "${id}"`);
  }
  return skill;
}

/** Look up every base skill belonging to a given pillar. */
export function skillsByPillar(pillar: SkillPillar): BaseSkillDef[] {
  return SKILLS.filter((skill) => skill.pillar === pillar);
}

export interface OwnedSkillStacks {
  readonly def: BaseSkillDef;
  readonly stacks: number;
}

/**
 * Effective stack count of each owned base skill.
 *
 * - Floors and clamps into [0, maxStacks]: a broken save or a double-add cannot
 *   push stats past the cap.
 * - Skips ids not in `SKILLS` instead of throwing: Evolutions or old saves are handled cleanly.
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

export function clampSkillStacks(raw: number, maxStacks: number): number {
  return clampStacks(raw, maxStacks);
}

function clampStacks(raw: number, maxStacks: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(Math.floor(raw), maxStacks);
}

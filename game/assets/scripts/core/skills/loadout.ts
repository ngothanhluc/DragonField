/**
 * A run's loadout: which skills are owned and with how many stacks.
 *
 * This is the **only** skill state in a run. Both the game adapter and the
 * simulation go through this class, so the "clamp by `maxStacks`" and "stats
 * derive from stacks" rules cannot drift between them.
 *
 * No `cc` import, no wall-clock read: every function is pure or only mutates
 * the instance's own state.
 */
import { DEFAULT_COMBAT } from '../config';
import { computeDerivedStats, type DerivedStats, type StatsBaseline } from './derived-stats';
import { getSkill, resolveOwnedSkills, type OwnedSkillStacks, type SkillDef } from './pool';

/** Result of one skill pickup — enough for the UI/run to decide sound, healing, logging. */
export interface AcquireResult {
  /** `false` when the skill is capped (or the id is unknown) so nothing changed. */
  readonly acquired: boolean;
  /** Stacks just added (0 when blocked). */
  readonly added: number;
  /** Stacks held after the pickup. */
  readonly stacks: number;
  /** Hearts healed at pickup time (GDD §6: Vitality "heal 1 heart now"). */
  readonly healNow: number;
}

/**
 * Current stack count of every skill. The Map is kept **private** so nobody can
 * accidentally write past the cap; changing it must go through `acquire`.
 */
export class SkillLoadout {
  private readonly owned = new Map<string, number>();

  /** Build a loadout from an existing map (save/debug/sim), clamped to the cap. */
  static from(entries: ReadonlyMap<string, number>): SkillLoadout {
    const loadout = new SkillLoadout();
    for (const skill of resolveOwnedSkills(entries)) {
      loadout.owned.set(skill.def.id, skill.stacks);
    }
    return loadout;
  }

  /** Stacks of one skill; 0 when not owned or the id is unknown. */
  stacks(id: string): number {
    return this.owned.get(id) ?? 0;
  }

  /** Owned skills in `SKILLS` order (deterministic). */
  get entries(): OwnedSkillStacks[] {
    return resolveOwnedSkills(this.owned);
  }

  get size(): number {
    return this.entries.length;
  }

  /** Read-only copy — used by `rollChoices`, the HUD and tests. */
  snapshot(): ReadonlyMap<string, number> {
    return new Map(this.owned);
  }

  /**
   * Acquire `stacks` stacks of skill `id`.
   *
   * - An unknown id returns `acquired: false` instead of throwing: an old save/debug must not kill the run.
   * - Clamped by `maxStacks`; picking up when full is a no-op (the UI should not offer a full card).
   * - `healNow` comes from the `max-hearts` tag of **one** stack (Vitality).
   */
  acquire(id: string, stacks = 1): AcquireResult {
    const def = findSkill(id);
    if (def === undefined) {
      return { acquired: false, added: 0, stacks: 0, healNow: 0 };
    }

    const current = this.stacks(id);
    const room = Math.max(0, def.maxStacks - current);
    const added = Math.min(Math.floor(Math.max(0, stacks)), room);
    if (added <= 0) {
      return { acquired: false, added: 0, stacks: current, healNow: 0 };
    }

    this.owned.set(id, current + added);
    return {
      acquired: true,
      added,
      stacks: current + added,
      healNow: pickupHeal(def) * added,
    };
  }

  /** Final stats of the loadout, shared by game and simulation. */
  stats(base: StatsBaseline = DEFAULT_COMBAT): DerivedStats {
    return computeDerivedStats(this.owned, base);
  }
}

/** Look up a skill but return `undefined` instead of throwing — `acquire` must tolerate unknown ids. */
function findSkill(id: string): SkillDef | undefined {
  try {
    return getSkill(id);
  } catch {
    return undefined;
  }
}

/**
 * Hearts healed immediately when acquiring one stack: sums the `max-hearts` tags.
 *
 * Split from `DerivedStats` because it is a **one-time pickup effect**, not a
 * persistent stat — acquiring Vitality twice heals 2 hearts but the max only rises by 2.
 */
export function pickupHeal(def: SkillDef): number {
  let heal = 0;
  for (const tag of def.tags) {
    if (tag.kind === 'max-hearts') heal += tag.amount;
  }
  return Math.max(0, Math.floor(heal));
}

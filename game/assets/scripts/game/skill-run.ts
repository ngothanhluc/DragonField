/**
 * Skills of one run: loadout + RNG roll + the 1-of-3 picker.
 *
 * Split from `bootstrap.ts` so run flow does not hold 4 loose fields (loadout,
 * rng, screen, choices) and so the rule "roll from the run seed, respect max stacks"
 * lives in one place. This file does not move between rooms — bootstrap still does that
 * after `choose()` returns.
 */
import { SkillLoadout, type AcquireResult } from '../core/skills/loadout';
import type { DerivedStats, StatsBaseline } from '../core/skills/derived-stats';
import { DEFAULT_COMBAT } from '../core/config';
import type { OwnedSkillStacks, SkillDef } from '../core/skills/pool';
import { rollChoices } from '../core/skills/roll';
import { SeededRng } from '../core/rng';
import { buildSkillPick, type SkillPickScreen } from './skill-pick';

type PickParent = Parameters<typeof buildSkillPick>[0];

export interface SkillPickResult {
  readonly def: SkillDef;
  readonly result: AcquireResult;
}

export interface SkillGrant {
  readonly acquired: boolean;
  readonly healNow: number;
  readonly stacks: number;
}

export class SkillRun {
  private loadout = new SkillLoadout();
  private rng = SeededRng.fromSeed(1);
  /** Baseline with meta upgrades added (M5); skills stack on top of it. */
  private base: StatsBaseline = DEFAULT_COMBAT;
  private screen: SkillPickScreen | null = null;
  private offered: readonly SkillDef[] | null = null;
  /** Bumped on every open/close to drop stale screen builds (fast room changes). */
  private token = 0;

  /** Start a new run: empty loadout, RNG from the run seed, baseline from meta. */
  reset(seed: number, base: StatsBaseline = DEFAULT_COMBAT): void {
    this.destroy();
    this.loadout = new SkillLoadout();
    this.rng = SeededRng.fromSeed(seed);
    this.base = base;
  }

  get entries(): OwnedSkillStacks[] {
    return this.loadout.entries;
  }

  get size(): number {
    return this.loadout.size;
  }

  stats(): DerivedStats {
    return this.loadout.stats(this.base);
  }

  snapshot(): ReadonlyMap<string, number> {
    return this.loadout.snapshot();
  }

  stacks(id: string): number {
    return this.loadout.stacks(id);
  }

  /** The 3 skills currently offered (ids), `null` when not on the picker. */
  get choices(): string[] | null {
    return this.offered === null ? null : this.offered.map((skill) => skill.id);
  }

  /** Roll cards with the run RNG; an exhausted pool returns fewer than 3 (even none). */
  roll(): SkillDef[] {
    return rollChoices({ rng: this.rng, owned: this.loadout.snapshot() });
  }

  /**
   * Build the picker. Keys are wired inside `buildSkillPick` before any await,
   * so hitting 1/2/3 on the opening frame still registers.
   */
  async open(parent: PickParent, choices: readonly SkillDef[], onPick: (index: number) => void): Promise<void> {
    this.offered = choices;
    const token = ++this.token;
    const screen = await buildSkillPick(parent, {
      choices,
      owned: this.loadout.snapshot(),
      onPick,
    });

    if (token !== this.token || this.offered === null) {
      screen.destroy();
      return;
    }
    this.screen = screen;
  }

  /**
   * Pick a card by index or id. Returns `null` when there is no picker / the card is wrong /
   * max stacks is reached. Does not move rooms by itself.
   */
  choose(indexOrId: number | string): SkillPickResult | null {
    const choices = this.offered;
    if (choices === null) return null;

    const index =
      typeof indexOrId === 'number'
        ? indexOrId
        : choices.findIndex((skill) => skill.id === indexOrId);
    const def = choices[index];
    if (def === undefined) return null;

    const result = this.loadout.acquire(def.id);
    if (!result.acquired) return null;

    this.offered = null;
    this.token += 1;
    this.screen?.destroy();
    this.screen = null;
    return { def, result };
  }

  /** Debug: take a skill outside the picker; returns the stack count after. */
  grant(id: string, stacks = 1): SkillGrant {
    const result = this.loadout.acquire(id, stacks);
    return { acquired: result.acquired, healNow: result.healNow, stacks: this.loadout.stacks(id) };
  }

  /** Close the picker (if open) and drop the current offer. */
  destroy(): void {
    this.token += 1;
    this.offered = null;
    this.screen?.destroy();
    this.screen = null;
  }
}

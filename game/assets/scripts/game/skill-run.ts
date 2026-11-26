/**
 * Skills of one run: loadout + RNG roll + the 1-of-3 picker.
 *
 * Split from `bootstrap.ts` so run flow does not hold 4 loose fields (loadout,
 * rng, screen, choices) and so the rule "roll from the run seed, respect max stacks"
 * lives in one place. This file does not move between rooms — bootstrap still does that
 * after `choose()` returns.
 */
import {
  DEFAULT_CHARACTER_ID,
  resolveSelectedCharacter,
  type CharacterId,
} from '../core/characters/roster';
import { DEFAULT_COMBAT } from '../core/config';
import {
  derivedStatsForRun,
  statsForRun,
  utilityStatsFromSave,
  type RunStatsSource,
} from '../core/meta/run-stats';
import { MAX_FREE_REROLLS_TRACK } from '../core/meta/upgrades';
import { SkillLoadout, type AcquireResult } from '../core/skills/loadout';
import type { DerivedStats, StatsBaseline } from '../core/skills/derived-stats';
import type { OwnedSkillStacks, SkillDef } from '../core/skills/pool';
import {
  createSkillRollRng,
  hasAlternativeSkills,
  rerollChoices,
  rollChoices,
} from '../core/skills/roll';
import { rerollCost } from '../core/xp/reroll';
import {
  buildSkillPick,
  type SkillPickRerollOptions,
  type SkillPickScreen,
} from './skill-pick';

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
  private rng = createSkillRollRng(1);
  /** Baseline with class + meta + passive stats added (M5/M14); skills stack on top of it. */
  private base: StatsBaseline = DEFAULT_COMBAT;
  private characterId: CharacterId = DEFAULT_CHARACTER_ID;
  private runSave: RunStatsSource | null = null;
  private screen: SkillPickScreen | null = null;
  private offered: readonly SkillDef[] | null = null;
  private rerolls = 0;
  /** Remaining free Meta Utility skill rerolls for this run (`0..MAX_FREE_REROLLS_TRACK`, M15). */
  private freeRerolls = 0;
  /** Bumped on every open/close to drop stale screen builds (fast room changes). */
  private token = 0;

  /** Start a new run: empty loadout, dedicated skill-roll sub-seed (ADR-021), baseline from meta. */
  reset(seed: number, base: StatsBaseline = DEFAULT_COMBAT, freeRerolls = 0): void {
    this.destroy();
    this.loadout = new SkillLoadout();
    this.rng = createSkillRollRng(seed);
    this.base = base;
    this.characterId = DEFAULT_CHARACTER_ID;
    this.runSave = null;
    this.rerolls = 0;
    this.setFreeRerollsLeft(freeRerolls);
  }

  /**
   * Start a new run for `characterId` + `save`: composes Layer 1 class base stats, permanent
   * Meta upgrades, Layer 2 class starting passive, and Meta Utility `freeRerolls` (M15).
   */
  resetForRun(seed: number, save: RunStatsSource, characterId?: CharacterId): void {
    const resolvedId = characterId ?? resolveSelectedCharacter(save).id;
    const utility = utilityStatsFromSave(save);
    this.reset(seed, statsForRun(save, resolvedId), utility.freeRerolls);
    this.characterId = resolvedId;
    this.runSave = save;
  }

  /**
   * Restore full skill loadout (base skills + Legendary Evolutions), class/meta baseline,
   * paid reroll counter, and remaining free rerolls from an `ActiveRunSave` or Endless carryover.
   */
  restoreForRun(args: {
    readonly seed: number;
    readonly save: RunStatsSource;
    readonly characterId: CharacterId;
    readonly ownedSkills: Readonly<Record<string, number>>;
    readonly rerollsUsed: number;
    readonly freeRerollsLeft: number;
  }): void {
    this.destroy();
    const map = new Map<string, number>();
    for (const [id, stacks] of Object.entries(args.ownedSkills)) {
      if (Number.isFinite(stacks) && stacks > 0) {
        map.set(id, Math.floor(stacks));
      }
    }
    this.loadout = SkillLoadout.from(map);
    this.rng = createSkillRollRng(args.seed);
    this.characterId = args.characterId;
    this.runSave = args.save;
    this.base = statsForRun(args.save, args.characterId);
    this.rerolls = Number.isFinite(args.rerollsUsed) ? Math.max(0, Math.floor(args.rerollsUsed)) : 0;
    this.setFreeRerollsLeft(args.freeRerollsLeft);
  }

  /** Debug helper: switch the active character baseline mid-run without resetting owned skills. */
  setCharacterForRun(save: RunStatsSource, characterId: CharacterId): void {
    this.characterId = characterId;
    this.runSave = save;
    this.base = statsForRun(save, characterId);
  }

  get activeCharacterId(): CharacterId {
    return this.characterId;
  }

  get entries(): OwnedSkillStacks[] {
    return this.loadout.entries;
  }

  get size(): number {
    return this.loadout.size;
  }

  get rerollsUsed(): number {
    return this.rerolls;
  }

  get freeRerollsLeft(): number {
    return this.freeRerolls;
  }

  setFreeRerollsLeft(count: number): void {
    if (!Number.isFinite(count) || count <= 0) {
      this.freeRerolls = 0;
      return;
    }
    this.freeRerolls = Math.min(MAX_FREE_REROLLS_TRACK, Math.floor(count));
  }

  /** Gold cost of the next reroll: `0` while free Meta rerolls remain, else normal paid ramp. */
  nextRerollCost(): number {
    return this.freeRerolls > 0 ? 0 : rerollCost(this.rerolls);
  }

  stats(): DerivedStats {
    if (this.runSave !== null) {
      return derivedStatsForRun(this.runSave, this.loadout.snapshot(), this.characterId);
    }
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

  /** Whether at least one eligible skill outside the current offer remains for Gold Reroll. */
  hasAlternatives(): boolean {
    if (this.offered === null) return false;
    return hasAlternativeSkills(this.loadout.snapshot(), this.offered);
  }

  /** Roll cards with the dedicated skill-roll RNG; an exhausted pool returns fewer than 3. */
  roll(): SkillDef[] {
    return rollChoices({ rng: this.rng, owned: this.loadout.snapshot() });
  }

  /**
   * Reroll the current offered cards via `rerollChoices`, avoiding `offered` IDs whenever fresh
   * skills exist. While `freeRerollsLeft > 0`, decrements free rerolls without advancing the paid
   * `rerollsUsed` cost ramp (M15); otherwise increments `rerollsUsed`. Returns `null` when no
   * picker is active or no skills can be rolled.
   */
  reroll(): SkillDef[] | null {
    if (this.offered === null) return null;
    const next = rerollChoices({
      rng: this.rng,
      owned: this.loadout.snapshot(),
      previous: this.offered,
    });
    if (next.length === 0) return null;
    if (this.freeRerolls > 0) {
      this.freeRerolls -= 1;
    } else {
      this.rerolls += 1;
    }
    return next;
  }

  /**
   * Build the picker. Always tears down any previous picker first so rerolls never leak listeners
   * or nodes. Keys are wired inside `buildSkillPick` before any await, so hitting 1/2/3/R on the
   * opening frame still registers.
   */
  async open(
    parent: PickParent,
    choices: readonly SkillDef[],
    onPick: (index: number) => void,
    reroll?: SkillPickRerollOptions,
  ): Promise<void> {
    this.screen?.destroy();
    this.screen = null;
    this.offered = choices;
    const token = ++this.token;
    const screen = await buildSkillPick(parent, {
      choices,
      owned: this.loadout.snapshot(),
      onPick,
      ...(reroll !== undefined ? { reroll } : {}),
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
    this.rerolls = 0;
    this.freeRerolls = 0;
    this.screen?.destroy();
    this.screen = null;
  }
}

/**
 * Pure hook seam for class-exclusive skills (M20, ADR-027).
 *
 * Ticket #83 registers the 16 class skills + 4 Class Evolutions as **data only**: the mechanics
 * land in tickets #84–#87, one per class. Each of those tickets implements its own hooks in its
 * own `classes/<id>.ts` file, so no mechanic work has to touch a shared dispatcher or call site.
 *
 * The context carries only what a mechanic can need at an event:
 * - `owned` reads the live stack count of any skill/Evolution id (no Map copy per frame),
 * - `shotCount` is the 1-based auto-fire counter (on-shot effects like "every 3rd shot"),
 * - `position` is the event origin in room tiles (y down), `targetPosition` the victim if any,
 * - `elite` marks an Elite kill, `dtMs` is the game-time step for periodic ticks,
 * - `rng` is the run RNG for deterministic proc rolls.
 *
 * Every hook returns effect requests the calling combat loop applies; a class with nothing owned
 * returns the shared empty array, so the seam stays allocation-free.
 */
import type { CharacterId } from '../characters/roster';
import type { Vec2 } from '../math/vec2';
import type { SeededRng } from '../rng';
import type { EvolutionDef } from './evolutions';

/** Read-only stack accessor so hooks never copy the loadout map (hot-path friendly). */
export type ClassSkillStackSource = (id: string) => number;

/** Everything a class hook may inspect for one event. */
export interface ClassSkillEventContext {
  readonly characterId: CharacterId;
  readonly owned: ClassSkillStackSource;
  /** 1-based count of auto-fire shots since the run started. */
  readonly shotCount?: number;
  /** Game-time step of a periodic tick, ms. */
  readonly dtMs?: number;
  /** Event origin in room tiles (y down). */
  readonly position?: Vec2;
  /** Victim/target position when the event has one. */
  readonly targetPosition?: Vec2;
  readonly elite?: boolean;
  /**
   * On `onKill`, the `skillId` of the class effect that dealt the killing blow (M20, #84).
   * `undefined` means the player's weapon or anything else (a DoT tick, contact thorns, …).
   */
  readonly killedBy?: string;
  readonly rng?: SeededRng;
}

/**
 * One requested gameplay effect. The class that requested it fills the fields its mechanic needs
 * and the calling loop (headless sim / Cocos combat loop) applies it.
 */
export interface ClassSkillEffect {
  readonly kind: 'damage' | 'spawn' | 'status' | 'heal' | 'buff';
  readonly skillId: string;
  readonly position: Vec2;
  readonly amount?: number;
  readonly radiusTiles?: number;
  readonly durationMs?: number;
  /**
   * The spawned thing's shots always crit (M20, #84; used by *Ảnh Sát Tuyệt Kỹ* clones).
   * Additive optional field: sibling class tickets may add their own, none may rename.
   */
  readonly crit?: boolean;
}

/** Event names a class implements (one hook per combat site, dispatched once from the loop). */
export const CLASS_SKILL_EVENTS = ['onShot', 'onHit', 'onKill', 'onDash', 'onActive', 'tick'] as const;

export type ClassSkillEventName = (typeof CLASS_SKILL_EVENTS)[number];

export type ClassSkillHook = (context: ClassSkillEventContext) => readonly ClassSkillEffect[];

/** All six hooks, mandatory so every class ticket has a place for every event. */
export type ClassSkillHooks = Readonly<Record<ClassSkillEventName, ClassSkillHook>>;

/** Shared empty result: keeps the no-op path free of per-frame array allocation. */
export const NO_CLASS_SKILL_EFFECTS: readonly ClassSkillEffect[] = [];

/** A Legendary Class Evolution: a shared `EvolutionDef` owned by exactly one character. */
export interface ClassEvolutionDef extends EvolutionDef {
  readonly characterId: CharacterId;
}

/** Code-drawn pick-card crest: a per-class colour plus a 1–2 character glyph. */
export interface ClassCrest {
  /** `#RRGGBB`, converted by the UI adapter (no engine type in `core/`). */
  readonly color: string;
  readonly glyph: string;
}

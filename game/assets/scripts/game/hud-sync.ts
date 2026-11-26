/**
 * Event-driven combat → HUD synchronization (M11 T4).
 *
 * `bootstrap` calls `syncCombatHud` at state boundaries and during the combat loop; this module
 * tracks the last applied `CombatHudSnapshot` per `Hud` instance (`diffCombatHudSnapshot`) and
 * forwards only real state transitions, avoiding per-frame wrapper allocations and redundant label
 * or transform updates.
 */
import {
  diffCombatHudSnapshot,
  type CombatHudSnapshot,
} from '../core/view/hud-layout';
import type { CombatLoop } from './combat-loop';
import type { Hud } from './hud';
import type { PlayerController } from './player-controller';

/** Minimal HUD surface driven by `syncCombatHud` (easy to spy/stub in unit tests). */
export interface CombatHudTarget {
  readonly activeBossName?: string | null;
  setMaxHearts(maxHearts: number): void;
  setHearts(hearts: number): void;
  setEnemiesLeft(count: number | null): void;
  setBossState(name: string | null, hp: number, maxHp: number, phase: number): void;
}

const lastSnapshots = new WeakMap<CombatHudTarget, CombatHudSnapshot>();

function syncedSnapshot(hud: CombatHudTarget): CombatHudSnapshot | null {
  const prev = lastSnapshots.get(hud);
  if (prev === undefined) return null;
  if (hud.activeBossName !== undefined && prev.bossName !== hud.activeBossName) {
    return null;
  }
  return prev;
}

/** Apply `next` to `hud` only for fields that actually changed since the last sync on `hud`. */
export function applyCombatHudSnapshot(hud: CombatHudTarget, next: CombatHudSnapshot): void {
  const prev = syncedSnapshot(hud);
  const diff = diffCombatHudSnapshot(prev, next);
  if (
    !diff.maxHeartsChanged &&
    !diff.heartsChanged &&
    !diff.enemiesLeftChanged &&
    !diff.bossChanged
  ) {
    return;
  }

  lastSnapshots.set(hud, next);
  if (diff.maxHeartsChanged) hud.setMaxHearts(next.maxHearts);
  if (diff.heartsChanged) hud.setHearts(next.hearts);
  if (diff.enemiesLeftChanged) hud.setEnemiesLeft(next.enemiesLeft);
  if (diff.bossChanged) {
    hud.setBossState(next.bossName, next.bossHp, next.bossMaxHp, next.bossPhase);
  }
}

export function syncCombatHud(
  hud: Hud,
  player: PlayerController,
  combat: CombatLoop | null,
): void {
  const boss = combat?.bossSnapshot() ?? null;
  const prev = syncedSnapshot(hud);

  const maxHearts = player.maxHearts;
  const hearts = player.hearts;
  const enemiesLeft = combat?.enemiesLeft ?? null;
  const bossName = boss === null ? null : boss.name;
  const bossHp = boss === null ? 0 : boss.health;
  const bossMaxHp = boss === null ? 0 : boss.maxHealth;
  const bossPhase = boss === null ? 0 : boss.phase;

  // Fast path: when nothing changed, return immediately without allocating a new snapshot object.
  if (
    prev !== null &&
    prev.maxHearts === maxHearts &&
    prev.hearts === hearts &&
    prev.enemiesLeft === enemiesLeft &&
    prev.bossName === bossName &&
    prev.bossHp === bossHp &&
    prev.bossMaxHp === bossMaxHp &&
    prev.bossPhase === bossPhase
  ) {
    return;
  }

  applyCombatHudSnapshot(hud, {
    maxHearts,
    hearts,
    enemiesLeft,
    bossName,
    bossHp,
    bossMaxHp,
    bossPhase,
  });
}

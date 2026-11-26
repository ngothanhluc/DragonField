/**
 * Event-driven combat → HUD synchronization (M11 T4 + M12 T2 + M13 T1).
 *
 * `bootstrap` calls `syncCombatHud` at state boundaries and during the combat loop; this module
 * tracks the last applied `CombatHudSnapshot` per `Hud` instance (`diffCombatHudSnapshot`) and
 * forwards only real state transitions, avoiding per-frame wrapper allocations and redundant label
 * or transform updates.
 */
import {
  diffCombatHudSnapshot,
  hasSnapshotActions,
  hasSnapshotXp,
  snapshotActiveCooldownSec,
  snapshotActiveReadyRatio,
  snapshotDashCooldownSec,
  snapshotDashReadyRatio,
  snapshotXpCurrent,
  snapshotXpLevel,
  snapshotXpRequired,
  type CombatHudSnapshot,
  type HudActionsSnapshot,
  type HudXpSnapshot,
} from '../core/view/hud-layout';
import type { CombatLoop } from './combat-loop';
import type { Hud } from './hud';
import type { PlayerController } from './player-controller';

/** Minimal HUD surface driven by `syncCombatHud` (easy to spy/stub in unit tests). */
export interface CombatHudTarget {
  readonly activeBossName?: string | null;
  readonly activeXpLevel?: number;
  readonly activeXpCurrent?: number;
  readonly activeXpRequired?: number;
  readonly activeDashReadyRatio?: number;
  readonly activeDashCooldownSec?: number;
  readonly activeSkillReadyRatio?: number;
  readonly activeSkillCooldownSec?: number;
  setMaxHearts(maxHearts: number): void;
  setHearts(hearts: number): void;
  setEnemiesLeft(count: number | null): void;
  setBossState(name: string | null, hp: number, maxHp: number, phase: number): void;
  setXp?(level: number, currentXp: number, requiredXp: number): void;
  setActions?(
    dashReadyRatio: number,
    dashCooldownSec: number,
    activeReadyRatio: number,
    activeCooldownSec: number,
  ): void;
}

const lastSnapshots = new WeakMap<CombatHudTarget, CombatHudSnapshot>();

function isBossDesynced(hud: CombatHudTarget, prev: CombatHudSnapshot): boolean {
  return hud.activeBossName !== undefined && prev.bossName !== hud.activeBossName;
}

function isXpDesynced(hud: CombatHudTarget, prev: CombatHudSnapshot): boolean {
  if (!hasSnapshotXp(prev)) return false;
  return (
    (hud.activeXpLevel !== undefined && !Object.is(snapshotXpLevel(prev), hud.activeXpLevel)) ||
    (hud.activeXpCurrent !== undefined &&
      !Object.is(snapshotXpCurrent(prev), hud.activeXpCurrent)) ||
    (hud.activeXpRequired !== undefined &&
      !Object.is(snapshotXpRequired(prev), hud.activeXpRequired))
  );
}

function isActionsDesynced(hud: CombatHudTarget, prev: CombatHudSnapshot): boolean {
  if (!hasSnapshotActions(prev)) return false;
  return (
    (hud.activeDashReadyRatio !== undefined &&
      !Object.is(snapshotDashReadyRatio(prev), hud.activeDashReadyRatio)) ||
    (hud.activeDashCooldownSec !== undefined &&
      !Object.is(snapshotDashCooldownSec(prev), hud.activeDashCooldownSec)) ||
    (hud.activeSkillReadyRatio !== undefined &&
      !Object.is(snapshotActiveReadyRatio(prev), hud.activeSkillReadyRatio)) ||
    (hud.activeSkillCooldownSec !== undefined &&
      !Object.is(snapshotActiveCooldownSec(prev), hud.activeSkillCooldownSec))
  );
}

/** Apply `next` to `hud` only for fields that actually changed since the last sync on `hud`. */
export function applyCombatHudSnapshot(hud: CombatHudTarget, next: CombatHudSnapshot): void {
  const prev = lastSnapshots.get(hud) ?? null;
  const diff = diffCombatHudSnapshot(prev, next);
  const bossChanged = diff.bossChanged || (prev !== null && isBossDesynced(hud, prev));
  const xpChanged =
    diff.xpChanged || (prev !== null && hasSnapshotXp(next) && isXpDesynced(hud, prev));
  const actionsChanged =
    diff.actionsChanged ||
    (prev !== null && hasSnapshotActions(next) && isActionsDesynced(hud, prev));

  if (
    !diff.maxHeartsChanged &&
    !diff.heartsChanged &&
    !diff.enemiesLeftChanged &&
    !bossChanged &&
    !xpChanged &&
    !actionsChanged
  ) {
    return;
  }

  lastSnapshots.set(hud, next);
  if (diff.maxHeartsChanged) hud.setMaxHearts(next.maxHearts);
  if (diff.heartsChanged) hud.setHearts(next.hearts);
  if (diff.enemiesLeftChanged) hud.setEnemiesLeft(next.enemiesLeft);
  if (bossChanged) {
    hud.setBossState(next.bossName, next.bossHp, next.bossMaxHp, next.bossPhase);
  }
  if (xpChanged && hasSnapshotXp(next)) {
    hud.setXp?.(snapshotXpLevel(next), snapshotXpCurrent(next), snapshotXpRequired(next));
  }
  if (actionsChanged && hasSnapshotActions(next)) {
    hud.setActions?.(
      snapshotDashReadyRatio(next),
      snapshotDashCooldownSec(next),
      snapshotActiveReadyRatio(next),
      snapshotActiveCooldownSec(next),
    );
  }
}

export function syncCombatHud(
  hud: Hud,
  player: PlayerController,
  combat: CombatLoop | null,
  xp?: HudXpSnapshot | null,
  actions?: HudActionsSnapshot | null,
): void {
  const boss = combat?.bossSnapshot() ?? null;
  const prev = lastSnapshots.get(hud) ?? null;

  const maxHearts = player.maxHearts;
  const hearts = player.hearts;
  const enemiesLeft = combat?.enemiesLeft ?? null;
  const bossName = boss === null ? null : boss.name;
  const bossHp = boss === null ? 0 : boss.health;
  const bossMaxHp = boss === null ? 0 : boss.maxHealth;
  const bossPhase = boss === null ? 0 : boss.phase;
  const hasXp = xp !== undefined && xp !== null;
  const hasActions = actions !== undefined && actions !== null;

  // Fast path: when nothing changed, return immediately without allocating a new snapshot object.
  if (
    prev !== null &&
    !isBossDesynced(hud, prev) &&
    (!hasXp || !isXpDesynced(hud, prev)) &&
    (!hasActions || !isActionsDesynced(hud, prev)) &&
    prev.maxHearts === maxHearts &&
    prev.hearts === hearts &&
    prev.enemiesLeft === enemiesLeft &&
    prev.bossName === bossName &&
    prev.bossHp === bossHp &&
    prev.bossMaxHp === bossMaxHp &&
    prev.bossPhase === bossPhase &&
    hasSnapshotXp(prev) === hasXp &&
    (!hasXp ||
      (Object.is(snapshotXpLevel(prev), xp.level) &&
        Object.is(snapshotXpCurrent(prev), xp.current) &&
        Object.is(snapshotXpRequired(prev), xp.required))) &&
    hasSnapshotActions(prev) === hasActions &&
    (!hasActions ||
      (Object.is(snapshotDashReadyRatio(prev), actions.dashReadyRatio) &&
        Object.is(snapshotDashCooldownSec(prev), actions.dashCooldownSec) &&
        Object.is(snapshotActiveReadyRatio(prev), actions.activeReadyRatio) &&
        Object.is(snapshotActiveCooldownSec(prev), actions.activeCooldownSec)))
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
    ...(hasXp
      ? {
          xpLevel: xp.level,
          xpCurrent: xp.current,
          xpRequired: xp.required,
        }
      : {}),
    ...(hasActions
      ? {
          actions: {
            dashReadyRatio: actions.dashReadyRatio,
            dashCooldownSec: actions.dashCooldownSec,
            activeReadyRatio: actions.activeReadyRatio,
            activeCooldownSec: actions.activeCooldownSec,
          },
        }
      : {}),
  });
}

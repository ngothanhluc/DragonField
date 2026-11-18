/**
 * Spawn enemies per wave from room data (GDD §8: waves live in `LevelData`).
 *
 * `waveIndex` is a **0-based index** into `level.waves`, matching
 * `nextWaveIndex`. Enemy ids are deterministic — `r<room>-w<wave>-e<n>` — so tests,
 * logs and save/replay can compare without relying on spawn order.
 */
import type { LevelData } from '../level/level-data';
import { maxHealthFor, type EnemyState } from './behaviours';

/** Deterministic id of one enemy inside a wave. */
export function enemyId(room: number, waveIndex: number, enemyIndex: number): string {
  return `r${room}-w${waveIndex}-e${enemyIndex}`;
}

/**
 * Enemies of wave `waveIndex`, with elite scaling already applied. New enemies stand still
 * (`idle`) and wait out the cooldown before their first attack — see `behaviours.ts`.
 */
export function spawnWave(level: LevelData, waveIndex: number): EnemyState[] {
  const wave = level.waves[waveIndex];
  if (wave === undefined) {
    throw new Error(
      `Room ${level.id} has no wave ${waveIndex} (only ${level.waves.length} wave(s))`,
    );
  }

  return wave.enemies.map((enemy, index): EnemyState => {
    const maxHealth = maxHealthFor(enemy.role, enemy.elite, undefined, level.chapter);
    return {
      id: enemyId(level.room, waveIndex, index),
      role: enemy.role,
      elite: enemy.elite,
      position: { x: enemy.at.x, y: enemy.at.y },
      health: maxHealth,
      maxHealth,
      action: { kind: 'idle' },
      actionStartedMs: 0,
    };
  });
}

/** A wave is clear when every enemy is dead (health <= 0 or action `dead`). */
export function isWaveCleared(states: readonly EnemyState[]): boolean {
  return states.every((state) => state.health <= 0 || state.action.kind === 'dead');
}

/** Index of the next wave, or `null` when the room's last wave is done. */
export function nextWaveIndex(current: number, level: LevelData): number | null {
  if (!Number.isInteger(current) || current < 0) {
    throw new Error(`waveIndex must be an integer >= 0, got ${current}`);
  }

  const next = current + 1;
  return next < level.waves.length ? next : null;
}

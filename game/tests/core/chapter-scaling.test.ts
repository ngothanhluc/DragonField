import { describe, expect, it } from 'vitest';
import {
  contactDamageFor,
  maxHealthFor,
} from '../../assets/scripts/core/enemies/behaviours';
import { parseTuning } from '../../assets/scripts/core/enemies/tuning-schema';
import { TUNING_SOURCE } from '../../assets/scripts/core/enemies/tuning';
import { spawnWave } from '../../assets/scripts/core/enemies/waves';
import { parseLevelData } from '../../assets/scripts/core/level/level-data';

const HEALTH = [1, 1.05, 1.05, 1.1];

function roomForChapter(chapter: number) {
  return parseLevelData({
    id: `scale-${chapter}`,
    chapter,
    room: 1,
    isBossRoom: false,
    size: { cols: 32, rows: 18 },
    tileSizePx: 16,
    playerStart: { x: 16, y: 16 },
    waves: [
      {
        enemies: [
          { role: 'chaser', at: { x: 4, y: 4 }, elite: false },
          { role: 'caster', at: { x: 8, y: 4 }, elite: false },
          { role: 'tank', at: { x: 12, y: 4 }, elite: false },
        ],
      },
    ],
    obstacles: [],
    doors: [],
  });
}

describe('chapter scaling', () => {
  it('enemy health rises per chapter by the factors in tuning.json', () => {
    for (const role of ['chaser', 'caster', 'tank'] as const) {
      for (const chapter of [1, 2, 3, 4]) {
        const base = maxHealthFor(role, false);
        const scaled = maxHealthFor(role, false, undefined, chapter);
        expect(scaled, `${role} chapter ${chapter}`).toBe(
          Math.max(1, Math.round(base * (HEALTH[chapter - 1] ?? 1))),
        );
      }
    }
  });

  it('enemy damage does not scale per chapter (difficulty comes from count/elites)', () => {
    for (const chapter of [1, 2, 3, 4]) {
      expect(contactDamageFor('tank', false, undefined, chapter)).toBe(2);
      expect(contactDamageFor('chaser', false, undefined, chapter)).toBe(1);
    }
  });

  it('spawnWave uses the room chapter, not a constant', () => {
    const chapterOne = spawnWave(roomForChapter(1), 0);
    const chapterThree = spawnWave(roomForChapter(3), 0);

    expect(chapterOne.map((enemy) => enemy.maxHealth)).toEqual([6, 4, 10]);
    expect(chapterThree.map((enemy) => enemy.maxHealth)).toEqual([
      Math.round(6 * 1.05),
      Math.round(4 * 1.05),
      Math.round(10 * 1.05),
    ]);
  });

  it('the validator rejects a scale array of the wrong length or <= 0', () => {
    const raw = JSON.parse(JSON.stringify(TUNING_SOURCE)) as {
      chapters: { enemyHealthMultipliers: number[] };
    };
    raw.chapters.enemyHealthMultipliers = [1, 1.2];
    expect(() => parseTuning(raw)).toThrow(/exactly 4 elements|4 elements/);

    const negative = JSON.parse(JSON.stringify(TUNING_SOURCE)) as {
      chapters: { enemyDamageMultipliers: number[] };
    };
    negative.chapters.enemyDamageMultipliers = [1, 0, 1];
    expect(() => parseTuning(negative)).toThrow(/finite number > 0/);
  });
});

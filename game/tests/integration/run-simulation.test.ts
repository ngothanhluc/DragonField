import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_COMBAT } from '../../assets/scripts/core/config';
import { CHASER_CONTACT_RANGE_TILES } from '../../assets/scripts/core/enemies/behaviours';
import {
  ROOM_COLS,
  ROOM_ROWS,
  parseChapterData,
  parseLevelData,
  type ChapterData,
  type LevelData,
} from '../../assets/scripts/core/level/level-data';
import { ROOMS_PER_CHAPTER } from '../../assets/scripts/core/run/run-state';
import {
  MAX_GOLD,
  applyGold,
  goldForRoomClear,
  summariseRun,
} from '../../assets/scripts/core/run/rewards';
import { createDefaultSave } from '../../assets/scripts/core/save/save-data';
import { MemorySaveStorage, SaveRepository } from '../../assets/scripts/core/save/storage';
import {
  SIM_DEFAULT_MAX_DURATION_MS,
  simulateRun,
  type InputPolicy,
  type PolicyWorld,
} from '../../assets/scripts/core/sim/run-simulation';

const here = dirname(fileURLToPath(import.meta.url));
const chapterFile = join(here, '../../assets/data/levels/chapter-1.json');

function loadChapterOne(): ChapterData {
  return parseChapterData(JSON.parse(readFileSync(chapterFile, 'utf8')));
}

const chapterOne = loadChapterOne();

/** Không bấm phím nào: dùng cho cả god-mode và player "đứng yên". */
const standStill: InputPolicy = () => ({ up: false, down: false, left: false, right: false });

/** Đi tuần vòng quanh phòng theo thời gian — tất định, không cần né giỏi. */
const patrol: InputPolicy = ({ nowMs }) => {
  const phase = Math.floor(nowMs / 700) % 4;
  return {
    up: phase === 0,
    down: phase === 2,
    left: phase === 3,
    right: phase === 1,
  };
};

/**
 * Policy né: mỗi frame chọn 1 trong 8 hướng, hướng nào giữ **khoảng cách nhỏ
 * nhất tới địch trên cả quãng đường 1.2 s** lớn nhất thì đi. Khác "chạy thẳng
 * ra xa địch gần nhất" ở chỗ nó nhìn cả đường đi, nên không tự dồn mình vào
 * góc phòng — đúng lỗi làm policy ngây thơ chết sớm hơn cả đứng yên.
 *
 * Đây là policy test, không phải AI của game: nó chỉ đọc `PolicyWorld`.
 */
const DODGE_DIRECTIONS = [
  { x: 0, y: -1, up: true, down: false, left: false, right: false },
  { x: 0, y: 1, up: false, down: true, left: false, right: false },
  { x: -1, y: 0, up: false, down: false, left: true, right: false },
  { x: 1, y: 0, up: false, down: false, left: false, right: true },
  { x: -Math.SQRT1_2, y: -Math.SQRT1_2, up: true, down: false, left: true, right: false },
  { x: Math.SQRT1_2, y: -Math.SQRT1_2, up: true, down: false, left: false, right: true },
  { x: -Math.SQRT1_2, y: Math.SQRT1_2, up: false, down: true, left: true, right: false },
  { x: Math.SQRT1_2, y: Math.SQRT1_2, up: false, down: true, left: false, right: true },
] as const;

const DODGE_HORIZON_SECONDS = 1.2;
const DODGE_SAMPLES = 8;
const MIN_X = 0.5;
const MIN_Y = 0.5;
const MAX_X = ROOM_COLS - 0.5;
const MAX_Y = ROOM_ROWS - 0.5;

function makeDodgePolicy(): InputPolicy {
  let lastIndex = 0;

  return (world: PolicyWorld) => {
    const alive = world.enemies.filter(
      (enemy) => enemy.health > 0 && enemy.action.kind !== 'dead',
    );
    const enemyShots = world.bullets.filter((bullet) => bullet.owner === 'enemy');
    const speed = DEFAULT_COMBAT.moveSpeedTilesPerSecond;

    let bestIndex = lastIndex;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < DODGE_DIRECTIONS.length; index += 1) {
      const direction = DODGE_DIRECTIONS[index];
      if (direction === undefined) continue;

      let score = Number.POSITIVE_INFINITY;

      for (let sample = 1; sample <= DODGE_SAMPLES; sample += 1) {
        const seconds = (sample / DODGE_SAMPLES) * DODGE_HORIZON_SECONDS;
        const rawX = world.player.x + direction.x * speed * seconds;
        const rawY = world.player.y + direction.y * speed * seconds;
        const x = Math.min(Math.max(rawX, MIN_X), MAX_X);
        const y = Math.min(Math.max(rawY, MIN_Y), MAX_Y);

        let gap = Number.POSITIVE_INFINITY;
        for (const enemy of alive) {
          gap = Math.min(gap, Math.hypot(x - enemy.position.x, y - enemy.position.y));
        }
        for (const bullet of enemyShots) {
          const bx = bullet.position.x + bullet.velocity.x * seconds;
          const by = bullet.position.y + bullet.velocity.y * seconds;
          gap = Math.min(gap, Math.hypot(x - bx, y - by) * 1.25);
        }

        // Bị tường chặn thì quãng đường thực ngắn hơn — coi như tệ hơn.
        const blocked = Math.hypot(x - rawX, y - rawY);
        score = Math.min(score, gap - blocked * 2);
      }

      if (index === lastIndex) score += 0.3;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    lastIndex = bestIndex;
    const chosen = DODGE_DIRECTIONS[bestIndex];
    if (chosen === undefined) return standStill(world);

    return { up: chosen.up, down: chosen.down, left: chosen.left, right: chosen.right };
  };
}

/** 9 phòng × (thời gian đi bộ tới chỗ bắn + TTK) — biên rộng để không flaky. */
const CHAPTER_CLEAR_MIN_MS = 60_000;
const CHAPTER_CLEAR_MAX_MS = 180_000;
/** Phòng 1 một mình, god-mode, không skill — đo nhịp dọn phòng. */
const ROOM_ONE_CLEAR_MIN_MS = 15_000;
const ROOM_ONE_CLEAR_MAX_MS = 60_000;

describe('simulateRun — god mode dọn chapter 1', () => {
  const result = simulateRun({
    seed: 7,
    level: chapterOne,
    policy: standStill,
    godMode: true,
    maxDurationMs: SIM_DEFAULT_MAX_DURATION_MS,
  });

  it('thắng sau 9 phòng và không nhận sát thương', () => {
    expect(result.status).toBe('won');
    expect(result.roomsCleared).toBe(ROOMS_PER_CHAPTER);
    expect(result.events.filter((event) => event.kind === 'room-cleared')).toHaveLength(
      ROOMS_PER_CHAPTER,
    );
    expect(result.events.some((event) => event.kind === 'player-hit')).toBe(false);
  });

  it('thời gian nằm trong biên hợp lý (không treo, không tức thời)', () => {
    expect(result.durationMs).toBeGreaterThanOrEqual(CHAPTER_CLEAR_MIN_MS);
    expect(result.durationMs).toBeLessThanOrEqual(CHAPTER_CLEAR_MAX_MS);
  });

  it('vàng cộng đúng từ event giết địch và dọn phòng', () => {
    const fromEvents = result.events.reduce((sum, event) => {
      if (event.kind === 'kill' || event.kind === 'room-cleared') return sum + event.gold;
      return sum;
    }, 0);
    const expectedRoomGold =
      (ROOMS_PER_CHAPTER - 1) * goldForRoomClear(false) + goldForRoomClear(true);

    expect(result.goldEarned).toBe(fromEvents);
    expect(result.goldEarned).toBeGreaterThanOrEqual(expectedRoomGold);
    expect(result.kills).toBeGreaterThan(0);
  });
});

/**
 * Phòng dựng tay có chaser spawn sát player: đo i-frame và luồng thua mà không
 * phụ thuộc balance của chapter 1. Cùng schema `LevelData`, cùng
 * `behaviours`/`waves` — chỉ khác vị trí spawn.
 */
function meleeRoom(roomNumber: number): LevelData {
  return parseLevelData({
    id: `melee-r${roomNumber}`,
    chapter: 1,
    room: roomNumber,
    isBossRoom: false,
    size: { cols: 32, rows: 18 },
    tileSizePx: 16,
    playerStart: { x: 16, y: 16 },
    waves: [
      {
        enemies: [
          { role: 'chaser', at: { x: 16, y: 14.5 }, elite: false },
          { role: 'chaser', at: { x: 17.5, y: 16 }, elite: false },
          { role: 'chaser', at: { x: 14.5, y: 16 }, elite: false },
          { role: 'chaser', at: { x: 16, y: 17.5 }, elite: false },
        ],
      },
    ],
    obstacles: [],
    doors: [],
  });
}

const meleeChapter: ChapterData = {
  chapter: 1,
  rooms: [meleeRoom(1), meleeRoom(2), meleeRoom(3)],
};

describe('simulateRun — player đứng yên', () => {
  const result = simulateRun({ seed: 11, level: meleeChapter, policy: standStill });

  it('chết trong 3 phòng đầu', () => {
    expect(result.status).toBe('lost');
    expect(result.roomsCleared).toBeLessThan(3);
    expect(result.events.some((event) => event.kind === 'run-lost')).toBe(true);
  });

  it('i-frame 0.8 s được tôn trọng giữa hai lần trúng đòn', () => {
    const hitTimes = result.events.flatMap((event) =>
      event.kind === 'player-hit' ? [event.nowMs] : [],
    );

    expect(hitTimes.length).toBeGreaterThan(1);
    for (let index = 1; index < hitTimes.length; index += 1) {
      const previous = hitTimes[index - 1];
      const current = hitTimes[index];
      if (previous === undefined || current === undefined) continue;
      expect(current - previous).toBeGreaterThanOrEqual(DEFAULT_COMBAT.invulnerabilityMs);
    }
  });

  it('summary vẫn đúng shape và sạch số liệu', () => {
    // Màn hình kết quả coi timeout là thua; `summariseRun` chỉ biết RunStatus.
    const status = result.status === 'won' ? 'won' : 'lost';
    const summary = summariseRun({
      roomsCleared: result.roomsCleared,
      kills: result.kills,
      goldEarned: result.goldEarned,
      durationMs: result.durationMs,
      status,
    });

    expect(summary).toEqual({
      status: 'lost',
      roomsCleared: result.roomsCleared,
      kills: result.kills,
      goldEarned: result.goldEarned,
      durationMs: result.durationMs,
      durationSeconds: Math.round(result.durationMs / 100) / 10,
      won: false,
      roomLabel: `${result.roomsCleared}/${ROOMS_PER_CHAPTER}`,
    });
    expect(summary.goldEarned).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(summary.durationSeconds)).toBe(true);
  });
});

describe('simulateRun — determinism', () => {
  it('cùng seed + cùng policy cho cùng kết quả', () => {
    const first = simulateRun({
      seed: 4242,
      level: chapterOne,
      policy: patrol,
      godMode: true,
    });
    const second = simulateRun({
      seed: 4242,
      level: chapterOne,
      policy: patrol,
      godMode: true,
    });

    expect({
      status: second.status,
      roomsCleared: second.roomsCleared,
      kills: second.kills,
      goldEarned: second.goldEarned,
    }).toEqual({
      status: first.status,
      roomsCleared: first.roomsCleared,
      kills: first.kills,
      goldEarned: first.goldEarned,
    });
    expect(second.events).toEqual(first.events);
  });

  it('seed khác chỉ đổi chi tiết ngẫu nhiên, không đổi luật chơi', () => {
    const a = simulateRun({ seed: 1, level: chapterOne, policy: standStill, godMode: true });
    const b = simulateRun({ seed: 2, level: chapterOne, policy: standStill, godMode: true });

    expect(a.status).toBe('won');
    expect(b.status).toBe('won');
    expect(a.roomsCleared).toBe(b.roomsCleared);
  });
});

describe('simulateRun — balance phòng 1', () => {
  it('trung bình 20 seed nằm trong khoảng đã ghi nhận', () => {
    const singleRoom: ChapterData = { chapter: 1, rooms: chapterOne.rooms.slice(0, 1) };
    const times: number[] = [];

    for (let seed = 0; seed < 20; seed += 1) {
      const result = simulateRun({ seed, level: singleRoom, policy: standStill, godMode: true });
      expect(result.status).toBe('won');
      expect(result.roomsCleared).toBe(1);
      times.push(result.durationMs);
    }

    const average = times.reduce((sum, value) => sum + value, 0) / times.length;
    expect(average).toBeGreaterThanOrEqual(ROOM_ONE_CLEAR_MIN_MS);
    expect(average).toBeLessThanOrEqual(ROOM_ONE_CLEAR_MAX_MS);
  });
});

/**
 * Balance của chapter 1, đo bằng chính simulation:
 *
 * - Đứng yên **phải thua**: nếu không, game không có gameplay (defect gốc).
 * - Né **phải sống lâu hơn đáng kể**: đây là bằng chứng đòn còn né được, chứ
 *   không phải enemy one-shot.
 * - Caster phải bắn được ít nhất một phát trước khi chết, nếu không thì
 *   "telegraph rồi bắn" chỉ là code chết.
 * - Ít nhất một enemy phải tiếp cận được tầm chạm khi player đứng yên, nếu
 *   không thì melee không bao giờ là mối đe doạ.
 */
const BALANCE_SEEDS = [1, 7, 42];

describe('simulateRun — balance chapter 1', () => {
  it('player đứng yên thua trong 3 phòng đầu', () => {
    for (const seed of BALANCE_SEEDS) {
      const result = simulateRun({ seed, level: chapterOne, policy: standStill });

      expect(result.status, `seed ${seed}`).toBe('lost');
      expect(result.roomsCleared, `seed ${seed}`).toBeLessThan(3);
      expect(result.events.some((event) => event.kind === 'run-lost')).toBe(true);
    }
  });

  it('player chạy né sống lâu hơn đứng yên ít nhất 2 lần', () => {
    for (const seed of BALANCE_SEEDS) {
      const idle = simulateRun({ seed, level: chapterOne, policy: standStill });
      const dodging = simulateRun({ seed, level: chapterOne, policy: makeDodgePolicy() });

      expect(idle.status, `seed ${seed}`).toBe('lost');
      expect(dodging.durationMs, `seed ${seed}`).toBeGreaterThanOrEqual(idle.durationMs * 2);
    }
  });

  it('caster bắn ít nhất một phát trước khi chết, mỗi con', () => {
    const seenBullets = new Set<number>();
    const castersThatFired = new Set<string>();
    const castersSeen = new Set<string>();

    const spy: InputPolicy = (world) => {
      for (const enemy of world.enemies) {
        if (enemy.role === 'caster' && enemy.health > 0 && enemy.action.kind !== 'dead') {
          castersSeen.add(enemy.id);
        }
      }

      const casters = world.enemies.filter(
        (enemy) => enemy.role === 'caster' && enemy.health > 0 && enemy.action.kind !== 'dead',
      );

      for (const bullet of world.bullets) {
        if (bullet.owner !== 'enemy' || seenBullets.has(bullet.id)) continue;
        seenBullets.add(bullet.id);
        // Đạn enemy sinh ra đúng tại tâm caster, và trong frame này chỉ bay
        // 0.064 tile — nên khoảng cách nhỏ là đủ để quy đạn về caster.
        for (const caster of casters) {
          const gap = Math.hypot(
            bullet.position.x - caster.position.x,
            bullet.position.y - caster.position.y,
          );
          if (gap <= 0.6) castersThatFired.add(caster.id);
        }
      }

      return standStill(world);
    };

    // God mode để không con caster nào bị "may mắn" chết trước khi wave sau tới.
    const result = simulateRun({ seed: 7, level: chapterOne, policy: spy, godMode: true });

    expect(result.status).toBe('won');
    expect(castersSeen.size).toBeGreaterThan(0);
    expect(seenBullets.size).toBeGreaterThan(0);
    expect([...castersSeen].filter((id) => !castersThatFired.has(id))).toEqual([]);
  });

  it('có enemy tiếp cận tầm chạm khi player đứng yên', () => {
    let closestGap = Number.POSITIVE_INFINITY;

    const measure: InputPolicy = (world) => {
      for (const enemy of world.enemies) {
        const gap = Math.hypot(
          enemy.position.x - world.player.x,
          enemy.position.y - world.player.y,
        );
        closestGap = Math.min(closestGap, gap);
      }
      return standStill(world);
    };

    const result = simulateRun({ seed: 7, level: chapterOne, policy: measure });
    const contactHits = result.events.filter(
      (event) => event.kind === 'player-hit' && event.source === 'contact',
    );

    expect(result.status).toBe('lost');
    expect(contactHits.length).toBeGreaterThan(0);
    expect(closestGap).toBeLessThanOrEqual(CHASER_CONTACT_RANGE_TILES);
  });
});

describe('simulateRun — tích hợp save', () => {
  it('vàng của run thắng cộng vào save và round-trip qua SaveRepository', () => {
    const result = simulateRun({
      seed: 7,
      level: chapterOne,
      policy: standStill,
      godMode: true,
    });
    expect(result.status).toBe('won');

    const base = createDefaultSave();
    const { save, gold } = applyGold(base, result.goldEarned);
    expect(gold).toBe(result.goldEarned);
    expect(save.gold).toBe(result.goldEarned);
    expect(base.gold).toBe(0);

    const repository = new SaveRepository(new MemorySaveStorage());
    repository.save(save);
    const loaded = repository.load();

    expect(loaded.gold).toBe(gold);
    expect(loaded.version).toBe(save.version);
    expect(loaded.upgrades).toEqual(save.upgrades);
    expect(repository.lastLoadError).toBeNull();
  });

  it('applyGold chặn trần save: không bao giờ vượt MAX_GOLD', () => {
    const { gold, save } = applyGold(createDefaultSave(), Number.MAX_VALUE);

    expect(gold).toBe(MAX_GOLD);
    expect(save.gold).toBe(MAX_GOLD);
    expect(Number.isFinite(save.gold)).toBe(true);
  });
});

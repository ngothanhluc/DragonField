/**
 * M12-T4 tests: XP challenge door elite promotion, skill-pool alternative detection for Reroll,
 * shared-gold reroll + end-of-run ledger accounting, XP orb tier sizing, and XP door icon assets.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('cc', () => {
  class MockColor {
    constructor(
      public r = 255,
      public g = 255,
      public b = 255,
      public a = 255,
    ) {}
  }
  return {
    Color: MockColor,
    Component: class {},
    Font: class {},
    Graphics: class {},
    JsonAsset: class {},
    Label: class {},
    Node: class {},
    Rect: class {},
    Size: class {},
    Sprite: class {
      static Type = { SIMPLE: 0, SLICED: 1, TILED: 2 };
      static SizeMode = { CUSTOM: 0, TRIMMED: 1, RAW: 2 };
    },
    SpriteFrame: class {},
    Texture2D: class {
      static Filter = { NEAREST: 0, LINEAR: 1 };
    },
    TiledMap: class {},
    TiledMapAsset: class {},
    UITransform: class {},
    Vec2: class {},
    _decorator: { ccclass: () => (target: unknown) => target },
    warn: () => undefined,
    resources: { load: () => undefined },
  };
});

import { DOORS_TUNING, XP_TUNING } from '../../assets/scripts/core/enemies/tuning';
import { WaveScheduler } from '../../assets/scripts/core/enemies/wave-scheduler';
import { RunRewards } from '../../assets/scripts/core/run/run-rewards';
import { createDefaultSave, serializeSave, type SaveData } from '../../assets/scripts/core/save/save-data';
import { MemorySaveStorage, SaveRepository } from '../../assets/scripts/core/save/storage';
import { SKILLS } from '../../assets/scripts/core/skills/pool';
import { hasAlternativeSkills } from '../../assets/scripts/core/skills/roll';
import { spendSharedGoldForReroll } from '../../assets/scripts/core/xp/reroll';
import { xpDoorClearBonus, xpForKill } from '../../assets/scripts/core/xp/xp-curve';
import { doorVerticalLayout, ICONS } from '../../assets/scripts/game/door-view';
import { commitRunEnd } from '../../assets/scripts/game/run-end';
import { xpOrbTierForValue } from '../../assets/scripts/game/xp-orb-view';
import { loadTmxLevels } from '../helpers/tmx-levels';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(HERE, '..', '..', 'assets');

describe('xp door challenge wave setup — extra elites promotion', () => {
  it('promotes exactly xpRoomExtraElites non-elite enemies deterministically without altering room total', () => {
    const levels = loadTmxLevels();
    const room = levels.find((entry) => !entry.isBossRoom && entry.size.cols > 32);
    expect(room).toBeDefined();
    if (room === undefined) return;

    const baseScheduler = new WaveScheduler(room, 123, 2, 0);
    const xpScheduler = new WaveScheduler(room, 123, 2, DOORS_TUNING.xpRoomExtraElites);
    expect(xpScheduler.total).toBe(baseScheduler.total);

    const view = { x: 0, y: 0, width: 64, height: 36 };
    const player = { x: 32, y: 18 };

    const collectElites = (scheduler: WaveScheduler): number => {
      let elites = 0;
      let nowMs = 0;
      while (scheduler.spawned < scheduler.total) {
        const spawns = scheduler.step({ nowMs, player, view, alive: 0 });
        for (const s of spawns) {
          if (s.elite) elites += 1;
        }
        nowMs += 2000;
      }
      return elites;
    };

    const baseElites = collectElites(baseScheduler);
    const xpElites = collectElites(xpScheduler);
    expect(xpElites).toBe(baseElites + DOORS_TUNING.xpRoomExtraElites);
  });
});

describe('hasAlternativeSkills — reroll button availability', () => {
  it('returns true when at least one eligible skill is outside the current offer, false when exhausted', () => {
    const allMaxed = new Map<string, number>(SKILLS.map((s) => [s.id, s.maxStacks]));
    expect(hasAlternativeSkills(allMaxed, [])).toBe(false);

    allMaxed.delete('sharpen');
    allMaxed.delete('rapid-fire');
    allMaxed.delete('twin-shot');
    expect(hasAlternativeSkills(allMaxed, ['sharpen', 'rapid-fire', 'twin-shot'])).toBe(false);

    allMaxed.delete('vitality');
    expect(hasAlternativeSkills(allMaxed, ['sharpen', 'rapid-fire', 'twin-shot'])).toBe(true);
  });
});

describe('shared-gold reroll + RunRewards + commitRunEnd ledger consistency', () => {
  it('spends run gold first then banked meta gold without double-counting or refunding on run end', () => {
    let saved: SaveData = { ...createDefaultSave(), gold: 25 };
    const repo = new SaveRepository(new MemorySaveStorage(serializeSave(saved)));

    const rewards = new RunRewards();
    rewards.awardBonus(15); // runGold = 15, banked = 25, shared = 40.

    // First reroll costs 10: paid purely from run gold (runGold 15 -> 5, banked 25).
    const r1 = spendSharedGoldForReroll(saved, rewards.goldEarned, 0);
    expect(r1.ok).toBe(true);
    saved = r1.save;
    rewards.spend(rewards.goldEarned - r1.runGold);
    expect(rewards.goldEarned).toBe(5);
    expect(saved.gold).toBe(25);

    // Second reroll costs 20: consumes remaining 5 run gold + 15 banked meta gold (runGold 0, banked 10).
    const r2 = spendSharedGoldForReroll(saved, rewards.goldEarned, 1);
    expect(r2.ok).toBe(true);
    saved = r2.save;
    rewards.spend(rewards.goldEarned - r2.runGold);
    expect(rewards.goldEarned).toBe(0);
    expect(saved.gold).toBe(10);

    // Earn 12 more gold before losing the run: final banked gold must be 10 + 12 = 22.
    rewards.awardBonus(12);
    const committed = commitRunEnd(saved, repo, {
      chapter: 1,
      goldEarned: rewards.goldEarned,
      won: false,
    });
    expect(committed.gold).toBe(22);
    expect(repo.load().gold).toBe(22);
  });
});

describe('xpOrbTierForValue & xp door visual asset', () => {
  it('classifies normal kills, elite kills, and xp door bonus orbs into crisp crystal tiers', () => {
    expect(xpOrbTierForValue(xpForKill('chaser', false))).toBe('small');
    expect(xpOrbTierForValue(xpForKill('caster', false))).toBe('small');
    expect(xpOrbTierForValue(xpForKill('sniper', false))).toBe('small');
    expect(xpOrbTierForValue(xpForKill('splitter', false))).toBe('medium');
    expect(xpOrbTierForValue(xpForKill('tank', false))).toBe('medium');
    expect(xpOrbTierForValue(xpForKill('chaser', true))).toBe('large');
    expect(xpOrbTierForValue(xpForKill('tank', true))).toBe('large');

    for (let chapter = 1; chapter <= 4; chapter += 1) {
      const bonus = xpDoorClearBonus(chapter);
      const count = Math.min(5, Math.max(2, Math.floor(bonus / 25)));
      expect(count).toBeGreaterThanOrEqual(2);
      expect(count).toBeLessThanOrEqual(5);
      expect(xpOrbTierForValue(Math.floor(bonus / count))).toBe('large');
    }
    expect(XP_TUNING.roles.splitling).toBe(0);
  });

  it('uses staged xp-orb crystal art for the xp door icon and exists on disk with .meta', () => {
    expect(ICONS.xp.sheet).toBe('resources/art/fx/xp-orb/xp-orb-large.png');
    const pngPath = join(ASSETS_DIR, ICONS.xp.sheet);
    expect(existsSync(pngPath)).toBe(true);
    expect(existsSync(`${pngPath}.meta`)).toBe(true);
    const meta = JSON.parse(readFileSync(`${pngPath}.meta`, 'utf8')) as { importer?: string };
    expect(meta.importer).toBe('image');
  });

  it('places north-edge door portal, icon, and label inside the room bounds', () => {
    const roomRows = 36;
    const north = doorVerticalLayout(0.5);
    const northWorldY = roomRows - 0.5;
    expect(northWorldY + north.portalBottomY + 1.9).toBeLessThanOrEqual(roomRows);
    expect(northWorldY + north.iconY).toBeLessThan(roomRows - 1);
    expect(northWorldY + north.labelY).toBeLessThan(northWorldY + north.iconY);

    const south = doorVerticalLayout(35.5);
    const southWorldY = roomRows - 35.5;
    expect(southWorldY + south.portalBottomY).toBeGreaterThanOrEqual(0);
    expect(southWorldY + south.iconY).toBeGreaterThan(southWorldY + 1.9);
    expect(southWorldY + south.labelY).toBeGreaterThan(southWorldY + south.iconY);
  });
});

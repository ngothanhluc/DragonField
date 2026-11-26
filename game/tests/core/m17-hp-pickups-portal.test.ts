/**
 * Comprehensive Milestone M17 unit & integration tests (ADR-025):
 * 1. RPG 100 HP scale (4 classes, Meta Shop +20 HP/lv, Vitality +25 HP, enemy/boss dmg, 50% heal, v1→v2 run-save migration)
 * 2. Unified top-left HP+XP HUD layout (28×28 portrait slot, 350 ms damage-drain trail, freed bottom-centre, SẴN bar padding)
 * 3. Pooled world Gold Coins & Health Potions (zero allocations, 3.5%/14% drop rates, 25% heal, full-HP +5g conversion)
 * 4. Single North Portal cadence (Rooms 1–4 → mid-chapter Shop/Chest → Rooms 5–8 → Room 9 Boss) & Portal VFX
 * 5. Room-clear +45% movement speed boost & immediate reset on next room entry
 */
import { describe, expect, it } from 'vitest';
import { initialBossState, stepBoss } from '../../assets/scripts/core/boss/patterns';
import { SeededRng } from '../../assets/scripts/core/rng';
import { HealthState } from '../../assets/scripts/core/combat/health';
import { DEFAULT_COMBAT } from '../../assets/scripts/core/config';
import { contactDamageFor } from '../../assets/scripts/core/enemies/behaviours';
import { PICKUPS_TUNING, SPECIAL_ROOMS_TUNING } from '../../assets/scripts/core/enemies/tuning';
import { t } from '../../assets/scripts/core/i18n';
import { parseLevelData } from '../../assets/scripts/core/level/level-data';
import { derivedStatsForRun } from '../../assets/scripts/core/meta/run-stats';
import {
  HP_PER_HEART_LEVEL,
  MAX_HEARTS_TRACK,
  applyUpgrades,
  createDefaultUpgrades,
} from '../../assets/scripts/core/meta/upgrades';
import { RoomClearSpeedBoost, effectiveMoveSpeed } from '../../assets/scripts/core/movement/move-intent';
import {
  DOOR_REWARDS,
  doorOffers,
  midChapterSpecialAfterRoom,
  northDoorPosition,
  portalDestinationKind,
} from '../../assets/scripts/core/run/doors';
import {
  healByFraction,
  specialHealAmount,
  specialRoomLevel,
} from '../../assets/scripts/core/run/special-rooms';
import {
  LEGACY_HEART_TO_HP_SCALE,
  RUN_SAVE_VERSION,
  migrateRunSave,
} from '../../assets/scripts/core/save/run-save';
import { createDefaultSave } from '../../assets/scripts/core/save/save-data';
import { SkillLoadout } from '../../assets/scripts/core/skills/loadout';
import {
  HUD_ACTION_BAR_HEIGHT_PX,
  HUD_ACTION_STATUS_LINE_HEIGHT,
  HUD_HP_TRAIL_DURATION_MS,
  HUD_PORTRAIT_SIZE_PX,
  advanceHudHpTrail,
  computeHudHpFillRatio,
  computeHudLayout,
  createHudHpTrail,
  formatHudHpText,
  hudHpColorTier,
  hudRectInside,
  triggerHudHpTrail,
} from '../../assets/scripts/core/view/hud-layout';
import {
  PORTAL_PALETTES,
  PORTAL_PARTICLE_COUNT,
  portalPaletteFor,
  portalParticlePose,
  portalVortexFrame,
} from '../../assets/scripts/core/view/portal-vfx';
import {
  WorldPickupPool,
  healthPotionHealAmount,
  shouldDropHealthPotion,
} from '../../assets/scripts/core/xp/pickups';

describe('M17-1: RPG 100 HP scale & v1→v2 run-save migration', () => {
  it('sets base max HP to 100 and applies exact 4-class HP deltas (Ninja 100, Archer/Mage 85, Cultivator 120)', () => {
    const save = createDefaultSave();
    expect(DEFAULT_COMBAT.playerBaseMaxHp).toBe(100);
    expect(derivedStatsForRun(save, new Map(), 'ninja').maxHp).toBe(100);
    expect(derivedStatsForRun(save, new Map(), 'archer').maxHp).toBe(85);
    expect(derivedStatsForRun(save, new Map(), 'mage').maxHp).toBe(85);
    expect(derivedStatsForRun(save, new Map(), 'cultivator').maxHp).toBe(120);
  });

  it('keeps Meta Shop key "hearts" for 1:1 save compat and grants +20 HP per level (+100 HP at Lv 5)', () => {
    expect(HP_PER_HEART_LEVEL).toBe(20);
    expect(MAX_HEARTS_TRACK).toBe(5);
    const maxBonus = applyUpgrades({
      upgrades: { ...createDefaultUpgrades(), hearts: 5 },
    });
    expect(maxBonus.maxHpBonus).toBe(100);

    const maxedSave = {
      ...createDefaultSave(),
      upgrades: { ...createDefaultUpgrades(), hearts: 5 },
    };
    expect(derivedStatsForRun(maxedSave, new Map(), 'ninja').maxHp).toBe(200);
    expect(derivedStatsForRun(maxedSave, new Map(), 'cultivator').maxHp).toBe(220);
  });

  it('Vitality adds +25 max HP and heals 25 HP immediately per stack (max 5 → +125 HP)', () => {
    const loadout = new SkillLoadout();
    const first = loadout.acquire('vitality', 1);
    expect(first.healNow).toBe(25);
    expect(loadout.stats().maxHp).toBe(125);

    const rest = loadout.acquire('vitality', 10);
    expect(rest.stacks).toBe(5);
    expect(rest.healNow).toBe(100);
    expect(loadout.stats().maxHp).toBe(225);
  });

  it('enemy & boss damage sits in 15–35 HP range so a 0-Meta 100 HP player survives ~4–6 hits', () => {
    expect(contactDamageFor('chaser', false)).toBe(15);
    expect(contactDamageFor('caster', false)).toBe(15);
    expect(contactDamageFor('sniper', false)).toBe(25);
    expect(contactDamageFor('tank', false)).toBe(30);
    expect(contactDamageFor('chaser', true)).toBe(Math.round(15 * 1.5));
    expect(contactDamageFor('tank', true)).toBe(Math.round(30 * 1.5));

    // Boss patterns deal 25–35 HP.
    const rng = SeededRng.fromSeed(7);
    let boss = initialBossState('tengu', { x: 16, y: 5 }, 0, 0);
    const bossDamages: number[] = [];
    for (let tMs = 100; tMs <= 8000 && bossDamages.length < 3; tMs += 100) {
      const stepped = stepBoss({
        state: boss,
        player: { x: 16, y: 14 },
        nowMs: tMs,
        deltaMs: 100,
        rng,
      });
      boss = stepped.state;
      for (const ev of stepped.events) {
        if (ev.kind === 'shoot') {
          for (const bullet of ev.bullets) bossDamages.push(bullet.damage);
        }
      }
    }
    expect(bossDamages.length).toBeGreaterThan(0);
    for (const dmg of bossDamages) {
      expect(dmg).toBeGreaterThanOrEqual(25);
      expect(dmg).toBeLessThanOrEqual(35);
    }

    // 100 HP player survives 4 hits from 25-dmg boss shots (dies on 4th) and 6 hits from 18-dmg splitter.
    const health = new HealthState(DEFAULT_COMBAT);
    expect(health.tryDamage(20, 0).hp).toBe(80);
    expect(health.tryDamage(20, 1000).hp).toBe(60);
    expect(health.tryDamage(20, 2000).hp).toBe(40);
    expect(health.tryDamage(20, 3000).hp).toBe(20);
    expect(health.tryDamage(20, 4000).dead).toBe(true);
  });

  it('mid-run Heal NPC / Shop refill heals 50% of max HP', () => {
    expect(SPECIAL_ROOMS_TUNING.healFraction).toBeCloseTo(0.5, 6);
    expect(specialHealAmount(100)).toBe(50);
    expect(specialHealAmount(120)).toBe(60);
    expect(healByFraction(25, 100)).toBe(75);
    expect(healByFraction(80, 100)).toBe(100);
  });

  it('migrates legacy v1 heart-scale ActiveRunSave (<= 20) to 100 HP scale cleanly and preserves v2 saves', () => {
    const legacyV1 = {
      version: 1,
      seed: 42,
      chapter: 1,
      roomIndex: 3,
      chosenDoor: 'xp',
      drawnRooms: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      bossId: 'tengu',
      characterId: 'ninja',
      hearts: 4,
      maxHearts: 6,
      xpLevel: 4,
      xpCurrent: 10,
      xpTotal: 90,
      pendingLevelUps: 0,
      ownedSkills: { sharpen: 2 },
      rerollsUsed: 0,
      freeRerollsLeft: 1,
      goldEarned: 45,
      kills: 20,
      elapsedMs: 12000,
      ascension: 0,
      endlessLoop: 0,
    };

    const migrated = migrateRunSave(legacyV1);
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(RUN_SAVE_VERSION);
    expect(migrated!.maxHearts).toBe(6 * LEGACY_HEART_TO_HP_SCALE);
    expect(migrated!.hearts).toBe(4 * LEGACY_HEART_TO_HP_SCALE);

    // A v2 save already on the 100 HP scale is not rescaled again.
    const alreadyV2 = { ...migrated!, hearts: 85, maxHearts: 100 };
    const reloaded = migrateRunSave(alreadyV2);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.hearts).toBe(85);
    expect(reloaded!.maxHearts).toBe(100);
  });
});

describe('M17-2: Unified top-left HP+XP HUD & damage-drain trail', () => {
  it('places portrait slot, HP bar, and XP bar at top-left and frees bottom-centre', () => {
    const layout = computeHudLayout({
      hp: 85,
      maxHp: 100,
      xpLevel: 4,
      xpCurrent: 14,
      xpRequired: 35,
      skillCount: 5,
    });

    expect(layout.topLeft.portraitSlot.width).toBe(HUD_PORTRAIT_SIZE_PX);
    expect(layout.topLeft.portraitSlot.height).toBe(HUD_PORTRAIT_SIZE_PX);
    expect(layout.topLeft.hpBar.hpText).toBe('85/100');
    expect(layout.topLeft.hpBar.fillRatio).toBeCloseTo(0.85, 6);
    expect(layout.topLeft.hpBar.tier).toBe('high');
    expect(hudRectInside(layout.xpBar.plate, layout.topLeft.plate)).toBe(true);
    expect(layout.xpBar.plate.top).toBeLessThan(layout.topLeft.hpBar.barTrack.bottom);

    // Bottom-left Dash/Active ready bar has >= 3 px clearance over line height so `SẴN` tilde never clips.
    expect(HUD_ACTION_BAR_HEIGHT_PX - HUD_ACTION_STATUS_LINE_HEIGHT).toBeGreaterThanOrEqual(3);
  });

  it('steps the delayed white damage-drain trail smoothly over 350 ms and snaps immediately on heal', () => {
    expect(computeHudHpFillRatio(50, 100)).toBe(0.5);
    expect(formatHudHpText(85, 100)).toBe('85/100');
    expect(hudHpColorTier(0.8)).toBe('high');
    expect(hudHpColorTier(0.45)).toBe('mid');
    expect(hudHpColorTier(0.2)).toBe('low');

    let trail = createHudHpTrail(1);
    expect(trail.active).toBe(false);

    trail = triggerHudHpTrail(trail, 0.6);
    expect(trail.active).toBe(true);
    expect(trail.current).toBe(1);

    // Halfway through 350 ms ease-out, trail has drained past linear midpoint toward 0.6.
    trail = advanceHudHpTrail(trail, HUD_HP_TRAIL_DURATION_MS / 2);
    expect(trail.active).toBe(true);
    expect(trail.current).toBeGreaterThan(0.6);
    expect(trail.current).toBeLessThan(0.8);

    // At 350 ms, trail settles exactly at target and becomes idle.
    trail = advanceHudHpTrail(trail, HUD_HP_TRAIL_DURATION_MS / 2);
    expect(trail.active).toBe(false);
    expect(trail.current).toBeCloseTo(0.6, 6);

    // Healing snaps trail up immediately without lingering.
    const healed = triggerHudHpTrail(trail, 0.9);
    expect(healed.active).toBe(false);
    expect(healed.current).toBeCloseTo(0.9, 6);
  });
});

describe('M17-3: Small glowing pickups & Health Potion rules', () => {
  it('configures pooled gold coin and health potion capacities in tuning.json', () => {
    expect(PICKUPS_TUNING.goldCoinPoolCapacity).toBeGreaterThanOrEqual(64);
    expect(PICKUPS_TUNING.healthPotion.poolCapacity).toBeGreaterThanOrEqual(16);
    expect(PICKUPS_TUNING.healthPotion.fullHpGoldBonus).toBe(5);
  });

  it('drops Health Potions at 3.5% normal / 14% Elite and heals 25% max HP', () => {
    expect(PICKUPS_TUNING.healthPotion.dropChanceNormal).toBeCloseTo(0.035, 6);
    expect(PICKUPS_TUNING.healthPotion.dropChanceElite).toBeCloseTo(0.14, 6);
    expect(shouldDropHealthPotion(false, 0.034)).toBe(true);
    expect(shouldDropHealthPotion(false, 0.036)).toBe(false);
    expect(shouldDropHealthPotion(true, 0.139)).toBe(true);
    expect(shouldDropHealthPotion(true, 0.141)).toBe(false);
    expect(healthPotionHealAmount(100)).toBe(25);
    expect(healthPotionHealAmount(120)).toBe(30);
  });

  it('magnet-pulls Health Potions only when injured and converts full-HP vacuumed potions to +5g gold', () => {
    const pool = new WorldPickupPool();
    const initialCapacity = pool.capacity;
    expect(pool.recycledCount).toBe(initialCapacity);

    // Spawn 1 Gold Coin (value 7) + 1 Health Potion inside magnet range.
    pool.spawnGold({ x: 10, y: 10 }, 7);
    pool.spawnHealthPotion({ x: 10.8, y: 10 });
    expect(pool.size + pool.recycledCount).toBe(initialCapacity);

    // Advance past scatter at FULL HP: Gold Coin collects; Health Potion stays on floor.
    let totalGold = 0;
    for (let step = 0; step < 60; step += 1) {
      const res = pool.step(0.05, { x: 10, y: 10 }, {
        roomCleared: false,
        playerHp: 100,
        playerMaxHp: 100,
      });
      totalGold += res.goldCollected;
      expect(res.hpHealed).toBe(0);
      expect(res.potionsConvertedToGold).toBe(0);
    }
    expect(totalGold).toBe(7);
    expect(pool.goldCount).toBe(0);
    expect(pool.potionCount).toBe(1);

    // On room-clear auto-vacuum at FULL HP: potion vacuums in and converts to +5g bonus gold.
    let bonusGold = 0;
    let converted = 0;
    for (let step = 0; step < 60 && pool.size > 0; step += 1) {
      const res = pool.step(0.05, { x: 10, y: 10 }, {
        roomCleared: true,
        playerHp: 100,
        playerMaxHp: 100,
      });
      bonusGold += res.potionGoldBonus;
      converted += res.potionsConvertedToGold;
    }
    expect(pool.size).toBe(0);
    expect(pool.recycledCount).toBe(initialCapacity);
    expect(converted).toBe(1);
    expect(bonusGold).toBe(PICKUPS_TUNING.healthPotion.fullHpGoldBonus);

    // When injured (60/100 HP), a Health Potion magnet-pulls during combat and heals 25 HP.
    pool.spawnHealthPotion({ x: 11.2, y: 10 });
    let healed = 0;
    for (let step = 0; step < 60 && pool.size > 0; step += 1) {
      const res = pool.step(0.05, { x: 10, y: 10 }, {
        roomCleared: false,
        playerHp: 60,
        playerMaxHp: 100,
      });
      healed += res.hpHealed;
    }
    expect(pool.size).toBe(0);
    expect(healed).toBe(25);
  });
});

describe('M17-4: Single North Portal, Special Room cadence & Portal VFX', () => {
  it('resolves the North Portal to the topmost doorway and schedules Special Room after Room 4 & Boss after Room 8', () => {
    const dualDoorRoom = parseLevelData({
      id: 'dual-door',
      chapter: 1,
      room: 1,
      isBossRoom: false,
      size: { cols: 64, rows: 36 },
      tileSizePx: 16,
      playerStart: { x: 32, y: 30 },
      waves: [{ enemies: [{ role: 'chaser', at: { x: 32, y: 10 }, elite: false }] }],
      obstacles: [],
      doors: [
        { at: { x: 32, y: 35.5 }, toRoom: null },
        { at: { x: 32, y: 0.5 }, toRoom: null },
      ],
    });
    expect(northDoorPosition(dualDoorRoom)).toEqual({ x: 32, y: 0.5 });

    // Special rooms also place their single exit at North edge.
    const shopRoom = specialRoomLevel(1, 'shop', 104);
    expect(shopRoom.doors).toHaveLength(1);
    expect(shopRoom.doors[0]!.at.y).toBeLessThanOrEqual(2);

    expect(midChapterSpecialAfterRoom(8)).toBe(4);
    expect(doorOffers(1, 1, 8, DOOR_REWARDS)).toEqual(['xp']);
    expect(doorOffers(1, 3, 8, DOOR_REWARDS)).toEqual(['xp']);
    expect(['shop', 'chest']).toContain(doorOffers(1, 4, 8, DOOR_REWARDS)[0]);
    expect(doorOffers(1, 5, 8, DOOR_REWARDS)).toEqual(['xp']);
    expect(doorOffers(1, 8, 8, DOOR_REWARDS)).toEqual(['boss']);
  });

  it('color-codes Normal (cyan), Special (gold), and Boss (crimson) portals and respects Effects: Reduced', () => {
    expect(portalDestinationKind('xp')).toBe('normal');
    expect(portalDestinationKind('shop')).toBe('special');
    expect(portalDestinationKind('chest')).toBe('special');
    expect(portalDestinationKind('boss')).toBe('boss');

    expect(portalPaletteFor('xp')).toEqual(PORTAL_PALETTES.normal);
    expect(portalPaletteFor('shop')).toEqual(PORTAL_PALETTES.special);
    expect(portalPaletteFor('boss')).toEqual(PORTAL_PALETTES.boss);

    const fullFrame = portalVortexFrame(1.25, 'boss', false, 4);
    expect(fullFrame.outerAngleDeg).toBeGreaterThan(0);
    expect(fullFrame.innerAngleDeg).toBeLessThan(0);
    expect(fullFrame.gateFrameIndex).toBeGreaterThanOrEqual(0);
    expect(fullFrame.gateFrameIndex).toBeLessThan(4);

    const reducedFrame = portalVortexFrame(1.25, 'boss', true, 4);
    expect(reducedFrame.outerAngleDeg).toBe(0);
    expect(reducedFrame.innerAngleDeg).toBe(0);
    expect(reducedFrame.auraScale).toBe(1);
    expect(reducedFrame.gateFrameIndex).toBe(0);

    for (let i = 0; i < PORTAL_PARTICLE_COUNT; i += 1) {
      const pose = portalParticlePose(i, PORTAL_PARTICLE_COUNT, 0.7);
      expect(pose.alpha).toBeGreaterThanOrEqual(0);
      expect(pose.alpha).toBeLessThanOrEqual(255);
      expect(pose.scale).toBeGreaterThan(0);
    }
  });
});

describe('M17-5: Room-clear +45% speed boost & immediate reset', () => {
  it('boosts move speed by ×1.45 on room clear and resets strictly to 1.0× on next room entry', () => {
    expect(DEFAULT_COMBAT.roomClearSpeedMultiplier).toBeCloseTo(1.45, 6);
    expect(effectiveMoveSpeed(6, false)).toBe(6);
    expect(effectiveMoveSpeed(6, true)).toBeCloseTo(6 * 1.45, 6);

    const boost = new RoomClearSpeedBoost();
    expect(boost.active).toBe(false);
    expect(boost.multiplier).toBe(1);
    expect(boost.apply(6)).toBe(6);

    boost.onCombatRoomCleared();
    expect(boost.active).toBe(true);
    expect(boost.multiplier).toBeCloseTo(1.45, 6);
    expect(boost.apply(6)).toBeCloseTo(8.7, 6);

    // Entering the next room resets immediately so boost never leaks into combat/boss.
    boost.onEnterRoom();
    expect(boost.active).toBe(false);
    expect(boost.multiplier).toBe(1);
    expect(boost.apply(6)).toBe(6);
  });

  it('localizes M17 HP, Health Potion, and North Portal copy cleanly in both VI and EN', () => {
    expect(t('hud.chooseDoor', undefined, 'vi')).toBe('Vào Cổng Bắc');
    expect(t('hud.chooseDoor', undefined, 'en')).toBe('Enter North Portal');
    expect(t('runShop.heartRefill', undefined, 'vi')).toBe('Bình Hồi Máu');
    expect(t('runShop.restoreEffect', undefined, 'vi')).toContain('50% HP');
    expect(t('runShop.restoreEffect', undefined, 'en')).toContain('50% max HP');
    expect(t('tag.maxHearts', { amount: 25 }, 'vi')).toContain('+25 HP');
    expect(t('tag.maxHearts', { amount: 25 }, 'en')).toContain('+25 max HP');
  });
});

/**
 * Acceptance test for ticket #3 (weapon VFX). Written by the orchestrator; the executor does NOT edit this file.
 *
 * Seam: the pure `core/vfx/weapon-vfx.ts` selection rules + the persisted `effects` setting + the
 * animation manifest. The Cocos adapter (what is actually drawn) is proven in the browser, not here.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ELEMENT_TINTS,
  effectsLayers,
  enemyProjectileKey,
  playerProjectileLook,
  showAura,
  strongestElement,
  trailElement,
  type VfxElement,
} from '../../assets/scripts/core/vfx/weapon-vfx';
import {
  REQUIRED_ACTOR_ANIMATIONS,
  validateManifest,
  type AnimationManifest,
} from '../../assets/scripts/core/art/manifest';
import { DEFAULT_SETTINGS, applySettings } from '../../assets/scripts/core/save/settings';
import {
  SAVE_VERSION,
  createDefaultSave,
  migrate,
  parseSaveData,
  serializeSave,
} from '../../assets/scripts/core/save/save-data';

const HERE = dirname(fileURLToPath(import.meta.url));
const manifest: AnimationManifest = validateManifest(
  JSON.parse(
    readFileSync(join(HERE, '..', '..', 'assets', 'resources', 'data', 'animations.json'), 'utf8'),
  ) as unknown,
);

const owned = (entries: Record<string, number>): ReadonlyMap<string, number> =>
  new Map(Object.entries(entries));

describe('player projectile sprite — strongest element in priority order', () => {
  it('no skills → plain shuriken, untinted', () => {
    expect(playerProjectileLook(owned({}))).toEqual({ key: 'fx.shuriken', tint: null });
  });

  it('each branch on its own', () => {
    expect(playerProjectileLook(owned({ explosive: 1 }))).toEqual({ key: 'fx.big-energy-ball', tint: 'fire' });
    expect(playerProjectileLook(owned({ freeze: 1 }))).toEqual({ key: 'fx.ice-spike', tint: null });
    expect(playerProjectileLook(owned({ poison: 1 }))).toEqual({ key: 'fx.plant-spike', tint: null });
    expect(playerProjectileLook(owned({ homing: 1 }))).toEqual({ key: 'fx.shuriken-magic', tint: null });
    expect(playerProjectileLook(owned({ piercing: 1 }))).toEqual({ key: 'fx.kunai', tint: null });
  });

  it('priority: Explosive > Freeze > Poison > Homing > Piercing > default', () => {
    const all = { explosive: 1, freeze: 1, poison: 1, homing: 1, piercing: 1 };
    expect(playerProjectileLook(owned(all)).key).toBe('fx.big-energy-ball');
    expect(playerProjectileLook(owned({ ...all, explosive: 0 })).key).toBe('fx.ice-spike');
    expect(playerProjectileLook(owned({ poison: 2, homing: 1, piercing: 3 })).key).toBe('fx.plant-spike');
    expect(playerProjectileLook(owned({ homing: 1, piercing: 3 })).key).toBe('fx.shuriken-magic');
    expect(playerProjectileLook(owned({ piercing: 3, 'crit-eye': 3, 'rapid-fire': 5 })).key).toBe('fx.kunai');
  });

  it('Sharpen ≥ 3 → Big variant of shuriken/kunai only', () => {
    expect(playerProjectileLook(owned({ sharpen: 2 })).key).toBe('fx.shuriken');
    expect(playerProjectileLook(owned({ sharpen: 3 })).key).toBe('fx.big-shuriken');
    expect(playerProjectileLook(owned({ sharpen: 5 })).key).toBe('fx.big-shuriken');
    expect(playerProjectileLook(owned({ sharpen: 2, piercing: 1 })).key).toBe('fx.kunai');
    expect(playerProjectileLook(owned({ sharpen: 3, piercing: 1 })).key).toBe('fx.big-kunai');
    // An element sprite has no Big variant: Sharpen does not change it.
    expect(playerProjectileLook(owned({ sharpen: 5, freeze: 1 })).key).toBe('fx.ice-spike');
    expect(playerProjectileLook(owned({ sharpen: 5, homing: 1 })).key).toBe('fx.shuriken-magic');
  });

  it('broken loadouts: 0/negative/NaN stacks and unknown ids count as not owned', () => {
    expect(playerProjectileLook(owned({ explosive: 0, freeze: -1, poison: Number.NaN, nope: 9 })).key).toBe(
      'fx.shuriken',
    );
    // Sharpen clamps at maxStacks (5) like the loadout — 99 is still just "≥ 3".
    expect(playerProjectileLook(owned({ sharpen: 99 })).key).toBe('fx.big-shuriken');
  });
});

describe('trail colour by element', () => {
  it('strongestElement follows the same priority, crit is never a loadout element', () => {
    expect(strongestElement(owned({}))).toBeNull();
    expect(strongestElement(owned({ piercing: 3, sharpen: 5, 'crit-eye': 3 }))).toBeNull();
    expect(strongestElement(owned({ explosive: 1, freeze: 1 }))).toBe('fire');
    expect(strongestElement(owned({ freeze: 1, poison: 1 }))).toBe('ice');
    expect(strongestElement(owned({ poison: 1, homing: 1 }))).toBe('poison');
    expect(strongestElement(owned({ homing: 1 }))).toBe('homing');
  });

  it('a crit bullet trails yellow whatever the loadout; otherwise the strongest element; none → no trail', () => {
    expect(trailElement(owned({ explosive: 1 }), true)).toBe('crit');
    expect(trailElement(owned({}), true)).toBe('crit');
    expect(trailElement(owned({ explosive: 1 }), false)).toBe('fire');
    expect(trailElement(owned({ freeze: 2 }), false)).toBe('ice');
    expect(trailElement(owned({ poison: 1 }), false)).toBe('poison');
    expect(trailElement(owned({ homing: 1 }), false)).toBe('homing');
    expect(trailElement(owned({ piercing: 2, sharpen: 3 }), false)).toBeNull();
  });

  it('ELEMENT_TINTS: fire orange, ice cyan, poison green, homing purple, crit yellow (0..255 RGB)', () => {
    const tint = (element: VfxElement) => ELEMENT_TINTS[element];
    for (const element of ['fire', 'ice', 'poison', 'homing', 'crit'] as const) {
      const { r, g, b } = tint(element);
      for (const channel of [r, g, b]) {
        expect(Number.isInteger(channel), `${element} channel`).toBe(true);
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
    const fire = tint('fire');
    expect(fire.r).toBeGreaterThan(fire.g);
    expect(fire.g).toBeGreaterThan(fire.b);
    expect(fire.g).toBeGreaterThan(60); // orange, not red

    const ice = tint('ice');
    expect(Math.min(ice.g, ice.b)).toBeGreaterThan(ice.r + 60);

    const poison = tint('poison');
    expect(poison.g).toBeGreaterThan(poison.r);
    expect(poison.g).toBeGreaterThan(poison.b);

    const homing = tint('homing');
    expect(Math.min(homing.r, homing.b)).toBeGreaterThan(homing.g + 40);

    const crit = tint('crit');
    expect(Math.min(crit.r, crit.g)).toBeGreaterThan(crit.b + 100);
  });
});

describe('aura rule — ≥ 8 total stacks or an Epic skill held', () => {
  it('7 stacks of commons/rares: no aura; 8 stacks: aura', () => {
    expect(showAura(owned({}))).toBe(false);
    expect(showAura(owned({ sharpen: 5, 'rapid-fire': 2 }))).toBe(false);
    expect(showAura(owned({ sharpen: 5, 'rapid-fire': 3 }))).toBe(true);
    expect(showAura(owned({ sharpen: 2, swift: 2, piercing: 2, freeze: 2 }))).toBe(true);
  });

  it('any single Epic skill (1 stack) shows the aura', () => {
    for (const epic of ['ricochet', 'homing', 'second-wind', 'lifesteal', 'executioner']) {
      expect(showAura(owned({ [epic]: 1 })), epic).toBe(true);
    }
  });

  it('stacks are counted after clamping to maxStacks; unknown ids do not count', () => {
    // Sharpen caps at 5: 99 stacks is 5, plus 2 = 7 → no aura.
    expect(showAura(owned({ sharpen: 99, 'rapid-fire': 2 }))).toBe(false);
    expect(showAura(owned({ nope: 50, sharpen: 1 }))).toBe(false);
  });
});

describe('enemy projectile by chapter — round, per chapter', () => {
  it('ch1 EnergyBall, ch2 water bubble, ch3 CanonBall, ch4 Fireball', () => {
    expect(enemyProjectileKey(1)).toBe('fx.energy-ball');
    expect(enemyProjectileKey(2)).toBe('fx.bubble');
    expect(enemyProjectileKey(3)).toBe('fx.canon-ball');
    expect(enemyProjectileKey(4)).toBe('fx.fireball');
  });

  it('an unknown chapter falls back to the ch1 ball instead of throwing', () => {
    expect(enemyProjectileKey(0)).toBe('fx.energy-ball');
    expect(enemyProjectileKey(9)).toBe('fx.energy-ball');
    expect(enemyProjectileKey(Number.NaN)).toBe('fx.energy-ball');
  });

  it('player and enemy never share a projectile sprite (ADR-016)', () => {
    const enemy = new Set([1, 2, 3, 4].map(enemyProjectileKey));
    for (const loadout of [
      {},
      { explosive: 1 },
      { freeze: 1 },
      { poison: 1 },
      { homing: 1 },
      { piercing: 1 },
      { sharpen: 3 },
      { sharpen: 3, piercing: 1 },
    ] as Record<string, number>[]) {
      expect(enemy.has(playerProjectileLook(owned(loadout)).key)).toBe(false);
    }
  });
});

describe('effects setting — full / reduced', () => {
  it('Full turns every layer on; Reduced drops trail, aura, secondary particles, keeps impacts + telegraphs', () => {
    expect(effectsLayers('full')).toEqual({
      trail: true,
      aura: true,
      secondaryParticles: true,
      impacts: true,
      telegraphs: true,
    });
    expect(effectsLayers('reduced')).toEqual({
      trail: false,
      aura: false,
      secondaryParticles: false,
      impacts: true,
      telegraphs: true,
    });
  });

  it('defaults to full; applySettings keeps a valid value and drops anything else', () => {
    expect(DEFAULT_SETTINGS.effects).toBe('full');
    expect(applySettings({}).effects).toBe('full');
    expect(applySettings({ effects: 'reduced' }).effects).toBe('reduced');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately broken input
    expect(applySettings({ effects: 'medium' as any }).effects).toBe('full');
  });

  it('round-trips through the save', () => {
    const save = { ...createDefaultSave(), settings: { ...DEFAULT_SETTINGS, effects: 'reduced' as const } };
    const back = parseSaveData(JSON.parse(serializeSave(save)));
    expect(back.settings.effects).toBe('reduced');
    expect(back.settings).toEqual(save.settings);
  });

  it('an old save without the field migrates to full (the version only moves to the current one)', () => {
    const old = { version: 1, gold: 5, settings: { volume: 0.4, fullscreen: true, screenShake: false, damageNumbers: true } };
    const migrated = migrate(old);
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.settings.effects).toBe('full');
    expect(migrated.settings.screenShake).toBe(false);
  });

  it('parse reports a wrong effects value with its path', () => {
    const bad = { ...createDefaultSave(), settings: { ...DEFAULT_SETTINGS, effects: 'medium' } };
    expect(() => parseSaveData(bad)).toThrow(/settings\.effects/);
  });
});

describe('every new FX key is in the manifest and the required fx list (art-files.test checks the files)', () => {
  const projectileKeys = [
    'fx.big-energy-ball',
    'fx.ice-spike',
    'fx.plant-spike',
    'fx.shuriken-magic',
    'fx.kunai',
    'fx.big-shuriken',
    'fx.big-kunai',
    'fx.bubble',
    'fx.canon-ball',
    'fx.fireball',
  ];
  const oneShotKeys = ['fx.spark', 'fx.cut', 'fx.slash-arc', 'fx.boost', 'fx.smoke-circular'];
  const loopingKeys = ['fx.aura'];

  it('declared in animations.json with a centre anchor and the right loop kind', () => {
    for (const key of projectileKeys) {
      expect(manifest.sprites[key], key).toBeDefined();
      expect(manifest.sprites[key]?.loop, key).toBe(true);
    }
    for (const key of oneShotKeys) {
      expect(manifest.sprites[key], key).toBeDefined();
      expect(manifest.sprites[key]?.loop, key).toBe(false);
    }
    for (const key of loopingKeys) {
      expect(manifest.sprites[key], key).toBeDefined();
      expect(manifest.sprites[key]?.loop, key).toBe(true);
    }
    for (const key of [...projectileKeys, ...oneShotKeys, ...loopingKeys]) {
      expect(manifest.sprites[key]?.anchor, key).toBe('center');
    }
  });

  it('listed in REQUIRED_ACTOR_ANIMATIONS.fx so the required-set test covers them', () => {
    const required = new Set(REQUIRED_ACTOR_ANIMATIONS.fx);
    for (const key of [...projectileKeys, ...oneShotKeys, ...loopingKeys]) {
      expect(required.has(key), key).toBe(true);
    }
  });

  it('player NinjaGreen has a 4-direction attack (the throw animation)', () => {
    for (const direction of ['down', 'up', 'left', 'right']) {
      expect(manifest.sprites[`player.attack.${direction}`], direction).toBeDefined();
    }
  });
});

/**
 * #86 acceptance: Mage class-exclusive skills + *Thiên Tai Nguyên Tố* Evolution (M20, ADR-027,
 * GDD `docs/gdd/m19-m20-class-skills-and-art.md` §3 Mage table).
 *
 * The seam is the class-skill hook dispatcher from #83 (`dispatchClassSkillEvent('…', 'mage', …)`)
 * plus two pure exports of `core/skills/classes/mage.ts`: `frostOrbPositions` (the orbit the view
 * draws and the tick hits with) and the per-skill FX/SFX tables. Hooks stay pure functions of their
 * context: game time arrives as `nowMs`, enemies as `enemies`, the player's per-shot damage as
 * `damage`. The last block proves the simulation applies the effects (a Mage kit kills faster).
 *
 * Numbers taken from the GDD: Meteor every 4.5 s at 1 stack; Frost Orbs 2 (+1/stack); Storm Strike
 * 20% (+10%/stack); Arcane Pulse every 4th shot, 1.8-tile ring; Evolution doubles orb damage on
 * ignited foes. Everything else is tuning (`config/tuning.json`), so it is asserted by relation.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../../assets/scripts/core/art/manifest';
import { SFX_BANK } from '../../assets/scripts/core/audio/sfx-bank';
import type { Vec2 } from '../../assets/scripts/core/math/vec2';
import type { SeededRng } from '../../assets/scripts/core/rng';
import { simulateRun, type InputPolicy } from '../../assets/scripts/core/sim/run-simulation';
import { dispatchClassSkillEvent } from '../../assets/scripts/core/skills/class-skills';
import type {
  ClassSkillEffect,
  ClassSkillEventName,
  ClassSkillStackSource,
} from '../../assets/scripts/core/skills/class-skill-hooks';
import * as mage from '../../assets/scripts/core/skills/classes/mage';
import { loadChapterOne } from '../helpers/tmx-levels';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(HERE, '../../assets/resources/data/animations.json');
const manifest = validateManifest(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as unknown);

const METEOR = 'mage-meteor';
const ORBS = 'mage-frost-orbs';
const STORM = 'mage-storm-strike';
const PULSE = 'mage-arcane-pulse';
const EVO = 'mage-elemental-cataclysm';
const MAGE_IDS = [METEOR, ORBS, STORM, PULSE, EVO] as const;

const PLAYER: Vec2 = { x: 32, y: 18 };
const SHOT_DAMAGE = 10;

interface Target {
  readonly id: string;
  readonly position: Vec2;
  readonly ignited?: boolean;
}

/** The two exports this ticket adds next to `MAGE_HOOKS` (looked up loosely so the test runs red). */
interface MageExports {
  readonly frostOrbPositions?: (
    stacks: number,
    evolved: boolean,
    nowMs: number,
    center: Vec2,
  ) => readonly Vec2[];
  readonly MAGE_SKILL_FX?: Readonly<Record<string, string>>;
  readonly MAGE_SKILL_SFX?: Readonly<Record<string, string>>;
}
const mageExports = mage as unknown as MageExports;

function orbPositions(stacks: number, evolved: boolean, nowMs: number): readonly Vec2[] {
  const fn = mageExports.frostOrbPositions;
  expect(typeof fn, 'classes/mage.ts must export frostOrbPositions').toBe('function');
  return fn === undefined ? [] : fn(stacks, evolved, nowMs, PLAYER);
}

function stacksOf(owned: Readonly<Record<string, number>>): ClassSkillStackSource {
  return (id) => owned[id] ?? 0;
}

/** Fixed-roll RNG: every `next()` returns `value` (only `next` is used by proc rolls). */
function fixedRng(value: number): SeededRng {
  return { next: () => value } as unknown as SeededRng;
}

function fire(
  event: ClassSkillEventName,
  owned: Readonly<Record<string, number>>,
  context: Record<string, unknown>,
): readonly ClassSkillEffect[] {
  return dispatchClassSkillEvent(
    event,
    'mage',
    stacksOf(owned),
    // The context grows `nowMs` / `enemies` / `targetId` / `damage` in this ticket.
    { damage: SHOT_DAMAGE, rng: fixedRng(0.99), ...context } as Parameters<
      typeof dispatchClassSkillEvent
    >[3],
  );
}

function bySkill(effects: readonly ClassSkillEffect[], skillId: string): ClassSkillEffect[] {
  return effects.filter((effect) => effect.skillId === skillId);
}

/** `targetId` is a field this ticket adds to `ClassSkillEffect`. */
function targetOf(effect: ClassSkillEffect): string | undefined {
  return (effect as ClassSkillEffect & { readonly targetId?: string }).targetId;
}

function slowOf(effect: ClassSkillEffect): number | undefined {
  return (effect as ClassSkillEffect & { readonly slowFactor?: number }).slowFactor;
}

/** Tick from `fromMs` to `toMs` (inclusive) every `stepMs`, collecting every effect. */
function tickWindow(
  owned: Readonly<Record<string, number>>,
  fromMs: number,
  toMs: number,
  stepMs: number,
  enemiesAt: (nowMs: number) => readonly Target[],
): ClassSkillEffect[] {
  const effects: ClassSkillEffect[] = [];
  for (let nowMs = fromMs; nowMs <= toMs; nowMs += stepMs) {
    effects.push(
      ...fire('tick', owned, { nowMs, dtMs: stepMs, position: PLAYER, enemies: enemiesAt(nowMs) }),
    );
  }
  return effects;
}

const CLUSTER: readonly Target[] = [
  { id: 'c1', position: { x: 20, y: 20 } },
  { id: 'c2', position: { x: 20.5, y: 20 } },
  { id: 'c3', position: { x: 20, y: 20.5 } },
  { id: 'lone', position: { x: 5, y: 5 } },
];

describe('#86 Thiên Thạch (mage-meteor)', () => {
  const meteorsIn = (stacks: number, enemies: readonly Target[]): ClassSkillEffect[] =>
    bySkill(
      tickWindow({ [METEOR]: stacks }, 100, 13_500, 100, () => enemies),
      METEOR,
    ).filter((effect) => effect.kind === 'damage');

  it('drops one meteor every 4.5 s at 1 stack', () => {
    expect(meteorsIn(1, CLUSTER)).toHaveLength(3);
  });

  it('drops meteors faster per stack', () => {
    expect(meteorsIn(3, CLUSTER).length).toBeGreaterThan(3);
  });

  it('lands on the densest enemy cluster as heavy AoE plus a burn', () => {
    const effects = bySkill(
      tickWindow({ [METEOR]: 1 }, 4_400, 4_600, 100, () => CLUSTER),
      METEOR,
    );
    const hit = effects.find((effect) => effect.kind === 'damage');
    expect(hit).toBeDefined();
    if (hit === undefined) return;
    expect(Math.hypot(hit.position.x - 20, hit.position.y - 20)).toBeLessThan(1);
    expect(hit.radiusTiles ?? 0).toBeGreaterThan(0);
    expect(hit.amount ?? 0).toBeGreaterThan(SHOT_DAMAGE);
    expect(effects.some((effect) => effect.kind === 'status')).toBe(true);
  });

  it('does not fire with no enemy in the room', () => {
    expect(meteorsIn(3, [])).toHaveLength(0);
  });
});

describe('#86 Vệ Tinh Băng (mage-frost-orbs)', () => {
  it('summons 2 orbs (+1 per stack) on one orbit around the Mage', () => {
    expect(orbPositions(0, false, 0)).toHaveLength(0);
    for (const [stacks, count] of [
      [1, 2],
      [2, 3],
      [3, 4],
    ] as const) {
      const orbs = orbPositions(stacks, false, 1_000);
      expect(orbs).toHaveLength(count);
      const radii = orbs.map((orb) => Math.hypot(orb.x - PLAYER.x, orb.y - PLAYER.y));
      expect(radii[0] ?? 0).toBeGreaterThan(0);
      for (const radius of radii) expect(radius).toBeCloseTo(radii[0] ?? 0, 5);
    }
  });

  it('orbits over time', () => {
    const before = orbPositions(1, false, 0)[0];
    const after = orbPositions(1, false, 50)[0];
    expect(before).toBeDefined();
    expect(after).not.toEqual(before);
  });

  const ridingOrb =
    (owned: Readonly<Record<string, number>>, ignited: boolean) =>
    (nowMs: number): readonly Target[] => {
      const evolved = (owned[EVO] ?? 0) > 0;
      const orb = orbPositions(owned[ORBS] ?? 0, evolved, nowMs)[0] ?? PLAYER;
      return [{ id: 'e1', position: orb, ignited }];
    };

  it('deals contact damage and a heavy slow to an enemy touching an orb', () => {
    const owned = { [ORBS]: 1 };
    const effects = bySkill(tickWindow(owned, 16, 1_008, 16, ridingOrb(owned, false)), ORBS);
    const damage = effects
      .filter((effect) => effect.kind === 'damage' && targetOf(effect) === 'e1')
      .reduce((sum, effect) => sum + (effect.amount ?? 0), 0);
    expect(damage).toBeGreaterThan(0);
    const slow = effects.find((effect) => effect.kind === 'status' && targetOf(effect) === 'e1');
    expect(slow).toBeDefined();
    expect(slowOf(slow ?? ({} as ClassSkillEffect)) ?? 1).toBeLessThan(1);
  });

  it('leaves far enemies alone', () => {
    const far: readonly Target[] = [{ id: 'far', position: { x: 60, y: 34 } }];
    expect(bySkill(tickWindow({ [ORBS]: 3 }, 16, 1_008, 16, () => far), ORBS)).toHaveLength(0);
  });
});

describe('#86 Lôi Ngục (mage-storm-strike)', () => {
  const STRUCK: Vec2 = { x: 10, y: 10 };
  const enemies: readonly Target[] = [
    { id: 'struck', position: STRUCK },
    { id: 'near', position: { x: 12, y: 10 } },
    { id: 'far', position: { x: 30, y: 10 } },
  ];
  const hit = (stacks: number, roll: number): ClassSkillEffect[] =>
    bySkill(
      fire('onHit', { [STORM]: stacks }, {
        position: STRUCK,
        targetPosition: STRUCK,
        targetId: 'struck',
        shotCount: 1,
        enemies,
        rng: fixedRng(roll),
      }),
      STORM,
    );

  it('procs at 20% (+10% per stack)', () => {
    expect(hit(1, 0.19).length).toBeGreaterThan(0);
    expect(hit(1, 0.21)).toHaveLength(0);
    expect(hit(2, 0.29).length).toBeGreaterThan(0);
    expect(hit(2, 0.31)).toHaveLength(0);
    expect(hit(3, 0.39).length).toBeGreaterThan(0);
    expect(hit(3, 0.41)).toHaveLength(0);
  });

  it('drops the bolt on the enemy nearest the struck one', () => {
    const bolt = hit(1, 0).find((effect) => effect.kind === 'damage');
    expect(bolt).toBeDefined();
    expect(bolt?.position).toEqual({ x: 12, y: 10 });
    expect(targetOf(bolt ?? ({} as ClassSkillEffect))).toBe('near');
    expect(bolt?.amount ?? 0).toBeGreaterThan(0);
  });
});

describe('#86 Xung Năng Ma Pháp (mage-arcane-pulse)', () => {
  const STRUCK: Vec2 = { x: 14, y: 9 };
  const pulse = (stacks: number, shotCount: number): ClassSkillEffect[] =>
    bySkill(
      fire('onHit', { [PULSE]: stacks }, {
        position: STRUCK,
        targetPosition: STRUCK,
        targetId: 'struck',
        shotCount,
        enemies: [{ id: 'struck', position: STRUCK }],
      }),
      PULSE,
    ).filter((effect) => effect.kind === 'damage');

  it('blasts a 1.8-tile ring around the struck enemy on every 4th shot', () => {
    for (const shotCount of [4, 8, 12]) {
      const [ring] = pulse(1, shotCount);
      expect(ring).toBeDefined();
      expect(ring?.position).toEqual(STRUCK);
      expect(ring?.radiusTiles).toBe(1.8);
    }
    for (const shotCount of [1, 2, 3, 5, 7]) expect(pulse(1, shotCount)).toHaveLength(0);
  });

  it('hits harder per stack', () => {
    expect(pulse(3, 4)[0]?.amount ?? 0).toBeGreaterThan(pulse(1, 4)[0]?.amount ?? 0);
  });
});

describe('#86 Thiên Tai Nguyên Tố (mage-elemental-cataclysm)', () => {
  const evolved = { [METEOR]: 1, [ORBS]: 1, [EVO]: 1 };
  const base = { [METEOR]: 1, [ORBS]: 1 };

  it('requires mage-meteor + mage-frost-orbs', () => {
    expect(mage.MAGE_EVOLUTION.requires).toEqual([METEOR, ORBS]);
  });

  it('spins the orbs faster', () => {
    const sweep = (isEvolved: boolean): number => {
      const a = orbPositions(1, isEvolved, 0)[0] ?? PLAYER;
      const b = orbPositions(1, isEvolved, 50)[0] ?? PLAYER;
      const angle = (p: Vec2): number => Math.atan2(p.y - PLAYER.y, p.x - PLAYER.x);
      const delta = Math.abs(angle(b) - angle(a));
      return Math.min(delta, 2 * Math.PI - delta);
    };
    expect(sweep(true)).toBeGreaterThan(sweep(false));
  });

  it('makes the orbs fire ice shards at enemies out of contact', () => {
    const outOfContact: readonly Target[] = [{ id: 'mid', position: { x: PLAYER.x + 4, y: PLAYER.y } }];
    expect(bySkill(tickWindow(evolved, 16, 3_000, 16, () => outOfContact), EVO).length).toBeGreaterThan(0);
    expect(bySkill(tickWindow(base, 16, 3_000, 16, () => outOfContact), EVO)).toHaveLength(0);
  });

  it('shatter-burns: orb damage doubles on ignited foes only once evolved', () => {
    const orbDamage = (owned: Readonly<Record<string, number>>, ignited: boolean): number => {
      const isEvolved = (owned[EVO] ?? 0) > 0;
      return bySkill(
        tickWindow(owned, 16, 1_008, 16, (nowMs) => [
          { id: 'e1', position: orbPositions(1, isEvolved, nowMs)[0] ?? PLAYER, ignited },
        ]),
        ORBS,
      )
        .filter((effect) => effect.kind === 'damage' && targetOf(effect) === 'e1')
        .reduce((sum, effect) => sum + (effect.amount ?? 0), 0);
    };
    const evolvedPlain = orbDamage(evolved, false);
    const evolvedIgnited = orbDamage(evolved, true);
    expect(evolvedPlain).toBeGreaterThan(0);
    expect(evolvedIgnited).toBeGreaterThanOrEqual(evolvedPlain * 1.9);
    expect(evolvedIgnited).toBeLessThanOrEqual(evolvedPlain * 2.1);
    expect(orbDamage(base, true)).toBeCloseTo(orbDamage(base, false), 5);
  });
});

describe('#86 Mage VFX + SFX tables', () => {
  it('maps every Mage skill to a pooled fx.* entry, Meteor and Frost Orbs to their M19 art', () => {
    const fx = mageExports.MAGE_SKILL_FX;
    expect(fx).toBeDefined();
    for (const id of MAGE_IDS) {
      const key = fx?.[id];
      expect(key, `${id} has no FX`).toMatch(/^fx\./);
      expect(manifest.sprites[key ?? ''], `${key ?? id} missing from animations.json`).toBeDefined();
    }
    expect(fx?.[METEOR]).toBe('fx.meteor');
    expect(fx?.[ORBS]).toBe('fx.frost-orb');
  });

  it('gives every Mage skill an SFX from the bank', () => {
    const sfx = mageExports.MAGE_SKILL_SFX;
    expect(sfx).toBeDefined();
    for (const id of MAGE_IDS) {
      expect(Object.keys(SFX_BANK), `${id} has no SFX`).toContain(sfx?.[id]);
    }
  });
});

describe('#86 the simulation applies Mage skill effects', () => {
  const chapterOne = loadChapterOne();
  const standStill: InputPolicy = () => ({ up: false, down: false, left: false, right: false });
  const run = (skills: ReadonlyMap<string, number>): number =>
    simulateRun({
      seed: 86,
      characterId: 'mage',
      level: chapterOne,
      policy: standStill,
      godMode: true,
      skills,
      maxDurationMs: 60_000,
    }).kills;

  it('a full Mage kit kills more in 60 s than a bare Mage', () => {
    const kit = new Map<string, number>([
      [METEOR, 3],
      [ORBS, 3],
      [STORM, 3],
      [PULSE, 3],
      [EVO, 1],
    ]);
    expect(run(kit)).toBeGreaterThan(run(new Map()));
  });
});

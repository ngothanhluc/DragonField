/**
 * Ticket #83 acceptance (M20, GDD `docs/gdd/m19-m20-class-skills-and-art.md` §3, ADR-027):
 * class-scoped skill pool, roll, and the 16 class-exclusive skills + 4 Class Evolutions as data.
 *
 * Expected values (ids, Vietnamese names, rarity, max stacks, Evolution recipes) are copied from
 * the GDD §3 tables, not derived from the implementation.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHARACTER_IDS, type CharacterId } from '../../assets/scripts/core/characters/roster';
import { localizeSkillName } from '../../assets/scripts/core/i18n';
import { RUN_SAVE_VERSION, migrateRunSave } from '../../assets/scripts/core/save/run-save';
import { describeSkill } from '../../assets/scripts/core/skills/description';
import {
  EVOLUTIONS,
  evolutionHintsForSkill,
  findSkillOrEvolution,
  isEvolutionId,
} from '../../assets/scripts/core/skills/evolutions';
import { skillIconSheet } from '../../assets/scripts/core/skills/icons';
import { SkillLoadout } from '../../assets/scripts/core/skills/loadout';
import { SKILLS, type SkillDef } from '../../assets/scripts/core/skills/pool';
import {
  createSkillRollRng,
  hasAlternativeSkills,
  rerollChoices,
  rollChoices,
} from '../../assets/scripts/core/skills/roll';
import { simulateRun } from '../../sim/run-simulation';
import type { InputPolicy } from '../../sim/run-simulation';
import { loadChapterOne } from '../helpers/tmx-levels';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '../../assets');

interface ExpectedClassSkill {
  readonly id: string;
  readonly vi: string;
  readonly rarity: 'common' | 'rare' | 'epic' | 'legendary';
  readonly maxStacks: number;
}

interface ExpectedClass {
  readonly skills: readonly ExpectedClassSkill[];
  readonly evolution: ExpectedClassSkill & { readonly requires: readonly [string, string] };
}

/** GDD §3 tables, verbatim. */
const GDD: Readonly<Record<CharacterId, ExpectedClass>> = {
  ninja: {
    skills: [
      { id: 'ninja-shadow-clone', vi: 'Phân Thân Ám Ảnh', rarity: 'rare', maxStacks: 3 },
      { id: 'ninja-venom-shuriken', vi: 'Phi Tiêu Độc Vụ', rarity: 'rare', maxStacks: 3 },
      { id: 'ninja-kunai-burst', vi: 'Liên Hoàn Kunai', rarity: 'common', maxStacks: 3 },
      { id: 'ninja-smoke-bomb', vi: 'Bom Khói Ẩn Thân', rarity: 'epic', maxStacks: 2 },
    ],
    evolution: {
      id: 'ninja-phantom-assassin',
      vi: 'Ảnh Sát Tuyệt Kỹ',
      rarity: 'legendary',
      maxStacks: 1,
      requires: ['ninja-shadow-clone', 'ninja-kunai-burst'],
    },
  },
  archer: {
    skills: [
      { id: 'archer-arrow-rain', vi: 'Mưa Tên', rarity: 'rare', maxStacks: 3 },
      { id: 'archer-split-arrow', vi: 'Tên Tách Chùm', rarity: 'rare', maxStacks: 3 },
      { id: 'archer-hunters-mark', vi: 'Ấn Ký Săn Mồi', rarity: 'epic', maxStacks: 2 },
      { id: 'archer-wind-arrow', vi: 'Phong Tiễn', rarity: 'common', maxStacks: 3 },
    ],
    evolution: {
      id: 'archer-sky-tempest',
      vi: 'Thiên Tiễn Lôi Đình',
      rarity: 'legendary',
      maxStacks: 1,
      requires: ['archer-arrow-rain', 'archer-split-arrow'],
    },
  },
  mage: {
    skills: [
      { id: 'mage-meteor', vi: 'Thiên Thạch', rarity: 'epic', maxStacks: 3 },
      { id: 'mage-frost-orbs', vi: 'Vệ Tinh Băng', rarity: 'rare', maxStacks: 3 },
      { id: 'mage-storm-strike', vi: 'Lôi Ngục', rarity: 'rare', maxStacks: 3 },
      { id: 'mage-arcane-pulse', vi: 'Xung Năng Ma Pháp', rarity: 'common', maxStacks: 3 },
    ],
    evolution: {
      id: 'mage-elemental-cataclysm',
      vi: 'Thiên Tai Nguyên Tố',
      rarity: 'legendary',
      maxStacks: 1,
      requires: ['mage-meteor', 'mage-frost-orbs'],
    },
  },
  cultivator: {
    skills: [
      { id: 'cultivator-orbit-swords', vi: 'Ngự Kiếm Hộ Thể', rarity: 'rare', maxStacks: 3 },
      { id: 'cultivator-sword-array', vi: 'Kiếm Trận', rarity: 'epic', maxStacks: 2 },
      { id: 'cultivator-sword-qi', vi: 'Kiếm Khí Bán Nguyệt', rarity: 'common', maxStacks: 3 },
      { id: 'cultivator-qi-barrier', vi: 'Hộ Tâm Linh Khí', rarity: 'rare', maxStacks: 3 },
    ],
    evolution: {
      id: 'cultivator-myriad-swords',
      vi: 'Vạn Kiếm Quy Tông',
      rarity: 'legendary',
      maxStacks: 1,
      requires: ['cultivator-orbit-swords', 'cultivator-sword-array'],
    },
  },
};

const ALL_CLASS_ENTRIES: readonly (ExpectedClassSkill & { readonly owner: CharacterId })[] =
  CHARACTER_IDS.flatMap((owner) => [
    ...GDD[owner].skills.map((s) => ({ ...s, owner })),
    { ...GDD[owner].evolution, owner },
  ]);
const ALL_CLASS_IDS = ALL_CLASS_ENTRIES.map((e) => e.id);
const SHARED_IDS = new Set(SKILLS.map((s) => s.id));
const SHARED_EVOLUTION_IDS = new Set(EVOLUTIONS.map((e) => e.id));

function exclusiveIdsOf(owner: CharacterId): Set<string> {
  return new Set([...GDD[owner].skills.map((s) => s.id), GDD[owner].evolution.id]);
}

function lookup(id: string): SkillDef {
  const def = findSkillOrEvolution(id);
  expect(def, `${id} is not registered`).toBeDefined();
  return def as SkillDef;
}

/**
 * Every shared skill at max stacks and every shared Evolution owned, so only class cards
 * (if any) remain eligible.
 */
function sharedMaxed(): Map<string, number> {
  return new Map([
    ...SKILLS.map((s) => [s.id, s.maxStacks] as [string, number]),
    ...EVOLUTIONS.map((e) => [e.id, e.maxStacks] as [string, number]),
  ]);
}

describe('#83 class skill registry (GDD §3)', () => {
  it('registers all 16 class skills + 4 Class Evolutions with exact rarity, max stacks, owner and recipe', () => {
    expect(ALL_CLASS_IDS).toHaveLength(20);
    for (const entry of ALL_CLASS_ENTRIES) {
      const def = findSkillOrEvolution(entry.id);
      expect(def, `${entry.id} is not registered`).toBeDefined();
      if (def === undefined) continue;
      expect(def.rarity, entry.id).toBe(entry.rarity);
      expect(def.maxStacks, entry.id).toBe(entry.maxStacks);
      expect(def.characterId, entry.id).toBe(entry.owner);
    }
    for (const owner of CHARACTER_IDS) {
      const evo = findSkillOrEvolution(GDD[owner].evolution.id);
      expect(evo?.requires, GDD[owner].evolution.id).toEqual(GDD[owner].evolution.requires);
      expect(isEvolutionId(GDD[owner].evolution.id), GDD[owner].evolution.id).toBe(true);
    }
  });

  it('keeps shared skills and shared Evolutions owner-less', () => {
    for (const def of [...SKILLS, ...EVOLUTIONS]) {
      expect(def.characterId, def.id).toBeUndefined();
    }
  });

  it('gives every skill and Evolution a unique 2-character HUD code', () => {
    const defs = [...SKILLS, ...EVOLUTIONS, ...ALL_CLASS_IDS.map(lookup)];
    const shorts = defs.map((d) => d.short);
    for (const short of shorts) expect(short).toHaveLength(2);
    expect(new Set(shorts).size).toBe(shorts.length);
  });
});

describe('#83 icons and i18n cover all 20 class skills', () => {
  it('maps each class skill to its own staged 24×24 icon and Disabled variant', () => {
    const sheets = new Set<string>();
    for (const id of ALL_CLASS_IDS) {
      const sheet = skillIconSheet(id);
      const disabled = skillIconSheet(id, { disabled: true });
      expect(sheet).toBe(`resources/art/generated/icons/class-skills/${id}.png`);
      expect(disabled).toBe(`resources/art/generated/icons/class-skills/${id}-disabled.png`);
      expect(existsSync(join(ASSETS, sheet)), sheet).toBe(true);
      expect(existsSync(join(ASSETS, disabled)), disabled).toBe(true);
      sheets.add(sheet);
    }
    for (const def of [...SKILLS, ...EVOLUTIONS]) sheets.add(skillIconSheet(def.id));
    expect(sheets.size).toBe(SKILLS.length + EVOLUTIONS.length + 20);
  });

  it('names every class skill in vi (GDD names) and en, and describes it in both locales', () => {
    for (const entry of ALL_CLASS_ENTRIES) {
      const def = lookup(entry.id);
      expect(localizeSkillName(entry.id, def.name, 'vi')).toBe(entry.vi);
      const en = localizeSkillName(entry.id, def.name, 'en');
      expect(en, entry.id).toBe(def.name);
      expect(en.length, entry.id).toBeGreaterThan(0);
      expect(en, entry.id).not.toBe(entry.id);
      expect(en, entry.id).not.toBe(entry.vi);

      const descVi = describeSkill(def, 'vi');
      const descEn = describeSkill(def, 'en');
      expect(descVi.length, `${entry.id} vi description`).toBeGreaterThan(0);
      expect(descEn.length, `${entry.id} en description`).toBeGreaterThan(0);
      expect(descVi, entry.id).not.toBe(descEn);
    }
  });

  it('pairs each class skill with its Class Evolution in the pick-card hint', () => {
    for (const owner of CHARACTER_IDS) {
      const [a, b] = GDD[owner].evolution.requires;
      const hints = evolutionHintsForSkill(a, new Map([[b, 1]]), 'en');
      expect(hints.map((h) => h.evolution.id), a).toEqual([GDD[owner].evolution.id]);
      expect(hints[0]?.ready, a).toBe(true);
    }
  });
});

describe('#83 class-scoped roll (no cross-class leaks)', () => {
  const ROLLS = 3000;

  for (const owner of CHARACTER_IDS) {
    it(`${owner}: ${ROLLS} seeded rolls offer only shared cards and ${owner}'s own exclusives`, () => {
      const own = exclusiveIdsOf(owner);
      const seen = new Set<string>();
      const rng = createSkillRollRng(8300 + CHARACTER_IDS.indexOf(owner));
      for (let i = 0; i < ROLLS; i += 1) {
        for (const card of rollChoices({ rng, owned: new Map(), characterId: owner })) {
          expect(
            SHARED_IDS.has(card.id) || own.has(card.id),
            `${owner} was offered ${card.id}`,
          ).toBe(true);
          seen.add(card.id);
        }
      }
      for (const s of GDD[owner].skills) {
        expect(seen.has(s.id), `${owner} never offered ${s.id}`).toBe(true);
      }
    });

    it(`${owner}: rerolls stay class-scoped too`, () => {
      const own = exclusiveIdsOf(owner);
      const rng = createSkillRollRng(8310 + CHARACTER_IDS.indexOf(owner));
      const seen = new Set<string>();
      let previous: readonly SkillDef[] = rollChoices({
        rng,
        owned: sharedMaxed(),
        characterId: owner,
      });
      for (let i = 0; i < 500; i += 1) {
        previous = rerollChoices({ rng, owned: sharedMaxed(), previous, characterId: owner });
        for (const card of previous) {
          expect(own.has(card.id), `${owner} reroll offered ${card.id}`).toBe(true);
          seen.add(card.id);
        }
      }
      expect(seen.size, `${owner} reroll never surfaced its exclusives`).toBeGreaterThan(0);
    });
  }

  it('rolls no class cards when no character is given (shop / legacy callers)', () => {
    const rng = createSkillRollRng(83);
    expect(rollChoices({ rng, owned: sharedMaxed(), includeEvolutions: false })).toEqual([]);
  });

  it('reports reroll alternatives from the class pool when the shared pool is exhausted', () => {
    for (const owner of CHARACTER_IDS) {
      expect(hasAlternativeSkills(sharedMaxed(), [], owner), owner).toBe(true);
    }
  });
});

describe('#83 Class Evolution unlocks exactly on its own two prerequisites', () => {
  function offeredIn(
    owner: CharacterId,
    owned: ReadonlyMap<string, number>,
    rolls: number,
    seed: number,
  ): Set<string> {
    const rng = createSkillRollRng(seed);
    const seen = new Set<string>();
    for (let i = 0; i < rolls; i += 1) {
      for (const card of rollChoices({ rng, owned, characterId: owner })) seen.add(card.id);
    }
    return seen;
  }

  for (const owner of CHARACTER_IDS) {
    const evo = GDD[owner].evolution;
    const [a, b] = evo.requires;

    it(`${owner}: ${evo.id} rolls only once ${a} + ${b} are both owned`, () => {
      expect(offeredIn(owner, new Map([[a, 1]]), 1000, 1).has(evo.id)).toBe(false);
      expect(offeredIn(owner, new Map([[b, 1]]), 1000, 2).has(evo.id)).toBe(false);
      expect(
        offeredIn(
          owner,
          new Map([
            [a, 1],
            [b, 1],
          ]),
          40,
          3,
        ).has(evo.id),
      ).toBe(true);
      // Owned already (max 1 stack) → never offered again.
      expect(
        offeredIn(
          owner,
          new Map([
            [a, 1],
            [b, 1],
            [evo.id, 1],
          ]),
          1000,
          4,
        ).has(evo.id),
      ).toBe(false);
    });

    it(`${owner}: another class's Evolution never rolls even if its prerequisites are owned`, () => {
      for (const other of CHARACTER_IDS) {
        if (other === owner) continue;
        const otherEvo = GDD[other].evolution;
        const owned = new Map(otherEvo.requires.map((id) => [id, 1] as [string, number]));
        const seen = offeredIn(owner, owned, 300, 5);
        expect(seen.has(otherEvo.id), `${owner} was offered ${otherEvo.id}`).toBe(false);
      }
    });
  }
});

describe('#83 stack caps hold for class skills', () => {
  for (const owner of CHARACTER_IDS) {
    it(`${owner}: maxed exclusives are never offered and acquire clamps to max stacks`, () => {
      const owned = new Map<string, number>(sharedMaxed());
      for (const s of GDD[owner].skills) owned.set(s.id, s.maxStacks);
      owned.set(GDD[owner].evolution.id, 1);
      const rng = createSkillRollRng(830);
      for (let i = 0; i < 1000; i += 1) {
        expect(rollChoices({ rng, owned, characterId: owner })).toEqual([]);
      }

      const loadout = new SkillLoadout();
      for (const s of GDD[owner].skills) {
        const result = loadout.acquire(s.id, 99);
        expect(result.acquired, s.id).toBe(true);
        expect(loadout.stacks(s.id), s.id).toBe(s.maxStacks);
      }
    });
  }
});

describe('#83 run save/restore keeps owned class skills', () => {
  it('migrates class skills (clamped), drops unknown ids, and restores them into the loadout', () => {
    const save = migrateRunSave({
      version: RUN_SAVE_VERSION,
      seed: 83,
      chapter: 1,
      roomIndex: 3,
      chosenDoor: 'xp',
      drawnRooms: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      bossId: 'tengu',
      characterId: 'ninja',
      hearts: 80,
      maxHearts: 100,
      xpLevel: 5,
      xpCurrent: 3,
      xpTotal: 60,
      pendingLevelUps: 0,
      ownedSkills: {
        sharpen: 2,
        'ninja-shadow-clone': 2,
        'ninja-kunai-burst': 1,
        'ninja-smoke-bomb': 9,
        'ninja-phantom-assassin': 1,
        'bogus-skill': 3,
      },
      rerollsUsed: 0,
      freeRerollsLeft: 0,
      goldEarned: 10,
      kills: 20,
      elapsedMs: 60_000,
      ascension: 0,
      endlessLoop: 0,
    });
    expect(save).not.toBeNull();
    if (save === null) return;
    expect(save.ownedSkills).toEqual({
      sharpen: 2,
      'ninja-shadow-clone': 2,
      'ninja-kunai-burst': 1,
      'ninja-smoke-bomb': 2,
      'ninja-phantom-assassin': 1,
    });

    const loadout = SkillLoadout.from(new Map(Object.entries(save.ownedSkills)));
    expect(loadout.stacks('ninja-shadow-clone')).toBe(2);
    expect(loadout.stacks('ninja-smoke-bomb')).toBe(2);
    expect(loadout.stacks('ninja-phantom-assassin')).toBe(1);
    expect(loadout.allEntries.map((e) => e.def.id).sort()).toEqual(
      [
        'ninja-kunai-burst',
        'ninja-phantom-assassin',
        'ninja-shadow-clone',
        'ninja-smoke-bomb',
        'sharpen',
      ].sort(),
    );
  });
});

describe('#83 the run simulation rolls the class pool of its character', () => {
  const chapterOne = loadChapterOne();
  const standStill: InputPolicy = () => ({ up: false, down: false, left: false, right: false });

  for (const owner of ['mage', 'archer'] as const) {
    it(`${owner}: level-up offers include ${owner} exclusives and no other class's`, () => {
      const own = exclusiveIdsOf(owner);
      const offered: string[] = [];
      for (const seed of [7, 8]) {
        const result = simulateRun({
          seed,
          characterId: owner,
          level: chapterOne,
          policy: standStill,
          godMode: true,
          chooseSkill: () => 0,
        });
        for (const event of result.events) {
          if (event.kind === 'level-up') offered.push(...event.offers);
        }
      }
      expect(offered.length).toBeGreaterThan(0);
      for (const id of offered) {
        expect(
          SHARED_IDS.has(id) || SHARED_EVOLUTION_IDS.has(id) || own.has(id),
          `${owner} sim offered ${id}`,
        ).toBe(true);
      }
      expect(offered.some((id) => own.has(id)), `${owner} sim never offered an exclusive`).toBe(
        true,
      );
    });
  }
});

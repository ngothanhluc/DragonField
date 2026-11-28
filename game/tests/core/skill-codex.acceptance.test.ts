/**
 * Ticket #88 acceptance (M20, GDD `docs/gdd/m19-m20-class-skills-and-art.md` §4, ADR-027):
 * the Character Detail & Skill Codex view-model in `core/view/skill-codex.ts`.
 *
 * Per class it must expose: base HP, weapon form, attack speed, Nội Tại (Passive),
 * Tuyệt Kỹ [E] (Signature Active) with cooldown, the 4 class-exclusive skills and the Class
 * Evolution recipe, plus the lock state. Locked characters stay fully inspectable.
 *
 * Expected values are copied from the issue (HP `100 / 85 / 85 / 120`), the GDD §3 tables (ids,
 * Vietnamese names, recipes), `config/tuning.json` as of this ticket (fire-rate multipliers,
 * signature cooldowns) and the i18n tables, not recomputed the way the code will compute them.
 *
 * The module is loaded dynamically so a missing module fails on an assertion, not on import.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { CHARACTER_IDS, type CharacterId } from '../../assets/scripts/core/characters/roster';
import type { Locale } from '../../assets/scripts/core/i18n';
import { createDefaultSave, type SaveData } from '../../assets/scripts/core/save/save-data';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '../../assets');

// --- Expected API of core/view/skill-codex.ts -------------------------------------------------

type CodexLockStatus = 'selected' | 'unlocked' | 'locked';
type CodexWeaponForm = 'projectile' | 'hand' | 'back';

interface CodexSkillEntry {
  readonly id: string;
  /** Localized skill name. */
  readonly name: string;
  /** Localized mechanic text (same text the 1-of-3 pick card shows). */
  readonly description: string;
  /** Resources path of the 24×24 icon (`skillIconSheet(id)`). */
  readonly iconSheet: string;
  readonly rarity: 'common' | 'rare' | 'epic' | 'legendary';
  readonly maxStacks: number;
}

interface CodexRecipeIngredient {
  readonly id: string;
  readonly name: string;
}

interface CodexEvolutionEntry extends CodexSkillEntry {
  /** The two class skills that unlock this Evolution, in the Evolution's `requires` order. */
  readonly recipe: readonly [CodexRecipeIngredient, CodexRecipeIngredient];
}

interface CharacterCodexView {
  readonly id: CharacterId;
  readonly name: string;
  /** `icon.portrait-<id>` manifest key for the 64×64 portrait. */
  readonly portraitKey: string;
  readonly lock: {
    readonly status: CodexLockStatus;
    readonly unlocked: boolean;
    /** Localized unlock status / requirement (`characterUnlockReason`). */
    readonly reason: string;
  };
  readonly stats: {
    /** Base max HP before meta upgrades. */
    readonly maxHp: number;
    readonly weaponForm: CodexWeaponForm;
    /** Base auto-fire shots per second before meta upgrades and skills. */
    readonly attacksPerSecond: number;
    /** Localized one-line weapon summary. */
    readonly weaponLine: string;
  };
  readonly passive: {
    readonly heading: string;
    readonly name: string;
    readonly description: string;
  };
  readonly active: {
    readonly heading: string;
    readonly key: 'E';
    readonly name: string;
    readonly description: string;
    /** Base Signature cooldown from tuning (before the Mage passive's multiplier). */
    readonly cooldownMs: number;
    /** Localized cooldown text, e.g. `10s`. */
    readonly cooldownLabel: string;
  };
  readonly exclusives: {
    readonly heading: string;
    readonly skills: readonly CodexSkillEntry[];
    readonly evolution: CodexEvolutionEntry;
  };
}

interface SkillCodexModule {
  buildCharacterCodex(id: CharacterId, save: SaveData, locale: Locale): CharacterCodexView;
  buildSkillCodex(save: SaveData, locale: Locale): readonly CharacterCodexView[];
}

let codexModule: SkillCodexModule | null = null;

beforeAll(async () => {
  try {
    codexModule = (await import(
      '../../assets/scripts/core/view/skill-codex'
    )) as unknown as SkillCodexModule;
  } catch {
    codexModule = null;
  }
});

function lib(): SkillCodexModule {
  expect(
    codexModule,
    'core/view/skill-codex.ts must exist and export buildCharacterCodex / buildSkillCodex',
  ).not.toBeNull();
  if (codexModule === null) throw new Error('unreachable');
  return codexModule;
}

function codex(id: CharacterId, save: SaveData = createDefaultSave(), locale: Locale = 'vi') {
  return lib().buildCharacterCodex(id, save, locale);
}

// --- Expected data --------------------------------------------------------------------------

interface ExpectedClass {
  readonly maxHp: number;
  readonly weaponForm: CodexWeaponForm;
  readonly attacksPerSecond: number;
  readonly cooldownMs: number;
  readonly cooldownSeconds: RegExp;
  readonly name: { readonly vi: string; readonly en: string };
  readonly passive: { readonly vi: string; readonly en: string };
  readonly signature: { readonly vi: string; readonly en: string };
  readonly skills: readonly { readonly id: string; readonly vi: string; readonly rarity: string; readonly maxStacks: number }[];
  readonly evolution: { readonly id: string; readonly vi: string; readonly recipe: readonly [string, string] };
}

const EXPECTED: Readonly<Record<CharacterId, ExpectedClass>> = {
  ninja: {
    maxHp: 100,
    weaponForm: 'projectile',
    attacksPerSecond: 2,
    cooldownMs: 20000,
    cooldownSeconds: /\b20\s?s\b/,
    name: { vi: 'Ninja', en: 'Ninja' },
    passive: { vi: 'Linh Hoạt Bóng Đêm', en: 'Shadow Agility' },
    signature: { vi: 'Mưa Phi Tiêu Bóng', en: 'Shadow Barrage' },
    skills: [
      { id: 'ninja-shadow-clone', vi: 'Phân Thân Ám Ảnh', rarity: 'rare', maxStacks: 3 },
      { id: 'ninja-venom-shuriken', vi: 'Phi Tiêu Độc Vụ', rarity: 'rare', maxStacks: 3 },
      { id: 'ninja-kunai-burst', vi: 'Liên Hoàn Kunai', rarity: 'common', maxStacks: 3 },
      { id: 'ninja-smoke-bomb', vi: 'Bom Khói Ẩn Thân', rarity: 'epic', maxStacks: 2 },
    ],
    evolution: {
      id: 'ninja-phantom-assassin',
      vi: 'Ảnh Sát Tuyệt Kỹ',
      recipe: ['ninja-shadow-clone', 'ninja-kunai-burst'],
    },
  },
  archer: {
    maxHp: 85,
    weaponForm: 'hand',
    attacksPerSecond: 1.8,
    cooldownMs: 19000,
    cooldownSeconds: /\b19\s?s\b/,
    name: { vi: 'Cung Thủ', en: 'Archer' },
    passive: { vi: 'Ưng Nhãn', en: 'Keen Sight' },
    signature: { vi: 'Loạt Tên Xuyên Phá', en: 'Piercing Volley' },
    skills: [
      { id: 'archer-arrow-rain', vi: 'Mưa Tên', rarity: 'rare', maxStacks: 3 },
      { id: 'archer-split-arrow', vi: 'Tên Tách Chùm', rarity: 'rare', maxStacks: 3 },
      { id: 'archer-hunters-mark', vi: 'Ấn Ký Săn Mồi', rarity: 'epic', maxStacks: 2 },
      { id: 'archer-wind-arrow', vi: 'Phong Tiễn', rarity: 'common', maxStacks: 3 },
    ],
    evolution: {
      id: 'archer-sky-tempest',
      vi: 'Thiên Tiễn Lôi Đình',
      recipe: ['archer-arrow-rain', 'archer-split-arrow'],
    },
  },
  mage: {
    maxHp: 85,
    weaponForm: 'hand',
    attacksPerSecond: 1.7,
    cooldownMs: 21000,
    cooldownSeconds: /\b21\s?s\b/,
    name: { vi: 'Pháp Sư', en: 'Mage' },
    passive: { vi: 'Cộng Hưởng Bí Thuật', en: 'Arcane Attunement' },
    signature: { vi: 'Bùng Nổ Bí Thuật', en: 'Arcane Nova' },
    skills: [
      { id: 'mage-meteor', vi: 'Thiên Thạch', rarity: 'epic', maxStacks: 3 },
      { id: 'mage-frost-orbs', vi: 'Vệ Tinh Băng', rarity: 'rare', maxStacks: 3 },
      { id: 'mage-storm-strike', vi: 'Lôi Ngục', rarity: 'rare', maxStacks: 3 },
      { id: 'mage-arcane-pulse', vi: 'Xung Năng Ma Pháp', rarity: 'common', maxStacks: 3 },
    ],
    evolution: {
      id: 'mage-elemental-cataclysm',
      vi: 'Thiên Tai Nguyên Tố',
      recipe: ['mage-meteor', 'mage-frost-orbs'],
    },
  },
  cultivator: {
    maxHp: 120,
    weaponForm: 'back',
    attacksPerSecond: 1.9,
    cooldownMs: 22000,
    cooldownSeconds: /\b22\s?s\b/,
    name: { vi: 'Tu Tiên', en: 'Cultivator' },
    passive: { vi: 'Kiếm Tâm', en: 'Sword Heart' },
    signature: { vi: 'Vạn Kiếm Quy Tông', en: 'Ten Thousand Swords' },
    skills: [
      { id: 'cultivator-orbit-swords', vi: 'Ngự Kiếm Hộ Thể', rarity: 'rare', maxStacks: 3 },
      { id: 'cultivator-sword-array', vi: 'Kiếm Trận', rarity: 'epic', maxStacks: 2 },
      { id: 'cultivator-sword-qi', vi: 'Kiếm Khí Bán Nguyệt', rarity: 'common', maxStacks: 3 },
      { id: 'cultivator-qi-barrier', vi: 'Hộ Tâm Linh Khí', rarity: 'rare', maxStacks: 3 },
    ],
    evolution: {
      id: 'cultivator-myriad-swords',
      vi: 'Vạn Kiếm Quy Tông',
      recipe: ['cultivator-orbit-swords', 'cultivator-sword-array'],
    },
  },
};

const CLASS_ICON_DIR = 'resources/art/generated/icons/class-skills';

// --- Tests ----------------------------------------------------------------------------------

describe('#88 Skill Codex: whole roster', () => {
  it('buildSkillCodex lists all 4 classes in roster order, in both locales', () => {
    for (const locale of ['vi', 'en'] as const) {
      const views = lib().buildSkillCodex(createDefaultSave(), locale);
      expect(views.map((view) => view.id)).toEqual(['ninja', 'archer', 'mage', 'cultivator']);
      for (const view of views) {
        expect(view).toEqual(lib().buildCharacterCodex(view.id, createDefaultSave(), locale));
      }
    }
  });
});

describe.each(CHARACTER_IDS.map((id) => [id] as const))('#88 Skill Codex: %s', (id) => {
  const expected = EXPECTED[id];

  it('shows name, portrait, base HP, weapon form and attack speed', () => {
    const vi = codex(id, createDefaultSave(), 'vi');
    const en = codex(id, createDefaultSave(), 'en');
    expect(vi.id).toBe(id);
    expect(vi.name).toBe(expected.name.vi);
    expect(en.name).toBe(expected.name.en);
    expect(vi.portraitKey).toBe(`icon.portrait-${id}`);
    expect(vi.stats.maxHp).toBe(expected.maxHp);
    expect(vi.stats.weaponForm).toBe(expected.weaponForm);
    expect(vi.stats.attacksPerSecond).toBeCloseTo(expected.attacksPerSecond, 4);
    expect(vi.stats.weaponLine.length).toBeGreaterThan(0);
    expect(en.stats.weaponLine.length).toBeGreaterThan(0);
    expect(vi.stats.weaponLine).not.toBe(en.stats.weaponLine);
  });

  it('shows the Nội Tại (Passive) card', () => {
    const vi = codex(id, createDefaultSave(), 'vi');
    const en = codex(id, createDefaultSave(), 'en');
    expect(vi.passive.heading).toContain('Nội Tại');
    expect(en.passive.heading).toMatch(/passive/i);
    expect(vi.passive.name).toBe(expected.passive.vi);
    expect(en.passive.name).toBe(expected.passive.en);
    expect(vi.passive.description.length).toBeGreaterThan(0);
    expect(en.passive.description.length).toBeGreaterThan(0);
    expect(vi.passive.description).not.toBe(en.passive.description);
  });

  it('shows the Tuyệt Kỹ [E] (Signature Active) card with its cooldown', () => {
    const vi = codex(id, createDefaultSave(), 'vi');
    const en = codex(id, createDefaultSave(), 'en');
    expect(vi.active.heading).toContain('Tuyệt Kỹ');
    expect(vi.active.heading).toContain('[E]');
    expect(en.active.heading).toMatch(/signature/i);
    expect(en.active.heading).toContain('[E]');
    expect(vi.active.key).toBe('E');
    expect(vi.active.name).toBe(expected.signature.vi);
    expect(en.active.name).toBe(expected.signature.en);
    expect(vi.active.description.length).toBeGreaterThan(0);
    expect(vi.active.description).not.toBe(en.active.description);
    expect(vi.active.cooldownMs).toBe(expected.cooldownMs);
    expect(vi.active.cooldownLabel).toMatch(expected.cooldownSeconds);
    expect(en.active.cooldownLabel).toMatch(expected.cooldownSeconds);
  });

  it('lists exactly its 4 class-exclusive skills (icons, names, descriptions), never another class', () => {
    const vi = codex(id, createDefaultSave(), 'vi');
    const en = codex(id, createDefaultSave(), 'en');
    expect(vi.exclusives.heading).toContain('Bộ Kỹ Năng Độc Quyền');
    expect(en.exclusives.heading).toMatch(/exclusive/i);
    expect(vi.exclusives.skills.map((skill) => skill.id)).toEqual(
      expected.skills.map((skill) => skill.id),
    );
    expected.skills.forEach((want, index) => {
      const skill = vi.exclusives.skills[index]!;
      const skillEn = en.exclusives.skills[index]!;
      expect(skill.name).toBe(want.vi);
      expect(skill.rarity).toBe(want.rarity);
      expect(skill.maxStacks).toBe(want.maxStacks);
      expect(skill.description.length).toBeGreaterThan(0);
      expect(skillEn.name.length).toBeGreaterThan(0);
      expect(skillEn.name).not.toBe(skill.name);
      expect(skillEn.description).not.toBe(skill.description);
      expect(skill.iconSheet).toBe(`${CLASS_ICON_DIR}/${want.id}.png`);
      expect(existsSync(join(ASSETS, skill.iconSheet)), skill.iconSheet).toBe(true);
    });
  });

  it('shows the Class Evolution and its 2-skill recipe', () => {
    const vi = codex(id, createDefaultSave(), 'vi');
    const evo = vi.exclusives.evolution;
    expect(evo.id).toBe(expected.evolution.id);
    expect(evo.name).toBe(expected.evolution.vi);
    expect(evo.rarity).toBe('legendary');
    expect(evo.maxStacks).toBe(1);
    expect(evo.description.length).toBeGreaterThan(0);
    expect(evo.iconSheet).toBe(`${CLASS_ICON_DIR}/${expected.evolution.id}.png`);
    expect(existsSync(join(ASSETS, evo.iconSheet)), evo.iconSheet).toBe(true);
    expect(evo.recipe.map((part) => part.id)).toEqual(expected.evolution.recipe);
    const namesById = new Map(expected.skills.map((skill) => [skill.id, skill.vi]));
    expect(evo.recipe.map((part) => part.name)).toEqual(
      expected.evolution.recipe.map((partId) => namesById.get(partId)),
    );
  });
});

describe('#88 Skill Codex: lock state', () => {
  it('default save: Ninja is selected, the other 3 are locked but stay fully inspectable', () => {
    const save = createDefaultSave();
    const ninja = codex('ninja', save, 'vi');
    expect(ninja.lock).toMatchObject({ status: 'selected', unlocked: true });
    expect(ninja.lock.reason).toBe('Mở sẵn từ đầu');

    for (const id of ['archer', 'mage', 'cultivator'] as const) {
      const view = codex(id, save, 'vi');
      expect(view.lock.status).toBe('locked');
      expect(view.lock.unlocked).toBe(false);
      expect(view.stats.maxHp).toBe(EXPECTED[id].maxHp);
      expect(view.passive.name).toBe(EXPECTED[id].passive.vi);
      expect(view.active.name).toBe(EXPECTED[id].signature.vi);
      expect(view.exclusives.skills).toHaveLength(4);
      expect(view.exclusives.evolution.id).toBe(EXPECTED[id].evolution.id);
    }
    expect(codex('archer', save, 'vi').lock.reason).toBe('Vượt Chương 1 hoặc mua 120 vàng');
    expect(codex('archer', save, 'en').lock.reason.length).toBeGreaterThan(0);
  });

  it('follows the dual unlock rules: chapter clear OR early gold purchase', () => {
    const base = createDefaultSave();
    const save: SaveData = {
      ...base,
      chaptersUnlocked: 2, // Ch1 cleared → Archer unlocked by chapter
      unlockedCharacters: ['ninja', 'mage'], // Mage bought early
      selectedCharacter: 'mage',
    };
    expect(codex('ninja', save).lock).toMatchObject({ status: 'unlocked', unlocked: true });
    expect(codex('archer', save).lock).toMatchObject({ status: 'unlocked', unlocked: true });
    expect(codex('archer', save, 'vi').lock.reason).toBe('Đã mở (Vượt Chương 1)');
    expect(codex('mage', save).lock).toMatchObject({ status: 'selected', unlocked: true });
    expect(codex('mage', save, 'vi').lock.reason).toBe('Đã mở (Đã mua)');
    expect(codex('cultivator', save).lock).toMatchObject({ status: 'locked', unlocked: false });
  });

  it('a corrupt selection of a locked character falls back to Ninja as selected', () => {
    const save: SaveData = { ...createDefaultSave(), selectedCharacter: 'cultivator' };
    expect(codex('ninja', save).lock.status).toBe('selected');
    expect(codex('cultivator', save).lock.status).toBe('locked');
  });
});

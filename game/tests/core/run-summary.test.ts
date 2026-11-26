import { describe, expect, it } from 'vitest';
import { BOSS_IDS } from '../../assets/scripts/core/boss/boss-defs';
import { ENEMY_ROLES } from '../../assets/scripts/core/level/level-data';
import {
  formatBuildSummary,
  formatDeathCause,
  formatRunUnlocks,
  type DeathCause,
} from '../../assets/scripts/core/run/run-summary';

describe('formatDeathCause', () => {
  it('formats regular and elite enemy melee/contact kills in Vietnamese (default) and English', () => {
    expect(formatDeathCause({ kind: 'enemy', role: 'chaser' })).toBe('Bị hạ bởi Quái Đuổi');
    expect(formatDeathCause({ kind: 'enemy', role: 'tank', elite: true })).toBe(
      'Bị hạ bởi Giáp Sĩ Tinh Anh',
    );
    expect(formatDeathCause({ kind: 'enemy', role: 'chaser' }, 'en')).toBe('Slain by Chaser');
    expect(formatDeathCause({ kind: 'enemy', role: 'tank', elite: true }, 'en')).toBe(
      'Slain by Elite Tank',
    );
    for (const role of ENEMY_ROLES) {
      expect(formatDeathCause({ kind: 'enemy', role }, 'en')).toMatch(/^Slain by [A-Z]/);
      expect(formatDeathCause({ kind: 'enemy', role }, 'vi')).toMatch(/^Bị hạ bởi /);
    }
  });

  it('formats enemy bullets and bomber blasts', () => {
    expect(formatDeathCause({ kind: 'enemy-bullet', role: 'caster' }, 'en')).toBe(
      'Slain by Caster bullet',
    );
    expect(formatDeathCause({ kind: 'enemy-bullet', role: 'sniper' }, 'en')).toBe(
      'Slain by Sniper bullet',
    );
    expect(formatDeathCause({ kind: 'enemy-bullet' }, 'en')).toBe('Slain by enemy bullet');
    expect(formatDeathCause({ kind: 'bomber-blast' }, 'en')).toBe('Slain by Bomber blast');
    expect(formatDeathCause({ kind: 'bomber-blast', elite: true }, 'en')).toBe(
      'Slain by Elite Bomber blast',
    );
    expect(formatDeathCause({ kind: 'bomber-blast', elite: true })).toBe(
      'Bị hạ bởi Cảm Tử Tinh Anh',
    );
  });

  it('formats boss kills with optional phase for every BossId', () => {
    expect(formatDeathCause({ kind: 'boss', bossId: 'tengu', phase: 2 })).toBe(
      'Bị hạ bởi Thiên Cẩu (Giai đoạn 2)',
    );
    expect(formatDeathCause({ kind: 'boss', bossId: 'tengu', phase: 2 }, 'en')).toBe(
      'Slain by Tengu (Phase 2)',
    );
    expect(formatDeathCause({ kind: 'boss', bossId: 'racoon' }, 'en')).toBe(
      'Slain by Giant Racoon',
    );
    for (const bossId of BOSS_IDS) {
      expect(formatDeathCause({ kind: 'boss', bossId, phase: 3 }, 'en')).toContain('(Phase 3)');
      expect(formatDeathCause({ kind: 'boss', bossId, phase: 3 }, 'vi')).toContain('(Giai đoạn 3)');
    }
  });

  it('formats victory and unknown causes', () => {
    const victory: DeathCause = { kind: 'victory' };
    const unknown: DeathCause = { kind: 'unknown' };
    expect(formatDeathCause(victory)).toBe('Vượt chương thành công!');
    expect(formatDeathCause(unknown)).toBe('Ngã xuống trong chiến đấu');
    expect(formatDeathCause(victory, 'en')).toBe('Chapter Cleared!');
    expect(formatDeathCause(unknown, 'en')).toBe('Defeated in combat');
  });
});

describe('formatBuildSummary', () => {
  it('returns localized empty build line when empty or containing only zero/unknown entries', () => {
    expect(formatBuildSummary(new Map())).toEqual(['Kỹ năng: Không']);
    expect(formatBuildSummary(new Map(), {}, 'en')).toEqual(['Build: None']);
    expect(
      formatBuildSummary(
        new Map([
          ['sharpen', 0],
          ['nonexistent-skill', 3],
        ]),
        {},
        'en',
      ),
    ).toEqual(['Build: None']);
  });

  it('lists Legendary Evolutions prominently before base skills with stack counts', () => {
    const owned = new Map<string, number>([
      ['sharpen', 3],
      ['twin-shot', 2],
      ['piercing', 1],
      ['phantom-volley', 1],
      ['rapid-fire', 2],
    ]);

    const viLines = formatBuildSummary(owned);
    expect(viLines[0]).toBe('Tiến hóa: Loạt Đạn Ảo Ảnh');
    expect(viLines[1]).toContain('Kỹ năng: ');
    for (const line of viLines) {
      expect(line.length).toBeLessThanOrEqual(54);
    }

    const lines = formatBuildSummary(owned, {}, 'en');
    expect(lines[0]).toBe('Evolutions: Phantom Volley');
    expect(lines[1]).toContain('Skills: ');
    const skillText = lines.slice(1).join(' ');
    expect(skillText).toContain('Sharpen x3');
    expect(skillText).toContain('Rapid Fire x2');
    expect(skillText).toContain('Twin Shot x2');
    expect(skillText).toContain('Piercing x1');
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(54);
    }
  });

  it('ranks top skills by stack count descending, then rarity, keeping lines compact', () => {
    const owned = new Map<string, number>([
      ['sharpen', 4],
      ['rapid-fire', 3],
      ['crit-eye', 3],
      ['ricochet', 2],
      ['chain-lightning', 2],
      ['lifesteal', 2],
      ['swift', 1],
      ['vitality', 1],
      ['phantom-dash', 1],
      ['shield', 1],
      ['cataclysm', 1],
      ['blightfrost', 1],
    ]);

    const lines = formatBuildSummary(owned, {}, 'en');
    expect(lines[0]).toBe('Evolutions: Cataclysm, Blightfrost');
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(54);
    }
    const skillText = lines.slice(1).join(' ');
    expect(skillText).toContain('Sharpen x4');
    expect(skillText).toContain('more)');
  });

  it('clamps oversized stack counts to each skill maxStacks', () => {
    const owned = new Map<string, number>([['homing', 9]]);
    expect(formatBuildSummary(owned)).toEqual(['Kỹ năng: Truy Đuổi x1']);
    expect(formatBuildSummary(owned, {}, 'en')).toEqual(['Skills: Homing x1']);
  });
});

describe('formatRunUnlocks', () => {
  it('returns empty array when nothing was unlocked', () => {
    expect(formatRunUnlocks({})).toEqual([]);
    expect(formatRunUnlocks({ unlockedCharacters: [], endlessUnlocked: false })).toEqual([]);
  });

  it('formats chapter, character(s), ascension, and endless unlocks cleanly in both locales', () => {
    expect(
      formatRunUnlocks({
        unlockedChapter: 2,
        unlockedCharacters: ['archer'],
        unlockedAscension: { chapter: 1, level: 1 },
      }),
    ).toEqual([
      'Mở khóa Chương 2!',
      'Mở khóa tướng: Cung Thủ',
      'Mở khóa: Ch1 Thăng Hoa 1',
    ]);

    expect(
      formatRunUnlocks(
        {
          unlockedChapter: 2,
          unlockedCharacters: ['archer'],
          unlockedAscension: { chapter: 1, level: 1 },
        },
        'en',
      ),
    ).toEqual([
      'Chapter 2 unlocked!',
      'Hero unlocked: Archer',
      'Unlocked: Ch1 Ascension 1',
    ]);

    expect(
      formatRunUnlocks(
        {
          unlockedCharacters: ['mage', 'cultivator'],
          unlockedAscension: { chapter: 4, level: 3 },
          endlessUnlocked: true,
        },
        'en',
      ),
    ).toEqual([
      'Heroes unlocked: Mage, Cultivator',
      'Unlocked: Ch4 Ascension 3',
      'Endless Mode unlocked!',
    ]);
  });
});

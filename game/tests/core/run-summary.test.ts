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
  it('formats regular and elite enemy melee/contact kills', () => {
    expect(formatDeathCause({ kind: 'enemy', role: 'chaser' })).toBe('Slain by Chaser');
    expect(formatDeathCause({ kind: 'enemy', role: 'tank', elite: true })).toBe(
      'Slain by Elite Tank',
    );
    for (const role of ENEMY_ROLES) {
      expect(formatDeathCause({ kind: 'enemy', role })).toMatch(/^Slain by [A-Z]/);
    }
  });

  it('formats enemy bullets and bomber blasts', () => {
    expect(formatDeathCause({ kind: 'enemy-bullet', role: 'caster' })).toBe(
      'Slain by Caster bullet',
    );
    expect(formatDeathCause({ kind: 'enemy-bullet', role: 'sniper' })).toBe(
      'Slain by Sniper bullet',
    );
    expect(formatDeathCause({ kind: 'enemy-bullet' })).toBe('Slain by enemy bullet');
    expect(formatDeathCause({ kind: 'bomber-blast' })).toBe('Slain by Bomber blast');
    expect(formatDeathCause({ kind: 'bomber-blast', elite: true })).toBe(
      'Slain by Elite Bomber blast',
    );
  });

  it('formats boss kills with optional phase for every BossId', () => {
    expect(formatDeathCause({ kind: 'boss', bossId: 'tengu', phase: 2 })).toBe(
      'Slain by Tengu (Phase 2)',
    );
    expect(formatDeathCause({ kind: 'boss', bossId: 'racoon' })).toBe('Slain by Giant Racoon');
    for (const bossId of BOSS_IDS) {
      const text = formatDeathCause({ kind: 'boss', bossId, phase: 3 });
      expect(text).toContain('(Phase 3)');
    }
  });

  it('formats victory and unknown causes', () => {
    const victory: DeathCause = { kind: 'victory' };
    const unknown: DeathCause = { kind: 'unknown' };
    expect(formatDeathCause(victory)).toBe('Chapter Cleared!');
    expect(formatDeathCause(unknown)).toBe('Defeated in combat');
  });
});

describe('formatBuildSummary', () => {
  it('returns Build: None when empty or containing only zero/unknown entries', () => {
    expect(formatBuildSummary(new Map())).toEqual(['Build: None']);
    expect(
      formatBuildSummary(
        new Map([
          ['sharpen', 0],
          ['nonexistent-skill', 3],
        ]),
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

    const lines = formatBuildSummary(owned);
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
      ['executioner', 2],
      ['chain-lightning', 2],
      ['lifesteal', 2],
      ['swift', 1],
      ['vitality', 1],
      ['thorns', 1],
      ['shield', 1],
      ['cataclysm', 1],
      ['blightfrost', 1],
    ]);

    const lines = formatBuildSummary(owned);
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
    expect(formatBuildSummary(owned)).toEqual(['Skills: Homing x1']);
  });
});

describe('formatRunUnlocks', () => {
  it('returns empty array when nothing was unlocked', () => {
    expect(formatRunUnlocks({})).toEqual([]);
    expect(formatRunUnlocks({ unlockedCharacters: [], endlessUnlocked: false })).toEqual([]);
  });

  it('formats chapter, character(s), ascension, and endless unlocks cleanly', () => {
    expect(
      formatRunUnlocks({
        unlockedChapter: 2,
        unlockedCharacters: ['archer'],
        unlockedAscension: { chapter: 1, level: 1 },
      }),
    ).toEqual([
      'Chapter 2 unlocked!',
      'Hero unlocked: Archer',
      'Unlocked: Ch1 Ascension 1',
    ]);

    expect(
      formatRunUnlocks({
        unlockedCharacters: ['mage', 'cultivator'],
        unlockedAscension: { chapter: 4, level: 3 },
        endlessUnlocked: true,
      }),
    ).toEqual([
      'Heroes unlocked: Mage, Cultivator',
      'Unlocked: Ch4 Ascension 3',
      'Endless Mode unlocked!',
    ]);
  });
});

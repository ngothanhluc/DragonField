import { describe, expect, it } from 'vitest';
import { DEFAULT_COMBAT } from '../../assets/scripts/core/config';
import { describeSkill, skillAbbreviation } from '../../assets/scripts/core/skills/description';
import { SkillLoadout, pickupHeal } from '../../assets/scripts/core/skills/loadout';
import { SKILLS, getSkill } from '../../assets/scripts/core/skills/pool';
import { estimateDps } from '../../assets/scripts/core/skills/derived-stats';

describe('SkillLoadout', () => {
  it('acquire cộng stack và dừng ở maxStacks', () => {
    const loadout = new SkillLoadout();

    expect(loadout.acquire('sharpen').stacks).toBe(1);
    expect(loadout.acquire('sharpen', 3).stacks).toBe(4);
    expect(loadout.acquire('sharpen', 99)).toMatchObject({ added: 1, stacks: 5 });
    expect(loadout.acquire('sharpen')).toMatchObject({ acquired: false, added: 0, stacks: 5 });
    expect(loadout.stacks('sharpen')).toBe(5);
  });

  it('id lạ là no-op, không ném', () => {
    const loadout = new SkillLoadout();
    expect(loadout.acquire('khong-ton-tai')).toEqual({
      acquired: false,
      added: 0,
      stacks: 0,
      healNow: 0,
    });
    expect(loadout.size).toBe(0);
  });

  it('Vitality hồi 1 tim mỗi stack ngay lúc nhặt, không phải chỉ số thường trực', () => {
    const loadout = new SkillLoadout();
    expect(loadout.acquire('vitality').healNow).toBe(1);
    expect(loadout.acquire('vitality', 2).healNow).toBe(2);
    expect(loadout.acquire('rapid-fire').healNow).toBe(0);
    expect(pickupHeal(getSkill('vitality'))).toBe(1);
  });

  it('stats = computeDerivedStats của đúng map đang sở hữu', () => {
    const loadout = SkillLoadout.from(new Map([['sharpen', 2], ['rapid-fire', 2]]));
    const stats = loadout.stats();

    expect(stats.damage).toBe(DEFAULT_COMBAT.damage + 2);
    expect(stats.fireRatePerSecond).toBeCloseTo(DEFAULT_COMBAT.fireRatePerSecond * 1.5, 10);
    expect(estimateDps(stats)).toBeCloseTo(3 * 3, 10);
  });

  it('from() kẹp stack hỏng thay vì mang vào run', () => {
    const loadout = SkillLoadout.from(new Map([['sharpen', 99], ['twin-shot', -2], ['la', 3]]));
    expect(loadout.stacks('sharpen')).toBe(5);
    expect(loadout.stacks('twin-shot')).toBe(0);
    expect(loadout.stacks('la')).toBe(0);
  });

  it('snapshot là bản sao: sửa bên ngoài không đổi loadout', () => {
    const loadout = SkillLoadout.from(new Map([['sharpen', 1]]));
    const snapshot = loadout.snapshot() as Map<string, number>;
    snapshot.set('sharpen', 5);

    expect(loadout.stacks('sharpen')).toBe(1);
  });
});

describe('Skill description', () => {
  it('mọi skill trong pool đều có mô tả và chữ viết tắt', () => {
    for (const skill of SKILLS) {
      expect(describeSkill(skill).length, skill.id).toBeGreaterThan(0);
      expect(skillAbbreviation(skill), skill.id).toMatch(/^[A-Z0-9?]{1,2}$/);
    }
  });

  it('mô tả lấy số từ tag, không hardcode', () => {
    // Sharpen 1 stack = +1 damage; 5 stack vẫn cùng chữ (UI tự thêm ×N).
    expect(describeSkill(getSkill('sharpen'))).toContain('+1 damage');
    expect(describeSkill(getSkill('rapid-fire'))).toContain('+25% fire rate');
    expect(describeSkill(getSkill('twin-shot'))).toContain('±12°');
    expect(describeSkill(getSkill('shield'))).toContain('20s');
    expect(describeSkill(getSkill('executioner'))).toContain('30%');
    expect(describeSkill(getSkill('poison'))).toContain('3s');
  });

  it('chữ viết tắt HUD dễ đọc và không trùng nhau', () => {
    expect(skillAbbreviation(getSkill('rapid-fire'))).toBe('RF');
    expect(skillAbbreviation(getSkill('long-iframe'))).toBe('IF');
    expect(skillAbbreviation(getSkill('crit-eye'))).toBe('CE');

    const codes = SKILLS.map(skillAbbreviation);
    expect(new Set(codes).size).toBe(SKILLS.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z0-9]{2}$/);
  });
});

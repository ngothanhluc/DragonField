/**
 * Chữ hiển thị cho skill trong màn chọn 1/3 và HUD.
 *
 * Nội dung suy ra từ `tags` của pool, không viết tay từng skill: thêm skill mới
 * = thêm tag, mô tả tự có. Con số lấy đúng từ tag nên tooltip không thể nói
 * "15% crit" trong khi derived-stats cộng 10%.
 */
import type { SkillDef, SkillTag } from './pool';

/** Góc xoè của Twin Shot, độ — khớp `shot-effects.ts`. */
export const TWIN_SPREAD_DEGREES = 12;

/**
 * Một dòng mô tả **mỗi stack** của skill. Nhiều tag thì nối bằng " · ".
 * Không chứa số stack hiện có — UI tự ghép "×N" để dòng chữ ngắn.
 */
export function describeSkill(def: SkillDef): string {
  return def.tags.map(describeTag).join(' · ');
}

/**
 * Chữ ngắn cho HUD (2 ký tự). Lấy từ `SkillDef.short`, viết tay vì initials tự
 * động bị trùng: Sharpen/Shield đều "SH", Swift/Second Wind đều "SW",
 * Explosive/Executioner đều "EX".
 */
export function skillAbbreviation(def: SkillDef): string {
  return def.short;
}

/** Chữ mô tả một tag, tính cho một stack. */
export function describeTag(tag: SkillTag): string {
  switch (tag.kind) {
    case 'damage-add':
      return `+${formatNumber(tag.amount)} damage`;
    case 'fire-rate-mult':
      return `+${formatPercent(tag.amount)} fire rate`;
    case 'projectile-add':
      return `+${formatNumber(tag.amount)} projectile (±${TWIN_SPREAD_DEGREES}°)`;
    case 'pierce-add':
      return 'Bullets pierce +1 enemy';
    case 'crit-chance':
      return `+${formatPercent(tag.chance)} crit (×${formatNumber(tag.multiplier)})`;
    case 'max-hearts':
      return `+${formatNumber(tag.amount)} max heart (heals 1)`;
    case 'heal-per-room':
      return `Heal ${formatNumber(tag.amount)} hearts on room clear`;
    case 'shield':
      return `Block 1 hit (back in ${formatSeconds(tag.cooldownMs)})`;
    case 'thorns':
      return `Touching enemies take ${formatNumber(tag.damage)} damage`;
    case 'move-speed-mult':
      return `+${formatPercent(tag.amount)} move speed`;
    case 'iframe-mult':
      return `+${formatPercent(tag.amount - 1)} i-frame time`;
    case 'slow-on-hit':
      return `Hits slow ${formatPercent(1 - tag.factor)} for ${formatSeconds(tag.durationMs)}`;
    case 'poison':
      return `Poison ${formatNumber(tag.dps)}/s for ${formatSeconds(tag.durationMs)}`;
    case 'lifesteal':
      return `Heal ${formatPercent(tag.percent)} of damage`;
    case 'gold-mult':
      return `+${formatPercent(tag.amount)} gold`;
    case 'luck-add':
      return `+${formatPercent(tag.amount)} rare/epic chance`;
    case 'execute':
      return `+${formatPercent(tag.bonus)} damage below ${formatPercent(tag.threshold)} HP`;
    case 'ricochet-add':
      return `Bullets bounce to ${formatNumber(tag.bounces)} more enemy`;
    case 'homing-add':
      return 'Bullets home in on enemies';
    case 'explosive':
      return `Explode ${formatNumber(tag.radiusTiles)} tiles for ${formatPercent(tag.damageRatio)} damage`;
  }
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** 20 000 ms → "20s"; 500 → "0.5s". */
function formatSeconds(value: number): string {
  const seconds = value / 1000;
  return `${Number.isInteger(seconds) ? seconds : Math.round(seconds * 10) / 10}s`;
}

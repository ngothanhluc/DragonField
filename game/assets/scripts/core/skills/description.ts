/**
 * Display text for skills and Legendary Evolutions on the 1-of-3 pick screen and the HUD.
 *
 * Content derives from the pool's `tags`, not hand-written per skill: adding a skill or Evolution
 * = adding tags, and the description follows automatically.
 */
import type { SkillDef, SkillTag } from './pool';

/** Twin Shot spread angle, degrees — matches `shot-effects.ts`. */
export const TWIN_SPREAD_DEGREES = 12;

/**
 * One description line for **each stack** of a skill or Evolution. Multiple tags join with " · ".
 * Does not include the current stack count — the UI appends "×N" or stack lines separately.
 */
export function describeSkill(def: SkillDef): string {
  return def.tags.map(describeTag).join(' · ');
}

/**
 * Short HUD text (2 characters). Comes from `SkillDef.short`, hand-written so every
 * skill and Evolution has a unique 2-character code.
 */
export function skillAbbreviation(def: SkillDef): string {
  return def.short;
}

/** Description text for one tag, computed for one stack. */
export function describeTag(tag: SkillTag): string {
  switch (tag.kind) {
    case 'damage-add':
      return `+${formatNumber(tag.amount)} damage`;
    case 'fire-rate-mult':
      return `+${formatPercent(tag.amount)} fire rate`;
    case 'projectile-add': {
      const noun = tag.amount === 1 ? 'projectile' : 'projectiles';
      return `+${formatNumber(tag.amount)} ${noun} (±${TWIN_SPREAD_DEGREES}°)`;
    }
    case 'pierce-add': {
      const amount = tag.amount ?? 1;
      const noun = amount === 1 ? 'enemy' : 'enemies';
      return `Bullets pierce +${formatNumber(amount)} ${noun}`;
    }
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
    case 'burn':
      return `Burn ${formatNumber(tag.dps)}/s for ${formatSeconds(tag.durationMs)}`;
    case 'shock-arc':
      return `Chain lightning ${formatNumber(tag.arcs)} foes (${formatPercent(tag.damageRatio)})`;
    case 'status-amp':
      return `+${formatPercent(tag.bonusRatio)} dmg vs afflicted foes`;
    case 'lifesteal':
      return `Heal ${formatPercent(tag.percent)} of damage`;
    case 'execute':
      return `+${formatPercent(tag.bonus)} damage below ${formatPercent(tag.threshold)} HP`;
    case 'ricochet-add': {
      const noun = tag.bounces === 1 ? 'enemy' : 'enemies';
      return `Bullets bounce to ${formatNumber(tag.bounces)} more ${noun}`;
    }
    case 'homing-add':
      return 'Bullets home in on enemies';
    case 'explosive':
      return `Explode ${formatNumber(tag.radiusTiles)}t (+${formatPercent(tag.damageRatio)} dmg)`;
    case 'damage-reduction':
      return `${formatPercent(tag.chance)} ward chance`;
    case 'shield-recharge-mult':
      return `-${formatPercent(1 - tag.factor)} shield cooldown`;
    case 'dash-cooldown-mult':
      return `-${formatPercent(1 - tag.factor)} dash cooldown`;
    case 'dash-speed-mult':
      return `+${formatPercent(tag.amount)} dash speed`;
    case 'dash-nova':
      return `Dash burst ${formatNumber(tag.damage)} dmg (${formatNumber(tag.radiusTiles)}t)`;
    case 'post-dash-fire-rate':
      return `+${formatPercent(tag.bonus)} post-dash fire (${formatSeconds(tag.durationMs)})`;
    case 'active-cooldown-mult':
      return `-${formatPercent(1 - tag.factor)} active cooldown`;
    case 'active-power-mult':
      return `+${formatPercent(tag.amount)} active power`;
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

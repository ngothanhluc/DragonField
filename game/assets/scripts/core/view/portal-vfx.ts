/**
 * Pure Portal VFX color palettes, vortex kinematics, and rising particle math (M17, ADR-025).
 *
 * Zero `cc` imports — `game/door-view.ts` drives multi-layer animated North Portal nodes directly
 * from these pure functions so every destination color, ring rotation, and particle loop is
 * deterministic and unit-tested.
 */
import { portalDestinationKind, type DoorReward, type PortalDestinationKind } from '../run/doors';

export interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface PortalPalette {
  readonly kind: PortalDestinationKind;
  /** Primary portal tint (label, outer energy ring, edge arrow). */
  readonly primary: RgbColor;
  /** Secondary vortex swirl & core accent colour. */
  readonly secondary: RgbColor;
  /** Soft ambient glow halo colour. */
  readonly glow: RgbColor;
  /** Bright particle / activation burst flash colour. */
  readonly spark: RgbColor;
}

export const PORTAL_PALETTES: Readonly<Record<PortalDestinationKind, PortalPalette>> = {
  /** Normal combat portal: jade / arcane cyan swirl. */
  normal: {
    kind: 'normal',
    primary: { r: 84, g: 242, b: 224 },
    secondary: { r: 64, g: 196, b: 255 },
    glow: { r: 44, g: 214, b: 204 },
    spark: { r: 210, g: 255, b: 252 },
  },
  /** Special Room portal (Shop / Chest / Heal): radiant warm gold swirl. */
  special: {
    kind: 'special',
    primary: { r: 255, g: 214, b: 92 },
    secondary: { r: 255, g: 168, b: 64 },
    glow: { r: 255, g: 204, b: 78 },
    spark: { r: 255, g: 248, b: 196 },
  },
  /** Boss portal: intense crimson / violet lightning swirl with pulsing warning aura. */
  boss: {
    kind: 'boss',
    primary: { r: 255, g: 76, b: 92 },
    secondary: { r: 192, g: 82, b: 255 },
    glow: { r: 232, g: 52, b: 84 },
    spark: { r: 255, g: 206, b: 220 },
  },
};

export function portalPaletteFor(reward: DoorReward): PortalPalette {
  return PORTAL_PALETTES[portalDestinationKind(reward)];
}

/** Number of pooled upward-drifting luminous particles per portal (0 runtime allocations). */
export const PORTAL_PARTICLE_COUNT = 10;

export interface PortalVortexFrame {
  /** Outer ring rotation angle in degrees (clockwise). */
  readonly outerAngleDeg: number;
  /** Inner ring rotation angle in degrees (counter-clockwise). */
  readonly innerAngleDeg: number;
  /** Uniform scale multiplier for the breathing aura halo (`1.0` under Reduced effects). */
  readonly auraScale: number;
  /** Aura opacity `0..255` (static under Reduced effects). */
  readonly auraAlpha: number;
  /** Archway frame index `0..frameCount-1` for `fx.portal-gate` (`4` frames). */
  readonly gateFrameIndex: number;
}

const OUTER_DEG_PER_SEC = 52;
const INNER_DEG_PER_SEC = -96;
const GATE_FPS = 8;

/** Pure animation state of the multi-layer portal at `elapsedSec`. */
export function portalVortexFrame(
  elapsedSec: number,
  kind: PortalDestinationKind,
  reducedEffects: boolean,
  gateFrames = 4,
): PortalVortexFrame {
  const safeSec = Number.isFinite(elapsedSec) ? Math.max(0, elapsedSec) : 0;
  const frames = Math.max(1, Math.floor(gateFrames));
  const speedMult = kind === 'boss' ? 1.45 : kind === 'special' ? 1.15 : 1;

  if (reducedEffects) {
    return {
      outerAngleDeg: 0,
      innerAngleDeg: 0,
      auraScale: 1,
      auraAlpha: kind === 'boss' ? 120 : 95,
      gateFrameIndex: 0,
    };
  }

  const pulseFreq = kind === 'boss' ? 5.2 : 3.2;
  const pulse = 0.5 + 0.5 * Math.sin(safeSec * pulseFreq);

  return {
    outerAngleDeg: (safeSec * OUTER_DEG_PER_SEC * speedMult) % 360,
    innerAngleDeg: (safeSec * INNER_DEG_PER_SEC * speedMult) % 360,
    auraScale: 0.94 + pulse * (kind === 'boss' ? 0.22 : 0.14),
    auraAlpha: Math.round((kind === 'boss' ? 95 : 70) + pulse * (kind === 'boss' ? 95 : 65)),
    gateFrameIndex: Math.floor(safeSec * GATE_FPS * speedMult) % frames,
  };
}

export interface PortalParticlePose {
  /** Local X offset in world tiles relative to portal centre. */
  readonly x: number;
  /** Local Y offset in world tiles relative to portal centre (y up). */
  readonly y: number;
  /** Scale multiplier `0..1`. */
  readonly scale: number;
  /** Alpha `0..255`. */
  readonly alpha: number;
}

/**
 * Pure deterministic pose for one pooled upward-drifting luminous particle inside the portal.
 * Cycles smoothly with zero allocations.
 */
export function portalParticlePose(
  index: number,
  count: number,
  elapsedSec: number,
): PortalParticlePose {
  const safeCount = Math.max(1, count);
  const safeSec = Number.isFinite(elapsedSec) ? Math.max(0, elapsedSec) : 0;
  const periodSec = 1.45 + (index % 3) * 0.25;
  const phaseOffset = index / safeCount;
  const t = (safeSec / periodSec + phaseOffset) % 1;

  const lane = ((index * 0.61803398875) % 1) * 2 - 1;
  const sway = Math.sin(t * Math.PI * 2 + index * 1.7) * 0.14;
  const x = lane * 0.65 + sway;
  const y = -0.65 + t * 1.85;

  // Fade in quickly at bottom, stay crisp in middle, fade out smoothly near top.
  const fadeIn = Math.min(1, t / 0.18);
  const fadeOut = Math.min(1, (1 - t) / 0.35);
  const lifeAlpha = Math.max(0, Math.min(fadeIn, fadeOut));

  return {
    x,
    y,
    scale: 0.55 + 0.45 * (1 - t * 0.5),
    alpha: Math.round(lifeAlpha * 235),
  };
}

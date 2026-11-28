/**
 * Ticket #108 acceptance: Signature Active (E) nerf + once-per-cast hitstop for active-skill hits.
 *
 * Expected numbers are copied from the ticket, not recomputed from the old values.
 */
import { describe, expect, it } from "vitest";
import {
  activeSkillConfigFor,
  SIGNATURE_SPECS,
} from "../../assets/scripts/core/input/active-skill";
import {
  ACTIVE_SKILL_TUNING,
  CHARACTERS_TUNING,
} from "../../assets/scripts/core/enemies/tuning";
import type * as HitHitstop from "../../assets/scripts/core/combat/hit-hitstop";

type HitHitstopModule = typeof HitHitstop;

/** Loaded lazily so a missing module fails as an assertion, not as a file-level import error. */
async function loadHitHitstop(): Promise<HitHitstopModule> {
  const mod =
    await import("../../assets/scripts/core/combat/hit-hitstop").catch(
      () => null,
    );
  expect(
    mod,
    "core/combat/hit-hitstop.ts must exist and export the hitstop helper",
  ).not.toBeNull();
  return mod as HitHitstopModule;
}

describe("#108 Signature Active nerf (characters.*.signature)", () => {
  it("cuts damageMultiplier by 20% for all 4 characters (mage nova too)", () => {
    expect(CHARACTERS_TUNING.ninja.signature.damageMultiplier).toBeCloseTo(
      1.2,
      9,
    );
    expect(CHARACTERS_TUNING.archer.signature.damageMultiplier).toBeCloseTo(
      1.68,
      9,
    );
    expect(CHARACTERS_TUNING.mage.signature.damageMultiplier).toBeCloseTo(
      1.08,
      9,
    );
    expect(CHARACTERS_TUNING.mage.signature.novaDamageMultiplier).toBeCloseTo(
      2.56,
      9,
    );
    expect(CHARACTERS_TUNING.cultivator.signature.damageMultiplier).toBeCloseTo(
      1.08,
      9,
    );
  });

  it("doubles cooldownMs for all 4 characters", () => {
    expect(CHARACTERS_TUNING.ninja.signature.cooldownMs).toBe(20000);
    expect(CHARACTERS_TUNING.archer.signature.cooldownMs).toBe(19000);
    expect(CHARACTERS_TUNING.mage.signature.cooldownMs).toBe(21000);
    expect(CHARACTERS_TUNING.cultivator.signature.cooldownMs).toBe(22000);
  });

  it("removes hit and kill cooldown reduction for all 4 characters", () => {
    for (const id of ["ninja", "archer", "mage", "cultivator"] as const) {
      expect(CHARACTERS_TUNING[id].signature.hitCooldownReductionMs, id).toBe(
        0,
      );
      expect(CHARACTERS_TUNING[id].signature.killCooldownReductionMs, id).toBe(
        0,
      );
    }
  });

  it("flows through the Signature specs and recharge configs the game reads", () => {
    expect(activeSkillConfigFor("shadow-barrage")).toEqual({
      cooldownMs: 20000,
      hitCooldownReductionMs: 0,
      killCooldownReductionMs: 0,
    });
    expect(activeSkillConfigFor("piercing-volley").cooldownMs).toBe(19000);
    expect(activeSkillConfigFor("arcane-nova").cooldownMs).toBe(21000);
    expect(activeSkillConfigFor("ten-thousand-swords").cooldownMs).toBe(22000);
    expect(SIGNATURE_SPECS["shadow-barrage"].damageMultiplier).toBeCloseTo(
      1.2,
      9,
    );
    expect(SIGNATURE_SPECS["piercing-volley"].damageMultiplier).toBeCloseTo(
      1.68,
      9,
    );
  });

  it("keeps the mage passive active-cooldown modifier (×0.8)", () => {
    expect(CHARACTERS_TUNING.mage.passive.activeCooldownMult).toBe(0.8);
  });

  it("syncs the top-level activeSkill block", () => {
    expect(ACTIVE_SKILL_TUNING.cooldownMs).toBe(20000);
    expect(ACTIVE_SKILL_TUNING.hitCooldownReductionMs).toBe(0);
    expect(ACTIVE_SKILL_TUNING.killCooldownReductionMs).toBe(0);
    expect(ACTIVE_SKILL_TUNING.barrageDamageMultiplier).toBeCloseTo(1.2, 9);
  });
});

describe("#108 hitstop for player hits (core/combat/hit-hitstop.ts)", () => {
  const DURATIONS = { normalMs: 70, critMs: 110 };

  it("isRealCrit compares a bullet against its own base damage", async () => {
    const { isRealCrit } = await loadHitHitstop();
    // Ninja blade with player damage 10: base = 10 × 1.2 = 12. Not a crit (the old check said yes).
    expect(isRealCrit(12, 12)).toBe(false);
    expect(isRealCrit(10, 10)).toBe(false);
    // A normal shot rolled crit ×2 at fire time.
    expect(isRealCrit(20, 10)).toBe(true);
  });

  it("a Signature cast requests hitstop only on its first hit (70 ms when not a crit)", async () => {
    const { PlayerHitHitstop } = await loadHitHitstop();
    const gate = new PlayerHitHitstop(DURATIONS);
    const blade = { damage: 12, baseDamage: 12, signatureCastId: 1 };
    expect(gate.hitstopFor(blade)).toBe(70);
    expect(gate.hitstopFor(blade)).toBe(0);
    expect(gate.hitstopFor(blade)).toBe(0);
  });

  it("a Signature cast whose first hit is a real crit requests 110 ms, then nothing", async () => {
    const { PlayerHitHitstop } = await loadHitHitstop();
    const gate = new PlayerHitHitstop(DURATIONS);
    expect(
      gate.hitstopFor({ damage: 24, baseDamage: 12, signatureCastId: 7 }),
    ).toBe(110);
    expect(
      gate.hitstopFor({ damage: 24, baseDamage: 12, signatureCastId: 7 }),
    ).toBe(0);
  });

  it("each new cast gets its own first-hit hitstop", async () => {
    const { PlayerHitHitstop } = await loadHitHitstop();
    const gate = new PlayerHitHitstop(DURATIONS);
    expect(
      gate.hitstopFor({ damage: 12, baseDamage: 12, signatureCastId: 1 }),
    ).toBe(70);
    expect(
      gate.hitstopFor({ damage: 12, baseDamage: 12, signatureCastId: 1 }),
    ).toBe(0);
    expect(
      gate.hitstopFor({ damage: 12, baseDamage: 12, signatureCastId: 2 }),
    ).toBe(70);
    expect(
      gate.hitstopFor({ damage: 12, baseDamage: 12, signatureCastId: 2 }),
    ).toBe(0);
  });

  it("normal (non-Signature) shots keep hitstop on every hit: 70 ms, 110 ms on a real crit", async () => {
    const { PlayerHitHitstop } = await loadHitHitstop();
    const gate = new PlayerHitHitstop(DURATIONS);
    const shot = { damage: 10, baseDamage: 10, signatureCastId: null };
    expect(gate.hitstopFor(shot)).toBe(70);
    expect(gate.hitstopFor(shot)).toBe(70);
    expect(
      gate.hitstopFor({ damage: 20, baseDamage: 10, signatureCastId: null }),
    ).toBe(110);
    expect(
      gate.hitstopFor({ damage: 20, baseDamage: 10, signatureCastId: null }),
    ).toBe(110);
  });

  it("reset() forgets which casts already stopped (room change)", async () => {
    const { PlayerHitHitstop } = await loadHitHitstop();
    const gate = new PlayerHitHitstop(DURATIONS);
    expect(
      gate.hitstopFor({ damage: 12, baseDamage: 12, signatureCastId: 3 }),
    ).toBe(70);
    gate.reset();
    expect(
      gate.hitstopFor({ damage: 12, baseDamage: 12, signatureCastId: 3 }),
    ).toBe(70);
  });
});

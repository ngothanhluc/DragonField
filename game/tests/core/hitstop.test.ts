import { describe, expect, it } from 'vitest';
import { HitstopClock } from '../../assets/scripts/core/combat/hitstop';
import { isTelegraphElapsed } from '../../assets/scripts/core/combat/telegraph';
import { DEFAULT_COMBAT } from '../../assets/scripts/core/config';
import { HealthState } from '../../assets/scripts/core/combat/health';

/** Vòng lặp mô phỏng 16 ms/frame, giống `core/sim/run-simulation.ts`. */
const FRAME_MS = 16;

describe('HitstopClock — đóng băng thời gian mô phỏng', () => {
  it('70 ms đầu không chạy mô phỏng, sau đó chạy bình thường', () => {
    const clock = new HitstopClock(DEFAULT_COMBAT.enemyHitstopMs);
    expect(DEFAULT_COMBAT.enemyHitstopMs).toBe(70);

    clock.request();

    let simulationMs = 0;
    let realMs = 0;
    const advances: number[] = [];
    while (realMs < 160) {
      const sim = clock.step(FRAME_MS);
      realMs += FRAME_MS;
      simulationMs += sim;
      advances.push(sim);
    }

    // 70 ms đầu bị ăn (4 frame × 16 = 64, frame thứ 5 trả 10 ms còn lại).
    expect(advances.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(advances[4]).toBe(10);
    // Tổng mô phỏng = thời gian thật − 70 ms, không mất frame nào.
    expect(simulationMs).toBe(realMs - 70);
    expect(clock.isFrozen).toBe(false);
  });

  it('nhiều yêu cầu chồng nhau lấy max, không cộng dồn thành 140 ms', () => {
    const clock = new HitstopClock(70);
    clock.request();
    clock.request();
    clock.request();

    expect(clock.remaining).toBe(70);
  });

  it('frame thật dài hơn phần còn lại không bị mất thời gian', () => {
    const clock = new HitstopClock(70);
    clock.request();

    expect(clock.step(50)).toBe(0);
    // Còn 20 ms đóng băng; frame 50 ms trả 30 ms mô phỏng.
    expect(clock.step(50)).toBe(30);
    expect(clock.remaining).toBe(0);
  });

  it('request lúc đang đóng băng kéo dài tới max(remaining, request)', () => {
    const clock = new HitstopClock(70);
    clock.request(70);
    clock.step(30);
    expect(clock.remaining).toBe(40);

    clock.request(70);
    expect(clock.remaining).toBe(70);
  });

  it('reset bỏ đóng băng; request(0) không làm gì', () => {
    const clock = new HitstopClock(70);
    clock.request(70);
    clock.reset();
    expect(clock.isFrozen).toBe(false);
    expect(clock.step(16)).toBe(16);

    clock.request(0);
    expect(clock.isFrozen).toBe(false);
  });

  it('tham số âm hoặc không hữu hạn bị từ chối', () => {
    expect(() => new HitstopClock(-1)).toThrow();
    expect(() => new HitstopClock(Number.NaN)).toThrow();

    const clock = new HitstopClock(70);
    expect(() => clock.request(-1)).toThrow();
    expect(() => clock.step(-1)).toThrow();
  });
});

describe('hitstop không desync timer (telegraph, i-frame)', () => {
  it('telegraph và i-frame cùng đứng yên trong hitstop, rồi cùng chạy tiếp', () => {
    const clock = new HitstopClock(70);
    const health = new HealthState(DEFAULT_COMBAT);
    const telegraphStartedMs = 1000;

    // Đồng hồ mô phỏng dùng chung cho mọi hệ, đúng như `CombatLoop`.
    let nowMs = telegraphStartedMs;
    const telegraphTotalMs = 500;

    health.tryDamage(1, nowMs);
    expect(health.isInvulnerable(nowMs + 100)).toBe(true);

    // Player vừa bắn trúng enemy ⇒ hitstop; 4 frame tiếp theo mô phỏng không chạy.
    clock.request();
    for (let frame = 0; frame < 4; frame += 1) {
      const simMs = clock.step(FRAME_MS);
      nowMs += simMs;
    }

    // 64 ms thật trôi qua nhưng nowMs chỉ nhích 0.
    expect(nowMs).toBe(telegraphStartedMs);
    expect(isTelegraphElapsed(telegraphStartedMs, nowMs, telegraphTotalMs)).toBe(false);
    expect(health.isInvulnerable(nowMs)).toBe(true);

    // Chạy tiếp cho tới khi cả telegraph lẫn i-frame (800 ms) đều hết, trên **một**
    // đồng hồ duy nhất — không hệ nào "nhanh hơn" vì hitstop.
    let realMs = 0;
    const targetMs = Math.max(telegraphTotalMs, DEFAULT_COMBAT.invulnerabilityMs + 1);
    while (nowMs - telegraphStartedMs < targetMs) {
      nowMs += clock.step(FRAME_MS);
      realMs += FRAME_MS;
    }

    expect(isTelegraphElapsed(telegraphStartedMs, nowMs, telegraphTotalMs)).toBe(true);
    expect(health.isInvulnerable(nowMs + 1)).toBe(false);
    // Thời gian thật = thời gian mô phỏng + 70 ms hitstop (làm tròn lên frame).
    expect(realMs).toBeGreaterThanOrEqual(targetMs);
    expect(realMs).toBeLessThanOrEqual(targetMs + 70 + FRAME_MS);
  });
});

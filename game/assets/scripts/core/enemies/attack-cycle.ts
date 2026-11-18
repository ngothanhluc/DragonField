/**
 * Timing of the **attack cycle** (`EnemyState.actionStartedMs`) after an action
 * changes. Split out as a pure function because this is where an invisible bug came from: if the
 * adapter reset this timestamp on **every** action change, the stagger (150 ms after each projectile,
 * while the player fires 2 shots/second) would restart the cooldown constantly and the enemy
 * would **never attack** — only visible when actually playing.
 *
 * Rules:
 *
 * - Starting a telegraph ⇒ new timestamp (a telegraph begins an attack cycle).
 * - **Releasing** the attack (telegraph → idle/charge) ⇒ new timestamp. A telegraph cut short
 *   by a stagger does **not** count as releasing the attack (see `attackReleased`).
 * - Every other transition (walk ↔ idle, charge → idle, → stagger, stagger → …)
 *   **keeps** the timestamp, so the cooldown keeps running through the stun.
 */
import type { EnemyAction } from './behaviours';

/** What `actionStartedMs` should be when the action changes from `previous` to `next` at `nowMs`. */
export function nextActionStartedMs(
  previous: EnemyAction,
  next: EnemyAction,
  nowMs: number,
  currentStartedMs: number,
): number {
  const enteringTelegraph = next.kind === 'telegraph' && previous.kind !== 'telegraph';
  const released =
    previous.kind === 'telegraph' && (next.kind === 'idle' || next.kind === 'charge');
  return enteringTelegraph || released ? nowMs : currentStartedMs;
}

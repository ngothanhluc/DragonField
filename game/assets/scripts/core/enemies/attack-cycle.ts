/**
 * Mốc thời gian của **chu kỳ đòn** (`EnemyState.actionStartedMs`) sau khi action
 * đổi. Tách thành hàm thuần vì đây là chỗ từng gây bug khó thấy: nếu adapter đặt
 * lại mốc này ở **mọi** lần đổi action thì cú stagger (150 ms sau mỗi viên đạn,
 * player bắn 2 phát/giây) sẽ restart cooldown liên tục và enemy **không bao giờ
 * ra đòn** — chỉ lộ ra khi chơi thật.
 *
 * Luật:
 *
 * - Bắt đầu telegraph ⇒ mốc mới (telegraph là khởi đầu một chu kỳ đòn).
 * - **Thả** đòn (telegraph → idle/charge) ⇒ mốc mới. Telegraph bị stagger cắt
 *   ngang **không** phải thả đòn (xem `attackReleased`).
 * - Mọi chuyển đổi khác (walk ↔ idle, charge → idle, → stagger, stagger → …)
 *   **giữ nguyên** mốc, nên cooldown chạy tiếp qua cú choáng.
 */
import type { EnemyAction } from './behaviours';

/** `actionStartedMs` nên là gì khi action đổi từ `previous` sang `next` tại `nowMs`. */
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

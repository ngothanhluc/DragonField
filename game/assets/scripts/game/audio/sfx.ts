/**
 * Kênh SFX một chiều: gameplay không import `cc` cũng không giữ AudioSource.
 *
 * `AudioManager` (game/audio/audio-manager.ts) đăng ký làm sink lúc boot. Trước
 * khi có sink (menu/title chưa boot xong) mọi tiếng đều rơi im lặng — không có
 * hàng đợi vô hạn và không có lỗi.
 */

export type SfxId =
  | 'shoot'
  | 'enemy-hit'
  | 'player-hurt'
  | 'enemy-death'
  | 'explosion'
  | 'boss-phase'
  | 'skill-pick'
  | 'ui-move'
  | 'ui-confirm'
  | 'gold'
  | 'chapter-clear'
  | 'game-over'
  | 'shield'
  | 'freeze'
  | 'poison';

export const SFX_IDS: readonly SfxId[] = [
  'shoot',
  'enemy-hit',
  'player-hurt',
  'enemy-death',
  'explosion',
  'boss-phase',
  'skill-pick',
  'ui-move',
  'ui-confirm',
  'gold',
  'chapter-clear',
  'game-over',
  'shield',
  'freeze',
  'poison',
];

export type SfxSink = (id: SfxId) => void;

let sink: SfxSink | null = null;

/** Đăng ký sink; trả hàm gỡ (dùng khi teardown). */
export function setSfxSink(next: SfxSink | null): void {
  sink = next;
}

/** Phát một SFX; không có sink thì bỏ qua. */
export function playSfx(id: SfxId): void {
  sink?.(id);
}

/** Số damage bay lên (ticket #2). Stub — executor implement. Hợp đồng: tests/core/juice.test.ts. */

export interface DamagePopupOptions {
  readonly lifetimeMs: number;
  /** Bay lên bao nhiêu tile trong cả đời. */
  readonly riseTiles: number;
  readonly crit: boolean;
}

export interface DamagePopupState {
  /** Đã bay lên bao nhiêu tile (dương = lên). */
  readonly rise: number;
  /** 1 = rõ, 0 = mất. */
  readonly alpha: number;
  readonly scale: number;
}

export function damagePopupState(_elapsedMs: number, _options: DamagePopupOptions): DamagePopupState {
  throw new Error('chưa implement');
}

export function formatDamage(_amount: number, _crit: boolean): string {
  throw new Error('chưa implement');
}

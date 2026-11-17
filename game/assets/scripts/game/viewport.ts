/**
 * Canvas/DOM của bản build web: cho canvas phủ đúng cửa sổ trình duyệt và
 * letterbox camera world theo design 512×288.
 *
 * Tách khỏi bootstrap vì đây là adapter DOM/engine thuần, không liên quan run
 * flow. Build web-desktop ghim `#GameDiv` 1280×960 + border 5px và có
 * header/footer trong template; chỉ `screen.windowSize` mới đổi được canvas
 * (xem bẫy AGENTS.md).
 */
import { Rect, screen, Size } from 'cc';
import type { Camera as CocosCamera } from 'cc';
import { letterboxRect } from '../core/view/letterbox';

type Camera = InstanceType<typeof CocosCamera>;

/** Gán canvas = innerWidth × innerHeight và bỏ khung/trang trí của template build. */
export function fillBrowserViewport(): void {
  if (typeof window === 'undefined') return;

  const width = Math.max(1, Math.round(window.innerWidth));
  const height = Math.max(1, Math.round(window.innerHeight));

  const gameDiv = document.getElementById('GameDiv');
  if (gameDiv !== null) {
    gameDiv.style.position = 'fixed';
    gameDiv.style.left = '0';
    gameDiv.style.top = '0';
    gameDiv.style.width = '100vw';
    gameDiv.style.height = '100vh';
    gameDiv.style.border = '0';
    gameDiv.style.borderRadius = '0';
    gameDiv.style.boxShadow = 'none';
    gameDiv.style.margin = '0';
  }
  for (const element of Array.from(document.querySelectorAll('.header, .footer'))) {
    (element as HTMLElement).style.display = 'none';
  }
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';

  screen.windowSize = new Size(width, height);
}

/** Camera world chỉ vẽ đúng band 16:9 mà `SHOW_ALL` dành cho design resolution. */
export function applyWorldLetterbox(
  camera: Camera | null,
  designWidth: number,
  designHeight: number,
): void {
  if (camera === null) return;
  const canvas = screen.windowSize;
  const band = letterboxRect(canvas.width, canvas.height, designWidth, designHeight);
  camera.rect = new Rect(band.x, band.y, band.width, band.height);
}

/**
 * Canvas/DOM for the web build: make the canvas fill the browser window and letterbox the
 * world camera to the 512×288 design.
 *
 * Split from bootstrap because this is a pure DOM/engine adapter, unrelated to run flow.
 * The web-desktop build pins `#GameDiv` at 1280×960 with a 5 px border and ships a
 * header/footer in the template; only `screen.windowSize` can resize the canvas
 * (see the AGENTS.md pitfalls).
 */
import { Rect, screen, Size } from 'cc';
import type { Camera as CocosCamera } from 'cc';
import { pixelPerfectRect, worldToUiScale } from '../core/view/letterbox';

type Camera = InstanceType<typeof CocosCamera>;

/** Set the canvas to innerWidth × innerHeight and strip the build template's frame/decorations. */
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

/**
 * The world camera draws the room at integer multiples of the design (512×288 × 2/3/4…) so pixel
 * art stays sharp and texel-aligned (M7). Returns the world/UI ratio so the HUD shrinks to hug
 * the room edges.
 */
export function applyWorldLetterbox(
  camera: Camera | null,
  designWidth: number,
  designHeight: number,
): number {
  const canvas = screen.windowSize;
  if (camera !== null) {
    const band = pixelPerfectRect(canvas.width, canvas.height, designWidth, designHeight);
    camera.rect = new Rect(band.x, band.y, band.width, band.height);
  }
  return worldToUiScale(canvas.width, canvas.height, designWidth, designHeight);
}

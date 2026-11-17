/**
 * Phần debug hook M6 tách khỏi bootstrap: `placeholders()` và `anim()` chỉ duyệt
 * scene, không giữ state riêng.
 */
import { Sprite as CocosSprite } from 'cc';
import type { Node as CocosNode } from 'cc';
import { SpriteAnimator, animationProblemSnapshot } from './anim/sprite-animator';
import type { DebugAnimationSnapshot } from './debug-api';

type Node = InstanceType<typeof CocosNode>;
const PLACEHOLDER_NAME = /placeholder|fallback|missing/i;

/**
 * Art tạm còn hiển thị:
 * - node có tên `placeholder`/`fallback`/`missing`;
 * - Sprite đang bật nhưng chưa có `spriteFrame`;
 * - key animation hỏng/không resolve được (log từ `SpriteAnimator`);
 * - FX đang bật mà animator chưa có key.
 */
export function collectPlaceholders(roots: readonly (Node | null)[]): readonly string[] {
  const issues = new Set<string>(animationProblemSnapshot());

  for (const root of roots) {
    if (root === null || !root.isValid) continue;
    visit(root, issues);
  }
  return Array.from(issues);
}

function visit(node: Node, issues: Set<string>): void {
  if (!node.activeInHierarchy) return;

  if (PLACEHOLDER_NAME.test(node.name)) issues.add(`node:${node.name}`);

  const sprite = node.getComponent(CocosSprite);
  if (sprite !== null && sprite.spriteFrame === null) issues.add(`sprite:${node.name}:null-frame`);

  const animator = node.getComponent(SpriteAnimator);
  if (animator !== null && animator.key === '' && node.name.startsWith('fx-')) {
    issues.add(`fx:${node.name}:no-anim`);
  }

  for (const child of node.children) visit(child, issues);
}

/** Snapshot animation actor cho `anim()`. */
export function collectAnimations(root: Node | null): DebugAnimationSnapshot {
  const enemies: Record<string, string> = {};
  let player: string | null = null;
  let boss: string | null = null;

  const visitNode = (node: Node): void => {
    if (!node.activeInHierarchy) return;

    const animator = node.getComponent(SpriteAnimator);
    if (animator !== null && animator.key !== '') {
      if (node.name === 'player') player = animator.key;
      else if (node.name.startsWith('boss-')) boss = animator.key;
      else if (!node.name.startsWith('fx-')) enemies[node.name] = animator.key;
    }
    for (const child of node.children) visitNode(child);
  };

  if (root !== null && root.isValid) visitNode(root);
  return { player, enemies, boss };
}

/** Animation của một node theo tên; `null` nếu không thấy/không có animator. */
export function animationOfNode(root: Node | null, name: string): string | null {
  if (root === null || !root.isValid) return null;

  const found = findNode(root, name);
  if (found === null) return null;
  const animator = found.getComponent(SpriteAnimator);
  return animator === null || animator.key === '' ? null : animator.key;
}

function findNode(node: Node, name: string): Node | null {
  if (node.name === name) return node;
  for (const child of node.children) {
    const found = findNode(child, name);
    if (found !== null) return found;
  }
  return null;
}

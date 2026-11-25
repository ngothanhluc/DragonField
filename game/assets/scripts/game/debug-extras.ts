/**
 * M6 debug hooks split from bootstrap: `placeholders()` and `anim()` only walk the
 * scene and keep no state of their own.
 */
import { Sprite as CocosSprite } from 'cc';
import type { Node as CocosNode } from 'cc';
import { SpriteAnimator, animationProblemSnapshot } from './anim/sprite-animator';
import type { DebugAnimationSnapshot } from './debug-api';
import {
  PLAYER_ATTACHMENT_NODE_NAME,
  PLAYER_BODY_NODE_NAME,
} from './player-attachment-view';

type Node = InstanceType<typeof CocosNode>;
const PLACEHOLDER_NAME = /placeholder|fallback|missing/i;

function isPlayerBodyNode(node: Node): boolean {
  return (
    node.name === 'player' ||
    (node.name === PLAYER_BODY_NODE_NAME && node.parent?.name === 'player')
  );
}

/**
 * Placeholder art still on screen:
 * - nodes named `placeholder`/`fallback`/`missing`;
 * - an active Sprite with no `spriteFrame`;
 * - broken/unresolvable animation keys (logged by `SpriteAnimator`);
 * - an active FX whose animator has no key.
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
  if (sprite !== null && sprite.enabled && sprite.spriteFrame === null) {
    issues.add(`sprite:${node.name}:null-frame`);
  }

  const animator = node.getComponent(SpriteAnimator);
  if (animator !== null && animator.key === '' && node.name.startsWith('fx-')) {
    issues.add(`fx:${node.name}:no-anim`);
  }

  for (const child of node.children) visit(child, issues);
}

/** Actor animation snapshot for `anim()`. */
export function collectAnimations(root: Node | null): DebugAnimationSnapshot {
  const enemies: Record<string, string> = {};
  let player: string | null = null;
  let boss: string | null = null;

  const visitNode = (node: Node): void => {
    if (!node.activeInHierarchy) return;

    const animator = node.getComponent(SpriteAnimator);
    if (animator !== null && animator.key !== '') {
      if (isPlayerBodyNode(node)) player = animator.key;
      else if (node.name === PLAYER_ATTACHMENT_NODE_NAME) {
        // Attachment sprites belong to the player rig, never enemies.
      } else if (node.name.startsWith('boss-')) boss = animator.key;
      else if (!node.name.startsWith('fx-')) enemies[node.name] = animator.key;
    }
    for (const child of node.children) visitNode(child);
  };

  if (root !== null && root.isValid) visitNode(root);
  return { player, enemies, boss };
}

/** Animation of a node by name; `null` if it is missing or has no animator. */
export function animationOfNode(root: Node | null, name: string): string | null {
  if (root === null || !root.isValid) return null;

  const found = findNode(root, name);
  if (found === null) return null;
  const animator =
    found.getComponent(SpriteAnimator) ??
    (found.name === 'player'
      ? (found.getChildByName(PLAYER_BODY_NODE_NAME)?.getComponent(SpriteAnimator) ?? null)
      : null);
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

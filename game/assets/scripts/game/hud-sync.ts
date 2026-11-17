/**
 * Đồng bộ HUD từ state sống mỗi frame: tim (Vitality), thanh máu boss, hàng skill.
 * Tách khỏi bootstrap để file run-flow không phải biết `bossSnapshot` shape.
 */
import type { Hud } from './hud';
import type { PlayerController } from './player-controller';
import type { CombatLoop } from './combat-loop';

export function syncCombatHud(
  hud: Hud,
  player: PlayerController,
  combat: CombatLoop | null,
): void {
  hud.setMaxHearts(player.maxHearts);
  hud.setHearts(player.hearts);

  const boss = combat?.bossSnapshot() ?? null;
  hud.setBoss(
    boss === null
      ? null
      : { name: boss.name, hp: boss.health, maxHp: boss.maxHealth, phase: boss.phase },
  );
}

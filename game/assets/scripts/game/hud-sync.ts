/**
 * Sync the HUD from live state every frame: hearts (Vitality), boss health bar, skill row.
 * Split from bootstrap so the run-flow file does not need to know the `bossSnapshot` shape.
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

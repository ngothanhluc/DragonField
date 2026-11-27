/**
 * Dojo live character swap (`Võ Đường`, GDD M21 §2).
 *
 * Pure TS — zero `cc` imports.
 *
 * One call updates the live hub character (sprite + weapon attachment loadout resolved from the
 * roster) AND the persisted save, so the live body and the save can never drift apart.
 */
import type { SaveData } from '../save/save-data';
import { withSelectedCharacter } from '../save/save-data';
import type { HubState } from './hub-state';
import { switchHubCharacter } from './hub-state';

export interface DojoSwapResult {
  readonly ok: boolean;
  readonly changed: boolean;
  readonly hub: HubState;
  readonly save: SaveData;
}

/**
 * Pick `nextId` at the Dojo Master while standing in the live hub.
 *
 * - Locked / unknown character → `ok: false`, hub and save returned unchanged.
 * - Re-picking the current character → `ok: true, changed: false`, nothing written.
 * - Valid new pick → hub keeps its position, facing, location and transition; the save gets the
 *   new `selectedCharacter` (runs read it through `resolveSelectedCharacter`).
 *
 * Never mutates its inputs.
 */
export function dojoSwapCharacter(
  hub: HubState,
  save: SaveData,
  nextId: string,
): DojoSwapResult {
  const swapped = switchHubCharacter(hub, nextId, save);
  if (!swapped.ok) {
    return { ok: false, changed: false, hub, save };
  }
  if (!swapped.changed) {
    return { ok: true, changed: false, hub, save };
  }
  return {
    ok: true,
    changed: true,
    hub: swapped.state,
    save: withSelectedCharacter(save, swapped.state.characterId),
  };
}

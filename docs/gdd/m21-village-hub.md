# GDD — M21: Interactive Village Hub & Enterable Shop

**Status:** `implemented` · **Milestone:** [M21](../milestones/m16-m21.md#m21--sảnh-ngôi-làng-tương-tác-cửa-hàng-đi-vào-được--võ-đường) · **ADR:** [ADR-028](../tech-decisions.md#adr-028--playable-2d-village-hub--enterable-shop-interior-m21)

---

## 1. Entry Flow

- **Streamlined Title Screen:** clean living village vista backdrop with 3 primary buttons:
  - **Vào Làng** (*Enter Village*) — spawns the currently selected character in the Village Hub square.
  - **Tiếp Tục Hành Trình** (*Continue Run*) — visible whenever a valid `runSave` exists (jumps straight back into the saved combat room).
  - **Cài Đặt** (*Settings*) — language, Music/SFX sliders, fullscreen, accessibility.
- Finishing a run (Victory or Death) returns to the **Village Hub** (or direct replay via Results screen), keeping all gold earned to spend immediately at the Shop.

---

## 2. Outdoor Village Map (`36×24` tiles, follow camera)

Built with `TilesetHouse`, `TilesetNature`, `TilesetElement`, `TilesetField`, and `tileset_camp`, reusing the existing M9 follow camera (`core/camera/`), Y-sorting, canopy/roof fade cover (`cover-view.ts`), and obstacle collision (`core/movement/`).

### Layout
- **Centre — Quảng Trường Làng (Village Square):** stone-paved plaza with campfire/well, lantern posts, and player spawn point.
- **West — Cửa Hàng (Shop Building):** distinct wooden shopfront with hanging sign + glowing entrance doorway. Walking into the doorway transitions seamlessly (short fade `~200 ms`) into the **Shop Interior**.
- **East — Võ Đường (Dojo / Character Hall):** open courtyard with weapon racks, training dummy, and **NPC Võ Sư (Dojo Master)**. Interacting opens the **Character Select & Skill Codex** (M20). Switching characters updates the player's live sprite & weapon attachment **immediately in the village**!
- **North — Cổng Xuất Chinh (Expedition Torii Gate):** stone archway at the top of the village path with chapter banners. Walking up to the gate or pressing `E` opens **Chapter Select + Ascension** to launch a run.

### Living Village Population
- **4–6 Wandering Villagers** (selected from `art-source/ninja-adventure/Actor/Character/` non-playable NPCs): patrol stone paths slowly, pause to look around, and yield when the player approaches. Pressing `E` or clicking opens a short RPG speech bubble / dialog box with lore or gameplay tips (localized `vi`/`en`).
- **3–4 Living Animals** (relocated from M18 combat rooms: dog, cat, chicken, bird): roam the grassy yards outside the plaza with zero gameplay clutter.

---

## 3. Enterable Shop Interior (`16×12` tiles, static camera)

- Uses `art-source/ninja-adventure/Backgrounds/Tilesets/Interior/*` + `tileset_bed` / `tileset_camp` furniture (counter, weapon shelves, potion bottles, rugs, warm lantern light).
- **Shopkeeper NPC (Chủ Shop)** stands behind the wooden counter.
- **RPG Dialog Flow (`DialogBox` + 64×64 Shopkeeper Portrait):**
  1. Approach counter → proximity prompt `[E] Trò chuyện`.
  2. Press `E` or click → Shopkeeper greets the player (contextual lines, e.g., greeting, commenting on gold count or recent chapter unlock) with 3 choices:
     - **Mua Nâng Cấp Vĩnh Viễn** (*Permanent Upgrades* — opens the 6-track Meta Shop panel).
     - **Mở Khóa Nhân Vật** (*Hero Unlocks* — early-buy Archer/Mage/Cultivator with gold).
     - **Tạm Biệt** (*Leave* — closes dialog).
  3. Walking onto the **South exit rug** fades smoothly back out to the front door of the Shop in the Village Square.

---

## 4. Controls, Prompts & Quick Shortcuts

- **Movement:** standard `WASD` / Arrow keys (auto-fire is **disabled** in the Village & Shop Interior; `Dash` can optionally stay enabled for fun traversal `[ASSUMPTION]`).
- **Interact:** floating pixel prompt `[E]` (and clickable) appears above any nearby interactable NPC, door, or gate within `2.0` tiles.
- **Quick-Access Bar (QoL):** compact corner shortcut icons (or `Esc` Village Menu) letting returning players jump straight to **Cổng Xuất Chinh (Play)**, **Võ Đường (Characters)**, or **Cài Đặt (Settings)** without walking every run.
- **Audio:** dedicated cozy village music track (`1 Adventure Begin` / `38 Intro` from pack) with soft transition/ducking on entering the Shop Interior and dialog voice blips (`audio-design`).

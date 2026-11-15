# Audit nội dung Unity — Yokai Field (2026-11-15)

Mục đích: chốt các **con số kỹ thuật** của bản Unity trước khi xoá source để rewrite sang Cocos Creator 3.8.
Đây là bản ghi read-only, không phải backup code. Nội dung gameplay (dialog, tên item, layout map) **sẽ không được tái sử dụng** theo quyết định "100% nội dung mới"; các bảng dưới đây chỉ dùng làm tham chiếu kỹ thuật (grid, frame size, animation cadence, audio ngắn).

Nguồn: `Assets/Scenes/*.unity`, `Assets/Prefabs/**/*.prefab`, `Assets/Animations/**`, `Assets/Data/**`, `ProjectSettings/EditorBuildSettings.asset`.

---

## 1. Grid + pixel scale

| Scene | `m_CellSize` | `m_CellGap` | Grid |
|---|---|---|---|
| Level1 | `{0.16, 0.16, 0}` | 0 | 1 |
| Level2 | `{0.16, 0.16, 0}` | 0 | 1 |
| Village | `{0.16, 0.16, 0}` | 0 | 1 |
| Menu | — | — | 0 |

PPU = **100** ở 1149/1150 file `.meta` (ngoại lệ: `Thaleah_DemoBackground.png` = 16).
→ **1 tile = 16 px = 0.16 world unit**. Đây là con số chuẩn cho bản Cocos: 16 px/tile, world unit = 1/100.

Build settings (`ProjectSettings/EditorBuildSettings.asset`): **4 scene đều enabled** — Menu (0), Village (1), Level1 (2), Level2 (3).

---

## 2. Sprite frame sizes

| Nhân vật | Sheet | PNG | Frame | Pitch | Rect thực tế (w×h) |
|---|---|---|---|---|---|
| Player Knight Idle | `Idle-Sheet.png` | 128×32 | 4 | 32×32 | 19×29 / 19×27 |
| Player Knight Run | `Run-Sheet.png` | 384×64 | 6 | 64×64 | 17–24 × 29–31 |
| Player Knight Death | `Death-Sheet.png` | 288×32 | 6 | 48×32 | 19×29 → 33×13 |
| Orc (Enemy_1) Idle | | 128×32 | 4 | 32×32 | 20×30 / 20×28 |
| Orc Run | | 384×64 | 6 | 64×64 | 19–24 × 30–32 |
| Skeleton Base (Enemy_2) | | 128×32 / 384×64 | 4 / 6 | 32 / 64 | 16×30 / 15–22 × 30–32 |
| Skeleton Warrior (Enemy_3) | | 128×32 / 384×64 | 4 / 6 | 32 / 64 | 20×30 / 18–23 × 31–32 |
| Rogue (Player2) | | 128×32 / 384×64 | 4 / 6 | 32 / 64 | 19×30 / 18–24 × 30–32 |

Player collider `m_Size` = **0.19 × 0.29** unit (≈ 19×29 px). Vũ khí: `Wood.png` 192×112, `Hands.png` 32×64, `Bone.png` 224×144.
→ Đặc tả cho art mới: khung nhân vật **32×32**, thân chiếm ~19×29 px, chân đặt ở đáy khung.

---

## 3. Animation cadence

| Clip | Loop | Sample rate | Frames | Ghi chú |
|---|---|---|---|---|
| Idle (mọi nhân vật) | có | **10 fps** | 4 | 0.4 s/vòng |
| Run / walk | có | **10 fps** | 6 | 0.6 s/vòng |
| Player Death | không | 30 fps | 6 | ~0.17 s |
| Weapon idle | có | 10 fps | 3–5 | |
| Weapon attack | không | **20 fps** | 1 | 0.1 s |
| Player2 weapon | — | 60 fps | 0 | clip rỗng (bug) |

→ Cadence chuẩn để yêu cầu pack mới: idle 4 frame, walk/run 6 frame, attack ≥3 frame, death 6 frame, 4 hướng.

---

## 4. Gameplay numbers

| Prefab | Max HP | Ghi chú |
|---|---|---|
| Player | 10 (prefab) | scene override **20** |
| Player (1) | 10 / cur 2 | biến thể có bắn xa |
| Enemy_1/2/3 | 2 | |

| Prefab | chase | attackDist | attackDelay |
|---|---|---|---|
| Enemy_1, Enemy_2 | 1 | 0.3 | 2 |
| Enemy_3 | 2 | 0.3 | 2 |

| Prefab | delay | radius | fire interval | rotSpeed | projectile |
|---|---|---|---|---|---|
| Player | 0.3 | 0.37 | — | — | — |
| Player (1) | 0.3 | — | 0.005 s | 10 | có |
| Enemy_1 | 0.3 | 0.36 | — | — | — |
| Enemy_2/3 | 0.3 | 0.34 | — | — | — |

Projectile: speed 5, lifetime 10 s, damage 1.
**Sát thương hardcode = 1** ở đúng 2 chỗ: `WeaponParent.cs:110`, `Projectile.cs:26`. Không có i-frame; chỉ có `attackBlocked` + delay 0.3 s.

---

## 5. Item (tham chiếu, không tái sử dụng)

| Asset | Tên | Stack | HP hồi | Param |
|---|---|---|---|---|
| FortuneCookiee | Fortune Cookie | 99 | +1 | `[]` |
| Sushi | Sushi | 99 | +2 | `[]` |
| Yakitori | Yakitori | 99 | +3 | `[]` |

`FoodHealthModifier.asset` không chứa giá trị; giá trị nằm ở `ModifierData.value` từng item. Không có durability.
`InventorySO.Size = 10`, `initialItems = []`.

---

## 6. Nội dung theo scene

| Scene | Enemy | Food | NPC | Door | Collider |
|---|---|---|---|---|---|
| Level1 | 14 × Enemy_1 | 3 | 0 | 1 | 1 Box, 3 Polygon, 2 TilemapCollider |
| Level2 | 12 × Enemy_2 + 6 × Enemy_3 | 5 | 0 | 1 | 1 Box, 1 Polygon, 2 TilemapCollider |
| Village | 0 | 3 | 3 | 1 (mở LevelMenu) | 4 Box, 1 Polygon, 1 TilemapCollider |
| Menu | 0 | 0 | 0 | 0 | 0 |

Level1 = 14 quái rải rác không chia phòng; Level2 = 18 quái, có 4 con trùng toạ độ, 2 pickup có item null. Không có Rigidbody, không có Circle/Edge/Capsule collider.

---

## 7. Audio

Tổng: 93 file (62 wav + 31 ogg) = **38.85 MB**, nhưng **chỉ 9 file được dùng**:

| Clip | Dài | Dùng ở |
|---|---|---|
| Adventure Begin | 82.3 s | Menu (nhạc) |
| Village | 51.7 s | Village (nhạc) |
| Road | 44.3 s | Level1 (nhạc) |
| Dungeon | 60.0 s | Level2 (nhạc) |
| Coin | 0.29 s | pickup |
| Sword2 | 0.21 s | attack (L1, Village) |
| Magic1 | 0.40 s | attack (L2) |
| PowerUp1 / PowerUp2 | 0.47 s | food |

Mixer `Volume.mixer`: 1 group **Master** duy nhất, không có AudioSource nào gán output group.
→ Chỉ cần mang theo 9 file (~0.3 MB) thay vì 38.85 MB. Nhạc 4 theme có thể tái dùng tạm.

---

## 8. UI

- Canvas: `ReferenceResolution 800×600`, `MatchWidthOrHeight = 0` ở cả 4 scene.
- GUI dùng thật: `GUI_1x.png` (152×112, 13 slice), `GUI_4x.png` (608×448), `Spritesheet_UI_Flat.png` (768×352). `GUI/Sliced/*` và `GUI_2x.png` **không dùng**.
- Font: 1 TMP SDF duy nhất (`ThaleahFat_TTF SDF`), size 16–72 tuỳ màn hình.
- Inventory grid: cell 100×100, spacing 20×20, không fix số cột, 10 slot.

---

## 9. Ledger asset

| Nhóm | File | Dung lượng |
|---|---|---|
| PNG (Art) | 49 | 317 KB |
| PNG (NinjaAdventure) | 974 | 2.74 MB |
| PNG tổng | 1038 | 8.63 MB |
| Audio | 93 | 38.85 MB |
| `.aseprite` | 34 | 151 KB |
| `.asset` | 2366 | 5.04 MB (2344 là tile asset) |
| Font ttf/otf | 8 | 742 KB |
| TMP SDF | 7 | 2.75 MB |

**1074 / 3539** file png/audio/font không được tham chiếu (742 NinjaAdventure Actor, 90 Items, 61 FX, 57 Sounds, 42 Backgrounds…). Tất cả `.aseprite` không được Unity dùng trực tiếp.

---

## 10. Kết luận cho bản Cocos

Phải mang theo (số liệu, không phải code):
1. **16 px/tile, 32×32 khung nhân vật**, world unit = 1/100.
2. **Cadence animation**: idle 4f@10fps, run 6f@10fps, attack ~3f@20fps, death 6f@30fps, 4 hướng.
3. **9 file audio** (4 nhạc + 5 SFX) và 1 font pixel.
4. `ReferenceResolution 800×600` không đáng giữ — bản web nên chọn lại theo pixel-perfect 16:9.

Bỏ hẳn: toàn bộ C# script, prefab, scene, tile color, sprite NinjaAdventure, GUI skin, dialog text, item data.

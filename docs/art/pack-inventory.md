# Kiểm kê pack — Ninja Adventure Update #8

Nguồn: `art-source/ninja-adventure/` (CC0, `LICENSE.txt`). 110 MB · 1915 PNG · 188 audio · **không có `.meta`** (không phải export Unity — phải cắt theo grid).

Khác bản Update #7 đang có trong repo cũ: +36 character (92 dirs), **`CharacterAnimated` mới** (2 dirs), +16 monster (66), +12 boss (20), +12 animal (25), +3 tileset (`camp`, `bed`, `Towers`), FX 105 file, `Ui` 361 file, audio 188 file.

---

## 1. Nhân vật

| | `Character/` (90 dirs) | `CharacterAnimated/` (1 dir) |
|---|---|---|
| Frame | 16×16 | **32×32** (art 16 px, padding ~8) |
| Idle | 4 hướng × 1 frame | 4 hướng × 4 frame |
| Walk | 4 hướng × 4 | 4 hướng × 4 |
| Attack | 4 frame, 1 hướng + flip | **4 hướng × 4** |
| Roll / Hurt | **không có** | **có** |
| Dead | 1 frame | 2 frame |

`CharacterAnimated/NinjaGreen` — thứ tự cột **D / U / L / R**, frame **32×32**:

| Anim | File | Dir × frames |
|---|---|---|
| Idle | Idle.png | 4 × 4 |
| Walk | Walk.png | 4 × 4 |
| Attack | Attack.png | 4 × 4 |
| Roll | Roll.png | 4 × 3 |
| Hit | Hit.png | 4 × 2 |
| Jump | Jump.png | 3 dir × 4 |
| Swim / Push / Climb / Dead / Pickup | | 1 dir × 2–4 |

**Đây là nhân vật duy nhất có bộ 4 hướng đầy đủ.** Dùng làm player. 90 nhân vật `Character/` chỉ dùng làm skin/NPC (không có roll/hurt).

Vũ khí `CharacterAnimated/Weapon/` (Axe, Hammer, Katana, Net, Pickaxe, 256×256) — bỏ qua, game auto-fire không cần.

---

## 2. Monster (66 con)

**Tất cả** đều giống nhau về cấu trúc: 1 sheet 64×64 = 4 hướng × 4 frame 16×16. **Không con nào có attack/hurt/death/roll.**

⇒ Mọi biểu đạt của enemy phải đến từ **AI + tint + FX**, không phải sprite animation.

| Vai trò | Chapter 1 (grass) | Chapter 2 (river) | Chapter 3 (ruins) |
|---|---|---|---|
| Chaser | BlueBat | SpiderRed | Snake3 |
| Caster | Eye | GreenOctopus | LanternRed |
| Tank/charger | Bear | TRex | Cyclope |

Dự phòng: YellowsBat, MouseBlack, LanternGreen, RedOctopus, Panda, Reptile2, Skull, GreyTrex.

---

## 3. Boss (20 folder = 10 thiết kế × 2 biến thể màu)

| Boss | Idle | Walk | Attack | Charge | Jump | Hit | Khác | Frame |
|---|---|---|---|---|---|---|---|---|
| TenguBlue | 6 | 10 | **15** | – | – | 8 | **Trans 11** (dịch chuyển) | **68×68** (idle/hit/trans), 82×82 (walk/attack) |
| SquidGreen | 4 | 4 | 6 + **AttackLoop 4** | – | – | 4 | **Shoot 5** | 76×79 |
| GiantBlueSamurai | 6 | 6 | 4 + 4 (L/R) | 3 + 3 (L/R) | – | 4 | | **96×48** (idle/walk/hit), 96×96 (attack/charge) |
| GiantSlime | 5 | – | – | – | **13** | 5 | slam | 62×52 |
| GiantBamboo | 6 | 12 | 5 | 3 | – | 4 | | 62×62 |
| GiantFrog | 5 | – | 3 | 7 | 6 | 3 | | 40×40 |
| GiantRacoon | 6 | – | 4 | 2 | 5 | – | | 60×60 |
| DemonCyclop | 5 | 6 | **–** | – | – | 3 | không có đòn | 50×50 |
| GiantFlam / GiantSpirit | 5 | – | **–** | – | – | 3 | không có đòn | 50×50 |
| DragonBlue / Green | – | – | – | – | – | – | **0 animation** (body rời) | 31–57 |

**Chọn 3 boss:** TenguBlue (Ch1), SquidGreen (Ch2), GiantBlueSamurai (Ch3). Lý do: cả ba đều có animation đòn/charge thật, silhouette đọc được ở scale boss, và bộ animation cho phép pattern đạn khác nhau. Backup: GiantSlime (jump slam), GiantBamboo.

Loại: DemonCyclop, GiantFlam, GiantSpirit (không có frame đòn), Dragon* (không có animation, ngoài scope).

---

## 4. Tileset (grid 16 px)

| File | px | Theme | Autotile |
|---|---|---|---|
| TilesetNature | 384×336 | grassland + forest cliff | **có** |
| TilesetRelief / ReliefDetail | 320×192 / 192×192 | cliff | có / một phần |
| TilesetField | 80×240 | ruộng | có |
| TilesetWater | 448×272 | sông/hồ | **có** |
| TilesetElement | 256×240 | cây, bụi, đá (props) | – |
| TilesetFloor / FloorB / FloorDetail | 352×**417** / 176×112 / 256×80 | sàn | không |
| TilesetHouse | 528×368 | kit nhà làng | – |
| TilesetVillageAbandoned | 320×192 | làng hoang | **có** |
| TilesetTowers | 384×96 | nóc tháp, 4 màu | – |
| tileset_camp / tileset_bed | 368×144 / 224×192 | lều, campfire, nội thất | – |
| TilesetDesert | 320×192 | sa mạc | có |
| TilesetHole | 176×80 | hố | một phần |
| Interior/* | 256×320, 352×272, 160×176 | tường/sàn trong nhà | có |
| TilesetDungeon | 192×64 | **chỉ 12×4 props** (hũ, bẫy) | – |

**Lỗi cần biết:** `TilesetFloor.png` cao **417 px, không chia hết 16** → cắt 26 hàng, bỏ 1 px cuối.

**3 theme chapter:** Ch1 Grassland/Forest · Ch2 River/Waterfall · Ch3 Abandoned Village. Hub/shop: `tileset_camp` + `tileset_bed` + `Interior`.

**Không có** dungeon/crypt/lava/cave theme.

---

## 5. FX (75 PNG)

| Dùng cho | File |
|---|---|
| Đạn | Fireball (4), EnergyBall (4), BigEnergyBall (3), ShurikenMagic (2), CanonBall (5), RockSpike (12), IceSpike (8), Kunai (20), Shuriken (27) |
| Impact | Explosion (15), Spark (24), Thunder (8), Smoke (7), SmokeCircular (16), Water (13), WaterPillar (17), Flam (11) |
| **Telegraph** | `Magic/Circle/SpriteSheetWhite` (4), Orange (4), Spark (6), Spark2 (5) |
| Melee | `Attack/` 8 sheet, `Slash/` 6 (Arc 11, Circular 9, Multi 10) |
| Khác | Aura (6), Boost (18), Shield (5), Spirit (5), Fog, Raylight, 15 particle strip |

---

## 6. UI (359 PNG)

| Cần | Có |
|---|---|
| Tim | `Heart.png` 80×16 = **5 state**; `Heart2/3` 4 state |
| Thanh máu | `LifeBarMini` 18×4; Receptacle 8 nền + 3 progress |
| **Icon skill** | **62 icon 24×24** (+62 bản Disabled): Spell 34, Item&Weapon 12, Job&Action 12, Meteo 4 |
| Vàng | `Money.png` 24×24, `GoldCoin`, `Coin2` |
| Panel/nút | `Theme/Theme Wood` 43 file: nút 4 state, tab, slider, checkbox, `inventory_cell` 16×16, **7 nine-path 16×16** |
| Dialog | DialogBox 300×58, ChoiceBox, FacesetBox, Yes/No |
| Input | **109 prompt**: keyboard 60, gamepad 37, mouse 7 |
| Font | `NormalFont.ttf` (NinjaAdventure Regular), bitmap `font8x8`, `font24x30` |

Thiếu: thanh máu boss riêng, khung thẻ skill, art rarity → dựng từ nine-path + progress bar.

---

## 7. Audio (188)

- **SFX 147 wav**: Bonus 10 (coin/powerup), Hit&Impact 13, Elemental 26, Magic 11, Menu 25, Whoosh&Slash 9, Jump 8, Creature 5, Voice 10.
- **Jingle 15**: GameOver 4, LevelUp 3, Secret 4, Success 4.
- **Music 41 ogg** — chọn: title `38 Intro` / `1 Adventure Begin` · Ch1 `11 Clearing` / `31 Sunny` · Ch2 `18 Aquatic` / `39 Boat` · Ch3 `30 Ruins` / `26 Lost Village` · boss `17 Fight` / `34 Fight` / `28 Tension`. Dự phòng: `21 Dungeon`, `40 Crypt`, `37 Dark Forest`.

---

## 8. Palette

`Palette.png` = 53 màu opaque. Mọi sprite chỉ dùng 7–9 màu trong bộ này → nếu cần đổi màu (elite variant, tint hit) thì **remap theo index palette**, không nhân màu trực tiếp, để không lệch style.

---

## 9. Bảng coverage — asset → vai trò

| Vai trò | Asset |
|---|---|
| Player | `CharacterAnimated/NinjaGreen` |
| Chaser ×3 | BlueBat / SpiderRed / Snake3 |
| Caster ×3 | Eye / GreenOctopus / LanternRed |
| Tank ×3 | Bear / TRex / Cyclope |
| Boss ×3 | TenguBlue / SquidGreen / GiantBlueSamurai |
| Nền ×3 chapter | Nature+Relief / Water+Waterfall / VillageAbandoned+House+Towers |
| Props | Element, camp, bed, Interior, Flag/Plant/Flower animated |
| HUD | Heart 5-state, LifeBarMini, Receptacle, 62 skill icon, Theme Wood, Arrow |
| Đạn | Fireball, EnergyBall, ShurikenMagic, CanonBall, Shuriken |
| VFX | Explosion, Spark, Smoke, Thunder, Circle (telegraph), Fog |
| SFX | Bonus, Hit&Impact, Elemental, Magic, Menu, Whoosh, Jingle |
| Music | Intro / Clearing / Aquatic / Ruins / Fight |
| Font | NormalFont.ttf |

**Bỏ và lý do:**

| Asset | Lý do |
|---|---|
| `Character/` 90 bộ | không có roll/hurt → chỉ dùng làm NPC (không có trong scope) |
| `Animal/` 25 | không có vai trò trong roguelite |
| DemonCyclop, GiantFlam, GiantSpirit | không có frame đòn → boss nhạt |
| Dragon* | không có animation, ngoài scope |
| `TilesetDungeon` 12×4, TilesetLogic, Pipes, Vehicles | không phải theme phòng |
| Items Food/Resource/Weapons/Scroll/Tool | không có inventory/economy |
| `Ui/Emote` 30, gamepad prompt 37, `Theme/Wip` | web + chuột/phím only |
| Gamepad/mouse prompt | chỉ dùng keyboard prompt |

---

## 10. Khoảng trống phải chấp nhận (không được vẽ thêm)

1. **Chỉ 1 nhân vật animated** → không có skin/NPC animated.
2. **Không monster nào có attack/hurt/death** → telegraph và chết phải là FX + tint.
3. **Không có theme dungeon/crypt** → 3 chapter là grass / river / làng hoang.
4. **Không có art thanh máu boss, khung thẻ skill, border rarity** → ghép từ nine-path.
5. **`TilesetFloor` lệch 1 px** → cắt 26 hàng.
6. **Không có atlas JSON** → bảng frame phải tự khai báo (đều là grid, trừ boss strip).
7. **Không có 8 hướng** → di chuyển chéo dùng L/R + flip.

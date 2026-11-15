# Checklist import art — subset dùng trong game

Trạng thái: **đã stage** `game/assets/resources/art/` (94 file PNG, 387.567 byte ≈ 378,5 KiB) từ `art-source/ninja-adventure/` (CC0, gitignored).

Nguyên tắc của lần stage này:

- Chỉ copy file game thật sự dùng (theo `docs/art/pack-inventory.md` §9 và `docs/gdd.md` §4–§6). Pack đầy đủ **không** commit.
- **Giữ nguyên tên file gốc, không re-encode, không resize, không crop.** Byte-for-byte copy từ pack.
- Không copy `.meta` — editor sinh ra khi import lần đầu. Cây đích hiện có **0 file `.meta`**.
- Không sửa `.ts`, `.json` hay doc nào. Sai lệch phát hiện được ghi ở §6, **không tự sửa**.

---

## 1. Cây đích

```text
game/assets/resources/art/                                    94 file   387.567 B
├── characters/
│   └── ninja-green/          7 file   11.602 B   Idle, Walk, Attack, Hit, Roll, Dead, Jump
├── monsters/                 9 file   21.375 B   1 sheet/con, mỗi con 1 thư mục
│   ├── blue-bat/             SpriteSheet.png
│   ├── spider-red/           SpriteSheet.png
│   ├── snake3/               Snake3.png
│   ├── eye/                  Eye.png
│   ├── green-octopus/        SpriteSheet.png
│   ├── lantern-red/          SpriteSheet.png
│   ├── bear/                 SpriteSheet.png
│   ├── trex/                 SpriteSheet.png
│   └── cyclope/              SpriteSheet.png
├── bosses/                  18 file   73.907 B
│   ├── tengu-blue/           5 file   Idle, Walk, Attack, Hit, Trans
│   ├── squid-green/          6 file   Idle, Walk, Attack, AttackLoop, Shoot, Hit
│   └── giant-blue-samurai/   7 file   Idle, Walk, AttackLeft, AttackRight,
│                                      ChargeLeft, ChargeRight, Hit
├── tilesets/                15 file  254.638 B
│   ├── TilesetNature.png  TilesetRelief.png  TilesetElement.png
│   ├── TilesetField.png   TilesetWater.png   TilesetVillageAbandoned.png
│   ├── TilesetHouse.png   TilesetTowers.png  TilesetHole.png
│   ├── tileset_camp.png   tileset_bed.png
│   └── interior/             4 file   Elements, TilesetInterior,
│                                      TilesetInteriorFloor, TilesetWallSimple
├── ui/                      39 file   16.019 B
│   ├── Heart.png  LifeBarMiniProgress.png  LifeBarMiniUnder.png
│   ├── theme-wood/          16 file   8 nine-path + 8 button state (xem §5)
│   └── skill-icons/         20 file   24×24, xem bảng map ở §5
└── fx/                       6 file   10.026 B
    ├── shuriken/SpriteSheet.png          đạn player
    ├── energy-ball/EnergyBall.png        đạn enemy
    ├── spark/SpriteSheet.png             impact
    ├── explosion/SpriteSheet.png         nổ / enemy chết
    ├── telegraph-ring/SpriteSheetWhite.png  vòng telegraph
    └── slash-arc/SpriteSheetArc.png      sóng chém của samurai
```

Tổng theo nhóm: characters 11.602 B · monsters 21.375 B · bosses 73.907 B · tilesets 254.638 B · ui 16.019 B · fx 10.026 B.

Nguồn tương ứng: `Actor/CharacterAnimated/NinjaGreen/Separate/`, `Actor/Monster/<Tên>/`, `Actor/Boss/<Tên>/`, `Backgrounds/Tilesets/`, `Ui/Receptacle/` + `Ui/Theme/Theme Wood/` + `Ui/Skill Icon/Spell/`, `FX/`.

---

## 2. Cấu hình import bắt buộc

Áp cho **cả 94 file**. Chọn nhiều file một lúc (theo từng thư mục) rồi set trong Inspector — Creator cho phép set hàng loạt.

### 2.1 Image asset (file PNG)

| Thuộc tính | Giá trị | Lý do |
|---|---|---|
| Type | **sprite-frame** | mặc định của 3.8 là `texture` — không đổi thì không có SpriteFrame để gán vào `Sprite` |
| Filter Mode | **Nearest (None)** | pixel art 16 px; Bilinear làm nhoè và đổi màu palette |
| Wrap Mode | **Clamp** | tránh lặp viền ở mép sheet |
| useCompressTexture | **off** | nén sẽ làm sai màu palette 53 màu |
| Fix Alpha Transparency Artifacts | **off** | nó bơm màu vào pixel trong suốt → viền lạ khi Point filter |
| Flip Vertical | off | |
| Bake Offline Mipmaps | off | mipmap không dùng cho 2D pixel |

### 2.2 SpriteFrame (sub-asset, mở rộng file PNG)

| Thuộc tính | Giá trị | Lý do |
|---|---|---|
| Trim Type | **None** | `Auto` cắt viền trong suốt → mỗi frame lệch một rect khác nhau, animation rung |
| Trim Threshold | không áp dụng (chỉ có tác dụng khi Auto) | |
| Offset X/Y | 0, 0 | |
| Packable | **false** | dynamic atlas có thể đổi UV; Point filter + atlas dễ lệch nửa pixel |
| Border | 0, trừ nine-path (xem §2.4) | |

### 2.3 Pixels-per-unit

Cocos Creator 3.8 **không có field "pixels per unit"** trên SpriteFrame (khác 2.x). Quy ước của project:

- **1 texture pixel = 1 design unit** (tỉ lệ 1:1). Tile 16 px ⇒ tile = **16×16 unit**.
- Base resolution **512×288 = 32×18 tile** (`docs/gdd.md` §8). Camera static, không scroll.
- Node `Sprite` phải có `size` = đúng kích thước frame trong sheet (16×16, 32×32, 68×68, 76×79, 96×48…). **Không** scale node bằng số lẻ; nếu cần phóng thì dùng bội số nguyên (×2, ×3) và giữ `size` là số nguyên.
- Không dùng `Size Mode = Custom` cho nhân vật/enemy — nó kéo giãn sprite.

### 2.4 Nine-path (chỉ `ui/theme-wood/`)

Mở **Sprite Editor** (chọn file → nút **Edit** ở cuối Inspector) và set `Border`:

| File | px | Border gợi ý (T/B/L/R) | Ghi chú |
|---|---|---|---|
| `nine_path_panel*.png`, `nine_path_bg*.png` | 16×16 | 4 / 4 / 4 / 4 | để lõi 8×8; chỉnh mắt nếu góc bị méo |
| `nine_path_focus.png` | **8×8** | 2 / 2 / 2 / 2 | nhỏ hơn các file còn lại — dùng cho viền focus mảnh |
| `nine_path_panel_disabled.png`, `nine_path_panel_interior.png` | 16×16 | 4 / 4 / 4 / 4 | |
| `button_normal/hover/pressed/disabled.png` | **16×8** | 3 / 3 / 5 / 5 | |
| `button_checked/unchecked*.png` | **26×14** | 3 / 3 / 5 / 5 | **khác kích thước** với 4 file trên — UI phải chịu được 2 cỡ |

Sau khi kéo đường cắt, bấm **dấu check xanh** ở góc trên phải Sprite Editor để lưu.

---

## 3. Cắt frame (slicing)

Cocos Creator 3.8 **không có grid-slice tự động** (Sprite Editor chỉ làm border/trim). Vì vậy:

> **Không tạo sub-frame bằng tay.** Mỗi PNG import thành **1 SpriteFrame duy nhất**, rồi code cắt frame lúc runtime từ `frameWidth`/`frameHeight`/`frames`/`layout` trong `game/assets/resources/data/animations.json` (`SpriteFrame.clone()` + set `rect`). `rect` và `originalSize` đều là property set được trong 3.8.

Hai kiểu bố cục trong manifest:

- `layout: "grid"` — **cột = hướng** theo đúng thứ tự pack **D / U / L / R**, **hàng = frame**.
- `layout: "strip"` — **một hàng**, frame chạy trái → phải (toàn bộ boss).

### 3.1 Player — `characters/ninja-green/` (frame 32×32)

| File | Sheet px | Cột × hàng | Frame/hướng | Ghi chú |
|---|---|---|---|---|
| `Idle.png` | 128×128 | 4 × 4 | 4 | |
| `Walk.png` | 128×128 | 4 × 4 | 4 | |
| `Attack.png` | 128×128 | 4 × 4 | 4 | |
| `Hit.png` | 128×64 | 4 × 2 | 2 | |
| `Roll.png` | 128×96 | 4 × 3 | 3 | |
| `Dead.png` | **32×64** | **1 × 2** | 2 | **không phải strip ngang** — 2 frame xếp dọc |
| `Jump.png` | 96×128 | 3 × 4 | 4 | 3 hướng; **chưa có key** trong manifest (xem §6) |

### 3.2 Monster — `monsters/<con>/` (frame 16×16)

Cả 9 sheet: **64×64 = 4 cột (D/U/L/R) × 4 hàng (frame)**, 4 frame/hướng, fps 10, loop. Không con nào có attack/hurt/death.

### 3.3 Boss — `bosses/` (strip 1 hàng)

| File | Sheet px | Frame | Số frame |
|---|---|---|---|
| `tengu-blue/Idle.png` | 408×68 | 68×68 | 6 |
| `tengu-blue/Walk.png` | 820×82 | 82×82 | 10 |
| `tengu-blue/Attack.png` | 1230×82 | 82×82 | 15 |
| `tengu-blue/Hit.png` | 544×68 | 68×68 | 8 |
| `tengu-blue/Trans.png` | 748×68 | 68×68 | 11 |
| `squid-green/Idle.png` `Walk.png` `Hit.png` `AttackLoop.png` | 304×79 | 76×79 | 4 / 4 / 4 / 4 |
| `squid-green/Attack.png` | 456×79 | 76×79 | 6 |
| `squid-green/Shoot.png` | 380×79 | 76×79 | 5 |
| `giant-blue-samurai/Idle.png` `Walk.png` | 576×48 | 96×48 | 6 / 6 |
| `giant-blue-samurai/AttackLeft.png` `AttackRight.png` | 384×96 | 96×96 | 4 / 4 |
| `giant-blue-samurai/ChargeLeft.png` `ChargeRight.png` | 288×96 | 96×96 | 3 / 3 |
| `giant-blue-samurai/Hit.png` | 384×48 | 96×48 | 4 |

Lưu ý: Tengu có 2 cỡ frame (68 và 82) ⇒ pivot/anchor phải tính theo từng sheet, không dùng chung một offset. Samurai có 2 cỡ cao (48 và 96) ⇒ khi đổi sang animation attack/charge, node phải giữ **đáy** cố định (anchor Y theo chân), không giữ tâm.

### 3.4 FX — `fx/` (strip 1 hàng)

| File | Sheet px | Frame | Ghi chú |
|---|---|---|---|
| `energy-ball/EnergyBall.png` | 64×16 | **16×16 × 4** | chia hết, chắc chắn |
| `telegraph-ring/SpriteSheetWhite.png` | 128×32 | **32×32 × 4** | chia hết, chắc chắn |
| `explosion/SpriteSheet.png` | 360×40 | 24×40 × 15 | 360/15 = 24 (chia hết) |
| `shuriken/SpriteSheet.png` | 690×54 | **chưa xác định** | 690 không chia hết cho 27 (số frame mà pack-inventory ghi) — phải đo trong Sprite Editor; ước lượng 46×54 × 15 |
| `spark/SpriteSheet.png` | 270×35 | **chưa xác định** | 270/24 = 11,25 — không chia hết; đo lại |
| `slash-arc/SpriteSheetArc.png` | 228×34 | **chưa xác định** | 228/11 ≈ 20,7 — không chia hết; đo lại |

3 sheet cuối **không có key trong manifest** nên chưa chặn gì; khi thêm key thì phải đo lại số frame thật (đừng tin số trong pack-inventory, nó không chia hết bề rộng sheet).

### 3.5 UI

| File | px | Cắt |
|---|---|---|
| `Heart.png` | 80×16 | **5 state × 16×16** (đầy → rỗng), cắt ngang |
| `LifeBarMiniProgress.png` | 18×4 | 1 state, dùng `Sprite Type = FILLED` (horizontal) |
| `LifeBarMiniUnder.png` | 18×4 | nền, `FILLED` hoặc simple |
| `skill-icons/*.png` | 24×24 | 1 icon/file, không cắt |

### 3.6 Tileset

**Không cắt khi import** (để nguyên 1 SpriteFrame). Tile cắt theo grid **16×16** khi dựng map trong Tiled / khi build tilemap. Tất cả 15 file đều chia hết cho 16:

`TilesetNature` 24×21 · `TilesetRelief` 20×12 · `TilesetElement` 16×15 · `TilesetField` 5×15 · `TilesetWater` 28×17 · `TilesetVillageAbandoned` 20×12 · `TilesetHouse` 33×23 · `TilesetTowers` 24×6 · `TilesetHole` 11×5 · `tileset_camp` 23×9 · `tileset_bed` 14×12 · `interior/Elements` 9×3 · `interior/TilesetInterior` 16×20 · `interior/TilesetInteriorFloor` 22×17 · `interior/TilesetWallSimple` 10×11.

`TilesetFloor.png` (417 px, lệch 1 px) **cố tình không copy**.

---

## 4. Bảng map animation → key manifest

Nguồn: `game/assets/resources/data/animations.json` (75 key trên 33 sheet). Đường dẫn đích tính từ `game/assets/resources/art/`.

### 4.1 Player — 21 key / 6 sheet

| Key | File đích | Frame | Frame/hướng | fps | loop |
|---|---|---|---|---|---|
| `player.idle.down` `player.idle.up` `player.idle.left` `player.idle.right` | `characters/ninja-green/Idle.png` | 32×32 | 4 | 10 | ✔ |
| `player.walk.down` `player.walk.up` `player.walk.left` `player.walk.right` | `characters/ninja-green/Walk.png` | 32×32 | 4 | 10 | ✔ |
| `player.attack.down` `player.attack.up` `player.attack.left` `player.attack.right` | `characters/ninja-green/Attack.png` | 32×32 | 4 | 20 | ✘ |
| `player.hit.down` `player.hit.up` `player.hit.left` `player.hit.right` | `characters/ninja-green/Hit.png` | 32×32 | 2 | 12 | ✘ |
| `player.roll.down` `player.roll.up` `player.roll.left` `player.roll.right` | `characters/ninja-green/Roll.png` | 32×32 | 3 | 15 | ✘ |
| `player.dead` | `characters/ninja-green/Dead.png` | 32×32 | 2 (1 cột × 2 hàng) | 8 | ✘ |

### 4.2 Monster — 36 key / 9 sheet

Mỗi con 4 key `<actor>.walk.down|up|left|right`, frame 16×16, 4 frame/hướng, fps 10, loop.

| Actor (key) | File đích |
|---|---|
| `bluebat` | `monsters/blue-bat/SpriteSheet.png` |
| `spiderred` | `monsters/spider-red/SpriteSheet.png` |
| `snake3` | `monsters/snake3/Snake3.png` |
| `eye` | `monsters/eye/Eye.png` |
| `greenoctopus` | `monsters/green-octopus/SpriteSheet.png` |
| `lanternred` | `monsters/lantern-red/SpriteSheet.png` |
| `bear` | `monsters/bear/SpriteSheet.png` |
| `trex` | `monsters/trex/SpriteSheet.png` |
| `cyclope` | `monsters/cyclope/SpriteSheet.png` |

### 4.3 Boss — 18 key / 18 sheet (1 key = 1 sheet, strip)

| Key | File đích | Frame | Số frame | fps | loop |
|---|---|---|---|---|---|
| `tengu.idle` | `bosses/tengu-blue/Idle.png` | 68×68 | 6 | 10 | ✔ |
| `tengu.walk` | `bosses/tengu-blue/Walk.png` | 82×82 | 10 | 10 | ✔ |
| `tengu.attack` | `bosses/tengu-blue/Attack.png` | 82×82 | 15 | 20 | ✘ |
| `tengu.hit` | `bosses/tengu-blue/Hit.png` | 68×68 | 8 | 20 | ✘ |
| `tengu.trans` | `bosses/tengu-blue/Trans.png` | 68×68 | 11 | 20 | ✘ |
| `squid.idle` | `bosses/squid-green/Idle.png` | 76×79 | 4 | 10 | ✔ |
| `squid.walk` | `bosses/squid-green/Walk.png` | 76×79 | 4 | 10 | ✔ |
| `squid.attack` | `bosses/squid-green/Attack.png` | 76×79 | 6 | 20 | ✘ |
| `squid.attack-loop` | `bosses/squid-green/AttackLoop.png` | 76×79 | 4 | 12 | ✔ |
| `squid.shoot` | `bosses/squid-green/Shoot.png` | 76×79 | 5 | 20 | ✘ |
| `squid.hit` | `bosses/squid-green/Hit.png` | 76×79 | 4 | 20 | ✘ |
| `samurai.idle` | `bosses/giant-blue-samurai/Idle.png` | 96×48 | 6 | 10 | ✔ |
| `samurai.walk` | `bosses/giant-blue-samurai/Walk.png` | 96×48 | 6 | 10 | ✔ |
| `samurai.attack.left` | `bosses/giant-blue-samurai/AttackLeft.png` | 96×96 | 4 | 20 | ✘ |
| `samurai.attack.right` | `bosses/giant-blue-samurai/AttackRight.png` | 96×96 | 4 | 20 | ✘ |
| `samurai.charge.left` | `bosses/giant-blue-samurai/ChargeLeft.png` | 96×96 | 3 | 15 | ✔ |
| `samurai.charge.right` | `bosses/giant-blue-samurai/ChargeRight.png` | 96×96 | 3 | 15 | ✔ |
| `samurai.hit` | `bosses/giant-blue-samurai/Hit.png` | 96×48 | 4 | 20 | ✘ |

---

## 5. UI: file đã lấy + map 20 skill icon

### 5.1 `ui/theme-wood/` — 16 file

Nine-path (8): `nine_path_bg.png`, `nine_path_bg_2.png`, `nine_path_focus.png`, `nine_path_panel.png`, `nine_path_panel_2.png`, `nine_path_panel_3.png`, `nine_path_panel_disabled.png`, `nine_path_panel_interior.png`.

Button state (8): `button_normal.png`, `button_hover.png`, `button_pressed.png`, `button_disabled.png`, `button_checked.png`, `button_checked_disabled.png`, `button_unchecked.png`, `button_unchecked_disabled.png`.

Còn lại trong `Theme Wood` (tab, slider, radio, checkbox, arrow, `inventory_cell`) **không copy** — thêm sau khi làm HUD/shop thật.

### 5.2 `ui/skill-icons/` — 20 icon, map theo GDD §6

Chọn từ `Ui/Skill Icon/Spell` (34 icon bật). Đây là ảnh thay thế gần nghĩa nhất, **không phải** icon vẽ riêng — đổi về sau chỉ cần đổi file, key không đổi.

| # | Skill (GDD §6) | Icon | Lý do chọn |
|---|---|---|---|
| 1 | Sharpen (+1 damage) | `AttackUpgrade` | mũi kiếm + hướng lên = tăng sát thương |
| 2 | Rapid Fire (+25% nhịp bắn) | `Fireball` | quả cầu lửa = biểu tượng đạn/hoả lực |
| 3 | Twin Shot (+1 đạn, chéo ±12°) | `Permutation` | tách/nhân bản = nhân đôi đạn |
| 4 | Piercing (xuyên 1 enemy) | `RockSpike` | mũi nhọn xuyên |
| 5 | Ricochet (nảy 1 lần) | `BookThunder` | sét lan = nảy chuỗi |
| 6 | Homing (bám mục tiêu) | `Vision` | con mắt = khoá mục tiêu |
| 7 | Explosive (AoE 1.5 tile) | `Explosion` | đúng nghĩa |
| 8 | Crit Eye (15% ×2) | `Counter` | đòn chí mạng phản kích |
| 9 | Vitality (+1 tim) | `Heal` | hồi máu |
| 10 | Second Wind (hồi 2 tim/phòng) | `BookPlant` | mọc lại = hồi phục theo nhịp |
| 11 | Shield (chặn 1 đòn) | `DefenseUpgrade` | khiên + mũi tên lên |
| 12 | Thorns (chạm gây 2 dmg) | `BookDarkness` | aura tối = phản damage |
| 13 | Swift (+10% tốc) | `BookWind` | gió = tốc độ |
| 14 | Long i-frame (0.8 → 1.1 s) | `Mist` | sương mờ = né |
| 15 | Freeze (chậm 40% / 1 s) | `BookIce` | băng |
| 16 | Poison (1 dmg/s trong 3 s) | `BookDeath` | độc/tử vong |
| 17 | Lifesteal (5% hồi máu) | `MagicWeapon` | vũ khí hút máu |
| 18 | Greed (+25% vàng) | `Alchemy` | giả kim = vàng |
| 19 | Luck (+1% trọng số rarity) | `LuckUpgrade` | đúng nghĩa |
| 20 | Executioner (+50% dmg < 30% máu) | `Death` | kết liễu |

Không dùng (còn trong pack nếu cần đổi): `BookFire`, `BookLight`, `BookRock`, `Camouflage`, `Cut`, `Downgrade`, `Necromancy`, `Orb*`, `WaterCanon`.

Icon 24×24 = 1,5 tile 16 px ⇒ khi hiện trong thẻ skill phải scale bội nguyên (×2 = 48 unit) để không nhoè.

---

## 6. Sai lệch phát hiện (KHÔNG tự sửa)

### 6.1 Không có key nào thiếu sheet

75/75 key trong `animations.json` đều có file tương ứng đã copy. 33 sheet có key ↔ 33 file đã stage.

### 6.2 Sheet copy nhưng **không có key** — 61 file

| Nhóm | File | Ghi chú |
|---|---|---|
| Player | `characters/ninja-green/Jump.png` | pack có Jump 3 hướng × 4 frame; manifest **không** có key jump. Muốn dùng phải thêm key + khai báo `directions` (chỉ 3 cột nên không thể là đủ 4 hướng) |
| Tileset | 15 file | manifest chỉ chứa sprite actor; tile đi qua Tiled/tilemap, không qua `animations.json` |
| UI | 39 file | Heart/LifeBar/theme/skill icon chưa có key — HUD dùng trực tiếp SpriteFrame |
| FX | 6 file | chưa có key; FX cũng chưa có schema trong manifest |

Đây là **dự kiến** ở M0 (manifest mới phủ actor), nhưng nghĩa là 61/94 file chưa được kiểm chứng bởi test nào.

### 6.3 Manifest trỏ sai gốc đường dẫn — **đã sửa**

`animations.json` từng ghi `sheet` theo gốc `art-source/ninja-adventure/` (ví dụ `"Actor/Monster/BlueBat/SpriteSheet.png"`), trong khi file thật đã stage ở `game/assets/resources/art/`. Loader sẽ không tìm được PNG.

Đã sửa: cả 75 entry dùng đường dẫn tương đối với `game/assets/` (`art/monsters/blue-bat/SpriteSheet.png`), verify **33/33 sheet tồn tại trên đĩa**. Validator đổi sang `isAssetRelativePath` và thông báo lỗi theo gốc `game/assets/`.

Đánh đổi: manifest không còn đối chiếu ngược trực tiếp tới tên trong pack; quy ước mapping `Actor/<Category>/<Name>/<File>.png` → `art/<category>/<kebab-name>/<File>.png` nằm ở §2 của tài liệu này.

### 6.4 Bẫy slicing đã xác nhận bằng số đo

- `Dead.png` 32×64 = **1 cột × 2 hàng**, manifest ghi `layout: "grid"`, `frames: 2`. Đừng tự suy `columns` trong loader: `manifest.ts` đã export `frameColumns()`, `frameRows()`, `frameRect()` để xử lý đúng cả sheet 1 cột lẫn sheet strip của boss (đã có test trong `tests/core/frame-geometry.test.ts`).
- FX `shuriken`, `spark`, `slash-arc`: bề rộng sheet không chia hết cho số frame mà `pack-inventory` ghi (690/27, 270/24, 228/11) ⇒ số frame trong inventory là ước lượng, **phải đo lại** khi làm VFX. FX hiện chưa có schema trong manifest nên chưa có gì chặn lỗi này.
- `nine_path_focus.png` là 8×8, các nine-path khác 16×16; `button_checked*` là 26×14 còn `button_normal*` là 16×8 ⇒ không dùng chung một cỡ node.

---

## 7. Mở project lần đầu — checklist thao tác

Thứ tự đúng, làm từ trên xuống:

1. **Đóng editor** nếu đang mở project khác. `git status --short` phải chỉ có `game/assets/resources/art/**` và `docs/art/import-checklist.md` là file mới.
2. Mở **Cocos Creator 3.8.8** → chọn project `game/`. Chờ import xong (Assets hiện thư mục `art`, status bar hết "Importing…").
3. Nếu muốn mọi PNG về sau tự là sprite-frame: **Edit → Preferences → mục Default Meta** → mở JSON → đặt `"image": { "type": "sprite-frame" }` → Apply. (Không bắt buộc; bước 4 làm được thủ công.)
4. Trong Assets, chọn **từng thư mục** (`characters`, `monsters`, `bosses`, `tilesets`, `ui`, `fx`) → chọn hết PNG bên trong → Inspector:
   - Type = **sprite-frame**
   - Filter Mode = **Nearest (None)**
   - Wrap Mode = **Clamp**
   - useCompressTexture = **off**, Fix Alpha Transparency Artifacts = **off**
5. Mở rộng **một** file PNG → chọn sub-asset **SpriteFrame** → Trim Type = **None**, Packable = **false**. Lặp cho từng thư mục (set hàng loạt được).
6. Kiểm tra 3 file mẫu: `characters/ninja-green/Idle.png` phải 128×128, `monsters/blue-bat/SpriteSheet.png` 64×64, `tilesets/TilesetNature.png` 384×336. Nếu sai kích thước ⇒ có bước nào đó resize, làm lại.
7. **Không** tạo sub-frame bằng tay, **không** bấm "auto slice". Cắt frame là việc của runtime (§3).
8. Với 16 file `ui/theme-wood/`: mở **Sprite Editor**, set `Border` theo bảng §2.4, bấm dấu ✔ để lưu.
9. `Heart.png` (80×16): giữ nguyên 1 SpriteFrame; nếu cần 5 trạng thái thì cắt 5 rect 16×16 trong code, không tách file.
10. Để editor chạy xong "Import/Compile", rồi **commit toàn bộ file `.meta`** vừa sinh (`git status` sẽ hiện 94 `.meta`). `.meta` **không** bị gitignore và **phải** commit — thiếu nó là mất UUID, hỏng tham chiếu scene.
11. Chạy gate: `cd game && bun run check` (tsc + vitest + eslint). Task này không đổi code nên phải xanh ngay.
12. Mở thử 1 scene/prefab bất kỳ, kéo `characters/ninja-green/Idle.png` vào `Sprite` → phải thấy 4 hướng × 4 frame sắc nét, **không** nhoè, **không** lệch nửa pixel khi chạy preview.

Không được làm: bật compression, để `Trim Type = Auto`, resize/scale ảnh trong Inspector, commit `art-source/`, thêm pack ngoài.

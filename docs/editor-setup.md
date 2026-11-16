# Dựng scene chạy game — 5 bước trong editor

Toàn bộ world (room, player, enemy, đạn, HUD) được **tạo bằng code** trong
`assets/scripts/game/bootstrap.ts`. Scene chỉ cần đúng một node có component `Bootstrap`;
không có prefab, không phải kéo sprite vào Inspector, không phải sửa file `.scene` bằng tay.

Trước khi làm, chạy `cd game && bun run check` — phải xanh. Editor **bỏ qua type error** khi
compile (ADR-004), nên `check` là gate duy nhất bắt lỗi kiểu; chỉ lỗi cú pháp mới làm
`Bootstrap` biến mất khỏi danh sách component.

---

## 5 bước

### 1. Tạo scene 2D rỗng

`Assets` panel → chuột phải → **Create → Scene**, đặt tên `main` (nằm trong `assets/`).
Mở scene. Xoá hết node mẫu nếu có (chỉ giữ lại **Main Camera** — bước 4 cần nó).

### 2. Thêm đúng một node

Hierarchy → chuột phải → **Create → Empty Node**, đặt tên `Boot`. Node này không cần
position/sprite gì cả; nó chỉ là chỗ gắn component.

### 3. Gắn `Bootstrap`

Chọn node `Boot` → Inspector → **Add Component** → gõ `Bootstrap` → chọn component
`Bootstrap` (script này ở `assets/scripts/game/bootstrap.ts`).

Không set property nào: mọi thứ đọc từ `assets/resources/data/animations.json` và
các file `.tmx` trong `assets/resources/data/levels/chapter-1/` (quy ước ở ADR-005).

### 4. Camera: `orthoHeight = 9` tại `(16, 9)`

Chọn node **Main Camera** → Inspector:

| Thuộc tính   | Giá trị                              |
| ------------ | ------------------------------------ |
| Position     | `16`, `9`, `1000`                    |
| Projection   | **ortho**                            |
| Ortho Height | **9**                                |
| Clear Flags  | SOLID_COLOR (màu nền tuỳ ý)          |
| Visibility   | để mặc định (không cần tick `UI_2D`) |

`orthoHeight = 9` ⇒ khung nhìn cao 18 unit = 18 tile; phòng là 32×18 unit nên vừa khít
một màn hình, không scroll. `Bootstrap` cũng tự ép lại ba thông số này lúc boot (để scene
dựng tay sai vẫn chạy), nhưng set trong editor thì thấy đúng ngay ở Scene view.

### 5. Design resolution 512×288

**Project → Project Settings → tab Project Data → Design Resolution**: width `512`,
height `288`, Fit Height (hoặc Fit Width — cả hai cho cùng tỉ lệ 16:9).

Đây là hệ quy chiếu của HUD: 1 px art = 1 px design (tim 16 px). Sai bước này game vẫn
chạy — world luôn đúng 32×18 unit vì camera dùng `orthoHeight` tuyệt đối — nhưng HUD sẽ
nhỏ/lệch và art không còn sắc nét 1:1.

### Bấm Play

Scene view hoặc Preview. Kỳ vọng trong ~1 giây:

- nền cỏ 32×18 tile, 4 cột đá ở giữa phòng;
- ninja ở gần đáy phòng, đứng yên (idle 4 frame);
- WASD di chuyển 8 hướng, animation đổi theo hướng;
- tự bắn shuriken về con gần nhất trong 8 tile, có animation attack;
- 3 con (2 chaser + 1 caster) lao/giữ khoảng cách; chạm vào chaser mất 1 tim, hiện
  animation trúng đòn (Hit) 150 ms;
- HUD góc trên-trái: 6 tim + `Gold 0`; góc trên-phải: `1/9`;
- dọn hết wave 1 → wave 2 → wave 3 → chữ `Phòng 1 sạch` trong console → phòng `2/9`.

Console (tab **Console**, hoặc DevTools khi Preview) in tiến trình:

```text
[YokaiField] Chapter 1: 9 phòng. Bắt đầu phòng 1/9 (3 wave).
[YokaiField] Phòng 1 sạch.
[YokaiField] Vào phòng 2/9 (1 wave).
```

Lưu file scene, rồi commit **cả** `assets/main.scene` và `assets/main.scene.meta` (meta do
editor sinh, phải commit — xem `docs/art/import-checklist.md` §7).

---

## Khi hỏng thì thấy gì

### a. Màn hình đỏ "LOAD FAILED"

`bootstrap.ts` bắt mọi lỗi load và in nguyên nhân lên giữa màn hình, chữ đỏ, kèm path
resources. Xem đúng dòng đó trong Console trước, nó nói rõ file nào:

| Thông báo                                                                          | Nghĩa                                                          | Sửa ở đâu                                                                       |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `Không load được "resources/data/animations.json"`                                 | Chưa import xong, hoặc file bị đổi tên/di chuyển               | `game/assets/resources/data/animations.json`                                    |
| `"resources/data/animations.json" không hợp lệ: …`                                 | Schema sai (version, key, directions…)                         | Đọc danh sách lỗi — validator liệt kê **toàn bộ**                               |
| `Không load được phòng nào trong "resources/data/levels/chapter-1"`                | Thiếu/thư mục rỗng, hoặc `.tmx` chưa import                    | `game/assets/resources/data/levels/chapter-1/room-<n>.tmx`                      |
| `Không load được texture cho sheet "resources/art/…" (resources: "art/…/texture")` | PNG chưa import thành **sprite-frame**, hoặc `.meta` chưa sinh | Chọn PNG → Inspector → Type = `sprite-frame`, Filter = Nearest (checklist §2.1) |
| `Scene không có Camera…`                                                           | Xoá mất Main Camera                                            | Bước 4                                                                          |
| `Chapter 1 chưa map monster cho role "tank"`                                       | Level data có role chưa có trong bảng                          | `MONSTERS_BY_CHAPTER` trong `bootstrap.ts`                                      |

Màn hình đỏ **không** tự hồi phục: sửa nguyên nhân rồi bấm Play lại.

### b. Không có `Bootstrap` trong Add Component

Editor chưa compile xong, hoặc script có lỗi cú pháp. Xem **Console** (lọc `error`),
hoặc chạy `bun run check`. Cocos **bỏ qua type error** khi compile, nên lỗi kiểu chỉ hiện
ở đây nhờ `tsc` — không có gate này thì bug kiểu nổ lúc runtime.

### c. Chạy nhưng màn hình trắng/đen, không có chữ LOAD FAILED

Theo thứ tự:

1. **Main Camera** bị xoá hoặc `Visibility` không có `DEFAULT` ⇒ không thấy world.
2. `Boot` node nằm ngoài scene đang mở (Hierarchy có 2 scene?).
3. Component `Bootstrap` bị **disable** (checkbox đầu component).
4. Design resolution sai ⇒ HUD ở ngoài khung (world vẫn thấy).

### d. Có hình nhưng sprite trắng / nhấp nháy

- PNG đang import với Type = `texture` chứ không phải `sprite-frame`.
- `Trim Type = Auto` trên SpriteFrame ⇒ mỗi frame một rect khác nhau, animation rung
  (checklist §2.2 — phải là `None`).
- `Filter Mode` khác `Nearest` ⇒ art nhoè.

### e. Đạn không hiện

`resources/art/fx/shuriken/SpriteSheet.png` chưa có `.meta` sprite-frame. Đạn vẫn được
bắn và vẫn gây sát thương (pool chạy độc lập với view) — chỉ không thấy hình. Sửa import
là xong, không phải restart.

### f. Player đứng yên, không ăn phím

Canvas/preview chưa có focus: bấm chuột vào khung game một lần. `input.on(...)` của Cocos
chỉ nhận sự kiện khi trang/canvas được focus.

---

## Phần chưa kiểm chứng được bằng CLI

`bun run check` chỉ chứng minh được phần **thuần TS** (`core/`) và phần biên dịch của
adapter. Những thứ dưới đây chỉ đúng/sai khi mở editor, nên lần Play đầu tiên cần soi:

1. **Canvas + camera UI tạo bằng code** (`Bootstrap.ensureUiRoot`): HUD có hiện không,
   có đúng góc trên-trái không. Nếu HUD mất, nghi thứ tự `addComponent(Canvas)` /
   `addComponent(Camera)` / `cameraComponent = camera` hoặc layer `UI_2D`.
2. **`SpriteFrame.rect` cắt tile** (`level-view.sliceFrame`): sàn phải là **cỏ**, không
   phải ô đất/nước. Nếu sàn ra màu khác ⇒ rect đang bị hiểu theo gốc dưới-trái; sửa
   `y = chiềuCaoTexture - y - 16` trong `FLOOR_RECT`.
3. **Tỉ lệ pixel**: mỗi texture pixel phải là 1/16 world unit, tức **frame** 16 px
   (monster) = 1 tile, **frame** 32 px (player) = 2 tile, frame 96 px (samurai) = 6 tile.
   Nhân vật bên trong khung player chỉ chiếm ~15 px giữa frame nên trông cao ~1 tile.
   Sai tỉ lệ ⇒ xem `actorScale()` trong `level-view.ts`.
4. **`SpriteAnimator`** tự load manifest (không cần `init`): nếu nhân vật đứng im một
   frame, kiểm tra animator có tự resolve key không.
5. **Thứ tự `start()`**: `Bootstrap.start()` chạy sau khi scene active; nếu log
   `[YokaiField] Chapter 1` không xuất hiện thì component chưa chạy, không phải load lỗi.

Biết trước các giới hạn có chủ ý (không phải bug):

- **Boss chưa nối.** Tới phòng `9/9` game log `TODO(boss)` rồi dừng —
  `core/sim/boss-run.ts` là bản mẫu để nối `stepBoss`.
- **Caster chưa bắn đạn** (chỉ telegraph + đổi màu). Xem `TODO(enemy-bullets)` trong
  `bootstrap.ts`.
- **Chết là biến mất**, chưa có FX nổ (art đã stage ở `resources/art/fx/explosion`).
- **Vật cản chặn đạn nhưng không chặn player** — đúng như
  `core/sim/run-simulation.ts` ("vật cản chỉ chặn đạn"): player đi xuyên qua cột được,
  nên có thể đứng trong cột và mọi viên đạn bắn ra đều chết ngay tại chỗ. Nếu playtest
  thấy khó chịu thì thêm `obstacleAt()` vào bước di chuyển của `PlayerController`
  (trượt theo từng trục để không bị kẹt góc).
- **HUD không tự canh lại khi đổi cỡ cửa sổ** (vị trí tính một lần lúc `init`). Web build
  resize sau khi load thì tim/nhãn giữ vị trí cũ.

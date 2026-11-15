# GDD — Yokai Field v2 (roguelite)

Trạng thái: bản nháp 1, chốt các quyết định từ phiên thiết kế 2026-11-15. Chưa có phần nào được implement.

---

## 1. Pitch

Roguelite né đạn một màn hình, top-down 16px. Người chơi **luôn tự động bắn** vào kẻ địch gần nhất, nên kỹ năng duy nhất là **di chuyển**. Mỗi phòng dọn sạch → chọn 1 trong 3 kỹ năng ngẫu nhiên. Chết là hết run, giữ vàng để mua upgrade vĩnh viễn.

3 chapter, mỗi chapter 8 phòng + 1 boss. Bối cảnh lấy từ tileset có thật trong pack: **đồng cỏ/rừng → sông/thác → làng hoang**. Không có rồng, không có dungeon. Boss: **Tengu → Squid → Samurai**. Nhân vật: **NinjaGreen** (nhân vật duy nhất của pack có bộ animation 4 hướng đầy đủ).

Tham chiếu: Archero (loop), nhưng **bắn liên tục kể cả khi đang chạy** — khác Archero ở chỗ không có "đứng lại mới bắn".

---

## 2. Core loop

```text
Title → chọn chapter → RUN
  phòng 1 → dọn sạch → chọn 1/3 skill
  phòng 2 → ...
  ... 8 phòng
  phòng 9 = BOSS
→ màn hình kết quả (số phòng, vàng, thời gian)
→ meta shop (mua upgrade vĩnh viễn)
→ Title
```

- 1 run = 8 phòng thường + 1 boss.
- 1 run dài 8–12 phút.
- 3 chapter; chapter sau mở khi thắng chapter trước.

---

## 3. Combat model

| Tham số | Giá trị |
|---|---|
| Di chuyển | WASD, 8 hướng, không dash |
| Bắn | **tự động, liên tục, kể cả khi đang chạy** |
| Aim | tự nhắm enemy gần nhất trong tầm |
| Nhịp bắn cơ bản | 2 phát/giây |
| Đạn cơ bản | 1 viên, damage 1, tốc độ 12 tile/s |
| Máu người chơi | 6 tim |
| Nhận damage | 1, i-frame **0.8 s**, knockback 3 px |
| Chết | hết run ngay, không hồi sinh trong run |

Không có nút đánh, không có nút bắn. Input duy nhất: **WASD + Esc (pause)**.

---

## 4. Kẻ địch

Ràng buộc từ pack: **mọi monster chỉ có 1 sheet 4 hướng × 4 frame walk**, không có attack/hurt/death. Nên toàn bộ biểu đạt của enemy là **AI + FX + tint**:
- Telegraph = vòng `Magic/Circle` dưới chân (300–700 ms) + flash trắng 80 ms.
- Chết = `FX/Elemental/Explosion` + fade out.
- Elite = **palette remap** trên 53 màu của `Palette.png` (không nhân màu), scale 1.15.

| Vai trò | Máu | Hành vi | Đòn | Chapter 1 / 2 / 3 |
|---|---|---|---|---|
| **Chaser** | 3 | lao thẳng vào player, tốc độ cao | chạm người gây 1 | BlueBat / SpiderRed / Snake3 |
| **Caster** | 2 | giữ khoảng cách 4–6 tile, lùi khi bị áp sát | đạn chậm, telegraph 500 ms | Eye / GreenOctopus / LanternRed |
| **Brute** | 8 | chậm, đi thẳng | charge đường thẳng, telegraph 700 ms | Bear / TRex / Cyclope |

Độ khó tăng theo chapter:

| Chapter | Số enemy/phòng | Thành phần |
|---|---|---|
| 1 | 3–4 | chaser, 1 caster từ phòng 4 |
| 2 | 5–6 | chaser + caster + 1 brute từ phòng 3 |
| 3 | 7–8 | cả 3 loại + elite |

Dự phòng nếu silhouette trùng nhau: YellowsBat, MouseBlack, LanternGreen, RedOctopus, Panda, Reptile2, Skull, GreyTrex.

---

## 5. Boss

Mỗi chapter một boss, lấy từ `Actor/Boss`. Arena 32×18 tile với 4 cột đá phá được. Máu: 60 / 80 / 100.

| Chapter | Boss | Animation có sẵn | Pattern |
|---|---|---|---|
| 1 | **TenguBlue** (frame 68×68 – 82×82) | idle 6, walk 10, **attack 15**, hit 8, **Trans 11** | (1) đi bộ đuổi + đòn attack bắn chùm 5 viên; (2) thêm `Trans` dịch chuyển ngẫu nhiên rồi bắn vòng 8 viên; (3) enrage: dịch chuyển 3 lần liên tiếp, chùm 5 viên ×3 đợt |
| 2 | **SquidGreen** (76×79) | idle 4, walk 4, attack 6, **AttackLoop 4**, **Shoot 5**, hit 4 | (1) bơi ngang + `Shoot` 5 viên toả; (2) `AttackLoop` phun đạn liên tục theo hình xoắn; (3) gọi 2 GreenOctopus, xoắn nhanh hơn |
| 3 | **GiantBlueSamurai** (frame 96×48 – 96×96) | idle 6, walk 6, **attack L/R 4**, **charge L/R 3**, hit 4 | (1) charge ngang arena rồi slash bắn sóng đạn thẳng; (2) charge 2 lần liên tiếp, đổi hướng; (3) charge để lại vệt lửa + slash 2 sóng |

Nguyên tắc đọc đòn: mỗi phase phải có **một dấu hiệu khác nhau** — Ch1 đọc hướng chùm đạn, Ch2 đọc nhịp xoắn, Ch3 đọc hướng charge (animation L/R là dấu hiệu).

Loại: DemonCyclop, GiantFlam, GiantSpirit (không có frame đòn), Dragon* (0 animation).

---

## 6. Kỹ năng (pool 20, đóng băng ở v1)

Sau mỗi phòng (trừ phòng boss): chọn **1 trong 3** thẻ. Cùng kỹ năng lấy lại thì **cộng dồn** (tối đa 5 stack). Rarity ảnh hưởng trọng số xuất hiện.

| # | Tên | Rarity | Hiệu ứng | Stack |
|---|---|---|---|---|
| 1 | Sharpen | common | +1 damage | 5 |
| 2 | Rapid Fire | common | +25% nhịp bắn | 5 |
| 3 | Twin Shot | rare | +1 viên đạn (bắn chéo ±12°) | 3 |
| 4 | Piercing | rare | đạn xuyên 1 enemy | 3 |
| 5 | Ricochet | epic | đạn nảy sang enemy khác 1 lần | 2 |
| 6 | Homing | epic | đạn tự bám mục tiêu | 1 |
| 7 | Explosive | rare | đạn nổ AoE 1.5 tile, 50% damage | 3 |
| 8 | Crit Eye | rare | 15% chí mạng ×2 | 3 |
| 9 | Vitality | common | +1 tim tối đa (hồi 1 tim ngay) | 5 |
| 10 | Second Wind | epic | hồi 2 tim mỗi khi dọn phòng | 2 |
| 11 | Shield | rare | chặn 1 đòn, hồi sau 20 s | 3 |
| 12 | Thorns | rare | chạm vào enemy gây 2 damage cho nó | 3 |
| 13 | Swift | common | +10% tốc chạy | 5 |
| 14 | Long i-frame | rare | i-frame 0.8 → 1.1 s | 2 |
| 15 | Freeze | rare | trúng địch làm chậm 40% trong 1 s | 2 |
| 16 | Poison | rare | 1 damage/giây trong 3 s | 2 |
| 17 | Lifesteal | epic | 5% damage hồi máu (làm tròn xuống) | 2 |
| 18 | Greed | common | +25% vàng nhặt | 4 |
| 19 | Luck | rare | +1% trọng số rarity cao | 3 |
| 20 | Executioner | epic | +50% damage lên enemy dưới 30% máu | 2 |

---

## 7. Meta progression

Vàng nhặt trong run được giữ sau khi chết. 3 track vĩnh viễn, mỗi track 10 cấp, giá tăng dần:

| Track | Mỗi cấp | Giá cấp 1 → 10 |
|---|---|---|
| Máu | +1 tim | 50 → 500 (tăng ~×1.3) |
| Damage | +5% | 40 → 400 |
| Nhịp bắn | +3% | 40 → 400 |

Không có equipment, không có nhân vật thứ hai, không unlock skill.

---

## 8. Phòng và level design

- **Mỗi phòng = đúng 1 màn hình.** Base resolution **512×288 px = 32×18 tile 16px**. Không scroll, **không cần camera follow**.
- Phòng sinh quái theo **wave** (1 wave/phòng ở chapter 1, 2 wave từ chapter 2).
- Vật cản: cột, hố, tường thấp — dùng để né đạn, không chặn tầm bắn hoàn toàn.
- 3 chapter × 9 phòng = 27 phòng, thiết kế tay trong Tiled, thứ tự cố định (không random layout) — random nằm ở skill, không ở map.

| Chapter | Theme | Tileset dùng |
|---|---|---|
| 1 | Đồng cỏ / rừng | `TilesetNature` + `TilesetRelief` + `TilesetElement` + `TilesetField` |
| 2 | Sông / thác | `TilesetWater` + waterfall + ripples + `TilesetNature` làm bờ |
| 3 | Làng hoang | `TilesetVillageAbandoned` + `TilesetHouse` + `TilesetTowers` + `TilesetHole` |
| Arena boss | Cùng theme chapter | + 4 cột đá (từ `TilesetElement`) |
| Hub / shop | Trại | `tileset_camp` + `tileset_bed` + `Interior/*` |

Không có theme dungeon/crypt trong pack → không làm. `TilesetFloor.png` cao 417 px (không chia hết 16) → cắt 26 hàng, bỏ 1 px cuối.

---

## 9. UI

| Màn hình | Nội dung |
|---|---|
| Title | Play, Settings, Credits |
| Chapter select | 3 nút, khoá/mở, hiện best |
| HUD | tim, vàng, icon skill (tối đa 8), số phòng `3/9` |
| Skill pick | 3 thẻ, hover hiện mô tả, click chọn |
| Pause | Resume, Restart run, Quit to title, volume |
| Kết quả | phòng đạt, vàng nhặt, thời gian, nút về meta shop |
| Meta shop | 3 track + giá, hiện vàng hiện có |
| Settings | volume, fullscreen, hiện keybind (không rebind ở v1) |
| Credits | tác giả pack (không bắt buộc với CC0, nhưng nên) |

Điều khiển: **chuột + bàn phím**. Không gamepad, không touch.

---

## 10. Save

`localStorage`, 1 slot:

```json
{
  "version": 1,
  "gold": 0,
  "upgrades": { "hp": 0, "damage": 0, "firerate": 0 },
  "chaptersUnlocked": 1,
  "best": { "chapter": 0, "room": 0 },
  "settings": { "volume": 0.8, "fullscreen": false }
}
```

**Không** lưu run đang chơi (user chọn: mất run khi tắt tab).

---

## 11. Ngoài scope v1

Inventory, equipment, NPC, dialog, hub, shop trong màn, nhiều nhân vật, gamepad, mobile, localization, leaderboard, daily run, dash.

---

## 12. Rủi ro đã biết

1. **Bắn liên tục** làm mất tension "đứng lại mới bắn" của Archero → độ khó phải đến từ mật độ đạn; nếu playtest thấy nhạt, thêm lại luật đứng-ý-định như một skill.
2. **Chỉ có 1 nhân vật animated** (NinjaGreen) và nhân vật này **không có animation run**, chỉ có walk 4 frame → phải scale tốc độ phát animation theo vận tốc, nếu không nhân vật sẽ "trượt" khi chạy nhanh.
3. **Không monster nào có attack/hurt/death** → telegraph, trúng đòn và chết đều là FX + tint. Rủi ro: người chơi không đọc được đòn. Test bắt buộc ở M3: 3 enemy phải phân biệt được trong 2 giây.
4. **20 skill × 3 chapter** là khối balance lớn; giữ pool đóng băng, chỉ tune số.
5. `TilesetFloor.png` lệch 1 px và không có atlas JSON → bảng frame/animation phải khai báo tay, sai một ô là lệch toàn bộ animation.

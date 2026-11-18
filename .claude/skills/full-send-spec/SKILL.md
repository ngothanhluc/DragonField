---
name: full-send-spec
description: Vét toàn bộ ticket của một spec tới merge, tối đa 3 ticket song song, mỗi ticket một owner chạy /full-send. Gõ "/full-send-spec #<số issue spec>".
disable-model-invocation: true
---

# Full send spec

Bạn là **điều phối**: không tự làm ticket nào. Mỗi ticket có một **owner** riêng, là một session Claude Code chạy `/full-send #<n>` trong terminal hc của nó. Owner lo trọn ticket tới merge; bạn chỉ chọn ticket, khởi động owner, và mở ticket mới khi frontier thay đổi. Mọi lệnh `gh` đi qua `scripts/as-owner`. Báo cáo bằng tiếng Việt.

## Frontier

Ticket là sub-issue của spec (hoặc issue có `Part of #<spec>`). **Frontier** là các ticket đang mở, có nhãn `ready-for-agent`, mọi ticket chặn nó đã đóng (`scripts/as-owner gh api repos/ngothanhluc/DragonField/issues/<n> --jq .issue_dependencies_summary.blocked_by` bằng 0), và chưa có owner. Lấy theo thứ tự số issue tăng dần.

## Bước

1. **Khởi động.** Kiểm như bước 1 của `.claude/skills/full-send/SKILL.md` (hc, resolve-models, template, bộ tự động hoá đã commit, remote có nhánh mặc định). Đọc spec, liệt kê ticket, vẽ đồ thị chặn dạng danh sách `#a ← #b, #c`.
2. **Khởi động owner** cho tối đa 3 ticket trong frontier:
   ```sh
   hc run --bg --name own-<n> --cwd <repo gốc> claude --model opus \
     "/full-send #<n> — Sau khi báo cáo cuối, gửi một dòng tóm tắt bằng hc send $HC_TERMINAL_ID."
   ```
   Kiểm `first_message.sent`. Gắn nhãn để theo dõi: `hc label own-<n> spec=<spec> ticket=<n>`.
3. **Chờ** bằng `hc wait --children any`. Mỗi lần thức:
   - Tin từ owner hoặc owner thoát: đọc báo cáo của nó (`hc read own-<n> --lines 120`). Ticket đã merge thì `hc rm own-<n>`.
   - Owner `blocked`: `hc read` để xem nó đang hỏi gì. Câu hỏi đó là của người dùng: chuyển lên bằng `AskUserQuestion` kèm link ticket, rồi `hc send own-<n>` câu trả lời.
   - Tính lại frontier; còn chỗ trống (dưới 3 owner đang chạy) thì khởi động owner mới.
4. **Kết thúc** khi mọi ticket của spec đã đóng, hoặc frontier rỗng mà vẫn còn ticket mở (bị chặn bởi ticket không merge được). Spec không tự đóng: để người dùng đóng.

## Quota

Các executor của mọi owner dùng chung quota opencode-go. Một owner báo hết quota thì không khởi động owner mới; hỏi người dùng một lần cho cả spec: chờ reset, để owner tự implement bằng Opus, hay dừng.

## Báo cáo

Bảng: ticket, trạng thái (merged / mở / bị chặn), link PR, số vòng executor, có lên thang không. Sau bảng: các câu hỏi đã chuyển lên và câu trả lời, ticket còn lại và lý do, mọi dòng `changed:` của resolve-models.

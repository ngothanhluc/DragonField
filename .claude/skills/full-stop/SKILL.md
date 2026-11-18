---
name: full-stop
description: Như full-send nhưng dừng khi PR sẵn sàng để bạn merge, không bao giờ merge. Gõ "/full-stop #<số issue>".
disable-model-invocation: true
---

# Full stop

Đọc `.claude/skills/full-send/SKILL.md` và làm theo toàn bộ: quyền test, bước 1–7, thang executor, cách hỏi người dùng. Lệnh `/full-stop` cấp những quyền đó mà không cần thêm `/full-send`, **trừ quyền merge**. Các điều dưới đây thắng full-send khi mâu thuẫn.

## Không merge

Được commit, push, rebase, giải conflict, `--force-with-lease` trên branch của ticket. Không merge, không bật auto-merge, không push nhánh mặc định, không bypass branch protection, không giao những việc đó cho agent khác. Không lấy `merge-lock`.

Trước khi bắt đầu và trước mỗi lần push: PR đang bật auto-merge thì tắt (`scripts/as-owner gh pr merge <pr> --disable-auto`) và ghi vào báo cáo.

## Dừng ở cổng merge

Thay bước 8 và 9 của full-send bằng bàn giao:

1. `scripts/as-owner git fetch origin`; kiểm PR trên GitHub: đang mở, không phải draft, head đúng commit bạn đã proof, không bật auto-merge. Ai đó đã merge thì báo điều đó.
2. Dùng **cổng merge** của full-send làm điều kiện sẵn sàng. Proof và review phải phủ diff cuối; rebase có giải conflict thì proof lại.
3. Kết luận một trong ba:
   - **Sẵn sàng merge**: cổng merge qua hết. PR để mở, chưa merge.
   - **Chờ duyệt**: chỉ còn thiếu duyệt của người. Xác nhận đó thật là thứ duy nhất chặn.
   - **Bị chặn**: nêu cái gì chặn, đã thử gì, cần gì; hỏi theo full-send nếu cần.
4. Dọn terminal hc của ticket (executor, watcher). **Giữ worktree** để bạn xem hoặc sửa tiếp.

Báo cáo như full-send, thay link merge commit bằng: link PR, head SHA, kết luận ở bước 3, đường dẫn worktree, và câu khẳng định PR vẫn mở và chưa merge.

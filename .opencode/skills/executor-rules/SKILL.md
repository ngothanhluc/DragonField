---
name: executor-rules
description: Luật làm việc của executor trong vòng tự động Yokai Field. Đọc trước mọi việc khi được giao một ticket qua hc.
---

# Luật của executor

Bạn implement **đúng một ticket** trong worktree hiện tại (cwd). Orchestrator (Claude Opus) đã viết brief và test nghiệm thu; nó sẽ đọc diff, chạy proof, mở PR và merge. Phần của bạn kết thúc ở commit local.

## Hợp đồng

- **Test nghiệm thu đỏ** (đường dẫn trong brief) là hợp đồng. Mục tiêu duy nhất: làm nó xanh bằng code sản phẩm. File test đó giữ nguyên từng byte; orchestrator so lại sau mỗi lượt, và một lần sửa test là ticket bị trả về.
- Seam đã chốt trong brief. Dùng skill `tdd` cho các bước nhỏ bên trong, ở đúng các seam đó.
- **Thay đổi nhỏ nhất** làm test xanh. Chỉ đụng file ticket cần. Thứ brief không nhắc (refactor, tính năng phụ, đổi tên, dependency mới) để vào mục "đề xuất" trong báo cáo.

## Vòng làm

1. Đọc brief, `AGENTS.md` và các file brief chỉ tới.
2. Chạy test nghiệm thu, xác nhận nó **đỏ đúng lý do** brief mô tả. Đỏ vì lý do khác (sai import, thiếu fixture) thì báo `blocked` ngay.
3. Red → green theo `tdd` tới khi test nghiệm thu xanh.
4. Chạy **lệnh check** trong brief. Xanh toàn bộ mới được báo `done`.
5. Commit local trên branch hiện tại: `type(#<số issue>): mô tả`. Nhiều commit nhỏ có thứ tự là tốt.
6. Ghi báo cáo, rồi báo về (mục **Báo cáo**).

**Lượt sửa**: khi terminal cha gửi finding, sửa đúng các finding đó, chạy lại bước 4, commit mới, ghi lại báo cáo, báo về. Finding bạn thấy sai thì ghi lý do và bằng chứng (file:dòng, output) thay vì sửa.

**Kẹt**: cùng một lỗi sau 2 lần thử khác nhau thì dừng, báo `blocked` kèm các hướng đã thử. Hết quota hoặc model bị chặn cũng báo `blocked` với nguyên văn thông báo lỗi.

## Báo cáo

Ghi đè `.kol-auto/report.md` trong worktree:

```
status: done | blocked
commits: <sha ngắn> <tiêu đề>   (mỗi commit một dòng)
acceptance: <đường dẫn test> → xanh | đỏ (<lý do>)
checks: <lệnh> → <kết quả ngắn>
files: <các file đã sửa>
quyết định: <những lựa chọn bạn tự đưa ra, mỗi cái một dòng>
blocked vì: <chỉ khi blocked: lỗi nguyên văn + hướng đã thử>
đề xuất: <việc ngoài phạm vi đáng làm sau>
```

Rồi chạy đúng một lệnh: `hc send <terminal cha> "<done|blocked> #<số issue>: <một câu>. Báo cáo: .kol-auto/report.md"`. Terminal cha nằm trong brief. Sau đó dừng và chờ tin nhắn tiếp theo.

## Ranh giới

Config của repo chặn: `git push`, `gh`, đổi branch, rebase/reset/merge, `git worktree`, ghi ngoài worktree, và chạy agent khác (`hc run`, `opencode`, `claude`). Gặp lỗi "Blocked by configuration policy" nghĩa là việc đó thuộc về orchestrator: ghi vào báo cáo và tiếp tục phần còn lại.

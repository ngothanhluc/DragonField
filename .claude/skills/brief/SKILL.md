---
name: brief
description: Biến một issue thành worktree, test nghiệm thu đỏ và brief cho executor. Bước 2 của full-send.
disable-model-invocation: true
---

# Brief

Brief là **toàn bộ context** executor có: nó không thấy cuộc trò chuyện này, không đọc được issue trên GitHub. Thứ gì executor cần mà không nằm trong brief hoặc trong file brief chỉ tới thì coi như không tồn tại.

## Bước

1. **Đọc ticket.** `scripts/as-owner gh issue view <n> --json number,title,body,labels,comments`. Issue có `## Parent` hoặc là sub-issue thì đọc cả spec cha. Đọc `AGENTS.md`, `GLOSSARY.md` và các ADR trong `docs/adr/` mà ticket chạm tới. Dùng đúng từ trong glossary ở mọi chỗ bạn viết.
2. **Worktree.** `scripts/as-owner git fetch origin`. Tạo branch `ticket/<n>-<slug>` từ `origin/<nhánh mặc định>` trong worktree `<thư mục cha của repo>/DragonField.worktrees/<n>-<slug>`. Đã có worktree hoặc branch của ticket này (chạy lại sau khi dừng): dùng lại, đọc `git log` và `.kol-auto/` trong đó để biết đã tới đâu.
3. **Cờ rủi ro.** `rủi ro: có` khi ticket chạm tới xác thực hoặc phân quyền, tiền hoặc thanh toán, xoá hoặc migrate dữ liệu, máy trạng thái booking, hoặc nhiều tác nhân cùng ghi một bản ghi. Ghi lý do một dòng. Cờ này bật thêm vòng kẻ phá trong `review-loop`.
4. **Seam và test đỏ.** Chọn seam cao nhất phủ được tiêu chí nghiệm thu của issue; seam có sẵn hơn seam mới. Viết test nghiệm thu ở seam đó, mỗi tiêu chí ít nhất một assertion, giá trị mong đợi lấy từ issue hoặc ví dụ cụ thể (không tính lại theo cách code sẽ tính). Chạy nó: phải **đỏ đúng lý do**, tức là assertion về hành vi còn thiếu fail, không phải lỗi cú pháp, import hay fixture. Commit trong worktree: `test(#<n>): test nghiệm thu đỏ`. Ghi SHA.
   - Repo chưa có test runner, hoặc ticket thuần cấu hình/scaffold: không có test đỏ. Ghi `skip: <lý do>` và thay bằng một **lệnh nghiệm thu** chạy được (lệnh + output mong đợi) trong brief.
5. **Lệnh check.** Lấy từ `package.json` scripts hoặc `AGENTS.md` (lệnh CI chạy: typecheck, lint, test). Chưa có thì ghi rõ "chưa có lệnh check" và chỉ dùng test nghiệm thu.
6. **Viết `.kol-auto/brief.md`** trong worktree theo mẫu dưới.

## Mẫu brief

```markdown
# Ticket #<n>: <tiêu đề>

Mục tiêu: <vấn đề của người dùng và hành vi cần có, 2-3 câu, từ góc nhìn người dùng>
Tiêu chí nghiệm thu:
- <copy từ issue>
Data shape: <các type/bản ghi chính, trường quan trọng, quan hệ; dùng từ trong GLOSSARY>
Seam (đã chốt, không hỏi lại): <seam> — bắt được gì, bỏ sót gì
Test nghiệm thu: <đường dẫn> @ <SHA> — đỏ vì: <thông báo fail mong đợi>
  (hoặc) Lệnh nghiệm thu: <lệnh> → <output mong đợi>
Lệnh check: <lệnh>
Đọc trước: <các file liên quan nhất, kèm lý do một dòng mỗi file>
Được sửa: <thư mục/file trong phạm vi>
Không đụng: <file test nghiệm thu, và các vùng ngoài phạm vi>
Ngoài phạm vi: <việc liên quan nhưng không làm ở ticket này>
Rủi ro: có | không — <lý do>
```

## Xong khi

`.kol-auto/brief.md` có đủ mọi mục; test nghiệm thu đã commit và output đỏ đúng lý do nằm trong tay bạn (hoặc có dòng `skip:` với lệnh nghiệm thu thay thế); `git status` trong worktree sạch ngoài `.kol-auto/`.

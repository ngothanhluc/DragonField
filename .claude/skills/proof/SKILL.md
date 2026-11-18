---
name: proof
description: Thu bằng chứng tự quan sát rằng thay đổi chạy đúng, theo bậc thang từ repro tới app thật. Bước 5 của full-send.
disable-model-invocation: true
---

# Proof

**Proof** là bằng chứng bạn tự quan sát trong session này: output lệnh, một lần repro, ảnh chụp. Báo cáo của executor, test mock xanh, "compile được" là lời kể, không phải proof. Mọi dòng trong diff phải được một bằng chứng nào đó phủ.

## Bậc thang

Leo tới bậc cao nhất mà thay đổi cho phép; ghi lại từng bậc đã chạy.

1. **Repro trước/sau.** Bug: chạy lại đúng repro trên commit trước fix (thấy lỗi) và trên HEAD (hết lỗi). Tính năng: test nghiệm thu đỏ ở SHA test đỏ, xanh ở HEAD.
2. **Check của CI.** Lệnh check trong brief, chạy trên HEAD sau rebase, xanh toàn bộ.
3. **Test chặn hồi quy.** Hành vi mới có ít nhất một test sẽ đỏ nếu bỏ thay đổi. Kiểm thật: tạm revert phần code sản phẩm (`git stash` hoặc checkout file ở SHA test đỏ trong một worktree tạm), chạy test, thấy đỏ, khôi phục.
4. **App thật.** Hành vi người dùng nhìn thấy (UI, API, CLI): chạy app và quan sát đúng hành vi đó, theo `docs/agents/run-app.md`. Ảnh chụp hoặc output request/response là bằng chứng; đính vào PR khi có cách upload.
   - `docs/agents/run-app.md` chưa tồn tại (repo chưa chọn stack): bỏ bậc này, ghi `proof bậc 4: chưa có app để chạy` trong báo cáo và PR.

## Kết quả

Một khối ngắn đưa vào PR và báo cáo:

```
Proof:
- bậc 1: <lệnh> → trước: <fail> / sau: <pass>
- bậc 2: <lệnh check> → <kết quả>
- bậc 3: <test> đỏ khi bỏ thay đổi → <xác nhận>
- bậc 4: <cách chạy app + quan sát> | chưa có app để chạy
Chưa proof được: <phần diff nào, vì sao>   (bỏ dòng nếu không có)
```

Còn phần diff chưa được bậc nào phủ: thêm proof cho nó, hoặc thu hẹp diff. Không làm được cả hai thì hỏi người dùng theo `full-send`.

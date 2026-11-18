---
name: effort
description: Bảng effort theo vai trò và thang nâng effort của executor. full-send, review-loop, full-send-spec đọc khi khởi động agent.
disable-model-invocation: true
---

# Effort

**Bắt đầu thấp, chỉ nâng sau một thất bại đã kiểm được**: test nghiệm thu còn đỏ, check còn đỏ, executor báo `blocked`, hoặc blocker đã gửi sửa vẫn còn. "Ticket trông khó" không phải lý do nâng. Model tự chia effort kém hơn một bảng cố định, và effort cao trên việc dễ tốn gấp nhiều lần mà không hơn (nguồn và số liệu: `docs/agents/effort-research.md`).

## Thang executor

Mỗi bậc là một `model#variant`. Thang lấy từ `effort` trong `models.json`; model là bản mới nhất của dòng (`resolve-models`).

| Bậc | Template | File effort trong worktree |
|---|---|---|
| 1 | `oc-impl` | `.kol-auto/effort.executor` = `low` |
| 2 | `oc-impl` | `.kol-auto/effort.executor` = `high` |
| 3 | `oc-impl` | `.kol-auto/effort.executor` = `max` |
| 4 | `oc-impl-pro` | `.kol-auto/effort.executor-pro` = `high` |
| 5 | `oc-impl-pro` | `.kol-auto/effort.executor-pro` = `max` |
| hết thang | — | orchestrator xét lại tiền đề (`full-send`, thang executor) |

- Mỗi bậc được **một vòng thua**. Lượt sửa theo finding của review không tính là thua nếu sau lượt đó gate qua.
- Lên bậc: `hc kill` terminal executor, ghi file effort của bậc mới, chạy lại template trong **cùng worktree** với tên mới (`impl-<n>-b<bậc>`). Task gồm brief, ledger, và một dòng "bậc trước thua vì <gate + output>". Phải mở session mới vì opencode chỉ nhận variant lúc khởi động.
- Hết quota ở bất kỳ bậc nào: không lên bậc; hỏi người dùng theo `full-send`.

## Vai trò khác

| Vai trò | Cách đặt | Effort |
|---|---|---|
| Kẻ phá opencode (`oc-adversary`) | bậc đầu của `adversary` trong `models.json` | `medium` |
| Kẻ phá Claude (Agent tool) | tham số `effort` của Agent tool | `medium` |
| Subagent Claude đọc/tra cứu nhiều file | tham số `effort` của Agent tool | `low` |
| Owner trong `full-send-spec` | mặc định của session | không đặt |
| Orchestrator khi xét lại tiền đề | thêm từ `ultrathink` vào lượt đó | xhigh cho một lượt |

Agent tool chỉ đặt effort khi có tài liệu yêu cầu: bảng này là yêu cầu đó, nên mỗi lần gọi Agent tool trong vòng tự động đều truyền `effort` theo bảng.

## Ghi lại

Mỗi lần khởi động executor hoặc kẻ phá, thêm một dòng vào `.kol-auto/ledger.md`: `effort | <vai trò> | <model#variant> | <lý do: mặc định | thua ở <gate>>`. Báo cáo cuối nêu bậc cao nhất đã dùng và vì sao.

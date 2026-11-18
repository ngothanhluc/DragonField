---
name: review-loop
description: Opus review diff của executor theo vòng, có ledger và ngân sách; ticket rủi ro thêm kẻ phá. Bước 4 của full-send.
disable-model-invocation: true
---

# Review loop

Code do một model khác hãng viết; bạn là reviewer. Mục tiêu là **thay đổi nhỏ nhất đúng ý ticket**, không phải code hoàn hảo. Review hay làm PR phình dần từng chút một: chặn điều đó.

## Ngân sách

- Mặc định 3 vòng. Vòng 1 xem toàn bộ diff; các vòng sau chỉ xem code đã đổi và finding còn mở.
- Lên 5 vòng chỉ khi `rủi ro: có` và còn blocker hoặc should có bằng chứng.
- Vòng chỉ còn nit thì dừng sớm. Nit bị từ chối, sửa comment hay format không mở vòng mới.

## Một vòng

1. **Đọc báo cáo** `.kol-auto/report.md`. `status: blocked` là vòng thua (thang executor trong `full-send`); không review.
2. **Kiểm hợp đồng.** `git diff <SHA test đỏ> HEAD -- <file test nghiệm thu>` phải rỗng. Chạy test nghiệm thu và lệnh check trong worktree; ghi output thật. Đỏ là vòng thua.
3. **Đọc diff** `git diff <SHA test đỏ>...HEAD` cùng code xung quanh. Tìm: hành vi sai so với tiêu chí nghiệm thu, caller bị vỡ, lệch với GLOSSARY/ADR, code/test/guard mà ticket không cần. Bỏ qua style trừ khi nó giấu bug.
4. **Phân mức** từng finding:
   - **blocker**: trường hợp ticket nhắm tới chạy sai.
   - **should**: bug thật mà caller sẽ gặp, trong phạm vi ticket.
   - **nit**: còn lại. Đường khác, trường hợp hiếm, chi phí nhỏ, tương thích thêm là nit dù trông nghiêm trọng.
5. **Ghi ledger** `.kol-auto/ledger.md`, mỗi finding một dòng ổn định qua các vòng: `R<id> | <mức> | <file:dòng> | <nhận định> | <open|fixed|declined|disagree> | <bằng chứng>`.
6. **Gửi sửa.** Blocker và should gửi cho executor bằng `hc send`, kèm id, file:dòng, và cách sửa nhỏ nhất (ưu tiên xoá hoặc thu hẹp hơn thêm lock, cache, helper, option). Nit: từ chối một dòng, ghi follow-up. Executor phản bác kèm bằng chứng: kiểm bằng chứng, rồi đổi sang `disagree` hoặc giữ `open`.

`git diff --shortstat <SHA test đỏ>` tăng qua các vòng mà không phải để sửa blocker/should: cắt bớt trước khi vòng tiếp theo.

## Kẻ phá (chỉ khi `rủi ro: có`)

Sau khi vòng đầu không còn blocker, chạy hai kẻ phá song song, mỗi cái một worktree dùng một lần tạo từ HEAD của ticket (`git worktree add --detach <thư mục tạm> HEAD`):

- `hc run --bg --name adv-<n> --cwd <wt-tạm-1> oc-adversary "<mục tiêu ticket, tiêu chí nghiệm thu, đường dẫn diff, file báo cáo .kol-auto/adversary.md, terminal cha $HC_TERMINAL_ID>"`
- Một subagent Claude (Agent tool, `model: "opus"`, `effort: "medium"` theo `.claude/skills/effort/SKILL.md`, không `isolation`) với cùng thông tin và đường dẫn tuyệt đối `<wt-tạm-2>`: "Chỉ làm việc trong <wt-tạm-2>. Làm hỏng thay đổi này. Mỗi finding phải kèm lệnh đã chạy, output thật và output mà mục tiêu đòi hỏi. Không chạy thì không báo. Không sửa code sản phẩm, không commit."

Với mỗi finding nhận về, **tự chạy lại lệnh** của nó trên worktree ticket. Output cho thấy lỗi và lỗi phá mục tiêu ticket thì thêm vào ledger (mức theo bước 4). Còn lại bỏ, ghi số finding bị bỏ và lý do. Gộp các finding cùng gốc. Xoá các worktree tạm và `hc rm adv-<n>` sau đó.

## Dừng

- **Đồng thuận**: test nghiệm thu và check xanh trên HEAD, ledger không còn blocker/should `open`, bạn không còn mối lo nào.
- **Kẹt**: một mục `disagree` qua 2 lượt trao đổi, hoặc hết ngân sách mà còn blocker/should. Ghi hai phía 2–3 dòng mỗi bên vào ledger; hết ngân sách không phải là được duyệt. Kẹt ở should thì quyết theo bằng chứng mạnh hơn và ghi vào báo cáo; kẹt ở blocker thì hỏi người dùng (theo `full-send`).

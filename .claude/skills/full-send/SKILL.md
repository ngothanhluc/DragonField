---
name: full-send
description: Tự lái một ticket từ issue tới PR đã merge, không người canh. Gõ "/full-send #<số issue>".
disable-model-invocation: true
---

# Full send

Người dùng gõ lệnh này vì họ **không ngồi xem**. Tin nhắn giữa chừng của bạn không ai đọc tới rất lâu sau. Bạn sở hữu ticket từ trạng thái hiện tại tới **PR đã merge**. Kết thúc lượt khi CI hoặc executor còn chạy là công việc chết, vì không ai prompt lại: luôn chờ bằng `hc wait`.

Vai trò: bạn (Claude Opus) là **orchestrator**. Bạn viết brief và test đỏ, review, proof, mở PR, theo dõi CI, merge. Code sản phẩm do **executor** (opencode, model trong `models.json`) viết trong worktree riêng qua hc.

## Quyền được cấp

Lệnh `/full-send` là giấy phép cho:

- Merge PR khi qua **cổng merge**.
- Push và `--force-with-lease` lên branch của chính ticket này sau khi rebase.
- Mọi cách test mà proof cần (chạy app, dev server, trình duyệt, chụp màn hình), kể cả khi tài liệu nào đó bảo hỏi trước. Quy tắc về *cách* test (lệnh nào, fixture nào) vẫn áp dụng.

Mọi lệnh `gh` và `git` chạm remote đi qua `scripts/as-owner` (account `ngothanhluc`). Báo cáo, mô tả PR, comment issue viết bằng tiếng Việt.

## Bước

Mở todo list với đúng 9 bước dưới đây. Bước nào bỏ thì giữ trong list với `skip: <lý do>`.

1. **Khởi động.** Chạy từ repo gốc:
   - `$HC_TERMINAL_ID` phải có (đang chạy trong herdr-core). Không có thì dừng và nói cần chạy trong hc.
   - `scripts/resolve-models`. Ghi lại mọi dòng `changed:` và `orchestrator-latest:` cho báo cáo.
   - `hc templates` phải có `oc-impl`, `oc-impl-pro`, `oc-adversary`; thiếu thì chạy `scripts/install-hc-templates`.
   - `git ls-tree --name-only <nhánh mặc định> .opencode/opencode.json scripts/oc-agent` phải ra cả hai file: worktree tạo từ nhánh mặc định, nên bộ tự động hoá phải được commit ở đó.
   - `scripts/as-owner gh repo view --json defaultBranchRef` phải có tên nhánh. Rỗng nghĩa là remote chưa có nhánh nào: hỏi người dùng (mục **Hỏi người dùng**).
   - `scripts/as-owner gh issue view <n> --json number,title,state,labels`: issue mở và có nhãn `ready-for-agent`. Nêu tiêu đề issue.
2. **Brief.** Đọc `.claude/skills/brief/SKILL.md` và làm theo. Đầu ra: worktree, branch, SHA commit test đỏ, `.kol-auto/brief.md`, cờ `rủi ro`.
3. **Giao executor.** Đọc `.claude/skills/effort/SKILL.md`; khởi động ở bậc 1 (ghi `low` vào `.kol-auto/effort.executor`) và ghi dòng `effort` vào ledger.
   ```sh
   hc run --bg --name impl-<n> --cwd <worktree> oc-impl \
     "Ticket #<n>. Brief: .kol-auto/brief.md. Terminal cha: $HC_TERMINAL_ID. Báo về bằng hc send khi done hoặc blocked."
   ```
   Kiểm `first_message.sent`; false thì `hc read impl-<n>`, xử lý màn hình đang chờ, rồi mới gửi lại. Chờ bằng `hc wait --children any` cho tới khi có tin `<hc from="... impl-<n>">`. Hc báo executor `blocked`/`error`/thoát mà chưa gửi tin thì `hc read impl-<n> --lines 80` để biết vì sao.
4. **Review.** Đọc `.claude/skills/review-loop/SKILL.md` và làm theo, trên báo cáo `.kol-auto/report.md` của executor. Lượt sửa gửi bằng `hc send impl-<n> "<finding>"` và chờ như bước 3. Áp dụng **thang executor** bên dưới.
5. **Proof.** Đọc `.claude/skills/proof/SKILL.md` và làm theo. Không có proof cho một thay đổi thì chưa có full confidence: hỏi người dùng.
6. **Mở PR.**
   - `scripts/as-owner git fetch origin`, rebase branch lên `origin/<nhánh mặc định>`, chạy lại lệnh check của brief.
   - `scripts/as-owner git push -u origin <branch>` (sau rebase: `--force-with-lease`).
   - `scripts/as-owner gh pr create --base <nhánh mặc định> --title ... --body-file ...`. PR thật, không draft.
   - Tiêu đề theo quy ước commit của repo, nói vì sao thay đổi quan trọng. Thân PR: câu mở đầu là **vấn đề** của người dùng (lấy từ issue), rồi giải pháp ngắn gọn, rồi `Closes #<n>`, một dòng `Proof: ...`, một dòng `Review: <số vòng>, <kết quả ledger>`, và dòng cuối `Tạo bởi Claude Opus (orchestrator) + <model executor thật đã dùng> qua opencode.` Soát thân PR không chứa secret hay dữ liệu cá nhân.
7. **Theo dõi PR.** Đọc `.claude/skills/watch-pr/SKILL.md` và làm theo. Exit 1 vì check fail: sửa (giao lại executor nếu là code sản phẩm), proof lại, push, theo dõi lại.
8. **Merge.** Khi qua **cổng merge**, lấy khoá merge rồi merge (mục **Merge**).
9. **Dọn dẹp và báo cáo.** `hc kill`/`hc rm` các terminal của ticket, `git worktree remove <worktree>`, xoá branch local. Báo cáo cuối (mục **Báo cáo**).

## Thang executor

Một **vòng thua** là một lượt executor kết thúc mà gate của bước đó vẫn chưa qua: báo `blocked`, test nghiệm thu còn đỏ, check còn đỏ, hoặc một finding blocker đã gửi sửa vẫn còn.

- Mỗi vòng thua → lên một bậc trong **thang executor** của `.claude/skills/effort/SKILL.md` (flash low → high → max → pro high → max), terminal mới, cùng worktree.
- Thua ở bậc cuối → dừng giao việc. Trong lượt có từ `ultrathink`, viết **tiền đề** mà các lần thử cùng dựa vào ra một câu, rồi kiểm nó trực tiếp (chạy, đọc code, đọc issue). Tiền đề sai: sửa brief/test đỏ và giao lại từ bậc 1. Tiền đề đúng: tự implement trong worktree và ghi rõ trong báo cáo.
- Executor báo hết quota hoặc model bị chặn: giữ nguyên worktree và hỏi người dùng: chờ quota reset, để Opus tự implement, hay dừng.

File test đỏ (đường dẫn trong brief) phải giữ nguyên sau mọi lượt: `git diff <SHA test đỏ> HEAD -- <file test>` rỗng. Khác rỗng là vòng thua, kèm finding blocker "sửa test nghiệm thu".

## Cổng merge

Tất cả đúng trên commit mới nhất của PR:

- Proof phủ mọi thay đổi trong diff.
- `pr-wait` exit 0 ở commit này.
- Ledger review không còn blocker hay should mở.
- Không review nào của người đang request changes.
- Branch cập nhật với nhánh mặc định và GitHub báo mergeable.

## Merge

Các ticket chạy song song merge lần lượt: `scripts/merge-lock acquire` (chặn tới khi tới lượt; chạy nó với timeout Bash tối đa và gọi lại nếu hết giờ).

Trong khoá: `scripts/as-owner git fetch origin`. Nhánh mặc định có commit mới kể từ lần check xanh cuối thì rebase, chạy lại check, push `--force-with-lease` và chạy lại `pr-wait` theo `watch-pr`, **vẫn giữ khoá**. Merge bằng `scripts/as-owner gh pr merge <pr> --squash --delete-branch`, không bao giờ `--admin`. Xác nhận `scripts/as-owner gh pr view <pr> --json state` là `MERGED` và issue đã đóng, rồi `scripts/merge-lock release`.

Rebase ra conflict, check đỏ, hoặc `pr-wait` exit 1: `release` trước, rồi quay lại bước 4 hoặc 7. Bất kỳ đường thoát nào khác khỏi bước này cũng `release` trước.

## Hỏi người dùng

Câu hỏi trong tin nhắn thường không ai thấy. Hỏi bằng `AskUserQuestion` để thread hiện trạng thái đang chờ; câu hỏi tự chứa: link issue/PR, cái gì chặn, các lựa chọn với khuyến nghị đứng đầu. Chỉ hỏi khi:

- Không proof được thay đổi.
- Cổng merge kẹt và bạn không tự gỡ được.
- Bước tiếp theo vượt quyền được cấp: xoá dữ liệu, đụng production, đổi thứ ngoài repo, đóng PR/issue, force-push branch khác, push nhánh mặc định.
- Mục tiêu mơ hồ đến mức đổi kết quả.
- Hết quota opencode-go.

Mọi chuyện khác tự quyết với mặc định hợp lý và liệt kê trong báo cáo. Công cụ hỏi không có hoặc không trả lời: đi đường an toàn (để PR mở, không merge) và mở đầu báo cáo bằng câu hỏi.

## Báo cáo

Tiếng Việt, gồm: link PR và merge commit; proof (lệnh và kết quả đã thấy); ledger review (fixed / declined / disagree, mỗi mục một dòng); model đã dùng cho từng vai trò và mọi dòng `changed:`/`orchestrator-latest:` từ bước 1; số vòng executor và có lên thang không; mỗi quyết định bạn tự đưa ra; việc ngoài phạm vi đã ghi làm follow-up.

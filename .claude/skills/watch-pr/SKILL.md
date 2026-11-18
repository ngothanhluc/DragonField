---
name: watch-pr
description: Theo dõi PR qua CI bằng scripts/pr-wait trong một terminal hc, xử lý theo exit code. Bước 7 của full-send.
disable-model-invocation: true
---

# Watch PR

Một watcher cho mỗi PR, chạy trong terminal hc. Không tự viết vòng `sleep` hay poll: mọi watcher trên account dùng chung một rate limit GitHub.

## Chạy

```sh
hc run --bg --name prwait-<pr> --cwd <worktree> scripts/as-owner scripts/pr-wait <pr> --until green --allow-no-checks
hc wait prwait-<pr> --timeout 1800
```

`hc wait` trả về `timeout` là check-in, không phải lỗi: gọi lại. Khi terminal thoát: `hc read prwait-<pr> --lines 40` để đọc các dòng sự kiện, `hc get prwait-<pr> --json` để lấy `exit_code`, rồi `hc rm prwait-<pr>`. `pr-wait` báo đã có watcher khác cho PR này: dùng cái đó, không mở cái thứ hai.

`--allow-no-checks`: repo chưa có CI thì PR không có check nào được coi là xanh sau hai lần poll giống nhau. Khi repo đã có workflow CI, bỏ cờ này để một CI chưa kịp đăng ký không bị coi là xanh.

## Theo exit code

- **0**: điều kiện `green` đạt hoặc PR đã merge. Sang cổng merge.
- **1**: cần hành động. Đọc dòng sự kiện:
  - check fail: mở link, đọc log. Lỗi thật trong code của ticket thì gửi executor sửa (thang executor vẫn áp dụng), proof lại, push. Lỗi hạ tầng hoặc flake: chạy lại job một lần (`scripts/as-owner gh run rerun <run-id> --failed`); fail giống hệt lần hai thì coi là lỗi thật.
  - branch DIRTY (conflict): rebase lên nhánh mặc định, giải conflict theo ý ticket và các bất biến mới của nhánh mặc định, chạy lại check, `--force-with-lease`.
  - PR đóng: dừng và hỏi người dùng.
- **2**: tham số sai hoặc PR không tồn tại. Sửa lệnh; không thử lại vòng lặp.

Sau mỗi lần push, chạy lại watcher. Nó nhớ những gì đã báo (state ở `~/.local/state/pr-wait/`), nên không mất sự kiện tới trong lúc không ai canh.

## Rate limit

`gh pr create/view/checks` dùng GraphQL. Hết GraphQL thì REST còn quota riêng: `scripts/as-owner gh api repos/<owner>/<repo>/pulls/<n>` và `.../commits/<sha>/check-runs`. Xem còn bao nhiêu: `scripts/as-owner gh api rate_limit --jq .resources.graphql`.

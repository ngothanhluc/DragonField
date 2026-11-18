---
name: watch-pr
description: Watch the PR through CI with scripts/pr-wait in an hc terminal, act on the exit code. Step 7 of full-send.
disable-model-invocation: true
---

# Watch PR

One watcher per PR, running in an hc terminal. Do not write your own `sleep` loops or polling: every watcher on the account shares one GitHub rate limit.

## Running

```sh
hc run --bg --name prwait-<pr> --cwd <worktree> scripts/as-owner scripts/pr-wait <pr> --until green --allow-no-checks
hc wait prwait-<pr> --timeout 1800
```

`hc wait` returning `timeout` is a check-in, not an error: call it again. When the terminal exits: `hc read prwait-<pr> --lines 40` to read the event lines, `hc get prwait-<pr> --json` to get `exit_code`, then `hc rm prwait-<pr>`. If `pr-wait` says another watcher already exists for this PR: use that one, do not open a second.

`--allow-no-checks`: in a repo with no CI yet, a PR with no checks counts as green after two identical polls. Once the repo has a CI workflow, drop this flag so a CI that has not registered yet is not counted as green.

## By exit code

- **0**: the `green` condition is met or the PR is already merged. Move to the merge gate.
- **1**: action needed. Read the event lines:
  - check failed: open the link, read the log. A real bug in the ticket's code goes to the executor to fix (the executor ladder still applies), then prove again, push. Infrastructure error or flake: rerun the job once (`scripts/as-owner gh run rerun <run-id> --failed`); the same failure a second time counts as real.
  - branch DIRTY (conflict): rebase onto the default branch, resolve conflicts per the ticket and the default branch's new invariants, rerun the checks, `--force-with-lease`.
  - PR closed: stop and ask the user.
- **2**: wrong arguments or the PR does not exist. Fix the command; do not retry in a loop.

After every push, rerun the watcher. It remembers what it has already reported (state in `~/.local/state/pr-wait/`), so no event is lost while nobody is watching.

## Rate limit

`gh pr create/view/checks` use GraphQL. When GraphQL is exhausted, REST has its own quota: `scripts/as-owner gh api repos/<owner>/<repo>/pulls/<n>` and `.../commits/<sha>/check-runs`. Check the remaining budget: `scripts/as-owner gh api rate_limit --jq .resources.graphql`.

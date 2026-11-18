---
name: full-stop
description: Like full-send but stops when the PR is ready for you to merge, never merges. Type "/full-stop #<issue number>".
disable-model-invocation: true
---

# Full stop

Read `.claude/skills/full-send/SKILL.md` and follow all of it: testing permissions, steps 1–7, the executor ladder, how to ask the user. The `/full-stop` command grants those permissions without needing `/full-send`, **except the merge permission**. The points below win over full-send when they conflict.

## Do not merge

Committing, pushing, rebasing, resolving conflicts, and `--force-with-lease` on the ticket's branch are allowed. Do not merge, do not enable auto-merge, do not push the default branch, do not bypass branch protection, and do not hand any of that to another agent. Do not take `merge-lock`.

Before starting and before every push: if the PR has auto-merge enabled, turn it off (`scripts/as-owner gh pr merge <pr> --disable-auto`) and note it in the report.

## Stop at the merge gate

Replace steps 8 and 9 of full-send with a hand-off:

1. `scripts/as-owner git fetch origin`; check the PR on GitHub: open, not a draft, head is the exact commit you proved, auto-merge off. If someone already merged it, report that.
2. Use full-send's **merge gate** as the readiness condition. Proof and review must cover the final diff; if a rebase resolved conflicts, prove again.
3. Conclude with one of three:
   - **Ready to merge**: the merge gate is fully green. The PR stays open, unmerged.
   - **Waiting on review**: only a human review is missing. Confirm that really is the only blocker.
   - **Blocked**: state what blocks it, what you tried, what is needed; ask as full-send requires if needed.
4. Clean up the ticket's hc terminals (executor, watcher). **Keep the worktree** for you to inspect or keep editing.

Report as full-send, but replace the merge-commit link with: PR link, head SHA, the step 3 conclusion, the worktree path, and a statement that the PR is still open and unmerged.

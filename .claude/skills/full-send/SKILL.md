---
name: full-send
description: Drive a ticket from issue to merged PR on your own, unattended. Type "/full-send #<issue number>".
disable-model-invocation: true
---

# Full send

The user typed this command because they are **not watching**. Your mid-run messages will not be read until much later. You own the ticket from its current state to a **merged PR**. Ending the turn while CI or an executor is still running is dead work, because nobody will prompt you again: always wait with `hc wait`.

Role: you (Claude Opus) are the **orchestrator**. You write the brief and the red test, review, prove, open the PR, watch CI, merge. Product code is written by the **executor** (opencode, model from `models.json`) in a separate worktree via hc.

## Granted permissions

The `/full-send` command is permission to:

- Merge the PR once it passes the **merge gate**.
- Push and `--force-with-lease` to this ticket's own branch after rebasing.
- Any testing the proof needs (run the app, dev server, browser, screenshots), even when some document says to ask first. Rules about *how* to test (which command, which fixture) still apply.

Every `gh` and `git` command that touches the remote goes through `scripts/as-owner` (account `ngothanhluc`). Reports, PR descriptions and issue comments are written in English.

## Steps

Open a todo list with exactly the 9 steps below. If you skip one, keep it in the list with `skip: <reason>`.

1. **Bootstrap.** Run from the repo root:
   - `$HC_TERMINAL_ID` must exist (you are running inside herdr-core). If not, stop and say it must run in hc.
   - `scripts/resolve-models`. Record every `changed:` and `orchestrator-latest:` line for the report.
   - `hc templates` must have `oc-impl`, `oc-impl-pro`, `oc-adversary`; if missing, run `scripts/install-hc-templates`.
   - `git ls-tree --name-only <default branch> .opencode/opencode.json scripts/oc-agent` must list both files: worktrees are created from the default branch, so the automation must be committed there.
   - `scripts/as-owner gh repo view --json defaultBranchRef` must return a branch name. Empty means the remote has no branches yet: ask the user (section **Asking the user**).
   - `scripts/as-owner gh issue view <n> --json number,title,state,labels`: the issue is open and labeled `ready-for-agent`. State the issue title.
2. **Brief.** Read `.claude/skills/brief/SKILL.md` and follow it. Output: worktree, branch, red-test commit SHA, `.kol-auto/brief.md`, `risk` flag.
3. **Hand off to the executor.** Read `.claude/skills/effort/SKILL.md`; start at rung 1 (write `low` to `.kol-auto/effort.executor`) and write the `effort` line to the ledger.
   ```sh
   hc run --bg --name impl-<n> --cwd <worktree> oc-impl \
     "Ticket #<n>. Brief: .kol-auto/brief.md. Parent terminal: $HC_TERMINAL_ID. Report back with hc send when done or blocked."
   ```
   Check `first_message.sent`; if false, `hc read impl-<n>`, clear whatever screen is waiting, then resend. Wait with `hc wait --children any` until a `<hc from="... impl-<n>">` message arrives. If hc reports the executor `blocked`/`error`/exited without sending a message, run `hc read impl-<n> --lines 80` to find out why.
4. **Review.** Read `.claude/skills/review-loop/SKILL.md` and follow it, on the executor's `.kol-auto/report.md`. Send fix rounds with `hc send impl-<n> "<finding>"` and wait as in step 3. Apply the **executor ladder** below.
5. **Proof.** Read `.claude/skills/proof/SKILL.md` and follow it. No proof for a change means no full confidence: ask the user.
6. **Open the PR.**
   - `scripts/as-owner git fetch origin`, rebase the branch onto `origin/<default branch>`, rerun the brief's check command.
   - `scripts/as-owner git push -u origin <branch>` (after a rebase: `--force-with-lease`).
   - `scripts/as-owner gh pr create --base <default branch> --title ... --body-file ...`. A real PR, not a draft.
   - Title follows the repo's commit convention and says why the change matters. PR body: the opening sentence is the user's **problem** (from the issue), then a short solution, then `Closes #<n>`, one `Proof: ...` line, one `Review: <round count>, <ledger outcome>` line, and the last line `Created by Claude Opus (orchestrator) + <actual executor model used> via opencode.` Check the PR body contains no secrets or personal data.
7. **Watch the PR.** Read `.claude/skills/watch-pr/SKILL.md` and follow it. Exit 1 because a check failed: fix it (hand back to the executor if it is product code), prove again, push, watch again.
8. **Merge.** Once it passes the **merge gate**, take the merge lock and merge (section **Merge**).
9. **Clean up and report.** `hc kill`/`hc rm` the ticket's terminals, `git worktree remove <worktree>`, delete the local branch. Final report (section **Report**).

## Executor ladder

A **lost round** is an executor turn that ends with that step's gate still failing: reported `blocked`, red acceptance test, red checks, or a blocker finding that was sent for fixing still unresolved.

- Each lost round → go up one rung on the **executor ladder** in `.claude/skills/effort/SKILL.md` (flash low → high → max → pro high → max), new terminal, same worktree.
- Losing at the last rung → stop delegating. On a turn containing `ultrathink`, write down the **premise** all attempts share as one sentence, then verify it directly (run it, read the code, read the issue). Wrong premise: fix the brief/red test and delegate again from rung 1. Right premise: implement it yourself in the worktree and say so clearly in the report.
- Executor out of quota or model blocked: keep the worktree and ask the user: wait for quota reset, have Opus implement, or stop.

The red test file (path in the brief) must stay unchanged after every round: `git diff <red-test SHA> HEAD -- <test file>` is empty. Non-empty is a lost round, with a blocker finding "do not edit the acceptance test".

## Merge gate

All true on the PR's latest commit:

- Proof covers every change in the diff.
- `pr-wait` exits 0 on this commit.
- The review ledger has no open blocker or should.
- No reviewer is requesting changes.
- The branch is up to date with the default branch and GitHub reports it mergeable.

## Merge

Tickets run in parallel and merge one at a time: `scripts/merge-lock acquire` (blocks until it is your turn; run it with the maximum Bash timeout and call it again if it times out).

Inside the lock: `scripts/as-owner git fetch origin`. If the default branch has new commits since the last green check, rebase, rerun the checks, push `--force-with-lease` and rerun `pr-wait` as in `watch-pr`, **still holding the lock**. Merge with `scripts/as-owner gh pr merge <pr> --squash --delete-branch`, never `--admin`. Confirm `scripts/as-owner gh pr view <pr> --json state` is `MERGED` and the issue is closed, then `scripts/merge-lock release`.

Rebase conflict, red checks, or `pr-wait` exit 1: `release` first, then go back to step 4 or 7. Any other exit path from this step must also `release` first.

## Asking the user

Questions in a message usually go unseen. Ask with `AskUserQuestion` so the thread shows a waiting state; the question must be self-contained: issue/PR link, what is blocking, the options with the recommendation first. Ask only when:

- The change cannot be proven.
- The merge gate is stuck and you cannot unstick it yourself.
- The next step exceeds granted permission: deleting data, touching production, changing something outside the repo, closing a PR/issue, force-pushing another branch, pushing the default branch.
- The goal is so ambiguous that it changes the outcome.
- opencode-go quota is exhausted.

Everything else: decide with a sensible default and list it in the report. If the asking tool is unavailable or unanswered: take the safe path (leave the PR open, do not merge) and open the report with the question.

## Report

In English, including: PR link and merge commit; proof (commands and observed results); review ledger (fixed / declined / disagree, one line each); model used per role and every `changed:`/`orchestrator-latest:` line from step 1; number of executor rounds and whether the ladder was climbed; every decision you made yourself; out-of-scope work recorded as follow-ups.

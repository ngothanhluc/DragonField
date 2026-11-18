---
name: full-send
description: Drive a ticket from issue to merged PR on your own, unattended. Type "/full-send #<issue number>".
disable-model-invocation: true
---

# Full send

The user typed this command because they are **not watching**. Nobody reads your mid-run messages and nobody will prompt you again, so a turn that ends while CI or an executor is still running is dead work. Whenever you wait, wait with `hc wait`. You own the ticket from its current state to a **merged PR**.

## Roles

This table is the single source for who runs what. Every other automation skill refers to it.

| Role | Runs as | Model | Started by |
|---|---|---|---|
| **Orchestrator** (you) | the Claude Code session | Claude Opus (`orchestrator` in `models.json`) | the user, or `full-send-spec` with `claude --model opus` |
| **Executor** | opencode in an hc terminal, template `oc-impl` | `executor` line in `models.json` | you, step 3 |
| **Executor-pro** | opencode, template `oc-impl-pro` | `executor-pro` line | you, executor ladder rungs 4–5 |
| **Adversary** | opencode, template `oc-adversary`, plus one Claude Opus subagent | `adversary` line / Opus | `review-loop`, only when `risk: yes` |

- **The orchestrator writes:** the brief, the red acceptance test, the review, the proof, the PR. **The executor writes:** the product code. The executor ladder is the only exception (last rung lost and the premise is right).
- **Do your own reading and searching** with your own tools in this session. The risk adversary in `review-loop` is the only Claude subagent in the automation.
- `scripts/resolve-models` picks the concrete model ID in each line. `scripts/oc-agent` starts opencode with that model and the effort in `.agent-auto/effort.<role>`.

## Granted permissions

The `/full-send` command gives permission to:

- Merge the PR once it passes the **merge gate**.
- Push and `--force-with-lease` to this ticket's own branch after rebasing.
- Do any testing the proof needs (run the app, dev server, browser, screenshots), even when some document says to ask first. Rules about *how* to test (which command, which fixture) still apply.

Every `gh` command, and every `git` command that touches the remote, goes through `scripts/as-owner`, which pins the repo owner's GitHub account. Write reports, PR descriptions and issue comments in English.

## Steps

Open a todo list with exactly these 9 steps. If you skip one, keep it in the list and mark it `skip: <reason>`.

1. **Bootstrap.** From the repo root, every check below must pass:
   - `$HC_TERMINAL_ID` is set. If it is not, stop: this command only runs inside herdr-core (hc).
   - `scripts/resolve-models` exits 0. Keep every `changed:` and `orchestrator-latest:` line for the report.
   - `scripts/install-hc-templates` copies this repo's templates into hc's global directory (a no-op when they already match), then `hc templates` lists `oc-impl`, `oc-impl-pro` and `oc-adversary`.
   - `git ls-tree --name-only <default branch> .opencode/opencode.json scripts/oc-agent` prints both paths. Worktrees are created from the default branch, so the automation has to be committed there.
   - `scripts/as-owner gh repo view --json defaultBranchRef` returns a branch name. If it is empty, the remote has no branches yet: ask the user (see **Asking the user**).
   - `scripts/as-owner gh issue view <n> --json number,title,state,labels` shows the issue is open and labeled `ready-for-agent`. Say the issue title.
2. **Brief.** Follow `.claude/skills/brief/SKILL.md`. It produces the worktree, the branch, the red-test commit SHA, `.agent-auto/brief.md` and the `risk` flag.
3. **Hand off to the executor.** Start at rung 1 of the ladder in `.claude/skills/effort/SKILL.md`: write `low` to `.agent-auto/effort.executor`, then append the `effort` line to the ledger.
   ```sh
   hc run --bg --name impl-<n> --cwd <worktree> oc-impl \
     "Ticket #<n>. Brief: .agent-auto/brief.md. Parent terminal: $HC_TERMINAL_ID. Report back with hc send when done or blocked."
   ```
   The task string goes to opencode as the template's first message. Check `first_message.sent` in the output. If it is false, run `hc read impl-<n>`, clear whatever screen is waiting, then send the task again with `hc send`.
   Then run `hc wait --children any` until a message `<hc from="... impl-<n>">` arrives. If hc instead reports the executor `blocked`, `error`, or exited without a message, run `hc read impl-<n> --lines 80` to see why.
4. **Review.** Follow `.claude/skills/review-loop/SKILL.md` on the executor's `.agent-auto/report.md`. Send each fix round with `hc send impl-<n> "<findings>"` and wait as in step 3. Apply the **executor ladder** below.
5. **Proof.** Follow `.claude/skills/proof/SKILL.md`. A change you cannot prove does not merge: ask the user.
6. **Open the PR.**
   - `scripts/as-owner git fetch origin`, rebase the branch onto `origin/<default branch>`, and rerun the brief's check command.
   - `scripts/as-owner git push -u origin <branch>`. After a rebase, add `--force-with-lease`.
   - `scripts/as-owner gh pr create --base <default branch> --title ... --body-file ...`. Open it as a real PR, ready for review.
   - Title: the repo's commit convention, saying why the change matters.
   - Body, in this order: one sentence on the user's **problem** (from the issue); a short description of the solution; `Closes #<n>`; one `Proof: ...` line; one `Review: <round count>, <ledger outcome>` line; and as the last line `Created by Claude Opus (orchestrator) + <executor model actually used> via opencode.`
   - Read the body once more for secrets and personal data before creating the PR.
7. **Watch the PR.** Follow `.claude/skills/watch-pr/SKILL.md`. If it exits 1 because a check failed, fix the cause (product code goes back to the executor), prove again, push, and watch again.
8. **Merge.** When the PR passes the **merge gate**, merge it as described in **Merge**.
9. **Clean up and report.** `hc kill` and `hc rm` the ticket's terminals, `git worktree remove <worktree>`, delete the local branch. Write the final report (see **Report**).

## Executor ladder

A **lost round** is an executor turn that ends with the gate of its step still failing. That means one of: the executor reported `blocked`; the acceptance test is red; the checks are red; or a blocker finding you sent for fixing is still unresolved.

- **Each lost round climbs one rung** of the ladder in `.claude/skills/effort/SKILL.md` (rung 1 → 5: executor low → high → max → executor-pro high → max). Every rung is a new terminal in the same worktree.
- **Lost at the last rung:** stop delegating. In a turn that contains `ultrathink`, write the **premise** every attempt shared as one sentence, then verify it yourself: run it, read the code, reread the issue.
  - Premise wrong: fix the brief or the red test, then delegate again from rung 1.
  - Premise right: implement it yourself in the worktree, and say so plainly in the report.
- **Executor out of quota, or model blocked:** keep the worktree and ask the user to choose: wait for the quota to reset, have Opus implement, or stop.

The red test file (its path is in the brief) stays byte-for-byte identical through every round: `git diff <red-test SHA> HEAD -- <test file>` prints nothing. Any output counts as a lost round, with the blocker finding "restore the acceptance test; it is the contract".

## Merge gate

All of these hold on the PR's latest commit:

- The proof covers every change in the diff.
- `pr-wait` exits 0 on this commit.
  - Project exception: `AGENTS.md` (section **Automation**) may list CI checks that do not gate the merge. If `pr-wait` exits 1 **only** because of checks listed there, and every other required check is green on this commit, the CI gate passes. Only checks written in that section count.
- The review ledger has no `open` blocker or should.
- No reviewer is requesting changes.
- The branch is up to date with the default branch, and GitHub reports it mergeable.

## Merge

Tickets run in parallel but merge one at a time. Run `scripts/merge-lock acquire` with the maximum Bash timeout. It blocks until it is your turn; if the call times out, call it again.

While holding the lock:

1. `scripts/as-owner git fetch origin`.
2. If the default branch has new commits since your last green check: rebase, rerun the checks, push `--force-with-lease`, and rerun `pr-wait` as in `watch-pr`. Keep holding the lock throughout.
3. `scripts/as-owner gh pr merge <pr> --squash --delete-branch`. Merge through branch protection like any reviewer would (no `--admin`).
4. Confirm `scripts/as-owner gh pr view <pr> --json state` is `MERGED` and the issue is closed.
5. `scripts/merge-lock release`.

**Every exit from this section releases the lock first.** A rebase conflict, red checks, or `pr-wait` exit 1 means: `release`, then go back to step 4 or step 7.

## Asking the user

A question written in a plain message usually goes unseen. Ask with `AskUserQuestion`, so the session shows a waiting state. Make the question self-contained: the issue or PR link, what is blocking, and the options with your recommendation first.

Ask only when:

- The change cannot be proven.
- The merge gate is stuck and you cannot unstick it yourself.
- The next step goes beyond the granted permissions: deleting data, touching production, changing something outside the repo, closing a PR or issue, force-pushing another branch, pushing the default branch.
- The goal is ambiguous in a way that changes the outcome.
- The executor provider's quota (`provider` in `models.json`) is exhausted.

For everything else, pick a sensible default and list it in the report. If the asking tool is unavailable or nobody answers, take the safe path (leave the PR open and unmerged) and put the question at the top of the report.

## Report

In English. Include:

- PR link and merge commit.
- Proof: the commands and the results you observed.
- Review ledger: fixed / declined / disagree, one line each.
- The model that actually ran each role (see **Roles**), plus every `changed:` and `orchestrator-latest:` line from step 1.
- Number of executor rounds, and the highest ladder rung reached.
- Every decision you made on your own.
- Out-of-scope work, recorded as follow-ups.

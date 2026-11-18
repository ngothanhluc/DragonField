---
name: full-send-spec
description: Drive every ticket of a spec through to merge, at most 3 tickets in parallel, each with its own owner running /full-send. Type "/full-send-spec #<spec issue number>".
disable-model-invocation: true
---

# Full send spec

You are the **coordinator**. You pick tickets and start owners; owners do the tickets. An **owner** is a Claude Code session on Claude Opus, running `/full-send #<n>` in its own hc terminal, and it takes its ticket all the way to merge. Each owner then runs its own opencode executor, as in the **Roles** table of `.claude/skills/full-send/SKILL.md`.

Every `gh` command goes through `scripts/as-owner`. Report in English.

## Frontier

A **ticket** is a sub-issue of the spec, or an issue whose body says `Part of #<spec>`.

The **frontier** is every ticket that is open, labeled `ready-for-agent`, has no owner yet, and has zero open blockers:

```sh
scripts/as-owner gh api repos/{owner}/{repo}/issues/<n> --jq .issue_dependencies_summary.blocked_by   # 0 = startable
```

Take frontier tickets in ascending issue number order.

## Steps

1. **Bootstrap.**
   - Run the checks in step 1 of `.claude/skills/full-send/SKILL.md`, minus the single-issue check: hc, `resolve-models`, templates, automation committed, remote has a default branch.
   - Read the spec issue and list its tickets with their state.
   - Draw the blocking graph, one line per ticket: `#a ← #b, #c` (a is blocked by b and c).
   - Run `hc ls` and `scripts/as-owner gh pr list --state open` so you see owners or PRs left from an earlier run. Tickets with a live `own-<n>` terminal already have an owner.
2. **Start owners** for up to 3 frontier tickets:
   ```sh
   hc run --bg --name own-<n> --cwd <repo root> claude --model opus \
     "/full-send #<n> — After the final report, send a one-line summary with hc send $HC_TERMINAL_ID."
   hc label own-<n> spec=<spec> ticket=<n>
   ```
   The prompt is passed as a command-line argument, so there is no `first_message` to check. Confirm each owner started instead: `hc read own-<n> --lines 15` shows the session working with `Opus` in its status line.
3. **Wait** with `hc wait --children any`. On every wake:
   - **Owner sent a message, or exited:** read its report with `hc read own-<n> --lines 120`. If the ticket merged, `hc rm own-<n>`.
   - **Owner is `blocked`:** `hc read own-<n>` to see its question. The question belongs to the user: pass it up with `AskUserQuestion` (include the ticket link), then send the answer with `hc send own-<n> "<answer>"`.
   - **Then recompute the frontier.** While fewer than 3 owners are running and the frontier is not empty, start the next owner as in step 2.
4. **Finish** when either holds:
   - every ticket of the spec is closed; or
   - the frontier is empty, no owner is running, and tickets remain open (blocked behind a ticket that cannot merge).

   The spec issue stays open: closing it is the user's call.

## Quota

Every owner's executor shares one provider quota (`provider` in `models.json`). When any owner reports the quota exhausted, start no new owners and ask the user once, for the whole spec: wait for the reset, have owners implement with Opus themselves, or stop.

## Report

A table with one row per ticket: ticket, state (merged / open / blocked), PR link, executor round count, highest ladder rung reached.

After the table:

- Questions passed up to the user, with their answers.
- Tickets still open, and why.
- Every `changed:` line from `resolve-models`.

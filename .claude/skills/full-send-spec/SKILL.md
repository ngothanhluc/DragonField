---
name: full-send-spec
description: Drive every ticket of a spec through to merge, at most 3 tickets in parallel, each with its own owner running /full-send. Type "/full-send-spec #<spec issue number>".
disable-model-invocation: true
---

# Full send spec

You are the **coordinator**: you do not work any ticket yourself. Each ticket has its own **owner**, a Claude Code session running `/full-send #<n>` in its own hc terminal. The owner takes the ticket all the way to merge; you only pick tickets, start owners, and open new tickets when the frontier changes. Every `gh` command goes through `scripts/as-owner`. Report in English.

## Frontier

A ticket is a sub-issue of the spec (or an issue with `Part of #<spec>`). The **frontier** is the set of open tickets labeled `ready-for-agent` whose blocking tickets are all closed (`scripts/as-owner gh api repos/ngothanhluc/DragonField/issues/<n> --jq .issue_dependencies_summary.blocked_by` equals 0) and that have no owner yet. Take them in ascending issue number order.

## Steps

1. **Bootstrap.** Check as in step 1 of `.claude/skills/full-send/SKILL.md` (hc, resolve-models, templates, automation committed, remote has a default branch). Read the spec, list the tickets, draw the blocking graph as lines `#a ← #b, #c`.
2. **Start owners** for at most 3 frontier tickets:
   ```sh
   hc run --bg --name own-<n> --cwd <repo root> claude --model opus \
     "/full-send #<n> — After the final report, send a one-line summary with hc send $HC_TERMINAL_ID."
   ```
   Check `first_message.sent`. Label them for tracking: `hc label own-<n> spec=<spec> ticket=<n>`.
3. **Wait** with `hc wait --children any`. Each time you wake:
   - Message from an owner or an owner exited: read its report (`hc read own-<n> --lines 120`). If the ticket is merged, `hc rm own-<n>`.
   - Owner `blocked`: `hc read` to see what it is asking. That question belongs to the user: pass it up with `AskUserQuestion` plus the ticket link, then `hc send own-<n>` the answer.
   - Recompute the frontier; if there is a free slot (fewer than 3 owners running), start a new owner.
4. **Finish** when every ticket of the spec is closed, or the frontier is empty but tickets remain open (blocked by a ticket that cannot merge). The spec does not close itself: leave that to the user.

## Quota

The executors of all owners share the opencode-go quota. If one owner reports quota exhausted, do not start new owners; ask the user once for the whole spec: wait for reset, have owners implement with Opus themselves, or stop.

## Report

Table: ticket, state (merged / open / blocked), PR link, executor round count, whether the ladder was climbed. After the table: questions passed up with their answers, remaining tickets and why, every `changed:` line from resolve-models.

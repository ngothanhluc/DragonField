---
name: review-loop
description: Opus reviews the executor's diff in rounds, with a ledger and a budget; risky tickets add adversaries. Step 4 of full-send.
disable-model-invocation: true
---

# Review loop

The code was written by a model from another vendor; you are the reviewer. The goal is the **smallest change that does what the ticket says**, not perfect code. Review tends to bloat the PR bit by bit: stop that.

## Budget

- 3 rounds by default. Round 1 reads the whole diff; later rounds only read the changed code and the open findings.
- Go to 5 rounds only when `risk: yes` and a blocker or should with evidence remains.
- A round with only nits stops early. A declined nit, a comment or format fix do not open a new round.

## One round

1. **Read the report** `.agent-auto/report.md`. `status: blocked` is a lost round (executor ladder in `full-send`); do not review.
2. **Check the contract.** `git diff <red-test SHA> HEAD -- <acceptance test file>` must be empty. Run the acceptance test and the brief's check command in the worktree; record the real output. Red is a lost round.
3. **Read the diff** `git diff <red-test SHA>...HEAD` plus the surrounding code. Look for: behavior that is wrong against the acceptance criteria, broken callers, drift from GLOSSARY/ADR, code/tests/guards the ticket does not need. Skip style unless it hides a bug.
4. **Grade** each finding:
   - **blocker**: the case the ticket targets behaves wrongly.
   - **should**: a real bug callers will hit, within the ticket's scope.
   - **nit**: everything else. Another approach, rare cases, small cost, extra compatibility are nits even when they look serious.
5. **Write the ledger** `.agent-auto/ledger.md`, one line per finding, stable across rounds: `R<id> | <grade> | <file:line> | <judgment> | <open|fixed|declined|disagree> | <evidence>`.
6. **Send fixes.** Blockers and shoulds go to the executor via `hc send`, with the id, file:line, and the smallest fix (prefer deleting or narrowing over adding locks, caches, helpers, options). Nits: decline in one line, record as follow-up. If the executor pushes back with evidence: check the evidence, then switch to `disagree` or keep `open`.

If `git diff --shortstat <red-test SHA>` grows across rounds for anything other than fixing blockers/shoulds: trim it before the next round.

## Adversaries (only when `risk: yes`)

Once the first round has no blockers left, run two adversaries in parallel, each in its own one-off worktree created from the ticket's HEAD (`git worktree add --detach <temp dir> HEAD`):

- `hc run --bg --name adv-<n> --cwd <temp-wt-1> oc-adversary "<ticket goal, acceptance criteria, diff path, report file .agent-auto/adversary.md, parent terminal $HC_TERMINAL_ID>"`
- A Claude subagent (Agent tool, `model: "opus"`, `effort: "medium"` per `.claude/skills/effort/SKILL.md`, no `isolation`) with the same information and the absolute path `<temp-wt-2>`: "Work only inside <temp-wt-2>. Break this change. Every finding must include the command you ran, the real output, and the output the goal requires. No run, no report. Do not change product code, do not commit."

For each finding you get back, **rerun its command yourself** on the ticket worktree. If the output shows a bug that breaks the ticket's goal, add it to the ledger (graded per step 4). Otherwise drop it and record how many findings were dropped and why. Merge findings with the same root cause. Delete the temp worktrees and `hc rm adv-<n>` afterwards.

## Stopping

- **Agreement**: acceptance test and checks green on HEAD, no `open` blocker/should left in the ledger, and you have no remaining concerns.
- **Stuck**: a `disagree` item after 2 exchange rounds, or the budget is spent with blockers/shoulds left. Write both sides, 2–3 lines each, into the ledger; spending the budget is not approval. Stuck on a should: decide by the stronger evidence and record it in the report; stuck on a blocker: ask the user (per `full-send`).

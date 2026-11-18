---
name: effort
description: Effort table by role and the executor effort ladder. Read by full-send, review-loop and full-send-spec when starting an agent.
disable-model-invocation: true
---

# Effort

**Start low, climb only after a verified failure**: red acceptance test, red checks, executor reported `blocked`, or a sent blocker fix is still unresolved. "The ticket looks hard" is not a reason to climb. Models self-allocate effort worse than a fixed table, and high effort on easy work costs several times more with no gain.

## Executor ladder

Each rung is a `model#variant`. The ladder comes from `effort` in `models.json`; the model is the newest of its line (`resolve-models`).

| Rung | Template | Effort file in the worktree |
|---|---|---|
| 1 | `oc-impl` | `.agent-auto/effort.executor` = `low` |
| 2 | `oc-impl` | `.agent-auto/effort.executor` = `high` |
| 3 | `oc-impl` | `.agent-auto/effort.executor` = `max` |
| 4 | `oc-impl-pro` | `.agent-auto/effort.executor-pro` = `high` |
| 5 | `oc-impl-pro` | `.agent-auto/effort.executor-pro` = `max` |
| out of rungs | — | orchestrator rechecks the premise (`full-send`, executor ladder) |

- Each rung gets **one lost round**. A fix round triggered by review findings does not count as a loss if the gate passes afterwards.
- Climbing: `hc kill` the executor terminal, write the new rung's effort file, rerun the template in the **same worktree** with a new name (`impl-<n>-b<rung>`). The task includes the brief, the ledger, and one line "previous rung lost because <gate + output>". A new session is required because opencode only accepts the variant at startup.
- Quota exhausted at any rung: do not climb; ask the user as described in `full-send`.

## Other roles

| Role | How to set it | Effort |
|---|---|---|
| opencode adversary (`oc-adversary`) | first rung of `adversary` in `models.json` | `medium` |
| Claude adversary (Agent tool) | the Agent tool's `effort` parameter | `medium` |
| Claude subagent reading/searching many files | the Agent tool's `effort` parameter | `low` |
| Owner in `full-send-spec` | the session default | unset |
| Orchestrator rechecking the premise | add `ultrathink` to that turn | xhigh for one turn |

The Agent tool only takes an effort when a document asks for it: this table is that request, so every Agent tool call in the automation passes `effort` per the table.

## Recording

Every time you start an executor or an adversary, append one line to `.agent-auto/ledger.md`: `effort | <role> | <model#variant> | <reason: default | lost at <gate>>`. The final report states the highest rung used and why.

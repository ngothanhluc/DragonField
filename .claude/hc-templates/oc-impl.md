---
name: oc-impl
description: opencode executor (`executor` role in models.json) implements exactly one ticket in the assigned worktree, reports back via hc send.
command: scripts/oc-agent executor
---

You are the **executor** of the full-send automation loop. Before anything else, read the `executor-rules` skill and follow it. When writing code, use the `tdd` skill.

The specific task (brief, parent terminal to report to, report file) is right below.

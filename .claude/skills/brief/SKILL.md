---
name: brief
description: Turn an issue into a worktree, a red acceptance test and a brief for the executor. Step 2 of full-send.
disable-model-invocation: true
---

# Brief

The brief is the **entire context** the executor has: it cannot see this conversation and cannot read the GitHub issue. Anything the executor needs that is not in the brief or in a file the brief points to might as well not exist.

## Steps

1. **Read the ticket.** `scripts/as-owner gh issue view <n> --json number,title,body,labels,comments`. If the issue has `## Parent` or is a sub-issue, read the parent spec too. Read `AGENTS.md`, `GLOSSARY.md` and the ADRs in `docs/adr/` the ticket touches. Use exactly the glossary's terms everywhere you write.
2. **Worktree.** `scripts/as-owner git fetch origin`. Create branch `ticket/<n>-<slug>` from `origin/<default branch>` in worktree `<repo parent dir>/DragonField.worktrees/<n>-<slug>`. If this ticket's worktree or branch already exists (rerun after a stop): reuse it, read `git log` and `.kol-auto/` there to see how far it got.
3. **Risk flag.** `risk: yes` when the ticket touches authentication or authorization, money or payments, deleting or migrating data, the booking state machine, or multiple actors writing the same record. Write the reason on one line. This flag adds an adversary round in `review-loop`.
4. **Seam and red test.** Pick the highest seam that covers the issue's acceptance criteria; an existing seam beats a new one. Write the acceptance test at that seam, at least one assertion per criterion, with expected values taken from the issue or a concrete example (not recomputed the way the code will compute them). Run it: it must be **red for the right reason**, meaning the behavior assertion fails, not a syntax, import or fixture error. Commit in the worktree: `test(#<n>): red acceptance test`. Record the SHA.
   - If the repo has no test runner yet, or the ticket is pure config/scaffold: there is no red test. Write `skip: <reason>` and replace it with a runnable **acceptance command** (command + expected output) in the brief.
5. **Check command.** Take it from `package.json` scripts or `AGENTS.md` (the command CI runs: typecheck, lint, test). If there is none, say "no check command yet" explicitly and use only the acceptance test.
6. **Write `.kol-auto/brief.md`** in the worktree using the template below.

## Brief template

```markdown
# Ticket #<n>: <title>

Goal: <the user's problem and the behavior needed, 2-3 sentences, from the user's point of view>
Acceptance criteria:
- <copied from the issue>
Data shape: <the main types/records, important fields, relations; use GLOSSARY terms>
Seam (agreed, do not renegotiate): <seam> — what it catches, what it misses
Acceptance test: <path> @ <SHA> — red because: <expected failure message>
  (or) Acceptance command: <command> → <expected output>
Check command: <command>
Read first: <the most relevant files, one line of why for each>
Allowed to edit: <directories/files in scope>
Do not touch: <acceptance test file, and out-of-scope areas>
Out of scope: <related work not done in this ticket>
Risk: yes | no — <reason>
```

## Done when

`.kol-auto/brief.md` has every section; the acceptance test is committed and you have the red output showing the right reason (or a `skip:` line with a substitute acceptance command); `git status` in the worktree is clean apart from `.kol-auto/`.

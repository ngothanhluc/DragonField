---
name: proof
description: Collect first-hand evidence that the change works, climbing from a repro up to the real app. Step 5 of full-send.
disable-model-invocation: true
---

# Proof

**Proof** is evidence you observed yourself in this session: command output, a repro run, a screenshot. The executor's report, a green mock test, "it compiles" are claims, not proof. Every line in the diff must be covered by some piece of evidence.

## Ladder

Climb to the highest rung the change allows; record each rung you ran.

1. **Repro before/after.** Bug: rerun the exact repro on the commit before the fix (see the bug) and on HEAD (bug gone). Feature: the acceptance test is red at the red-test SHA and green at HEAD.
2. **CI checks.** The brief's check command, run on HEAD after rebase, fully green.
3. **Regression-blocking test.** The new behavior has at least one test that would go red if the change were removed. Verify for real: temporarily revert the product code (`git stash` or check out the file at the red-test SHA in a scratch worktree), run the test, see it red, restore.
4. **Real app.** User-visible behavior (UI, API, CLI): run the app and observe that exact behavior, per `docs/agents/run-app.md`. A screenshot or request/response output is evidence; attach it to the PR when there is a way to upload.
   - `docs/agents/run-app.md` does not exist yet (repo has not picked a stack): skip this rung, write `proof rung 4: no app to run yet` in the report and the PR.

## Output

One short block into the PR and the report:

```
Proof:
- rung 1: <command> → before: <fail> / after: <pass>
- rung 2: <check command> → <result>
- rung 3: <test> red when the change is removed → <confirmation>
- rung 4: <how you ran the app + observation> | no app to run yet
Not proven: <which part of the diff, why>   (drop the line if empty)
```

Any part of the diff no rung covers: add proof for it, or narrow the diff. If you can do neither, ask the user as `full-send` describes.

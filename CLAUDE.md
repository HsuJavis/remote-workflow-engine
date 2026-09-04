# remote-workflow-engine — working rules for agents

## Never restore a path from another commit to read it

To read a file as it was at some commit, use `git show <sha>:<path>` — it writes nothing and is
the ONLY safe method.

**`git stash` … `git stash pop` is ALSO forbidden while a workflow is running.** That advice was
written here for a single agent working alone and is unsafe as soon as the SDLC gates run: an
implementation gate puts ~20 implementer agents on this ONE shared working tree at the same time.
`git stash` takes *everyone's* uncommitted edits, not just yours, and the window before `pop`
races with 19 other agents still writing. On 2026-09-04 an implementer reported a near-miss doing
exactly this. If you think you need a stash, you need `git show` instead.

**Never** run `git checkout <sha> -- <path>` or `git restore --source=<sha> -- <path>`.
That overwrites the working tree AND stages the overwrite, and it silently destroys
uncommitted work under `<path>`.

This has already cost a full iteration's ledger once: on 2026-08-31 an agent computing a
traceability baseline ran
`git checkout fb0a36f^ -- .sdlc/features/001-remote-workflow-engine/`
and wiped the entire v21 architecture / tasks / design / tests documents from the working
tree (1375 lines) while a workflow was mid-flight. Recovery was only possible because a WIP
checkpoint commit existed. A sibling agent doing the same job used `git stash` … `git stash
pop`, which was the safe choice *for one agent working alone* — it is no longer permitted, for the
reason given at the top of this file.

For a trace baseline specifically: `sh .sdlc/trace` reads the ledger in the working tree, so
capture the baseline *earlier into a file*, or extract a clean copy somewhere else
(`git archive HEAD | tar -x -C <scratch dir>`) and run against that — never by checking the ledger
backwards in place, and never by stashing.

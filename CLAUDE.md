# remote-workflow-engine — working rules for agents

## Never restore a path from another commit to read it

To read a file as it was at some commit, use `git show <sha>:<path>` (writes nothing), or
`git stash` … `git stash pop` around the read.

**Never** run `git checkout <sha> -- <path>` or `git restore --source=<sha> -- <path>`.
That overwrites the working tree AND stages the overwrite, and it silently destroys
uncommitted work under `<path>`.

This has already cost a full iteration's ledger once: on 2026-08-31 an agent computing a
traceability baseline ran
`git checkout fb0a36f^ -- .sdlc/features/001-remote-workflow-engine/`
and wiped the entire v21 architecture / tasks / design / tests documents from the working
tree (1375 lines) while a workflow was mid-flight. Recovery was only possible because a WIP
checkpoint commit existed. A sibling agent doing the same job used `git stash` … `git stash
pop` correctly.

For a trace baseline specifically: `sh .sdlc/trace` reads the ledger in the working tree, so
compare against a baseline captured *earlier into a file*, or stash-and-pop — never by
checking the ledger backwards in place.

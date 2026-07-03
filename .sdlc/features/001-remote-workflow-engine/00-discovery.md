---
stage: discovery
status: existing
mode: modify   # modify | refactor
---
# 00 Existing-system Discovery (current-state)

> Brownfield only. The explorer reads but never modifies; map the current state into as-is traceability items (status: existing) + the lists below.
> Methodology: references/brownfield-sdlc.md. Write as-is ARCH/IMPL/UT/REQ into 02/06/05/01 (marked existing).

## Module list (→ ARCH-* existing)
| Module | Responsibility | Main files | ARCH |
|---|---|---|---|
| <module> | <what it does> | <path> | ARCH-001 |

## Dependencies / call relations
- <module A> → <module B> (why)
- External deps: <lib / service>

## Test coverage (current)
- Tested: <module/path> (→ UT-/IT- existing)
- Untested: <module/path> (risk area; may need characterization tests before refactor)

## 🔁 Duplicate candidates (anti-duplicate)
- [ ] <module X and Y overlap: note> — before changing, decide whether to merge/reuse

## 🧟 Orphan candidates (anti-orphan)
- [ ] <uncalled / no-matching-requirement code: path> — flag, don't delete yet (per Karpathy "flag dead code, don't remove")

## Change entry points
- Modules this change (mode in frontmatter) will touch: <list matching ARCH/IMPL IDs>
- Next: Modify → write change REQ (Gate 1); Refactor → write characterization tests (Gate 5 variant)

// src/dashboard/ui/clock.js
// [v27c AC-7 Gate 8 repair] moved from `src/dashboard/lib/clock.js` — a wall-clock read is I/O, and
// ARCH-124's `api:` declares `src/dashboard/lib` "every export pure and total, no DOM, no `fetch`,
// no import outside this directory" — TASK-207's own DoD grep named the two wall-clock APIs
// (`Date\.now()\|new Date()`) over `src/dashboard/lib`, and tripped on the old location. // det:allow — a comment naming the API, not a call
// `ui/` is the layer ARCH-125 allows I/O in — the seam itself is unchanged, only which directory owns it.
//
// v27 Gate 6.5+7 (verifier, determinism_check): browser-side clock seam. `lib/agent.js`'s
// panelModel and `lib/runlist.js`'s historyRow already take `now` as a plain parameter and are
// unit-tested against a fixed ISO literal (UT-247, UT-236) — the seam this project's own
// convention requires (mirrors `src/clock.ts`'s SystemClock server-side). The gap
// determinism_check.py found was upstream of that: `ui/agent-panel.js` and `ui/workflow.js` each
// read the wall clock ad hoc at their own call site instead of naming the read, so the exact line
// doing it never declared itself as a seam. One named function, read once per render, handed down
// to the pure projector — never re-read inside decision logic itself.
export const clockNow = () => new Date().toISOString();

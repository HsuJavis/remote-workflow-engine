// src/dashboard/ui/issues.js
// DES-207, ARCH-125, ARCH-123, TASK-212 (REQ-067) — the Issues tab, PORTED from the pre-v27
// `renderIssueList`/`loadIssues`/`loadIssueDetail` (dashboard-page.ts:643-676): same endpoints
// (`/api/issues`, `/api/issues/:number`), same two groups (open/resolved), same click-through
// detail panel, same "GitHub not configured" degrade text. It was a SEPARATE route
// (`/dashboard/issues`) before this rebuild; it is now a tab (`app.js`'s routing contract) — no
// other behaviour changes (no sorting, no filtering, no new endpoint, DES-207's boundary).
//
// [v27c] DES-206's "one timer" completion: this view exports `onTick(container, bodies, ctx)` per
// the same uniform view contract as `home.js`/`workflow.js`/`run.js`, instead of scheduling its own
// repeated fetch. `app.js`'s tab strip (`activateTab`) mounts this module via `render()` only, so
// `render()` builds the static chrome once (the two group headers, the detail box — a per-container
// state, `home.js`'s own pattern, so a re-render never rebuilds a click handler's closure mid-use)
// and calls `onTick()` itself for first paint. `poll.js`'s `issues` route names this view's
// endpoint for the app-wide tick, and [v28, DES-217] `onTick` now paints from that tick's own
// `bodies['/api/issues']` rather than fetching it again itself.
// [v28b, DES-220] `onTick` gains DES-210's 4th `tick` parameter — a demo tick with no `/api/issues`
// body paints the `noDemoData` disclosure on both groups (a third arm, not a repoint of the degrade one).

import { getViewJSON } from './poll.js';
import { el, currentLang } from './dom.js';
import { safeIssueHref } from '../lib/issues.js';
import { t } from '../lib/strings.js';

// v11 (REQ-067): render a list of issue summaries in a container (XSS-safe: textContent only).
function renderIssueList(issues, container, onSelect) {
  container.replaceChildren();
  if (!issues || !issues.length) {
    container.appendChild(el('div', 'empty', '(none)'));
    return;
  }
  issues.forEach((iss) => {
    const row = el('div', 'issue-row');
    row.appendChild(el('span', 'mono', '#' + iss.number));
    row.appendChild(el('span', undefined, iss.title));
    // Severity from labels (e.g. "severity:high") — DES-209's `.tag` component (the pre-v27 page
    // used `.pill`, DES-209 boundary clause 3).
    (iss.labels || []).forEach((lbl) => {
      if (lbl && lbl !== 'agent-reported') row.appendChild(el('span', 'tag', lbl));
    });
    row.addEventListener('click', () => onSelect(iss.number));
    container.appendChild(row);
  });
}

// Per-container chrome state (`home.js`'s own pattern) — built once so a re-render never rebuilds
// the `loadIssueDetail` closure (and the detail box it owns) mid-use.
const stateByContainer = new WeakMap();

function buildChrome(container) {
  // [v29, REQ-150] `currentLang()` was already imported and unused here. This view's chrome is
  // built once per container, and `ui/app.js`'s language switch remounts the whole app (a fresh
  // container), so reading it at build time is correct — there is no second path that re-labels
  // an existing chrome in place.
  const lang = currentLang();
  const openEl = el('div');
  openEl.id = 'issues-open';
  const resolvedEl = el('div');
  resolvedEl.id = 'issues-resolved';

  const detailBox = el('div', 'issue-detail');
  detailBox.id = 'issue-detail';
  detailBox.style.display = 'none';
  const detailMeta = el('p');
  detailMeta.id = 'issue-detail-meta';
  const detailLinkP = document.createElement('p');
  const detailLink = document.createElement('a');
  detailLink.id = 'issue-detail-link';
  detailLink.target = '_blank';
  detailLink.rel = 'noopener noreferrer';
  detailLink.textContent = t(lang, 'openOnGitHub');
  detailLinkP.appendChild(detailLink);
  const detailBody = document.createElement('pre');
  detailBody.id = 'issue-detail-body';
  detailBox.appendChild(detailMeta);
  detailBox.appendChild(detailLinkP);
  detailBox.appendChild(detailBody);

  container.replaceChildren(
    el('h2', undefined, t(lang, 'issuesOpen')),
    openEl,
    el('h2', undefined, t(lang, 'issuesResolved')),
    resolvedEl,
    detailBox,
  );

  async function loadIssueDetail(number) {
    const res = await getViewJSON('/api/issues/' + number);
    const data = res.body;
    if (!data || data.degraded) {
      detailBox.style.display = 'none';
      return;
    }
    detailMeta.textContent = '#' + data.number + ' · ' + data.state + ' · ' + data.commentCount + ' comment(s)';
    // DES-217: an issue URL is attacker-influenceable content on an unauthenticated page —
    // `safeIssueHref` is the one gate before it becomes a live href; `null` hides the link
    // entirely so the detail box renders as text only, never a `javascript:`/`data:` href.
    const href = safeIssueHref(data.url);
    if (href) {
      detailLink.setAttribute('href', href);
      detailLinkP.style.display = '';
    } else {
      detailLink.removeAttribute('href');
      detailLinkP.style.display = 'none';
    }
    detailBody.textContent = data.body || '(no body)';
    detailBox.style.display = 'block';
  }

  return { openEl, resolvedEl, loadIssueDetail };
}

/** [v28] DES-217: paints from `bodies['/api/issues']` instead of re-fetching — `tick()` already
 *  fetched every endpoint `endpointsFor('issues')` names (`poll.js`) before calling this, so a
 *  second independent `getViewJSON` here was a redundant round-trip racing that same paint (the
 *  cold-mount path fires `render()`'s placeholder call and `app.js`'s first real tick close
 *  together; a self-fetch made the SECOND paint land an extra round-trip later than it needed to).
 *  Assumes `render()` already built the chrome (bails otherwise, `home.js`'s own guard). */
export async function onTick(container, bodies, _ctx, tick) {
  const state = stateByContainer.get(container);
  if (!state || !container.isConnected) return undefined;
  const data = bodies ? bodies['/api/issues'] : undefined;
  if (data && data.degraded) {
    state.openEl.replaceChildren(el('div', 'degraded', data.degraded));
    state.resolvedEl.replaceChildren(el('div', 'degraded', data.degraded));
  } else if (data) {
    renderIssueList(data.open || [], state.openEl, state.loadIssueDetail);
    renderIssueList(data.resolved || [], state.resolvedEl, state.loadIssueDetail);
  } else if (tick && tick.source === 'demo') {
    // [v28b, DES-220] `/api/issues` has no DEMO map entry (DES-212) — a demo tick's `data` is
    // undefined here, never `degraded`, so this is a third arm, not a repoint of the one above.
    const m = t(currentLang(), 'noDemoData') + '/api/issues';
    state.openEl.replaceChildren(el('div', 'empty', m));
    state.resolvedEl.replaceChildren(el('div', 'empty', m));
  }
  return undefined;
}

/** DES-206's uniform view contract — `vm`/`handlers` are unused; builds the chrome once, then calls
 *  `onTick` itself for first paint since nothing else calls it yet. */
export function render(container, _vm, _handlers) {
  container.id = 'issues';
  if (!stateByContainer.has(container)) {
    stateByContainer.set(container, buildChrome(container));
  }
  onTick(container, {}, {});
}

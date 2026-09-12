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
// and calls `onTick()` itself for first paint; `poll.js`'s `issues` route already names this view's
// endpoint for whenever the tab strip's own poll wiring joins it to the app-wide tick.

import { getJSON } from './poll.js';
import { el } from './dom.js';

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
  detailLink.textContent = 'Open on GitHub ↗';
  detailLinkP.appendChild(detailLink);
  const detailBody = document.createElement('pre');
  detailBody.id = 'issue-detail-body';
  detailBox.appendChild(detailMeta);
  detailBox.appendChild(detailLinkP);
  detailBox.appendChild(detailBody);

  container.replaceChildren(
    el('h2', undefined, 'Open'),
    openEl,
    el('h2', undefined, 'Resolved'),
    resolvedEl,
    detailBox,
  );

  async function loadIssueDetail(number) {
    const res = await getJSON('/api/issues/' + number);
    const data = res.body;
    if (!data || data.degraded) {
      detailBox.style.display = 'none';
      return;
    }
    detailMeta.textContent = '#' + data.number + ' · ' + data.state + ' · ' + data.commentCount + ' comment(s)';
    detailLink.setAttribute('href', data.url || '#');
    detailBody.textContent = data.body || '(no body)';
    detailBox.style.display = 'block';
  }

  return { openEl, resolvedEl, loadIssueDetail };
}

/** [v27c] DES-206's uniform view contract, poll half — fetches `/api/issues` and paints; returns
 *  the endpoint's status so a caller folding it into `nextConnection` can do so like every other
 *  view. Assumes `render()` already built the chrome (bails otherwise, `home.js`'s own guard). */
export async function onTick(container, _bodies, _ctx) {
  const state = stateByContainer.get(container);
  if (!state || !container.isConnected) return undefined;
  const res = await getJSON('/api/issues');
  if (!container.isConnected) return undefined;
  const data = res.body;
  if (data && data.degraded) {
    state.openEl.replaceChildren(el('div', 'degraded', data.degraded));
    state.resolvedEl.replaceChildren(el('div', 'degraded', data.degraded));
  } else if (data) {
    renderIssueList(data.open || [], state.openEl, state.loadIssueDetail);
    renderIssueList(data.resolved || [], state.resolvedEl, state.loadIssueDetail);
  }
  return { '/api/issues': res.status };
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

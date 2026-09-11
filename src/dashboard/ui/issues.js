// src/dashboard/ui/issues.js
// DES-207, ARCH-125, ARCH-123, TASK-212 (REQ-067) — the Issues tab, PORTED from the pre-v27
// `renderIssueList`/`loadIssues`/`loadIssueDetail` (dashboard-page.ts:643-676): same endpoints
// (`/api/issues`, `/api/issues/:number`), same two groups (open/resolved), same click-through
// detail panel, same "GitHub not configured" degrade text. It was a SEPARATE route
// (`/dashboard/issues`) before this rebuild; it is now a tab (`app.js`'s routing contract) — no
// other behaviour changes (no sorting, no filtering, no new endpoint, DES-207's boundary).
//
// This tab owns its own fetch loop (self-rescheduling `setTimeout`, guarded by
// `container.isConnected`) — it is never `app.js`'s `currentView`, same as `ui/models.js`/
// `ui/system.js`.

import { getJSON } from './poll.js';

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// v11 (REQ-067): render a list of issue summaries in a container (XSS-safe: textContent only).
function renderIssueList(issues, container, onSelect) {
  container.replaceChildren();
  if (!issues || !issues.length) {
    container.appendChild(el('div', 'empty', '(none)'));
    return;
  }
  issues.forEach((iss) => {
    const row = el('div', 'issue-row');
    row.appendChild(el('span', 'issue-num', '#' + iss.number));
    row.appendChild(el('span', 'issue-title', iss.title));
    // Severity from labels (e.g. "severity:high") as a pill.
    (iss.labels || []).forEach((lbl) => {
      if (lbl && lbl !== 'agent-reported') row.appendChild(el('span', 'issue-lbl', lbl));
    });
    row.addEventListener('click', () => onSelect(iss.number));
    container.appendChild(row);
  });
}

/** DES-206's uniform view contract — `vm`/`handlers` are unused; this tab fetches its own data. */
export function render(container, _vm, _handlers) {
  container.id = 'issues';

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

  async function tick() {
    if (!container.isConnected) return;
    const res = await getJSON('/api/issues');
    if (!container.isConnected) return;
    const data = res.body;
    if (data && data.degraded) {
      openEl.replaceChildren(el('div', 'degraded', data.degraded));
      resolvedEl.replaceChildren(el('div', 'degraded', data.degraded));
    } else if (data) {
      renderIssueList(data.open || [], openEl, loadIssueDetail);
      renderIssueList(data.resolved || [], resolvedEl, loadIssueDetail);
    }
    setTimeout(tick, 3000);
  }
  tick();
}

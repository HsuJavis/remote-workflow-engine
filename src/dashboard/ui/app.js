// src/dashboard/ui/app.js
// DES-206, ARCH-125, TASK-208 — the SPA entry point. Reads `#rwe-init` once, renders the update
// panel (INV-V27-5), owns the REQ-131 theme/lang/hue controls (`ui/theme-init.js` only paints the
// stored preference before first paint; this module is what lets an operator CHANGE it), routes on
// `location.pathname`, and owns the ONE poll timer — a self-rescheduling `setTimeout` armed in
// `tick().finally(...)`, "3s after the last tick SETTLED" (ARCH-125's amendment; `setInterval`
// would stack requests once a tick outlives its period).
//
// ROUTING CONTRACT — this file owns the URL scheme and the tab strip; TASK-209..212 do not list
// `app.js` in their files and must not edit it. Extend ROUTE matching / TAB_MODULES below, never
// the call sites, if a sibling view needs a new hook.
//   /dashboard                 -> the tabbed root: Workflows (home.js, default) / Models / System /
//                                 Issues, switched WITHOUT changing the URL
//                                 (`[data-tab="workflows"|"models"|"system"|"issues"]`, val-202).
//   /dashboard/workflow/:name  -> workflow detail (ui/workflow.js), ctx = { name }.
//   /dashboard/:runId          -> the run swimlane (ui/run.js), ctx = { runId } — legacy-compatible:
//                                 a bookmarked/shared run URL carries no workflow name.
// Each sibling view is loaded via a lazy `import()` so an unbuilt module only fails when its own
// route/tab is opened, never at load — Gate 6's tasks land independently on the same tree.

import { PREF_KEYS, clampHue, prefsFromStorage } from '../lib/theme.js';
import { updatePanelModel } from '../lib/status.js';
import { nextConnection } from '../lib/connection.js';
import { endpointsFor, getJSON } from './poll.js';
import { render as renderHome, onTick as onTickHome } from './home.js';

const LABELS = {
  zh: {
    workflows: '工作流程', models: '模型', system: '系統', issues: '問題',
    live: '連線中', offline: '離線', degraded: '部分異常', checking: '連線中…',
    dark: '深', light: '淺', system_theme: '系統',
  },
  en: {
    workflows: 'Workflows', models: 'Models', system: 'System', issues: 'Issues',
    live: 'Live', offline: 'Offline', degraded: 'Degraded', checking: 'Connecting…',
    dark: 'Dark', light: 'Light', system_theme: 'System',
  },
};
function L(lang, key) {
  return (LABELS[lang] || LABELS.zh)[key];
}

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage disabled — the in-memory `prefs` object still drives this page load.
  }
}

const prefs = prefsFromStorage(safeGet);

function applyTheme() {
  const root = document.documentElement;
  const resolved = prefs.theme === 'light' || prefs.theme === 'dark'
    ? prefs.theme
    : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  root.setAttribute('data-theme', resolved);
  root.setAttribute('lang', prefs.lang === 'en' ? 'en' : 'zh-Hant');
  root.style.setProperty('--rwe-hue', String(prefs.hue));
}

function readIsland() {
  const el = document.getElementById('rwe-init');
  if (!el) return {};
  try {
    return JSON.parse(el.textContent || '{}');
  } catch {
    return {};
  }
}

function buildUpdatePanel(island, lang) {
  const vm = updatePanelModel(island, lang);
  const el = document.createElement('div');
  el.className = 'rwe-update-panel';
  const version = document.createElement('span');
  version.className = 'rwe-version';
  version.textContent = `v${vm.version}`;
  el.appendChild(version);
  if (vm.update) {
    const outcome = document.createElement('span');
    outcome.className = 'rwe-update-outcome';
    outcome.dataset.tone = vm.update.tone;
    outcome.textContent = vm.update.text;
    el.appendChild(outcome);
  }
  if (vm.configCheck) {
    const cc = document.createElement('span');
    cc.className = 'rwe-config-check';
    cc.textContent = vm.configCheck;
    el.appendChild(cc);
  }
  if (vm.cta) {
    const cta = document.createElement('span');
    cta.className = 'rwe-update-cta';
    cta.textContent = vm.cta;
    el.appendChild(cta);
  }
  return el;
}

let connectionTagEl = null;
let connectionState = { status: 'checking', consecutiveFails: 0, perRoute: {} };
function updateConnectionTag() {
  if (!connectionTagEl) return;
  connectionTagEl.textContent = L(prefs.lang, connectionState.status) || L(prefs.lang, 'checking');
  connectionTagEl.dataset.status = connectionState.status;
  // DES-209's REQ-131 row: `.rwe-connection{.is-live,.is-degraded,.is-offline}` — the stylesheet
  // keys on a class, not the `data-status` attribute above (which nothing else reads).
  for (const s of ['live', 'degraded', 'offline']) {
    connectionTagEl.classList.toggle(`is-${s}`, connectionState.status === s);
  }
}

let pendingTab = null;
function activateTab(tab) {
  const panels = document.querySelectorAll('[data-tab-panel]');
  panels.forEach((p) => {
    p.style.display = p.dataset.tabPanel === tab ? '' : 'none';
  });
  document.querySelectorAll('.rwe-tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  const TAB_MODULES = { models: './models.js', system: './system.js', issues: './issues.js' };
  if (tab !== 'workflows' && TAB_MODULES[tab]) {
    const panel = document.querySelector(`[data-tab-panel="${tab}"]`);
    if (panel && !panel.dataset.mounted) {
      panel.dataset.mounted = '1';
      import(TAB_MODULES[tab]).then((mod) => mod.render(panel, {}, {})).catch(() => {
        const p = document.createElement('p');
        p.textContent = `${tab} unavailable`;
        panel.appendChild(p);
      });
    }
  }
}

function setTab(tab) {
  if (!/^\/dashboard\/?$/.test(location.pathname)) {
    pendingTab = tab;
    go('/dashboard');
    return;
  }
  activateTab(tab);
}

function buildChrome(island) {
  const nav = document.createElement('nav');
  nav.className = 'rwe-nav';

  nav.appendChild(buildUpdatePanel(island, prefs.lang));

  const tabStrip = document.createElement('div');
  tabStrip.className = 'rwe-tabs';
  for (const tab of ['workflows', 'models', 'system', 'issues']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.tab = tab;
    btn.textContent = L(prefs.lang, tab);
    btn.addEventListener('click', () => setTab(tab));
    tabStrip.appendChild(btn);
  }
  nav.appendChild(tabStrip);

  // DES-209's component layer (`.nav`/`.hr`, REQ-131's shell) — a divider between the tab strip
  // and the theme/lang/connection controls that follow it.
  const navDivider = document.createElement('hr');
  navDivider.className = 'hr';
  nav.appendChild(navDivider);

  const themeGroup = document.createElement('div');
  themeGroup.className = 'rwe-theme-group';
  for (const t of ['dark', 'light', 'system']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.theme = t;
    btn.textContent = L(prefs.lang, t === 'system' ? 'system_theme' : t);
    btn.classList.toggle('active', prefs.theme === t);
    btn.addEventListener('click', () => {
      prefs.theme = t;
      safeSet(PREF_KEYS.theme, t);
      applyTheme();
      themeGroup.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.theme === t));
    });
    themeGroup.appendChild(btn);
  }
  nav.appendChild(themeGroup);

  const hue = document.createElement('input');
  hue.type = 'range';
  hue.min = '0';
  hue.max = '359';
  hue.value = String(prefs.hue);
  hue.className = 'rwe-hue-slider';
  hue.addEventListener('input', () => {
    prefs.hue = clampHue(Number(hue.value));
    safeSet(PREF_KEYS.hue, String(prefs.hue));
    document.documentElement.style.setProperty('--rwe-hue', String(prefs.hue));
  });
  nav.appendChild(hue);

  const langGroup = document.createElement('div');
  langGroup.className = 'rwe-lang-group';
  for (const l of ['zh', 'en']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.lang = l;
    btn.textContent = l === 'zh' ? '中' : 'EN';
    btn.classList.toggle('active', prefs.lang === l);
    btn.addEventListener('click', () => {
      prefs.lang = l;
      safeSet(PREF_KEYS.lang, l);
      applyTheme();
      mountApp(); // labels are language-dependent throughout the chrome — a full remount is the
                  // simplest correct fix (no per-node re-label bookkeeping to keep in sync).
    });
    langGroup.appendChild(btn);
  }
  nav.appendChild(langGroup);

  connectionTagEl = document.createElement('span');
  connectionTagEl.className = 'rwe-connection';
  updateConnectionTag();
  nav.appendChild(connectionTagEl);

  const routeMount = document.createElement('main');
  routeMount.id = 'app-view';

  return { nav, routeMount };
}

function buildTabPanels() {
  const wrapper = document.createElement('div');
  wrapper.className = 'rwe-tab-panels';
  let workflowsPanel = null;
  for (const tab of ['workflows', 'models', 'system', 'issues']) {
    const panel = document.createElement('div');
    panel.dataset.tabPanel = tab;
    panel.style.display = tab === 'workflows' ? '' : 'none';
    wrapper.appendChild(panel);
    if (tab === 'workflows') workflowsPanel = panel;
  }
  return { wrapper, workflowsPanel };
}

function go(path) {
  history.pushState(null, '', path);
  mountRoute();
}

let currentView = null; // { name, ctx, container, onTick }
let viewGeneration = 0;
let pendingTick = null;

// DES-206 [v27c] — "one timer" completed: every mounted view supplies its own `onTick(container,
// bodies, ctx)` (home.js/workflow.js/run.js so far; system.js/issues.js/models.js are TASK-212's
// own re-run). This is the ONE poll loop for the whole app — it keeps EVERY fetched body (not just
// a `primaryBody`), hands them to the mounted view, merges whatever additional (state-dependent)
// fetch statuses the view's own `onTick` made, and only THEN reduces `nextConnection`.
async function tick() {
  const view = currentView;
  if (!view) return;
  const urls = endpointsFor(view.name, view.ctx);
  const results = {};
  const bodies = {};
  // Independent endpoints (`workflow`'s `describe` + `/api/runs`) fetched concurrently, not
  // serialized — `getJSON` never throws, so `Promise.all` needs no per-call try/catch of its own.
  await Promise.all(urls.map(async (url) => {
    const res = await getJSON(url);
    results[url] = res.status;
    bodies[url] = res.body;
  }));
  if (view.onTick && view.container) {
    const extra = await view.onTick(view.container, bodies, view.ctx);
    if (extra) Object.assign(results, extra);
  }
  if (Object.keys(results).length > 0) {
    connectionState = nextConnection(connectionState, { results });
    updateConnectionTag();
  }
}

function scheduleTick() {
  const gen = ++viewGeneration;
  if (pendingTick) clearTimeout(pendingTick);
  const loop = () => {
    if (gen !== viewGeneration) return; // a newer route/mount superseded this poll loop.
    tick().finally(() => {
      if (gen !== viewGeneration) return;
      pendingTick = setTimeout(loop, 3000);
    });
  };
  loop();
}

async function mountLazy(modulePath, viewName, ctx) {
  const container = document.getElementById('app-view');
  container.replaceChildren();
  const handlers = {};
  try {
    const mod = await import(modulePath);
    currentView = { name: viewName, ctx, container, onTick: mod.onTick };
    mod.render(container, ctx, handlers);
  } catch {
    // The sibling module has not landed yet in this Gate-6 dispatch, or genuinely failed to load —
    // degrade visibly (D5: `textContent` only) rather than a blank page.
    const p = document.createElement('p');
    p.textContent = `${viewName} view unavailable`;
    container.appendChild(p);
    currentView = { name: viewName, ctx, container: null, onTick: null };
  }
  scheduleTick();
}

function mountHomeRoot() {
  const container = document.getElementById('app-view');
  container.replaceChildren();
  const { wrapper, workflowsPanel } = buildTabPanels();
  container.appendChild(wrapper);
  const handlers = { onSelect: (card) => go(`/dashboard/workflow/${encodeURIComponent(card.name)}`) };
  currentView = { name: 'home', ctx: {}, container: workflowsPanel, onTick: onTickHome };
  renderHome(workflowsPanel, { cards: [], lang: prefs.lang }, handlers);
  activateTab(pendingTab || 'workflows');
  pendingTab = null;
  scheduleTick(); // fires the first tick immediately — the initial data-island render above is
                   // empty, so this is what puts real cards on screen before `networkidle0`.
}

function mountRoute() {
  const path = location.pathname;
  let m = /^\/dashboard\/workflow\/([^/]+)\/?$/.exec(path);
  if (m) {
    mountLazy('./workflow.js', 'workflow', { name: decodeURIComponent(m[1]) });
    return;
  }
  m = /^\/dashboard\/([^/]+)\/?$/.exec(path);
  if (m) {
    mountLazy('./run.js', 'run', { runId: decodeURIComponent(m[1]) });
    return;
  }
  mountHomeRoot();
}

function mountApp() {
  const island = readIsland();
  applyTheme();
  const { nav, routeMount } = buildChrome(island);
  document.body.replaceChildren(nav, routeMount);
  mountRoute();
}

window.addEventListener('popstate', mountRoute);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountApp);
} else {
  mountApp();
}

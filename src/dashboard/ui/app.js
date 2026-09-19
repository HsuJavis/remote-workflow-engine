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
import { fmtClock } from '../lib/runlist.js';
import { updatePanelModel, makeIslandReader } from '../lib/status.js';
// [v28, DES-210/DES-212, TASK-217] `demoEngages` is DES-212's predicate (TASK-220 adds it to
// `connection.js`, landing after this task per the v28 ordering rules) — the seam's own tick()
// already calls it so the demo path is wired in ONE commit, not bolted on later.
import { nextConnection, demoEngages, resumeReset } from '../lib/connection.js';
// [v28, DES-211, TASK-218] the poll scheduler's own decision table — every fire/arm/park decision
// is made here, never inline; this file only performs the timer/DOM side effects the returned
// `action` implies.
import { nextPoll } from '../lib/scheduler.js';
import { t as tStr } from '../lib/strings.js';
import { endpointsFor, getJSON, setDemoBodies } from './poll.js';
import { render as renderHome, onTick as onTickHome } from './home.js';

// [v28, DES-212, TASK-220] populated by `mountApp()`'s boot-time `import('../demo/dataset.js')`
// below — fire-and-forget, never awaited, so a dead engine (ADR-058's only real trigger) never
// blocks first paint. `demoEngages` is guarded by `datasetLoaded === true`, so a page that opens
// before the import settles (or whose import rejects — the retirement path, `rm -r
// src/dashboard/demo`) simply never engages demo, same as today.
let DEMO = null;
let DEMO_AVAILABLE = false;

// [v29f, REQ-162] `工作流` (not `工作流程`) and `Auto` (not `System`) — the handoff's own STR
// table. `System` as a THEME label also collides with the `System` TAB one line above it.
const LABELS = {
  zh: {
    workflows: '工作流', models: '模型', system: '系統', issues: '問題',
    live: '連線中', offline: '離線', degraded: '部分異常', checking: '連線中…',
    dark: '深', light: '淺', system_theme: '系統', updated: '更新於',
  },
  en: {
    workflows: 'Workflows', models: 'Models', system: 'System', issues: 'Issues',
    live: 'Live', offline: 'Offline', degraded: 'Degraded', checking: 'Connecting…',
    dark: 'Dark', light: 'Light', system_theme: 'Auto', updated: 'Updated',
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

// [v29, REQ-149] Memoized, because `mountApp()` below calls `document.body.replaceChildren(...)`
// and the server-rendered island is IN the body (`dashboard-page.ts:93`). The first mount reads it
// before that wipe; a language switch calls `mountApp()` again and would otherwise read a document
// with no `#rwe-init` left — which is how the nav came to paint `vundefined` and lose the whole
// update panel until a reload. The memo lives in `lib/status.js` so it is unit-testable: vitest
// runs `environment: 'node'`, so nothing in this file is reachable from a unit test.
const readIsland = makeIslandReader(() => {
  const el = document.getElementById('rwe-init');
  if (!el) return {};
  try {
    return JSON.parse(el.textContent || '{}');
  } catch {
    return {};
  }
});

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
// [v28, DES-212, TASK-220] the last tick's `source` ('live' | 'demo') — set by `tick()` right
// before it calls `updateConnectionTag()`, so the nav tag / banner below can tell "genuinely
// offline" from "offline, but demo mode has taken over" without re-deriving it from
// `connectionState` (which never carries `source`, only the transport verdict).
let currentSource = 'live';
let demoBannerEl = null;
function updateConnectionTag() {
  if (!connectionTagEl) return;
  connectionTagEl.textContent = currentSource === 'demo'
    ? tStr(prefs.lang, 'demoData')
    : (L(prefs.lang, connectionState.status) || L(prefs.lang, 'checking'));
  connectionTagEl.dataset.status = connectionState.status;
  // DES-209's REQ-131 row: `.rwe-connection{.is-live,.is-degraded,.is-offline}` — the stylesheet
  // keys on a class, not the `data-status` attribute above (which nothing else reads).
  for (const s of ['live', 'degraded', 'offline']) {
    connectionTagEl.classList.toggle(`is-${s}`, connectionState.status === s);
  }
  connectionTagEl.classList.toggle('is-demo', currentSource === 'demo');
  // REQ-143's own clause: demo mode must be visible in the page BODY too, not only the nav — a
  // screenshot that crops the nav still shows the fiction is a fiction.
  if (demoBannerEl) demoBannerEl.hidden = currentSource !== 'demo';
}

// [v28, DES-210/DES-211, TASK-217/TASK-218] the ONE `data-poll` call site, so `dashboard-seam.
// test.ts`'s exactly-once tripwire holds forever regardless of how many places later WANT to report
// a state — `runPoll` below calls this with `'active'` on every fire/arm and `'parked'` on every
// park (the visibility wiring's own decisions, made by `lib/scheduler.js`, never inline here).
function stampPoll(state) {
  document.documentElement.setAttribute('data-poll', state);
}

let footerUpdatedEl = null;
// README "Header / chrome": "Footer: API base left, `Updated HH:MM:SS` right, 11.5 px 50 %" —
// `location.origin` IS the API base here (every `fetch()` in `poll.js` is same-origin relative).
function updateFooterClock() {
  if (!footerUpdatedEl) return;
  const d = new Date(); // det:allow — the footer's own "Updated HH:MM:SS" IS a live wall-clock display, not a decision
  // [v29d] one shared clock formatter (`lib/runlist.js`), not a third private copy.
  footerUpdatedEl.textContent = `${L(prefs.lang, 'updated')} ${fmtClock(d)}`;
}

function buildFooter(island, lang) {
  const footer = document.createElement('footer');
  footer.className = 'rwe-footer';
  footer.setAttribute('data-footer', '');
  const api = document.createElement('span');
  api.textContent = location.origin;
  footer.appendChild(api);
  // [v29e, REQ-161] The engine's version + last-update outcome + interrupted-runs CTA live here
  // now. README "Header / chrome" gives the nav brand, source tag and tabs and nothing else, so
  // the cluster had no slot there — but REQ-070 requires this information to stay observable on
  // the dashboard, and the handoff never covered the self-update feature, so it cannot rule that
  // requirement away. The footer is the surface the design DOES define for engine-side facts
  // (API base left, clock right); this joins it rather than disappearing.
  footer.appendChild(buildUpdatePanel(island, lang));
  footerUpdatedEl = document.createElement('span');
  footer.appendChild(footerUpdatedEl);
  updateFooterClock();
  return footer;
}

let pendingTab = null;
const TAB_MODULES = { models: './models.js', system: './system.js', issues: './issues.js' };
// [v27c AC-5 Gate 8 repair] once a tab's module has loaded, its `onTick` is cached here so
// switching BACK to an already-mounted tab re-joins the one poll timer without a second
// `import()` (the module is only ever `render()`ed once — `panel.dataset.mounted` still owns that).
const tabModuleCache = {};

// [v27c AC-5 Gate 8 repair] this function used to only toggle panel visibility — `currentView`
// (the ONE poll timer's target, `tick()` below) stayed on 'home' forever, so `/api/home` kept
// being fetched for a hidden panel while the VISIBLE tab's own route was never joined to the timer
// (ARCH-125's "the fetch set of the VISIBLE view only"). It now sets `currentView` to the visible
// tab on every activation, which is what makes `endpointsFor(currentView.name)` (in `tick()`)
// return that tab's route.
function activateTab(tab) {
  const panels = document.querySelectorAll('[data-tab-panel]');
  panels.forEach((p) => {
    p.style.display = p.dataset.tabPanel === tab ? '' : 'none';
  });
  // README "Header / chrome": tabs are underlined links, `aria-current="page"` marks the current
  // one (accent-700 text + accent underline, dashboard.css) — replaces the pre-v27README
  // `button.active` background fill.
  document.querySelectorAll('.rwe-tabs a').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const panel = document.querySelector(`[data-tab-panel="${tab}"]`);
  if (tab === 'workflows') {
    currentView = { name: 'home', ctx: {}, container: panel, onTick: onTickHome };
  } else if (TAB_MODULES[tab]) {
    const cached = tabModuleCache[tab];
    // `onTick: null` until the module (and its own first `render()`-triggered fetch) resolves below —
    // `tick()` already skips calling a null `onTick`, and the per-url fetch it always does still
    // reports this tab's route status to `nextConnection` in the meantime.
    currentView = { name: tab, ctx: {}, container: panel, onTick: cached ? cached.onTick : null };
    if (!cached && panel && !panel.dataset.mounted) {
      panel.dataset.mounted = '1';
      import(TAB_MODULES[tab]).then((mod) => {
        tabModuleCache[tab] = mod;
        mod.render(panel, {}, {});
        // Only join THIS module's onTick to the timer if the operator is still on this tab — a fast
        // switch away before the import settled must not steal the tick back from whichever tab is
        // actually visible now.
        if (currentView && currentView.name === tab) {
          currentView.onTick = mod.onTick;
          // [v28, DES-210, TASK-217] the cold path: fire again now this tab's onTick is mounted,
          // rather than leaving its panel empty for up to 3s until the ambient cycle catches up.
          scheduleTick();
        }
      }).catch(() => {
        const p = document.createElement('p');
        p.textContent = `${tab} unavailable`;
        panel.appendChild(p);
      });
    }
  }
  // [v28, DES-210, TASK-217] every activation ends with an immediate re-poll of the now-visible
  // view, rather than waiting out whatever is left of the ambient 3s cycle.
  scheduleTick();
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

  // README "Header / chrome": brand "工作流引擎 / Workflow Engine" next to the source tag
  // (`rwe-connection`, appended further below in this same function).
  const brand = document.createElement('span');
  brand.className = 'nav-brand';
  brand.setAttribute('data-nav-brand', '');
  brand.textContent = tStr(prefs.lang, 'brand');
  nav.appendChild(brand);
  // [v29e, REQ-160] README "Header / chrome": the source tag sits NEXT TO the brand, not at the far
  // right of the cluster. [REQ-161] The engine's version/update strings used to sit here; the
  // design's nav has no slot for them and they are not chrome — they move to the footer, which the
  // design does define. They are NOT deleted: REQ-070 requires the applied version and the
  // last-update outcome to stay observable on the dashboard, and the design handoff never covered
  // the self-update feature at all, so it cannot rule that requirement away.
  connectionTagEl = document.createElement('span');
  connectionTagEl.className = 'rwe-connection';
  connectionTagEl.setAttribute('data-connection-tag', '');
  nav.appendChild(connectionTagEl);

  const tabStrip = document.createElement('div');
  tabStrip.className = 'rwe-tabs';
  for (const tab of ['workflows', 'models', 'system', 'issues']) {
    // README "Header / chrome": "Tabs are underlined links (`aria-current="page"` -> accent-700
    // text + accent underline)" — an <a> rather than a <button>. `href` points back at the tab
    // root (never changes the URL per this app's own routing contract above); the click handler
    // still owns navigation via `setTab`, same as the button it replaces.
    const link = document.createElement('a');
    link.href = '/dashboard';
    link.dataset.tab = tab;
    link.textContent = L(prefs.lang, tab);
    link.addEventListener('click', (e) => {
      e.preventDefault();
      setTab(tab);
    });
    // A native <a> activates on Enter but not Space (a <button> activates on both) — this keeps
    // Space working too, so the tabs lose no keyboard operability by becoming links.
    link.addEventListener('keydown', (e) => {
      if (e.key === ' ') {
        e.preventDefault();
        setTab(tab);
      }
    });
    tabStrip.appendChild(link);
  }
  nav.appendChild(tabStrip);

  // DES-209's component layer (`.nav`/`.hr`, REQ-131's shell) — a divider between the tab strip
  // and the theme/lang/connection controls that follow it.
  const navDivider = document.createElement('hr');
  navDivider.className = 'hr';
  nav.appendChild(navDivider);

  // README "Header / chrome": "Right cluster: hue slider ..., lang seg ..., theme seg ..." — hue,
  // then lang, then theme, in that DOM order (previously theme/hue/lang; reordered here, no
  // behaviour change to any of the three controls). The slider and its degrees readout are ONE
  // README bullet ("hue slider (150px, ..., current degrees)"), so they share one flex item
  // (`.rwe-hue-wrap`) — also what keeps the nav's own flex-wrap line count from growing at a
  // narrow viewport (measured: two separate nav children cost one extra 16px gap over one shared
  // 6px internal gap, enough to tip `.rwe-nav`'s wrap at 1100px and push page content down).
  const hueWrap = document.createElement('span');
  hueWrap.className = 'rwe-hue-wrap';
  const hue = document.createElement('input');
  hue.type = 'range';
  hue.min = '0';
  hue.max = '359';
  hue.value = String(prefs.hue);
  hue.className = 'rwe-hue-slider';
  const hueValue = document.createElement('span');
  hueValue.className = 'rwe-hue-value';
  hueValue.setAttribute('data-hue-value', '');
  hueValue.textContent = `${prefs.hue}°`;
  hue.addEventListener('input', () => {
    prefs.hue = clampHue(Number(hue.value));
    safeSet(PREF_KEYS.hue, String(prefs.hue));
    document.documentElement.style.setProperty('--rwe-hue', String(prefs.hue));
    hueValue.textContent = `${prefs.hue}°`;
  });
  hueWrap.appendChild(hue);
  hueWrap.appendChild(hueValue);
  nav.appendChild(hueWrap);

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

  const themeGroup = document.createElement('div');
  themeGroup.className = 'rwe-theme-group';
  for (const t of ['system', 'light', 'dark']) {
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


  // [v28, DES-212, TASK-220, REQ-143] the shell banner — a child of `nav`, so it is OUTSIDE
  // `mountLazy`'s per-route `container.replaceChildren()` reach and survives every tab/route
  // switch for as long as demo mode stays engaged. `data-demo-banner` is the frozen test anchor;
  // `hidden` (a UA-default `display:none`, no stylesheet dependency) is what `updateConnectionTag`
  // toggles each tick.
  demoBannerEl = document.createElement('div');
  demoBannerEl.className = 'rwe-demo-banner';
  demoBannerEl.setAttribute('data-demo-banner', '');
  demoBannerEl.textContent = tStr(prefs.lang, 'demoBanner');
  demoBannerEl.hidden = true;
  nav.appendChild(demoBannerEl);

  updateConnectionTag();

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
// [v28, DES-211, TASK-218] the poll scheduler's own state — `lib/scheduler.js`'s `nextPoll` is the
// ONLY thing that decides fire/arm/park; this file just carries the returned state forward.
let pollState = { parked: false };

// [v28, DES-211, TASK-218] one indirection for the one environment read this wiring needs — NOT a
// test seam (conflict C4/ADR-049 already concluded nothing can inject into app.js under jsdom); it
// exists so the one `document.visibilityState` read in this file has one name and one call site.
function visibility() {
  return document.visibilityState;
}

// DES-206 [v27c] — "one timer" completed: every mounted view supplies its own `onTick(container,
// bodies, ctx, tick)` (home.js/workflow.js/run.js so far; system.js/issues.js/models.js are
// TASK-212's own re-run, widened to the 4th `tick` param by TASK-217). This is the ONE poll loop
// for the whole app.
//
// [v28, DES-210, TASK-217] the seven steps below, in this order, because two of them are not
// commutative: (1) fetch the visible view's own endpoints -> `transportResults`/`realBodies`/
// `reached`, all keyed by url; (2) `preview` — COMPUTED, never assigned to `connectionState`; (3)
// `demoTick` reasons over `preview` and the primaries' `reached` bits, never over `connectionState`
// itself; (4) install (or clear) the demo map and pick which bodies/statuses the VIEW sees; (5) hand
// the view its bodies and the tick descriptor; (6) merge the view's own extra statuses onto the
// PRIMARY transport results — a demo tick discards the extras' (fictional) statuses at the seam,
// DES-210's rule (R) exception; (7) the ONE `connectionState` assignment, from the SAME state step
// 2 read.
async function tick() {
  const view = currentView;
  if (!view) return;
  const urls = endpointsFor(view.name, view.ctx);
  const transportResults = {};
  const realBodies = {};
  const reached = {};
  // Independent endpoints (`workflow`'s `describe` + `/api/runs`) fetched concurrently, not
  // serialized — `getJSON` never throws, so `Promise.all` needs no per-call try/catch of its own.
  await Promise.all(urls.map(async (url) => {
    const res = await getJSON(url);
    transportResults[url] = res.status;
    realBodies[url] = res.body;
    reached[url] = res.reached;
  }));
  const preview = nextConnection(connectionState, { results: transportResults });
  const demoTick = demoEngages(preview.status, urls.map((url) => reached[url]), DEMO_AVAILABLE);
  let bodies;
  let viewResults;
  let source;
  if (demoTick) {
    setDemoBodies(DEMO);
    source = 'demo';
    bodies = {};
    viewResults = {};
    for (const url of urls) {
      bodies[url] = DEMO.get(url);
      viewResults[url] = DEMO.has(url) ? 'ok' : 'fail';
    }
  } else {
    setDemoBodies(null);
    bodies = realBodies;
    viewResults = transportResults;
    source = 'live';
  }
  currentSource = source;
  let extra;
  if (view.onTick && view.container) {
    extra = await view.onTick(view.container, bodies, view.ctx, { results: viewResults, source });
  }
  const merged = demoTick ? transportResults : { ...transportResults, ...extra };
  if (Object.keys(merged).length > 0) {
    connectionState = nextConnection(connectionState, { results: merged });
    updateConnectionTag();
  }
  document.documentElement.setAttribute('data-source', source);
  updateFooterClock(); // README footer: "Updated HH:MM:SS" — every tick, whether or not it changed anything.
}

// [v28, DES-211, TASK-218] runs the `action` an event produced: 'fire' cancels whatever the
// previous loop had armed and starts a new one; 'park' cancels the pending timer and arms nothing —
// `park` is the ABSENCE of a timer, not a suppressed tick, so 0 requests over a hidden window holds
// by construction rather than by a guard that can fail open.
function runPoll(action) {
  if (pendingTick) {
    clearTimeout(pendingTick);
    pendingTick = null;
  }
  if (action === 'park') {
    stampPoll('parked');
    return;
  }
  const gen = ++viewGeneration;
  stampPoll('active');
  const loop = () => {
    if (gen !== viewGeneration) return; // a newer route/mount superseded this poll loop.
    tick().finally(() => {
      if (gen !== viewGeneration) return;
      // [DES-211's named race] `hidden` may have arrived while this tick was in flight — consult
      // the CURRENT pollState, not the state at the moment this loop iteration was fired.
      const settle = nextPoll(pollState, 'settled');
      pollState = settle.state;
      if (settle.action === 'arm') {
        stampPoll('active');
        pendingTick = setTimeout(loop, 3000);
      } else {
        stampPoll('parked');
      }
    });
  };
  loop();
}

function scheduleTick() {
  const { state, action } = nextPoll(pollState, 'view-changed');
  pollState = state;
  runPoll(action);
}

// [v28, DES-211, TASK-218, REQ-142] the visibility wiring: `resumeReset` runs BEFORE the tick fire
// starts, clearing a PARTIAL fail streak on resume without ever un-declaring an `offline` verdict
// `nextConnection` already made (`resumeReset`'s own boundary) — a browser-tab visibility change,
// never the in-app tab strip (`view-changed`, above), which polls immediately but does not touch
// `connectionState`.
document.addEventListener('visibilitychange', () => {
  const event = visibility() === 'hidden' ? 'hidden' : 'visible';
  const { state, action } = nextPoll(pollState, event);
  pollState = state;
  if (action === 'fire') {
    connectionState = resumeReset(connectionState);
    updateConnectionTag();
  }
  runPoll(action);
});

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
  // `currentView` is set by `activateTab` below (every tab, including 'workflows', as of the AC-5
  // repair) — no separate assignment needed here.
  renderHome(workflowsPanel, { cards: [], lang: prefs.lang }, handlers);
  // `activateTab` (below) now ends with its own `scheduleTick()` [v28, DES-210, TASK-217] — that is
  // what puts real cards on screen before `networkidle0`, no separate call needed here.
  activateTab(pendingTab || 'workflows');
  pendingTab = null;
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
  document.body.replaceChildren(nav, routeMount, buildFooter(island, prefs.lang));
  mountRoute();
  // [v28, DES-212, TASK-220, REQ-143] the ONE boot-time load of the demo fiction — `no-store`
  // fresh bytes per load (ARCH-123's v28 amendment), fire-and-forget, never statically imported (a
  // static import would take the whole bundle down with `rm -r src/dashboard/demo`, the
  // retirement's registered exit). `mountApp()` re-runs on a language toggle (:328) too; the guard
  // keeps the module's own dedupe from being the only thing standing between a toggle and a second
  // GET, so REQ-143's "exactly one GET per page load" holds even then.
  if (DEMO === null) {
    import('../demo/dataset.js').then((m) => { DEMO = m.DEMO; DEMO_AVAILABLE = true; }).catch(() => {});
  }
}

window.addEventListener('popstate', mountRoute);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountApp);
} else {
  mountApp();
}

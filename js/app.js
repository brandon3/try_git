/* Acumen — application shell.
   Four views (dashboard → intro → play → results), one mounted at a time.
   Games are plain modules with a mount() contract; the shell owns
   navigation, level adaptation, and record-keeping. */

import { GAMES } from './games/index.js';
import { store, DAILY_GOAL } from './store.js';
import { el, svg, sparkline, ring, scoreRing, clamp } from './ui.js';

const app = document.getElementById('app');
let activeTeardown = null;

/** Swap in a new view, tearing down the outgoing one first. A view may expose
    cleanup via `view.__teardown` (games use this to stop their timers). */
function show(view) {
  activeTeardown?.();
  activeTeardown = view.__teardown ?? null;
  app.replaceChildren(view);
  window.scrollTo(0, 0);
}

// --- theme ------------------------------------------------------------

const THEME_KEY = 'acumen.theme';

const currentScheme = () =>
  localStorage.getItem(THEME_KEY) ||
  (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

function applyTheme() {
  const scheme = currentScheme();
  document.documentElement.dataset.theme = scheme;
  document.documentElement.style.colorScheme = scheme;
}

function toggleTheme() {
  localStorage.setItem(THEME_KEY, currentScheme() === 'dark' ? 'light' : 'dark');
  applyTheme();
}

applyTheme();

// --- dashboard ---------------------------------------------------------

const todayLine = () =>
  new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

function header() {
  return el('header', { class: 'top' },
    el('span', { class: 'wordmark' }, 'Acumen'),
    el('button', {
      class: 'icon-btn', title: 'Toggle theme', 'aria-label': 'Toggle theme',
      onclick: () => { toggleTheme(); show(dashboard()); },
    }, svg(`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
        stroke-width="1.8" stroke-linecap="round">
        <path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"/></svg>`)),
  );
}

function hero() {
  const done = store.todayCount();
  const { current, best } = store.streak();
  const fraction = Math.min(1, done / GAMES.length);
  const progress = ring(64, 6);
  requestAnimationFrame(() => progress.set(fraction));

  const line =
    done === 0 ? 'Six short drills. Begin anywhere.' :
    done < DAILY_GOAL ? `${DAILY_GOAL - done} more to keep the streak alive.` :
    done < GAMES.length ? 'Streak secured — finish the set?' :
    'A perfect day. See you tomorrow.';

  return el('section', { class: 'hero' },
    el('div', { class: 'hero-ring' }, progress.node,
      el('span', { class: 'hero-count' }, `${done}`, el('small', {}, `/${GAMES.length}`))),
    el('div', { class: 'hero-text' },
      el('h1', {}, todayLine()),
      el('p', {}, line)),
    el('div', { class: 'streak', title: `Best streak: ${best} days` },
      el('span', { class: 'streak-num' }, current),
      el('span', { class: 'streak-label' }, current === 1 ? 'day streak' : 'day streak')),
  );
}

function gameCard(game) {
  const record = store.game(game.id, game.levels.start);
  const scores = store.scores(game.id);
  const done = store.doneToday(game.id);

  return el('button', { class: `card d-${game.id}`, onclick: () => show(intro(game)) },
    el('div', { class: 'card-top' },
      el('span', { class: 'chip' }, svg(game.icon)),
      done
        ? el('span', { class: 'done-badge' }, '✓ done')
        : el('span', { class: 'mins' }, `~${game.minutes} min`)),
    el('span', { class: 'domain' }, game.domain),
    el('h2', {}, game.title),
    el('p', { class: 'blurb' }, game.blurb),
    el('div', { class: 'card-foot' },
      el('span', { class: 'level' }, game.levelLabel(record.level)),
      el('span', { class: 'spark-wrap' }, sparkline(scores))),
  );
}

function science() {
  return el('details', { class: 'science' },
    el('summary', {}, 'The science, honestly'),
    el('div', { class: 'science-body' },
      el('p', {}, 'Each drill is the canonical task for its domain: dual n-back for working memory, ' +
        'matrix problems for fluid reasoning, symbol coding for processing speed, Stroop for attention, ' +
        'pattern span for spatial memory, and spaced repetition for vocabulary.'),
      el('p', {}, 'What the research supports: you will get measurably better at these abilities, and ' +
        'vocabulary gains are real knowledge you keep. What is contested: whether gains transfer into raw IQ. ' +
        'Meta-analyses find near-transfer is solid and far-transfer is small at best — so Acumen tracks each ' +
        'domain honestly instead of promising a number.'),
      el('p', {}, 'The strongest levers for cognition remain sleep, aerobic exercise, and learning hard new ' +
        'things. Treat these ten minutes as the deliberate-practice layer on top.')),
  );
}

function dashboard() {
  return el('main', { class: 'view' },
    header(),
    hero(),
    el('section', { class: 'grid' }, GAMES.map(gameCard)),
    science(),
    el('footer', { class: 'foot' }, 'Progress lives in this browser. Come back tomorrow.'),
  );
}

// --- intro / play / results ---------------------------------------------

function intro(game) {
  const { level } = store.game(game.id, game.levels.start);
  return el('main', { class: `view d-${game.id}` },
    gameHeader(game, level),
    el('section', { class: 'panel' },
      el('ol', { class: 'howto' }, game.howTo(level).map((step) => el('li', {}, step))),
      el('button', { class: 'btn btn-primary btn-wide', onclick: () => show(play(game)) }, 'Begin'),
      el('p', { class: 'science-note' }, game.science)),
  );
}

function gameHeader(game, level) {
  return el('header', { class: 'top' },
    el('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => show(dashboard()) },
      svg(`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>`)),
    el('span', { class: 'top-title' },
      el('b', {}, game.title),
      el('span', { class: 'top-level' }, game.levelLabel(level))),
    el('span', { class: 'top-spacer' }),
  );
}

function play(game) {
  const { level } = store.game(game.id, game.levels.start);
  const stage = el('section', { class: 'stage' });
  const view = el('main', { class: `view d-${game.id}` }, gameHeader(game, level), stage);
  let settled = false;

  const finish = (result) => {
    if (settled) return;
    settled = true;
    show(results(game, level, result));
  };
  const cleanup = game.mount(stage, { level, finish });
  view.__teardown = () => { settled = true; cleanup?.(); };
  return view;
}

function results(game, level, { score, notes = [], levelDelta = 0 }) {
  const previousBest = store.best(game.id);
  store.recordSession(game.id, score);
  const nextLevel = clamp(level + levelDelta, game.levels.min, game.levels.max);
  if (nextLevel !== level) store.setLevel(game.id, nextLevel);

  const headline =
    score >= 90 ? 'Brilliant.' :
    score >= 75 ? 'Sharp.' :
    score >= 55 ? 'Solid work.' :
    score >= 35 ? 'Warming up.' : 'Tomorrow is another rep.';

  const remarks = [
    ...notes,
    score > previousBest && previousBest > 0 ? 'A personal best.' : null,
    nextLevel > level ? `Level up — next time: ${game.levelLabel(nextLevel)}.` :
    nextLevel < level ? `Easing off — next time: ${game.levelLabel(nextLevel)}.` : null,
  ].filter(Boolean);

  return el('main', { class: `view d-${game.id}` },
    gameHeader(game, level),
    el('section', { class: 'panel results' },
      scoreRing(score),
      el('h2', { class: 'headline' }, headline),
      el('ul', { class: 'remarks' }, remarks.map((r) => el('li', {}, r))),
      el('div', { class: 'result-actions' },
        el('button', { class: 'btn', onclick: () => show(play(game)) }, 'Once more'),
        el('button', { class: 'btn btn-primary', onclick: () => show(dashboard()) }, 'Back to today')),
    ),
  );
}

show(dashboard());

/* Persistence: progress, adaptive levels, streaks, and spaced-repetition state.
   Everything lives in a single localStorage document, saved atomically. */

const KEY = 'acumen.v1';
const HISTORY_CAP = 90;
export const DAILY_GOAL = 3; // sessions per day for the streak to count

export const dayKey = (date = new Date()) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');

const yesterdayKey = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1); // calendar-based, so DST-length days can't skew it
  return dayKey(d);
};

const blank = () => ({
  games: {},   // id -> { level, history: [{ d, s }] }
  days: {},    // dayKey -> [gameId, ...]
  streak: { current: 0, best: 0, lastCounted: null },
  srs: {},     // word -> { box, due }
});

function load() {
  try {
    return { ...blank(), ...JSON.parse(localStorage.getItem(KEY)) };
  } catch {
    return blank();
  }
}

const state = load();
const save = () => localStorage.setItem(KEY, JSON.stringify(state));

/** Advance the streak counter, at most once per calendar day. */
function countStreakDay() {
  const s = state.streak;
  if (s.lastCounted === dayKey()) return;
  s.current = s.lastCounted === yesterdayKey() ? s.current + 1 : 1;
  s.best = Math.max(s.best, s.current);
  s.lastCounted = dayKey();
}

export const store = {
  /** Per-game record, created on first access with the game's starting level. */
  game(id, startLevel = 1) {
    return (state.games[id] ??= { level: startLevel, history: [] });
  },

  setLevel(id, level) {
    this.game(id).level = level;
    save();
  },

  /** Log a finished session and roll the day/streak bookkeeping forward. */
  recordSession(id, score) {
    const game = this.game(id);
    game.history.push({ d: dayKey(), s: score });
    game.history.splice(0, game.history.length - HISTORY_CAP);

    const today = (state.days[dayKey()] ??= []);
    if (!today.includes(id)) today.push(id);
    if (today.length >= DAILY_GOAL) countStreakDay();
    save();
  },

  /** Streak as the user should see it: 0 once a day has been missed. */
  streak() {
    const s = state.streak;
    const alive = s.lastCounted === dayKey() || s.lastCounted === yesterdayKey();
    return { current: alive ? s.current : 0, best: s.best };
  },

  doneToday: (id) => (state.days[dayKey()] ?? []).includes(id),
  todayCount: () => (state.days[dayKey()] ?? []).length,

  scores: (id) => state.games[id]?.history.map((h) => h.s) ?? [],
  best: (id) => Math.max(0, ...store.scores(id)),

  // --- spaced repetition (vocabulary) ---
  srsGet: (word) => state.srs[word],
  srsSet(word, record) {
    state.srs[word] = record;
    save();
  },
  srsMastered: () => Object.values(state.srs).filter((r) => r.box >= 4).length,
  srsDue: () =>
    Object.entries(state.srs)
      .filter(([, r]) => r.due <= dayKey())
      .map(([w]) => w),
};

/* Verbal & crystallized intelligence — vocabulary on a Leitner schedule.
   Crystallized intelligence is the domain that most reliably grows with
   deliberate learning; spaced repetition is its best-evidenced method. */

import { el, shuffle } from '../ui.js';
import { store, dayKey } from '../store.js';
import { WORDS } from '../data/words.js';

const SESSION = 10;
const CHOICES = 4;
const INTERVALS = [1, 2, 4, 9, 21]; // days until review, per Leitner box

const wordsByName = new Map(WORDS.map((w) => [w.w, w]));

function buildQueue() {
  const due = store.srsDue().map((w) => wordsByName.get(w)).filter(Boolean);
  const fresh = WORDS.filter((w) => !store.srsGet(w.w));
  const learned = WORDS.filter((w) => store.srsGet(w.w));
  const queue = [...shuffle(due), ...shuffle(fresh)];
  return (queue.length >= SESSION ? queue : [...queue, ...shuffle(learned)]).slice(0, SESSION);
}

function reschedule(word, wasRight) {
  const box = wasRight ? Math.min(5, (store.srsGet(word)?.box ?? 0) + 1) : 1;
  const due = dayKey(new Date(Date.now() + INTERVALS[box - 1] * 864e5));
  store.srsSet(word, { box, due });
}

export default {
  id: 'verbal',
  domain: 'Verbal knowledge',
  title: 'Lexicon',
  blurb: 'Grow a sharper vocabulary, spaced for keeps.',
  minutes: 3,
  levels: { min: 1, max: 1, start: 1 },
  levelLabel: () => `${store.srsMastered()} mastered`,
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.5C10 4.8 7.3 4.5 4 4.5v14c3.3 0 6 .3 8 2 2-1.7 4.7-2 8-2v-14c-3.3 0-6 .3-8 2z"/><path d="M12 6.5v14"/></svg>`,
  science:
    'Vocabulary is a core index of crystallized intelligence, and it keeps growing for life. ' +
    'Spaced repetition (Leitner boxes) is among the most replicated effects in learning science.',
  howTo: () => [
    `${SESSION} words: reviews that are due first, then new ones.`,
    'Pick the definition that fits. Miss a word and it returns tomorrow; master it and the gaps stretch to weeks.',
    'Words answered correctly four times running count as mastered.',
  ],

  mount(stage, { finish }) {
    const queue = buildQueue();
    let index = 0;
    let correct = 0;
    let timer;

    const dots = queue.map(() => el('span', { class: 'dot' }));
    const board = el('div', { class: 'vb-board' });
    stage.append(el('div', { class: 'stage-head' }, el('div', { class: 'dots' }, dots)), board);

    function next() {
      if (index === queue.length) {
        return finish({
          score: Math.round((correct / queue.length) * 100),
          notes: [
            `${correct} of ${queue.length} defined correctly`,
            `${store.srsMastered()} words mastered · ${store.srsDue().length} due for review`,
          ],
          levelDelta: 0,
        });
      }
      const entry = queue[index];
      const isNew = !store.srsGet(entry.w);
      const options = shuffle([
        entry,
        ...shuffle(WORDS.filter((w) => w !== entry)).slice(0, CHOICES - 1),
      ]);
      let locked = false;

      const buttons = options.map((option) =>
        el('button', {
          class: 'vb-option',
          onclick: (e) => {
            if (locked) return;
            locked = true;
            const right = option === entry;
            if (right) correct++;
            reschedule(entry.w, right);
            e.currentTarget.classList.add(right ? 'is-good' : 'is-bad');
            if (!right) buttons[options.indexOf(entry)].classList.add('is-good');
            dots[index].classList.add(right ? 'is-good' : 'is-bad');
            index++;
            timer = setTimeout(next, right ? 700 : 1800);
          },
        }, option.d));

      board.replaceChildren(
        el('div', { class: 'vb-word' },
          entry.w,
          isNew ? el('span', { class: 'vb-new' }, 'new') : null),
        el('div', { class: 'vb-options' }, buttons),
      );
    }

    next();
    return () => clearTimeout(timer);
  },
};

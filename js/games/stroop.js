/* Attention & inhibitory control — the Stroop task.
   Name the ink, not the word. A century-old measure of selective attention
   and the executive skill of suppressing an automatic response. */

import { el, meter, shuffle, pick, clamp, countdown } from '../ui.js';

const TRIALS = 36;
const INCONGRUENT_RATE = 0.65;
const INKS = [
  { name: 'Red', hex: '#dc2626' },
  { name: 'Blue', hex: '#2563eb' },
  { name: 'Green', hex: '#16a34a' },
  { name: 'Yellow', hex: '#ca8a04' },
  { name: 'Purple', hex: '#9333ea' },
  { name: 'Orange', hex: '#ea580c' },
];

export default {
  id: 'stroop',
  domain: 'Attention',
  title: 'Ink & Word',
  blurb: 'Say what you see, not what you read.',
  minutes: 2,
  levels: { min: 1, max: 6, start: 1 },
  levelLabel: (n) => `Tempo ${n}`,
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>`,
  science:
    'The Stroop effect (1935) is the canonical test of selective attention and response inhibition. ' +
    'Interference-control practice sharpens the executive network that filters distraction.',
  howTo: (level) => [
    'A color word appears, printed in ink that may not match it.',
    'Answer with the ink color — ignore what the word says.',
    `${TRIALS} rounds. You have ${((Math.max(1100, 2300 - level * 200)) / 1000).toFixed(1)}s each; hesitation counts against you.`,
  ],

  mount(stage, { level, finish }) {
    const inks = INKS.slice(0, 4 + Math.min(2, level - 1));
    const deadline = Math.max(1100, 2300 - level * 200);
    let round = 0;
    let correct = 0;
    const reactionTimes = [];
    let trial = null;
    let deadlineTimer, pauseTimer;

    const progress = meter();
    const wordBox = el('div', { class: 'st-word' }, ' ');
    const choices = el('div', { class: 'st-choices' },
      inks.map((ink, i) =>
        el('button', { class: 'btn st-choice', onclick: () => answer(ink) },
          el('span', { class: 'st-swatch', style: `background:${ink.hex}` }),
          ink.name, el('kbd', {}, i + 1))));
    stage.append(
      el('div', { class: 'stage-head' }, 'Answer with the ink color'),
      progress.node, wordBox, choices,
    );

    function next() {
      if (round === TRIALS) return end();
      progress.set(round / TRIALS);
      const ink = pick(inks);
      const word = Math.random() < INCONGRUENT_RATE
        ? pick(inks.filter((c) => c !== ink)).name
        : ink.name;
      trial = { ink, shownAt: performance.now() };
      wordBox.textContent = word.toUpperCase();
      wordBox.style.color = ink.hex;
      deadlineTimer = setTimeout(() => answer(null), deadline);
    }

    function answer(ink) {
      if (!trial) return;
      clearTimeout(deadlineTimer);
      const { ink: truth, shownAt } = trial;
      trial = null;
      round++;
      if (ink === truth) {
        correct++;
        reactionTimes.push(performance.now() - shownAt);
        next();
      } else {
        wordBox.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 260 });
        pauseTimer = setTimeout(next, 260);
      }
    }

    function end() {
      const accuracy = correct / TRIALS;
      const sorted = reactionTimes.toSorted((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      // No correct answers means no speed to credit — don't let the fallback inflate the score.
      const speed = sorted.length ? clamp((1400 - median) / 800, 0, 1) : 0;
      finish({
        score: Math.round(accuracy * 70 + speed * 30),
        notes: [
          `${correct}/${TRIALS} correct` +
            (sorted.length ? ` · median ${Math.round(median)} ms` : ''),
        ],
        levelDelta: accuracy >= 0.92 && sorted.length && median < 950 ? 1 : accuracy < 0.65 ? -1 : 0,
      });
    }

    const onKey = (e) => {
      const i = Number(e.key) - 1;
      if (inks[i]) answer(inks[i]);
    };
    window.addEventListener('keydown', onKey);
    const cancelCount = countdown(stage, next);

    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(deadlineTimer);
      clearTimeout(pauseTimer);
      cancelCount();
    };
  },
};

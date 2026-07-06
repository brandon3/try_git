/* Working memory — dual n-back.
   Hold a stream of positions and letters in mind and flag repeats from
   n steps back. The strongest evidence base of any working-memory task. */

import { el, countdown } from '../ui.js';

const LETTERS = ['B', 'H', 'K', 'M', 'Q', 'R', 'T', 'W'];
const TRIAL_MS = 2400;
const MATCH_RATE = 0.3;

function buildSequence(trials, n) {
  const seq = Array.from({ length: trials }, () => ({
    cell: Math.floor(Math.random() * 9),
    letter: LETTERS[Math.floor(Math.random() * LETTERS.length)],
  }));
  for (let i = n; i < trials; i++) {
    if (Math.random() < MATCH_RATE) seq[i].cell = seq[i - n].cell;
    if (Math.random() < MATCH_RATE) seq[i].letter = seq[i - n].letter;
  }
  return seq;
}

function speak(letter) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(letter);
  utterance.rate = 0.9;
  speechSynthesis.speak(utterance);
}

export default {
  id: 'nback',
  domain: 'Working memory',
  title: 'Dual N-Back',
  blurb: 'Hold two streams in mind and catch the echoes.',
  minutes: 4,
  levels: { min: 1, max: 9, start: 2 },
  levelLabel: (n) => `${n}-back`,
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M17.5 14v3.5m0 3.5v-3.5m0 0H14m3.5 0H21"/></svg>`,
  science:
    'Adaptive dual n-back is the most-studied working-memory intervention (Jaeggi et al., 2008). ' +
    'Meta-analyses agree it reliably improves working-memory capacity itself; whether gains transfer to fluid IQ is contested.',
  howTo: (n) => [
    `A square lights up and a letter is spoken, every ${TRIAL_MS / 1000} seconds.`,
    `Press Position (or A) when the square matches the one ${n} step${n > 1 ? 's' : ''} back.`,
    `Press Sound (or L) when the letter matches the one ${n} step${n > 1 ? 's' : ''} back.`,
    'Both can match at once. Stay calm — misses and false alarms both count.',
  ],

  mount(stage, { level: n, finish }) {
    const trials = 20 + n;
    const seq = buildSequence(trials, n);
    const tally = { hits: 0, misses: 0, falseAlarms: 0 };
    let index = -1;
    let pressed = { cell: false, letter: false };
    let trialTimer, flashTimer;

    const progress = el('div', { class: 'meter' }, el('div', { class: 'meter-fill' }));
    const cells = Array.from({ length: 9 }, () => el('button', { class: 'nb-cell', tabindex: -1, 'aria-hidden': true }));
    const grid = el('div', { class: 'nb-grid' }, cells);
    const letterBox = el('div', { class: 'nb-letter' }, '·');
    const buttons = {
      cell: el('button', { class: 'btn nb-key', onclick: () => press('cell') }, 'Position', el('kbd', {}, 'A')),
      letter: el('button', { class: 'btn nb-key', onclick: () => press('letter') }, 'Sound', el('kbd', {}, 'L')),
    };
    stage.append(
      el('div', { class: 'stage-head' }, `Match ${n} back · ${trials} rounds`),
      progress, grid, letterBox,
      el('div', { class: 'nb-keys' }, buttons.cell, buttons.letter),
    );

    const isMatch = (kind) => {
      const key = kind === 'cell' ? 'cell' : 'letter';
      return index >= n && seq[index][key] === seq[index - n][key];
    };

    function press(kind) {
      if (index < n || pressed[kind]) return;
      pressed[kind] = true;
      const ok = isMatch(kind);
      ok ? tally.hits++ : tally.falseAlarms++;
      buttons[kind].classList.add(ok ? 'is-good' : 'is-bad');
    }

    function advance() {
      if (index >= n) {
        for (const kind of ['cell', 'letter']) {
          if (isMatch(kind) && !pressed[kind]) tally.misses++;
        }
      }
      if (++index === trials) return end();

      pressed = { cell: false, letter: false };
      for (const b of Object.values(buttons)) b.classList.remove('is-good', 'is-bad');
      progress.firstChild.style.width = `${(index / trials) * 100}%`;

      const { cell, letter } = seq[index];
      cells[cell].classList.add('is-lit');
      letterBox.textContent = letter;
      speak(letter);
      flashTimer = setTimeout(() => cells[cell].classList.remove('is-lit'), 800);
      trialTimer = setTimeout(advance, TRIAL_MS);
    }

    function end() {
      const judged = tally.hits + tally.misses + tally.falseAlarms;
      const accuracy = judged ? tally.hits / judged : 0;
      finish({
        score: Math.round(accuracy * 100),
        notes: [
          `${tally.hits} caught · ${tally.misses} missed · ${tally.falseAlarms} false alarms`,
        ],
        levelDelta: accuracy >= 0.8 ? 1 : accuracy < 0.5 ? -1 : 0,
      });
    }

    const onKey = (e) => {
      if (e.key === 'a' || e.key === 'A') press('cell');
      if (e.key === 'l' || e.key === 'L') press('letter');
    };
    window.addEventListener('keydown', onKey);
    const cancelCount = countdown(stage, advance);

    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(trialTimer);
      clearTimeout(flashTimer);
      cancelCount();
      if ('speechSynthesis' in window) speechSynthesis.cancel();
    };
  },
};

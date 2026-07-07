/* Spatial memory — pattern span.
   A constellation of tiles flashes, then vanishes; rebuild it from memory.
   A visuospatial span task in the Corsi tradition, run as an adaptive
   staircase so it always sits at the edge of your span. */

import { el, shuffle } from '../ui.js';

const ROUNDS = 8;
const MAX_ERRORS = 2;

export default {
  id: 'memory',
  domain: 'Spatial memory',
  title: 'Constellation',
  blurb: 'Glimpse the pattern. Rebuild it from nothing.',
  minutes: 3,
  levels: { min: 2, max: 12, start: 4 },
  levelLabel: (n) => `Span ${n}`,
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 18.5L10 12l4.5 3.5L19 5.5"/><circle cx="5" cy="18.5" r="1.6" fill="currentColor" stroke="none"/><circle cx="10" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="14.5" cy="15.5" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="5.5" r="1.6" fill="currentColor" stroke="none"/></svg>`,
  science:
    'Visuospatial span tasks (Corsi, 1972) index the sketchpad of working memory. ' +
    'Adaptive span training produces reliable near-transfer to untrained spatial-memory tasks.',
  howTo: (span) => [
    `${span} tiles light up together, then go dark.`,
    'Tap every tile that was lit. Two mistakes end the round.',
    `${ROUNDS} rounds. Succeed and the pattern grows; slip and it eases off.`,
  ],

  mount(stage, { level, finish }) {
    let span = level;
    let peak = 0;
    let round = 0;
    let showTimer, restTimer;

    const head = el('div', { class: 'stage-head', role: 'status' });
    const board = el('div', { class: 'me-board' });
    stage.append(head, board);

    function playRound() {
      if (round === ROUNDS) return end();
      round++;
      const side = span <= 6 ? 4 : 5;
      const targets = new Set(shuffle([...Array(side * side).keys()]).slice(0, span));
      head.textContent = `Round ${round} of ${ROUNDS} · ${span} tiles`;

      let accepting = false;
      let found = 0;
      let errors = 0;

      const tiles = Array.from({ length: side * side }, (_, i) =>
        el('button', {
          class: 'me-tile',
          'aria-label': `Tile ${i + 1}`,
          onclick: () => {
            if (!accepting) return;
            const tile = tiles[i];
            if (targets.has(i) && !tile.classList.contains('is-found')) {
              tile.classList.add('is-found');
              if (++found === span) settle(true);
            } else if (!targets.has(i) && !tile.classList.contains('is-bad')) {
              tile.classList.add('is-bad');
              if (++errors === MAX_ERRORS) settle(false);
            }
          },
        }));
      board.replaceChildren(el('div', { class: 'me-grid', style: `--side:${side}` }, tiles));

      targets.forEach((i) => tiles[i].classList.add('is-lit'));
      showTimer = setTimeout(() => {
        targets.forEach((i) => tiles[i].classList.remove('is-lit'));
        accepting = true;
      }, 500 + span * 140);

      function settle(won) {
        accepting = false;
        if (won) {
          peak = Math.max(peak, span);
          span++;
        } else {
          targets.forEach((i) => tiles[i].classList.add('is-lit'));
          span = Math.max(2, span - 1);
        }
        restTimer = setTimeout(playRound, won ? 700 : 1400);
      }
    }

    function end() {
      finish({
        score: Math.min(100, Math.round((peak / (level + 4)) * 100)),
        notes: [`Longest pattern held: ${peak || '—'} tiles`],
        levelDelta: peak >= level + 2 ? 1 : peak <= level - 2 ? -1 : 0,
      });
    }

    playRound();
    return () => {
      clearTimeout(showTimer);
      clearTimeout(restTimer);
    };
  },
};

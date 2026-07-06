/* Processing speed — symbol coding, modeled on the WAIS digit-symbol test
   and the "speed of processing" drills with the best trial evidence.
   Translate symbols to digits against the clock. */

import { el, svg, meter, shuffle, countdown } from '../ui.js';

const SECONDS = 60;
const TARGET = 45; // net correct in a minute ≈ score of 100

const GLYPHS = {
  circle: '<circle cx="12" cy="12" r="7"/>',
  diamond: '<path d="M12 4l8 8-8 8-8-8z"/>',
  triangle: '<path d="M12 5l8 14H4z"/>',
  square: '<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  star: '<path d="M12 4l2.2 5.3 5.8.4-4.4 3.7 1.4 5.6-5-3-5 3 1.4-5.6L4 9.7l5.8-.4z"/>',
  wave: '<path d="M4 12c2.7-5 5.3-5 8 0s5.3 5 8 0"/>',
  hourglass: '<path d="M6 4h12l-6 8 6 8H6l6-8z"/>',
  ring: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.6"/>',
};

const glyphSvg = (name, size = 24) =>
  svg(`<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true">${GLYPHS[name]}</svg>`);

export default {
  id: 'speed',
  domain: 'Processing speed',
  title: 'Cipher',
  blurb: 'Translate symbols to digits, fast.',
  minutes: 1,
  levels: { min: 1, max: 4, start: 1 },
  levelLabel: (n) => `${5 + n} symbols`,
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/></svg>`,
  science:
    'Digit-symbol coding is the classic clinical measure of processing speed, and speed-of-processing ' +
    'training is one of the few interventions with durable gains in large trials (ACTIVE study).',
  howTo: (level) => [
    `The key at the top pairs each of ${5 + level} symbols with a digit.`,
    'A symbol appears — answer with its digit, by key or by tap.',
    `Score as many as you can in ${SECONDS} seconds. Wrong answers cost you.`,
  ],

  mount(stage, { level, finish }) {
    const names = shuffle(Object.keys(GLYPHS)).slice(0, 5 + level);
    const codeOf = Object.fromEntries(names.map((n, i) => [n, i + 1]));
    let current = null;
    let correct = 0;
    let errors = 0;
    let ticker;

    const legend = el('div', { class: 'sp-legend' },
      names.map((n) => el('div', { class: 'sp-pair' }, glyphSvg(n, 20), el('b', {}, codeOf[n]))));
    const card = el('div', { class: 'sp-card' });
    const clock = meter();
    clock.set(1);
    const tallyBox = el('div', { class: 'stage-head' }, '0 solved');
    const pad = el('div', { class: 'sp-pad' },
      names.map((n) => el('button', { class: 'btn sp-digit', onclick: () => answer(codeOf[n]) }, codeOf[n])));
    stage.append(legend, clock.node, card, tallyBox, pad);

    function deal() {
      const next = shuffle(names.filter((n) => n !== current))[0];
      current = next;
      card.replaceChildren(glyphSvg(current, 72));
    }

    function answer(digit) {
      if (!current) return;
      const right = digit === codeOf[current];
      right ? correct++ : errors++;
      tallyBox.textContent = `${correct} solved${errors ? ` · ${errors} slips` : ''}`;
      card.animate(
        [{ transform: right ? 'scale(0.94)' : 'translateX(-5px)' }, { transform: 'none' }],
        { duration: 140, easing: 'ease-out' },
      );
      deal();
    }

    function start() {
      deal();
      const t0 = performance.now();
      ticker = setInterval(() => {
        const left = Math.max(0, SECONDS - (performance.now() - t0) / 1000);
        clock.set(left / SECONDS);
        if (left === 0) end();
      }, 100);
    }

    function end() {
      clearInterval(ticker);
      const net = Math.max(0, correct - errors);
      const attempted = correct + errors;
      const accuracy = attempted ? correct / attempted : 0;
      finish({
        score: Math.min(100, Math.round((net / TARGET) * 100)),
        notes: [`${correct} correct, ${errors} errors in ${SECONDS}s`],
        levelDelta: net >= TARGET && accuracy >= 0.9 ? 1 : accuracy < 0.7 ? -1 : 0,
      });
    }

    const onKey = (e) => {
      const digit = Number(e.key);
      if (digit >= 1 && digit <= names.length) answer(digit);
    };
    window.addEventListener('keydown', onKey);
    const cancelCount = countdown(stage, start);

    return () => {
      window.removeEventListener('keydown', onKey);
      clearInterval(ticker);
      cancelCount();
    };
  },
};

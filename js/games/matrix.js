/* Fluid reasoning — Raven-style matrix puzzles, generated procedurally.
   Each puzzle hides 1–3 rules (an attribute varying by row, column, or
   diagonal); the player infers them and completes the grid. */

import { el, svg, shuffle, pick } from '../ui.js';

const PUZZLES = 8;
const OPTIONS = 6;
const ATTRIBUTES = {
  shape: ['circle', 'square', 'triangle', 'diamond'],
  count: [1, 2, 3],
  fill: ['outline', 'solid', 'half'],
  size: [0.55, 0.75, 0.95],
};
const SPOTS = { 1: [[50, 50]], 2: [[34, 34], [66, 66]], 3: [[28, 28], [50, 50], [72, 72]] };

let gradientId = 0;

function shapeMarkup(shape, x, y, r, paint) {
  const p = `${paint} stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"`;
  switch (shape) {
    case 'circle': return `<circle cx="${x}" cy="${y}" r="${r}" ${p}/>`;
    case 'square': return `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" rx="2" ${p}/>`;
    case 'triangle': return `<polygon points="${x},${y - r} ${x + r * 0.9},${y + r * 0.7} ${x - r * 0.9},${y + r * 0.7}" ${p}/>`;
    case 'diamond': return `<polygon points="${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}" ${p}/>`;
  }
}

function cellSvg({ shape, count, fill, size }) {
  const id = `half-${gradientId++}`;
  const paint = {
    outline: 'fill="none"',
    solid: 'fill="currentColor"',
    half: `fill="url(#${id})"`,
  }[fill];
  const r = (count === 1 ? 24 : 15) * size;
  const marks = SPOTS[count].map(([x, y]) => shapeMarkup(shape, x, y, r, paint)).join('');
  return svg(`<svg viewBox="0 0 100 100" class="mx-cell-art" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="50%" stop-color="currentColor"/>
      <stop offset="50%" stop-color="transparent"/>
    </linearGradient></defs>${marks}</svg>`);
}

function generatePuzzle(level) {
  const ruleCount = [1, 2, 2, 3, 3][level - 1] ?? 3;
  const patterns = level >= 3 ? ['row', 'col', 'diag'] : ['row', 'col'];
  const ruled = shuffle(Object.keys(ATTRIBUTES)).slice(0, ruleCount);

  const rules = {};
  for (const attr of Object.keys(ATTRIBUTES)) {
    const values = shuffle(ATTRIBUTES[attr]).slice(0, 3);
    rules[attr] = ruled.includes(attr)
      ? { pattern: pick(patterns), values }
      : { pattern: 'fixed', values: [values[0]] };
  }

  const valueAt = (attr, row, col) => {
    const { pattern, values } = rules[attr];
    const i = { row, col, diag: (row + col) % 3, fixed: 0 }[pattern];
    return values[i % values.length];
  };
  const cellAt = (row, col) =>
    Object.fromEntries(Object.keys(ATTRIBUTES).map((a) => [a, valueAt(a, row, col)]));

  const grid = [];
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++) grid.push(cellAt(row, col));

  const answer = grid.pop();
  const key = (c) => Object.values(c).join('|');
  const seen = new Set([key(answer)]);
  const options = [answer];
  while (options.length < OPTIONS) {
    const mutant = { ...answer };
    const attr = pick(ruled.length ? ruled : Object.keys(ATTRIBUTES));
    mutant[attr] = pick(ATTRIBUTES[attr].filter((v) => v !== answer[attr]));
    if (Math.random() < 0.4) {
      const other = pick(Object.keys(ATTRIBUTES).filter((a) => a !== attr));
      mutant[other] = pick(ATTRIBUTES[other].filter((v) => v !== answer[other]));
    }
    if (!seen.has(key(mutant))) {
      seen.add(key(mutant));
      options.push(mutant);
    }
  }
  return { grid, answer, options: shuffle(options) };
}

export default {
  id: 'matrix',
  domain: 'Fluid reasoning',
  title: 'Matrices',
  blurb: 'Find the rule. Complete the pattern.',
  minutes: 4,
  levels: { min: 1, max: 5, start: 1 },
  levelLabel: (n) => `Depth ${n}`,
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6.5" cy="6.5" r="2.6"/><rect x="14.5" y="4" width="5.2" height="5.2" rx="1"/><rect x="4" y="14.5" width="5.2" height="5.2" rx="1"/><path d="M17 14.4v5.2M14.4 17h5.2"/></svg>`,
  science:
    'Matrix problems are how fluid intelligence is measured (Raven’s Progressive Matrices). ' +
    'Practicing relational rule-finding builds the exact skill the measure rewards: abstraction under novelty.',
  howTo: () => [
    'Eight puzzles. Each 3×3 grid follows hidden rules across its rows, columns, or diagonals.',
    'Work out what belongs in the empty cell, then choose it from the six candidates.',
    'There is no clock — accuracy is everything.',
  ],

  mount(stage, { level, finish }) {
    let round = 0;
    let correct = 0;
    let timer;

    const dots = Array.from({ length: PUZZLES }, () => el('span', { class: 'dot' }));
    stage.append(el('div', { class: 'stage-head' }, el('div', { class: 'dots' }, dots)));
    const board = el('div', { class: 'mx-board' });
    stage.append(board);

    function next() {
      if (round === PUZZLES) {
        return finish({
          score: Math.round((correct / PUZZLES) * 100),
          notes: [`${correct} of ${PUZZLES} patterns solved`],
          levelDelta: correct >= 7 ? 1 : correct <= 3 ? -1 : 0,
        });
      }
      const { grid, answer, options } = generatePuzzle(level);
      let locked = false;

      const optionButtons = options.map((option) =>
        el('button', {
          class: 'mx-option',
          onclick: (e) => {
            if (locked) return;
            locked = true;
            const right = option === answer;
            if (right) correct++;
            e.currentTarget.classList.add(right ? 'is-good' : 'is-bad');
            if (!right) optionButtons[options.indexOf(answer)].classList.add('is-good');
            dots[round].classList.add(right ? 'is-good' : 'is-bad');
            round++;
            timer = setTimeout(next, right ? 650 : 1400);
          },
        }, cellSvg(option)),
      );

      board.replaceChildren(
        el('div', { class: 'mx-grid' },
          grid.map((cell) => el('div', { class: 'mx-tile' }, cellSvg(cell))),
          el('div', { class: 'mx-tile mx-missing' }, '?'),
        ),
        el('div', { class: 'mx-options' }, optionButtons),
      );
    }

    next();
    return () => clearTimeout(timer);
  },
};

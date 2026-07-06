/* Tiny DOM toolkit: hyperscript, SVG parsing, and the two charts the app uses
   (sparkline + score ring). No dependencies. */

/** el('button', { class: 'btn', onclick }, 'Start') */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return node;
}

/** Parse an SVG markup string into a live element. */
export function svg(markup) {
  const box = document.createElement('div');
  box.innerHTML = markup.trim();
  return box.firstElementChild;
}

export const shuffle = (array) => {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const pick = (array) => array[Math.floor(Math.random() * array.length)];
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Recent scores (0–100) as a 2px line in currentColor, end-dot ringed with
    the card surface so it stays legible over the line. */
export function sparkline(values, width = 132, height = 36) {
  const shown = values.slice(-14);
  if (shown.length < 2) {
    return svg(`<svg class="spark" width="${width}" height="${height}" aria-hidden="true">
      <line x1="4" y1="${height / 2}" x2="${width - 4}" y2="${height / 2}"
        stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-dasharray="1 6" opacity="0.45"/></svg>`);
  }
  const pad = 5;
  const x = (i) => pad + (i / (shown.length - 1)) * (width - pad * 2);
  const y = (v) => height - pad - (v / 100) * (height - pad * 2);
  const points = shown.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const [lx, ly] = [x(shown.length - 1), y(shown.at(-1))];
  return svg(`<svg class="spark" width="${width}" height="${height}"
      role="img" aria-label="Recent scores: ${shown.join(', ')}">
    <polyline points="${points}" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${lx}" cy="${ly}" r="3" fill="currentColor"
      stroke="var(--card)" stroke-width="2"/>
  </svg>`);
}

/** Radial progress ring; returns the element plus a setter to animate it. */
export function ring(size, stroke, fraction = 0) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const node = svg(`<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"
      class="ring" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none"
      stroke="var(--hairline)" stroke-width="${stroke}"/>
    <circle class="ring-fg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none"
      stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c}"
      transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`);
  const fg = node.querySelector('.ring-fg');
  const set = (f) => fg.style.setProperty('stroke-dashoffset', c * (1 - clamp(f, 0, 1)));
  set(fraction);
  return { node, set };
}

/** Animated score dial for the results screen. */
export function scoreRing(score) {
  const { node, set } = ring(148, 9);
  const value = el('span', { class: 'dial-value' }, '0');
  const dial = el('div', { class: 'dial', role: 'img', 'aria-label': `Score ${score} out of 100` },
    node, value);
  requestAnimationFrame(() => {
    set(score / 100);
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 900);
      value.textContent = Math.round(score * (1 - (1 - p) ** 3));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  return dial;
}

/** 3·2·1 overlay before timed drills. Returns a cancel function. */
export function countdown(stage, onDone) {
  const digit = el('span', { class: 'count-digit' }, '3');
  const veil = el('div', { class: 'count-veil' }, digit);
  stage.append(veil);
  let n = 3;
  const timer = setInterval(() => {
    if (--n === 0) {
      clearInterval(timer);
      veil.remove();
      onDone();
    } else {
      digit.textContent = n;
      digit.animate([{ opacity: 0.2, transform: 'scale(1.3)' }, { opacity: 1, transform: 'scale(1)' }],
        { duration: 240, easing: 'ease-out' });
    }
  }, 700);
  return () => { clearInterval(timer); veil.remove(); };
}

// A piano keyboard (SVG) that shows a voicing and can be tapped.

const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
const LOW = 36; // C2
const HIGH = 84; // C6
const WHITE_W = 20;
const WHITE_H = 92;
const BLACK_W = 12;
const BLACK_H = 58;

export const VOICE_COLORS = ['#2f5fa8', '#2f7d3a', '#b0601e', '#a1271b']; // B, T, A, S
const VOICE_LETTERS = ['B', 'T', 'A', 'S'];

const isWhite = (m) => WHITE_PCS.includes(((m % 12) + 12) % 12);

/**
 * @param {HTMLElement} container
 * @param {{ current: (number|null)[], previous?: (number|null)[], onKey?: (midi:number)=>void, label?: (midi:number)=>string }} data
 *        current/previous: midi numbers for [bass, tenor, alto, soprano]
 */
export function renderKeyboard(container, { current = [], previous = [], onKey }) {
  const keys = [];
  let x = 0;
  for (let m = LOW; m <= HIGH; m++) {
    if (isWhite(m)) {
      keys.push({ m, white: true, x, w: WHITE_W, h: WHITE_H });
      x += WHITE_W;
    }
  }
  for (let m = LOW; m <= HIGH; m++) {
    if (!isWhite(m)) {
      const left = keys.find((k) => k.m === m - 1);
      keys.push({ m, white: false, x: left.x + WHITE_W - BLACK_W / 2, w: BLACK_W, h: BLACK_H });
    }
  }
  const width = x;
  const parts = [];
  for (const k of keys) {
    const fill = k.white ? '#fffdf8' : '#2b2724';
    parts.push(`<rect data-midi="${k.m}" x="${k.x + 0.5}" y="0.5" width="${k.w - 1}" height="${k.h}" rx="2" fill="${fill}" stroke="#8a8278" stroke-width="1"/>`);
    if (k.white && k.m % 12 === 0) {
      parts.push(`<text x="${k.x + k.w / 2}" y="${k.h - 6}" font-size="8" text-anchor="middle" fill="#8a8278" pointer-events="none">C${k.m / 12 - 1}</text>`);
    }
  }
  const markFor = (midiNum, v, prev) => {
    const k = keys.find((kk) => kk.m === midiNum);
    if (!k) return '';
    const cx = k.x + k.w / 2;
    const cy = k.white ? k.h - 22 : k.h - 13;
    if (prev) return `<circle cx="${cx}" cy="${k.white ? 14 : 12}" r="4.5" fill="none" stroke="${VOICE_COLORS[v]}" stroke-width="1.6" opacity=".75" pointer-events="none"/>`;
    return `<g pointer-events="none"><circle cx="${cx}" cy="${cy}" r="7.5" fill="${VOICE_COLORS[v]}"/><text x="${cx}" y="${cy + 3.5}" font-size="10" font-weight="700" text-anchor="middle" fill="#fff">${VOICE_LETTERS[v]}</text></g>`;
  };
  previous.forEach((m, v) => { if (m != null) parts.push(markFor(m, v, true)); });
  current.forEach((m, v) => { if (m != null) parts.push(markFor(m, v, false)); });

  container.innerHTML = `<svg class="keyboard" viewBox="0 0 ${width} ${WHITE_H + 1}" role="img" aria-label="Piano keyboard showing the voicing">${parts.join('')}</svg>`;
  // On narrow screens, start scrolled to the middle of the keyboard (once).
  if (!container.dataset.centered && container.scrollWidth > container.clientWidth) {
    container.scrollLeft = (container.scrollWidth - container.clientWidth) / 2;
    container.dataset.centered = '1';
  }
  if (onKey) {
    const svg = container.querySelector('svg');
    svg.style.cursor = 'pointer';
    svg.addEventListener('click', (e) => {
      // Black keys are drawn last, so the topmost rect under the pointer is the right key.
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const m = el?.dataset?.midi;
      if (m) onKey(Number(m));
    });
  }
}

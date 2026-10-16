// Parsing a whole bass line typed in one go.
//
// Items are separated by spaces. Each item is a bass note with optional extras:
//   C        bass C (accidental from the key signature), current note value, blank figures
//   F#3      F sharp in octave 3 (n = natural, b = flat, # or x = sharp / double sharp)
//   G/h      half note (/8 eighth, /q quarter, /h half)
//   D:6/4/3  figures after a colon; use / or , between stacked figures (E:7,#)
//   G/h:6/4-5/3   everything together
//   r  r/h   a rest

import { LETTERS } from './pitch.js';
import { parseFigures } from './figures.js';

const ITEM = /^([A-Ga-g])([#b♯♭xn♮]*)([1-7])?(?:\/(8|q|h))?(?::(.*))?$/;
const REST = /^[rR](?:\/(8|q|h))?$/;

function accidentalOf(text) {
  if (!text) return null; // from the key signature
  let acc = 0;
  for (const ch of text) {
    if (ch === '#' || ch === '♯') acc += 1;
    else if (ch === 'b' || ch === '♭') acc -= 1;
    else if (ch === 'x') acc += 2;
    else if (ch === 'n' || ch === '♮') acc += 0;
  }
  return acc;
}

/**
 * @returns {Array<{raw:string, rest:boolean, letter?:number, acc?:number|null, octave?:number|null,
 *                  duration:string|null, figures:string, error?:string}>}
 */
export function parseLine(text) {
  const tokens = (text || '').trim().split(/\s+/).filter(Boolean);
  return tokens.map((raw) => {
    const rest = REST.exec(raw);
    if (rest) return { raw, rest: true, duration: rest[1] ?? null, figures: '' };
    const m = ITEM.exec(raw);
    if (!m) return { raw, rest: false, duration: null, figures: '', error: `Can't read "${raw}". Write a note like C, F#3, G/h or D:6/4/3.` };
    const figures = (m[5] ?? '').replace(/,/g, ' ').trim();
    const parsed = parseFigures(figures);
    return {
      raw,
      rest: false,
      letter: LETTERS.indexOf(m[1].toUpperCase()),
      acc: accidentalOf(m[2]),
      octave: m[3] ? Number(m[3]) : null,
      duration: m[4] ?? null,
      figures,
      error: parsed.error ? `"${raw}": ${parsed.error}` : undefined,
    };
  });
}

/** Rebuild one item's text, e.g. after figures were suggested. */
export function formatItem(item) {
  if (item.rest) return `r${item.duration ? '/' + item.duration : ''}`;
  const base = item.raw.split(':')[0];
  return item.figures ? `${base}:${item.figures.replace(/\s+/g, ',')}` : base;
}

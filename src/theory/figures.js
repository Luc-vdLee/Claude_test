// Parsing figured-bass figures.
//
// Syntax (spaces, "/" and "," separate stacked figures; "-" separates figures
// that follow each other over one bass note, as in a suspension):
//   6   6/4   64   7   6/5   4/3   4/2   2       inversions and sevenths
//   #   b   n (♮)                               a lone accidental alters the 3rd
//   #6  b7  n6   6#  6+  6\                     altered figures (+ and \ = raised / slashed)
//   4-3   9-8   7-6   6/4-5/3   7 4-3           suspensions and other linear figures
//
// Accidentals raise or lower the note given by the key signature by a
// semitone ("#" on a B♭ gives B♮), as in historical practice; "n"/"♮" makes
// the note natural.

const ALTER_OF = { '#': 'raise', b: 'lower', n: 'natural', '+': 'raise', '\\': 'raise' };

function normalize(input) {
  return (input || '')
    .replace(/♯/g, '#')
    .replace(/♭/g, 'b')
    .replace(/♮/g, 'n')
    .replace(/[–—−]/g, '-')
    .trim();
}

/** Parse one vertical stack of figures, e.g. "#6 4 3". */
function parseStack(text) {
  const items = [];
  let pending = null; // prefix accidental waiting for its digit
  let prevWasDigit = false;

  const flushLone = () => {
    if (pending) items.push({ num: 3, alter: pending, lone: true });
    pending = null;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/[\s/,]/.test(ch)) {
      flushLone();
      prevWasDigit = false;
    } else if (ch === '#' || ch === 'b' || ch === 'n') {
      const next = text[i + 1];
      const nextIsDigit = next !== undefined && /[0-9]/.test(next);
      if (prevWasDigit && !nextIsDigit && !items[items.length - 1].alter) {
        // postfix: "6#"
        items[items.length - 1].alter = ALTER_OF[ch];
      } else {
        flushLone();
        pending = ALTER_OF[ch];
      }
      prevWasDigit = false;
    } else if (ch === '+' || ch === '\\') {
      if (!prevWasDigit) return { error: `"${ch}" must follow a figure, as in 6+ or 4+.` };
      items[items.length - 1].alter = 'raise';
      prevWasDigit = false;
    } else if (/[0-9]/.test(ch)) {
      const num = Number(ch);
      if (num < 2) return { error: `"${ch}" is not a figure. Figures count up from the bass: 2 to 9.` };
      items.push({ num, alter: pending, lone: false });
      pending = null;
      prevWasDigit = true;
    } else {
      return { error: `Don't know how to read "${ch}". Use digits 2-9, #, b, n (natural), +, / and -.` };
    }
  }
  flushLone();

  // Merge duplicates (e.g. "# 3" or "6 #6"): keep the one with an accidental.
  const byNum = new Map();
  for (const it of items) {
    const prev = byNum.get(it.num);
    if (!prev || (!prev.alter && it.alter)) byNum.set(it.num, it);
  }
  return { items: [...byNum.values()] };
}

/** Fill in the figures that are understood but not written. */
export function completeFigures(items) {
  const out = items.map((it) => ({ ...it, implicit: false }));
  const has = (n) => out.some((it) => it.num === n);
  const add = (n) => { if (!has(n)) out.push({ num: n, alter: null, lone: false, implicit: true }); };

  if (out.length === 0) { add(5); add(3); }
  if (has(2) && !has(3) && !has(5)) { add(4); add(6); }          // 2, 4/2 -> 6/4/2
  if (has(4) && has(3)) add(6);                                   // 4/3 -> 6/4/3
  if (has(6) && has(5)) add(3);                                   // 6/5 -> 6/5/3
  if (has(6) && !has(4) && !has(5) && !has(2)) add(3);            // 6 -> 6/3
  if (!has(6) && !has(2)) {                                       // triads, 7, 9, 5/4 ...
    add(5);
    if (!has(4)) add(3);
  }
  return out.sort((a, b) => b.num - a.num);
}

/**
 * Parse a figure string into stages (one stage per chord over the same bass).
 * Returns { stages: [[{num, alter, lone, implicit}]], written: [[...]] } or { error }.
 */
export function parseFigures(input) {
  const text = normalize(input);
  const parts = text.length ? text.split('-').map((s) => s.trim()) : [''];
  if (parts.length > 1 && parts.some((p) => p === '')) {
    return { error: 'A "-" needs figures on both sides, as in 4-3 or 6/4-5/3.' };
  }

  const written = [];
  for (const part of parts) {
    const res = parseStack(part);
    if (res.error) return { error: res.error };
    written.push(res.items);
  }

  // Figures not continued by a later stage are held over, so "5 4-3" means 5/4 then 5/3
  // and "7 4-3" means 7/4 then 7/3.
  const stacks = [written[0]];
  for (let i = 1; i < written.length; i++) {
    const prev = stacks[i - 1];
    const cur = [...written[i]];
    if (cur.length < prev.length) {
      for (const it of prev) {
        const continued = cur.some((c) => Math.abs(c.num - it.num) <= 1 || c.num === it.num);
        if (!continued) cur.push({ ...it });
      }
    }
    stacks.push(cur);
  }

  return { stages: stacks.map(completeFigures), written };
}

const ALTER_SYMBOL = { raise: '♯', lower: '♭', natural: '♮' };

/** Display a written figure stack as lines (top to bottom), e.g. ["♯6", "4", "3"]. */
export function figureLines(items) {
  const sorted = [...items].sort((a, b) => b.num - a.num);
  return sorted.map((it) => (it.lone ? ALTER_SYMBOL[it.alter] : (it.alter ? ALTER_SYMBOL[it.alter] : '') + it.num));
}

// Spelled pitches: a note is { letter: 0-6 (C..B), acc: semitone offset }.
// With an octave ({ letter, acc, octave }) it is a concrete pitch.

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
export const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];

const mod = (n, m) => ((n % m) + m) % m;

export function pc(note) {
  return mod(NATURAL_PC[note.letter] + note.acc, 12);
}

export function midi(note) {
  return 12 * (note.octave + 1) + NATURAL_PC[note.letter] + note.acc;
}

export function sameSpelling(a, b) {
  return a.letter === b.letter && a.acc === b.acc;
}

export function spellingKey(note) {
  return `${note.letter}:${note.acc}`;
}

/** The note on `letter` whose pitch class is `targetPc`. */
export function spellOnLetter(letter, targetPc) {
  const l = mod(letter, 7);
  let acc = mod(targetPc - NATURAL_PC[l], 12);
  if (acc > 6) acc -= 12;
  return { letter: l, acc };
}

/** Upward simple interval: letter steps (0-6) and semitones (0-11). */
export function intervalUp(from, to) {
  return { steps: mod(to.letter - from.letter, 7), semis: mod(pc(to) - pc(from), 12) };
}

/** The octave a given midi number has when spelled on `letter` with `acc`. */
export function withOctave(note, midiNumber) {
  const octave = Math.round((midiNumber - NATURAL_PC[note.letter] - note.acc) / 12) - 1;
  return { letter: note.letter, acc: note.acc, octave };
}

/** Parse "F#", "Bb", "C", "Ebb", "Fx" (also with ♯/♭). */
export function parseNote(str) {
  const m = /^([A-Ga-g])(.*)$/.exec(str.trim());
  if (!m) throw new Error(`Not a note: ${str}`);
  const letter = LETTERS.indexOf(m[1].toUpperCase());
  let acc = 0;
  for (const ch of m[2]) {
    if (ch === '#' || ch === '♯') acc += 1;
    else if (ch === 'b' || ch === '♭') acc -= 1;
    else if (ch === 'x' || ch === '𝄪') acc += 2;
    else throw new Error(`Not a note: ${str}`);
  }
  return { letter, acc };
}

const ACC_SYMBOLS = { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' };

export function accidentalSymbol(acc) {
  return ACC_SYMBOLS[acc] ?? (acc > 0 ? '♯'.repeat(acc) : '♭'.repeat(-acc));
}

function solfegeStyleName(letterName, acc) {
  // Dutch/German: -is for sharps, -es for flats (Es and As instead of Ees, Aes).
  if (acc > 0) return letterName + 'is'.repeat(acc);
  if (acc < 0) {
    if (letterName === 'E' || letterName === 'A') return letterName + 's' + 'es'.repeat(-acc - 1);
    return letterName + 'es'.repeat(-acc);
  }
  return letterName;
}

/**
 * Note name in one of the naming systems:
 *  - english: C♯, B♭, B
 *  - german:  Cis, B (=B♭), H (=B)
 *  - dutch:   Cis, Bes, B
 */
export function noteName(note, system = 'english') {
  const letterName = LETTERS[note.letter];
  if (system === 'german') {
    if (letterName === 'B') {
      if (note.acc === -1) return 'B';
      if (note.acc === -2) return 'Heses';
      return solfegeStyleName('H', note.acc);
    }
    return solfegeStyleName(letterName, note.acc);
  }
  if (system === 'dutch') return solfegeStyleName(letterName, note.acc);
  return letterName + accidentalSymbol(note.acc);
}

/** Name with octave number (scientific pitch notation), e.g. "F♯4". */
export function pitchName(note, system = 'english') {
  return noteName(note, system) + note.octave;
}

const SIMPLE_NAMES = ['unison', '2nd', '3rd', '4th', '5th', '6th', '7th'];
const MAJOR_SCALE = NATURAL_PC;

/** Name of the interval between two concrete pitches, e.g. "M2", "P5", "A4". */
export function intervalName(lower, upper) {
  let a = lower;
  let b = upper;
  if (midi(b) < midi(a) || (midi(b) === midi(a) && b.octave * 7 + b.letter < a.octave * 7 + a.letter)) [a, b] = [b, a];
  const steps = (b.octave * 7 + b.letter) - (a.octave * 7 + a.letter);
  const semis = midi(b) - midi(a);
  const simple = mod(steps, 7);
  const octaves = Math.floor(steps / 7);
  const expected = MAJOR_SCALE[simple] + 12 * octaves;
  const diff = semis - expected;
  const perfect = simple === 0 || simple === 3 || simple === 4;
  let quality;
  if (perfect) quality = diff === 0 ? 'P' : diff > 0 ? 'A'.repeat(diff) : 'd'.repeat(-diff);
  else quality = diff === 0 ? 'M' : diff === -1 ? 'm' : diff > 0 ? 'A'.repeat(diff) : 'd'.repeat(-diff - 1);
  return { short: `${quality}${steps + 1}`, quality, number: steps + 1, steps, semis, simpleName: SIMPLE_NAMES[simple] };
}

// Music theory core: notes, intervals, inversions and transposition.
// Pure functions with no DOM access, so they run in the browser and in Node tests.

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

// Semitones above C for each natural letter.
const NATURAL_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

// Semitones in the perfect (1, 4, 5) or major (2, 3, 6, 7) form of each simple interval.
const BASE_SEMITONES = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 };
const PERFECT_NUMBERS = new Set([1, 4, 5]);

// Offset from the base size for each quality.
const PERFECT_OFFSETS = { dd: -2, d: -1, P: 0, A: 1, AA: 2 };
const MAJOR_OFFSETS = { dd: -3, d: -2, m: -1, M: 0, A: 1, AA: 2 };

export const QUALITY_NAMES = {
  P: 'perfect',
  M: 'major',
  m: 'minor',
  A: 'augmented',
  d: 'diminished',
  AA: 'doubly augmented',
  dd: 'doubly diminished',
};

const INVERTED_QUALITY = { P: 'P', M: 'm', m: 'M', A: 'd', d: 'A', AA: 'dd', dd: 'AA' };

const NUMBER_NAMES = [
  'unison', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'octave',
  'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'double octave',
];

const ACCIDENTAL_SYMBOLS = { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' };
const ACCIDENTAL_INPUT = {
  '': 0, '♮': 0, b: -1, '♭': -1, bb: -2, '♭♭': -2, '𝄫': -2,
  '#': 1, '♯': 1, '##': 2, '♯♯': 2, x: 2, '𝄪': 2,
};

/** Build a note. accidental: -2 (double flat) to 2 (double sharp). */
export function note(letter, accidental = 0, octave = 4) {
  if (!LETTERS.includes(letter)) throw new Error(`Unknown letter: ${letter}`);
  if (!Number.isInteger(accidental) || accidental < -2 || accidental > 2) {
    throw new Error(`Accidental must be an integer from -2 to 2, got ${accidental}`);
  }
  return { letter, accidental, octave };
}

/** Parse strings like "C4", "F#3", "Bb5", "Ebb4", "Gx2", "A♭4". */
export function parseNote(text) {
  const match = /^([A-Ga-g])(bb|b|##|#|x|♭♭|♭|♯♯|♯|𝄫|𝄪|♮)?(-?\d+)$/u.exec(text.trim());
  if (!match) throw new Error(`Can't read note: "${text}"`);
  const [, letter, acc = '', octave] = match;
  return note(letter.toUpperCase(), ACCIDENTAL_INPUT[acc], Number(octave));
}

export function accidentalSymbol(accidental) {
  return ACCIDENTAL_SYMBOLS[accidental];
}

/** "C♯4", or "C♯" when withOctave is false. */
export function noteName(n, withOctave = true) {
  return n.letter + accidentalSymbol(n.accidental) + (withOctave ? n.octave : '');
}

/** MIDI number: C4 = 60, A4 = 69. */
export function midi(n) {
  return 12 * (n.octave + 1) + NATURAL_SEMITONES[LETTERS.indexOf(n.letter)] + n.accidental;
}

/** Frequency in Hz with A4 = 440. */
export function frequency(n) {
  return 440 * 2 ** ((midi(n) - 69) / 12);
}

/** Position on the staff: counts letter names, ignoring accidentals. */
function staffPosition(n) {
  return n.octave * 7 + LETTERS.indexOf(n.letter);
}

export function intervalNumberName(number) {
  if (number <= NUMBER_NAMES.length) return NUMBER_NAMES[number - 1];
  const tens = number % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[number % 10] ?? 'th';
  return `${number}${suffix}`;
}

function qualityFor(simpleNumber, offset) {
  const table = PERFECT_NUMBERS.has(simpleNumber) ? PERFECT_OFFSETS : MAJOR_OFFSETS;
  return Object.keys(table).find((q) => table[q] === offset) ?? null;
}

/** Perfect consonance, imperfect consonance or dissonance (common-practice harmony). */
export function consonance(simpleNumber, quality) {
  if (quality === 'P' && [1, 4, 5].includes(simpleNumber)) return 'perfect';
  if ((quality === 'M' || quality === 'm') && (simpleNumber === 3 || simpleNumber === 6)) return 'imperfect';
  return 'dissonant';
}

function describe(number, quality) {
  const simpleNumber = ((number - 1) % 7) + 1;
  return {
    number,
    simpleNumber,
    quality,
    shortName: quality ? `${quality}${number}` : `?${number}`,
    name: quality ? `${QUALITY_NAMES[quality]} ${intervalNumberName(number)}` : `unusual ${intervalNumberName(number)}`,
  };
}

/**
 * The interval between two notes, measured from the lower to the higher one.
 * Size is counted in letter names (C up to G = C D E F G = a fifth);
 * quality comes from comparing the semitone count with the perfect/major size.
 */
export function interval(first, second) {
  let lower = first;
  let upper = second;
  const posDiff = staffPosition(second) - staffPosition(first);
  const descending = posDiff < 0 || (posDiff === 0 && midi(second) < midi(first));
  if (descending) [lower, upper] = [second, first];

  const number = staffPosition(upper) - staffPosition(lower) + 1;
  const semitones = midi(upper) - midi(lower);
  const simpleNumber = ((number - 1) % 7) + 1;
  const octaves = Math.floor((number - 1) / 7);
  const simpleSemitones = semitones - 12 * octaves;
  const baseSemitones = BASE_SEMITONES[simpleNumber];
  const quality = qualityFor(simpleNumber, simpleSemitones - baseSemitones);

  const letters = [];
  const start = LETTERS.indexOf(lower.letter);
  for (let i = 0; i < number; i++) letters.push(LETTERS[(start + i) % 7]);

  return {
    ...describe(number, quality),
    semitones,
    octaves,
    baseSemitones: baseSemitones + 12 * octaves,
    isPerfectType: PERFECT_NUMBERS.has(simpleNumber),
    direction: number === 1 && semitones === 0 ? 'same' : descending ? 'descending' : 'ascending',
    lower,
    upper,
    letters,
    consonance: quality ? consonance(simpleNumber, quality) : 'dissonant',
    isTritone: simpleSemitones === 6 && (quality === 'A' || quality === 'd'),
    inversion: quality ? invert(number, quality) : null,
  };
}

/** Inversion of the simple part: thirds become sixths, major becomes minor, and so on. */
export function invert(number, quality) {
  const simpleNumber = ((number - 1) % 7) + 1;
  let inverted;
  if (simpleNumber === 1) inverted = number === 1 ? 8 : 1;
  else inverted = 9 - simpleNumber;
  return describe(inverted, INVERTED_QUALITY[quality]);
}

/**
 * The note an interval above `from`, spelled correctly (E + major third = G♯, not A♭).
 * Returns null when the result would need more than a double sharp or flat.
 */
export function transpose(from, number, quality) {
  const simpleNumber = ((number - 1) % 7) + 1;
  const table = PERFECT_NUMBERS.has(simpleNumber) ? PERFECT_OFFSETS : MAJOR_OFFSETS;
  if (!(quality in table)) {
    throw new Error(`A ${intervalNumberName(simpleNumber)} can't be ${QUALITY_NAMES[quality] ?? quality}`);
  }
  const octaves = Math.floor((number - 1) / 7);
  const semitones = BASE_SEMITONES[simpleNumber] + table[quality] + 12 * octaves;

  const step = LETTERS.indexOf(from.letter) + number - 1;
  const letter = LETTERS[step % 7];
  const octave = from.octave + Math.floor(step / 7);
  const accidental = midi(from) + semitones - midi({ letter, accidental: 0, octave });
  if (accidental < -2 || accidental > 2) return null;
  return note(letter, accidental, octave);
}

/** The simple intervals most people learn first, smallest to largest. */
export const COMMON_INTERVALS = [
  [1, 'P'], [2, 'm'], [2, 'M'], [3, 'm'], [3, 'M'], [4, 'P'], [4, 'A'],
  [5, 'd'], [5, 'P'], [6, 'm'], [6, 'M'], [7, 'm'], [7, 'M'], [8, 'P'],
].map(([number, quality]) => {
  const simple = ((number - 1) % 7) + 1;
  const table = PERFECT_NUMBERS.has(simple) ? PERFECT_OFFSETS : MAJOR_OFFSETS;
  return {
    ...describe(number, quality),
    semitones: BASE_SEMITONES[simple] + table[quality] + (number > 7 ? 12 : 0),
  };
});

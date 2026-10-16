import { pc, spellOnLetter, parseNote, noteName, LETTERS, sameSpelling } from './pitch.js';

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

/** Keys that have a standard key signature (at most 7 sharps or flats). */
export const KEY_TONICS = {
  major: ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'],
  minor: ['A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#', 'D', 'G', 'C', 'F', 'Bb', 'Eb', 'Ab'],
};

export function makeKey(tonic, mode = 'major') {
  return { tonic: typeof tonic === 'string' ? parseNote(tonic) : tonic, mode };
}

/** The note of the key signature on scale degree `degree` (0 = tonic). Minor uses natural minor. */
export function scaleNote(key, degree) {
  const steps = key.mode === 'major' ? MAJOR_STEPS : NATURAL_MINOR_STEPS;
  const d = ((degree % 7) + 7) % 7;
  return spellOnLetter(key.tonic.letter + d, (pc(key.tonic) + steps[d]) % 12);
}

/** Scale degree (0-6) of a letter in this key. */
export function degreeOfLetter(key, letter) {
  return (((letter - key.tonic.letter) % 7) + 7) % 7;
}

/** Accidental the key signature gives to a letter. */
export function signatureAcc(key, letter) {
  return scaleNote(key, degreeOfLetter(key, letter)).acc;
}

export function leadingTone(key) {
  return spellOnLetter(key.tonic.letter + 6, (pc(key.tonic) + 11) % 12);
}

/** Raised 6th degree (melodic minor); same as the diatonic 6th in major. */
export function raisedSixth(key) {
  return spellOnLetter(key.tonic.letter + 5, (pc(key.tonic) + 9) % 12);
}

/** Diatonic in the key (in minor, the raised 6th and 7th also count). */
export function isDiatonic(key, note) {
  if (sameSpelling(note, scaleNote(key, degreeOfLetter(key, note.letter)))) return true;
  if (key.mode === 'minor') return sameSpelling(note, leadingTone(key)) || sameSpelling(note, raisedSixth(key));
  return false;
}

const MODE_WORDS = {
  english: { major: 'major', minor: 'minor' },
  german: { major: 'Dur', minor: 'Moll' },
  dutch: { major: 'majeur', minor: 'mineur' },
};

export function keyName(key, system = 'english') {
  const tonic = noteName(key.tonic, system);
  if (system === 'german') return key.mode === 'major' ? `${tonic}-Dur` : `${tonic.toLowerCase()}-Moll`;
  if (system === 'dutch') return key.mode === 'major' ? `${tonic} ${MODE_WORDS.dutch.major}` : `${tonic.toLowerCase()} ${MODE_WORDS.dutch.minor}`;
  return `${tonic} ${MODE_WORDS.english[key.mode]}`;
}

/** Key-signature spec for VexFlow, e.g. "F#m" or "Bb". */
export function vexKeySpec(key) {
  const acc = key.tonic.acc > 0 ? '#'.repeat(key.tonic.acc) : 'b'.repeat(-key.tonic.acc);
  return LETTERS[key.tonic.letter] + acc + (key.mode === 'minor' ? 'm' : '');
}

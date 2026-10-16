// Suggesting figures with the Rule of the Octave.
//
// The Rule of the Octave gives each scale degree of a stepwise bass a standard
// harmony, different going up and coming down. Leaps get root position on
// 1, 4 and 5 and the rising-scale harmony elsewhere. A chromatically raised bass
// note is treated as a leading tone (6/5); a lowered one as the bass of a 4/2.

import { scaleNote, degreeOfLetter, leadingTone } from './key.js';

const RULE = {
  major: {
    up: ['', '6/4/3', '6', '6/5', '', '6', '6/5'],
    down: ['', '6/4/3', '6', '4/2', '', '#6/4/3', '6'],
  },
  minor: {
    up: ['', '#6/4/3', '6', '6/5', '#', '6', '6/5'],
    down: ['', '#6/4/3', '6', '#4/2', '#', '#6/4/3', '6'],
  },
};

const DEGREE_NAMES = ['1', '2', '3', '4', '5', '6', '7'];

function diatonicStep(a, b) {
  // +1 / -1 for a step up / down by letter, 0 otherwise
  const d = ((((b.letter - a.letter) % 7) + 7) % 7);
  if (d === 1) return 1;
  if (d === 6) return -1;
  return 0;
}

/**
 * @param {object} key
 * @param {{letter, acc}} bass
 * @param {{prev?: {letter, acc}, next?: {letter, acc}}} context  neighbouring bass notes
 * @returns {{ figures: string, reason: string }}
 */
export function suggestFigures(key, bass, { prev, next } = {}) {
  const degree = degreeOfLetter(key, bass.letter);
  const diatonic = scaleNote(key, degree);
  let diff = bass.acc - diatonic.acc;
  // In minor the raised 6th and 7th belong to the scale.
  if (key.mode === 'minor' && (degree === 5 || degree === 6) && diff === 1) diff = 0;

  if (diff > 0) return { figures: '6/5', reason: 'Raised bass note: treated as a leading tone (6/5 chord resolving up).' };
  if (diff < 0) return { figures: '4/2', reason: 'Lowered bass note: treated as the bass of a 4/2 chord resolving down.' };

  let direction = null;
  if (next) direction = diatonicStep(bass, next) || null;
  if (!direction && prev) direction = diatonicStep(prev, bass) || null;

  const deg = DEGREE_NAMES[degree];
  if (!direction) {
    if (degree === 0 || degree === 3 || degree === 4) {
      const figures = key.mode === 'minor' && degree === 4 ? '#' : '';
      return { figures, reason: `Rule of the Octave: ${deg}̂ is harmonized in root position.` };
    }
    return { figures: RULE[key.mode].up[degree], reason: `Rule of the Octave: ${deg}̂ (no stepwise motion, rising-scale harmony).` };
  }

  // Minor: the raised 7th rising, the natural 7th falling.
  if (key.mode === 'minor' && degree === 6) {
    const isLeading = bass.acc === leadingTone(key).acc;
    return isLeading
      ? { figures: '6/5', reason: 'Rule of the Octave: raised 7̂ (leading tone) takes 6/5.' }
      : { figures: '6', reason: 'Rule of the Octave: natural 7̂ falling takes 6.' };
  }
  const table = direction > 0 ? 'up' : 'down';
  return {
    figures: RULE[key.mode][table][degree],
    reason: `Rule of the Octave: ${deg}̂ ${direction > 0 ? 'rising' : 'falling'}.`,
  };
}


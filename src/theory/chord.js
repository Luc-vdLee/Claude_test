// Realizing figures above a bass, and naming the resulting chord.

import { intervalUp, pc, sameSpelling, spellingKey, spellOnLetter, noteName } from './pitch.js';
import { signatureAcc, degreeOfLetter, scaleNote, isDiatonic, leadingTone } from './key.js';

/** The notes the figures call for above `bass`, bass first. */
export function realize(key, bass, figures) {
  const notes = [{ ...bass, figure: 1, implicit: false, alter: null }];
  for (const f of figures) {
    const letter = (bass.letter + f.num - 1) % 7;
    let acc = letter === bass.letter ? bass.acc : signatureAcc(key, letter);
    if (f.alter === 'raise') acc += 1;
    else if (f.alter === 'lower') acc -= 1;
    else if (f.alter === 'natural') acc = 0;
    notes.push({ letter, acc, figure: f.num, implicit: f.implicit, alter: f.alter });
  }
  return notes;
}

/** Distinct pitch spellings, bass first. */
export function distinct(notes) {
  const seen = new Set();
  const out = [];
  for (const n of notes) {
    const k = spellingKey(n);
    if (!seen.has(k)) { seen.add(k); out.push(n); }
  }
  return out;
}

const MEMBER_BY_STEPS = { 0: 'root', 2: 'third', 4: 'fifth', 6: 'seventh' };

function findTertianRoot(notes) {
  for (const root of notes) {
    const members = new Map();
    let ok = true;
    for (const n of notes) {
      const { steps, semis } = intervalUp(root, n);
      const member = MEMBER_BY_STEPS[steps];
      if (!member || (members.has(member) && members.get(member).semis !== semis)) { ok = false; break; }
      members.set(member, { note: n, semis });
    }
    if (ok) return { root, members };
  }
  return null;
}

function qualityOf(members) {
  const third = members.get('third')?.semis;
  const fifth = members.get('fifth')?.semis;
  const seventh = members.get('seventh')?.semis;
  let triad;
  if (third === 4 && (fifth === 7 || fifth === undefined)) triad = 'major';
  else if (third === 3 && (fifth === 7 || fifth === undefined)) triad = 'minor';
  else if (third === 3 && fifth === 6) triad = 'diminished';
  else if (third === 4 && fifth === 8) triad = 'augmented';
  else if (third === undefined && fifth === 7) triad = 'open';
  else triad = 'other';
  if (seventh === undefined) return triad;
  const table = {
    major: { 10: 'dominant7', 11: 'major7' },
    minor: { 10: 'minor7', 11: 'minorMajor7' },
    diminished: { 9: 'diminished7', 10: 'halfDiminished7' },
    augmented: { 10: 'augmented7', 11: 'augmentedMajor7' },
  };
  return table[triad]?.[seventh] ?? 'other7';
}

export const QUALITY_INFO = {
  major: { symbol: '', long: 'major triad', numeral: 'upper', mark: '' },
  minor: { symbol: 'm', long: 'minor triad', numeral: 'lower', mark: '' },
  diminished: { symbol: 'dim', long: 'diminished triad', numeral: 'lower', mark: '°' },
  augmented: { symbol: '+', long: 'augmented triad', numeral: 'upper', mark: '+' },
  open: { symbol: '5', long: 'open fifth (no 3rd)', numeral: 'upper', mark: '' },
  other: { symbol: '?', long: 'altered triad', numeral: 'upper', mark: '' },
  dominant7: { symbol: '7', long: 'dominant 7th chord', numeral: 'upper', mark: '' },
  major7: { symbol: 'maj7', long: 'major 7th chord', numeral: 'upper', mark: '' },
  minor7: { symbol: 'm7', long: 'minor 7th chord', numeral: 'lower', mark: '' },
  minorMajor7: { symbol: 'm(maj7)', long: 'minor-major 7th chord', numeral: 'lower', mark: '' },
  halfDiminished7: { symbol: 'ø7', long: 'half-diminished 7th chord', numeral: 'lower', mark: 'ø' },
  diminished7: { symbol: '°7', long: 'diminished 7th chord', numeral: 'lower', mark: '°' },
  augmented7: { symbol: '+7', long: 'augmented 7th chord', numeral: 'upper', mark: '+' },
  augmentedMajor7: { symbol: '+maj7', long: 'augmented major 7th chord', numeral: 'upper', mark: '+' },
  other7: { symbol: '7?', long: 'altered 7th chord', numeral: 'upper', mark: '' },
};

const INVERSION_NAMES = ['root position', 'first inversion', 'second inversion', 'third inversion'];
const TRIAD_FIGS = [[], ['6'], ['6', '4']];
const SEVENTH_FIGS = [['7'], ['6', '5'], ['4', '3'], ['4', '2']];
const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

function numeralFor(key, root, quality) {
  const degree = degreeOfLetter(key, root.letter);
  const offset = (pc(root) - pc(key.tonic) + 12) % 12;
  const expected = (key.mode === 'major' ? MAJOR_STEPS : MINOR_STEPS)[degree];
  let diff = offset - expected;
  if (diff > 6) diff -= 12;
  if (diff < -6) diff += 12;
  // In minor the leading-tone chord (raised 7th) needs no accidental.
  if (key.mode === 'minor' && degree === 6 && diff === 1) diff = 0;
  const accidental = diff > 0 ? '♯'.repeat(diff) : diff < 0 ? '♭'.repeat(-diff) : '';
  const info = QUALITY_INFO[quality];
  const base = info.numeral === 'upper' ? NUMERALS[degree] : NUMERALS[degree].toLowerCase();
  return { accidental, base, mark: info.mark, degree };
}

// Diatonic triads that can be tonicized, by key mode and degree.
const TONICIZABLE = {
  major: { 1: 'ii', 2: 'iii', 3: 'IV', 4: 'V', 5: 'vi' },
  minor: { 2: 'III', 3: 'iv', 4: 'V', 5: 'VI', 6: 'VII' },
};

function secondaryTarget(key, root, quality, chromatic) {
  const dominantLike = quality === 'major' || quality === 'dominant7';
  const leadingLike = quality === 'diminished' || quality === 'diminished7' || quality === 'halfDiminished7';
  if (!dominantLike && !leadingLike) return null;
  const rootDegree = degreeOfLetter(key, root.letter);
  // Plain V and vii° need no "of" label.
  if (dominantLike && rootDegree === 4 && sameSpelling(root, scaleNote(key, 4))) return null;
  if (leadingLike && sameSpelling(root, leadingTone(key))) return null;
  // Diatonic chords stay diatonic, except a dominant 7th off the 5th degree (e.g. VII7 in minor = V7/III).
  if (!chromatic && quality !== 'dominant7') return null;

  const target = dominantLike
    ? spellOnLetter(root.letter + 3, (pc(root) + 5) % 12)
    : spellOnLetter(root.letter + 1, (pc(root) + 1) % 12);
  const targetDegree = degreeOfLetter(key, target.letter);
  if (!sameSpelling(target, scaleNote(key, targetDegree))) return null;
  const label = TONICIZABLE[key.mode][targetDegree];
  if (!label) return null;
  return { target, label, prefix: dominantLike ? 'V' : 'vii' };
}

function detectAugmentedSixth(notes) {
  for (const low of notes) {
    for (const high of notes) {
      const { steps, semis } = intervalUp(low, high);
      if (steps !== 5 || semis !== 10) continue;
      const rel = notes.filter((n) => n !== low && n !== high).map((n) => ({ n, ...intervalUp(low, n) }));
      if (!rel.some((r) => r.steps === 2 && r.semis === 4)) continue;
      const others = rel.filter((r) => !(r.steps === 2 && r.semis === 4));
      if (others.length === 0) return { kind: 'It', low, high };
      if (others.length === 1) {
        const o = others[0];
        if (o.steps === 3 && o.semis === 6) return { kind: 'Fr', low, high };
        if (o.steps === 4 && o.semis === 7) return { kind: 'Ger', low, high };
        if (o.steps === 3 && o.semis === 7) return { kind: 'Ger', low, high, swiss: true };
      }
    }
  }
  return null;
}

const AUG6_NAMES = { It: 'Italian augmented 6th', Fr: 'French augmented 6th', Ger: 'German augmented 6th' };

/**
 * Analyze a set of spelled notes (bass first) in a key.
 * Returns a description with name, Roman numeral, chord members and tendency tones.
 */
export function analyze(key, notes) {
  const pitches = distinct(notes);
  const bass = pitches[0];
  const chromatic = pitches.some((n) => !isDiatonic(key, n));

  const aug6 = detectAugmentedSixth(pitches);
  if (aug6) {
    const roles = new Map(pitches.map((n) => [spellingKey(n), { member: 'other', tendency: 0 }]));
    roles.set(spellingKey(aug6.low), { member: 'aug6-low', tendency: -1 });
    roles.set(spellingKey(aug6.high), { member: 'aug6-high', tendency: 1 });
    for (const n of pitches) {
      const k = spellingKey(n);
      if (roles.get(k).member === 'other') roles.get(k).member = intervalUp(aug6.low, n).steps === 2 ? 'aug6-third' : 'aug6-other';
    }
    return {
      type: 'aug6',
      kind: aug6.kind,
      name: `${aug6.kind}+6`,
      longName: AUG6_NAMES[aug6.kind] + (aug6.swiss ? ' (spelled with a doubly augmented 4th)' : ''),
      inversion: null,
      numeral: { accidental: '', base: `${aug6.kind}`, mark: '+6', figs: [], of: null },
      pitches,
      roles,
      notes: [
        `The augmented 6th (${noteName(aug6.low)}–${noteName(aug6.high)}) expands outward by half steps to an octave, usually on the dominant.`,
        aug6.kind === 'Ger' ? 'Watch for parallel 5ths into V; going to a cadential 6/4 first avoids them.' : null,
      ].filter(Boolean),
      chromatic,
    };
  }

  const tert = findTertianRoot(pitches);
  if (!tert) {
    return { type: 'nontertian', name: null, pitches, roles: new Map(pitches.map((n) => [spellingKey(n), { member: 'other', tendency: 0 }])), chromatic, notes: [] };
  }

  const { root, members } = tert;
  const quality = qualityOf(members);
  const isSeventh = members.has('seventh');
  const bassMember = [...members.entries()].find(([, v]) => sameSpelling(v.note, bass))[0];
  const inversion = ['root', 'third', 'fifth', 'seventh'].indexOf(bassMember);
  const figs = isSeventh ? SEVENTH_FIGS[inversion] : TRIAD_FIGS[inversion] ?? [];
  const info = QUALITY_INFO[quality];

  const roles = new Map();
  for (const [member, { note }] of members) roles.set(spellingKey(note), { member, tendency: 0 });

  const remarks = [];
  let numeral;
  const degree = degreeOfLetter(key, root.letter);
  const isNeapolitan = quality === 'major' && degree === 1 && (pc(root) - pc(key.tonic) + 12) % 12 === 1;
  const secondary = isNeapolitan ? null : secondaryTarget(key, root, quality, chromatic);

  if (isNeapolitan) {
    numeral = { accidental: '', base: 'N', mark: '', figs, of: null };
    remarks.push(inversion === 1
      ? 'Neapolitan 6th: double the bass (the 3rd). The ♭2 usually moves down to the leading tone.'
      : 'Neapolitan chord (built on the lowered 2nd degree).');
  } else if (secondary) {
    numeral = { accidental: '', base: secondary.prefix, mark: info.mark, figs, of: secondary.label };
    const lt = spellOnLetter(secondary.target.letter + 6, (pc(secondary.target) + 11) % 12);
    const ltRole = roles.get(spellingKey(lt));
    if (ltRole) ltRole.tendency = 1;
    remarks.push(`Secondary ${secondary.prefix === 'V' ? 'dominant' : 'leading-tone chord'}: tonicizes ${secondary.label}. Its leading tone ${noteName(lt)} wants to rise to ${noteName(secondary.target)}.`);
  } else {
    const n = numeralFor(key, root, quality);
    numeral = { accidental: n.accidental, base: n.base, mark: n.mark, figs, of: null };
    const dominantFunction = degree === 4 || (degree === 6 && sameSpelling(root, leadingTone(key)));
    if (dominantFunction) {
      const ltRole = roles.get(spellingKey(leadingTone(key)));
      if (ltRole) ltRole.tendency = 1;
    }
    if (degree === 0 && inversion === 2 && (quality === 'major' || quality === 'minor')) {
      remarks.push('Cadential 6/4 if it falls on a strong beat before V: the 6 and 4 move down to 5 and 3 over the same bass.');
    }
  }

  if (isSeventh) roles.get(spellingKey(members.get('seventh').note)).tendency = -1;

  const inversionName = isSeventh || inversion < 3 ? INVERSION_NAMES[inversion] : '';
  return {
    type: 'tertian',
    root,
    quality,
    isSeventh,
    inversion,
    inversionName,
    name: { root, symbol: info.symbol, bass: inversion > 0 ? bass : null },
    longName: isNeapolitan ? 'Neapolitan (major triad on ♭2)' : info.long,
    numeral,
    pitches,
    roles,
    notes: remarks,
    chromatic,
  };
}

/** Plain-text Roman numeral, e.g. "V65/V", "♭VI", "vii°7". */
export function numeralText(numeral) {
  if (!numeral) return '';
  return `${numeral.accidental}${numeral.base}${numeral.mark}${numeral.figs.join('')}${numeral.of ? '/' + numeral.of : ''}`;
}

/** Chord symbol text, e.g. "D/F♯", "Bm7", "C♯°7". */
export function chordSymbolText(analysis, system = 'english') {
  if (analysis.type === 'aug6') return analysis.name;
  if (analysis.type !== 'tertian') return '';
  const { root, symbol, bass } = analysis.name;
  return noteName(root, system) + symbol + (bass ? '/' + noteName(bass, system) : '');
}

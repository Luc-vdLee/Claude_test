// Lessons, quiz questions and grading for the Learn tab.
//
// Everything here is rule-based: questions are built from the lesson's list of
// bass degrees and figures, the answers come from the same decoder the rest of
// the app uses, and wrong options are what you get from common reading mistakes
// (another figure, an accidental ignored, counting from the wrong note).
// No browser code, so it can be tested in Node.

import { makeKey, scaleNote, keyName, signatureAcc, signatureSpec } from './key.js';
import { decode } from './decode.js';
import { chordSymbolText, numeralText } from './chord.js';
import { noteName, LETTERS, spellingKey, parseNote } from './pitch.js';
import { parseFigures, figureLines } from './figures.js';
import { suggestFigures } from './rule.js';

export const QUIZ_LENGTH = 10;
export const PASS_PERCENT = 80;

// ---------------------------------------------------------------- helpers

/** Small seeded random generator (mulberry32), so a quiz can be replayed. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rand, list) => list[Math.floor(rand() * list.length)];

function shuffle(rand, list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** "C", "Am", "Bb", "F#m" -> key object. */
export function keyOf(spec) {
  const minor = spec.endsWith('m');
  return makeKey(minor ? spec.slice(0, -1) : spec, minor ? 'minor' : 'major');
}

const ORDINAL = { 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', 6: '6th', 7: '7th', 8: 'octave', 9: '9th' };
export const ordinal = (n) => ORDINAL[n] ?? `${n}th`;

/** How figures are printed, e.g. "6/4", "♯6/4/3", "4 – 3", "blank". */
export function figureText(fig) {
  if (!fig) return 'blank';
  const parsed = parseFigures(fig);
  if (parsed.error) return fig;
  return parsed.written.map((st) => figureLines(st).join('/')).join(' – ');
}

/** The written figures as stacked lines per stage, for drawing under a note. */
export function figureStacks(fig) {
  if (!fig) return [];
  const parsed = parseFigures(fig);
  return parsed.error ? [[fig]] : parsed.written.map(figureLines);
}

const notesText = (notes, sys) => notes.map((n) => noteName(n, sys)).join(' – ');

/** The chord's notes from the bass up, in the order of the figures (bass, 3rd, 5th…). */
function notesUp(d) {
  const seen = new Set();
  return [...d.stages[d.stages.length - 1].notes]
    .sort((a, b) => a.figure - b.figure)
    .filter((n) => { const k = spellingKey(n); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** A wrong answer should still be a believable chord, not an odd altered one. */
const plausible = (d) => d.main.type === 'tertian' && !/^other/.test(d.main.quality) && !d.main.pitches.some((n) => Math.abs(n.acc) > 1);

function chordText(main, sys) {
  if (main.type === 'aug6') return main.longName;
  if (main.type !== 'tertian') return 'not a standard chord';
  return `${noteName(main.root, sys)} ${main.longName}, ${main.inversionName} (${chordSymbolText(main, sys)})`;
}

function bassOf(key, item) {
  const n = scaleNote(key, item.deg);
  return { letter: n.letter, acc: n.acc + (item.raise ?? 0) };
}

const ALTER_WORD = { raise: 'raises', lower: 'lowers', natural: 'cancels the accidental on' };

/** Step-by-step explanation of how figures over a bass give a chord. */
export function explain(key, bass, fig, sys = 'english') {
  const d = decode(key, bass, fig);
  if (d.error) return [d.error];
  const b = noteName(bass, sys);
  const lines = [];
  if (!fig) lines.push('No figures: an unfigured bass means a root-position triad, so read it as 5/3.');
  d.stages.forEach((stage, si) => {
    const parts = stage.notes
      .filter((n) => n.figure !== 1)
      .sort((x, y) => y.figure - x.figure)
      .map((n) => {
        let t = `${ordinal(n.figure)} above ${b} = ${noteName(n, sys)}`;
        if (n.implicit) t += ' (not written, but understood)';
        if (n.alter) {
          const plain = { letter: n.letter, acc: signatureAcc(key, n.letter) };
          t += ` (the ${n.alter === 'raise' ? '♯' : n.alter === 'lower' ? '♭' : '♮'} ${ALTER_WORD[n.alter]} ${noteName(plain, sys)} from the key signature)`;
        }
        return t;
      });
    const prefix = d.stages.length > 1 ? `Step ${si + 1} (${figureLines(d.written[si] ?? []).join('/') || '…'}): ` : '';
    lines.push(prefix + parts.join('; ') + '.');
  });
  const main = d.main;
  if (main.type === 'tertian' || main.type === 'aug6') {
    lines.push(`Chord: ${chordText(main, sys)}. In ${keyName(key, sys)} that is ${d.label}.`);
  }
  return lines;
}

// ---------------------------------------------------------------- lessons

// Pool items: { deg: scale degree 0-6, fig, raise?: +1 for a raised bass, keys?: override }.
export const LESSONS = [
  {
    id: 'intervals',
    title: 'Counting up from the bass',
    summary: 'Figures are intervals above the bass. Count letters, then check the key signature.',
    intro: [
      'A figured bass gives you only the lowest note. The numbers under it tell you which notes to add above it: each number is an interval counted up from the bass.',
      'Count the bass itself as 1 and go up letter by letter. Over E, a 6 is C: E (1), F (2), G (3), A (4), B (5), C (6).',
      'The number only gives the letter. The key signature gives the accidental: in G major, a 7 above G is F♯, because F is sharp in the key.',
      'The octave does not matter. You may play the C of a 6 above E in any octave above the bass.',
    ],
    examples: [['C', 'E', '6'], ['G', 'G', '7'], ['F', 'D', '6']],
    keys: ['C', 'G', 'F', 'D', 'Bb', 'A'],
    types: ['interval'],
  },
  {
    id: 'root',
    title: 'Root-position triads: blank and 5/3',
    summary: 'No figures means a 5/3 chord: the 3rd and 5th above the bass.',
    intro: [
      'The most common figure is no figure at all. An unfigured bass note means a 5/3 chord: add the 3rd and the 5th above the bass. That is a triad in root position, with the bass as its root.',
      'Composers sometimes write 5/3, or just 5 or 3, when they want to be clear, for example after another figure over the same bass. It means the same chord.',
      'The key decides the quality. In C major the triad over D is D–F–A (minor, ii), and over G it is G–B–D (major, V).',
    ],
    examples: [['C', 'C', ''], ['C', 'D', ''], ['G', 'D', '5/3']],
    keys: ['C', 'G', 'F', 'D', 'Bb'],
    pool: [0, 1, 2, 3, 4, 5].map((deg) => ({ deg, fig: '' })),
    alts: ['6', '6/4', '7'],
    types: ['notes', 'chord', 'numeral'],
  },
  {
    id: 'six',
    title: 'First inversion: 6',
    summary: 'A 6 means 6/3: the bass is the 3rd of the chord.',
    intro: [
      'A 6 under the bass means 6/3: add the 3rd and the 6th above it. The 3 is understood, so it is rarely written.',
      'The chord is a triad in first inversion. Its root is the 6th above the bass, so over E a 6 gives E–G–C, a C major chord with E in the bass (I6 in C major).',
      'Quick check: the root of a 6 chord is always a 3rd below the bass note, or a 6th above it.',
    ],
    examples: [['C', 'E', '6'], ['C', 'B', '6'], ['F', 'A', '6']],
    keys: ['C', 'G', 'F', 'D', 'Bb', 'A'],
    pool: [...[0, 1, 2, 3, 4, 5, 6].map((deg) => ({ deg, fig: '6' })), { deg: 0, fig: '' }, { deg: 3, fig: '' }],
    alts: ['', '6', '6/4', '6/5'],
    types: ['notes', 'chord', 'figures', 'numeral'],
  },
  {
    id: 'sixfour',
    title: 'Second inversion: 6/4',
    summary: 'A 6/4 has the 5th of the chord in the bass. Its classic use is the cadential 6/4.',
    intro: [
      'A 6/4 means: add the 4th and the 6th above the bass. The chord is a triad in second inversion: the bass is its 5th, and the root is the 4th above the bass.',
      'Over G in C major, 6/4 gives G–C–E: a C major chord over G (I6/4).',
      'The most common 6/4 is the cadential 6/4: on a strong beat over the dominant, followed by 5/3 over the same bass (written 6/4–5/3). The 6 and 4 step down to 5 and 3.',
    ],
    examples: [['C', 'G', '6/4'], ['C', 'G', '6/4-5/3'], ['G', 'D', '6/4']],
    keys: ['C', 'G', 'F', 'D', 'Bb'],
    pool: [{ deg: 4, fig: '6/4' }, { deg: 0, fig: '6/4' }, { deg: 1, fig: '6/4' }, { deg: 2, fig: '6' }, { deg: 4, fig: '' }, { deg: 0, fig: '6' }],
    alts: ['', '6', '6/4', '4/3'],
    types: ['notes', 'chord', 'figures', 'numeral'],
  },
  {
    id: 'sevenths',
    title: 'Seventh chords: 7, 6/5, 4/3, 4/2',
    summary: 'Four figures for the four positions of a seventh chord.',
    intro: [
      'A seventh chord has four notes, so it has four positions, each with its own short figure:',
      '7 = 7/5/3: root position. 6/5 = 6/5/3: first inversion (the 3rd in the bass). 4/3 = 6/4/3: second inversion (the 5th in the bass). 4/2 (or just 2) = 6/4/2: third inversion (the 7th in the bass).',
      'To find the root: in a 6/5 it is the 6th above the bass, in a 4/3 the 4th, in a 4/2 the 2nd. The 7th of the chord is the dissonance, and it resolves down a step.',
      'Over F in C major, 4/2 gives F–G–B–D: G7 with its 7th in the bass (V4/2), which resolves to E in the bass (I6).',
    ],
    examples: [['C', 'G', '7'], ['C', 'B', '6/5'], ['C', 'D', '4/3'], ['C', 'F', '4/2']],
    keys: ['C', 'G', 'F', 'D', 'Bb'],
    pool: [{ deg: 4, fig: '7' }, { deg: 6, fig: '6/5' }, { deg: 1, fig: '4/3' }, { deg: 3, fig: '4/2' }, { deg: 1, fig: '7' }, { deg: 3, fig: '6/5' }, { deg: 5, fig: '4/3' }, { deg: 0, fig: '4/2' }],
    alts: ['7', '6/5', '4/3', '4/2'],
    types: ['notes', 'figures', 'chord', 'numeral'],
  },
  {
    id: 'accidentals',
    title: 'Accidentals in the figures',
    summary: '♯, ♭ and ♮ change a note from the key signature. A lone accidental changes the 3rd.',
    intro: [
      'An accidental next to a figure changes that note by a half step from what the key signature gives: ♯6 raises the 6th, ♭7 lowers the 7th, ♮ cancels the key signature.',
      'An accidental on its own (♯, ♭ or ♮ without a number) changes the 3rd above the bass. It still means a 5/3 chord.',
      'The sharp works against the key signature, as in historical practice: in F major, ♯ over G turns B♭ into B♮, not B♯. Modern editions sometimes print ♮ there instead.',
      'A slashed figure (6\\ or 6+) means the same as a sharp: the note is raised.',
      'Accidentals usually point to a chromatic chord, often a secondary dominant: in C major, ♯ over D gives D–F♯–A, V/V.',
    ],
    examples: [['C', 'D', '#'], ['F', 'G', 'n'], ['C', 'F#', '6/5'], ['G', 'C', 'b']],
    keys: ['C', 'F', 'G', 'D'],
    pool: [
      { deg: 1, fig: '#', keys: ['C', 'G', 'D'] },
      { deg: 5, fig: '#', keys: ['C', 'G', 'F'] },
      { deg: 2, fig: '#', keys: ['C', 'G', 'F'] },
      { deg: 1, fig: '7 #', keys: ['C', 'G', 'D'] },
      { deg: 4, fig: 'n', keys: ['F', 'Bb'] },
      { deg: 1, fig: '6 #', keys: ['C', 'G'] },
      { deg: 3, raise: 1, fig: '6/5', keys: ['C', 'G', 'F', 'D'] },
      { deg: 3, fig: 'b', keys: ['C', 'G', 'F'] },
    ],
    alts: ['', '6', '6/5', '7'],
    strip: true,
    types: ['notes', 'chord', 'numeral'],
  },
  {
    id: 'minor',
    title: 'Minor keys and the leading tone',
    summary: 'In minor, the raised leading tone must be figured: ♯ over the dominant.',
    intro: [
      'The key signature of a minor key gives the natural minor scale. The dominant chord needs the raised 7th degree, the leading tone, and the key signature does not have it.',
      'So in minor the leading tone is written in the figures: a lone ♯ (or ♮ in flat keys) over the dominant raises its 3rd. In A minor, ♯ over E gives E–G♯–B, V. For V7 write 7 with ♯ (7/♯).',
      'When the leading tone is in the bass itself, it is written as a raised note (G♯ in A minor), and the figures (6, 6/5) are read as usual.',
      'Without the ♯, the chord on the dominant is minor (v). Players of the time knew to raise it in cadences, and the setting "Raise leading tone in minor" does that for you in the decoder. In these lessons, read only what is written.',
    ],
    examples: [['Am', 'E', '#'], ['Am', 'G#', '6/5'], ['Dm', 'A', '7 #'], ['Am', 'E', '']],
    keys: ['Am', 'Dm', 'Em', 'Gm', 'Cm'],
    pool: [
      { deg: 4, fig: '#' },
      { deg: 4, fig: '7 #' },
      { deg: 6, raise: 1, fig: '6' },
      { deg: 6, raise: 1, fig: '6/5' },
      { deg: 0, fig: '' },
      { deg: 3, fig: '' },
      { deg: 2, fig: '6' },
      { deg: 3, fig: '6' },
    ],
    alts: ['', '#', '6', '6/5', '7'],
    strip: true,
    types: ['notes', 'chord', 'numeral'],
  },
  {
    id: 'suspensions',
    title: 'Suspensions: 4–3, 7–6, 9–8',
    summary: 'Figures joined by a dash follow each other over one bass: the dissonance falls a step.',
    intro: [
      'Figures written next to each other with a dash, such as 4–3, happen one after the other over the same bass note.',
      'In a suspension, a note from the previous chord is held over (the higher figure), clashes with the bass, and then falls a step to a chord tone (the lower figure).',
      '4–3: the 4th above the bass falls to the 3rd. 7–6: the 7th falls to the 6th (a 6 chord). 9–8: the 9th falls to the octave. The other figures are held: 4–3 means 5/4 then 5/3.',
      'Over G in C major, 4–3 is C falling to B: the dominant chord with a suspended 4th.',
      '6/4–5/3 is the cadential 6/4 again: two notes fall together.',
    ],
    examples: [['C', 'G', '4-3'], ['C', 'D', '7-6'], ['C', 'C', '9-8'], ['G', 'D', '6/4-5/3']],
    keys: ['C', 'G', 'F', 'D'],
    pool: [{ deg: 4, fig: '4-3' }, { deg: 0, fig: '4-3' }, { deg: 1, fig: '7-6' }, { deg: 2, fig: '7-6' }, { deg: 0, fig: '9-8' }, { deg: 3, fig: '9-8' }],
    alts: ['4-3', '7-6', '9-8'],
    types: ['suspension', 'chord'],
  },
  {
    id: 'octave',
    title: 'The Rule of the Octave',
    summary: 'Standard figures for each step of a scale in the bass, rising and falling.',
    intro: [
      'Many basses have no figures. Players learned a standard harmony for each scale degree when the bass moves by step: the Rule of the Octave.',
      'Rising in major: 1̂ 5/3, 2̂ 6/4/3, 3̂ 6, 4̂ 6/5, 5̂ 5/3, 6̂ 6, 7̂ 6/5, 8̂ 5/3.',
      'Falling in major: 8̂ 5/3, 7̂ 6, 6̂ ♯6/4/3, 5̂ 5/3, 4̂ 4/2, 3̂ 6, 2̂ 6/4/3, 1̂ 5/3.',
      'The tonic and dominant always get 5/3, the notes next to them get chords that lead there. In minor, the 5̂ takes ♯ (the leading tone) and the 2̂ ♯6/4/3.',
      'The Suggest button in the decoder uses these rules.',
    ],
    examples: [['C', 'D', '6/4/3'], ['C', 'F', '6/5'], ['C', 'A', '#6/4/3'], ['C', 'F', '4/2']],
    keys: ['C', 'G', 'F', 'D', 'Am', 'Dm'],
    types: ['rule'],
  },
];

export const lessonById = (id) => LESSONS.find((l) => l.id === id);

/** Bass lines to realize in four parts, checked with the Practice mode. */
export const REALIZATIONS = [
  { id: 'r-first', title: 'First cadence', key: 'C', line: 'C F G C/h', about: 'Root-position chords only: I IV V I.' },
  { id: 'r-six', title: 'With a 6 chord', key: 'G', line: 'G B:6 C D G/h', about: 'I I6 IV V I in G major.' },
  { id: 'r-sevenths', title: 'Seventh chords', key: 'F', line: 'F D G:6/5 C:7 F/h', about: 'I vi ii6/5 V7 I in F major.' },
  { id: 'r-minor', title: 'Minor with the leading tone', key: 'Am', line: 'A G#:6 A D E:7,# A/h', about: 'Watch the ♯ figures in A minor.' },
  { id: 'r-cadence', title: 'Cadential 6/4', key: 'D', line: 'D B G:6/5 A/h:6/4-5/3 D/h', about: 'A cadence with 6/4–5/3 over the dominant.' },
  { id: 'r-octave', title: 'Rule of the Octave in C', key: 'C', line: 'C D:6/4/3 E:6 F:6/5 G A:6 B:6/5 C B:6 A:#6/4/3 G F:4/2 E:6 D:6/4/3 C/h', about: 'The whole scale up and down with its standard figures.' },
];

// ---------------------------------------------------------------- questions

/**
 * A question is plain data (so wrong answers can be saved and asked again):
 * { id, type, lesson, key: 'C'|'Am'…, bass: {letter, acc}, figures, show: {figures, chord?}, prompt,
 *   options: [string], answer: index, hint, explain: [string] }
 */

function finish(rand, q, correct, wrong) {
  const unique = [...new Set(wrong.filter((w) => w && w !== correct))];
  const options = shuffle(rand, [correct, ...shuffle(rand, unique).slice(0, 3)]);
  return { ...q, options, answer: options.indexOf(correct) };
}

function decodeSafe(key, bass, fig) {
  const d = decode(key, bass, fig);
  return d.error ? null : d;
}

const stripAccidentals = (fig) => fig.replace(/[#bn+\\♯♭♮]/g, '').trim();

/** Answers you get from the same bass with the lesson's other figures (and with accidentals ignored). */
function alternatives(key, bass, item, lesson, labelOf) {
  const figs = [...(lesson.alts ?? []), ...(lesson.pool ?? []).map((p) => p.fig)];
  if (lesson.strip || /[#bn]/.test(item.fig)) figs.unshift(stripAccidentals(item.fig));
  const out = [];
  for (const f of figs) {
    if (f === item.fig) continue;
    const d = decodeSafe(key, bass, f);
    if (d && plausible(d)) out.push(labelOf(d));
  }
  // Same figures a step higher or lower: counting from the wrong note.
  for (const step of [1, -1]) {
    const n = { letter: (bass.letter + step + 7) % 7, acc: signatureAcc(key, (bass.letter + step + 7) % 7) };
    const d = decodeSafe(key, n, item.fig);
    if (d && plausible(d)) out.push(labelOf(d));
  }
  return out;
}

function setup(rand, lesson, item) {
  const keySpec = pick(rand, item.keys ?? lesson.keys);
  const key = keyOf(keySpec);
  const bass = bassOf(key, item);
  return { keySpec, key, bass };
}

const HINTS = {
  interval: 'Count the bass itself as 1, then go up letter by letter. Then look at the key signature for the accidental.',
  notes: 'Fill in what is understood: blank = 5/3, 6 = 6/3, 7 = 7/5/3, 6/5 = 6/5/3, 4/3 = 6/4/3, 4/2 = 6/4/2. Count each one up from the bass.',
  chord: 'Find the notes first, then stack them in 3rds. The lowest note of that stack is the root.',
  figures: 'Count the interval from the bass up to each of the other notes. Then use the short figure: 6/3 is written 6, 6/4/3 is written 4/3.',
  numeral: 'Find the root and its scale degree. Capitals for major, lower case for minor, ° for diminished, and add the inversion figures (6, 6/4, 6/5…).',
  suspension: 'The higher figure is the dissonance held over from before; it falls one step to the lower figure.',
  rule: 'Tonic and dominant take 5/3. Find the scale degree, check whether the bass is rising or falling, and recall the Rule of the Octave.',
};

function questionInterval(rand, lesson, sys) {
  const keySpec = pick(rand, lesson.keys);
  const key = keyOf(keySpec);
  const bass = scaleNote(key, Math.floor(rand() * 7));
  const n = pick(rand, [3, 5, 6, 4, 7, 2, 6, 3]);
  const at = (k) => {
    const letter = (bass.letter + k - 1 + 7) % 7;
    return noteName({ letter, acc: signatureAcc(key, letter) }, sys);
  };
  const steps = Array.from({ length: n }, (_, i) => `${at(i + 1)} (${i + 1})`).join(', ');
  return finish(rand, {
    type: 'interval',
    keySpec,
    bass,
    figures: '',
    show: { figures: false },
    prompt: `In ${keyName(key, sys)}, which note is a ${ordinal(n)} above ${noteName(bass, sys)}?`,
    hint: HINTS.interval,
    explain: [`Count up from ${noteName(bass, sys)}: ${steps}.`, `The key signature of ${keyName(key, sys)} gives ${at(n)}.`],
  }, at(n), [at(n + 1), at(n - 1), at(n + 2), at(n - 2)]);
}

function questionNotes(rand, lesson, sys) {
  const item = pick(rand, (lesson.pool ?? []).filter((p) => !p.fig.includes('-')));
  const { keySpec, key, bass } = setup(rand, lesson, item);
  const d = decode(key, bass, item.fig);
  const label = (x) => notesText(notesUp(x), sys);
  return finish(rand, {
    type: 'notes',
    keySpec,
    bass,
    figures: item.fig,
    show: { figures: true },
    prompt: `In ${keyName(key, sys)}: which notes do these figures ask for over ${noteName(bass, sys)}? (bass first)`,
    hint: HINTS.notes,
    explain: explain(key, bass, item.fig, sys),
  }, label(d), alternatives(key, bass, item, lesson, label));
}

function questionChord(rand, lesson, sys) {
  const pool = (lesson.pool ?? []).filter((p) => {
    const k = keyOf((p.keys ?? lesson.keys)[0]);
    return decode(k, bassOf(k, p), p.fig).main?.type === 'tertian';
  });
  const item = pick(rand, pool);
  const { keySpec, key, bass } = setup(rand, lesson, item);
  const d = decode(key, bass, item.fig);
  const label = (x) => (x.main.type === 'tertian' ? chordText(x.main, sys) : null);
  const resolves = item.fig.includes('-');
  return finish(rand, {
    type: 'chord',
    keySpec,
    bass,
    figures: item.fig,
    show: { figures: true },
    prompt: resolves
      ? `In ${keyName(key, sys)}: which chord does this resolve to?`
      : `In ${keyName(key, sys)}: which chord is this?`,
    hint: HINTS.chord,
    explain: explain(key, bass, item.fig, sys),
  }, label(d), alternatives(key, bass, item, lesson, label));
}

function questionNumeral(rand, lesson, sys) {
  const item = pick(rand, (lesson.pool ?? []).filter((p) => !p.fig.includes('-')));
  const { keySpec, key, bass } = setup(rand, lesson, item);
  const d = decode(key, bass, item.fig);
  const label = (x) => numeralText(x.main.numeral) || null;
  return finish(rand, {
    type: 'numeral',
    keySpec,
    bass,
    figures: item.fig,
    show: { figures: true },
    prompt: `In ${keyName(key, sys)}: what is the Roman numeral of this chord?`,
    hint: HINTS.numeral,
    explain: explain(key, bass, item.fig, sys),
  }, label(d), alternatives(key, bass, item, lesson, label));
}

function questionFigures(rand, lesson, sys) {
  const item = pick(rand, (lesson.pool ?? []).filter((p) => !p.fig.includes('-')));
  const { keySpec, key, bass } = setup(rand, lesson, item);
  const d = decode(key, bass, item.fig);
  const set = (x) => x.main.pitches.map(spellingKey).sort().join();
  const mine = set(d);
  const wrong = [...(lesson.alts ?? []), ...lesson.pool.map((p) => p.fig), '6/4', '7', '6/5', '4/2']
    .filter((f) => { const x = decodeSafe(key, bass, f); return x && set(x) !== mine; })
    .map(figureText);
  return finish(rand, {
    type: 'figures',
    keySpec,
    bass,
    figures: item.fig,
    show: { figures: false, chord: notesText(notesUp(d), sys) },
    prompt: `In ${keyName(key, sys)}, the chord ${notesText(notesUp(d), sys)} has ${noteName(bass, sys)} in the bass. Which figures go under it?`,
    hint: HINTS.figures,
    explain: explain(key, bass, item.fig, sys),
  }, figureText(item.fig), wrong);
}

function questionSuspension(rand, lesson, sys) {
  const item = pick(rand, lesson.pool);
  const { keySpec, key, bass } = setup(rand, lesson, item);
  const d = decode(key, bass, item.fig);
  const [hi, lo] = item.fig.split('-').map((s) => Number(s.trim()[0]));
  const sus = d.stages[0].notes.find((n) => n.figure === hi);
  const res = d.stages[1].notes.find((n) => n.figure === lo);
  const name = (n) => noteName(n, sys);
  const up = { letter: (sus.letter + 1) % 7, acc: signatureAcc(key, (sus.letter + 1) % 7) };
  const wrongCount = { letter: (bass.letter + hi) % 7, acc: signatureAcc(key, (bass.letter + hi) % 7) };
  return finish(rand, {
    type: 'suspension',
    keySpec,
    bass,
    figures: item.fig,
    show: { figures: true },
    prompt: `In ${keyName(key, sys)}: which note is suspended over ${name(bass)}, and where does it go?`,
    hint: HINTS.suspension,
    explain: explain(key, bass, item.fig, sys),
  }, `${name(sus)} → ${name(res)}`, [`${name(res)} → ${name(sus)}`, `${name(sus)} → ${name(up)}`, `${name(up)} → ${name(sus)}`, `${name(wrongCount)} → ${name(res)}`]);
}

const RULE_FIGS = ['', '6', '6/5', '6/4/3', '4/2', '#6/4/3', '#', '6/4', '7'];

function questionRule(rand, lesson, sys) {
  const keySpec = pick(rand, lesson.keys);
  const key = keyOf(keySpec);
  const deg = Math.floor(rand() * 7);
  const dir = rand() < 0.5 ? 1 : -1;
  const note = (d) => scaleNote(key, d);
  let bass = note(deg);
  // Rising through the 7th in minor uses the leading tone.
  if (key.mode === 'minor' && deg === 6 && dir === 1) bass = { ...bass, acc: bass.acc + 1 };
  const prev = note(deg - dir);
  const next = note(deg + dir);
  const { figures, reason } = suggestFigures(key, bass, { prev, next });
  const ans = figureText(figures);
  const degName = `${deg + 1}̂`;
  return finish(rand, {
    type: 'rule',
    keySpec,
    bass,
    figures,
    show: { figures: false, motion: `${noteName(prev, sys)} → ${noteName(bass, sys)} → ${noteName(next, sys)}` },
    prompt: `In ${keyName(key, sys)} the bass ${dir > 0 ? 'rises' : 'falls'} by step: ${noteName(prev, sys)} → ${noteName(bass, sys)} → ${noteName(next, sys)}. Which figures does the Rule of the Octave give ${noteName(bass, sys)} (${degName})?`,
    hint: HINTS.rule,
    explain: [reason, ...explain(key, bass, figures, sys)],
  }, ans, RULE_FIGS.map(figureText).filter((f) => f !== ans));
}

const MAKERS = {
  interval: questionInterval,
  notes: questionNotes,
  chord: questionChord,
  numeral: questionNumeral,
  figures: questionFigures,
  suspension: questionSuspension,
  rule: questionRule,
};

const signature = (q) => `${q.type}|${q.keySpec}|${q.bass.letter},${q.bass.acc}|${q.figures}|${q.prompt}`;

/** One question of `type` (or the lesson's next type) for a lesson. */
export function makeQuestion(lesson, type, rand, sys = 'english') {
  const q = MAKERS[type](rand, lesson, sys);
  return { ...q, lesson: lesson.id, id: signature(q) };
}

/**
 * A quiz for one lesson, or a mixed test over several lessons.
 * Question types rotate; the same question is not asked twice.
 */
export function makeQuiz(lessons, { seed = Date.now(), length = QUIZ_LENGTH, sys = 'english' } = {}) {
  const rand = rng(seed);
  const list = Array.isArray(lessons) ? lessons : [lessons];
  const out = [];
  const seen = new Set();
  for (let i = 0, tries = 0; out.length < length && tries < length * 20; tries++) {
    const lesson = list.length > 1 ? pick(rand, list) : list[0];
    const type = list.length > 1 ? pick(rand, lesson.types) : lesson.types[i % lesson.types.length];
    const q = makeQuestion(lesson, type, rand, sys);
    if (seen.has(q.id) || q.options.length < 2) continue;
    seen.add(q.id);
    out.push(q);
    i++;
  }
  return out;
}

// ---------------------------------------------------------------- grading

/** Points for one answer: 1 if right, ½ if right after a hint, 0 if wrong. */
export const points = ({ correct, hinted }) => (correct ? (hinted ? 0.5 : 1) : 0);

export function grade(answers) {
  const total = answers.length;
  const score = answers.reduce((s, a) => s + points(a), 0);
  const percent = total ? Math.round((100 * score) / total) : 0;
  return { score, total, percent, stars: stars(percent), passed: percent >= PASS_PERCENT };
}

export const stars = (percent) => (percent >= 95 ? 3 : percent >= PASS_PERCENT ? 2 : percent >= 60 ? 1 : 0);

/**
 * Grade a four-part realization from the Practice check of each chord step:
 * 'ok' counts fully, 'warn' half, 'error' and 'incomplete' nothing.
 */
export function realizationGrade(statuses) {
  if (!statuses.length) return 0;
  const pts = statuses.reduce((s, st) => s + (st === 'ok' ? 1 : st === 'warn' ? 0.5 : 0), 0);
  return Math.round((100 * pts) / statuses.length);
}

/** Where the next lesson to work on is: the first one not yet passed. */
export function nextLesson(progress) {
  return LESSONS.find((l) => !((progress?.[l.id]?.best ?? 0) >= PASS_PERCENT)) ?? null;
}

// For the examples in a lesson: [keySpec, bass name, figures] -> data to show.
export function exampleData([keySpec, bassName, fig], sys = 'english') {
  const key = keyOf(keySpec);
  const bass = parseNote(bassName);
  const d = decode(key, bass, fig);
  return {
    keySpec,
    key,
    bass,
    figures: fig,
    keySig: signatureSpec(key),
    title: `${keyName(key, sys)}: ${noteName(bass, sys)} with ${figureText(fig)}`,
    result: d.error ? d.error : `${notesText(notesUp(d), sys)} · ${d.main.type === 'tertian' ? chordSymbolText(d.main, sys) + ' · ' : ''}${d.label}`,
    explain: explain(key, bass, fig, sys),
  };
}

export { LETTERS };

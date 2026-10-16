import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseNote, noteName, intervalName } from '../src/theory/pitch.js';
import { makeKey, keyName, vexKeySpec } from '../src/theory/key.js';
import { parseFigures } from '../src/theory/figures.js';
import { decode } from '../src/theory/decode.js';
import { chordSymbolText } from '../src/theory/chord.js';
import { voiceProgression } from '../src/theory/voicing.js';

const names = (notes) => notes.map((n) => noteName(n)).join(' ');
const nums = (stage) => stage.map((f) => `${f.alter ? f.alter[0] : ''}${f.num}`).join(' ');

function chord(tonic, mode, bass, figures, options) {
  return decode(makeKey(tonic, mode), parseNote(bass), figures, options);
}

test('note names in English, German and Dutch', () => {
  const cases = [
    ['Bb', 'B♭', 'B', 'Bes'],
    ['B', 'B', 'H', 'B'],
    ['F#', 'F♯', 'Fis', 'Fis'],
    ['Eb', 'E♭', 'Es', 'Es'],
    ['Ab', 'A♭', 'As', 'As'],
    ['Db', 'D♭', 'Des', 'Des'],
    ['Fx', 'F𝄪', 'Fisis', 'Fisis'],
  ];
  for (const [input, en, de, nl] of cases) {
    const n = parseNote(input);
    assert.equal(noteName(n, 'english'), en);
    assert.equal(noteName(n, 'german'), de);
    assert.equal(noteName(n, 'dutch'), nl);
  }
});

test('key names and VexFlow key specs', () => {
  assert.equal(keyName(makeKey('F#', 'minor'), 'german'), 'fis-Moll');
  assert.equal(keyName(makeKey('Bb', 'major'), 'dutch'), 'Bes majeur');
  assert.equal(vexKeySpec(makeKey('F#', 'minor')), 'F#m');
  assert.equal(vexKeySpec(makeKey('Bb', 'major')), 'Bb');
});

test('interval names', () => {
  const p = (s, o) => ({ ...parseNote(s), octave: o });
  assert.equal(intervalName(p('F', 4), p('G#', 4)).short, 'A2');
  assert.equal(intervalName(p('B', 3), p('F', 4)).short, 'd5');
  assert.equal(intervalName(p('C', 4), p('Eb', 4)).short, 'm3');
  assert.equal(intervalName(p('C', 4), p('C', 5)).short, 'P8');
});

test('figures are completed by convention', () => {
  const complete = (s) => nums(parseFigures(s).stages[0]);
  assert.equal(complete(''), '5 3');
  assert.equal(complete('6'), '6 3');
  assert.equal(complete('6/4'), '6 4');
  assert.equal(complete('7'), '7 5 3');
  assert.equal(complete('65'), '6 5 3');
  assert.equal(complete('4/3'), '6 4 3');
  assert.equal(complete('2'), '6 4 2');
  assert.equal(complete('4 2'), '6 4 2');
  assert.equal(complete('#'), '5 r3');
  assert.equal(complete('7 #'), '7 5 r3');
  assert.equal(complete('#6'), 'r6 3');
  assert.equal(complete('6#'), 'r6 3');
  assert.equal(complete('6+'), 'r6 3');
  assert.equal(complete('b6'), 'l6 3');
  assert.equal(complete('♮'), '5 n3');
  assert.equal(complete('9'), '9 5 3');
});

test('linear figures make stages', () => {
  const p = parseFigures('6/4-5/3');
  assert.deepEqual(p.stages.map(nums), ['6 4', '5 3']);
  assert.deepEqual(parseFigures('4-3').stages.map(nums), ['5 4', '5 3']);
  assert.deepEqual(parseFigures('7 4-3').stages.map(nums), ['7 5 4', '7 5 3']);
  assert.deepEqual(parseFigures('9–8').stages.map(nums), ['9 5 3', '8 5 3']);
});

test('bad figures give an error', () => {
  assert.ok(parseFigures('6x').error);
  assert.ok(parseFigures('1').error);
  assert.ok(parseFigures('4-').error);
  assert.ok(parseFigures('+6').error);
});

test('rule of the octave in C major', () => {
  const rows = [
    ['C', '', 'I', 'C E G'],
    ['D', '6/4/3', 'V43', 'D F G B'],
    ['E', '6', 'I6', 'E G C'],
    ['F', '6/5', 'ii65', 'F A C D'],
    ['G', '', 'V', 'G B D'],
    ['A', '6', 'IV6', 'A C F'],
    ['B', '6/5', 'V65', 'B D F G'],
    ['B', '6', 'V6', 'B D G'],
    ['F', '4/2', 'V42', 'F G B D'],
  ];
  for (const [bass, figs, numeral, notes] of rows) {
    const r = chord('C', 'major', bass, figs);
    assert.equal(r.label, numeral, `${bass} ${figs}`);
    assert.equal(names(r.main.pitches).split(' ').sort().join(' '), notes.split(' ').sort().join(' '), `${bass} ${figs}`);
  }
});

test('minor keys: lone sharp raises the leading tone', () => {
  const v = chord('A', 'minor', 'E', '#');
  assert.equal(v.label, 'V');
  assert.equal(chordSymbolText(v.main), 'E');
  const v7 = chord('A', 'minor', 'E', '7 #');
  assert.equal(v7.label, 'V7');
  assert.equal(chordSymbolText(v7.main), 'E7');
  // In a flat key, # raises the flat note to natural.
  assert.equal(chordSymbolText(chord('D', 'minor', 'A', '#').main), 'A');
  // In G# minor the leading tone is F double-sharp.
  assert.equal(names(chord('G#', 'minor', 'D#', '#').main.pitches), 'D♯ A♯ F𝄪');
});

test('minor keys: unraised v gives a hint, auto-raise fixes it', () => {
  const plain = chord('A', 'minor', 'E', '');
  assert.equal(plain.label, 'v');
  assert.equal(plain.hints.length, 1);
  const raised = chord('A', 'minor', 'E', '', { autoRaise: true });
  assert.equal(raised.label, 'V');
  const v7 = chord('C', 'minor', 'G', '7', { autoRaise: true });
  assert.equal(chordSymbolText(v7.main), 'G7');
});

test('chord names, inversions and qualities', () => {
  assert.equal(chordSymbolText(chord('D', 'major', 'F#', '6').main), 'D/F♯');
  assert.equal(chord('D', 'major', 'F#', '6').main.inversionName, 'first inversion');
  assert.equal(chordSymbolText(chord('A', 'minor', 'G#', '7').main), 'G♯°7');
  assert.equal(chord('A', 'minor', 'G#', '7').label, 'vii°7');
  assert.equal(chord('C', 'major', 'B', '6/5').label, 'V65');
  assert.equal(chord('C', 'major', 'D', '7').label, 'ii7');
  assert.equal(chord('A', 'minor', 'B', '7').label, 'iiø7');
  assert.equal(chord('C', 'major', 'G', '6/4').label, 'I64');
});

test('secondary dominants and leading-tone chords', () => {
  assert.equal(chord('C', 'major', 'F#', '6/5').label, 'V65/V');
  assert.equal(chord('C', 'major', 'D', '#').label, 'V/V');
  assert.equal(chord('C', 'major', 'C', 'b7').label, 'V7/IV');
  assert.equal(chord('C', 'major', 'C#', 'b7').label, 'vii°7/ii');
  assert.equal(chord('C', 'major', 'C#', '7').label, 'viiø7/ii');
  assert.equal(chord('C', 'major', 'G#', '6').label, 'V6/vi');
  assert.equal(chord('A', 'minor', 'G', '7').label, 'V7/III');
  assert.equal(chord('A', 'minor', 'B', '#5 #').label, 'V/V');
});

test('Neapolitan and augmented sixths', () => {
  assert.equal(chord('A', 'minor', 'D', 'b6').label, 'N6');
  assert.equal(chord('C', 'major', 'F', 'b6 b3').label, 'N6');
  assert.equal(chord('A', 'minor', 'F', '#6').label, 'It+6');
  assert.equal(chord('A', 'minor', 'F', '#6 4 3').label, 'Fr+6');
  assert.equal(chord('A', 'minor', 'F', '#6 5').label, 'Ger+6');
  assert.equal(chord('C', 'major', 'Ab', '#6 b5').label, 'Ger+6');
  assert.equal(names(chord('C', 'major', 'Ab', '#6 b5').main.pitches), 'A♭ F♯ E♭ C');
});

test('suspensions and the cadential 6/4', () => {
  const sus = chord('C', 'major', 'C', '4-3');
  assert.equal(sus.label, 'I (4–3)');
  assert.equal(names(sus.stages[0].notes), 'C G F');
  assert.equal(names(sus.stages[1].notes), 'C G E');
  assert.equal(chord('C', 'major', 'G', '6/4-5/3').label, 'V (6–5, 4–3)');
  assert.equal(chord('C', 'major', 'C', '9-8').label, 'I (9–8)');
  assert.equal(chord('C', 'major', 'E', '7-6').label, 'I6 (7–6)');
});

// --- voicing -------------------------------------------------------------

function progression(tonic, mode, items) {
  const key = makeKey(tonic, mode);
  return items.map(([bass, figs]) => decode(key, parseNote(bass), figs));
}

function flatVoicings(chords) {
  return voiceProgression(chords).flat();
}

test('voicings stay in range, keep order and contain the chord', () => {
  const chords = progression('C', 'major', [['C', ''], ['D', '6/4/3'], ['E', '6'], ['F', '6/5'], ['G', '6/4-5/3'], ['G', '7'], ['C', '']]);
  for (const v of flatVoicings(chords)) {
    const [b, t, a, s] = v.midis;
    assert.ok(b <= t && t <= a && a <= s, 'voices in order');
    assert.ok(s - a <= 12 && a - t <= 12, 'spacing');
    assert.ok(s >= 60 && s <= 79 && a >= 55 && a <= 74 && t >= 48 && t <= 67);
  }
});

test('voice leading avoids parallels and resolves tendency tones', () => {
  const sets = [
    progression('C', 'major', [['C', ''], ['F', ''], ['G', '7'], ['C', '']]),
    progression('C', 'major', [['C', ''], ['D', '6/4/3'], ['E', '6'], ['F', '6/5'], ['G', '6/4-5/3'], ['G', '7'], ['C', '']]),
    progression('A', 'minor', [['A', ''], ['D', '6'], ['E', '#'], ['A', '']]),
    progression('A', 'minor', [['A', ''], ['F', '#6'], ['E', '#'], ['A', '']]),
    progression('G', 'major', [['G', ''], ['C', ''], ['C#', '6/5'], ['D', ''], ['G', '4-3'], ['G', '']]),
  ];
  for (const chords of sets) {
    for (const v of flatVoicings(chords)) {
      const errors = v.issues.filter((i) => i.level === 'error');
      assert.deepEqual(errors, [], errors.map((e) => e.text).join('; '));
    }
  }
});

test('V7 to I: the leading tone rises and the 7th falls', () => {
  const [v7, i] = voiceProgression(progression('C', 'major', [['G', '7'], ['C', '']])).map((c) => c[0]);
  for (let voice = 1; voice < 4; voice++) {
    const from = v7.notes[voice];
    const to = i.notes[voice];
    if (noteName(from) === 'B') assert.equal(noteName(to), 'C', 'leading tone resolves');
    if (noteName(from) === 'F') assert.equal(noteName(to), 'E', '7th resolves');
  }
});

test('a suspension resolves down by step in the same voice', () => {
  const [[sus, res]] = voiceProgression(progression('C', 'major', [['C', '4-3']]));
  const v = sus.notes.findIndex((n) => noteName(n) === 'F');
  assert.ok(v > 0);
  assert.equal(noteName(res.notes[v]), 'E');
  assert.equal(sus.midis[v] - res.midis[v], 1);
});

test('choosing an alternative voicing', () => {
  const chords = progression('C', 'major', [['C', ''], ['G', '']]);
  const best = voiceProgression(chords);
  const alt = voiceProgression(chords, [[0], [1]]);
  assert.notDeepEqual(best[1][0].midis, alt[1][0].midis);
  assert.equal(alt[1][0].choice, 1);
});

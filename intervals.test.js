import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LETTERS, note, parseNote, noteName, midi, frequency, interval, invert, transpose, COMMON_INTERVALS,
} from './intervals.js';

const iv = (a, b) => interval(parseNote(a), parseNote(b));

test('parses and names notes', () => {
  assert.deepEqual(parseNote('C4'), { letter: 'C', accidental: 0, octave: 4 });
  assert.deepEqual(parseNote('f#3'), { letter: 'F', accidental: 1, octave: 3 });
  assert.deepEqual(parseNote('Ebb5'), { letter: 'E', accidental: -2, octave: 5 });
  assert.deepEqual(parseNote('Gx2'), { letter: 'G', accidental: 2, octave: 2 });
  assert.equal(noteName(parseNote('Bb3')), 'B♭3');
  assert.throws(() => parseNote('H4'));
});

test('midi numbers and frequencies', () => {
  assert.equal(midi(parseNote('C4')), 60);
  assert.equal(midi(parseNote('A4')), 69);
  assert.equal(midi(parseNote('B#3')), 60);
  assert.equal(midi(parseNote('Cb4')), 59);
  assert.equal(frequency(parseNote('A4')), 440);
  assert.ok(Math.abs(frequency(parseNote('C4')) - 261.63) < 0.01);
});

test('simple intervals', () => {
  const cases = [
    ['C4', 'C4', 'P1', 0], ['C4', 'D4', 'M2', 2], ['C4', 'Eb4', 'm3', 3], ['C4', 'E4', 'M3', 4],
    ['C4', 'F4', 'P4', 5], ['F4', 'B4', 'A4', 6], ['B3', 'F4', 'd5', 6], ['C4', 'G4', 'P5', 7],
    ['E4', 'C5', 'm6', 8], ['C4', 'A4', 'M6', 9], ['D4', 'C5', 'm7', 10], ['C4', 'B4', 'M7', 11],
    ['C4', 'C5', 'P8', 12], ['C#4', 'Bb4', 'd7', 9], ['C4', 'Fx4', 'AA4', 7],
  ];
  for (const [a, b, short, semis] of cases) {
    const r = iv(a, b);
    assert.equal(r.shortName, short, `${a}-${b}`);
    assert.equal(r.semitones, semis, `${a}-${b}`);
  }
});

test('names, letters and direction', () => {
  const r = iv('C4', 'G4');
  assert.equal(r.name, 'perfect fifth');
  assert.deepEqual(r.letters, ['C', 'D', 'E', 'F', 'G']);
  assert.equal(r.direction, 'ascending');

  const down = iv('E4', 'C4');
  assert.equal(down.shortName, 'M3');
  assert.equal(down.direction, 'descending');
  assert.equal(noteName(down.lower), 'C4');

  assert.equal(iv('C4', 'C4').direction, 'same');
  assert.equal(iv('Cb4', 'C4').shortName, 'A1');
  assert.equal(iv('C4', 'Cb4').direction, 'descending');
});

test('enharmonic spellings give different intervals', () => {
  assert.equal(iv('C4', 'G#4').shortName, 'A5');
  assert.equal(iv('C4', 'Ab4').shortName, 'm6');
  assert.equal(iv('C4', 'G#4').semitones, iv('C4', 'Ab4').semitones);
});

test('compound intervals', () => {
  assert.equal(iv('C4', 'D5').name, 'major ninth');
  assert.equal(iv('C4', 'E5').shortName, 'M10');
  assert.equal(iv('C4', 'C6').name, 'perfect double octave');
  assert.equal(iv('C3', 'D5').name, 'major 16th');
  assert.equal(iv('C2', 'E5').name, 'major 24th');
});

test('consonance and tritone', () => {
  assert.equal(iv('C4', 'G4').consonance, 'perfect');
  assert.equal(iv('C4', 'E4').consonance, 'imperfect');
  assert.equal(iv('C4', 'Ab4').consonance, 'imperfect');
  assert.equal(iv('C4', 'D4').consonance, 'dissonant');
  assert.ok(iv('F4', 'B4').isTritone);
  assert.ok(iv('B3', 'F4').isTritone);
  assert.ok(!iv('C4', 'G4').isTritone);
});

test('inversions', () => {
  assert.equal(invert(3, 'M').shortName, 'm6');
  assert.equal(invert(4, 'P').shortName, 'P5');
  assert.equal(invert(4, 'A').shortName, 'd5');
  assert.equal(invert(2, 'm').shortName, 'M7');
  assert.equal(invert(1, 'P').shortName, 'P8');
  assert.equal(invert(8, 'P').shortName, 'P1');
  assert.equal(invert(10, 'M').shortName, 'm6');
});

test('transpose spells notes correctly', () => {
  const t = (from, n, q) => noteName(transpose(parseNote(from), n, q));
  assert.equal(t('C4', 5, 'P'), 'G4');
  assert.equal(t('E4', 3, 'M'), 'G♯4');
  assert.equal(t('Bb3', 3, 'm'), 'D♭4');
  assert.equal(t('A4', 6, 'M'), 'F♯5');
  assert.equal(t('B3', 2, 'm'), 'C4');
  assert.equal(t('C4', 9, 'M'), 'D5');
  assert.equal(transpose(parseNote('Bx4'), 3, 'M'), null);
  assert.throws(() => transpose(parseNote('C4'), 5, 'M'));
});

test('transpose and interval agree for every note and common interval', () => {
  for (const letter of LETTERS) {
    for (const acc of [-1, 0, 1]) {
      const from = note(letter, acc, 4);
      for (const { number, quality, shortName, semitones } of COMMON_INTERVALS) {
        const to = transpose(from, number, quality);
        if (!to) continue;
        const r = interval(from, to);
        assert.equal(r.shortName, shortName, `${noteName(from)} + ${shortName}`);
        assert.equal(r.semitones, semitones);
      }
    }
  }
});

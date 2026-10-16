import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeKey } from '../src/theory/key.js';
import { parseNote, midi } from '../src/theory/pitch.js';
import { decode } from '../src/theory/decode.js';
import { parseLine, formatItem } from '../src/theory/line.js';
import { suggestFigures } from '../src/theory/rule.js';
import { voiceProgression } from '../src/theory/voicing.js';

test('typed bass line', () => {
  const items = parseLine('C  D:6/4/3  E:6 F#3/8:6/5 G/h:6/4-5/3 r/q Bb E:7,#');
  assert.equal(items.length, 8);
  assert.deepEqual([items[0].letter, items[0].acc, items[0].octave, items[0].duration, items[0].figures], [0, null, null, null, '']);
  assert.equal(items[1].figures, '6/4/3');
  assert.deepEqual([items[3].letter, items[3].acc, items[3].octave, items[3].duration, items[3].figures], [3, 1, 3, '8', '6/5']);
  assert.equal(items[4].duration, 'h');
  assert.equal(items[4].figures, '6/4-5/3');
  assert.deepEqual([items[5].rest, items[5].duration], [true, 'q']);
  assert.deepEqual([items[6].letter, items[6].acc], [6, -1]);
  assert.equal(items[7].figures, '7 #');
  assert.ok(items.every((i) => !i.error));
});

test('typed bass line errors', () => {
  const items = parseLine('C H D:6x');
  assert.ok(!items[0].error);
  assert.ok(items[1].error);
  assert.ok(items[2].error);
});

test('formatItem keeps the bass and writes figures', () => {
  const [item] = parseLine('F#3/8');
  assert.equal(formatItem({ ...item, figures: '6 5' }), 'F#3/8:6,5');
  assert.equal(formatItem(parseLine('r/h')[0]), 'r/h');
});

const key = makeKey('C', 'major');
const minor = makeKey('A', 'minor');
const n = (s) => parseNote(s);

test('rule of the octave, rising and falling in major', () => {
  const up = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C'];
  const figsUp = up.slice(0, 7).map((b, i) => suggestFigures(key, n(b), { next: n(up[i + 1]) }).figures);
  assert.deepEqual(figsUp, ['', '6/4/3', '6', '6/5', '', '6', '6/5']);
  const down = ['C', 'B', 'A', 'G', 'F', 'E', 'D', 'C'];
  const figsDown = down.slice(1, 7).map((b, i) => suggestFigures(key, n(b), { next: n(down[i + 2]) }).figures);
  assert.deepEqual(figsDown, ['6', '#6/4/3', '', '4/2', '6', '6/4/3']);
});

test('rule of the octave in minor gives the right chords', () => {
  const label = (bass, ctx) => decode(minor, n(bass), suggestFigures(minor, n(bass), ctx).figures).label;
  assert.equal(label('B', { next: n('C') }), 'V43');
  assert.equal(label('E', { next: n('F') }), 'V');
  assert.equal(label('G#', { next: n('A') }), 'V65');
  assert.equal(label('F', { next: n('E') }), 'Fr+6');
  assert.equal(label('D', { next: n('C') }), 'V42');
  assert.equal(label('G', { next: n('F') }), 'v6');
});

test('chromatic bass notes and leaps', () => {
  assert.equal(suggestFigures(key, n('F#'), { next: n('G') }).figures, '6/5');
  assert.equal(suggestFigures(key, n('Bb'), { next: n('A') }).figures, '4/2');
  assert.equal(suggestFigures(key, n('G'), { prev: n('C') }).figures, '');
  assert.equal(suggestFigures(key, n('E'), {}).figures, '6');
});

test('a fixed bass octave is respected', () => {
  const chords = [decode(key, n('C'), ''), decode(key, n('G'), '')];
  const auto = voiceProgression(chords);
  const lowG = midi({ letter: 4, acc: 0, octave: 3 });
  const fixed = voiceProgression(chords, [], [null, lowG]);
  assert.equal(fixed[1][0].midis[0], lowG);
  assert.notEqual(auto[1][0].midis[0], lowG);
  const veryLow = voiceProgression(chords, [], [midi({ letter: 0, acc: 0, octave: 1 }), null]);
  assert.ok(veryLow[0][0].issues.some((i) => i.text.includes('outside the usual range')));
});

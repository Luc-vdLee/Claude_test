import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeKey } from '../src/theory/key.js';
import { parseNote } from '../src/theory/pitch.js';
import { decode } from '../src/theory/decode.js';
import { voiceProgression } from '../src/theory/voicing.js';
import { decompose, buildVoices, layoutBars, DURATION_TICKS } from '../src/theory/score.js';

const key = makeKey('C', 'major');

function events(items) {
  const chords = items.map(([bass, figs]) => (bass ? decode(key, parseNote(bass), figs) : null));
  const voiced = voiceProgression(chords);
  return items.map(([bass, , dur], i) => ({ ticks: DURATION_TICKS[dur], rest: !bass, stages: voiced[i] }));
}

const durations = (pieces) => pieces.map((p) => p.duration + (p.dots ? '.' : '') + (p.rest ? 'r' : '') + (p.tieToNext ? '~' : '')).join(' ');
const layout = (items, opts = {}) => layoutBars(buildVoices(events(items)), { timeSig: { num: 4, den: 4 }, initialKey: 'C', ...opts });

test('decompose into note values', () => {
  assert.deepEqual(decompose(4).map((v) => v.duration), ['q']);
  assert.deepEqual(decompose(6).map((v) => [v.duration, v.dots]), [['q', 1]]);
  assert.deepEqual(decompose(10).map((v) => v.duration), ['h', '8']);
  assert.deepEqual(decompose(16).map((v) => v.duration), ['w']);
});

test('quarter notes fill 4/4 bars', () => {
  const bars = layout([['C', '', 'q'], ['F', '', 'q'], ['G', '', 'q'], ['C', '', 'q'], ['C', '', 'q']]);
  assert.equal(bars.length, 2);
  assert.equal(durations(bars[0].voices[0]), 'q q q q');
  assert.equal(durations(bars[1].voices[3]), 'q');
});

test('mixed values in 3/4', () => {
  const bars = layout([['C', '', 'h'], ['G', '', 'q'], ['C', '', '8'], ['D', '', '8'], ['E', '6', 'h']], { timeSig: { num: 3, den: 4 } });
  assert.equal(bars.length, 2);
  assert.equal(durations(bars[0].voices[0]), 'h q');
  assert.equal(durations(bars[1].voices[0]), '8 8 h');
});

test('a note crossing the barline is split and tied', () => {
  const bars = layout([['C', '', 'h'], ['F', '', 'q'], ['G', '', 'h'], ['C', '', 'q']]);
  assert.equal(durations(bars[0].voices[0]), 'h q q~');
  assert.equal(durations(bars[1].voices[0]), 'q q');
});

test('pickup bar', () => {
  const bars = layout([['G', '', 'q'], ['C', '', 'q'], ['F', '', 'q'], ['G', '', 'q'], ['C', '', 'q']], { pickup: 4 });
  assert.equal(bars.length, 2);
  assert.equal(bars[0].end, 4);
  assert.equal(durations(bars[0].voices[0]), 'q');
  assert.equal(durations(bars[1].voices[0]), 'q q q q');
});

test('suspension: bass holds while the upper voices move', () => {
  const bars = layout([['C', '4-3', 'h']]);
  assert.equal(durations(bars[0].voices[0]), 'h');
  const upper = bars[0].voices.slice(1).map(durations).sort();
  // the suspended voice moves 4->3 in quarters, the other two hold for a half
  assert.deepEqual(upper, ['h', 'h', 'q q']);
  assert.equal(bars[0].stageStarts.length, 2);
});

test('rests in all voices', () => {
  const bars = layout([[null, '', 'q'], ['C', '', 'q']]);
  for (let v = 0; v < 4; v++) assert.equal(durations(bars[0].voices[v]), 'qr q');
});

test('key signature changes at the next barline', () => {
  const built = buildVoices(events([['C', '', 'h'], ['G', '', 'h'], ['D', '', 'h'], ['G', '', 'h']]));
  const bars = layoutBars(built, { timeSig: { num: 4, den: 4 }, initialKey: 'C', keyChanges: [{ tick: 4, key: 'G' }] });
  assert.equal(bars[0].key, 'C');
  assert.equal(bars[1].key, 'G');
  assert.equal(bars[1].keyChanged, true);
});

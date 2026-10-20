import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeKey } from '../src/theory/key.js';
import { parseNote } from '../src/theory/pitch.js';
import { decode } from '../src/theory/decode.js';
import { voiceProgression } from '../src/theory/voicing.js';
import { buildVoices, DURATION_TICKS } from '../src/theory/score.js';
import { playbackNotes, tickSeconds, frequency, TEMPO } from '../src/theory/playback.js';

const key = makeKey('C', 'major');

function built(items) {
  const chords = items.map(([bass, figs]) => (bass ? decode(key, parseNote(bass), figs) : null));
  const voiced = voiceProgression(chords);
  return buildVoices(items.map(([bass, , dur], i) => ({ ticks: DURATION_TICKS[dur], rest: !bass, stages: voiced[i] })));
}

test('tempo is 72 quarter notes per minute', () => {
  assert.equal(TEMPO, 72);
  assert.ok(Math.abs(tickSeconds() * 4 - 60 / 72) < 1e-9);
  assert.equal(frequency(69), 440);
  assert.equal(Math.round(frequency(60) * 100) / 100, 261.63);
});

test('four voices per chord, timed in quarters at 72 bpm', () => {
  const { notes, events, length } = playbackNotes(built([['C', '', 'q'], ['G', '', 'q'], ['C', '', 'h']]));
  const q = 60 / 72;
  assert.equal(notes.length, 12);
  assert.deepEqual(events.map((e) => e.event), [0, 1, 2]);
  assert.ok(Math.abs(events[1].start - q) < 1e-9);
  assert.ok(Math.abs(length - 4 * q) < 1e-9);
  const last = notes.filter((n) => n.event === 2);
  assert.equal(last.length, 4);
  assert.ok(last.every((n) => Math.abs(n.duration - 2 * q) < 1e-9));
});

test('rests are silent but keep their time', () => {
  const { notes, events } = playbackNotes(built([['C', '', 'q'], [null, '', 'q'], ['G', '', 'q']]));
  assert.equal(notes.filter((n) => n.event === 1).length, 0);
  assert.ok(Math.abs(events[2].start - 2 * (60 / 72)) < 1e-9);
});

test('in a suspension the bass holds while the upper voices move', () => {
  const { notes } = playbackNotes(built([['C', '', 'q'], ['G', '4-3', 'h']]));
  const bass = notes.filter((n) => n.event === 1 && n.voice === 0);
  assert.equal(bass.length, 1);
  assert.ok(Math.abs(bass[0].duration - 2 * (60 / 72)) < 1e-9);
  assert.ok(notes.filter((n) => n.event === 1 && n.voice > 0).length > 3);
});

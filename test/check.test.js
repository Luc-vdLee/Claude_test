import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeKey } from '../src/theory/key.js';
import { parseNote, midi } from '../src/theory/pitch.js';
import { decode } from '../src/theory/decode.js';
import { buildSpec, checkVoicing } from '../src/theory/voicing.js';
import { buildVoices } from '../src/theory/score.js';

const key = makeKey('C', 'major');
const p = (s) => {
  const m = /^(.+?)(\d)$/.exec(s);
  return { ...parseNote(m[1]), octave: Number(m[2]) };
};
const spec = (bass, figs) => buildSpec(decode(key, parseNote(bass), figs).stages[0]);
const voicing = (...names) => names.map(p); // bass, tenor, alto, soprano
const texts = (r) => r.issues.map((i) => `${i.level}: ${i.text}`);
const errors = (r) => r.issues.filter((i) => i.level === 'error');

test('a correct V7 - I passes', () => {
  const v7 = spec('G', '7');
  const i = spec('C', '');
  const a = voicing('G2', 'D4', 'F4', 'B4');
  const b = voicing('C3', 'C4', 'E4', 'C5');
  const r1 = checkVoicing(v7, a, null);
  assert.deepEqual(errors(r1), [], texts(r1).join('; '));
  const r2 = checkVoicing(i, b, { spec: v7, midis: a.map(midi) });
  assert.deepEqual(errors(r2), [], texts(r2).join('; '));
});

test('wrong notes and spelling', () => {
  const r = checkVoicing(spec('C', ''), voicing('C3', 'G3', 'D4', 'E4'), null);
  assert.equal(r.valid, false);
  assert.ok(texts(r).some((t) => t.includes('Alto: D is not in this chord')));
  const r2 = checkVoicing(spec('D', '#'), voicing('D3', 'A3', 'Gb4', 'D5'), null);
  assert.ok(texts(r2).some((t) => t.includes('spell G♭ as F♯')));
});

test('missing 3rd, crossing and spacing', () => {
  const r = checkVoicing(spec('C', ''), voicing('C3', 'G3', 'C4', 'G4'), null);
  assert.ok(texts(r).some((t) => t.includes('Missing the 3rd')));
  const r2 = checkVoicing(spec('C', ''), voicing('C3', 'E4', 'C4', 'G4'), null);
  assert.ok(texts(r2).some((t) => t.includes('Voice crossing')));
  const r3 = checkVoicing(spec('C', ''), voicing('C3', 'G3', 'E4', 'C6'), null);
  assert.ok(texts(r3).some((t) => t.includes('More than an octave between soprano and alto')));
});

test('parallel fifths and an unresolved leading tone', () => {
  const c = spec('C', '');
  const d = spec('D', '');
  const a = voicing('C3', 'G3', 'E4', 'C5');
  const b = voicing('D3', 'A3', 'F4', 'D5');
  const r = checkVoicing(d, b, { spec: c, midis: a.map(midi) });
  assert.ok(texts(r).some((t) => t.includes('Parallel 5ths: Tenor and Bass')), texts(r).join('; '));
  assert.ok(texts(r).some((t) => t.includes('Parallel octaves: Soprano and Bass')));

  const v = spec('G', '');
  const i = spec('C', '');
  const before = voicing('G2', 'D4', 'G4', 'B4');
  const after = voicing('C3', 'C4', 'G4', 'G4');
  const r2 = checkVoicing(i, after, { spec: v, midis: before.map(midi) });
  assert.ok(texts(r2).some((t) => t.includes("Soprano: leading tone doesn't resolve up")), texts(r2).join('; '));
});

test('empty upper voices become invisible placeholders in the score', () => {
  const stage = { midis: [48, null, 64, null], notes: [p('C3'), null, p('E4'), null] };
  const built = buildVoices([{ ticks: 4, stages: [stage] }]);
  assert.equal(built.voices[1][0].ghost, true);
  assert.equal(built.voices[2][0].ghost, false);
  assert.equal(built.voices[0][0].note.letter, 0);
});

test('voice-leading guidelines: common tones, leaps beyond a 3rd, contrary motion', () => {
  // I to IV: C is in both chords. Holding it in the soprano is clean; leaving it is noted.
  const one = voicing('C3', 'E4', 'G4', 'C5');
  const prevOne = { spec: spec('C', ''), midis: one.map(midi) };
  const held = checkVoicing(spec('F', ''), voicing('F3', 'F4', 'A4', 'C5'), prevOne);
  assert.ok(!texts(held).some((t) => t.includes('in both chords')), texts(held).join('; '));
  const left = checkVoicing(spec('F', ''), voicing('F3', 'F4', 'A4', 'A5'), prevOne);
  assert.ok(texts(left).some((t) => t.includes('Soprano: C is in both chords')), texts(left).join('; '));
  assert.ok(texts(left).some((t) => t.includes('Soprano leaps a 6th')), texts(left).join('; '));

  // IV to V share no note: upper voices moving up with the bass are noted.
  const four = voicing('F3', 'F4', 'A4', 'C5');
  const prevFour = { spec: spec('F', ''), midis: four.map(midi) };
  const against = checkVoicing(spec('G', ''), voicing('G3', 'D4', 'G4', 'B4'), prevFour);
  assert.ok(!texts(against).some((t) => t.includes('same way as the bass')), texts(against).join('; '));
  const along = checkVoicing(spec('G', ''), voicing('G3', 'G4', 'B4', 'D5'), prevFour);
  assert.ok(texts(along).some((t) => t.includes('same way as the bass')), texts(along).join('; '));
});

test('a melodic 7th is a warning', () => {
  const a = voicing('C3', 'E4', 'G4', 'C5');
  const r = checkVoicing(spec('G', ''), voicing('G2', 'D4', 'G4', 'B5'), { spec: spec('C', ''), midis: a.map(midi) });
  assert.ok(r.issues.some((i) => i.level === 'warn' && i.text.includes('leaps a 7th')), texts(r).join('; '));
});

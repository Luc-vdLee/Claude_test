import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseNote } from '../src/theory/pitch.js';
import { makeKey } from '../src/theory/key.js';
import { decode } from '../src/theory/decode.js';
import { voiceProgression, explainVoicings } from '../src/theory/voicing.js';

const key = makeKey('C', 'major');
const chords = [['C', ''], ['G', '6'], ['A', ''], ['F', '6'], ['G', '7'], ['C', '']]
  .map(([bass, figs]) => decode(key, parseNote(bass), figs));

test('explainVoicings: penalty parts add up to each candidate\'s total, best first', () => {
  const voiced = voiceProgression(chords).flat();
  for (const v of voiced) {
    const cands = explainVoicings(v);
    assert.ok(cands.length >= 2);
    assert.equal(cands.filter((c) => c.chosen).length, 1);
    assert.deepEqual(cands.find((c) => c.chosen).midis, v.midis);
    for (let i = 0; i < cands.length; i++) {
      const sum = cands[i].parts.reduce((s, [, n]) => s + n, 0);
      assert.ok(Math.abs(sum - cands[i].cost) < 1e-9, `parts ${sum} vs total ${cands[i].cost}`);
      if (i > 0) assert.ok(cands[i].cost >= cands[i - 1].cost);
    }
  }
});

test('explainVoicings includes a voicing picked with "Try another voicing"', () => {
  const voiced = voiceProgression(chords, [[], [6]]);
  const cands = explainVoicings(voiced[1][0]);
  assert.equal(cands.length, 7);
  assert.ok(cands[6].chosen);
});

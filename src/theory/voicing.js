// Four-part (SATB) voicing in chorale style.
//
// For every chord all voicings within the voice ranges are listed and scored.
// The score adds up penalties for poor doubling and spacing and, against the
// previous chord, for large motion, parallel/direct 5ths and octaves, unresolved
// tendency tones (leading tone, 7ths, suspensions, augmented 6ths) and
// augmented melodic intervals. The lowest score wins; the rest are alternatives.

import { pc, spellingKey, sameSpelling, withOctave, intervalName } from './pitch.js';

export const VOICES = ['Bass', 'Tenor', 'Alto', 'Soprano'];
export const RANGES = { Bass: [40, 62], Tenor: [48, 67], Alto: [55, 74], Soprano: [60, 79] };

const FIRST_BASS = 48; // C3
const IDEAL_FIRST_SOPRANO = 70;

/** Per-pitch voicing requirements for one stage of a decoded chord. */
export function buildSpec(stage) {
  const { analysis, notes } = stage;
  const bass = notes[0];
  return analysis.pitches.map((p) => {
    const role = analysis.roles.get(spellingKey(p)) ?? { member: 'other', tendency: 0 };
    const sources = notes.filter((n) => sameSpelling(n, p) && n.figure !== 1);
    const isBass = sameSpelling(p, bass);
    let doubleCost;
    if (role.tendency !== 0) doubleCost = 60;
    else if (analysis.type === 'tertian') {
      const inv = analysis.inversion;
      const softThird = inv === 1 || analysis.quality !== 'major' || analysis.numeral?.base === 'N';
      doubleCost = { root: inv === 2 ? 3 : 0, fifth: inv === 2 ? 0 : 2, third: softThird ? 1 : 4, seventh: 60 }[role.member] ?? 3;
    } else if (analysis.type === 'aug6') {
      doubleCost = role.member === 'aug6-third' ? 0 : 5;
    } else doubleCost = isBass ? 0 : 3;

    const optional = analysis.type === 'tertian' && role.member === 'fifth' && analysis.inversion === 0
      && sources.length > 0 && sources.every((n) => n.implicit);
    return {
      note: p,
      pc: pc(p),
      member: role.member,
      tendency: role.tendency,
      suspension: role.suspension ?? null,
      kind: tendencyKind(role, analysis),
      doubleCost,
      required: !optional,
      seventhChord: analysis.type === 'tertian' && analysis.isSeventh,
    };
  });
}

function tendencyKind(role, analysis) {
  if (!role.tendency) return null;
  if (role.suspension) return 'suspension';
  if (role.member === 'seventh') return 'seventh';
  if (role.member.startsWith('aug6')) return 'aug6';
  if (analysis.type === 'tertian' && role.tendency > 0) return 'leading tone';
  return 'tendency';
}

function rangeOptions([lo, hi], pcs) {
  const out = [];
  for (let m = lo; m <= hi; m++) if (pcs.has(((m % 12) + 12) % 12)) out.push(m);
  return out;
}

/** Possible bass octaves with a cost: stay close to the previous bass, keep it low-ish. */
function bassOptions(spec, prevBass) {
  const bassPc = spec[0].pc;
  const target = prevBass ?? FIRST_BASS;
  const out = [];
  for (let m = RANGES.Bass[0]; m <= RANGES.Bass[1]; m++) {
    if (((m % 12) + 12) % 12 !== bassPc) continue;
    let cost = Math.abs(m - target) * 0.4;
    if (m > 55) cost += (m - 55) * 1.5;
    if (m < 43) cost += 43 - m;
    out.push({ midi: m, cost });
  }
  return out;
}

function staticCost(spec, midis, issues) {
  let cost = 0;
  const counts = new Map(spec.map((e) => [e.pc, 0]));
  for (const m of midis) counts.set(((m % 12) + 12) % 12, counts.get(((m % 12) + 12) % 12) + 1);
  for (const e of spec) {
    const c = counts.get(e.pc);
    if (c === 0) {
      if (e.required) return Infinity;
      cost += e.seventhChord ? 3 : 8;
      issues?.push({ level: 'info', text: 'The 5th is left out (allowed in root position).' });
    } else if (c > 1) {
      cost += (c - 1) * e.doubleCost + (c > 2 ? 4 : 0);
      if (e.doubleCost >= 60) issues?.push({ level: 'warn', text: `Doubled ${e.kind ?? 'tendency tone'} — avoid doubling notes that must resolve.` });
    }
  }
  const [b, t, a, s] = midis;
  if (t - b > 19) cost += (t - b - 19);
  return cost;
}

const PAIRS = [];
for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) PAIRS.push([i, j]);

function entryFor(spec, midi) {
  return spec.find((e) => e.pc === ((midi % 12) + 12) % 12);
}

function transitionCost(prevSpec, prev, spec, cur, issues) {
  let cost = 0;

  for (let v = 1; v < 4; v++) {
    const d = Math.abs(cur[v] - prev[v]);
    cost += d;
    if (d > 5) cost += (d - 5) * 2;
    if (d > 12) {
      cost += 30;
      issues?.push({ level: 'warn', text: `${VOICES[v]} leaps more than an octave.` });
    }
    if (v < 3 && cur[v] > prev[v + 1]) { cost += 6; issues?.push({ level: 'info', text: `${VOICES[v]} overlaps the previous ${VOICES[v + 1].toLowerCase()} note.` }); }
    if (v > 0 && cur[v] < prev[v - 1]) { cost += 6; issues?.push({ level: 'info', text: `${VOICES[v]} overlaps the previous ${VOICES[v - 1].toLowerCase()} note.` }); }
  }

  for (const [i, j] of PAIRS) {
    if (prev[i] === cur[i] || prev[j] === cur[j]) continue;
    const pi = (((prev[j] - prev[i]) % 12) + 12) % 12;
    const ci = (((cur[j] - cur[i]) % 12) + 12) % 12;
    if (pi === ci && (ci === 0 || ci === 7)) {
      cost += 100;
      issues?.push({ level: 'error', text: `Parallel ${ci === 7 ? '5ths' : 'octaves'}: ${VOICES[j]} and ${VOICES[i]}.` });
    }
  }

  const dS = cur[3] - prev[3];
  const dB = cur[0] - prev[0];
  const outer = (((cur[3] - cur[0]) % 12) + 12) % 12;
  if (dS !== 0 && dB !== 0 && Math.sign(dS) === Math.sign(dB) && (outer === 0 || outer === 7) && Math.abs(dS) > 2) {
    cost += 15;
    issues?.push({ level: 'warn', text: `Direct ${outer === 7 ? '5th' : 'octave'} between Soprano and Bass (similar motion with a leap in the soprano).` });
  }

  for (let v = 1; v < 4; v++) {
    const from = entryFor(prevSpec, prev[v]);
    if (!from?.tendency) continue;
    const resolution = spec.find((e) => {
      const letterStep = (((e.note.letter - from.note.letter) % 7) + 7) % 7;
      return letterStep === (from.tendency > 0 ? 1 : 6);
    });
    const toEntry = entryFor(spec, cur[v]);
    if (resolution) {
      const resolved = sameSpelling(toEntry.note, resolution.note) && Math.sign(cur[v] - prev[v]) === from.tendency && Math.abs(cur[v] - prev[v]) <= 2;
      if (!resolved) {
        let penalty = { suspension: 120, seventh: 40, aug6: 40 }[from.kind] ?? (v === 3 ? 40 : 10);
        if (from.kind === 'seventh' && cur[v] === prev[v]) penalty = 15;
        cost += penalty;
        const dir = from.tendency > 0 ? 'up' : 'down';
        issues?.push({ level: penalty >= 40 ? 'error' : 'warn', text: `${VOICES[v]}: ${from.kind ?? 'tendency tone'} doesn't resolve ${dir} by step.` });
      }
    }
  }

  for (let v = 1; v < 4; v++) {
    if (prev[v] === cur[v]) continue;
    const a = withOctave(entryFor(prevSpec, prev[v]).note, prev[v]);
    const b = withOctave(entryFor(spec, cur[v]).note, cur[v]);
    const iv = intervalName(a, b);
    if (iv.quality.startsWith('A') || iv.quality.startsWith('d')) {
      cost += iv.quality.startsWith('A') ? 20 : 4;
      if (iv.quality.startsWith('A')) issues?.push({ level: 'warn', text: `${VOICES[v]} moves by an augmented interval (${iv.short}).` });
    }
  }
  return cost;
}

function firstChordCost(midis) {
  const [, t, a, s] = midis;
  return Math.abs(s - IDEAL_FIRST_SOPRANO) / 2 + Math.max(0, s - a - 7) / 2 + Math.max(0, a - t - 7) / 2;
}

/** All valid voicings of a chord, best first. */
export function rankVoicings(spec, prev, prevBass) {
  const pcs = new Set(spec.map((e) => e.pc));
  const sOpts = rangeOptions(RANGES.Soprano, pcs);
  const aOpts = rangeOptions(RANGES.Alto, pcs);
  const tOpts = rangeOptions(RANGES.Tenor, pcs);
  const out = [];
  for (const { midi: bass, cost: bassCost } of bassOptions(spec, prev ? prev.midis[0] : prevBass)) for (const s of sOpts) {
    for (const a of aOpts) {
      if (a > s || s - a > 12) continue;
      for (const t of tOpts) {
        if (t > a || a - t > 12 || t < bass) continue;
        const midis = [bass, t, a, s];
        let cost = staticCost(spec, midis) + bassCost;
        if (!Number.isFinite(cost)) continue;
        cost += prev ? transitionCost(prev.spec, prev.midis, spec, midis) : firstChordCost(midis);
        out.push({ midis, cost });
      }
    }
  }
  out.sort((x, y) => x.cost - y.cost || x.midis[3] - y.midis[3]);
  return out;
}

function describe(spec, midis, prev) {
  const issues = [];
  staticCost(spec, midis, issues);
  if (prev) transitionCost(prev.spec, prev.midis, spec, midis, issues);
  const seen = new Set();
  return issues.filter((i) => (seen.has(i.text) ? false : seen.add(i.text)));
}

/**
 * Voice a whole progression. `chords` is a list of decoded chords (from decode());
 * `choices[i][stage]` picks an alternative (0 = best) for that stage.
 * Returns, per chord, a list of stage voicings.
 */
export function voiceProgression(chords, choices = []) {
  let prev = null;
  return chords.map((chord, ci) => chord.stages.map((stage, si) => {
    const spec = buildSpec(stage);
    const ranked = rankVoicings(spec, prev, null);
    if (ranked.length === 0) {
      prev = null;
      return { spec, midis: null, notes: null, issues: [{ level: 'error', text: 'No four-part voicing fits the voice ranges.' }], alternatives: 0, choice: 0 };
    }
    const choice = Math.min(choices[ci]?.[si] ?? 0, ranked.length - 1);
    const { midis } = ranked[choice];
    const notes = midis.map((m) => withOctave(entryFor(spec, m).note, m));
    const result = { spec, midis, notes, issues: describe(spec, midis, prev), alternatives: ranked.length, choice, prevMidis: prev?.midis ?? null };
    prev = { spec, midis };
    return result;
  }));
}

/** For each voice: tendency of the note it sings in this voicing, if any. */
export function tendenciesOf(voiced) {
  if (!voiced.midis) return [];
  return voiced.midis.map((m) => {
    const e = entryFor(voiced.spec, m);
    return e.tendency ? { kind: e.kind, direction: e.tendency, suspension: e.suspension } : null;
  });
}

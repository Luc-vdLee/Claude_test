// Rhythm and bar layout for the notated progression.
//
// Time is counted in sixteenth notes ("ticks"). Each progression event (a chord
// or a rest) becomes one segment per voice; suspensions split the upper voices
// while the bass holds. Segments are then cut at barlines and written as
// standard note values, tied where a note crosses a barline.

export const DURATION_TICKS = { 8: 2, q: 4, h: 8 };
export const DURATION_NAMES = { 8: 'eighth', q: 'quarter', h: 'half' };

// Note values that can be written as a single note: [ticks, vexflow duration, dots]
const NOTE_VALUES = [
  [16, 'w', 0], [12, 'h', 1], [8, 'h', 0], [6, 'q', 1], [4, 'q', 0], [3, '8', 1], [2, '8', 0], [1, '16', 0],
];

export function barTicks(timeSig) {
  return (timeSig.num * 16) / timeSig.den;
}

/** Split a length into writable note values, longest first. */
export function decompose(ticks) {
  const out = [];
  let left = ticks;
  while (left > 0) {
    const [t, duration, dots] = NOTE_VALUES.find(([v]) => v <= left);
    out.push({ ticks: t, duration, dots });
    left -= t;
  }
  return out;
}

/** Split `total` ticks into `parts` near-equal pieces (remainder goes to the last). */
function splitEvenly(total, parts) {
  const base = Math.floor(total / parts);
  if (base === 0) return [total, ...Array(parts - 1).fill(0)];
  return Array.from({ length: parts }, (_, i) => (i === parts - 1 ? total - base * (parts - 1) : base));
}

/**
 * Build per-voice segments.
 * @param {Array<{ticks:number, rest?:boolean, stages?:Array<{midis:number[]|null, notes:object[]|null}>}>} events
 * @returns {{ voices: Array<Array<{start, ticks, note, midi, event, stage}>>, stageStarts: Array<{tick, event, stage}>, total: number }}
 */
export function buildVoices(events) {
  const voices = [[], [], [], []];
  const stageStarts = [];
  let t = 0;
  events.forEach((ev, ei) => {
    const playable = !ev.rest && ev.stages?.length && ev.stages.every((s) => s.midis);
    if (!playable) {
      for (const v of voices) v.push({ start: t, ticks: ev.ticks, note: null, midi: null, event: ei, stage: 0 });
      if (!ev.rest) stageStarts.push({ tick: t, event: ei, stage: 0 });
      t += ev.ticks;
      return;
    }
    const parts = splitEvenly(ev.ticks, ev.stages.length);
    let s = t;
    ev.stages.forEach((stage, si) => {
      if (parts[si] > 0) stageStarts.push({ tick: s, event: ei, stage: si });
      s += parts[si];
    });
    voices[0].push({ start: t, ticks: ev.ticks, note: ev.stages[0].notes[0], midi: ev.stages[0].midis[0], event: ei, stage: 0 });
    for (let v = 1; v < 4; v++) {
      let start = t;
      ev.stages.forEach((stage, si) => {
        const len = parts[si];
        if (len === 0) return;
        const last = voices[v][voices[v].length - 1];
        if (si > 0 && last && last.event === ei && last.midi === stage.midis[v]) last.ticks += len; // held note
        else voices[v].push({ start, ticks: len, note: stage.notes[v], midi: stage.midis[v], event: ei, stage: si });
        start += len;
      });
    }
    t += ev.ticks;
  });
  return { voices, stageStarts, total: t };
}

/** Index of the bar containing `tick`, and that bar's start/end. */
function barOf(tick, bar, pickup) {
  if (pickup > 0 && tick < pickup) return { index: 0, start: 0, end: pickup };
  const offset = pickup > 0 ? pickup : 0;
  const n = Math.floor((tick - offset) / bar);
  return { index: n + (pickup > 0 ? 1 : 0), start: offset + n * bar, end: offset + (n + 1) * bar };
}

/**
 * Lay the voices out in bars.
 * @param {{voices, stageStarts, total}} built   from buildVoices
 * @param {{timeSig:{num,den}, pickup?:number, initialKey:string, keyChanges?:Array<{tick:number, key:string}>}} opts
 * @returns Array of bars: { index, start, end, key, keyChanged, voices: [[piece]], stageStarts }
 *   piece: { start, ticks, duration, dots, note, rest, event, stage, tieToNext }
 */
export function layoutBars(built, opts) {
  const bar = barTicks(opts.timeSig);
  const pickup = opts.pickup > 0 && opts.pickup < bar ? opts.pickup : 0;
  const bars = [];
  const getBar = (tick) => {
    const b = barOf(tick, bar, pickup);
    while (bars.length <= b.index) {
      const nb = barOf(bars.length === 0 ? 0 : bars[bars.length - 1].end, bar, pickup);
      bars.push({ index: nb.index, start: nb.start, end: nb.end, voices: [[], [], [], []], stageStarts: [] });
    }
    return bars[b.index];
  };

  built.voices.forEach((segments, v) => {
    for (const seg of segments) {
      let pos = seg.start;
      const end = seg.start + seg.ticks;
      while (pos < end) {
        const b = getBar(pos);
        const pieceEnd = Math.min(end, b.end);
        const values = decompose(pieceEnd - pos);
        values.forEach((val) => {
          b.voices[v].push({
            start: pos, ticks: val.ticks, duration: val.duration, dots: val.dots,
            note: seg.note, rest: !seg.note, event: seg.event, stage: seg.stage,
            tieToNext: !!seg.note && pos + val.ticks < end,
          });
          pos += val.ticks;
        });
      }
    }
  });
  if (bars.length === 0 && built.total === 0) return [];
  for (const s of built.stageStarts) getBar(s.tick).stageStarts.push(s);

  // Key signatures: a change takes effect at the first barline at or after the chord.
  let key = opts.initialKey;
  const changes = [...(opts.keyChanges ?? [])].sort((a, b) => a.tick - b.tick);
  for (const b of bars) {
    let changed = false;
    while (changes.length && changes[0].tick <= b.start) {
      const c = changes.shift();
      if (c.key !== key) { key = c.key; changed = b.index > 0; }
    }
    b.key = key;
    b.keyChanged = changed;
  }
  // Changes after the last barline open a new (empty) bar only if needed; otherwise ignored.
  return bars;
}

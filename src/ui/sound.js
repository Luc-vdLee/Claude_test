// A small Web Audio synth that plays the progression, one gain per voice so
// voices can be switched on and off while it plays.

import { frequency } from '../theory/playback.js';

let ctx = null;
let master = null;
const voiceGains = [];
let session = null; // { timers, nodes, onStop }

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(comp);
    for (let v = 0; v < 4; v++) {
      const g = ctx.createGain();
      g.connect(master);
      voiceGains.push(g);
    }
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export const soundAvailable = () => !!(window.AudioContext || window.webkitAudioContext);

/** Which voices are heard: [bass, tenor, alto, soprano]. Takes effect at once. */
export function setVoices(on) {
  if (!audio()) return;
  on.forEach((v, i) => voiceGains[i].gain.setTargetAtTime(v ? 1 : 0, ctx.currentTime, 0.015));
}

/** One note: a soft, slightly organ-like tone with a short attack and release. */
function note(voice, midiNum, start, duration, nodes) {
  const end = start + Math.max(0.05, duration - 0.03);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(0.16, start + 0.02);
  env.gain.setTargetAtTime(0.1, start + 0.02, 0.25);
  env.gain.setTargetAtTime(0, end, 0.03);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 2400;
  filter.connect(env);
  env.connect(voiceGains[voice]);
  const f = frequency(midiNum);
  for (const [type, mult, level] of [['triangle', 1, 1], ['sine', 2, 0.25]]) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = f * mult;
    const g = ctx.createGain();
    g.gain.value = level;
    osc.connect(g).connect(filter);
    osc.start(start);
    osc.stop(end + 0.2);
    nodes.push(osc);
  }
}

/**
 * Play timed notes (from playbackNotes). `onEvent(i)` is called as each chord starts,
 * `onStop()` when playback ends or is stopped. With `loop`, it starts over at the end.
 */
export function play({ notes, events, length }, { loop = () => false, onEvent = () => {}, onStop = () => {} } = {}) {
  stop();
  if (!audio() || !notes.length) { onStop(); return; }
  const s = { timers: [], nodes: [], onStop };
  session = s;
  const pass = (t0) => {
    const nodes = [];
    for (const n of notes) note(n.voice, n.midi, t0 + n.start, n.duration, nodes);
    s.nodes = [...s.lastNodes ?? [], ...nodes];
    s.lastNodes = nodes;
    const delay = (t) => Math.max(0, (t0 + t - ctx.currentTime) * 1000);
    for (const e of events) s.timers.push(setTimeout(() => onEvent(e.event), delay(e.start)));
    // Decide about the next pass a moment early, so a loop starts exactly on time.
    s.timers.push(setTimeout(() => {
      if (session !== s) return;
      if (loop()) pass(t0 + length);
      else s.timers.push(setTimeout(() => { if (session === s) stop(); }, delay(length)));
    }, delay(length - 0.25)));
  };
  pass(ctx.currentTime + 0.08);
}

/** Play a single chord (midi numbers, bass first) for `seconds`. */
export function playChord(midis, seconds = 1.2) {
  if (!audio()) return;
  const t0 = ctx.currentTime + 0.03;
  midis.forEach((m, v) => { if (m != null) note(v, m, t0, seconds, []); });
}

export function stop() {
  const s = session;
  if (!s) return;
  session = null;
  s.timers.forEach(clearTimeout);
  const now = ctx.currentTime;
  for (const o of s.nodes) { try { o.stop(now + 0.05); } catch { /* already stopped */ } }
  s.onStop();
}

export const isPlaying = () => !!session;

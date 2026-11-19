// A small Web Audio synth that plays the progression, one gain per voice so
// voices can be switched on and off while it plays.

import { frequency } from '../theory/playback.js';

let ctx = null;
let master = null;
const voiceGains = [];
let wantedVoices = [true, true, true, true];
let session = null; // { timers, nodes, onStop }

// Sound starts only from a button press (Play, adding a chord, Hear): nothing here runs on
// its own, and no audio exists until the first such press.
//
// iPhone and iPad: Web Audio is muted by the silent switch unless a media element plays at
// the same time. So while (and only while) the app makes sound, a short silent clip plays on
// a loop. It holds half a second of real silence: a clip of zero length on a loop makes the
// browser restart it thousands of times a second and keeps the page busy.
const SILENT_WAV = (() => {
  const samples = 4000; // 0.5 s at 8 kHz, 8-bit mono
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (at, str) => { for (let i = 0; i < str.length; i++) bytes[at + i] = str.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, 36 + samples, true); text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true); view.setUint32(28, 8000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
  text(36, 'data'); view.setUint32(40, samples, true);
  bytes.fill(128, 44); // 8-bit silence
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:audio/wav;base64,${btoa(bin)}`;
})();
let silentEl = null;
let silentTimer = null;

/** The audio engine, created on the first sound request (which is always a button press). */
function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    // Safari 16.4+: treat this page's sound as media playback, not as a ringer sound.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* not supported */ }
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(comp);
    for (let v = 0; v < 4; v++) {
      const g = ctx.createGain();
      g.gain.value = wantedVoices[v] ? 1 : 0;
      g.connect(master);
      voiceGains.push(g);
    }
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  return ctx;
}

/** Keep the silent clip playing for `ms` (or until releaseMedia), so iOS plays the sound. */
function holdMedia(ms = null) {
  if (!silentEl) {
    silentEl = document.createElement('audio');
    silentEl.src = SILENT_WAV;
    silentEl.loop = true;
    silentEl.setAttribute('playsinline', '');
    silentEl.setAttribute('x-webkit-airplay', 'deny');
    silentEl.preload = 'auto';
  }
  clearTimeout(silentTimer);
  // While the whole harmony plays, the clip runs until stop().
  silentTimer = ms == null || session ? null : setTimeout(releaseMedia, ms);
  if (silentEl.paused) silentEl.play().catch(() => {});
}

function releaseMedia() {
  clearTimeout(silentTimer);
  silentTimer = null;
  if (silentEl && !silentEl.paused) silentEl.pause();
}

export const soundAvailable = () => !!(window.AudioContext || window.webkitAudioContext);

/** Which voices are heard: [bass, tenor, alto, soprano]. Takes effect at once (makes no sound). */
export function setVoices(on) {
  wantedVoices = [...on];
  if (!ctx) return;
  on.forEach((v, i) => voiceGains[i].gain.setTargetAtTime(v ? 1 : 0, ctx.currentTime, 0.015));
}

/** One note: a soft, slightly organ-like tone with a short attack and release. */
function note(voice, midiNum, start, duration, nodes) {
  const end = start + Math.max(0.05, duration - 0.03);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(0.24, start + 0.02);
  env.gain.setTargetAtTime(0.15, start + 0.02, 0.25);
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
  holdMedia();
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
  holdMedia((seconds + 0.5) * 1000);
  const t0 = ctx.currentTime + 0.03;
  midis.forEach((m, v) => { if (m != null) note(v, m, t0, seconds, []); });
}

export function stop() {
  const s = session;
  releaseMedia();
  if (!s) return;
  session = null;
  s.timers.forEach(clearTimeout);
  const now = ctx.currentTime;
  for (const o of s.nodes) { try { o.stop(now + 0.05); } catch { /* already stopped */ } }
  s.onStop();
}

export const isPlaying = () => !!session;

import { LETTERS, noteName, pitchName, intervalName, parseNote, pc, midi, spellingKey, sameSpelling, spellOnLetter, withOctave } from '../theory/pitch.js';
import { makeKey, KEY_TONICS, KEY_SIGNATURES, signatureAcc, signatureSpec, keyName } from '../theory/key.js';
import { parseFigures, figureLines } from '../theory/figures.js';
import { decode } from '../theory/decode.js';
import { chordSymbolText, numeralText } from '../theory/chord.js';
import { voiceProgression, tendenciesOf, checkVoicing, VOICES } from '../theory/voicing.js';
import { parseLine, formatItem } from '../theory/line.js';
import { suggestFigures } from '../theory/rule.js';
import { buildVoices, layoutBars, barTicks, DURATION_TICKS, DURATION_NAMES } from '../theory/score.js';
import { renderScore } from './staff.js';
import { renderKeyboard, VOICE_COLORS } from './keyboard.js';
import { playbackNotes } from '../theory/playback.js';
import * as sound from './sound.js';

const STORAGE_KEY = 'figured-bass-decoder:v1';
const EXERCISES_KEY = 'figured-bass-decoder:exercises';
const MAX_ALTERNATIVES = 8;
const PREVIEW_COLOR = '#b0601e';
const EDIT_COLOR = '#1d5fa8';
const PLAY_COLOR = '#2f7d3a';

const FIGURE_BUTTONS = ['', '5/3', '6', '6/4', '7', '6/5', '4/3', '4/2', '#', 'b', 'n', '7 #', '#6', '4-3', '9-8', '7-6', '6/4-5/3'];
// Parts of the page that can be switched off in Settings (all on by default).
const PARTS = [
  ['octave', 'Bass octave controls'],
  ['figureButtons', 'Figure buttons, Quick add and Suggest'],
  ['figureHelp', 'How to type figures'],
  ['noteValues', 'Note values and Rest'],
  ['lineEntry', 'Type a whole bass line'],
  ['voicePanel', 'Voice leading (SATB)'],
  ['keyboard', 'Piano keyboard'],
  ['sound', 'Sound: Play, voices and Loop'],
  ['practice', 'Practice mode'],
  ['scoreSettings', 'Score settings'],
  ['print', 'Print / PDF'],
  ['exercises', 'Exercises'],
];
const INPUT_FIELDS = ['tonic', 'mode', 'bassLetter', 'bassAcc', 'bassOctave', 'figures', 'duration', 'rest', 'newKeySig'];

const defaults = () => ({
  tonic: 'C',
  mode: 'major',
  bassLetter: 0,
  bassAcc: 'key',
  bassOctave: null, // null = chosen automatically
  figures: '',
  duration: 'q',
  rest: false,
  newKeySig: false,
  previewChoice: [],
  progression: [],
  target: { type: 'append' }, // or { type: 'edit' | 'insert', index }
  draft: null, // the new-chord inputs, kept while editing another chord
  suggestion: null, // explanation of the last suggested figures
  practice: { on: false, voice: 3, sel: null, showSolution: false, checked: false },
  exerciseId: null,
  exerciseName: 'Exercise 1',
  lineText: '',
  settings: {
    names: 'english',
    autoRaise: false,
    quickAdd: false,
    show: Object.fromEntries(PARTS.map(([k]) => [k, true])),
    sound: { voices: [true, true, true, true], loop: false }, // voices: bass, tenor, alto, soprano
  },
  score: { timeSig: '4/4', customNum: 5, customDen: 4, pickup: 0, keySig: 'auto' },
});

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const saved = JSON.parse(raw);
    const d = defaults();
    const settings = { ...d.settings, ...saved.settings };
    settings.show = { ...d.settings.show, ...saved.settings?.show };
    settings.sound = { ...d.settings.sound, ...saved.settings?.sound };
    const s = { ...d, ...saved, settings, score: { ...d.score, ...saved.score }, practice: { ...d.practice, ...saved.practice } };
    if (s.target?.type !== 'append' && !(s.target?.index < s.progression.length + (s.target?.type === 'insert' ? 1 : 0))) s.target = d.target;
    return s;
  } catch {
    return defaults();
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* storage unavailable: fine */ }
  saveCurrentExercise();
}

// ---------------------------------------------------------------- exercises

let exercises = loadExercises();

function loadExercises() {
  try {
    const list = JSON.parse(localStorage.getItem(EXERCISES_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function storeExercises() {
  try {
    localStorage.setItem(EXERCISES_KEY, JSON.stringify(exercises));
  } catch { /* storage unavailable: fine */ }
}

const newId = () => `ex-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function exerciseData() {
  return { tonic: state.tonic, mode: state.mode, progression: state.progression, score: state.score };
}

function saveCurrentExercise() {
  if (!state.exerciseId) state.exerciseId = newId();
  const data = JSON.parse(JSON.stringify(exerciseData()));
  const existing = exercises.find((x) => x.id === state.exerciseId);
  if (existing) Object.assign(existing, { name: state.exerciseName, data, updated: Date.now() });
  else exercises.unshift({ id: state.exerciseId, name: state.exerciseName, data, updated: Date.now() });
  storeExercises();
}

function openExercise(x) {
  const d = x.data ?? {};
  state.exerciseId = x.id;
  state.exerciseName = x.name;
  state.progression = Array.isArray(d.progression) ? d.progression : [];
  if (d.score) state.score = { ...defaults().score, ...d.score };
  if (d.tonic) { state.tonic = d.tonic; state.mode = d.mode ?? 'major'; }
  backToAppend();
  state.practice.sel = null;
  state.previewChoice = [];
}

function uniqueName(base) {
  const names = new Set(exercises.map((x) => x.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

function newExercise(name, data) {
  saveCurrentExercise();
  const x = { id: newId(), name: uniqueName(name), data: data ?? { tonic: state.tonic, mode: state.mode, progression: [], score: state.score }, updated: Date.now() };
  exercises.unshift(x);
  openExercise(x);
  update();
}

function renderExercises() {
  const nameInput = $('exercise-name');
  if (document.activeElement !== nameInput) nameInput.value = state.exerciseName;
  const fmt = (t) => new Date(t).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
  $('exercise-list').innerHTML = exercises.map((x) => {
    const n = x.data?.progression?.length ?? 0;
    const current = x.id === state.exerciseId;
    return `<li class="${current ? 'current' : ''}">
      <span class="ex-name">${esc(x.name)}<span class="ex-meta">${n} chord${n === 1 ? '' : 's'} · ${esc(fmt(x.updated))}${current ? ' · open' : ''}</span></span>
      ${current ? '' : `<button class="ghost" data-open="${x.id}">Open</button>`}
      <button class="ghost danger" data-delete="${x.id}" title="Delete">Delete</button>
    </li>`;
  }).join('');
}

function exportExercise() {
  const payload = { app: 'figured-bass-decoder', version: 1, name: state.exerciseName, data: exerciseData() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(state.exerciseName || 'exercise').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'exercise'}.figbass.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importExercise(file) {
  try {
    const payload = JSON.parse(await file.text());
    if (payload?.app !== 'figured-bass-decoder' || !Array.isArray(payload?.data?.progression)) throw new Error('not an exercise file');
    newExercise(payload.name || file.name.replace(/\.figbass\.json$|\.json$/, ''), payload.data);
  } catch (err) {
    alert(`Couldn't open that file: ${err.message}.`);
  }
}

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sys = () => state.settings.names;
const nn = (note) => noteName(note, sys());
const entryKey = (e) => makeKey(e.tonic, e.mode);
const durationOf = (e) => e.duration ?? 'q';

// ---------------------------------------------------------------- model

const currentKey = () => makeKey(state.tonic, state.mode);

function currentBass() {
  const acc = state.bassAcc === 'key' ? signatureAcc(currentKey(), state.bassLetter) : Number(state.bassAcc);
  return { letter: state.bassLetter, acc };
}

const decodeOptions = () => ({ autoRaise: state.settings.autoRaise });

function inputEntry() {
  return {
    tonic: state.tonic,
    mode: state.mode,
    bass: currentBass(),
    bassOctave: state.bassOctave,
    figures: state.figures.trim(),
    duration: state.duration,
    rest: state.rest,
    newKeySig: state.newKeySig,
    choice: state.previewChoice,
  };
}

const decodeEntry = (e) => (e.rest ? null : decode(entryKey(e), e.bass, e.figures, decodeOptions()));

function timeSig() {
  if (state.score.timeSig === 'custom') {
    const num = Math.min(16, Math.max(1, Math.round(Number(state.score.customNum)) || 4));
    return { num, den: Number(state.score.customDen) || 4 };
  }
  const [num, den] = state.score.timeSig.split('/').map(Number);
  return { num, den };
}

/**
 * The progression as it would be with the current input applied
 * (appended, inserted or replacing the chord being edited).
 */
function compute() {
  const input = inputEntry();
  const inputDecoded = decodeEntry(input);
  const inputValid = input.rest || !inputDecoded.error;
  const entries = [...state.progression];
  const t = state.target;
  let focus = null;
  const practicing = state.practice.on && t.type === 'append';
  if (practicing) {
    focus = state.practice.sel && state.practice.sel.event < entries.length ? state.practice.sel.event : null;
  } else if (inputValid) {
    if (t.type === 'edit') { entries[t.index] = input; focus = t.index; }
    else if (t.type === 'insert') { entries.splice(t.index, 0, input); focus = t.index; }
    else { entries.push(input); focus = entries.length - 1; }
  }
  const decoded = entries.map((e, i) => (i === focus && !practicing ? inputDecoded : decodeEntry(e)));
  const fixedBass = entries.map((e) => (e.rest || e.bassOctave == null ? null : midi({ ...e.bass, octave: e.bassOctave })));
  const voiced = voiceProgression(decoded, entries.map((e) => e.choice ?? []), fixedBass);
  const model = { entries, decoded, voiced, focus, input, inputDecoded, inputValid, practicing };
  if (state.practice.on) model.practice = practiceResults(model);
  return model;
}

// ---------------------------------------------------------------- practice

const userNotes = (entry, stage) => entry.user?.[stage] ?? [null, null, null, null];

/** Check every chord step the user has fully written. */
function practiceResults(model) {
  const steps = [];
  let prev = null;
  model.entries.forEach((e, i) => {
    if (e.rest || !model.voiced[i]) return;
    model.voiced[i].forEach((v, si) => {
      const user = userNotes(e, si);
      const bass = v.notes?.[0];
      const complete = !!bass && user.slice(1).every(Boolean);
      let result = null;
      if (complete) {
        const notes = [bass, user[1], user[2], user[3]];
        result = checkVoicing(v.spec, notes, prev);
        prev = result.valid ? { spec: v.spec, midis: notes.map(midi) } : null;
      } else {
        prev = null;
      }
      steps.push({ event: i, stage: si, complete, result, bass, user });
    });
  });
  return steps;
}

function stepStatus(step) {
  if (!step?.complete) return 'incomplete';
  if (step.result.issues.some((x) => x.level === 'error')) return 'error';
  if (step.result.issues.some((x) => x.level === 'warn')) return 'warn';
  return 'ok';
}

const STATUS_COLOR = { ok: '#2f7d3a', warn: '#a66a00', error: '#b3261e' };

/** Spell a key press: as a chord tone if possible, else by the key signature, else with a sharp. */
function spellMidi(m, spec, key) {
  const pcm = ((m % 12) + 12) % 12;
  const tone = spec?.find((e) => e.pc === pcm);
  if (tone) return withOctave(tone.note, m);
  for (let l = 0; l < 7; l++) {
    const n = { letter: l, acc: signatureAcc(key, l) };
    if (pc(n) === pcm) return withOctave(n, m);
  }
  const natural = [0, 2, 4, 5, 7, 9, 11].filter((x) => x <= pcm).length - 1;
  return withOctave(spellOnLetter(natural, pcm), m);
}

function stepsOrder(model) {
  return model.practice.map((s) => ({ event: s.event, stage: s.stage }));
}

function advance(model) {
  const p = state.practice;
  if (p.voice > 1) { p.voice -= 1; return; }
  const order = stepsOrder(model);
  const i = order.findIndex((s) => s.event === p.sel.event && s.stage === p.sel.stage);
  if (i >= 0 && i < order.length - 1) p.sel = order[i + 1];
  p.voice = 3;
}

function setUserNote(event, stage, voice, note) {
  const e = state.progression[event];
  if (!e || e.rest) return;
  const stages = model0().voiced[event]?.length ?? 1;
  e.user = Array.from({ length: stages }, (_, si) => [...(e.user?.[si] ?? [null, null, null, null])]);
  e.user[stage][voice] = note;
}

const model0 = () => compute();

function placeFromStaff(hit) {
  const e = state.progression[hit.event];
  if (!e || e.rest) return;
  state.practice.sel = { event: hit.event, stage: hit.stage };
  if (hit.diatonic != null) {
    const model = compute();
    const spec = model.voiced[hit.event]?.[hit.stage]?.spec;
    const letter = ((hit.diatonic % 7) + 7) % 7;
    const octave = Math.floor(hit.diatonic / 7);
    const tone = spec?.find((x) => x.note.letter === letter);
    const acc = tone ? tone.note.acc : signatureAcc(entryKey(e), letter);
    setUserNote(hit.event, hit.stage, state.practice.voice, { letter, acc, octave });
    advance(compute());
  }
  update();
}

function placeFromKey(m) {
  const sel = state.practice.sel;
  if (!sel) return;
  const e = state.progression[sel.event];
  const model = compute();
  const spec = model.voiced[sel.event]?.[sel.stage]?.spec;
  setUserNote(sel.event, sel.stage, state.practice.voice, spellMidi(m, spec, entryKey(e)));
  advance(compute());
  update();
}

function changeSelectedNote(fn) {
  const sel = state.practice.sel;
  if (!sel) return;
  const e = state.progression[sel.event];
  const note = userNotes(e, sel.stage)[state.practice.voice];
  if (!note) return;
  setUserNote(sel.event, sel.stage, state.practice.voice, fn(note, e));
  update();
}

/** Key in force just before position `index` of the stored progression. */
function keyBefore(index) {
  const prev = state.progression[index - 1];
  return prev ? entryKey(prev) : null;
}

function targetIndex() {
  return state.target.type === 'append' ? state.progression.length : state.target.index;
}

// ---------------------------------------------------------------- helpers

const ORDINAL = { 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', 6: '6th', 7: '7th', 8: 'octave', 9: '9th' };
const MEMBER_LABEL = {
  root: 'Root', third: '3rd', fifth: '5th', seventh: '7th',
  'aug6-low': 'Aug. 6th (low)', 'aug6-high': 'Aug. 6th (high)', 'aug6-third': '3rd above ♭6', 'aug6-other': 'Added tone',
};

function stackHTML(lines, small = false) {
  if (!lines.length) return '';
  return `<span class="stack${small ? ' small' : ''}">${lines.map((l) => `<span>${esc(l)}</span>`).join('')}</span>`;
}

function stagesHTML(stagesLines) {
  if (stagesLines.length === 1 && stagesLines[0].length === 0) return '<span class="blank-fig">blank</span>';
  return `<span class="stack-row">${stagesLines.map((l) => stackHTML(l)).join('<span class="dash">–</span>')}</span>`;
}

function numeralHTML(chord) {
  const n = chord.main.numeral;
  if (!n) return '<span class="numeral">?</span>';
  const sus = chord.label.includes('(') ? ` <small>${esc(chord.label.slice(chord.label.indexOf('(')))}</small>` : '';
  return `<span class="numeral">${esc(n.accidental + n.base + n.mark)}${stackHTML(n.figs, true)}${n.of ? `<span class="of">/${esc(n.of)}</span>` : ''}${sus}</span>`;
}

const shortNumeral = (chord) => numeralText(chord.main.numeral);

function motionLabel(from, to, fromMidi, toMidi) {
  if (fromMidi === toMidi) return { text: 'holds', cls: 'hold' };
  const iv = intervalName(from, to);
  const arrow = toMidi > fromMidi ? '↑' : '↓';
  return { text: `${arrow} ${iv.short}`, cls: Math.abs(toMidi - fromMidi) > 4 ? 'leap' : '' };
}

const TENDENCY_TEXT = {
  'leading tone': 'leading tone ↑',
  seventh: '7th ↓',
  suspension: 'suspension ↓',
  aug6: 'aug. 6th',
  tendency: 'tendency',
};

/** Small SVG note icons for the note-value buttons. */
function noteIcon(d) {
  const head = d === 'h'
    ? '<ellipse cx="8" cy="19" rx="5" ry="3.6" transform="rotate(-20 8 19)" fill="none" stroke="currentColor" stroke-width="1.8"/>'
    : '<ellipse cx="8" cy="19" rx="5" ry="3.6" transform="rotate(-20 8 19)" fill="currentColor"/>';
  const flag = d === '8' ? '<path d="M12.6 3 C13 8 19 9 17 15" fill="none" stroke="currentColor" stroke-width="1.8"/>' : '';
  return `<svg class="note-icon" viewBox="0 0 22 24" aria-hidden="true">${head}<line x1="12.6" y1="18" x2="12.6" y2="3" stroke="currentColor" stroke-width="1.6"/>${flag}</svg>`;
}

const DURATION_SYMBOL = { 8: '♪', q: '♩', h: '𝅗𝅥' };

function ticksLabel(t) {
  if (t % 4 === 0) return `${t / 4} quarter${t / 4 > 1 ? 's' : ''}`;
  return `${t / 2} eighth${t / 2 > 1 ? 's' : ''}`;
}

// ---------------------------------------------------------------- rendering

function setChecked(groupId, value) {
  for (const b of $(groupId).querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === String(value)));
}

function renderControls() {
  const key = currentKey();
  const t = state.target;

  $('key-tonic').innerHTML = KEY_TONICS[state.mode]
    .map((tonic) => `<option value="${tonic}"${tonic === state.tonic ? ' selected' : ''}>${esc(noteName(parseNote(tonic), sys()))}</option>`)
    .join('');
  setChecked('key-mode', state.mode);
  setChecked('names-choice', sys());
  setChecked('bass-acc', state.bassAcc);
  setChecked('duration-choice', state.duration);
  $('auto-raise').checked = state.settings.autoRaise;
  $('quick-add').checked = state.settings.quickAdd;

  const before = keyBefore(targetIndex());
  const keyChanges = before && (before.tonic.letter !== key.tonic.letter || before.tonic.acc !== key.tonic.acc || before.mode !== key.mode);
  $('keysig-row').hidden = !keyChanges;
  $('new-keysig').checked = state.newKeySig;

  $('bass-letters').innerHTML = LETTERS.map((_, i) => {
    const acc = state.bassAcc === 'key' ? signatureAcc(key, i) : Number(state.bassAcc);
    return `<button data-letter="${i}" aria-pressed="${i === state.bassLetter}" ${state.rest ? 'disabled' : ''}>${esc(nn({ letter: i, acc }))}</button>`;
  }).join('');
  for (const b of $('bass-acc').querySelectorAll('button')) b.disabled = state.rest;

  const fig = $('figures');
  if (fig.value !== state.figures) fig.value = state.figures;
  fig.disabled = state.rest;
  $('figure-buttons').innerHTML = FIGURE_BUTTONS.map((v) => {
    const lines = parseFigures(v).written.map(figureLines);
    const title = v === '' ? 'Blank: unfigured bass (root position, nothing printed)' : v;
    return `<button data-fig="${esc(v)}" aria-pressed="${!state.rest && v === state.figures.trim()}" title="${esc(title)}" ${state.rest ? 'disabled' : ''}>${stagesHTML(lines)}</button>`;
  }).join('');

  for (const b of $('duration-choice').querySelectorAll('button')) if (!b.innerHTML) b.innerHTML = noteIcon(b.dataset.value);
  $('rest-toggle').setAttribute('aria-pressed', String(state.rest));

  // Editing / inserting
  const banner = $('edit-banner');
  banner.hidden = t.type === 'append';
  if (t.type === 'edit') $('edit-text').textContent = `Editing chord ${t.index + 1}`;
  if (t.type === 'insert') $('edit-text').textContent = `Inserting before chord ${t.index + 1}`;
  $('insert-before').hidden = t.type !== 'edit';
  $('delete-chord').hidden = t.type !== 'edit';
  $('add-label').textContent = { append: 'Add to progression', edit: 'Save changes', insert: 'Insert chord' }[t.type];
  $('cancel-edit').hidden = t.type === 'append';
  document.body.classList.toggle('editing', t.type !== 'append');

  // Score settings
  const sig = timeSig();
  $('time-sig').value = state.score.timeSig;
  $('custom-time').hidden = state.score.timeSig !== 'custom';
  $('time-num').value = state.score.customNum;
  $('time-den').value = String(state.score.customDen);
  const bar = barTicks(sig);
  const pickups = [];
  for (let p = 2; p < bar; p += 2) pickups.push(p);
  if (state.score.pickup >= bar) state.score.pickup = 0;
  $('pickup').innerHTML = `<option value="0">None</option>${pickups.map((p) => `<option value="${p}"${p === state.score.pickup ? ' selected' : ''}>${ticksLabel(p)}</option>`).join('')}`;
  const firstKey = state.progression[0] ? entryKey(state.progression[0]) : key;
  $('score-key').innerHTML = `<option value="auto">From the first chord (${esc(keyName(firstKey, sys()))})</option>`
    + KEY_SIGNATURES.map(([spec, label]) => `<option value="${spec}"${spec === state.score.keySig ? ' selected' : ''}>${esc(label)} (${esc(noteName(parseNote(spec), sys()))} major)</option>`).join('');
  $('score-key').value = state.score.keySig;
  $('score-summary').textContent = `${sig.num}/${sig.den}${state.score.pickup ? `, pickup ${ticksLabel(state.score.pickup)}` : ''}`;

  renderParts();
  renderPlayer();
}

/** Show or hide the optional parts of the page, as chosen in Settings. */
function renderParts() {
  const show = state.settings.show;
  $('part-toggles').innerHTML = PARTS.map(([k, label]) => `<label class="check"><input type="checkbox" data-part-toggle="${k}"${show[k] ? ' checked' : ''}> ${esc(label)}</label>`).join('');
  const practicing = state.practice.on;
  for (const [k] of PARTS) {
    const on = show[k] || (k === 'voicePanel' && practicing);
    for (const el of document.querySelectorAll(`[data-part="${k}"]`)) el.classList.toggle('part-off', !on);
  }
  $('voice-panel').classList.toggle('part-off', !practicing && !show.voicePanel && !show.keyboard);
  document.body.classList.toggle('no-voice-panel', !practicing && !show.voicePanel && !show.keyboard);
}

// ---------------------------------------------------------------- sound

let playing = null; // { index: chord being played (stored progression), signature }

function renderPlayer() {
  const voices = state.settings.sound.voices;
  $('voice-toggles').innerHTML = [3, 2, 1, 0].map((v) => `<button data-voice="${v}" aria-pressed="${voices[v]}" title="${voices[v] ? 'Mute' : 'Hear'} the ${VOICES[v].toLowerCase()}"><span class="dot" style="background:${VOICE_COLORS[v]}"></span>${VOICES[v][0]}</button>`).join('');
  $('loop-toggle').setAttribute('aria-pressed', String(state.settings.sound.loop));
  $('play-btn').textContent = playing ? '■ Stop' : '▶ Play';
  $('play-btn').disabled = !playing && state.progression.length === 0;
  $('play-btn').setAttribute('aria-pressed', String(!!playing));
}

/** Timed notes for the chords `from`..`to` of a voiced model. */
function notesFor(model, from = 0, to = model.entries.length) {
  const events = model.entries.slice(from, to).map((e, k) => ({ ticks: DURATION_TICKS[durationOf(e)], rest: !!e.rest, stages: model.voiced[from + k] }));
  const timed = playbackNotes(buildVoices(events));
  const shift = (x) => ({ ...x, event: x.event + from });
  return { ...timed, notes: timed.notes.map(shift), events: timed.events.map(shift) };
}

function togglePlay() {
  if (playing) { sound.stop(); return; }
  if (!state.progression.length) return;
  sound.setVoices(state.settings.sound.voices);
  playing = { index: null, signature: JSON.stringify(state.progression) };
  sound.play(notesFor(storedModel()), {
    loop: () => state.settings.sound.loop,
    onEvent: (i) => { if (playing) { playing.index = i; renderProgression(compute()); } },
    onStop: () => { playing = null; renderPlayer(); renderProgression(compute()); },
  });
  renderPlayer();
}

/** Play the chord shown in the result panel (the input, or the chord being edited). */
function hearChord() {
  const model = compute();
  const i = model.focus;
  if (i === null || model.entries[i].rest || !model.voiced[i]?.[0]?.midis) return;
  sound.setVoices(state.settings.sound.voices);
  sound.play(notesFor(model, i, i + 1));
}

/** Index in the displayed model of a chord of the stored progression. */
function displayIndex(i) {
  const t = state.target;
  return t.type === 'insert' && i >= t.index ? i + 1 : i;
}

function renderResult(model) {
  const el = $('result');
  $('add-chord').disabled = !model.inputValid;
  if (model.focus === null) {
    el.innerHTML = model.practicing
      ? '<p class="empty">Practice mode: tap a chord in the score to work on it. Its chord information appears here.</p>'
      : `<p class="error-text">${esc(model.inputDecoded?.error ?? '')}</p>`;
    return;
  }
  const entry = model.entries[model.focus];
  const position = state.target.type === 'append' && !model.practicing ? '' : `Chord ${model.focus + 1} · `;
  if (entry.rest) {
    el.innerHTML = `
      <div class="result-eyebrow">${position}${esc(DURATION_NAMES[durationOf(entry)])} rest</div>
      <div class="result-main"><span class="chord-symbol">Rest</span></div>
      <p class="long-name">All four voices rest. The next chord connects to the chord before the rest.</p>`;
    return;
  }
  const chord = model.decoded[model.focus];
  const key = entryKey(entry);
  const bass = chord.stages[0].notes[0];
  const a = chord.main;

  let title = '';
  let long = '';
  if (a.type === 'tertian') {
    title = esc(chordSymbolText(a, sys()));
    long = `${esc(nn(a.root))} ${esc(a.longName)}${a.inversionName ? `, ${esc(a.inversionName)}` : ''}`;
  } else if (a.type === 'aug6') {
    title = esc(a.name);
    long = esc(a.longName);
  } else {
    title = 'Non-tertian sonority';
  }

  const stagesOut = chord.stages.map((stage, si) => {
    const chips = stage.analysis.pitches.map((p) => {
      const role = stage.analysis.roles.get(spellingKey(p));
      const src = stage.notes.find((n) => sameSpelling(n, p) && n.figure !== 1) ?? stage.notes[0];
      const isBass = sameSpelling(p, stage.notes[0]);
      const roleText = role?.suspension ? `Suspension ${role.suspension}` : (MEMBER_LABEL[role?.member] ?? (isBass ? 'Bass' : 'Chord tone'));
      const where = isBass ? 'bass' : `${ORDINAL[src.figure] ?? src.figure} above bass`;
      const cls = ['note-chip', role?.member === 'root' ? 'root' : '', src.alter && !isBass ? 'altered' : ''].join(' ');
      return `<div class="${cls}"><span class="n">${esc(nn(p))}</span><span class="r">${esc(roleText)}</span><span class="r">${esc(where)}${src.autoRaised ? ' (raised)' : ''}</span></div>`;
    }).join('');
    const stageTitle = chord.stages.length > 1
      ? `<div class="stage-title">Step ${si + 1}: ${stagesHTML([chord.written[si] ?? []])} ${stage.analysis.type === 'tertian' || stage.analysis.type === 'aug6' ? '· ' + esc(numeralText(stage.analysis.numeral)) : ''}</div>`
      : '';
    return `<div class="stage">${stageTitle}<div class="notes">${chips}</div></div>`;
  }).join('');

  const remarks = [...new Set(chord.stages.flatMap((s) => s.analysis.notes))];
  const callouts = [
    ...(state.suggestion && model.focus === targetIndex() ? [`<div class="callout">${esc(state.suggestion)}</div>`] : []),
    ...chord.hints.map((h) => `<div class="callout warn">${esc(h)}</div>`),
    ...remarks.map((r) => `<div class="callout">${esc(r)}</div>`),
  ].join('');

  el.innerHTML = `
    <div class="result-eyebrow">${position}${esc(keyName(key, sys()))} · bass ${esc(nn(bass))} · figures ${stagesHTML(chord.written)} · ${esc(DURATION_NAMES[durationOf(entry)])}</div>
    <div class="result-main"><span class="chord-symbol">${title}</span>${numeralHTML(chord)}</div>
    <p class="long-name">${long}</p>
    <div class="label">Notes in the chord</div>
    <div class="stage-grid">${stagesOut}</div>
    ${callouts ? `<div class="callouts">${callouts}</div>` : ''}`;
}

function renderVoiceLeading(model) {
  const el = $('voice-leading');
  const btn = $('next-voicing');
  const idx = model.focus;
  $('vl-title').textContent = model.practicing ? 'Practice: write the upper voices' : 'Voice leading';
  btn.hidden = model.practicing;
  if (model.practicing) {
    renderPractice(model);
    return;
  }
  renderKeyboardFor(model);
  if (idx === null) {
    el.innerHTML = '<p class="empty">Fix the figures to see a voicing.</p>';
    btn.disabled = true;
    return;
  }
  if (model.entries[idx].rest) {
    el.innerHTML = '<p class="empty">Nothing to voice: this is a rest.</p>';
    btn.disabled = true;
    return;
  }
  const stages = model.voiced[idx];
  let prevIdx = idx - 1;
  while (prevIdx >= 0 && !model.voiced[prevIdx]) prevIdx--;
  const prevChord = prevIdx >= 0 ? model.voiced[prevIdx] : null;
  const prev = prevChord ? prevChord[prevChord.length - 1] : null;
  btn.disabled = !stages[0].midis || stages[0].alternatives < 2;

  const columns = [];
  if (prev?.midis) columns.push({ title: `Previous (${esc(shortNumeral(model.decoded[prevIdx]))})`, v: prev });
  stages.forEach((s, si) => columns.push({ title: stages.length > 1 ? `Step ${si + 1}` : 'Now', v: s, current: true }));

  const rows = [3, 2, 1, 0].map((voice) => {
    const cells = columns.map((col, ci) => {
      if (!col.v.midis) return '<td class="p">—</td>';
      const note = col.v.notes[voice];
      const midi = col.v.midis[voice];
      let extra = '';
      if (ci > 0 && columns[ci - 1].v.midis) {
        const m = motionLabel(columns[ci - 1].v.notes[voice], note, columns[ci - 1].v.midis[voice], midi);
        extra += ` <span class="motion ${m.cls}">${esc(m.text)}</span>`;
      }
      const tend = tendenciesOf(col.v)[voice];
      if (tend && col.current) extra += `<span class="tag">${esc(TENDENCY_TEXT[tend.kind] ?? 'tendency')}</span>`;
      return `<td class="p">${esc(pitchName(note, sys()))}${extra}</td>`;
    }).join('');
    return `<tr><th scope="row">${VOICES[voice]}</th>${cells}</tr>`;
  }).join('');

  const issues = stages.flatMap((s) => s.issues);
  const seen = new Set();
  const issueHTML = issues.filter((i) => !seen.has(i.text) && seen.add(i.text))
    .map((i) => `<div class="callout ${i.level === 'error' ? 'error' : i.level === 'warn' ? 'warn' : ''}">${esc(i.text)}</div>`).join('');

  const first = stages[0];
  const meta = first.midis
    ? `Voicing ${first.choice + 1} of ${Math.min(first.alternatives, MAX_ALTERNATIVES)} best${prev ? '' : ' · first chord, so nothing to connect to yet'}.`
    : '';

  el.innerHTML = `
    <table class="vl-table">
      <thead><tr><th>Voice</th>${columns.map((c) => `<th>${c.title}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${issueHTML ? `<div class="callouts">${issueHTML}</div>` : '<div class="callouts"><div class="callout">No voice-leading problems found.</div></div>'}
    <p class="vl-meta">${meta}</p>`;
}

function renderKeyboardFor(model) {
  const idx = model.focus;
  const stages = idx !== null ? model.voiced[idx] : null;
  const cur = stages?.[stages.length - 1];
  let prevIdx = idx === null ? -1 : idx - 1;
  while (prevIdx >= 0 && !model.voiced[prevIdx]) prevIdx--;
  const prevChord = prevIdx >= 0 ? model.voiced[prevIdx] : null;
  renderKeyboard($('keyboard'), {
    current: cur?.midis ?? [],
    previous: prevChord?.[prevChord.length - 1]?.midis ?? [],
  });
}

function renderPractice(model) {
  const el = $('voice-leading');
  const p = state.practice;
  const steps = model.practice;
  const sel = p.sel ? steps.find((s) => s.event === p.sel.event && s.stage === p.sel.stage) : null;
  const solution = sel ? model.voiced[sel.event][sel.stage] : null;
  const prevStep = sel ? steps[steps.indexOf(sel) - 1] : null;

  const voiceButtons = [3, 2, 1].map((v) => `<button data-voice="${v}" role="radio" aria-checked="${p.voice === v}"><span class="dot" style="background:${VOICE_COLORS[v]}"></span>${VOICES[v]}</button>`).join('');
  let table = '<p class="empty">Tap a chord in the score to select it. Then tap the staff (or the keyboard) to place a note for the chosen voice.</p>';
  if (sel) {
    const rows = [3, 2, 1, 0].map((v) => {
      const mine = v === 0 ? sel.bass : sel.user[v];
      const sol = solution?.notes?.[v];
      return `<tr class="${p.voice === v ? 'active' : ''}"><th scope="row"><span class="dot" style="background:${VOICE_COLORS[v]}"></span>${VOICES[v]}</th>
        <td class="p">${mine ? esc(pitchName(mine, sys())) : '<span class="empty">—</span>'}</td>
        ${p.showSolution ? `<td class="p">${sol ? esc(pitchName(sol, sys())) : '—'}</td>` : ''}</tr>`;
    }).join('');
    const label = `Chord ${sel.event + 1}${model.voiced[sel.event].length > 1 ? `, step ${sel.stage + 1}` : ''} · ${esc(shortNumeral(model.decoded[sel.event]))}`;
    table = `<div class="practice-sel">${label}</div>
      <table class="vl-table"><thead><tr><th>Voice</th><th>Yours</th>${p.showSolution ? '<th>Solution</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>`;
    if (p.checked && sel.complete) {
      const issues = sel.result.issues;
      table += issues.length
        ? `<div class="callouts">${issues.map((i) => `<div class="callout ${i.level === 'error' ? 'error' : i.level === 'warn' ? 'warn' : ''}">${esc(i.text)}</div>`).join('')}</div>`
        : '<div class="callouts"><div class="callout ok">✓ No problems found in this chord.</div></div>';
    } else if (p.checked) {
      table += '<div class="callouts"><div class="callout">Fill in soprano, alto and tenor to check this chord.</div></div>';
    }
  }

  let summary = '';
  if (p.checked) {
    const complete = steps.filter((s) => s.complete);
    const bad = complete.filter((s) => stepStatus(s) === 'error');
    const warn = complete.filter((s) => stepStatus(s) === 'warn');
    summary = `<div class="practice-summary">
      <strong>${complete.length} of ${steps.length}</strong> chord steps written ·
      <span class="ok-text">${complete.length - bad.length - warn.length} ✓</span> ·
      <span class="warn-text">${warn.length} with warnings</span> ·
      <span class="error-text">${bad.length} with errors</span>
      ${[...bad, ...warn].length ? `<div class="problem-list">${[...bad, ...warn].map((s) => `<button class="ghost" data-goto="${s.event}:${s.stage}">Chord ${s.event + 1}${model.voiced[s.event].length > 1 ? '.' + (s.stage + 1) : ''}</button>`).join('')}</div>` : ''}
    </div>`;
  }

  el.innerHTML = `
    <div class="practice-tools">
      <div class="segmented" id="practice-voice" role="radiogroup" aria-label="Voice to write">${voiceButtons}</div>
      <div class="segmented small" id="practice-acc" aria-label="Accidental for the selected note">
        <button data-acc="-1" title="Flat">♭</button><button data-acc="0" title="Natural">♮</button><button data-acc="1" title="Sharp">♯</button>
      </div>
      <button id="practice-clear" class="ghost" ${sel ? '' : 'disabled'}>Clear chord</button>
    </div>
    ${table}
    <div class="row practice-actions">
      <button id="practice-check" class="${p.checked ? 'toggle' : 'ghost strong'}" aria-pressed="${p.checked}">${p.checked ? 'Checking ✓' : 'Check my voices'}</button>
      <button id="practice-solution" class="toggle" aria-pressed="${p.showSolution}">Show solution</button>
    </div>
    ${summary}
    <p class="vl-meta">Tip: ↑/↓ move the selected voice's note by a step.</p>`;

  renderKeyboard($('keyboard'), {
    current: sel ? [sel.bass, ...sel.user.slice(1)].map((n) => (n ? midi(n) : null)) : [],
    previous: prevStep ? [prevStep.bass, ...prevStep.user.slice(1)].map((n) => (n ? midi(n) : null)) : [],
    onKey: sel ? placeFromKey : undefined,
  });
}

/**
 * Score data for renderScore. `showUser` draws the user's practice voices instead of the
 * app's voicing; `color(i)` and `selectedOf(i, stage)` decorate chords.
 */
function scoreFor({ entries, decoded, voiced }, { showUser = false, color = () => undefined, selectedOf = () => false } = {}) {
  const stagesFor = (e, i) => {
    if (!showUser || !voiced[i]) return voiced[i];
    return voiced[i].map((v, si) => {
      if (!v.notes) return v;
      const user = userNotes(e, si);
      const notes = [v.notes[0], user[1], user[2], user[3]];
      return { ...v, notes, midis: notes.map((n) => (n ? midi(n) : null)) };
    });
  };
  const events = entries.map((e, i) => ({ ticks: DURATION_TICKS[durationOf(e)], rest: !!e.rest, stages: stagesFor(e, i) }));
  const built = buildVoices(events);
  const firstKey = entries[0] ? entryKey(entries[0]) : currentKey();
  const initialKey = state.score.keySig === 'auto' ? signatureSpec(firstKey) : state.score.keySig;
  const keyChanges = [];
  let tick = 0;
  entries.forEach((e, i) => {
    if (i > 0 && e.newKeySig) keyChanges.push({ tick, key: signatureSpec(entryKey(e)) });
    tick += DURATION_TICKS[durationOf(e)];
  });
  const bars = layoutBars(built, { timeSig: timeSig(), pickup: state.score.pickup, initialKey, keyChanges });
  const info = entries.map((e, i) => ({
    color: color(i),
    stages: e.rest ? [] : decoded[i].stages.map((_, si) => ({
      figures: decoded[i].written[si] ?? [],
      numeral: si === 0 ? shortNumeral(decoded[i]) : '',
      selected: selectedOf(i, si),
    })),
  }));
  return { bars, timeSig: timeSig(), events: info, emptyKey: initialKey };
}

function printScore() {
  const model = storedModel();
  const view = $('print-view');
  const practicing = state.practice.on && !state.practice.showSolution;
  const sig = timeSig();
  const firstKey = model.entries[0] ? entryKey(model.entries[0]) : currentKey();
  view.innerHTML = `
    <h1>${esc(state.exerciseName || 'Figured bass')}</h1>
    <p class="print-sub">${esc(keyName(firstKey, sys()))} · ${sig.num}/${sig.den}${practicing ? ' · your realization' : ''}</p>
    <div class="print-staff"><div id="print-staff"></div></div>
    <section class="print-analysis">
    <h2>Chord analysis${state.exerciseName ? `: ${esc(state.exerciseName)}` : ''}</h2>
    <table>
      <thead><tr><th>#</th><th>Bass</th><th>Figures</th><th>Chord</th><th>Notes</th><th>Numeral</th><th>Value</th></tr></thead>
      <tbody>${model.entries.map((e, i) => {
        const value = DURATION_NAMES[durationOf(e)];
        if (e.rest) return `<tr><td>${i + 1}</td><td colspan="5">Rest</td><td>${value}</td></tr>`;
        const d = model.decoded[i];
        const bassNote = model.voiced[i]?.[0]?.notes?.[0];
        const notes = d.stages.map((st) => st.analysis.pitches.map((n) => nn(n)).join(' ')).join(' → ');
        const figs = d.written.map((l) => (l.length ? l.join('/') : 'blank')).join(' – ');
        const name = d.main.type === 'tertian' ? `${chordSymbolText(d.main, sys())} (${nn(d.main.root)} ${d.main.longName}${d.main.inversionName ? ', ' + d.main.inversionName : ''})` : (d.main.longName ?? '');
        return `<tr><td>${i + 1}</td><td>${esc(bassNote ? pitchName(bassNote, sys()) : nn(e.bass))}</td><td class="fig">${esc(figs)}</td><td>${esc(name)}</td><td>${esc(notes)}</td><td class="fig">${esc(d.label)}</td><td>${value}</td></tr>`;
      }).join('')}</tbody>
    </table>
    <p class="print-foot">Figured Bass Decoder · voicings follow chorale-style four-part rules.</p>
    </section>`;
  view.classList.add('preparing');
  renderScore($('print-staff'), scoreFor(model, { showUser: practicing }));
  const svg = $('print-staff').querySelector('svg');
  if (svg) svg.setAttribute('viewBox', `0 0 ${svg.getAttribute('width')} ${svg.getAttribute('height')}`);
  const done = () => { view.classList.remove('preparing'); view.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}

/** The stored progression only (no input preview), voiced. */
function storedModel() {
  const entries = state.progression;
  const decoded = entries.map(decodeEntry);
  const fixedBass = entries.map((e) => (e.rest || e.bassOctave == null ? null : midi({ ...e.bass, octave: e.bassOctave })));
  const voiced = voiceProgression(decoded, entries.map((e) => e.choice ?? []), fixedBass);
  return { entries, decoded, voiced };
}

function renderProgression(model) {
  const { entries, decoded, voiced, focus } = model;
  const practice = state.practice.on && model.practicing;
  const showUser = practice && !state.practice.showSolution;
  const statusOf = (i) => {
    const steps = model.practice.filter((s) => s.event === i);
    if (!steps.length || steps.some((s) => !s.complete)) return null;
    const order = ['ok', 'warn', 'error'];
    return steps.map(stepStatus).reduce((a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a), 'ok');
  };
  const playingAt = playing?.index != null ? displayIndex(playing.index) : null;
  const color = (i) => {
    if (i === playingAt) return PLAY_COLOR;
    if (practice) return state.practice.checked && showUser ? STATUS_COLOR[statusOf(i)] : undefined;
    return i === focus ? (state.target.type === 'edit' ? EDIT_COLOR : PREVIEW_COLOR) : undefined;
  };

  const score = scoreFor(model, {
    showUser,
    color,
    selectedOf: (i, si) => practice && state.practice.sel?.event === i && state.practice.sel?.stage === si,
  });
  renderScore($('staff'), { ...score, onSelect: (hit) => (practice ? placeFromStaff(hit) : selectEvent(hit.event)) });

  // History list (the stored progression; the input is shown at its position)
  const items = state.progression.map((e, i) => {
    const t = state.target;
    const pressed = t.type === 'edit' && t.index === i;
    let body;
    if (e.rest) {
      body = `<span class="h-num">Rest</span><span class="h-sub">${DURATION_SYMBOL[durationOf(e)]} ${esc(DURATION_NAMES[durationOf(e)])}</span>`;
    } else {
      const chord = decodeEntry(e);
      const sym = chordSymbolText(chord.main, sys());
      body = `<span class="h-num">${esc(chord.label)}</span><span class="h-sub">${esc(sym || '')} · ${esc(nn(e.bass))}${e.bassOctave ?? ""} ${esc(e.figures || "blank")} · ${DURATION_SYMBOL[durationOf(e)]}</span>`;
    }
    const insertMark = state.target.type === 'insert' && state.target.index === i ? '<li class="insert-mark" aria-label="Insert position">▸</li>' : '';
    return `${insertMark}<li><button data-index="${i}" aria-pressed="${pressed}"${playing?.index === i ? ' class="playing"' : ''}><span class="idx">${i + 1}${e.newKeySig && i > 0 ? ' 🔑' : ''}</span>${body}</button></li>`;
  });
  $('history').innerHTML = items.join('') || '<li class="empty">No chords yet. Choose a bass and figures, then press “Add to progression”.</li>';

  $('undo').disabled = state.progression.length === 0;
  $('clear-all').disabled = state.progression.length === 0;
  $('practice-toggle').setAttribute('aria-pressed', String(state.practice.on));
}

/** The bass note the focused chord is actually voiced with (for the octave controls). */
function focusBass(model) {
  if (model.focus === null || state.rest || model.practicing) return null;
  return model.voiced[model.focus]?.[0]?.notes?.[0] ?? null;
}

function renderOctave(model) {
  const bass = focusBass(model);
  $('octave-label').innerHTML = bass
    ? `${esc(pitchName(bass, sys()))}<small>${state.bassOctave == null ? 'auto' : 'fixed'}</small>`
    : '—';
  $('octave-down').disabled = !bass || bass.octave <= 1;
  $('octave-up').disabled = !bass || bass.octave >= 5;
  $('octave-auto').disabled = state.bassOctave == null;
}

/** Bass notes around the input position, for suggesting figures. */
function neighbours() {
  const i = targetIndex();
  const list = state.progression;
  const before = list.slice(0, i).reverse().find((e) => !e.rest);
  const afterStart = state.target.type === 'edit' ? i + 1 : i;
  const after = list.slice(afterStart).find((e) => !e.rest);
  return { prev: before?.bass, next: after?.bass };
}

function lineEntries() {
  const key = currentKey();
  return parseLine(state.lineText).map((item) => {
    if (item.error) return { item };
    if (item.rest) return { item, entry: { tonic: state.tonic, mode: state.mode, rest: true, duration: item.duration ?? state.duration, bass: currentBass(), figures: '', choice: [] } };
    const bass = { letter: item.letter, acc: item.acc ?? signatureAcc(key, item.letter) };
    return {
      item,
      entry: { tonic: state.tonic, mode: state.mode, bass, bassOctave: item.octave, figures: item.figures, duration: item.duration ?? state.duration, rest: false, newKeySig: false, choice: [] },
    };
  });
}

function renderLine() {
  const ta = $('line-text');
  if (ta.value !== state.lineText) ta.value = state.lineText;
  const rows = lineEntries();
  const errors = rows.filter((r) => r.item.error);
  $('line-preview').innerHTML = rows.map(({ item, entry }) => {
    if (item.error) return `<span class="line-chip bad">${esc(item.raw)}</span>`;
    if (entry.rest) return `<span class="line-chip">rest ${DURATION_SYMBOL[entry.duration]}</span>`;
    const d = decodeEntry(entry);
    return `<span class="line-chip">${esc(nn(entry.bass))}${entry.bassOctave ?? ''} <b>${esc(d.label)}</b> ${DURATION_SYMBOL[entry.duration]}</span>`;
  }).join('') + errors.map((r) => `<div class="line-error">${esc(r.item.error)}</div>`).join('');
  const editing = state.target.type === 'edit';
  $('line-add').disabled = rows.length === 0 || errors.length > 0 || editing;
  $('line-add').textContent = state.target.type === 'insert' ? `Insert all before chord ${state.target.index + 1}` : 'Add all to progression';
  $('line-suggest').disabled = !rows.some((r) => !r.item.error && !r.item.rest && !r.item.figures);
}

function addLine() {
  const rows = lineEntries();
  if (!rows.length || rows.some((r) => r.item.error) || state.target.type === 'edit') return;
  const entries = rows.map((r) => r.entry);
  if (state.target.type === 'insert') {
    state.progression.splice(state.target.index, 0, ...entries);
    backToAppend();
  } else {
    state.progression.push(...entries);
  }
  state.lineText = '';
  update();
}

function suggestLine() {
  const key = currentKey();
  const rows = lineEntries();
  const basses = rows.map((r) => (r.entry && !r.entry.rest ? r.entry.bass : null));
  const { prev: before } = neighbours();
  const tokens = rows.map((r, i) => {
    if (r.item.error || r.item.rest || r.item.figures) return r.item.raw;
    const prev = basses.slice(0, i).reverse().find(Boolean) ?? before;
    const next = basses.slice(i + 1).find(Boolean);
    const { figures } = suggestFigures(key, r.entry.bass, { prev, next });
    return formatItem({ ...r.item, figures });
  });
  state.lineText = tokens.join('  ');
  update();
}

function update() {
  if (playing && playing.signature !== JSON.stringify(state.progression)) sound.stop();
  save();
  renderExercises();
  renderControls();
  const model = compute();
  renderOctave(model);
  renderLine();
  renderResult(model);
  renderVoiceLeading(model);
  renderProgression(model);
  renderQuickEdit(model);
}

// ---------------------------------------------------------------- quick edit

/** The floating panel for fixing a chord without going back to the input panel. */
function renderQuickEdit(model) {
  const t = state.target;
  const panel = $('quick-edit');
  const open = t.type === 'edit' && !state.practice.on;
  panel.hidden = !open;
  document.body.classList.toggle('quick-editing', open);
  if (!open) return;
  const n = state.progression.length;
  const d = model.inputDecoded;
  const label = state.rest ? 'Rest' : (d && !d.error ? `${nn(currentBass())} · ${d.label}` : nn(currentBass()));
  $('qe-title').textContent = `Chord ${t.index + 1} of ${n} · ${label}`;
  $('qe-prev').disabled = t.index === 0;
  $('qe-next').disabled = t.index >= n - 1;
  $('qe-figures').innerHTML = FIGURE_BUTTONS.map((v) => {
    const lines = parseFigures(v).written.map(figureLines);
    return `<button data-fig="${esc(v)}" aria-pressed="${!state.rest && v === state.figures.trim()}" title="${esc(v === '' ? 'Blank' : v)}">${stagesHTML(lines)}</button>`;
  }).join('');
}

/** Store the chord being edited right away (quick edit changes apply at once). */
function saveEdit() {
  const t = state.target;
  if (t.type !== 'edit' || !compute().inputValid) { update(); return; }
  state.progression[t.index] = { ...inputEntry(), user: state.progression[t.index].user };
  update();
}

/** Move the bass a step up or down (by the key signature), keeping a fixed octave in step. */
function stepBass(dir) {
  let letter = state.bassLetter + dir;
  let octave = state.bassOctave;
  if (letter > 6) { letter = 0; if (octave != null) octave = Math.min(5, octave + 1); }
  if (letter < 0) { letter = 6; if (octave != null) octave = Math.max(1, octave - 1); }
  Object.assign(state, { bassLetter: letter, bassAcc: 'key', bassOctave: octave, rest: false, suggestion: null, previewChoice: [] });
}

// ---------------------------------------------------------------- actions

function setInput(changes) {
  Object.assign(state, { suggestion: null }, changes, { previewChoice: [] });
  update();
}

const snapshotInputs = () => Object.fromEntries(INPUT_FIELDS.map((f) => [f, state[f]]));

function backToAppend() {
  if (state.draft) Object.assign(state, state.draft);
  state.draft = null;
  state.previewChoice = [];
  state.target = { type: 'append' };
}

function loadEntry(e) {
  const key = entryKey(e);
  state.tonic = e.tonic;
  state.mode = e.mode;
  state.bassLetter = e.bass.letter;
  state.bassAcc = e.bass.acc === signatureAcc(key, e.bass.letter) ? 'key' : e.bass.acc;
  state.bassOctave = e.bassOctave ?? null;
  state.figures = e.figures;
  state.duration = durationOf(e);
  state.rest = !!e.rest;
  state.newKeySig = !!e.newKeySig;
  state.previewChoice = e.choice ?? [];
}

function startEdit(index) {
  if (state.target.type === 'append') state.draft = snapshotInputs();
  loadEntry(state.progression[index]);
  state.target = { type: 'edit', index };
  update();
}

/** A click on the score: indices there include the input chord when it's previewed. */
function selectEvent(i) {
  const t = state.target;
  let stored = i;
  if (t.type === 'append' && i === state.progression.length) return; // the preview itself
  if (t.type === 'insert') {
    if (i === t.index) return;
    if (i > t.index) stored = i - 1;
  }
  if (t.type === 'edit' && t.index === stored) { cancelEdit(); return; }
  startEdit(stored);
}

function commit() {
  const { inputValid } = compute();
  if (!inputValid) return;
  const entry = inputEntry();
  const t = state.target;
  if (t.type === 'edit') state.progression[t.index] = { ...entry, user: state.progression[t.index].user };
  else if (t.type === 'insert') state.progression.splice(t.index, 0, entry);
  else state.progression.push(entry);

  if (t.type === 'append') {
    state.figures = '';
    state.bassAcc = 'key';
    state.bassOctave = null;
    state.rest = false;
    state.newKeySig = false;
    state.previewChoice = [];
  } else {
    backToAppend();
  }
  update();
  // Leave the figures field, so the next letter key picks the next bass note
  // (and a phone's keyboard closes after a chord is added).
  if (document.activeElement === $('figures')) $('figures').blur();
}

function cancelEdit() {
  backToAppend();
  update();
}

function deleteEdited() {
  const t = state.target;
  if (t.type !== 'edit') return;
  state.progression.splice(t.index, 1);
  backToAppend();
  update();
}

function closestTonic(mode, tonic) {
  if (KEY_TONICS[mode].includes(tonic)) return tonic;
  const target = pc(parseNote(tonic));
  return KEY_TONICS[mode].find((t) => pc(parseNote(t)) === target) ?? KEY_TONICS[mode][0];
}

function bind() {
  const onButton = (id, fn) => $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && !b.disabled) fn(b);
  });

  $('key-tonic').addEventListener('change', (e) => setInput({ tonic: e.target.value }));
  onButton('key-mode', (b) => setInput({ mode: b.dataset.value, tonic: closestTonic(b.dataset.value, state.tonic) }));
  $('new-keysig').addEventListener('change', (e) => setInput({ newKeySig: e.target.checked }));
  onButton('bass-letters', (b) => setInput({ bassLetter: Number(b.dataset.letter) }));
  onButton('bass-acc', (b) => setInput({ bassAcc: b.dataset.value === 'key' ? 'key' : Number(b.dataset.value) }));
  onButton('figure-buttons', (b) => {
    setInput({ figures: b.dataset.fig, rest: false });
    if (state.settings.quickAdd) commit();
  });
  $('quick-add').addEventListener('change', (e) => { state.settings.quickAdd = e.target.checked; update(); });
  $('figures').addEventListener('input', (e) => setInput({ figures: e.target.value }));
  $('figures').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
  });
  $('clear-figures').addEventListener('click', () => setInput({ figures: '' }));
  onButton('duration-choice', (b) => setInput({ duration: b.dataset.value }));
  $('rest-toggle').addEventListener('click', () => setInput({ rest: !state.rest }));

  $('add-chord').addEventListener('click', commit);

  const shiftOctave = (d) => {
    const bass = focusBass(compute());
    if (!bass) return;
    setInput({ bassOctave: Math.min(5, Math.max(1, bass.octave + d)) });
  };
  $('octave-down').addEventListener('click', () => shiftOctave(-1));
  $('octave-up').addEventListener('click', () => shiftOctave(1));
  $('octave-auto').addEventListener('click', () => setInput({ bassOctave: null }));

  $('suggest-figures').addEventListener('click', () => {
    const { figures, reason } = suggestFigures(currentKey(), currentBass(), neighbours());
    setInput({ figures, rest: false, suggestion: `Suggested: ${figures || 'blank (5/3)'}. ${reason}` });
  });

  $('print-btn').addEventListener('click', printScore);

  // Sound
  $('play-btn').addEventListener('click', togglePlay);
  $('hear-chord').addEventListener('click', hearChord);
  $('qe-hear').addEventListener('click', hearChord);
  $('loop-toggle').addEventListener('click', () => { state.settings.sound.loop = !state.settings.sound.loop; save(); renderPlayer(); });
  onButton('voice-toggles', (b) => {
    const voices = state.settings.sound.voices;
    const v = Number(b.dataset.voice);
    if (voices[v] && voices.filter(Boolean).length === 1) return; // keep at least one voice
    voices[v] = !voices[v];
    sound.setVoices(voices);
    save();
    renderPlayer();
  });

  // Quick edit
  onButton('qe-figures', (b) => {
    Object.assign(state, { figures: b.dataset.fig, rest: false, suggestion: null, previewChoice: [] });
    saveEdit();
  });
  $('qe-prev').addEventListener('click', () => { if (state.target.index > 0) startEdit(state.target.index - 1); });
  $('qe-next').addEventListener('click', () => { if (state.target.index < state.progression.length - 1) startEdit(state.target.index + 1); });
  $('qe-close').addEventListener('click', cancelEdit);
  $('qe-delete').addEventListener('click', deleteEdited);
  $('qe-bass-up').addEventListener('click', () => { stepBass(1); saveEdit(); });
  $('qe-bass-down').addEventListener('click', () => { stepBass(-1); saveEdit(); });

  $('exercises-toggle').addEventListener('click', () => {
    const panel = $('exercises');
    panel.hidden = !panel.hidden;
    $('exercises-toggle').setAttribute('aria-expanded', String(!panel.hidden));
  });
  $('exercise-name').addEventListener('input', (e) => { state.exerciseName = e.target.value; save(); renderExercises(); });
  $('exercise-new').addEventListener('click', () => newExercise(`Exercise ${exercises.length + 1}`));
  $('exercise-duplicate').addEventListener('click', () => newExercise(`${state.exerciseName} (copy)`, JSON.parse(JSON.stringify(exerciseData()))));
  $('exercise-list').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.open) {
      saveCurrentExercise();
      const x = exercises.find((y) => y.id === b.dataset.open);
      if (x) { openExercise(x); update(); }
    } else if (b.dataset.delete) {
      const x = exercises.find((y) => y.id === b.dataset.delete);
      if (!x || !confirm(`Delete "${x.name}"? This can't be undone.`)) return;
      exercises = exercises.filter((y) => y.id !== x.id);
      storeExercises();
      if (x.id === state.exerciseId) {
        if (exercises.length) openExercise(exercises[0]);
        else { state.exerciseId = null; state.exerciseName = 'Exercise 1'; state.progression = []; backToAppend(); }
      }
      update();
    }
  });
  $('exercise-export').addEventListener('click', exportExercise);
  $('exercise-import-btn').addEventListener('click', () => $('exercise-import').click());
  $('exercise-import').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) importExercise(file);
    e.target.value = '';
  });

  $('practice-toggle').addEventListener('click', () => {
    state.practice.on = !state.practice.on;
    if (state.practice.on) {
      backToAppend();
      const first = compute().practice[0];
      if (!state.practice.sel && first) state.practice.sel = { event: first.event, stage: first.stage };
    }
    update();
  });
  $('voice-leading').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const p = state.practice;
    if (b.dataset.voice) { p.voice = Number(b.dataset.voice); update(); }
    else if (b.dataset.acc !== undefined) changeSelectedNote((n) => ({ ...n, acc: Number(b.dataset.acc) }));
    else if (b.id === 'practice-clear' && p.sel) {
      const entry = state.progression[p.sel.event];
      if (entry.user?.[p.sel.stage]) entry.user[p.sel.stage] = [null, null, null, null];
      p.voice = 3;
      update();
    } else if (b.id === 'practice-check') { p.checked = !p.checked; update(); }
    else if (b.id === 'practice-solution') { p.showSolution = !p.showSolution; update(); }
    else if (b.dataset.goto) {
      const [event, stage] = b.dataset.goto.split(':').map(Number);
      p.sel = { event, stage };
      update();
    }
  });

  $('line-text').addEventListener('input', (e) => { state.lineText = e.target.value; save(); renderLine(); });
  $('line-add').addEventListener('click', addLine);
  $('line-suggest').addEventListener('click', suggestLine);
  $('cancel-edit').addEventListener('click', cancelEdit);
  $('delete-chord').addEventListener('click', deleteEdited);
  $('insert-before').addEventListener('click', () => {
    if (state.target.type !== 'edit') return;
    state.target = { type: 'insert', index: state.target.index };
    state.newKeySig = false;
    state.previewChoice = [];
    update();
  });

  $('next-voicing').addEventListener('click', () => {
    const model = compute();
    const idx = model.focus;
    if (idx === null || !model.voiced[idx]) return;
    const total = Math.min(model.voiced[idx][0].alternatives, MAX_ALTERNATIVES);
    state.previewChoice = [((state.previewChoice[0] ?? 0) + 1) % total];
    update();
  });

  $('undo').addEventListener('click', () => {
    backToAppend();
    state.progression.pop();
    update();
  });
  $('clear-all').addEventListener('click', () => {
    if (state.progression.length && !confirm('Clear the whole progression?')) return;
    backToAppend();
    state.progression = [];
    update();
  });
  $('history').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-index]');
    if (!b) return;
    const i = Number(b.dataset.index);
    if (state.target.type === 'edit' && state.target.index === i) cancelEdit();
    else startEdit(i);
  });

  // Score settings
  $('time-sig').addEventListener('change', (e) => { state.score.timeSig = e.target.value; state.score.pickup = 0; update(); });
  $('time-num').addEventListener('change', (e) => { state.score.customNum = Number(e.target.value); state.score.pickup = 0; update(); });
  $('time-den').addEventListener('change', (e) => { state.score.customDen = Number(e.target.value); state.score.pickup = 0; update(); });
  $('pickup').addEventListener('change', (e) => { state.score.pickup = Number(e.target.value); update(); });
  $('score-key').addEventListener('change', (e) => { state.score.keySig = e.target.value; update(); });

  $('settings-toggle').addEventListener('click', () => {
    const panel = $('settings');
    panel.hidden = !panel.hidden;
    $('settings-toggle').setAttribute('aria-expanded', String(!panel.hidden));
  });
  onButton('names-choice', (b) => { state.settings.names = b.dataset.value; update(); });
  $('auto-raise').addEventListener('change', (e) => { state.settings.autoRaise = e.target.checked; update(); });
  $('part-toggles').addEventListener('change', (e) => {
    const k = e.target.dataset.partToggle;
    if (!k) return;
    state.settings.show[k] = e.target.checked;
    if (k === 'practice' && !e.target.checked) state.practice.on = false;
    if (k === 'sound' && !e.target.checked) sound.stop();
    if (k === 'exercises' && !e.target.checked) { $('exercises').hidden = true; $('exercises-toggle').setAttribute('aria-expanded', 'false'); }
    update();
  });

  // Keyboard: letters A-G pick the bass when not typing in a field; Escape cancels editing.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.target.type !== 'append') { cancelEdit(); return; }
    if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const onControl = e.target.closest('button, a, summary');
    if (e.key === 'Enter' && !onControl) { e.preventDefault(); commit(); return; }
    if (e.key === ' ' && !onControl && state.settings.show.sound) { e.preventDefault(); togglePlay(); return; }
    if (state.target.type === 'edit' && !state.practice.on && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const i = state.target.index + (e.key === 'ArrowRight' ? 1 : -1);
      if (i >= 0 && i < state.progression.length) { e.preventDefault(); startEdit(i); }
      return;
    }
    if (state.practice.on && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && state.practice.sel) {
      e.preventDefault();
      const step = e.key === 'ArrowUp' ? 1 : -1;
      changeSelectedNote((n, entry) => {
        const d = n.octave * 7 + n.letter + step;
        const letter = ((d % 7) + 7) % 7;
        const spec = compute().voiced[state.practice.sel.event]?.[state.practice.sel.stage]?.spec;
        const tone = spec?.find((x) => x.note.letter === letter);
        return { letter, acc: tone ? tone.note.acc : signatureAcc(entryKey(entry), letter), octave: Math.floor(d / 7) };
      });
      return;
    }
    // A digit or # starts typing figures for the current bass.
    if (/^[1-9#]$/.test(e.key) && !state.rest) { $('figures').focus(); return; }
    const i = 'cdefgab'.indexOf(e.key.toLowerCase());
    if (i >= 0 && e.key.length === 1 && !state.rest) {
      setInput({ bassLetter: i, bassAcc: 'key' });
      $('figures').focus();
      e.preventDefault();
    }
  });

  let resizeTimer;
  let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(update, 150);
  });
}

bind();
update();

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

const STORAGE_KEY = 'figured-bass-decoder:v1';
const MAX_ALTERNATIVES = 8;
const PREVIEW_COLOR = '#b0601e';
const EDIT_COLOR = '#1d5fa8';

const FIGURE_BUTTONS = ['', '5/3', '6', '6/4', '7', '6/5', '4/3', '4/2', '#', 'b', 'n', '7 #', '#6', '4-3', '9-8', '7-6', '6/4-5/3'];
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
  lineText: '',
  settings: { names: 'english', autoRaise: false },
  score: { timeSig: '4/4', customNum: 5, customDen: 4, pickup: 0, keySig: 'auto' },
});

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const saved = JSON.parse(raw);
    const d = defaults();
    const s = { ...d, ...saved, settings: { ...d.settings, ...saved.settings }, score: { ...d.score, ...saved.score }, practice: { ...d.practice, ...saved.practice } };
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
  const color = (i) => {
    if (practice) return state.practice.checked && showUser ? STATUS_COLOR[statusOf(i)] : undefined;
    return i === focus ? (state.target.type === 'edit' ? EDIT_COLOR : PREVIEW_COLOR) : undefined;
  };

  // Score (in practice mode: the bass plus the user's own upper voices)
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
      selected: practice && state.practice.sel?.event === i && state.practice.sel?.stage === si,
    })),
  }));
  renderScore($('staff'), {
    bars,
    timeSig: timeSig(),
    events: info,
    emptyKey: initialKey,
    onSelect: (hit) => (practice ? placeFromStaff(hit) : selectEvent(hit.event)),
  });

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
    return `${insertMark}<li><button data-index="${i}" aria-pressed="${pressed}"><span class="idx">${i + 1}${e.newKeySig && i > 0 ? ' 🔑' : ''}</span>${body}</button></li>`;
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
  save();
  renderControls();
  const model = compute();
  renderOctave(model);
  renderLine();
  renderResult(model);
  renderVoiceLeading(model);
  renderProgression(model);
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
  if (t.type === 'append') $('figures').focus();
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
    setInput({ figures: b.dataset.fig });
    $('figures').focus();
  });
  $('figures').addEventListener('input', (e) => setInput({ figures: e.target.value }));
  $('figures').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
  });
  $('clear-figures').addEventListener('click', () => { setInput({ figures: '' }); $('figures').focus(); });
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

  // Keyboard: letters A-G pick the bass when not typing in a field; Escape cancels editing.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.target.type !== 'append') { cancelEdit(); return; }
    if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
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

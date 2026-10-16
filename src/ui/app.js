import { LETTERS, noteName, pitchName, intervalName, parseNote, pc, spellingKey, sameSpelling } from '../theory/pitch.js';
import { makeKey, KEY_TONICS, signatureAcc, keyName, vexKeySpec } from '../theory/key.js';
import { parseFigures, figureLines } from '../theory/figures.js';
import { decode } from '../theory/decode.js';
import { chordSymbolText, numeralText } from '../theory/chord.js';
import { voiceProgression, tendenciesOf, VOICES } from '../theory/voicing.js';
import { renderStaff } from './staff.js';

const STORAGE_KEY = 'figured-bass-decoder:v1';
const MAX_ALTERNATIVES = 8;
const PREVIEW_COLOR = '#b0601e';
const SELECTED_COLOR = '#1d5fa8';

const FIGURE_BUTTONS = ['', '6', '6/4', '7', '6/5', '4/3', '4/2', '#', 'b', 'n', '7 #', '#6', '4-3', '9-8', '7-6', '6/4-5/3'];

const defaults = () => ({
  tonic: 'C',
  mode: 'major',
  bassLetter: 0,
  bassAcc: 'key',
  figures: '',
  previewChoice: [],
  progression: [],
  selected: null,
  settings: { names: 'english', autoRaise: false },
});

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const saved = JSON.parse(raw);
    return { ...defaults(), ...saved, settings: { ...defaults().settings, ...saved.settings }, selected: null };
  } catch {
    return defaults();
  }
}

function save() {
  try {
    const { selected, ...rest } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
  } catch { /* storage unavailable: fine */ }
}

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sys = () => state.settings.names;
const nn = (note) => noteName(note, sys());

// ---------------------------------------------------------------- model

const currentKey = () => makeKey(state.tonic, state.mode);

function currentBass() {
  const key = currentKey();
  const acc = state.bassAcc === 'key' ? signatureAcc(key, state.bassLetter) : Number(state.bassAcc);
  return { letter: state.bassLetter, acc };
}

const decodeOptions = () => ({ autoRaise: state.settings.autoRaise });

function decodeEntry(e) {
  return decode(makeKey(e.tonic, e.mode), e.bass, e.figures, decodeOptions());
}

function compute() {
  const decoded = state.progression.map(decodeEntry);
  const preview = decode(currentKey(), currentBass(), state.figures, decodeOptions());
  const hasPreview = !preview.error;
  const chords = hasPreview ? [...decoded, preview] : decoded;
  const choices = [...state.progression.map((e) => e.choice ?? []), state.previewChoice];
  const voiced = voiceProgression(chords, choices);
  return { decoded, preview, hasPreview, chords, voiced };
}

/** Index of the chord shown in the result and voice-leading panels. */
function focusIndex(model) {
  if (state.selected !== null && state.selected < state.progression.length) return state.selected;
  return model.hasPreview ? model.chords.length - 1 : null;
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
  return `<span class="stack-row">${stagesLines.map((l) => stackHTML(l.length ? l : ['5', '3'])).join('<span class="dash">–</span>')}</span>`;
}

function numeralHTML(chord) {
  const n = chord.main.numeral;
  if (!n) return '<span class="numeral">?</span>';
  const sus = chord.label.includes('(') ? ` <small>${esc(chord.label.slice(chord.label.indexOf('(')))}</small>` : '';
  return `<span class="numeral">${esc(n.accidental + n.base + n.mark)}${stackHTML(n.figs, true)}${n.of ? `<span class="of">/${esc(n.of)}</span>` : ''}${sus}</span>`;
}

function shortNumeral(chord) {
  return numeralText(chord.main.numeral);
}

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

// ---------------------------------------------------------------- rendering

function renderControls() {
  const key = currentKey();
  const tonicSel = $('key-tonic');
  tonicSel.innerHTML = KEY_TONICS[state.mode]
    .map((t) => `<option value="${t}"${t === state.tonic ? ' selected' : ''}>${esc(noteName(parseNote(t), sys()))}</option>`)
    .join('');

  for (const b of $('key-mode').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === state.mode));
  for (const b of $('names-choice').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === sys()));
  for (const b of $('bass-acc').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === String(state.bassAcc)));
  $('auto-raise').checked = state.settings.autoRaise;

  $('bass-letters').innerHTML = LETTERS.map((_, i) => {
    const acc = state.bassAcc === 'key' ? signatureAcc(key, i) : Number(state.bassAcc);
    return `<button data-letter="${i}" aria-pressed="${i === state.bassLetter}">${esc(nn({ letter: i, acc }))}</button>`;
  }).join('');

  const fig = $('figures');
  if (fig.value !== state.figures) fig.value = state.figures;
  $('figure-buttons').innerHTML = FIGURE_BUTTONS.map((v) => {
    const parsed = parseFigures(v);
    const lines = parsed.written.map(figureLines);
    const label = v === '' ? '5/3 (root position)' : v;
    return `<button data-fig="${esc(v)}" aria-pressed="${v === state.figures.trim()}" title="${esc(label)}">${stagesHTML(lines)}</button>`;
  }).join('');
}

function renderResult(model, idx) {
  const el = $('result');
  if (idx === null) {
    el.innerHTML = `<p class="error-text">${esc(model.preview.error)}</p>`;
    $('add-chord').disabled = true;
    return;
  }
  $('add-chord').disabled = !model.hasPreview;
  const chord = model.chords[idx];
  const entry = idx < state.progression.length ? state.progression[idx] : null;
  const key = entry ? makeKey(entry.tonic, entry.mode) : currentKey();
  const bass = chord.stages[0].notes[0];
  const a = chord.main;

  const eyebrow = entry
    ? `Chord ${idx + 1} of the progression · ${esc(keyName(key, sys()))} <button class="ghost" id="back-to-new">Back to new chord</button>`
    : `${esc(keyName(key, sys()))} · bass ${esc(nn(bass))} · figures ${stagesHTML(chord.written)}`;

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
    ...chord.hints.map((h) => `<div class="callout warn">${esc(h)}</div>`),
    ...remarks.map((r) => `<div class="callout">${esc(r)}</div>`),
  ].join('');

  el.innerHTML = `
    <div class="result-eyebrow">${eyebrow}</div>
    <div class="result-main"><span class="chord-symbol">${title}</span>${numeralHTML(chord)}</div>
    <p class="long-name">${long}</p>
    <div class="label">Notes in the chord</div>
    <div class="stage-grid">${stagesOut}</div>
    ${callouts ? `<div class="callouts">${callouts}</div>` : ''}`;
  const back = $('back-to-new');
  if (back) back.addEventListener('click', () => { state.selected = null; update(); });
}

function renderVoiceLeading(model, idx) {
  const el = $('voice-leading');
  const btn = $('next-voicing');
  if (idx === null) {
    el.innerHTML = '<p class="empty">Fix the figures to see a voicing.</p>';
    btn.disabled = true;
    return;
  }
  const stages = model.voiced[idx];
  const prevChord = idx > 0 ? model.voiced[idx - 1] : null;
  const prev = prevChord ? prevChord[prevChord.length - 1] : null;
  btn.disabled = !stages[0].midis || stages[0].alternatives < 2;

  const columns = [];
  if (prev?.midis) columns.push({ title: `Previous (${esc(shortNumeral(model.chords[idx - 1]))})`, v: prev });
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

function renderProgression(model, idx) {
  const staffChords = [];
  model.chords.forEach((chord, ci) => {
    const isPreview = ci >= state.progression.length;
    const color = isPreview ? PREVIEW_COLOR : ci === state.selected ? SELECTED_COLOR : undefined;
    chord.stages.forEach((_, si) => {
      const v = model.voiced[ci][si];
      staffChords.push({
        notes: v.notes,
        figures: [...(chord.written[si] ?? [])].length ? chord.written[si] : [],
        numeral: si === 0 ? shortNumeral(chord) : '',
        color,
      });
    });
  });
  renderStaff($('staff'), { keySpec: vexKeySpec(currentKey()), chords: staffChords });
  const wrap = $('staff').parentElement;
  if (state.selected === null) wrap.scrollLeft = wrap.scrollWidth;

  $('history').innerHTML = state.progression.map((e, i) => {
    const chord = model.decoded[i];
    const sym = chordSymbolText(chord.main, sys());
    return `<li><button data-index="${i}" aria-pressed="${i === idx && state.selected !== null}">
      <span class="idx">${i + 1}</span><span class="h-num">${esc(chord.label)}</span>
      <span class="h-sub">${esc(sym || '')} · ${esc(nn(e.bass))} ${esc(e.figures || '5/3')}</span></button></li>`;
  }).join('') || '<li class="empty">No chords yet. Choose a bass and figures, then press “Add to progression”.</li>';

  $('undo').disabled = state.progression.length === 0;
  $('clear-all').disabled = state.progression.length === 0;
  $('delete-selected').hidden = state.selected === null;
}

function update() {
  save();
  renderControls();
  const model = compute();
  const idx = focusIndex(model);
  renderResult(model, idx);
  renderVoiceLeading(model, idx);
  renderProgression(model, idx);
}

// ---------------------------------------------------------------- events

function setInput(changes) {
  Object.assign(state, changes, { previewChoice: [], selected: null });
  update();
}

function addChord() {
  const preview = decode(currentKey(), currentBass(), state.figures, decodeOptions());
  if (preview.error) return;
  state.progression.push({ tonic: state.tonic, mode: state.mode, bass: currentBass(), figures: state.figures.trim(), choice: state.previewChoice });
  state.figures = '';
  state.bassAcc = 'key';
  state.previewChoice = [];
  state.selected = null;
  update();
}

function closestTonic(mode, tonic) {
  if (KEY_TONICS[mode].includes(tonic)) return tonic;
  const target = pc(parseNote(tonic));
  return KEY_TONICS[mode].find((t) => pc(parseNote(t)) === target) ?? KEY_TONICS[mode][0];
}

function bind() {
  $('key-tonic').addEventListener('change', (e) => setInput({ tonic: e.target.value }));
  $('key-mode').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setInput({ mode: b.dataset.value, tonic: closestTonic(b.dataset.value, state.tonic) });
  });
  $('bass-letters').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setInput({ bassLetter: Number(b.dataset.letter) });
  });
  $('bass-acc').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setInput({ bassAcc: b.dataset.value === 'key' ? 'key' : Number(b.dataset.value) });
  });
  $('figure-buttons').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    setInput({ figures: b.dataset.fig });
    $('figures').focus();
  });
  $('figures').addEventListener('input', (e) => setInput({ figures: e.target.value }));
  $('figures').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addChord(); }
  });
  $('clear-figures').addEventListener('click', () => { setInput({ figures: '' }); $('figures').focus(); });
  $('add-chord').addEventListener('click', addChord);

  $('next-voicing').addEventListener('click', () => {
    const model = compute();
    const idx = focusIndex(model);
    if (idx === null) return;
    const total = Math.min(model.voiced[idx][0].alternatives, MAX_ALTERNATIVES);
    const target = idx < state.progression.length ? state.progression[idx] : null;
    const current = (target ? target.choice?.[0] : state.previewChoice[0]) ?? 0;
    const next = [(current + 1) % total];
    if (target) target.choice = next;
    else state.previewChoice = next;
    update();
  });

  $('undo').addEventListener('click', () => {
    state.progression.pop();
    state.selected = null;
    update();
  });
  $('clear-all').addEventListener('click', () => {
    if (state.progression.length && !confirm('Clear the whole progression?')) return;
    state.progression = [];
    state.selected = null;
    update();
  });
  $('delete-selected').addEventListener('click', () => {
    if (state.selected === null) return;
    state.progression.splice(state.selected, 1);
    state.selected = null;
    update();
  });
  $('history').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-index]');
    if (!b) return;
    const i = Number(b.dataset.index);
    state.selected = state.selected === i ? null : i;
    update();
  });

  $('settings-toggle').addEventListener('click', () => {
    const panel = $('settings');
    panel.hidden = !panel.hidden;
    $('settings-toggle').setAttribute('aria-expanded', String(!panel.hidden));
  });
  $('names-choice').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.settings.names = b.dataset.value;
    update();
  });
  $('auto-raise').addEventListener('change', (e) => {
    state.settings.autoRaise = e.target.checked;
    update();
  });

  // Keyboard: letters A-G pick the bass when not typing in a field.
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const i = 'cdefgab'.indexOf(e.key.toLowerCase());
    if (i >= 0 && e.key.length === 1) {
      setInput({ bassLetter: i, bassAcc: 'key' });
      $('figures').focus();
      e.preventDefault();
    }
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(update, 150);
  });
}

bind();
update();

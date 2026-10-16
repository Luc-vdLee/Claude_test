// Grand-staff rendering of the progression with VexFlow (loaded as the global `Vex`).
// Bars come from theory/score.js; this file only draws them, wrapping onto systems.

import { LETTERS } from '../theory/pitch.js';

const SYSTEM_HEIGHT = 330;
const TREBLE_Y = 10;
const BASS_Y = 110;
const MIN_BAR_WIDTH = 90;
const PER_NOTE = 40;

function vexKey(note) {
  const acc = note.acc > 0 ? '#'.repeat(note.acc) : 'b'.repeat(-note.acc);
  return `${LETTERS[note.letter].toLowerCase()}${acc}/${note.octave}`;
}

const KEY_ACCIDENTALS = {
  C: 0, Am: 0, G: 1, Em: 1, D: 2, Bm: 2, A: 3, 'F#m': 3, E: 4, 'C#m': 4, B: 5, 'G#m': 5, 'F#': 6, 'D#m': 6, 'C#': 7, 'A#m': 7,
  F: 1, Dm: 1, Bb: 2, Gm: 2, Eb: 3, Cm: 3, Ab: 4, Fm: 4, Db: 5, Bbm: 5, Gb: 6, Ebm: 6, Cb: 7, Abm: 7,
};
const keySigWidth = (key) => (KEY_ACCIDENTALS[key] ?? 0) * 11 + 6;

function barWidth(bar) {
  const n = Math.max(...bar.voices.map((v) => v.length), 1);
  return Math.max(MIN_BAR_WIDTH, 30 + n * PER_NOTE);
}

function headerWidth(bar, first) {
  return 42 + keySigWidth(bar.key) + (first ? 34 : 0);
}

/** Group bars into systems (lines) that fit `width`. */
function planSystems(bars, width) {
  const systems = [];
  let cur = null;
  bars.forEach((bar, i) => {
    const w = barWidth(bar) + (bar.keyChanged ? keySigWidth(bar.key) + 10 : 0);
    if (!cur || cur.used + w > width) {
      const hw = headerWidth(bar, i === 0);
      cur = { bars: [], widths: [], used: hw, header: hw };
      systems.push(cur);
    }
    cur.bars.push(i);
    cur.widths.push(w);
    cur.used += w;
  });
  // Justify every line but the last.
  systems.forEach((s, si) => {
    const free = width - s.used;
    if (si < systems.length - 1 && free > 0) {
      const total = s.widths.reduce((a, b) => a + b, 0);
      s.widths = s.widths.map((w) => w + (free * w) / total);
    }
  });
  return systems;
}

function beamTicks(timeSig) {
  if (timeSig.den === 8) return timeSig.num % 3 === 0 && timeSig.num > 3 ? 6 : timeSig.num * 2;
  return 4;
}

function makeNote(VF, clef, piece, voice, color) {
  let sn;
  if (piece.ghost) {
    sn = new VF.GhostNote({ duration: piece.duration, dots: piece.dots });
  } else if (piece.rest) {
    // One visible rest per staff; the other voice gets an invisible placeholder.
    if (voice === 0 || voice === 2) sn = new VF.GhostNote({ duration: piece.duration + 'r', dots: piece.dots });
    else sn = new VF.StaveNote({ clef, keys: [clef === 'treble' ? 'b/4' : 'd/3'], duration: piece.duration + 'r', dots: piece.dots });
  } else {
    const stem = voice === 3 || voice === 1 ? VF.Stem.UP : VF.Stem.DOWN;
    sn = new VF.StaveNote({ clef, keys: [vexKey(piece.note)], duration: piece.duration, dots: piece.dots, stem_direction: stem });
  }
  if (piece.dots && sn instanceof VF.StaveNote) VF.Dot.buildAndAttach([sn], { all: true });
  if (color && sn.setStyle) sn.setStyle({ fillStyle: color, strokeStyle: color });
  return sn;
}

/**
 * @param {HTMLElement} container
 * @param {object} data
 * @param {Array} data.bars           from layoutBars
 * @param {{num:number, den:number}} data.timeSig
 * @param {Array<{color?:string, stages:Array<{figures:string[], numeral:string}>}|null>} data.events
 * @param {(hit:{event:number, stage:number, clef?:string, diatonic?:number})=>void} [data.onSelect]
 *        called on a click with the nearest chord step and, for clicks on a staff, the
 *        clicked position as a diatonic step number (octave * 7 + letter).
 */
export function renderScore(container, { bars, timeSig, events, onSelect, emptyKey }) {
  container.innerHTML = '';
  const VF = window.Vex?.Flow;
  if (!VF) {
    container.textContent = 'The notation library could not be loaded.';
    return;
  }
  const width = Math.max(320, (container.parentElement?.clientWidth || 600) - 2);

  if (bars.length === 0) {
    const renderer = new VF.Renderer(container, VF.Renderer.Backends.SVG);
    renderer.resize(width, 230);
    const ctx = renderer.getContext();
    const t = new VF.Stave(10, TREBLE_Y, width - 20).addClef('treble').addKeySignature(emptyKey).addTimeSignature(`${timeSig.num}/${timeSig.den}`);
    const b = new VF.Stave(10, BASS_Y, width - 20).addClef('bass').addKeySignature(emptyKey).addTimeSignature(`${timeSig.num}/${timeSig.den}`);
    t.setContext(ctx).draw();
    b.setContext(ctx).draw();
    new VF.StaveConnector(t, b).setType('brace').setContext(ctx).draw();
    new VF.StaveConnector(t, b).setType('singleLeft').setContext(ctx).draw();
    ctx.save();
    ctx.setFont('Georgia', 14, 'italic');
    ctx.setFillStyle('#888');
    ctx.fillText('Your chords will appear here.', t.getNoteStartX() + 10, 102);
    ctx.restore();
    return;
  }

  const systems = planSystems(bars, width - 20);
  const renderer = new VF.Renderer(container, VF.Renderer.Backends.SVG);
  renderer.resize(width, systems.length * SYSTEM_HEIGHT + 10);
  const ctx = renderer.getContext();

  const sequence = [[], [], [], []]; // per voice: { piece, sn, system }
  const hitboxes = [];
  const stageHits = [];
  const systemGeo = [];
  const beat = beamTicks(timeSig);
  const barLen = (timeSig.num * 16) / timeSig.den;

  systems.forEach((system, si) => {
    const top = si * SYSTEM_HEIGHT;
    const labels = []; // figures/numerals, drawn once the line's lowest note is known
    let lowest = top + BASS_Y + 80;
    let x = 10;
    let geoSet = false;
    system.bars.forEach((bi, k) => {
      const bar = bars[bi];
      const first = k === 0;
      const w = system.widths[k] + (first ? system.header : 0);
      const treble = new VF.Stave(x, top + TREBLE_Y, w);
      const bass = new VF.Stave(x, top + BASS_Y, w);
      if (!geoSet) {
        systemGeo.push({ y0: top, y1: top + SYSTEM_HEIGHT, trebleTop: treble.getYForLine(0), bassTop: bass.getYForLine(0), spacing: treble.getSpacingBetweenLines() });
        geoSet = true;
      }
      for (const [stave, clef] of [[treble, 'treble'], [bass, 'bass']]) {
        if (first) stave.addClef(clef).addKeySignature(bar.key);
        else if (bar.keyChanged) stave.addKeySignature(bar.key, bars[bi - 1].key);
        if (bi === 0) stave.addTimeSignature(`${timeSig.num}/${timeSig.den}`);
        if (bi === bars.length - 1) stave.setEndBarType(VF.Barline.type.END);
        else if (bars[bi + 1].keyChanged) stave.setEndBarType(VF.Barline.type.DOUBLE);
        stave.setContext(ctx).draw();
      }
      if (first) {
        new VF.StaveConnector(treble, bass).setType('brace').setContext(ctx).draw();
        new VF.StaveConnector(treble, bass).setType('singleLeft').setContext(ctx).draw();
      }
      const endType = bi === bars.length - 1 ? 'boldDoubleRight' : bars[bi + 1]?.keyChanged ? 'thinDouble' : 'singleRight';
      new VF.StaveConnector(treble, bass).setType(endType).setContext(ctx).draw();

      const notes = bar.voices.map((pieces, v) => pieces.map((p) => makeNote(VF, v >= 2 ? 'treble' : 'bass', p, v, events[p.event]?.color)));
      const voices = notes.map((ns) => new VF.Voice({ num_beats: 4, beat_value: 4 }).setMode(VF.Voice.Mode.SOFT).addTickables(ns));
      VF.Accidental.applyAccidentals([voices[3], voices[2]], bar.key);
      VF.Accidental.applyAccidentals([voices[1], voices[0]], bar.key);

      const beams = [];
      bar.voices.forEach((pieces, v) => {
        let group = [];
        let groupId = null;
        const flush = () => { if (group.length > 1) beams.push(new VF.Beam(group)); group = []; };
        pieces.forEach((p, i) => {
          const beamable = !p.rest && (p.duration === '8' || p.duration === '16');
          const id = Math.floor((p.start - (bar.end - barLen)) / beat);
          if (!beamable || id !== groupId) flush();
          if (beamable) { group.push(notes[v][i]); groupId = id; }
        });
        flush();
      });

      const noteWidth = treble.getNoteEndX() - treble.getNoteStartX() - 12;
      new VF.Formatter().joinVoices([voices[3], voices[2]]).joinVoices([voices[1], voices[0]])
        .format(voices, Math.max(40, noteWidth));
      voices[3].draw(ctx, treble);
      voices[2].draw(ctx, treble);
      voices[1].draw(ctx, bass);
      voices[0].draw(ctx, bass);
      beams.forEach((b) => b.setContext(ctx).draw());

      bar.voices.forEach((pieces, v) => pieces.forEach((p, i) => sequence[v].push({ piece: p, sn: notes[v][i], system: si })));

      // Where each chord (or suspension step) starts: the first voice with a note there.
      for (const st of bar.stageStarts) {
        let sn = null;
        for (const v of [1, 2, 3, 0]) {
          const idx = bar.voices[v].findIndex((p) => p.start === st.tick);
          if (idx >= 0) { sn = notes[v][idx]; break; }
        }
        const info = events[st.event]?.stages?.[st.stage];
        if (sn && info) labels.push({ x: sn.getAbsoluteX() + 6, info, color: events[st.event].color, selected: info.selected, y: top });
        if (sn) stageHits.push({ event: st.event, stage: st.stage, x: sn.getAbsoluteX() + 6, y0: top, y1: top + SYSTEM_HEIGHT });
      }
      for (const sn of notes[0]) {
        const bb = sn.getBoundingBox?.();
        if (bb) lowest = Math.max(lowest, bb.getY() + bb.getH());
      }
      bar.voices[1].forEach((p, i) => {
        const sn = notes[1][i];
        const nx = sn.getAbsoluteX();
        hitboxes.push({ event: p.event, x: nx + 6, y0: top, y1: top + SYSTEM_HEIGHT });
      });
      x += w;
    });

    const baseY = lowest + 20;
    for (const { x: nx, info, color, selected } of labels) {
      ctx.save();
      if (selected) {
        ctx.setFillStyle('#1d5fa8');
        ctx.beginPath();
        ctx.moveTo(nx - 7, top + 2);
        ctx.lineTo(nx + 7, top + 2);
        ctx.lineTo(nx, top + 12);
        ctx.closePath();
        ctx.fill();
      }
      if (color) ctx.setFillStyle(color);
      ctx.setFont('Georgia', 14, '');
      info.figures.forEach((line, li) => {
        const lw = ctx.measureText(line).width;
        ctx.fillText(line, nx - lw / 2, baseY + li * 15);
      });
      if (info.numeral) {
        ctx.setFont('Georgia', 14, 'bold');
        const lw = ctx.measureText(info.numeral).width;
        ctx.fillText(info.numeral, nx - lw / 2, Math.max(baseY + 3 * 15 + 10, top + BASS_Y + 160));
      }
      ctx.restore();
    }
  });

  // Ties (also across barlines and line breaks).
  sequence.forEach((items) => {
    items.forEach((item, i) => {
      if (!item.piece.tieToNext) return;
      const next = items[i + 1];
      if (!next) return;
      if (next.system === item.system) {
        new VF.StaveTie({ first_note: item.sn, last_note: next.sn, first_indices: [0], last_indices: [0] }).setContext(ctx).draw();
      } else {
        new VF.StaveTie({ first_note: item.sn, last_note: null, first_indices: [0], last_indices: [0] }).setContext(ctx).draw();
        new VF.StaveTie({ first_note: null, last_note: next.sn, first_indices: [0], last_indices: [0] }).setContext(ctx).draw();
      }
    });
  });

  if (onSelect) {
    const svg = container.querySelector('svg');
    svg.style.cursor = 'pointer';
    svg.addEventListener('click', (e) => {
      const r = svg.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const nearest = (list) => {
        let best = null;
        for (const h of list) {
          if (py < h.y0 || py > h.y1) continue;
          const d = Math.abs(px - h.x);
          if (d < 45 && (!best || d < best.d)) best = { d, h };
        }
        return best?.h ?? null;
      };
      const stage = nearest(stageHits);
      if (!stage) {
        const any = nearest(hitboxes);
        if (any) onSelect({ event: any.event, stage: 0 });
        return;
      }
      const geo = systemGeo.find((g) => py >= g.y0 && py <= g.y1);
      const half = geo.spacing / 2;
      const trebleBottom = geo.trebleTop + 4 * geo.spacing;
      const clef = py < (trebleBottom + geo.bassTop) / 2 ? 'treble' : 'bass';
      const topLine = clef === 'treble' ? geo.trebleTop : geo.bassTop;
      const topDiatonic = clef === 'treble' ? 5 * 7 + 3 : 3 * 7 + 5; // F5 / A3
      const diatonic = topDiatonic - Math.round((py - topLine) / half);
      // Clicks far outside the staves (e.g. on the figures) only select the chord.
      const inRange = clef === 'treble' ? diatonic <= topDiatonic + 5 : diatonic >= topDiatonic - 8 - 6;
      onSelect({ event: stage.event, stage: stage.stage, clef, diatonic: inRange ? diatonic : null });
    });
  }
}

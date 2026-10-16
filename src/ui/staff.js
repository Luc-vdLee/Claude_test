// Grand-staff rendering of the progression with VexFlow (loaded as the global `Vex`).

import { LETTERS } from '../theory/pitch.js';

const CHORD_WIDTH = 74;
const HEIGHT = 330;

function vexKey(note) {
  const acc = note.acc > 0 ? '#'.repeat(note.acc) : 'b'.repeat(-note.acc);
  return `${LETTERS[note.letter].toLowerCase()}${acc}/${note.octave}`;
}

function makeNote(VF, clef, note, stemDirection, color) {
  const sn = note
    ? new VF.StaveNote({ clef, keys: [vexKey(note)], duration: 'q', stem_direction: stemDirection })
    : new VF.StaveNote({ clef, keys: [clef === 'treble' ? 'b/4' : 'd/3'], duration: 'qr' });
  if (color) sn.setStyle({ fillStyle: color, strokeStyle: color });
  return sn;
}

function keySigWidth(keySpec) {
  const counts = { C: 0, Am: 0, G: 1, Em: 1, D: 2, Bm: 2, A: 3, 'F#m': 3, E: 4, 'C#m': 4, B: 5, 'G#m': 5, 'F#': 6, 'D#m': 6, 'C#': 7, 'A#m': 7,
    F: 1, Dm: 1, Bb: 2, Gm: 2, Eb: 3, Cm: 3, Ab: 4, Fm: 4, Db: 5, Bbm: 5, Gb: 6, Ebm: 6, Cb: 7, Abm: 7 };
  return (counts[keySpec] ?? 0) * 11;
}

/**
 * @param {HTMLElement} container
 * @param {{keySpec: string, chords: Array<{notes: Array|null, figures: string[], numeral: string, color?: string}>}} data
 */
export function renderStaff(container, { keySpec, chords }) {
  container.innerHTML = '';
  const VF = window.Vex?.Flow;
  if (!VF) {
    container.textContent = 'The notation library could not be loaded.';
    return;
  }

  const left = 80 + keySigWidth(keySpec);
  const available = container.parentElement?.clientWidth || 600;
  const width = Math.max(available - 2, left + chords.length * CHORD_WIDTH + 40);

  const renderer = new VF.Renderer(container, VF.Renderer.Backends.SVG);
  renderer.resize(width, HEIGHT);
  const ctx = renderer.getContext();

  const treble = new VF.Stave(10, 20, width - 20).addClef('treble').addKeySignature(keySpec);
  const bass = new VF.Stave(10, 120, width - 20).addClef('bass').addKeySignature(keySpec);
  treble.setContext(ctx).draw();
  bass.setContext(ctx).draw();
  new VF.StaveConnector(treble, bass).setType('brace').setContext(ctx).draw();
  new VF.StaveConnector(treble, bass).setType('singleLeft').setContext(ctx).draw();
  new VF.StaveConnector(treble, bass).setType('singleRight').setContext(ctx).draw();

  if (chords.length === 0) {
    ctx.save();
    ctx.setFont('Georgia', 14, 'italic');
    ctx.setFillStyle('#888');
    ctx.fillText('Your chords will appear here.', treble.getNoteStartX() + 10, 112);
    ctx.restore();
    return;
  }

  const lists = { S: [], A: [], T: [], B: [] };
  for (const c of chords) {
    const n = c.notes ?? [null, null, null, null];
    lists.S.push(makeNote(VF, 'treble', n[3], VF.Stem.UP, c.color));
    lists.A.push(makeNote(VF, 'treble', n[2], VF.Stem.DOWN, c.color));
    lists.T.push(makeNote(VF, 'bass', n[1], VF.Stem.UP, c.color));
    lists.B.push(makeNote(VF, 'bass', n[0], VF.Stem.DOWN, c.color));
  }

  const voice = (notes) => new VF.Voice({ num_beats: notes.length, beat_value: 4 }).setMode(VF.Voice.Mode.SOFT).addTickables(notes);
  const sV = voice(lists.S);
  const aV = voice(lists.A);
  const tV = voice(lists.T);
  const bV = voice(lists.B);
  VF.Accidental.applyAccidentals([sV, aV], keySpec);
  VF.Accidental.applyAccidentals([tV, bV], keySpec);

  const justify = chords.length * CHORD_WIDTH - 20;
  new VF.Formatter().joinVoices([sV, aV]).joinVoices([tV, bV]).format([sV, aV, tV, bV], justify);
  sV.draw(ctx, treble);
  aV.draw(ctx, treble);
  tV.draw(ctx, bass);
  bV.draw(ctx, bass);

  // Figures and Roman numerals under the bass.
  const baseY = bass.getYForLine(4) + 58;
  chords.forEach((c, i) => {
    const note = lists.B[i];
    const x = note.getAbsoluteX() + note.getGlyphWidth() / 2;
    ctx.save();
    if (c.color) ctx.setFillStyle(c.color);
    ctx.setFont('Georgia', 14, '');
    c.figures.forEach((line, li) => {
      const w = ctx.measureText(line).width;
      ctx.fillText(line, x - w / 2, baseY + li * 15);
    });
    ctx.setFont('Georgia', 14, 'bold');
    const w = ctx.measureText(c.numeral).width;
    ctx.fillText(c.numeral, x - w / 2, baseY + 3 * 15 + 12);
    ctx.restore();
  });
}

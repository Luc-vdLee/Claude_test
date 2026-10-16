// Bass note + key + figures -> chord(s) with analysis.

import { parseFigures, figureLines } from './figures.js';
import { realize, analyze, numeralText } from './chord.js';
import { scaleNote, leadingTone, degreeOfLetter } from './key.js';
import { sameSpelling, spellingKey, noteName } from './pitch.js';

/** Mark suspensions: a figure that steps down to the next lower figure in the next stage. */
function markSuspensions(stages) {
  for (let i = 0; i < stages.length - 1; i++) {
    const nextNums = new Set(stages[i + 1].figures.map((f) => f.num));
    for (const f of stages[i].figures) {
      if (nextNums.has(f.num) || !nextNums.has(f.num - 1) || f.num === 2) continue;
      const note = stages[i].notes.find((n) => n.figure === f.num);
      const role = stages[i].analysis.roles.get(spellingKey(note));
      if (role) {
        role.tendency = -1;
        role.suspension = `${f.num}–${f.num - 1}`;
      }
    }
  }
}

/**
 * @param {object} key  from makeKey
 * @param {{letter:number, acc:number}} bass
 * @param {string} figureText
 * @param {{autoRaise?: boolean}} options  autoRaise: raise the leading tone in V chords in minor
 */
export function decode(key, bass, figureText, options = {}) {
  const parsed = parseFigures(figureText);
  if (parsed.error) return { error: parsed.error };

  const hints = [];
  const stages = parsed.stages.map((figures) => {
    let notes = realize(key, bass, figures);
    let analysis = analyze(key, notes);

    if (key.mode === 'minor' && analysis.type === 'tertian' && degreeOfLetter(key, analysis.root.letter) === 4) {
      const subtonic = scaleNote(key, 6);
      const idx = notes.findIndex((n) => sameSpelling(n, subtonic) && !n.alter && n.figure !== 1);
      if (idx >= 0) {
        if (options.autoRaise) {
          const lt = leadingTone(key);
          notes = notes.map((n, i) => (i === idx ? { ...n, acc: lt.acc, alter: 'raise', autoRaised: true } : n));
          analysis = analyze(key, notes);
          hints.push(`Leading tone raised automatically to ${noteName(lt)} (setting "Raise leading tone in minor").`);
        } else {
          const fig = notes[idx].figure;
          hints.push(`In minor, V normally has a raised leading tone (${noteName(leadingTone(key))}). To get it, add ${fig === 3 ? 'a lone ♯ (it raises the 3rd)' : `♯ to the ${fig}`}, or turn on "Raise leading tone in minor" in Settings.`);
        }
      }
    }
    return { figures, notes, analysis };
  });

  markSuspensions(stages);

  const last = stages[stages.length - 1].analysis;
  const suspensions = stages.flatMap((s) => [...s.analysis.roles.values()].filter((r) => r.suspension).map((r) => r.suspension));
  const label = (numeralText(last.numeral) || '?') + (suspensions.length ? ` (${suspensions.join(', ')})` : '');

  return {
    stages,
    written: parsed.written.map(figureLines),
    hints,
    label,
    main: last,
  };
}

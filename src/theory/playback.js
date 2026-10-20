// Turning the voiced progression into timed notes for playback.
//
// Works on the segments from buildVoices (score.js), so playback follows the
// score exactly: held notes stay held, suspensions move only the upper voices,
// and rests are silent. Times are in seconds.

export const TEMPO = 72; // quarter notes per minute

/** Seconds per tick (a sixteenth note) at `tempo` quarter notes per minute. */
export const tickSeconds = (tempo = TEMPO) => 60 / tempo / 4;

/**
 * @param {{voices: Array<Array<{start, ticks, midi, event}>>, total: number}} built   from buildVoices
 * @param {{tempo?: number}} [opts]
 * @returns {{ notes: Array<{voice, midi, start, duration, event}>, events: Array<{event, start}>, length: number }}
 *   voice: 0 = bass … 3 = soprano. `events` lists when each chord or rest starts.
 */
export function playbackNotes(built, { tempo = TEMPO } = {}) {
  const sec = tickSeconds(tempo);
  const notes = [];
  built.voices.forEach((segments, voice) => {
    for (const seg of segments) {
      if (seg.midi == null) continue;
      notes.push({ voice, midi: seg.midi, start: seg.start * sec, duration: seg.ticks * sec, event: seg.event });
    }
  });
  notes.sort((a, b) => a.start - b.start || a.voice - b.voice);
  const events = [];
  for (const seg of built.voices[0]) {
    if (!events.some((e) => e.event === seg.event)) events.push({ event: seg.event, start: seg.start * sec });
  }
  return { notes, events, length: built.total * sec };
}

/** Frequency in Hz of a MIDI note number (A4 = 69 = 440 Hz). */
export const frequency = (m) => 440 * 2 ** ((m - 69) / 12);

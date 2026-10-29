# Figured Bass Decoder

A small web app for realizing figured bass. Pick a key, a bass note and the figures, and it tells you:

- **which chord to build**: chord symbol, quality and inversion (e.g. *D/F♯, D major triad, first inversion*)
- **the notes in it**, spelled correctly for the key, with each note's role (root, 3rd, 5th, 7th, suspension)
- **the Roman numeral**, including secondary dominants (`V65/V`), the Neapolitan (`N6`) and augmented sixths (`It+6`, `Fr+6`, `Ger+6`)
- **a four-part (SATB) voicing** that connects smoothly to the previous chord: no parallel 5ths or octaves, the leading tone rises, 7ths and suspensions resolve down. If you'd like something different, *Try another voicing* cycles through the next-best options.

**Layout**: the chord you are working on always sits in a strip at the top: key, bass note, accidental, octave and note value on the left, the figures in the middle, and the result with *Add to score* on the right. The figure buttons show one row of common figures (blank, 5/3, 6, 6/4, 7, 6/5); *More* opens two extra rows with the rest and keeps them open until you press *Less*. Below the strip, tabs hold the Score, Voicing, Keyboard, Bass line, Exercises and Settings. On a computer or iPad everything fits on one screen and only the tab content scrolls; on a phone the page scrolls as before.

Every chord you add goes into the progression, which is drawn as a score on a grand staff with the figures and Roman numerals underneath:

- **Note values**: eighth, quarter or half notes, plus rests in all voices. In a suspension (`4-3`) the bass holds while the upper voices move.
- **Score settings**: time signature (2/4, 3/4, 4/4, 2/2, 3/8, 6/8 or custom), an optional pickup bar, and the starting key signature. Barlines are placed automatically, and notes that cross a barline are tied.
- **Key changes**: when you change key partway through, you choose whether the score prints a new key signature (after a double barline) or keeps the old one with accidentals.
- **Bass octave**: the app picks the octave closest to the previous bass; ↓ 8va / ↑ 8va fix it an octave lower or higher, *Auto* goes back.
- **Type a whole bass line** at once, e.g. `C  D:6/4/3  E:6  F#3/8:6/5  G/h:6/4-5/3  r  C/h` (octave, `/8 /q /h` note value, figures after `:`, `r` for a rest).
- **Suggest figures** for a bass note, or for all blank notes in a typed line, with the Rule of the Octave (rising and falling, major and minor).
- **Why this voicing?**: a collapsed section under the voice leading lists the best voicings the app considered, with the penalty points each one got and where they come from (voice motion, leaps, doubling, parallels, unresolved tendency tones…). The lowest total wins.
- **Piano keyboard**: the current voicing is shown on a keyboard, colored by voice, with the previous chord as faint outlines.
- **Practice mode**: write the soprano, alto and tenor yourself (tap the staff or the keyboard; ♭ ♮ ♯ and ↑/↓ adjust the note), then *Check my voices*: wrong notes, spelling, missing chord members, doubling, crossing, spacing, parallels and unresolved tendency tones are marked per chord. *Show solution* shows the app's voicing.
- **Sound**: *Play* plays the whole harmony at 72 bpm, following the score (held notes, suspensions, rests). Tap S, A, T or B to hear only the voices you pick (one, two, three or all four), even while it plays. *Loop* starts again at the end. *▶ Hear* plays just the current chord. Space plays or stops on a computer.
- **Quick entry**: with *Quick add* on, tapping a figure adds the chord at once, so a chord is two taps (bass, figure). On a computer, type a letter for the bass, digits for the figures and Enter. Tap a chord in the score or the list to open a small quick-edit panel: tap a figure or move the bass a step and the change is saved straight away; ◀ ▶ (or the arrow keys) go to the previous or next chord.
- **Print / PDF**: page 1 holds only the score (figures and Roman numerals); the analysis table of every chord follows on its own page. Use the browser's *Save as PDF* to get a file.
- **Choose what's shown**: in Settings, *Show in the app* switches optional parts on or off (octave controls, figure buttons, figure help, note values, typed bass line, voice leading, keyboard, sound, practice, score settings, Print / PDF, exercises). The key, bass and figures input, the result and the score are always shown.
- **Exercises**: progressions save automatically as named exercises in the browser. Open, rename, duplicate or delete them, and export/import `.figbass.json` files to move them between devices.
- **Editing**: tap a chord in the score or the list to edit it, insert a chord before it, or delete it. The chords after it are re-voiced. Note names can be shown in English (C♯, B♭, B), German (Cis, B, H) or Dutch (Cis, Bes, B).

**Live app:** https://luc-vdlee.github.io/Claude_test/

## Typing figures

| Input | Meaning |
| --- | --- |
| *(blank)* | unfigured bass: root-position triad, nothing printed |
| `5`, `5/3` | root-position triad, with the figures printed |
| `6`, `6/4` | first / second inversion |
| `7`, `6/5`, `4/3`, `4/2` (or `2`) | seventh chord and its inversions |
| `#`, `b`, `n` (♮) on their own | alter the 3rd above the bass |
| `#6`, `b7`, `6#`, `6+`, `6\` | altered figures (`+` and `\` = raised) |
| `4-3`, `9-8`, `7-6`, `6/4-5/3`, `7 4-3` | figures that follow each other over one bass note |

Figures are read against the key signature, and accidentals raise or lower the note in the key signature by a half step, as in historical practice. In F major, for example, `#` above G turns B♭ into B♮. In minor keys the leading tone has to be figured (`#` above the dominant). There is a setting that adds it automatically.

## Development

Plain HTML, CSS and JavaScript modules, with no build step.

```sh
npm start   # serves the app at http://localhost:8000
npm test    # unit tests for the music theory (Node 18+)
```

- `src/theory/` – the music logic, with no browser code: pitch spelling, keys, figure parsing, chord analysis and the SATB voicing engine
- `src/ui/` – the page and the staff rendering
- `vendor/` – [VexFlow](https://www.vexflow.com/) 4.2.2 (MIT) for the notation

Pushes to `main` run the tests and deploy to GitHub Pages (`.github/workflows/pages.yml`).

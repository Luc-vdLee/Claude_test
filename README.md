# Figured Bass Decoder

A small web app for realizing figured bass. Pick a key, a bass note and the figures, and it tells you:

- **which chord to build**: chord symbol, quality and inversion (e.g. *D/F♯, D major triad, first inversion*)
- **the notes in it**, spelled correctly for the key, with each note's role (root, 3rd, 5th, 7th, suspension)
- **the Roman numeral**, including secondary dominants (`V65/V`), the Neapolitan (`N6`) and augmented sixths (`It+6`, `Fr+6`, `Ger+6`)
- **a four-part (SATB) voicing** that connects smoothly to the previous chord: no parallel 5ths or octaves, the leading tone rises, 7ths and suspensions resolve down. If you'd like something different, *Try another voicing* cycles through the next-best options.

Every chord you add goes into the progression, which is drawn on a grand staff with figures and Roman numerals underneath. Note names can be shown in English (C♯, B♭, B), German (Cis, B, H) or Dutch (Cis, Bes, B).

**Live app:** https://luc-vdlee.github.io/Claude_test/

## Typing figures

| Input | Meaning |
| --- | --- |
| *(empty)*, `5`, `5/3` | root-position triad |
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

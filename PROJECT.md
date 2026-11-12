# Project tracker: Figured Bass Decoder

Live app: https://luc-vdlee.github.io/Claude_test/
Updated with every change. Last update: 2026-11-12.

## In progress
| Item | Status |
| --- | --- |
| Learn tab: compact lesson decoder (lesson's chords on small staves, "Show in decoder" highlights one) | On branch `claude/figured-bass-decoder`, awaiting approval to merge |

## Up next
- Phone layout pass (desktop was done first, in #13)

## Ideas, not planned yet
- Dotted notes and whole notes
- Keyboard-continuo voicing style
- MusicXML / MIDI export
- Lock a voice (given soprano) and voice around it
- Clef choice for the score

## Shipped
| PR | What |
| --- | --- |
| #1 | First version: decode bass + key + figures into chord, notes, Roman numeral, SATB voicing; staff; note-name systems |
| #2 | Note values, rests, time/key signature, pickup, chord editing |
| #3 | Bass octave control, typed bass lines, figure suggestions (Rule of the Octave) |
| #4 | Piano keyboard view, Practice mode (write and check your own voices) |
| #5 | Print / PDF, saved exercises with export/import |
| #6 | Sound playback, quicker entry, two-page PDF, layout settings |
| #7 | Current-chord strip on top, tabs below, paper look |
| #8 | "Why this voicing?" section with the engine's scores |
| #9 | Learn tab (lessons, quizzes), hear each chord, iPad sound fix |
| #10 | Tab bar moved to the top |
| #11 | Split-pane layout, Piece/Chord cards, Figure Builder keypad, clickable score |
| #12 | Full-width pinned app bar, icon tabs, settings gear |
| #13 | Desktop layout on one screen: three columns, two score lines, slim toolbar |

## Restore points
- `backup/2026-11-12-tabs-on-top`: the app as of PR #10. Any single PR can also be reverted on its own.

## How we work
- One PR per change; tests and a browser check before merging; merging to `main` deploys the site.
- Layout changes are reviewed as screenshots before they go live.

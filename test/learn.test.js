import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LESSONS, REALIZATIONS, makeQuiz, makeQuestion, grade, realizationGrade, figureText, explain, keyOf, exampleData, nextLesson, rng } from '../src/theory/learn.js';
import { parseNote } from '../src/theory/pitch.js';
import { parseLine } from '../src/theory/line.js';

test('every lesson makes valid quizzes: 4 distinct options, one right answer', () => {
  for (const lesson of LESSONS) {
    for (let seed = 1; seed <= 25; seed++) {
      const quiz = makeQuiz(lesson, { seed });
      assert.equal(quiz.length, 10, `${lesson.id} seed ${seed}`);
      for (const q of quiz) {
        assert.equal(q.options.length, 4, `${lesson.id}: ${q.prompt} -> ${q.options}`);
        assert.equal(new Set(q.options).size, 4);
        assert.ok(q.answer >= 0 && q.answer < 4);
        assert.ok(q.options.every((o) => typeof o === 'string' && o.length));
        assert.ok(q.explain.length > 0);
      }
    }
  }
});

test('quizzes are reproducible from their seed and have no repeats', () => {
  const a = makeQuiz(LESSONS[2], { seed: 42 });
  const b = makeQuiz(LESSONS[2], { seed: 42 });
  assert.deepEqual(a, b);
  assert.equal(new Set(a.map((q) => q.id)).size, a.length);
});

test('mixed test draws from several lessons', () => {
  const quiz = makeQuiz(LESSONS, { seed: 7, length: 20 });
  assert.equal(quiz.length, 20);
  assert.ok(new Set(quiz.map((q) => q.lesson)).size >= 3);
});

test('answers match the decoder', () => {
  const six = LESSONS.find((l) => l.id === 'six');
  const rand = rng(3);
  for (let i = 0; i < 30; i++) {
    const q = makeQuestion(six, 'figures', rand);
    assert.match(q.options[q.answer], /^(6|blank|6\/4|6\/5)$/);
  }
  const intervals = LESSONS[0];
  const q = makeQuestion(intervals, 'interval', rng(1));
  assert.match(q.prompt, /above/);
});

test('figureText and explain', () => {
  assert.equal(figureText(''), 'blank');
  assert.equal(figureText('6/4-5/3'), '6/4 – 5/3');
  assert.equal(figureText('#6/4/3'), '♯6/4/3');
  const lines = explain(keyOf('C'), parseNote('E'), '6');
  assert.match(lines[0], /6th above E = C/);
  assert.match(lines[0], /3rd above E = G \(not written/);
  assert.match(lines.at(-1), /I6/);
  const sharp = explain(keyOf('F'), parseNote('G'), '#');
  assert.match(sharp.join(' '), /= B \(the ♯ raises B♭/);
});

test('grading: hints give half a point, stars and pass mark', () => {
  const g = grade([...Array(8).fill({ correct: true }), { correct: true, hinted: true }, { correct: false }]);
  assert.equal(g.percent, 85);
  assert.equal(g.stars, 2);
  assert.ok(g.passed);
  assert.equal(grade(Array(10).fill({ correct: true })).stars, 3);
  assert.equal(realizationGrade(['ok', 'ok', 'warn', 'error']), 63);
  assert.equal(nextLesson({}).id, 'intervals');
  assert.equal(nextLesson({ intervals: { best: 90 } }).id, 'root');
});

test('lesson examples decode, realization lines parse', () => {
  for (const l of LESSONS) for (const ex of l.examples) assert.doesNotMatch(exampleData(ex).result, /Don't|not a/, `${l.id} ${ex}`);
  for (const r of REALIZATIONS) assert.ok(parseLine(r.line).every((it) => !it.error), r.id);
});

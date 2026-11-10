// The Learn tab: lessons with examples, graded quizzes, progress and mistakes to review,
// plus four-part realizations that open in Practice mode.

import {
  LESSONS, REALIZATIONS, QUIZ_LENGTH, PASS_PERCENT, lessonById, makeQuiz, grade,
  exampleData, figureStacks, keyOf, nextLesson,
} from '../theory/learn.js';
import { decode } from '../theory/decode.js';
import { voiceProgression } from '../theory/voicing.js';
import { signatureSpec, keyName } from '../theory/key.js';
import { LETTERS, noteName } from '../theory/pitch.js';
import * as sound from './sound.js';

const LEARN_KEY = 'figured-bass-decoder:learn';
const MAX_MISTAKES = 40;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loadProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(LEARN_KEY) || '{}');
    return { lessons: p.lessons ?? {}, realize: p.realize ?? {}, mistakes: Array.isArray(p.mistakes) ? p.mistakes : [], answered: p.answered ?? 0, correct: p.correct ?? 0, mixed: p.mixed ?? null };
  } catch {
    return { lessons: {}, realize: {}, mistakes: [], answered: 0, correct: 0, mixed: null };
  }
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.root            the Learn tab panel
 * @param {() => string} opts.names          note-name system ('english' | 'german' | 'dutch')
 * @param {() => boolean} opts.soundOn        whether sound is switched on in Settings
 * @param {(ex:{keySpec, bass, figures}) => void} opts.openInDecoder
 * @param {(r:object) => void} opts.startRealization
 */
export function initLearn({ root, names, soundOn, openInDecoder, startRealization }) {
  let progress = loadProgress();
  // view: { name: 'home' } | { name: 'lesson', id } | { name: 'quiz', ... } | { name: 'result', ... }
  let view = { name: 'home' };

  const store = () => {
    try { localStorage.setItem(LEARN_KEY, JSON.stringify(progress)); } catch { /* storage unavailable */ }
  };

  // ------------------------------------------------------------ drawing

  /** A bass staff with the key signature, one bass note and its figures underneath. */
  function drawBass(el, { keySpec, bass, figures, showFigures = true }) {
    el.innerHTML = '';
    const VF = window.Vex?.Flow;
    if (!VF) { el.textContent = noteName(bass, names()); return; }
    const key = keyOf(keySpec);
    const sig = signatureSpec(key);
    const stacks = showFigures ? figureStacks(figures) : [];
    const width = 200 + Math.max(0, stacks.length - 1) * 40;
    const lines = Math.max(1, ...stacks.map((s) => s.length));
    const height = 120 + lines * 18;
    const renderer = new VF.Renderer(el, VF.Renderer.Backends.SVG);
    renderer.resize(width, height);
    const ctx = renderer.getContext();
    const stave = new VF.Stave(4, 0, width - 8).addClef('bass').addKeySignature(sig);
    stave.setContext(ctx).draw();
    const octave = bass.letter >= 4 ? 2 : 3;
    const acc = bass.acc > 0 ? '#'.repeat(bass.acc) : 'b'.repeat(-bass.acc);
    const note = new VF.StaveNote({ clef: 'bass', keys: [`${LETTERS[bass.letter].toLowerCase()}${acc}/${octave}`], duration: 'w' });
    const voice = new VF.Voice({ num_beats: 4, beat_value: 4 }).setMode(VF.Voice.Mode.SOFT).addTickables([note]);
    VF.Accidental.applyAccidentals([voice], sig);
    new VF.Formatter().joinVoices([voice]).format([voice], 40);
    voice.draw(ctx, stave);
    const x = note.getAbsoluteX() + 2;
    const y0 = stave.getYForLine(4) + 36;
    ctx.save();
    ctx.setFont('Georgia', 17, 'bold');
    stacks.forEach((stack, si) => {
      const sx = x + si * 40;
      stack.forEach((line, li) => ctx.fillText(line, sx, y0 + li * 18));
      if (si < stacks.length - 1) ctx.fillText('–', sx + 22, y0);
    });
    ctx.restore();
    const svg = el.querySelector('svg');
    if (svg) svg.setAttribute('aria-label', `Bass ${noteName(bass, names())}${showFigures && figures ? ` with figures ${figures}` : ''}`);
  }

  /** Play the chord(s) of a bass with figures, one stage after the other. */
  function hear({ keySpec, bass, figures }) {
    if (!soundOn()) return;
    const d = decode(keyOf(keySpec), bass, figures);
    if (d.error) return;
    const voiced = voiceProgression([d])[0];
    sound.stop();
    sound.setVoices([true, true, true, true]);
    voiced.forEach((v, i) => setTimeout(() => sound.playChord(v.midis, 1.1), i * 1000));
  }

  // ------------------------------------------------------------ views

  const starsHTML = (n, label = true) => `<span class="stars" ${label ? `aria-label="${n} of 3 stars"` : 'aria-hidden="true"'}>${'★'.repeat(n)}<span class="stars-off">${'★'.repeat(3 - n)}</span></span>`;

  function homeHTML() {
    const passed = LESSONS.filter((l) => (progress.lessons[l.id]?.best ?? 0) >= PASS_PERCENT).length;
    const next = nextLesson(progress.lessons);
    const accuracy = progress.answered ? Math.round((100 * progress.correct) / progress.answered) : null;
    const cards = LESSONS.map((l, i) => {
      const p = progress.lessons[l.id];
      const isNext = next?.id === l.id;
      return `<li class="lesson-card${isNext ? ' next' : ''}${(p?.best ?? 0) >= PASS_PERCENT ? ' done' : ''}">
        <button class="lesson-open" data-lesson="${l.id}">
          <span class="lesson-num">${i + 1}</span>
          <span class="lesson-text"><strong>${esc(l.title)}</strong><span>${esc(l.summary)}</span></span>
          <span class="lesson-score">${p ? `${starsHTML(p.stars)}<small>best ${p.best}%</small>` : isNext ? '<small class="next-tag">Start here</small>' : '<small>not started</small>'}</span>
        </button>
      </li>`;
    }).join('');
    const realize = REALIZATIONS.map((r) => {
      const best = progress.realize[r.id]?.best;
      return `<li><span class="ex-name">${esc(r.title)} <span class="ex-meta">${esc(keyName(keyOf(r.key), names()))} · ${esc(r.about)}</span></span>
        <span class="realize-best">${best != null ? `best ${best}%` : ''}</span>
        <button class="ghost" data-realize="${r.id}">${best != null ? 'Again' : 'Start'}</button></li>`;
    }).join('');
    return `
      <div class="learn-head">
        <div>
          <h2>Learn to read figured bass</h2>
          <p class="hint">Nine short lessons, each with a quiz of ${QUIZ_LENGTH} questions. Pass with ${PASS_PERCENT}%. A hint costs half a point.</p>
        </div>
        <div class="learn-stats">
          <div><strong>${passed}/${LESSONS.length}</strong><span>lessons passed</span></div>
          <div><strong>${accuracy == null ? '–' : accuracy + '%'}</strong><span>answers right</span></div>
          <div><strong>${progress.mistakes.length}</strong><span>to review</span></div>
        </div>
      </div>
      <div class="learn-grid">
        <ol class="lesson-list">${cards}</ol>
        <div class="learn-side">
          <section class="learn-box">
            <h3>Tests</h3>
            <div class="test-row"><span><strong>Mixed test</strong><small>20 questions from all lessons${progress.mixed ? ` · best ${progress.mixed.best}%` : ''}</small></span><button class="ghost strong" data-action="mixed">Start</button></div>
            <div class="test-row"><span><strong>Review my mistakes</strong><small>${progress.mistakes.length ? `${progress.mistakes.length} question${progress.mistakes.length === 1 ? '' : 's'} you got wrong; a right answer clears it` : 'Nothing to review yet'}</small></span><button class="ghost strong" data-action="review" ${progress.mistakes.length ? '' : 'disabled'}>Start</button></div>
          </section>
          <section class="learn-box">
            <h3>Realize in four parts</h3>
            <p class="hint">Opens the bass line in the Score with Practice mode on. Write soprano, alto and tenor, then press <em>Check my voices</em> to get a grade.</p>
            <ul class="exercise-list realize-list">${realize}</ul>
          </section>
          <p class="hint"><button class="linklike" data-action="reset">Reset my progress</button></p>
        </div>
      </div>`;
  }

  function lessonHTML(lesson) {
    const i = LESSONS.indexOf(lesson);
    const p = progress.lessons[lesson.id];
    const examples = lesson.examples.map((ex, k) => {
      const d = exampleData(ex, names());
      return `<figure class="example">
        <div class="mini-staff" data-example="${k}"></div>
        <figcaption>
          <strong>${esc(d.title)}</strong>
          <span class="example-result">${esc(d.result)}</span>
          <details><summary>How to read it</summary><ul>${d.explain.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></details>
          <span class="row tight">
            ${soundOn() ? `<button class="ghost" data-hear="${k}">▶ Hear</button>` : ''}
            <button class="ghost" data-decode="${k}">Open in decoder</button>
          </span>
        </figcaption>
      </figure>`;
    }).join('');
    return `
      <div class="learn-nav">
        <button class="ghost" data-action="home">← All lessons</button>
        <span class="hint">Lesson ${i + 1} of ${LESSONS.length}</span>
      </div>
      <h2>${esc(lesson.title)}</h2>
      <div class="lesson-body">
        <div class="lesson-intro">${lesson.intro.map((t) => `<p>${esc(t)}</p>`).join('')}
          <div class="quiz-start">
            <button class="primary" data-action="quiz">Start the quiz (${QUIZ_LENGTH} questions)</button>
            <span class="hint">${p ? `Best so far: ${p.best}% ${starsHTML(p.stars)} · ${p.attempts} attempt${p.attempts === 1 ? '' : 's'}` : `Pass with ${PASS_PERCENT}% or more.`}</span>
          </div>
        </div>
        <div class="lesson-examples"><h3>Examples</h3>${examples}</div>
      </div>`;
  }

  function quizHTML() {
    const { questions, index, answers, title } = view;
    const q = questions[index];
    const a = answers[index];
    const done = !!a;
    const right = answers.filter((x) => x?.correct).length;
    const options = q.options.map((o, k) => {
      let cls = '';
      if (done && k === q.answer) cls = ' right';
      else if (done && k === a.choice) cls = ' wrong';
      return `<button class="quiz-option${cls}" data-choice="${k}" ${done ? 'disabled' : ''}><kbd>${k + 1}</kbd><span>${esc(o)}</span></button>`;
    }).join('');
    const feedback = done ? `
      <div class="callout ${a.correct ? 'ok' : 'error'} quiz-feedback" role="status">
        <strong>${a.correct ? (a.hinted ? '✓ Right, with a hint (½ point).' : '✓ Right!') : `✗ Not quite. The answer is ${esc(q.options[q.answer])}.`}</strong>
        <ul>${q.explain.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      </div>` : '';
    const hint = view.hinted && !done ? `<div class="callout quiz-hint">💡 ${esc(q.hint)}</div>` : '';
    const showStaff = q.type !== 'rule';
    return `
      <div class="learn-nav">
        <button class="ghost" data-action="leave">← Stop</button>
        <span class="quiz-title">${esc(title)}</span>
        <span class="hint">${right} right so far</span>
      </div>
      <div class="quiz-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${questions.length}" aria-valuenow="${index + 1}">
        ${questions.map((_, k) => `<span class="${answers[k] ? (answers[k].correct ? 'ok' : 'bad') : k === index ? 'cur' : ''}"></span>`).join('')}
      </div>
      <div class="quiz-card">
        <div class="quiz-q">
          <span class="label">Question ${index + 1} of ${questions.length}</span>
          <p class="quiz-prompt">${esc(q.prompt)}</p>
          ${q.show.chord ? `<p class="quiz-chord">Chord: <strong>${esc(q.show.chord)}</strong></p>` : ''}
          ${showStaff ? '<div class="mini-staff quiz-staff" id="quiz-staff"></div>' : ''}
        </div>
        <div class="quiz-a">
          <div class="quiz-options">${options}</div>
          ${hint}
          ${feedback}
          <div class="row quiz-actions">
            ${done ? '' : `<button class="ghost" data-action="hint" ${view.hinted ? 'disabled' : ''}>💡 Hint</button>`}
            ${done && soundOn() && q.type !== 'interval' ? '<button class="ghost" data-action="hear">▶ Hear the chord</button>' : ''}
            ${done ? `<button class="primary quiz-next" data-action="next">${index + 1 < questions.length ? 'Next question' : 'See my score'} <kbd>Enter</kbd></button>` : ''}
          </div>
        </div>
      </div>`;
  }

  function resultHTML() {
    const { questions, answers, title, result, lessonId, previousBest } = view;
    const missed = questions.map((q, k) => ({ q, a: answers[k] })).filter((x) => !x.a.correct || x.a.hinted);
    const lesson = lessonId && lessonById(lessonId);
    const nextL = lesson ? LESSONS[LESSONS.indexOf(lesson) + 1] : null;
    const message = result.percent === 100 ? 'Perfect!' : result.passed ? 'Passed. Well done!' : `Not passed yet: you need ${PASS_PERCENT}%. Read the explanations below and try again.`;
    return `
      <div class="learn-nav"><button class="ghost" data-action="home">← All lessons</button><span class="quiz-title">${esc(title)}</span></div>
      <div class="result-card ${result.passed ? 'passed' : ''}">
        <div class="result-big">${result.percent}%</div>
        ${starsHTML(result.stars)}
        <p><strong>${esc(message)}</strong></p>
        <p class="hint">${result.score} of ${result.total} points${previousBest != null ? ` · best before: ${previousBest}%` : ''}</p>
        <div class="row result-actions">
          <button class="ghost strong" data-action="retry">Try again</button>
          ${lesson ? '<button class="ghost" data-action="lesson">Back to the lesson</button>' : ''}
          ${nextL && result.passed ? `<button class="primary" data-lesson="${nextL.id}">Next lesson: ${esc(nextL.title)}</button>` : ''}
        </div>
      </div>
      ${missed.length ? `<h3>To look at again</h3><ol class="missed-list">${missed.map(({ q, a }) => `
        <li><p>${esc(q.prompt)}${q.figures && q.show.figures ? ` <span class="fig-inline">${esc(figureStacks(q.figures).map((s) => s.join('/')).join(' – '))}</span>` : ''}</p>
          <p>${a.correct ? 'Right with a hint' : `You chose <s>${esc(q.options[a.choice])}</s>`}. Answer: <strong>${esc(q.options[q.answer])}</strong></p>
          <details><summary>Why</summary><ul>${q.explain.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></details></li>`).join('')}</ol>` : ''}`;
  }

  function render() {
    if (view.name === 'home') root.innerHTML = homeHTML();
    else if (view.name === 'lesson') {
      const lesson = lessonById(view.id);
      root.innerHTML = lessonHTML(lesson);
      lesson.examples.forEach((ex, k) => {
        const d = exampleData(ex, names());
        drawBass(root.querySelector(`[data-example="${k}"]`), d);
      });
    } else if (view.name === 'quiz') {
      root.innerHTML = quizHTML();
      const q = view.questions[view.index];
      const el = root.querySelector('#quiz-staff');
      if (el) drawBass(el, { ...q, showFigures: q.show.figures });
    } else if (view.name === 'result') root.innerHTML = resultHTML();
  }

  // ------------------------------------------------------------ actions

  function startQuiz({ lessons, title, lessonId = null, mixed = false, review = false, length }) {
    const questions = review
      ? [...progress.mistakes].sort(() => Math.random() - 0.5).slice(0, 10)
      : makeQuiz(lessons, { seed: Date.now(), sys: names(), length });
    if (!questions.length) return;
    view = { name: 'quiz', questions, index: 0, answers: [], title, lessonId, mixed, review, hinted: false };
    render();
    root.scrollTop = 0;
  }

  function answer(choice) {
    const q = view.questions[view.index];
    if (view.answers[view.index]) return;
    const correct = choice === q.answer;
    view.answers[view.index] = { choice, correct, hinted: view.hinted };
    progress.answered += 1;
    if (correct) progress.correct += 1;
    progress.mistakes = progress.mistakes.filter((m) => m.id !== q.id);
    if (!correct) progress.mistakes.unshift(q);
    progress.mistakes = progress.mistakes.slice(0, MAX_MISTAKES);
    store();
    render();
    root.querySelector('.quiz-next')?.focus({ preventScroll: true });
    root.querySelector('.quiz-feedback')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function next() {
    if (view.index + 1 < view.questions.length) {
      view.index += 1;
      view.hinted = false;
      render();
      return;
    }
    const result = grade(view.answers);
    let previousBest = null;
    if (view.lessonId) {
      const p = progress.lessons[view.lessonId] ?? { best: 0, stars: 0, attempts: 0 };
      previousBest = p.attempts ? p.best : null;
      progress.lessons[view.lessonId] = { best: Math.max(p.best, result.percent), stars: Math.max(p.stars, result.stars), attempts: p.attempts + 1, last: result.percent, date: Date.now() };
    } else if (view.mixed) {
      previousBest = progress.mixed?.best ?? null;
      progress.mixed = { best: Math.max(previousBest ?? 0, result.percent), last: result.percent };
    }
    store();
    view = { ...view, name: 'result', result, previousBest };
    render();
    root.scrollTop = 0;
  }

  function retry() {
    if (view.review) startQuiz({ review: true, title: 'Review my mistakes' });
    else if (view.mixed) startQuiz({ lessons: LESSONS, title: 'Mixed test', mixed: true, length: 20 });
    else startQuiz({ lessons: lessonById(view.lessonId), title: lessonById(view.lessonId).title, lessonId: view.lessonId });
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const act = b.dataset.action;
    if (b.dataset.lesson) { view = { name: 'lesson', id: b.dataset.lesson }; render(); root.scrollTop = 0; }
    else if (b.dataset.choice) answer(Number(b.dataset.choice));
    else if (b.dataset.realize) startRealization(REALIZATIONS.find((r) => r.id === b.dataset.realize));
    else if (b.dataset.hear) hear(exampleData(lessonById(view.id).examples[Number(b.dataset.hear)]));
    else if (b.dataset.decode) {
      const d = exampleData(lessonById(view.id).examples[Number(b.dataset.decode)]);
      openInDecoder(d);
    } else if (act === 'home') { view = { name: 'home' }; render(); }
    else if (act === 'leave') {
      if (view.answers.length && !confirm('Stop this quiz? Your answers so far are not graded.')) return;
      view = view.lessonId ? { name: 'lesson', id: view.lessonId } : { name: 'home' };
      render();
    } else if (act === 'lesson') { view = { name: 'lesson', id: view.lessonId }; render(); }
    else if (act === 'quiz') { const l = lessonById(view.id); startQuiz({ lessons: l, title: l.title, lessonId: l.id }); }
    else if (act === 'mixed') startQuiz({ lessons: LESSONS, title: 'Mixed test', mixed: true, length: 20 });
    else if (act === 'review') startQuiz({ review: true, title: 'Review my mistakes' });
    else if (act === 'hint') { view.hinted = true; render(); }
    else if (act === 'hear') hear(view.questions[view.index]);
    else if (act === 'next') next();
    else if (act === 'retry') retry();
    else if (act === 'reset') {
      if (!confirm('Reset all lesson scores, quiz statistics and saved mistakes?')) return;
      progress = { lessons: {}, realize: {}, mistakes: [], answered: 0, correct: 0, mixed: null };
      store();
      render();
    }
  });

  return {
    render,
    /** Keyboard shortcuts while the Learn tab is open: 1-4 answer, H hint, Enter next. */
    onKey(e) {
      if (view.name !== 'quiz' || e.target.closest('input, select, textarea')) return false;
      const done = !!view.answers[view.index];
      if (!done && /^[1-4]$/.test(e.key) && Number(e.key) <= view.questions[view.index].options.length) { answer(Number(e.key) - 1); return true; }
      if (!done && e.key.toLowerCase() === 'h') { view.hinted = true; render(); return true; }
      if (done && e.key === 'Enter' && !e.target.closest('button')) { next(); return true; }
      return false;
    },
    /** Record the grade of a four-part realization from Practice mode. */
    recordRealization(id, percent) {
      const p = progress.realize[id] ?? { best: 0 };
      if (percent > p.best || !progress.realize[id]) progress.realize[id] = { best: percent, date: Date.now() };
      store();
    },
  };
}

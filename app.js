/* =========================================================
   Fredagsquiz · Svarsformulär (fristående)
   Svara och rätta själv – ingen server, ingen spelkod.
   Live-versionen med värd och spelkod ligger i live/.
   ========================================================= */

'use strict';

const ANSWER_DESIGNS = ['letters', 'numbers', 'text'];
const MIN_ANSWER_COUNT = 1;
const MAX_ANSWER_COUNT = 10;
const MIN_COUNT = 1;
const MAX_COUNT = 100;
const STORAGE_KEY = 'quiz.formular.v1';

const $ = (sel) => document.querySelector(sel);

const els = {
  views: {
    setup: $('#view-setup'),
    sheet: $('#view-sheet'),
    summary: $('#view-summary'),
  },
  setupForm: $('#setup-form'),
  name: $('#name'),
  answerCountField: $('#answer-count-field'),
  answerCount: $('#answer-count'),
  answerDesign: $('#answer-design'),
  eliminationQuestion: $('#elimination-question'),
  count: $('#count'),
  chips: [...document.querySelectorAll('.chip')],
  countMinus: $('#count-minus'),
  countPlus: $('#count-plus'),
  whoAvatar: $('#who-avatar'),
  whoName: $('#who-name'),
  answerHint: $('#answer-hint'),
  progress: $('#progress'),
  progressBar: $('#progress-bar'),
  answeredCount: $('#answered-count'),
  totalCount: $('#total-count'),
  sheetCount: $('#sheet-count'),
  sheetMinus: $('#sheet-minus'),
  sheetPlus: $('#sheet-plus'),
  unansweredAlert: $('#unanswered-alert'),
  unansweredText: $('#unanswered-text'),
  jumpFirst: $('#jump-first'),
  sendAnyway: $('#send-anyway'),
  questions: $('#questions'),
  backToSetup: $('#back-to-setup'),
  submitAnswers: $('#submit-answers'),
  answerGrid: $('#answergrid'),
  eliminationSummary: $('#elimination-summary'),
  score: $('#score'),
  scoreMax: $('#score-max'),
  editAnswers: $('#edit-answers'),
  restart: $('#restart'),
  toast: $('#toast'),
  confetti: $('#confetti'),
};

const state = {
  name: '',
  answerCount: 4,
  answerDesign: 'letters',
  eliminationQuestion: true,
  eliminationAnswer: '',
  count: 10,
  answers: {},        // { 0: 'A', 1: 'C', ... }
  correctAnswers: {}, // { 0: true, ... } markerade rätt
  wrongAnswers: {},   // { 0: true, ... } markerade fel
  current: 0,         // aktiv fråga för tangentbordsstyrning
  view: 'setup',      // setup | sheet | summary
};

/* ---------- Lagring ---------- */

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return;
    state.name = String(data.name ?? '');
    state.answerCount = clampAnswerCount(Number(data.answerCount) || 4);
    state.answerDesign = ANSWER_DESIGNS.includes(data.answerDesign) ? data.answerDesign : 'letters';
    state.eliminationQuestion = typeof data.eliminationQuestion === 'boolean' ? data.eliminationQuestion : true;
    state.eliminationAnswer = typeof data.eliminationAnswer === 'string' ? data.eliminationAnswer.slice(0, 200) : '';
    state.count = clampCount(Number(data.count) || MIN_COUNT);
    state.answers = sanitizeAnswers(data.answers);
    state.correctAnswers = sanitizeMarks(data.correctAnswers);
    state.wrongAnswers = sanitizeMarks(data.wrongAnswers);
    state.current = clampIndex(data.current, state.count);
    state.view = ['setup', 'sheet', 'summary'].includes(data.view) ? data.view : 'setup';
  } catch {
    /* korrupt sparad data – börja om */
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* privat läge / fullt lagring – ignoreras tyst */
  }
}

function sanitizeAnswers(raw) {
  const out = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [key, value] of Object.entries(raw)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_COUNT) continue;
    if (isFreeText() && typeof value === 'string' && value.trim()) {
      out[idx] = value.trim().slice(0, 200);
    } else if (!isFreeText() && answerOptions().includes(value)) {
      out[idx] = value;
    }
  }
  return out;
}

function sanitizeMarks(raw) {
  const out = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [key, value] of Object.entries(raw)) {
    const idx = Number(key);
    if (Number.isInteger(idx) && idx >= 0 && idx < MAX_COUNT && value === true) out[idx] = true;
  }
  return out;
}

function clampCount(n) {
  return Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(n) || MIN_COUNT));
}

function clampAnswerCount(n) {
  return Math.min(MAX_ANSWER_COUNT, Math.max(MIN_ANSWER_COUNT, Math.round(n) || MIN_ANSWER_COUNT));
}

function clampIndex(i, count) {
  return Math.min(count - 1, Math.max(0, Number.isInteger(i) ? i : 0));
}

/* ---------- Hjälpare ---------- */

const countFromUrl = () => {
  const params = new URLSearchParams(location.search);
  const n = Number(params.get('frgor') ?? params.get('questions'));
  return Number.isFinite(n) && n > 0 ? clampCount(n) : null;
};

const answeredCount = () => Object.keys(state.answers).length;
const correctCount = () => Object.keys(state.correctAnswers).filter((key) => Number(key) < state.count).length;

const unanswered = () => {
  const list = [];
  for (let i = 0; i < state.count; i++) {
    if (!state.answers[i]) list.push(i);
  }
  return list;
};

const displayName = () => state.name.trim() || 'Deltagare';
const isFreeText = () => state.answerDesign === 'text';
const answerOptions = () => {
  if (state.answerDesign === 'numbers') {
    return Array.from({ length: state.answerCount }, (_, index) => String(index + 1));
  }
  return Array.from({ length: state.answerCount }, (_, index) => String.fromCharCode(65 + index));
};
const keyMap = () => Object.fromEntries(answerOptions().map((option) => [option.toLowerCase(), option]));

let toastTimer;
function toast(message) {
  const el = els.toast;
  el.textContent = message;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('is-visible'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('is-visible');
    setTimeout(() => { el.hidden = true; }, 250);
  }, 2400);
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function scrollToQuestion(index) {
  document.getElementById(`q-${index}`)?.scrollIntoView({
    behavior: reducedMotion() ? 'auto' : 'smooth',
    block: 'center',
  });
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
}

function goToQuestion(index) {
  state.current = clampIndex(index, state.count);
  paintCurrent();
  scrollToQuestion(state.current);
  save();
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

/* ---------- Vybyte ---------- */

function render() {
  const { setup, sheet, summary } = els.views;
  setup.hidden = state.view !== 'setup';
  sheet.hidden = state.view !== 'sheet';
  summary.hidden = state.view !== 'summary';

  if (state.view === 'setup') {
    els.name.value = state.name;
    els.answerCountField.hidden = isFreeText();
    els.answerCount.value = String(state.answerCount);
    els.answerDesign.value = state.answerDesign;
    els.eliminationQuestion.checked = state.eliminationQuestion;
    els.count.value = String(state.count);
    syncChips();
    document.title = 'Fredagsquiz · Svarsformulär';
  }
  if (state.view === 'sheet') renderSheet();
  if (state.view === 'summary') renderSummary();

  save();
}

/* ---------- Setup-vy ---------- */

function syncChips() {
  for (const chip of els.chips) {
    chip.setAttribute('aria-pressed', String(Number(chip.dataset.count) === state.count));
  }
}

function setCount(next) {
  state.count = clampCount(next);
  els.count.value = String(state.count);
  syncChips();
  save();
}

function changeCount(delta) {
  setCount(state.count + delta);
  toast(state.count === MAX_COUNT ? `Max ${MAX_COUNT} frågor` : `${state.count} frågor`);
}

function readCountInput() {
  const digits = els.count.value.replace(/\D/g, '');
  setCount(digits === '' ? MIN_COUNT : Number(digits));
}

els.setupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  state.name = els.name.value.trim();
  if (!state.name) {
    els.name.setCustomValidity('Namn krävs');
    els.name.reportValidity();
    els.name.setCustomValidity('');
    els.name.focus();
    return;
  }
  readCountInput();
  state.view = 'sheet';
  render();
  scrollToTop();
});

function resetAnswersForOptionChange() {
  state.answers = {};
  state.correctAnswers = {};
  state.wrongAnswers = {};
  save();
}

els.answerCount.addEventListener('change', () => {
  state.answerCount = clampAnswerCount(Number(els.answerCount.value));
  els.answerCount.value = String(state.answerCount);
  resetAnswersForOptionChange();
});

els.answerDesign.addEventListener('change', () => {
  state.answerDesign = ANSWER_DESIGNS.includes(els.answerDesign.value) ? els.answerDesign.value : 'letters';
  resetAnswersForOptionChange();
  els.answerCountField.hidden = isFreeText();
});

els.eliminationQuestion.addEventListener('change', () => {
  state.eliminationQuestion = els.eliminationQuestion.checked;
  save();
});

els.count.addEventListener('input', readCountInput);
els.count.addEventListener('blur', () => { els.count.value = String(state.count); });
els.count.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); els.setupForm.requestSubmit(); }
});

els.countMinus.addEventListener('click', () => changeCount(-1));
els.countPlus.addEventListener('click', () => changeCount(1));

for (const chip of els.chips) {
  chip.addEventListener('click', () => setCount(Number(chip.dataset.count)));
}

/* ---------- Svarsformulär ---------- */

function renderSheet() {
  const total = state.count;
  state.current = clampIndex(state.current, total);
  state.answers = sanitizeAnswers(state.answers);

  els.whoName.textContent = displayName();
  els.whoAvatar.textContent = displayName().charAt(0);
  els.answerHint.hidden = isFreeText();
  if (!isFreeText()) {
    els.answerHint.innerHTML = `${answerOptions().map((option) => `<kbd>${option}</kbd>`).join('')}<span class="hintbar__sep" aria-hidden="true">&middot;</span><span>kryssa i med tangentbordet &ndash; <kbd>&uarr;</kbd><kbd>&darr;</kbd> byter fr&aring;ga</span>`;
  }

  els.totalCount.textContent = String(total);
  els.sheetCount.textContent = String(total);
  els.sheetPlus.disabled = total >= MAX_COUNT;
  els.sheetMinus.disabled = total <= MIN_COUNT;

  const html = [];
  for (let i = 0; i < total; i++) {
    const n = i + 1;
    const checked = state.answers[i] ?? '';
    const options = answerOptions().map((letter) => `
        <label class="opt">
          <input type="radio" name="q-${i}" value="${letter}" ${checked === letter ? 'checked' : ''}>
          <span class="opt__badge" aria-hidden="true">${letter}<span class="opt__check">&#10003;</span></span>
          <span class="sr-only">Svar ${letter} p&aring; fr&aring;ga ${n}</span>
        </label>`).join('');
    const answerField = isFreeText()
      ? `<input class="free-answer" type="text" name="q-${i}" value="${escapeHtml(checked)}"
           maxlength="200" placeholder="Skriv ditt svar" aria-label="Svar p&aring; fr&aring;ga ${n}">`
      : `<div class="q__opts" role="radiogroup" aria-label="Fr&aring;ga ${n}">${options}</div>`;

    html.push(`
      <li class="q" id="q-${i}" data-index="${i}">
        <div class="q__head">
          <span class="q__num">${n}</span>
        </div>
        ${answerField}
      </li>`);
  }

  if (state.eliminationQuestion) {
    html.push(`
      <li class="q q--elimination">
        <div class="q__head">
          <span class="q__num">*</span>
          <span class="q__title">Utslagsfråga</span>
        </div>
        <input class="elimination-answer" type="text" value="${escapeHtml(state.eliminationAnswer)}"
               maxlength="200" placeholder="Skriv ditt utslagssvar" aria-label="Svar på utslagsfråga">
      </li>`);
  }

  els.questions.innerHTML = html.join('');
  updateProgress();
  paintCurrent();
}

function updateProgress() {
  const done = answeredCount();
  const pct = state.count ? Math.round((done / state.count) * 100) : 0;
  els.progressBar.style.width = `${pct}%`;
  els.progress.setAttribute('aria-valuenow', String(pct));
  els.answeredCount.textContent = String(done);
  els.progress.setAttribute('aria-label', `${done} av ${state.count} besvarade`);
  document.title = `${done}/${state.count} besvarade · Fredagsquiz`;
}

function paintCurrent() {
  for (const card of els.questions.querySelectorAll('.q')) {
    const idx = Number(card.dataset.index);
    card.classList.toggle('is-current', idx === state.current);
    card.classList.toggle('is-done', Boolean(state.answers[idx]));
  }
}

function setAnswer(idx, value) {
  if (value) state.answers[idx] = value;
  else delete state.answers[idx];
  delete state.correctAnswers[idx];
  delete state.wrongAnswers[idx];
  state.current = idx;
  paintCurrent();
  updateProgress();
  save();
}

/* Val av svar (klick + tangentbord via delegering) */
els.questions.addEventListener('change', (e) => {
  const input = e.target.closest('.opt input');
  const card = input?.closest('.q');
  if (card) setAnswer(Number(card.dataset.index), input.value);
});

els.questions.addEventListener('input', (e) => {
  const eliminationInput = e.target.closest('.elimination-answer');
  if (eliminationInput) {
    state.eliminationAnswer = eliminationInput.value.trim().slice(0, 200);
    save();
    return;
  }
  const input = e.target.closest('.free-answer');
  const card = input?.closest('.q');
  if (card) setAnswer(Number(card.dataset.index), input.value.trim().slice(0, 200));
});

els.questions.addEventListener('pointerdown', (e) => {
  const card = e.target.closest('.q');
  if (!card) return;
  const idx = Number(card.dataset.index);
  if (idx !== state.current) {
    state.current = idx;
    paintCurrent();
    save();
  }
});

/* Tangentbord: svarstangenter väljer svar, upp/ner byter fråga */
document.addEventListener('keydown', (e) => {
  if (state.view !== 'sheet') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const tag = e.target.tagName;
  if (tag === 'INPUT' && e.target.type !== 'radio') return;
  if (tag === 'TEXTAREA') return;

  const letter = keyMap()[e.key.toLowerCase()];
  if (letter) {
    const input = els.questions.querySelector(`.q[data-index="${state.current}"] input[value="${letter}"]`);
    if (!input) return;
    e.preventDefault();
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  const moves = { ArrowDown: 1, ArrowRight: 1, j: 1, ArrowUp: -1, ArrowLeft: -1, k: -1 };
  if (e.key in moves) {
    e.preventDefault();
    goToQuestion(state.current + moves[e.key]);
  } else if (e.key === 'Home') {
    e.preventDefault();
    goToQuestion(0);
  } else if (e.key === 'End') {
    e.preventDefault();
    goToQuestion(state.count - 1);
  }
});

/* Antal frågor direkt i formuläret */
els.sheetMinus.addEventListener('click', () => {
  if (state.count <= MIN_COUNT) return;
  state.count -= 1;
  delete state.answers[state.count];
  renderSheet();
  save();
});

els.sheetPlus.addEventListener('click', () => {
  if (state.count >= MAX_COUNT) return;
  state.count += 1;
  renderSheet();
  goToQuestion(state.count - 1);
});

els.backToSetup.addEventListener('click', () => {
  state.view = 'setup';
  render();
  scrollToTop();
});

els.submitAnswers.addEventListener('click', () => {
  const missing = unanswered();
  if (missing.length > 0) {
    const preview = missing.slice(0, 8).map((i) => i + 1).join(', ');
    const rest = missing.length > 8 ? ` … (${missing.length} totalt)` : '';
    els.unansweredText.textContent = `${missing.length} frågor är obesvarade: ${preview}${rest}`;
    els.unansweredAlert.hidden = false;
    els.jumpFirst.focus();
    return;
  }
  finish();
});

els.jumpFirst.addEventListener('click', () => {
  els.unansweredAlert.hidden = true;
  goToQuestion(unanswered()[0]);
});

els.sendAnyway.addEventListener('click', () => {
  els.unansweredAlert.hidden = true;
  finish();
});

function finish() {
  state.view = 'summary';
  render();
  scrollToTop();
  celebrate();
}

/* ---------- Sammanfattning / rättning ---------- */

function renderSummary() {
  els.answerGrid.classList.toggle('answergrid--text', isFreeText());

  els.answerGrid.innerHTML = Array.from({ length: state.count }, (_, i) => {
    const letter = state.answers[i];
    const markedCorrect = Boolean(state.correctAnswers[i]);
    const markedWrong = Boolean(state.wrongAnswers[i]);
    const classes = [
      letter ? '' : 'ag--empty',
      markedCorrect ? 'ag--correct' : '',
      markedWrong ? 'ag--wrong' : '',
    ].filter(Boolean).join(' ');
    const what = `Fr&aring;ga ${i + 1}, svar ${escapeHtml(letter ?? 'tomt')}`;

    return `
      <li class="${classes}" data-index="${i}">
        <span class="ag__num">${i + 1}.</span>
        <span class="ag__letter${isFreeText() ? ' ag__text' : ''}">${escapeHtml(letter ?? '–')}</span>
        <span class="ag__marks">
          <button type="button" class="ag__btn ag__btn--correct" data-mark-index="${i}" data-mark="correct"
                  aria-pressed="${markedCorrect}"
                  aria-label="${what} &ndash; markera som r&auml;tt" title="Markera som r&auml;tt">&#10003;</button>
          <button type="button" class="ag__btn ag__btn--wrong" data-mark-index="${i}" data-mark="wrong"
                  aria-pressed="${markedWrong}"
                  aria-label="${what} &ndash; markera som fel" title="Markera som fel">&#10007;</button>
        </span>
      </li>`;
  }).join('');

  els.eliminationSummary.hidden = !state.eliminationQuestion;
  els.eliminationSummary.innerHTML = state.eliminationQuestion
    ? `<li><span class="ag__num">Utslagsfråga.</span><span class="ag__letter ag__text">${escapeHtml(state.eliminationAnswer || '–')}</span></li>`
    : '';

  document.title = 'Rättning · Fredagsquiz';
  els.scoreMax.textContent = String(state.count);
  els.score.value = String(correctCount());
}

els.answerGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-mark-index]');
  if (!btn) return;
  const idx = Number(btn.dataset.markIndex);
  const wasCorrect = Boolean(state.correctAnswers[idx]);
  const wasWrong = Boolean(state.wrongAnswers[idx]);

  delete state.correctAnswers[idx];
  delete state.wrongAnswers[idx];
  /* Tryck på knappen sätter läget – tryck igen för att avmarkera */
  if (btn.dataset.mark === 'correct' && !wasCorrect) state.correctAnswers[idx] = true;
  if (btn.dataset.mark === 'wrong' && !wasWrong) state.wrongAnswers[idx] = true;

  paintMark(idx);
  els.score.value = String(correctCount());
  save();
});

/* Uppdaterar en enda ruta utan att rita om hela rutnätet (behåller fokus) */
function paintMark(idx) {
  const tile = els.answerGrid.querySelector(`li[data-index="${idx}"]`);
  if (!tile) return;
  const correct = Boolean(state.correctAnswers[idx]);
  const wrong = Boolean(state.wrongAnswers[idx]);
  tile.classList.toggle('ag--correct', correct);
  tile.classList.toggle('ag--wrong', wrong);
  tile.querySelector('.ag__btn--correct').setAttribute('aria-pressed', String(correct));
  tile.querySelector('.ag__btn--wrong').setAttribute('aria-pressed', String(wrong));
}

els.editAnswers.addEventListener('click', () => {
  state.view = 'sheet';
  render();
  scrollToTop();
});

els.restart.addEventListener('click', () => {
  if (!confirm('Rensa alla svar och börja om?')) return;
  /* Namn och inställningar behålls – oftast samma upplägg nästa fredag */
  state.answers = {};
  state.correctAnswers = {};
  state.wrongAnswers = {};
  state.eliminationAnswer = '';
  state.current = 0;
  state.view = 'setup';
  render();
  scrollToTop();
});

/* ---------- Confetti ---------- */

function celebrate() {
  if (reducedMotion()) return;

  const canvas = els.confetti;
  const ctx = canvas.getContext('2d');
  const colors = ['#ffa600', '#ffc15a', '#e07b00', '#ff8a00', '#f9f7f4'];
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const resize = () => {
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();

  const parts = Array.from({ length: 110 }, () => ({
    x: window.innerWidth / 2 + (Math.random() - 0.5) * window.innerWidth * 0.7,
    y: -20 - Math.random() * 200,
    w: 6 + Math.random() * 7,
    h: 9 + Math.random() * 10,
    vy: 2.4 + Math.random() * 3.4,
    vx: (Math.random() - 0.5) * 2.6,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.22,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));

  const started = performance.now();

  function frame(now) {
    const elapsed = now - started;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const p of parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.vy += 0.028;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = elapsed > 2200 ? Math.max(0, 1 - (elapsed - 2200) / 900) : 1;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (elapsed < 3200) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }
  requestAnimationFrame(frame);

  window.addEventListener('resize', resize, { once: true });
}

/* ---------- Start ---------- */

load();

const preset = countFromUrl();
if (preset !== null) state.count = preset;
state.current = clampIndex(state.current, state.count);

render();

if (state.view === 'sheet') goToQuestion(unanswered()[0] ?? state.current);

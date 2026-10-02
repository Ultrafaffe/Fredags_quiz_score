/* =========================================================
   Fredagsquiz · Svarsformulär
  Enbart svarsval
   ========================================================= */

'use strict';

const ANSWER_DESIGNS = ['letters', 'numbers', 'text'];
const MIN_ANSWER_COUNT = 1;
const MAX_ANSWER_COUNT = 10;
const MIN_COUNT = 1;
const MAX_COUNT = 100;
const STORAGE_KEY = 'fredagsquiz.svarsformular.v1';

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
  count: $('#count'),
  countHint: $('#count-hint'),
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
  summaryMeta: $('#summary-meta'),
  answerGrid: $('#answergrid'),
  summaryNote: $('#summary-note'),
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
  count: 10,
  answers: {},      // { 0: 'A', 1: 'C', ... }
  correctAnswers: {},
  score: null,      // antal rätta svar, matas in manuellt
  current: 0,       // aktiv fråga för tangentbordsstyrning
  view: 'setup',    // setup | sheet | summary
};

/* ---------- Lagring ---------- */

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return;
    state.name = String(data.name ?? '');
    const legacyDesigns = {
      letters4: { answerCount: 4, answerDesign: 'letters' },
      numbers4: { answerCount: 4, answerDesign: 'numbers' },
      letters3: { answerCount: 3, answerDesign: 'letters' },
    };
    const savedDesign = legacyDesigns[data.answerDesign];
    state.answerCount = savedDesign?.answerCount ?? clampAnswerCount(Number(data.answerCount) || 4);
    state.answerDesign = savedDesign?.answerDesign ?? (ANSWER_DESIGNS.includes(data.answerDesign) ? data.answerDesign : 'letters');
    state.count = clampCount(Number(data.count) || MIN_COUNT);
    state.answers = sanitizeAnswers(data.answers);
    state.correctAnswers = sanitizeCorrectAnswers(data.correctAnswers);
    state.score = Number.isFinite(data.score) && data.score >= 0
      ? Math.min(MAX_COUNT, Math.round(data.score))
      : null;
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

function sanitizeCorrectAnswers(raw) {
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
  const raw = new URLSearchParams(location.search).get('frgor') ?? new URLSearchParams(location.search).get('questions');
  const n = Number(raw);
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

function scrollToQuestion(index) {
  const node = document.getElementById(`q-${index}`);
  if (!node) return;
  node.scrollIntoView({
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'center',
  });
}

function goToQuestion(index) {
  state.current = clampIndex(index, state.count);
  paintCurrent();
  scrollToQuestion(state.current);
  save();
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
  const next = clampCount(state.count + delta);
  if (next === state.count && els.count.value !== String(state.count)) {
    els.count.value = String(state.count);
  }
  setCount(next);
  if (state.view === 'sheet') renderSheet();
  toast(state.count === MAX_COUNT ? `Max ${MAX_COUNT} frågor` : `${state.count} frågor`);
}

function readCountInput() {
  const digits = els.count.value.replace(/\D/g, '');
  setCount(digits === '' ? MIN_COUNT : clampCount(Number(digits)));
}

els.setupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  state.name = els.name.value.trim();
  readCountInput();
  state.answers = {};
  state.current = 0;
  state.view = 'sheet';
  render();
  scrollToTop();
});

function resetAnswersForOptionChange() {
  state.answers = {};
  state.correctAnswers = {};
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
  state.correctAnswers = sanitizeCorrectAnswers(state.correctAnswers);

  els.whoName.textContent = displayName();
  els.whoAvatar.textContent = displayName().charAt(0);
  els.answerHint.innerHTML = isFreeText()
    ? '<span>Skriv ett svar till varje fr&aring;ga</span>'
    : `${answerOptions().map((option) => `<kbd>${option}</kbd>`).join('')}<span class="hintbar__sep" aria-hidden="true">&middot;</span><span>kryssa i med tangentbordet &ndash; <kbd>&uarr;</kbd><kbd>&darr;</kbd> byter fr&aring;ga</span>`;

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

  els.questions.innerHTML = html.join('');
  updateProgress();
  paintCurrent();
  document.title = `${answeredCount()}/${total} besvarade · Fredagsquiz`;
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

/* Val av svar (klick + tangentbord via delegering) */
els.questions.addEventListener('change', (e) => {
  const input = e.target.closest('.opt input');
  if (!input) return;
  const card = input.closest('.q');
  if (!card) return;
  const idx = Number(card.dataset.index);
  state.answers[idx] = input.value;
  delete state.correctAnswers[idx];
  state.score = correctCount();
  state.current = idx;
  paintCurrent();
  updateProgress();
  save();
});

els.questions.addEventListener('input', (e) => {
  const input = e.target.closest('.free-answer');
  if (!input) return;
  const card = input.closest('.q');
  if (!card) return;
  const idx = Number(card.dataset.index);
  const value = input.value.trim();
  if (value) state.answers[idx] = value.slice(0, 200);
  else delete state.answers[idx];
  delete state.correctAnswers[idx];
  state.score = correctCount();
  state.current = idx;
  paintCurrent();
  updateProgress();
  save();
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

/* Tangentbord: A–D / 1–4 väljer svar, upp/ner byter fråga */
document.addEventListener('keydown', (e) => {
  if (state.view !== 'sheet') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const tag = e.target.tagName;
  if (tag === 'INPUT' && e.target.type !== 'radio') return;
  if (tag === 'TEXTAREA') return;

  const letter = keyMap()[e.key.toLowerCase()];
  if (letter) {
    const input = els.questions.querySelector(
      `.q[data-index="${state.current}"] input[value="${letter}"]`
    );
    if (!input) return;
    e.preventDefault();
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'j') {
    e.preventDefault();
    goToQuestion(state.current + 1);
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'k') {
    e.preventDefault();
    goToQuestion(state.current - 1);
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
  const removed = state.count - 1;
  state.count = clampCount(removed);
  delete state.answers[removed];
  state.current = clampIndex(state.current, state.count);
  renderSheet();
});

els.sheetPlus.addEventListener('click', () => {
  if (state.count >= MAX_COUNT) return;
  state.count = clampCount(state.count + 1);
  renderSheet();
  goToQuestion(state.count - 1);
});

els.backToSetup.addEventListener('click', () => {
  state.view = 'setup';
  render();
  scrollToTop();
});

/* Skicka in */
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

/* ---------- Sammanfattning ---------- */

function renderSummary() {
  const done = answeredCount();
  const items = [
    ['Deltagare', displayName()],
    ['Antal frågor', String(state.count)],
    ['Besvarade', `${done} av ${state.count}`],
  ];

  els.summaryMeta.innerHTML = items.map(([key, val]) => `
    <div class="meta__item">
      <dt class="meta__key">${key}</dt>
      <dd class="meta__val">${escapeHtml(val)}</dd>
    </div>`).join('');

  els.answerGrid.innerHTML = Array.from({ length: state.count }, (_, i) => {
    const letter = state.answers[i];
    const empty = !letter;
    return `
      <li class="${empty ? 'ag--empty' : ''}${state.correctAnswers[i] ? ' ag--correct' : ''}"
          ${empty ? '' : `data-correct-index="${i}" role="button" tabindex="0" aria-pressed="${Boolean(state.correctAnswers[i])}"`}>
        <span class="ag__num">${i + 1}.</span>
        <span class="ag__letter">${letter ?? '–'}</span>
      </li>`;
  }).join('');

  const missing = state.count - done;
  els.summaryNote.textContent = missing > 0
    ? `${missing} frågor lämnades tomma.`
    : '';

  document.title = 'Svar inskickade · Fredagsquiz';

  /* Antal rätt räknas från markerade frågor */
  els.scoreMax.textContent = String(state.count);
  state.score = correctCount();
  els.score.value = String(state.score);
}

els.answerGrid.addEventListener('click', (e) => {
  const answer = e.target.closest('[data-correct-index]');
  if (!answer) return;
  const idx = Number(answer.dataset.correctIndex);
  if (state.correctAnswers[idx]) delete state.correctAnswers[idx];
  else state.correctAnswers[idx] = true;
  state.score = correctCount();
  renderSummary();
  save();
});

els.answerGrid.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const answer = e.target.closest('[data-correct-index]');
  if (!answer) return;
  e.preventDefault();
  answer.click();
});

els.editAnswers.addEventListener('click', () => {
  state.view = 'sheet';
  render();
  scrollToTop();
});

els.restart.addEventListener('click', () => {
  if (!confirm('Avsluta pågående svar och starta om formuläret?')) return;
  state.name = '';
  state.answerCount = 4;
  state.answerDesign = 'letters';
  state.answers = {};
  state.correctAnswers = {};
  state.score = null;
  state.current = 0;
  state.count = 10;
  state.view = 'setup';
  render();
  scrollToTop();
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

/* ---------- Confetti ---------- */

function celebrate() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

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

/* =========================================================
   Quiz · Svarsformulär
  Enbart svarsval
   ========================================================= */

'use strict';

const ANSWER_DESIGNS = ['letters', 'numbers', 'text'];
const MIN_ANSWER_COUNT = 1;
const MAX_ANSWER_COUNT = 10;
const MIN_COUNT = 1;
const MAX_COUNT = 100;
const STORAGE_KEY = 'quiz.svarsformular.v1';
const API_BASE_URL = 'https://cmsp9si3j7.execute-api.eu-north-1.amazonaws.com';
const PLAYER_ID_KEY = 'quiz.player-id.v1';

const $ = (sel) => document.querySelector(sel);

const els = {
  views: {
    setup: $('#view-setup'),
    host: $('#view-host'),
    sheet: $('#view-sheet'),
    summary: $('#view-summary'),
  },
  setupForm: $('#setup-form'),
  name: $('#name'),
  gameCode: $('#game-code'),
  gameCodeLabel: $('#game-code-label'),
  gameCodeRow: $('#game-code-row'),
  gameCodeStatus: $('#game-code-status'),
  createGame: $('#create-game'),
  joinGame: $('#join-game'),
  gameSettings: $('#game-settings'),
  startActions: $('#start-actions'),
  cancelCreate: $('#cancel-create'),
  hostGameCode: $('#host-game-code'),
  copyGameCode: $('#copy-game-code'),
  endGame: $('#end-game'),
  hostNewGame: $('#host-new-game'),
  hostStatus: $('#host-status'),
  hostResult: $('#host-result'),
  answerCountField: $('#answer-count-field'),
  answerCount: $('#answer-count'),
  answerDesign: $('#answer-design'),
  eliminationQuestion: $('#elimination-question'),
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
  eliminationSummary: $('#elimination-summary'),
  summaryNote: $('#summary-note'),
  score: $('#score'),
  scoreMax: $('#score-max'),
  editAnswers: $('#edit-answers'),
  submitScore: $('#submit-score'),
  scoreStatus: $('#score-status'),
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
  answers: {},      // { 0: 'A', 1: 'C', ... }
  correctAnswers: {},
  score: null,      // antal rätta svar, matas in manuellt
  gameId: '',
  gameCode: '',
  playerId: '',
  scoreSubmitted: false,
  setupMode: 'initial',   // initial | create | join
  current: 0,       // aktiv fråga för tangentbordsstyrning
  view: 'setup',    // setup | host | sheet | summary
};

/* ---------- Lagring ---------- */

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return;
    state.name = String(data.name ?? '');
    state.gameId = String(data.gameId ?? '');
    state.gameCode = String(data.gameCode ?? '');
    state.playerId = String(data.playerId ?? '');
    state.scoreSubmitted = data.scoreSubmitted === true;
    state.setupMode = ['initial', 'create', 'join'].includes(data.setupMode) ? data.setupMode : 'initial';
    const legacyDesigns = {
      letters4: { answerCount: 4, answerDesign: 'letters' },
      numbers4: { answerCount: 4, answerDesign: 'numbers' },
      letters3: { answerCount: 3, answerDesign: 'letters' },
    };
    const savedDesign = legacyDesigns[data.answerDesign];
    state.answerCount = savedDesign?.answerCount ?? clampAnswerCount(Number(data.answerCount) || 4);
    state.answerDesign = savedDesign?.answerDesign ?? (ANSWER_DESIGNS.includes(data.answerDesign) ? data.answerDesign : 'letters');
    state.eliminationQuestion = typeof data.eliminationQuestion === 'boolean'
      ? data.eliminationQuestion
      : true;
    state.eliminationAnswer = typeof data.eliminationAnswer === 'string'
      ? data.eliminationAnswer.slice(0, 200)
      : '';
    state.count = clampCount(Number(data.count) || MIN_COUNT);
    state.answers = sanitizeAnswers(data.answers);
    state.correctAnswers = sanitizeCorrectAnswers(data.correctAnswers);
    state.score = Number.isFinite(data.score) && data.score >= 0
      ? Math.min(MAX_COUNT, Math.round(data.score))
      : null;
    state.current = clampIndex(data.current, state.count);
    state.view = ['setup', 'host', 'sheet', 'summary'].includes(data.view) ? data.view : 'setup';
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

function getPlayerId() {
  try {
    const saved = localStorage.getItem(PLAYER_ID_KEY);
    if (saved) return saved;
    const id = crypto.randomUUID ? crypto.randomUUID() : `player-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(PLAYER_ID_KEY, id);
    return id;
  } catch {
    return `player-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

async function apiRequest(path, options = {}) {
  const request = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const body = await request.json().catch(() => ({}));
  if (!request.ok) throw new Error(body.error ?? body.message ?? `API-fel ${request.status}`);
  return body;
}

async function prepareGame() {
  const game = await apiRequest('/games', {
    method: 'POST',
    body: JSON.stringify(getGameSettings()),
  });

  applyGameSettings(game, true);
  state.playerId = state.playerId || getPlayerId();
  state.scoreSubmitted = false;
}

function getGameSettings() {
  return {
    questionCount: state.count,
    answerCount: state.answerCount,
    answerDesign: state.answerDesign,
    eliminationQuestion: state.eliminationQuestion,
  };
}

function applyGameSettings(game, locked) {
  state.gameId = String(game.gameId);
  state.gameCode = String(game.gameCode ?? game.gameId);
  state.answerCount = clampAnswerCount(Number(game.answerCount) || state.answerCount);
  state.answerDesign = ANSWER_DESIGNS.includes(game.answerDesign)
    ? game.answerDesign
    : state.answerDesign;
  state.eliminationQuestion = game.eliminationQuestion === true;
  state.count = clampCount(Number(game.questionCount) || state.count);
  els.gameCode.value = state.gameCode;
  els.answerCount.value = String(state.answerCount);
  els.answerDesign.value = state.answerDesign;
  els.eliminationQuestion.checked = state.eliminationQuestion;
  els.count.value = String(state.count);
  els.answerCountField.hidden = isFreeText();
  if (locked) state.setupMode = 'join';
  syncSetupMode();
}

function syncSetupMode() {
  const creating = state.setupMode === 'create';
  const joining = state.setupMode === 'join';

  els.gameSettings.hidden = !creating;
  els.startActions.hidden = !creating;
  els.gameCodeLabel.hidden = creating;
  els.gameCodeRow.hidden = creating;
  els.createGame.hidden = creating;
  els.joinGame.hidden = creating;
  els.gameCode.disabled = false;

  const controls = [
    els.answerCount,
    els.answerDesign,
    els.eliminationQuestion,
    els.count,
    els.countMinus,
    els.countPlus,
    ...els.chips,
  ];
  for (const control of controls) control.disabled = !creating;
  els.gameCodeStatus.textContent = joining
    ? `Går med i spel ${state.gameCode}. Inställningarna hämtas från spelet.`
    : els.gameCodeStatus.textContent;
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
  const { setup, host, sheet, summary } = els.views;
  setup.hidden = state.view !== 'setup';
  host.hidden = state.view !== 'host';
  sheet.hidden = state.view !== 'sheet';
  summary.hidden = state.view !== 'summary';

  if (state.view === 'setup') {
    els.name.value = state.name;
    els.gameCode.value = state.gameCode;
    els.answerCountField.hidden = isFreeText();
    els.answerCount.value = String(state.answerCount);
    els.answerDesign.value = state.answerDesign;
    els.eliminationQuestion.checked = state.eliminationQuestion;
    els.count.value = String(state.count);
    syncSetupMode();
    syncChips();
    document.title = 'Quiz · Svarsformulär';
  }

  if (state.view === 'host') renderHost();
  if (state.view === 'sheet') renderSheet();
  if (state.view === 'summary') renderSummary();

  save();
}

function renderHost() {
  els.hostGameCode.textContent = state.gameCode || '-----';
  els.endGame.disabled = false;
  els.hostResult.hidden = true;
  els.hostResult.innerHTML = '';
  els.hostStatus.textContent = `${state.count} frågor · ${state.answerDesign === 'text' ? 'Fritext' : `${state.answerCount} svarsalternativ`}`;
  document.title = `Spelkod ${state.gameCode} · Quiz`;
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

els.setupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.setupMode !== 'create') return;
  state.name = els.name.value.trim();
  readCountInput();

  const startButton = e.submitter;
  if (startButton) startButton.disabled = true;

  try {
    await prepareGame();
  } catch (error) {
    toast(`Kunde inte ansluta till spelet: ${error.message}`);
    if (startButton) startButton.disabled = false;
    return;
  }

  state.answers = {};
  state.correctAnswers = {};
  state.eliminationAnswer = '';
  state.current = 0;
  state.view = 'host';
  render();
  scrollToTop();
  if (startButton) startButton.disabled = false;
});

els.copyGameCode.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.gameCode);
    els.hostStatus.textContent = 'Spelkoden är kopierad.';
  } catch {
    els.hostStatus.textContent = `Spelkod: ${state.gameCode}`;
  }
});

els.endGame.addEventListener('click', async () => {
  if (!state.gameId) return;

  els.endGame.disabled = true;
  els.hostStatus.textContent = 'Hämtar resultat...';

  try {
    const game = await apiRequest(`/games/${encodeURIComponent(state.gameId)}`);
    const players = Array.isArray(game.players) ? game.players : [];

    if (players.length === 0) {
      els.hostResult.hidden = false;
      els.hostResult.innerHTML = '<h3>Inga resultat ännu</h3><p>Ingen deltagare har sparat sitt resultat.</p>';
      els.hostStatus.textContent = 'Spelet är avslutat.';
      return;
    }

    const topPlayers = players
      .map((player) => ({
        name: player.name || 'Deltagare',
        score: Number(player.score) || 0,
      }))
      .sort((first, second) => second.score - first.score)
      .slice(0, 3);

    els.hostResult.hidden = false;
    els.hostResult.innerHTML = `
      <h3>Topplista</h3>
      <ol class="host-result__list">
        ${topPlayers.map((player) => `
          <li>
            <span class="host-result__name">${escapeHtml(player.name)}</span>
            <strong>${player.score} av ${state.count}</strong>
          </li>`).join('')}
      </ol>`;
    els.hostStatus.textContent = 'Spelet är avslutat.';
  } catch (error) {
    els.hostStatus.textContent = `Kunde inte hämta resultatet: ${error.message}`;
    els.endGame.disabled = false;
  }
});

els.hostNewGame.addEventListener('click', () => {
  state.gameId = '';
  state.gameCode = '';
  state.setupMode = 'initial';
  state.view = 'setup';
  els.gameCode.value = '';
  els.gameCodeStatus.textContent = '';
  render();
  scrollToTop();
});

els.createGame.addEventListener('click', () => {
  state.setupMode = 'create';
  state.gameId = '';
  state.gameCode = '';
  els.gameCode.value = '';
  els.gameCodeStatus.textContent = 'Välj inställningar och tryck Starta.';
  syncSetupMode();
  save();
  els.answerCount.focus();
});

els.cancelCreate.addEventListener('click', () => {
  state.setupMode = 'initial';
  state.gameId = '';
  state.gameCode = '';
  els.gameCode.value = '';
  els.gameCodeStatus.textContent = '';
  syncSetupMode();
  save();
  els.name.focus();
});

els.joinGame.addEventListener('click', async () => {
  const requestedCode = els.gameCode.value.trim().toUpperCase();
  if (!requestedCode) {
    els.gameCodeStatus.textContent = 'Skriv en spelkod först.';
    els.gameCode.focus();
    return;
  }

  els.joinGame.disabled = true;
  els.gameCodeStatus.textContent = 'Hämtar spelet...';

  try {
    const game = await apiRequest(`/games/${encodeURIComponent(requestedCode)}`);
    applyGameSettings(game, true);
    state.name = els.name.value.trim();
    state.answers = {};
    state.correctAnswers = {};
    state.eliminationAnswer = '';
    state.current = 0;
    state.score = null;
    state.scoreSubmitted = false;
    state.view = 'sheet';
    render();
    scrollToTop();
  } catch (error) {
    els.gameCodeStatus.textContent = `Kunde inte hitta spelet: ${error.message}`;
    toast(`Kunde inte hitta spelet: ${error.message}`);
  } finally {
    els.joinGame.disabled = false;
  }
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
  document.title = `${answeredCount()}/${total} besvarade · Quiz`;
}

function updateProgress() {
  const done = answeredCount();
  const pct = state.count ? Math.round((done / state.count) * 100) : 0;
  els.progressBar.style.width = `${pct}%`;
  els.progress.setAttribute('aria-valuenow', String(pct));
  els.answeredCount.textContent = String(done);
  els.progress.setAttribute('aria-label', `${done} av ${state.count} besvarade`);
  document.title = `${done}/${state.count} besvarade · Quiz`;
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
  const eliminationInput = e.target.closest('.elimination-answer');
  if (eliminationInput) {
    state.eliminationAnswer = eliminationInput.value.trim().slice(0, 200);
    state.scoreSubmitted = false;
    save();
    return;
  }

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

els.submitScore.addEventListener('click', async () => {
  if (state.scoreSubmitted || !state.gameId) return;

  els.submitScore.disabled = true;
  els.scoreStatus.textContent = 'Sparar resultat...';

  try {
    await apiRequest(`/games/${encodeURIComponent(state.gameId)}/scores`, {
      method: 'POST',
      body: JSON.stringify({
        playerId: state.playerId || getPlayerId(),
        name: displayName(),
        score: state.score,
        eliminationAnswer: state.eliminationAnswer,
      }),
    });
    state.scoreSubmitted = true;
    renderSummary();
    save();
    toast('Resultatet är sparat');
  } catch (error) {
    els.scoreStatus.textContent = `Kunde inte spara resultatet: ${error.message}`;
    els.submitScore.disabled = false;
  }
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
    ['Spelkod', state.gameCode || '–'],
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
        <span class="ag__letter${isFreeText() ? ' ag__text' : ''}">${letter ?? '–'}</span>
      </li>`;
  }).join('');

  els.eliminationSummary.hidden = !state.eliminationQuestion;
  els.eliminationSummary.innerHTML = state.eliminationQuestion
    ? `<li><span class="ag__num">Utslagsfråga.</span><span class="ag__letter ag__text">${escapeHtml(state.eliminationAnswer || '–')}</span></li>`
    : '';

  const missing = state.count - done;
  els.summaryNote.textContent = missing > 0
    ? `${missing} frågor lämnades tomma.`
    : '';

  document.title = 'Svar inskickade · Quiz';

  /* Antal rätt räknas från markerade frågor */
  els.scoreMax.textContent = String(state.count);
  state.score = correctCount();
  els.score.value = String(state.score);
  els.submitScore.disabled = state.scoreSubmitted || !state.gameId;
  els.scoreStatus.textContent = state.scoreSubmitted ? 'Resultatet är sparat.' : '';
}

els.answerGrid.addEventListener('click', (e) => {
  const answer = e.target.closest('[data-correct-index]');
  if (!answer) return;
  const idx = Number(answer.dataset.correctIndex);
  if (state.correctAnswers[idx]) delete state.correctAnswers[idx];
  else state.correctAnswers[idx] = true;
  state.score = correctCount();
  state.scoreSubmitted = false;
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
  state.eliminationQuestion = true;
  state.eliminationAnswer = '';
  state.answers = {};
  state.correctAnswers = {};
  state.score = null;
  state.gameId = '';
  state.gameCode = '';
  state.setupMode = 'initial';
  state.scoreSubmitted = false;
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

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
  closedGameResult: $('#closed-game-result'),
  createGame: $('#create-game'),
  joinGame: $('#join-game'),
  gameSettings: $('#game-settings'),
  startActions: $('#start-actions'),
  cancelCreate: $('#cancel-create'),
  hostGameCode: $('#host-game-code'),
  hostQr: $('#host-qr'),
  hostQrCode: $('#host-qr-code'),
  hostQrNote: $('#host-qr-note'),
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
  playerResult: $('#player-result'),
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
  correctAnswers: {}, // { 0: true, ... } markerade rätt
  wrongAnswers: {},   // { 0: true, ... } markerade fel
  score: null,      // antal rätta svar, matas in manuellt
  gameId: '',
  gameCode: '',
  hostToken: '',    // hemlighet för värden, krävs för att avsluta spelet
  gameStatus: 'active',
  hostName: '',
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
    state.hostToken = String(data.hostToken ?? '');
    state.gameStatus = data.gameStatus === 'inactive' ? 'inactive' : 'active';
    state.hostName = String(data.hostName ?? '');
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
    state.wrongAnswers = sanitizeCorrectAnswers(data.wrongAnswers);
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const request = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
    const body = await request.json().catch(() => ({}));
    if (!request.ok) {
      const error = new Error(body.error ?? body.message ?? `API-fel ${request.status}`);
      error.status = request.status;
      throw error;
    }
    return body;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Svarar inte – kontrollera nätverket');
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
    hostName: state.name,
    questionCount: state.count,
    answerCount: state.answerCount,
    answerDesign: state.answerDesign,
    eliminationQuestion: state.eliminationQuestion,
  };
}

function applyGameSettings(game, locked) {
  state.gameId = String(game.gameId);
  state.gameCode = String(game.gameCode ?? game.gameId);
  /* Endast POST /games returnerar token – GET-svar (hopplingade) har ingen */
  if (game.hostToken) state.hostToken = String(game.hostToken);
  state.gameStatus = game.status === 'inactive' ? 'inactive' : 'active';
  state.hostName = String(game.hostName ?? '');
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

/* QR-länken använder ?kod=ABCDE (eller ?code=ABCDE) */
const codeFromUrl = () => {
  const params = new URLSearchParams(location.search);
  const raw = (params.get('kod') ?? params.get('code') ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{4,8}$/.test(raw) ? raw : null;
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

/* ---------- Polling ---------- */

let pollTimer = null;

function stopPolling() {
  clearTimeout(pollTimer);
  pollTimer = null;
}

/* fn returnerar true när polling ska sluta. Anrop görs inte när fönstret är dolt. */
function startPolling(fn, ms = 10000) {
  stopPolling();
  const tick = async () => {
    if (!document.hidden) {
      try { if (await fn()) return; } catch { /* försök igen nästa varv */ }
    }
    pollTimer = setTimeout(tick, ms);
  };
  pollTimer = setTimeout(tick, 0);
}

/* ---------- Vybyte ---------- */

function render() {
  stopPolling();
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
    document.title = 'Fredagsquiz · Svarsformulär';
  }

  if (state.view === 'host') renderHost();
  if (state.view === 'sheet') renderSheet();
  if (state.view === 'summary') renderSummary();

  save();
}

/* Värdvyns rubriktext ändras inte när spelet avslutas – hela
   rubrikblocket döljs i stället (se .panel--finished i styles.css). */
function setHostFinished(finished) {
  state.gameStatus = finished ? 'inactive' : 'active';
  els.views.host.classList.toggle('panel--finished', finished);
  els.endGame.disabled = finished;
  renderHostQr();
}

/* Adressen som QR-koden pekar på – appen öppnas med spelkoden ifylld. */
function joinUrl() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('kod', state.gameCode);
  return url.toString();
}

const isLocalHost = () => ['localhost', '127.0.0.1', '::1'].includes(location.hostname);

function renderHostQr() {
  if (!els.hostQr || !els.hostQrCode) return;

  const code = state.gameCode.trim();
  const setNote = (message) => {
    if (!els.hostQrNote) return;
    els.hostQrNote.textContent = message;
    els.hostQrNote.hidden = !message;
  };
  const hide = (message) => {
    els.hostQr.hidden = true;
    els.hostQrCode.innerHTML = '';
    setNote(message);
  };

  if (!code || state.gameStatus === 'inactive') {
    hide('');
    return;
  }

  if (location.protocol === 'file:') {
    hide('QR-koden visas först när sidan ligger på en webbserver (http/https), inte när filen öppnas direkt.');
    return;
  }

  if (typeof qrcode !== 'function') {
    console.warn('qrcode.js saknas – QR-koden kan inte ritas. Kontrollera att filen ligger bredvid index.html.');
    hide('QR-koden kunde inte laddas – kontrollera att qrcode.js ligger bredvid index.html.');
    return;
  }

  try {
    const qr = qrcode(0, 'M');
    qr.addData(joinUrl());
    qr.make();
    els.hostQrCode.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    els.hostQr.hidden = false;
    setNote(isLocalHost()
      ? 'QR-koden pekar på localhost och funkar bara på den här datorn – publicera sidan för att deltagarna ska kunna skanna.'
      : '');
  } catch (error) {
    console.warn('Kunde inte skapa QR-koden:', error);
    hide('Kunde inte skapa QR-koden – använd spelkoden ovan.');
  }
}

function setHostStatus(message) {
  els.hostStatus.textContent = message;
  els.hostStatus.hidden = !message;
}

function renderHost() {
  els.hostGameCode.textContent = state.gameCode || '-----';
  setHostFinished(state.gameStatus === 'inactive');
  els.hostResult.hidden = true;
  els.hostResult.innerHTML = '';
  setHostStatus(`${state.count} frågor · ${state.answerDesign === 'text' ? 'Fritext' : `${state.answerCount} svarsalternativ`}`);
  document.title = `Spelkod ${state.gameCode} · Fredagsquiz`;
  if (state.gameStatus === 'inactive' && state.gameId) showHostResult();
  else startHostPolling();
}

/* Följer med när deltagare skickar in, tills någon avslutar spelet. */
function startHostPolling() {
  if (state.gameStatus !== 'active' || !state.gameId) return;

  startPolling(async () => {
    const game = await apiRequest(`/games/${encodeURIComponent(state.gameId)}`);

    if (game.status === 'inactive') {
      setHostFinished(true);
      await showHostResult();
      return true;
    }

    const sent = Array.isArray(game.players) ? game.players.length : 0;
    setHostStatus(`${sent} har skickat in · ${state.count} frågor`);
    return false;
  });
}

async function showHostResult() {
  setHostStatus('Hämtar resultat...');

  try {
    const game = await apiRequest(`/games/${encodeURIComponent(state.gameId)}`);
    els.hostResult.hidden = false;
    els.hostResult.innerHTML = renderLeaderboard(game.players, state.count);
    setHostStatus('');
  } catch (error) {
    els.hostResult.hidden = true;
    els.hostResult.innerHTML = '';
    setHostStatus(`Kunde inte hämta resultatet: ${error.message}`);
  }
}

function renderLeaderboard(players, questionCount) {
  const ranked = (Array.isArray(players) ? players : [])
    .map((player) => ({
      name: player.name || 'Deltagare',
      score: Number(player.score) || 0,
      eliminationAnswer: player.eliminationAnswer || '',
    }))
    .sort((first, second) => second.score - first.score);

  if (ranked.length === 0) {
    return '<h3>Inga resultat ännu</h3><p>Ingen deltagare har sparat sitt resultat.</p>';
  }

  /* Ta med hela gruppen vid tredje plats – en delad tredjeplassare får inte
     försvinna tyst. Alla med samma poäng som den tredje raden syns. */
  const cutoff = ranked[Math.min(2, ranked.length - 1)].score;
  const topPlayers = ranked.filter((player) => player.score >= cutoff);

  const highestScore = ranked[0].score;
  const showTieBreakers = ranked.filter((player) => player.score === highestScore).length > 1;

  let previousScore = null;
  let previousRank = 0;

  const rows = topPlayers.map((player, index) => {
    /* Tävlingsranking: 1, 1, 3 – delade platser får samma platsiffra */
    const rank = player.score === previousScore ? previousRank : index + 1;
    previousScore = player.score;
    previousRank = rank;
    const showElimination = showTieBreakers && player.score === highestScore;

    return `
        <li class="host-result__item host-result__item--${rank}">
          <span class="host-result__rank">${rank}</span>
          <span class="host-result__body">
            <span class="host-result__name">${escapeHtml(player.name)}</span>
            ${showElimination ? `
            <span class="host-result__tie">
              <span class="host-result__tie-label">Utslag</span>
              <span>${escapeHtml(player.eliminationAnswer || '–')}</span>
            </span>` : ''}
          </span>
          <strong class="host-result__score">${player.score}<span class="host-result__of">av ${questionCount}</span></strong>
        </li>`;
  }).join('');

  return `
    <h3>Topplista</h3>
    <ol class="host-result__list">${rows}
    </ol>`;
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
  if (!state.name) {
    els.name.setCustomValidity('Namn krävs');
    els.name.reportValidity();
    els.name.setCustomValidity('');
    els.name.focus();
    return;
  }
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
  state.wrongAnswers = {};
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
    setHostStatus('Spelkoden är kopierad.');
  } catch {
    setHostStatus(`Spelkod: ${state.gameCode}`);
  }
});

els.endGame.addEventListener('click', async () => {
  if (!state.gameId) return;

  /* Knapparna och spelkoden går ur bilden direkt, så att det tydligt syns att
     spelet avslutats. Om anropet misslyckas sätts vyn tillbaka. */
  stopPolling();
  setHostFinished(true);
  setHostStatus('Avslutar spelet...');

  try {
    await apiRequest(`/games/${encodeURIComponent(state.gameId)}`, {
      method: 'PATCH',
      headers: { 'x-host-token': state.hostToken },
      body: JSON.stringify({ status: 'inactive' }),
    });
    await showHostResult();
  } catch (error) {
    setHostStatus(`Kunde inte avsluta spelet: ${error.message}`);
    setHostFinished(false);
    if (state.gameStatus === 'active') startHostPolling();
  }
});

els.hostNewGame.addEventListener('click', () => {
  state.gameId = '';
  state.gameCode = '';
  state.hostToken = '';
  state.setupMode = 'initial';
  state.view = 'setup';
  els.gameCode.value = '';
  els.gameCodeStatus.textContent = '';
  els.closedGameResult.hidden = true;
  els.closedGameResult.innerHTML = '';
  clearPlayerResult();
  render();
  scrollToTop();
});

els.createGame.addEventListener('click', () => {
  state.setupMode = 'create';
  state.gameId = '';
  state.gameCode = '';
  state.hostToken = '';
  els.gameCode.value = '';
  els.gameCodeStatus.textContent = 'Välj inställningar och tryck Starta.';
  els.closedGameResult.hidden = true;
  els.closedGameResult.innerHTML = '';
  clearPlayerResult();
  syncSetupMode();
  save();
  els.answerCount.focus();
});

els.cancelCreate.addEventListener('click', () => {
  state.setupMode = 'initial';
  state.gameId = '';
  state.gameCode = '';
  state.hostToken = '';
  els.gameCode.value = '';
  els.gameCodeStatus.textContent = '';
  els.closedGameResult.hidden = true;
  els.closedGameResult.innerHTML = '';
  clearPlayerResult();
  syncSetupMode();
  save();
  els.name.focus();
});

els.joinGame.addEventListener('click', async () => {
  state.name = els.name.value.trim();
  if (!state.name) {
    els.name.setCustomValidity('Namn krävs');
    els.name.reportValidity();
    els.name.setCustomValidity('');
    els.name.focus();
    return;
  }

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
    /* Ny koppling – glöm en eventuell gammal topplista från föregående spel */
    clearPlayerResult();

    if (game.status === 'inactive') {
      state.gameId = String(game.gameId ?? requestedCode);
      state.gameCode = String(game.gameCode ?? requestedCode);
      state.gameStatus = 'inactive';
      els.closedGameResult.hidden = false;
      els.closedGameResult.innerHTML = `
        <h3>Spelet är avslutat</h3>
        ${renderLeaderboard(game.players, Number(game.questionCount) || state.count)}`;
      els.gameCodeStatus.textContent = '';
      return;
    }

    /* En hopplingad är aldrig värd – nollställ ev. gammal värdtoken */
    state.hostToken = '';
    applyGameSettings(game, true);
    state.name = els.name.value.trim();
    state.answers = {};
    state.correctAnswers = {};
    state.wrongAnswers = {};
    state.eliminationAnswer = '';
    state.current = 0;
    state.score = null;
    state.scoreSubmitted = false;
    els.closedGameResult.hidden = true;
    els.closedGameResult.innerHTML = '';
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
  state.correctAnswers = sanitizeCorrectAnswers(state.correctAnswers);
  state.wrongAnswers = sanitizeCorrectAnswers(state.wrongAnswers);

  els.whoName.textContent = displayName();
  els.whoAvatar.textContent = displayName().charAt(0);
  els.answerHint.hidden = isFreeText();
  if (!isFreeText()) {
    els.answerHint.innerHTML = `${answerOptions().map((option) => `<kbd>${option}</kbd>`).join('')}<span class="hintbar__sep" aria-hidden="true">&middot;</span><span>kryssa i med tangentbordet &ndash; <kbd>&uarr;</kbd><kbd>&darr;</kbd> byter fr&aring;ga</span>`;
  }

  els.totalCount.textContent = String(total);
  els.sheetCount.textContent = String(total);

  /* Hopplingade spelare får inte ändra antalet frågor */
  const countBlock = els.sheetMinus.closest('.toolbar__count');
  if (countBlock) countBlock.hidden = state.setupMode === 'join';
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
  delete state.wrongAnswers[idx];
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
  delete state.wrongAnswers[idx];
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

let scoreRetryPending = false;

async function sendScore() {
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
    scoreRetryPending = false;
    state.scoreSubmitted = true;
    renderSummary();
    save();
    toast('Resultatet är sparat');
  } catch (error) {
    /* Spelet hann avslutas innan resultatet sparades (409) – visa slutresultatet direkt */
    if (error.status === 409) {
      scoreRetryPending = false;
      els.submitScore.disabled = true;
      els.scoreStatus.textContent = 'Spelet avslutades innan resultatet hann sparas.';
      await showFinalResult();
      return;
    }

    /* Nätverksfel/timeouts är tillfälliga – 4xx betyder att det aldrig går att spara */
    const permanent = Number.isInteger(error.status) && error.status < 500;
    scoreRetryPending = !permanent;
    els.submitScore.disabled = permanent;
    els.scoreStatus.textContent = permanent
      ? `Kunde inte spara: ${error.message}`
      : `Kunde inte spara: ${error.message}. Försöker igen när nätet är tillbaka.`;
  }
}

els.submitScore.addEventListener('click', sendScore);

window.addEventListener('online', () => {
  if (scoreRetryPending && state.view === 'summary') sendScore();
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
  els.answerGrid.classList.toggle('answergrid--text', isFreeText());
  /* Metarutorna är bortkommenterade i index.html – hoppa över om de saknas */
  if (els.summaryMeta) {
    const items = [
      ['Deltagare', displayName()],
      ['Spelkod', state.gameCode || '–'],
      ['Besvarade', `${done} av ${state.count}`],
    ];

    els.summaryMeta.innerHTML = items.map(([key, val]) => `
      <div class="meta__item">
        <dt class="meta__key">${key}</dt>
        <dd class="meta__val">${escapeHtml(val)}</dd>
      </div>`).join('');
  }

  els.answerGrid.innerHTML = Array.from({ length: state.count }, (_, i) => {
    const letter = state.answers[i];
    const empty = !letter;
    const markedCorrect = Boolean(state.correctAnswers[i]);
    const markedWrong = Boolean(state.wrongAnswers[i]);
    const classes = [
      empty ? 'ag--empty' : '',
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


  document.title = 'Svar inskickade · Fredagsquiz';

  /* Antal rätt räknas från markerade frågor */
  els.scoreMax.textContent = String(state.count);
  state.score = correctCount();
  els.score.value = String(state.score);
  els.submitScore.disabled = state.scoreSubmitted || !state.gameId;
  els.scoreStatus.textContent = state.scoreSubmitted ? 'Resultatet är sparat.' : '';

  watchForResult();
}

function showPlayerResult(game) {
  els.playerResult.innerHTML = `<h3>Spelet är avslutat</h3>${renderLeaderboard(game.players, Number(game.questionCount) || state.count)}`;
  els.playerResult.hidden = false;
}

function clearPlayerResult() {
  els.playerResult.hidden = true;
  els.playerResult.innerHTML = '';
}

/* Hämta och visa slutresultatet en gång – används när pollingen inte hunnit igång. */
async function showFinalResult() {
  if (!state.gameId) return false;
  try {
    const game = await apiRequest(`/games/${encodeURIComponent(state.gameId)}`);
    showPlayerResult(game);
    return true;
  } catch (error) {
    els.scoreStatus.textContent = `Spelet är avslutat. Kunde inte hämta slutresultatet: ${error.message}`;
    return false;
  }
}

/* Spelaren väntar in topplistan – polla bara efter att resultatet är sparat. */
function watchForResult() {
  if (!state.scoreSubmitted || !state.gameId) return;

  startPolling(async () => {
    const game = await apiRequest(`/games/${encodeURIComponent(state.gameId)}`);
    if (game.status !== 'inactive') return false;

    showPlayerResult(game);
    return true;
  });
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

  state.score = correctCount();
  els.score.value = String(state.score);
  /* Ändrat efter att resultatet sparats → sluta polla tills det sparas igen */
  stopPolling();
  state.scoreSubmitted = false;
  els.submitScore.disabled = !state.gameId;
  els.scoreStatus.textContent = '';
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
  if (!confirm('Avsluta pågående svar och starta om formuläret?')) return;
  state.name = '';
  state.answerCount = 4;
  state.answerDesign = 'letters';
  state.eliminationQuestion = true;
  state.eliminationAnswer = '';
  state.answers = {};
  state.correctAnswers = {};
  state.wrongAnswers = {};
  state.score = null;
  state.gameId = '';
  state.gameCode = '';
  state.hostToken = '';
  state.setupMode = 'initial';
  state.scoreSubmitted = false;
  scoreRetryPending = false;
  clearPlayerResult();
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

/* QR-länk: ?kod=ABCDE → förifyll spelkoden och öppna uppstarten */
const joinCode = codeFromUrl();
if (joinCode) {
  state.gameCode = joinCode;
  state.view = 'setup';
  state.setupMode = 'initial';
  try {
    const clean = new URL(location.href);
    clean.searchParams.delete('kod');
    clean.searchParams.delete('code');
    history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
  } catch {
    /* history kan vara otillgängligt – spelkoden är ändå ifylld */
  }
}

state.current = clampIndex(state.current, state.count);

render();

if (state.view === 'sheet') goToQuestion(unanswered()[0] ?? state.current);

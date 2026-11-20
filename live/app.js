/* =========================================================
   Fredagsquiz · Live
   Värden visar en fråga i taget, deltagarna svarar från mobilen.
   Servern rättar och räknar poäng – se game.mjs.
   ========================================================= */

'use strict';

const API_BASE_URL = 'https://cmsp9si3j7.execute-api.eu-north-1.amazonaws.com';
const STORAGE_KEY = 'quiz.live.v2';
const DRAFT_KEY = 'quiz.live.draft.v1';
const PLAYER_ID_KEY = 'quiz.player-id.v1';
const ANSWER_GRACE_MS = 1500; // samma marginal som servern (game.mjs)
const MAX_QUESTIONS = 50;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;
const LETTERS = 'ABCDEF';

const $ = (sel) => document.querySelector(sel);

const els = {
  views: {
    start: $('#view-start'),
    editor: $('#view-editor'),
    host: $('#view-host'),
    player: $('#view-player'),
  },
  joinForm: $('#join-form'),
  name: $('#name'),
  gameCode: $('#game-code'),
  joinGame: $('#join-game'),
  joinStatus: $('#join-status'),
  openEditor: $('#open-editor'),
  editorForm: $('#editor-form'),
  quizTitle: $('#quiz-title'),
  quizTimer: $('#quiz-timer'),
  quizScoring: $('#quiz-scoring'),
  scoringHint: $('#scoring-hint'),
  editorQuestions: $('#editor-questions'),
  addQuestion: $('#add-question'),
  exportQuiz: $('#export-quiz'),
  importQuiz: $('#import-quiz'),
  editorStatus: $('#editor-status'),
  editorBack: $('#editor-back'),
  createGame: $('#create-game'),
  hostLobby: $('#host-lobby'),
  hostGameCode: $('#host-game-code'),
  hostQr: $('#host-qr'),
  hostQrCode: $('#host-qr-code'),
  hostQrNote: $('#host-qr-note'),
  hostPlayersCount: $('#host-players-count'),
  hostPlayersList: $('#host-players-list'),
  startQuiz: $('#start-quiz'),
  hostStage: $('#host-stage'),
  endGame: $('#end-game'),
  hostNewGame: $('#host-new-game'),
  playerName: $('#player-name'),
  playerStage: $('#player-stage'),
  leaveGame: $('#leave-game'),
  toast: $('#toast'),
  confetti: $('#confetti'),
};

/* Det som överlever en omladdning. Allt annat kommer från servern. */
const state = {
  view: 'start',    // start | editor | host | player
  name: '',
  gameId: '',
  hostToken: '',
  playerId: '',
};

let game = null;          // senaste svaret från GET /games/{id}
let clockOffset = 0;      // serverns klocka minus vår, för nedräkningen
let renderedKey = '';     // vad scenen senast ritades för – hindrar flimmer
let answering = null;     // { index, choice } medan ett svar skickas/är skickat
let hostBusy = false;     // en PATCH är på väg
let autoRevealPausedUntil = 0; // backoff när värdens PATCH misslyckas (t.ex. offline)
let celebrated = '';

/* ---------- Lagring ---------- */

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!data || typeof data !== 'object') return;
    state.view = ['start', 'editor', 'host', 'player'].includes(data.view) ? data.view : 'start';
    state.name = String(data.name ?? '');
    state.gameId = String(data.gameId ?? '');
    state.hostToken = String(data.hostToken ?? '');
    state.playerId = String(data.playerId ?? '');
  } catch {
    /* korrupt sparad data – börja om */
  }
  if (state.view === 'host' && !state.hostToken) state.view = 'start';
  if ((state.view === 'host' || state.view === 'player') && !state.gameId) state.view = 'start';
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* privat läge / full lagring – ignoreras tyst */
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

/* ---------- API ---------- */

/* Serverns felmeddelanden är delvis på engelska – välj text efter statuskod.
   Svenska meddelanden från servern (t.ex. "Spelet är avslutat") släpps igenom. */
function friendlyApiError(status, body) {
  const server = String(body?.error ?? '');
  if (status === 409) return server || 'Spelet är avslutat.';
  if (status === 400 && server.startsWith('Ogiltig')) return server;
  if (status === 400 || status === 422) return 'Något i uppgifterna stämmer inte – kontrollera dem och försök igen.';
  if (status === 403) return server || 'Bara den som skapade spelet kan göra det här.';
  if (status === 404) return 'Hittar inget spel med den koden – kontrollera att den är rätt skriven.';
  if (status === 429) return 'För många försök just nu – vänta en stund och försök igen.';
  if (status >= 500) return 'Något gick fel hos servern – försök igen om en stund.';
  return 'Något gick fel – försök igen.';
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
      const error = new Error(friendlyApiError(request.status, body));
      error.status = request.status;
      error.serverMessage = String(body?.error ?? '');
      throw error;
    }
    return body;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Servern svarar inte – kontrollera nätverket och försök igen.');
    /* fetch kastar TypeError när nätet är nere eller servern inte nås */
    if (error instanceof TypeError) throw new Error('Ingen kontakt med servern – kontrollera nätverket och försök igen.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const gamePath = (suffix = '') => `/games/${encodeURIComponent(state.gameId)}${suffix}`;
const hostHeaders = () => (state.hostToken ? { 'x-host-token': state.hostToken } : {});

async function fetchGame() {
  const next = await apiRequest(gamePath(), { headers: hostHeaders() });
  applyGame(next);
  return next;
}

function applyGame(next) {
  if (Number.isFinite(next.serverNow)) clockOffset = next.serverNow - Date.now();
  game = next;
  if (state.view === 'host') renderHost();
  if (state.view === 'player') renderPlayer();
}

const serverNow = () => Date.now() + clockOffset;
const secondsLeft = () => (game?.questionEndsAt ? Math.max(0, Math.ceil((game.questionEndsAt - serverNow()) / 1000)) : null);

/* ---------- Polling ---------- */

let pollTimer = null;
let pollTick = null;

function stopPolling() {
  clearTimeout(pollTimer);
  pollTimer = null;
  pollTick = null;
}

/* fn returnerar true när polling ska sluta. Anrop görs inte när fönstret är dolt.
   ms kan vara en funktion – takten följer spelets fas. */
function startPolling(fn, ms = 2000) {
  stopPolling();
  let running = false;
  const tick = async () => {
    if (running) return; // visibilitychange mitt i ett anrop – det pågående varvet räcker
    running = true;
    clearTimeout(pollTimer);
    let done = false;
    if (!document.hidden) {
      try { done = await fn(); } catch { /* försök igen nästa varv */ }
    }
    running = false;
    if (pollTick !== tick) return; // stoppad eller ersatt medan anropet pågick
    if (done) { stopPolling(); return; }
    pollTimer = setTimeout(tick, typeof ms === 'function' ? ms() : ms);
  };
  pollTick = tick;
  pollTimer = setTimeout(tick, 0);
}

/* En mobil som väcks ska hänga med direkt, inte vänta på nästa varv. */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && pollTick) pollTick();
});

const pollInterval = () => (game?.phase === 'question' ? 1000 : 2000);

function startGamePolling() {
  startPolling(async () => {
    try {
      const next = await fetchGame();
      return next.phase === 'finished';
    } catch (error) {
      if (error.status === 404) {
        toast('Spelet finns inte längre.');
        leaveGame();
        return true;
      }
      throw error;
    }
  }, pollInterval);
}

/* Nedräkningen ritas lokalt fyra gånger i sekunden. Värden går själv till
   reveal när tiden (plus nätmarginalen) är ute. */
setInterval(() => {
  if (game?.phase !== 'question') return;
  const left = secondsLeft();
  for (const node of document.querySelectorAll('[data-countdown]')) {
    node.textContent = left === null ? '' : String(left);
    node.classList.toggle('live-countdown--low', left !== null && left <= 5);
  }
  if (state.view === 'host') maybeAutoReveal();
}, 250);

/* ---------- Vybyte ---------- */

function show(view) {
  state.view = view;
  for (const [name, node] of Object.entries(els.views)) node.hidden = name !== view;
  renderedKey = '';
  stopPolling();
  save();

  if (view === 'start') {
    els.name.value = state.name;
    document.title = 'Fredagsquiz · Live';
  }
  if (view === 'editor') renderEditor();
  if (view === 'host' || view === 'player') {
    if (game) applyGame(game);
    startGamePolling();
  }
  scrollToTop();
}

function leaveGame() {
  stopPolling();
  game = null;
  answering = null;
  state.gameId = '';
  state.hostToken = '';
  show('start');
}

/* ---------- Gå med ---------- */

/* QR-länken använder ?kod=ABCDE (eller ?code=ABCDE) */
const codeFromUrl = () => {
  const params = new URLSearchParams(location.search);
  const raw = (params.get('kod') ?? params.get('code') ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{4,8}$/.test(raw) ? raw : null;
};

els.joinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  state.name = els.name.value.trim();
  const code = els.gameCode.value.trim().toUpperCase();
  if (!state.name || !code) {
    els.joinForm.reportValidity();
    return;
  }

  els.joinGame.disabled = true;
  els.joinStatus.textContent = 'Går med...';
  state.playerId = state.playerId || getPlayerId();

  try {
    const joined = await apiRequest(`/games/${encodeURIComponent(code)}/players`, {
      method: 'POST',
      body: JSON.stringify({ playerId: state.playerId, name: state.name }),
    });
    state.gameId = String(joined.gameId ?? code);
    state.hostToken = '';
    els.joinStatus.textContent = '';
    game = joined;
    answering = null;
    show('player');
  } catch (error) {
    els.joinStatus.textContent = error.status === 404 ? error.message : `Kunde inte gå med: ${error.message}`;
  } finally {
    els.joinGame.disabled = false;
  }
});

els.leaveGame.addEventListener('click', () => {
  if (game?.phase !== 'finished' && !confirm('Lämna spelet? Du kan gå med igen med samma kod.')) return;
  leaveGame();
});

/* ---------- Quizredigeraren ---------- */

const emptyQuestion = () => ({ text: '', options: ['', '', '', ''], correct: 0 });

let draft = loadDraft();

function loadDraft() {
  try {
    return sanitizeDraft(JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null'));
  } catch {
    return sanitizeDraft(null);
  }
}

/* Gör om valfri JSON (sparat utkast eller importerad fil) till ett giltigt utkast. */
function sanitizeDraft(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  /* Samma gränser som servern: 0 eller 5–120 s. Valen i listan är bara snabbval. */
  const timer = Number(data.timeLimitSec);
  const timeLimitSec = Number.isInteger(timer) && (timer === 0 || (timer >= 5 && timer <= 120)) ? timer : 20;
  const questions = (Array.isArray(data.questions) ? data.questions : [])
    .slice(0, MAX_QUESTIONS)
    .map((question) => {
      const options = (Array.isArray(question?.options) ? question.options : [])
        .slice(0, MAX_OPTIONS)
        .map((option) => String(option ?? '').slice(0, 100));
      while (options.length < MIN_OPTIONS) options.push('');
      const correct = Number.isInteger(question?.correct) && question.correct < options.length ? question.correct : 0;
      return { text: String(question?.text ?? '').slice(0, 200), options, correct };
    });
  return {
    title: String(data.title ?? '').slice(0, 100),
    timeLimitSec,
    scoring: data.scoring === 'speed' && timeLimitSec > 0 ? 'speed' : 'correct',
    questions: questions.length ? questions : [emptyQuestion()],
  };
}

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* utkastet är en bekvämlighet – ignoreras tyst */
  }
}

function syncScoring() {
  const noTimer = draft.timeLimitSec === 0;
  if (noTimer) draft.scoring = 'correct';
  els.quizScoring.querySelector('option[value="speed"]').disabled = noTimer;
  els.quizScoring.value = draft.scoring;
  els.scoringHint.textContent = noTimer ? 'Snabbhetspoäng kräver en timer.' : '';
}

function renderEditor() {
  els.quizTitle.value = draft.title;
  if (!els.quizTimer.querySelector(`option[value="${draft.timeLimitSec}"]`)) {
    els.quizTimer.add(new Option(`${draft.timeLimitSec} s`, String(draft.timeLimitSec)));
  }
  els.quizTimer.value = String(draft.timeLimitSec);
  syncScoring();
  els.addQuestion.disabled = draft.questions.length >= MAX_QUESTIONS;
  document.title = 'Skapa quiz · Fredagsquiz';

  const last = draft.questions.length - 1;
  els.editorQuestions.innerHTML = draft.questions.map((question, q) => `
    <li class="live-editor__q" data-q="${q}">
      <div class="live-editor__head">
        <span class="q__num">${q + 1}</span>
        <input class="input" type="text" data-field="text" maxlength="200" value="${escapeHtml(question.text)}"
               placeholder="Frågetext" aria-label="Fråga ${q + 1}">
      </div>
      <fieldset class="live-editor__opts">
        <legend class="sr-only">Svarsalternativ för fråga ${q + 1} – markera rätt svar</legend>
        ${question.options.map((option, o) => `
        <div class="live-editor__opt live-opt--${o}">
          <input type="radio" name="correct-${q}" data-correct="${o}" ${question.correct === o ? 'checked' : ''}
                 aria-label="${LETTERS[o]} är rätt svar">
          <input class="input" type="text" data-option="${o}" maxlength="100" value="${escapeHtml(option)}"
                 placeholder="Alternativ ${LETTERS[o]}" aria-label="Fråga ${q + 1}, alternativ ${LETTERS[o]}">
          <button class="btn btn--quiet btn--sm" type="button" data-action="remove-option" data-o="${o}"
                  ${question.options.length <= MIN_OPTIONS ? 'disabled' : ''} aria-label="Ta bort alternativ ${LETTERS[o]}">&times;</button>
        </div>`).join('')}
      </fieldset>
      <div class="live-editor__tools">
        <button class="btn btn--quiet btn--sm" type="button" data-action="add-option"
                ${question.options.length >= MAX_OPTIONS ? 'disabled' : ''}>+ Alternativ</button>
        <button class="btn btn--quiet btn--sm" type="button" data-action="up" ${q === 0 ? 'disabled' : ''} aria-label="Flytta upp fråga ${q + 1}">&uarr;</button>
        <button class="btn btn--quiet btn--sm" type="button" data-action="down" ${q === last ? 'disabled' : ''} aria-label="Flytta ner fråga ${q + 1}">&darr;</button>
        <button class="btn btn--quiet btn--sm" type="button" data-action="remove" ${last === 0 ? 'disabled' : ''} aria-label="Ta bort fråga ${q + 1}">Ta bort</button>
      </div>
    </li>`).join('');
}

els.quizTitle.addEventListener('input', () => { draft.title = els.quizTitle.value.slice(0, 100); saveDraft(); });
els.quizTimer.addEventListener('change', () => { draft.timeLimitSec = Number(els.quizTimer.value); syncScoring(); saveDraft(); });
els.quizScoring.addEventListener('change', () => { draft.scoring = els.quizScoring.value; saveDraft(); });

/* Text skrivs rakt in i utkastet utan omritning – annars tappas fokus. */
els.editorQuestions.addEventListener('input', (e) => {
  const card = e.target.closest('[data-q]');
  if (!card) return;
  const question = draft.questions[Number(card.dataset.q)];
  if (e.target.dataset.field === 'text') question.text = e.target.value;
  if (e.target.dataset.option !== undefined) question.options[Number(e.target.dataset.option)] = e.target.value;
  saveDraft();
});

els.editorQuestions.addEventListener('change', (e) => {
  const card = e.target.closest('[data-q]');
  if (!card || e.target.dataset.correct === undefined) return;
  draft.questions[Number(card.dataset.q)].correct = Number(e.target.dataset.correct);
  saveDraft();
});

els.editorQuestions.addEventListener('click', (e) => {
  const button = e.target.closest('[data-action]');
  const card = e.target.closest('[data-q]');
  if (!button || !card) return;
  const q = Number(card.dataset.q);
  const list = draft.questions;
  const question = list[q];

  switch (button.dataset.action) {
    case 'add-option':
      if (question.options.length < MAX_OPTIONS) question.options.push('');
      break;
    case 'remove-option': {
      const o = Number(button.dataset.o);
      if (question.options.length <= MIN_OPTIONS) return;
      question.options.splice(o, 1);
      if (question.correct === o) question.correct = 0;
      else if (question.correct > o) question.correct -= 1;
      break;
    }
    case 'up':
      if (q > 0) [list[q - 1], list[q]] = [list[q], list[q - 1]];
      break;
    case 'down':
      if (q < list.length - 1) [list[q + 1], list[q]] = [list[q], list[q + 1]];
      break;
    case 'remove':
      if (list.length > 1) list.splice(q, 1);
      break;
    default:
      return;
  }
  saveDraft();
  renderEditor();
});

els.addQuestion.addEventListener('click', () => {
  if (draft.questions.length >= MAX_QUESTIONS) return;
  draft.questions.push(emptyQuestion());
  saveDraft();
  renderEditor();
  els.editorQuestions.lastElementChild?.querySelector('[data-field="text"]')?.focus();
});

els.exportQuiz.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${(draft.title || 'quiz').replace(/[^\p{L}\p{N}_-]+/gu, '-')}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

els.importQuiz.addEventListener('change', async () => {
  const file = els.importQuiz.files?.[0];
  els.importQuiz.value = '';
  if (!file) return;
  try {
    draft = sanitizeDraft(JSON.parse(await file.text()));
    saveDraft();
    renderEditor();
    els.editorStatus.textContent = `Importerade ${draft.questions.length} frågor.`;
  } catch {
    els.editorStatus.textContent = 'Filen gick inte att läsa – är det en exporterad quiz-fil (JSON)?';
  }
});

/* AI utan backend: värden kör prompten i ChatGPT eller Claude och klistrar in svaret. */
function aiPrompt(topic, count, level) {
  return `Skapa ett quiz på svenska om "${topic}" med ${count} flervalsfrågor, svårighet: ${level}. `
    + 'Varje fråga har 4 svarsalternativ och exakt ett rätt. Var noga med att fakta stämmer. '
    + 'Svara ENBART med JSON i exakt detta format, utan annan text: '
    + '{"title":"...","questions":[{"text":"...","options":["...","...","...","..."],"correct":0}]} '
    + 'där correct är index (0–3) för rätt alternativ. Variera vilket index som är rätt.';
}

/* Prompten från formuläret, eller null (med felmeddelande) om ämnet saknas. */
function formPrompt() {
  const topic = $('#ai-topic').value.trim();
  if (!topic) {
    els.editorStatus.textContent = 'Skriv ett ämne först.';
    $('#ai-topic').focus();
    return null;
  }
  const count = Math.min(MAX_QUESTIONS, Math.max(1, Number($('#ai-count').value) || 10));
  return aiPrompt(topic, count, $('#ai-level').value);
}

document.querySelectorAll('[data-ai-url]').forEach((button) => button.addEventListener('click', () => {
  const prompt = formPrompt();
  /* shortcut: ?q= är inget officiellt API hos ChatGPT/Claude; slutar det fungera finns Kopiera prompten. */
  if (prompt) window.open(button.dataset.aiUrl + encodeURIComponent(prompt), '_blank', 'noopener');
}));

$('#ai-copy').addEventListener('click', async () => {
  const prompt = formPrompt();
  if (!prompt) return;
  try {
    await navigator.clipboard.writeText(prompt);
    els.editorStatus.textContent = 'Prompten är kopierad – klistra in den i valfri AI.';
  } catch {
    els.editorStatus.textContent = 'Kunde inte kopiera – markera prompten och kopiera själv: ' + prompt;
  }
});

$('#ai-use').addEventListener('click', () => {
  const text = $('#ai-answer').value;
  /* AI:n lindar ofta in JSON i ```json … ```, så ta bara det mellan första { och sista }. */
  try {
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (!Array.isArray(parsed.questions) || !parsed.questions.length) throw new Error('inga frågor');
    draft = sanitizeDraft({ ...draft, title: parsed.title || draft.title, questions: parsed.questions });
    saveDraft();
    renderEditor();
    $('#ai-answer').value = '';
    els.editorStatus.textContent = `Hämtade ${draft.questions.length} frågor. Läs igenom dem innan du startar.`;
  } catch {
    els.editorStatus.textContent = 'Kunde inte läsa svaret – klistra in hela JSON-svaret från AI:n.';
  }
});

els.openEditor.addEventListener('click', () => {
  state.name = els.name.value.trim();
  show('editor');
});
els.editorBack.addEventListener('click', () => show('start'));

/* Kollen här ger bara bättre felmeddelanden – servern validerar på riktigt. */
function draftProblem() {
  for (const [q, question] of draft.questions.entries()) {
    if (!question.text.trim()) return { q, message: `Fråga ${q + 1} saknar text.` };
    const empty = question.options.findIndex((option) => !option.trim());
    if (empty >= 0) return { q, message: `Fråga ${q + 1}: alternativ ${LETTERS[empty]} är tomt.` };
  }
  return null;
}

els.editorForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const problem = draftProblem();
  if (problem) {
    els.editorStatus.textContent = problem.message;
    els.editorQuestions.children[problem.q]?.scrollIntoView({ block: 'center' });
    return;
  }

  els.createGame.disabled = true;
  els.editorStatus.textContent = 'Skapar spelet...';

  try {
    const created = await apiRequest('/games', {
      method: 'POST',
      body: JSON.stringify({ hostName: state.name, quiz: draft }),
    });
    state.gameId = String(created.gameId);
    state.hostToken = String(created.hostToken);
    els.editorStatus.textContent = '';
    game = created;
    show('host');
  } catch (error) {
    els.editorStatus.textContent = `Kunde inte skapa spelet: ${error.message}`;
  } finally {
    els.createGame.disabled = false;
  }
});

/* ---------- Värd ---------- */

/* Adressen som QR-koden pekar på – sidan öppnas med spelkoden ifylld. */
function joinUrl() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('kod', state.gameId);
  return url.toString();
}

const isLocalHost = () => ['localhost', '127.0.0.1', '::1'].includes(location.hostname);

function renderHostQr() {
  const setNote = (message) => {
    els.hostQrNote.textContent = message;
    els.hostQrNote.hidden = !message;
  };
  const hide = (message) => {
    els.hostQr.hidden = true;
    els.hostQrCode.innerHTML = '';
    setNote(message);
  };

  if (location.protocol === 'file:') {
    hide('QR-koden visas först när sidan ligger på en webbserver (http/https), inte när filen öppnas direkt.');
    return;
  }

  if (typeof qrcode !== 'function') {
    console.warn('qrcode.js saknas – QR-koden kan inte ritas.');
    hide('QR-koden kunde inte laddas – använd spelkoden ovan.');
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

function renderHostPlayers() {
  const joined = game.joined ?? [];
  els.hostPlayersCount.textContent = String(joined.length);
  els.hostPlayersList.innerHTML = joined.map((player, i) => `
      <li class="host-players__item">
        <span class="host-players__avatar magnet--${i % 6}" aria-hidden="true">${escapeHtml(player.name.charAt(0))}</span>
        <span class="host-players__name">${escapeHtml(player.name)}</span>
      </li>`).join('');
}

function renderHost() {
  if (!game) return;
  const { phase } = game;
  const lobby = phase === 'lobby';
  els.hostLobby.hidden = !lobby;
  els.endGame.hidden = phase === 'finished';
  els.hostNewGame.hidden = phase !== 'finished';

  if (lobby) {
    const key = `lobby:${game.gameId}`;
    if (renderedKey !== key) {
      els.hostGameCode.textContent = game.gameCode ?? state.gameId;
      renderHostQr();
      document.title = `Spelkod ${state.gameId} · Fredagsquiz`;
      renderedKey = key;
    }
    renderHostPlayers();
    els.startQuiz.disabled = hostBusy;
    els.hostStage.innerHTML = '';
    return;
  }

  const key = `${phase}:${game.currentIndex}`;
  if (renderedKey !== key) {
    renderedKey = key;
    els.hostStage.innerHTML = hostStageHtml();
    document.title = `${phaseTitle()} · Fredagsquiz`;
    if (phase === 'finished' && celebrated !== state.gameId) {
      celebrated = state.gameId;
      celebrate();
    }
  }

  /* Räknarna ändras utan att resten ritas om */
  const tally = els.hostStage.querySelector('[data-answered]');
  if (tally) tally.textContent = `${game.answeredCount} av ${game.joined.length} har svarat`;
  for (const button of els.hostStage.querySelectorAll('[data-host-action]')) button.disabled = hostBusy;
}

const phaseTitle = () => (game.phase === 'finished'
  ? 'Resultat'
  : `Fråga ${game.currentIndex + 1} av ${game.questionCount}`);

function questionHeadHtml() {
  return `
    <div class="live-question__meta">
      <span class="panel__eyebrow">${escapeHtml(phaseTitle())}</span>
      ${game.phase === 'question' && game.questionEndsAt ? '<span class="live-countdown" data-countdown></span>' : ''}
    </div>
    <h2 class="live-question__text">${escapeHtml(game.question?.text ?? '')}</h2>`;
}

function hostStageHtml() {
  if (game.phase === 'finished') {
    return `
      <div class="host-result live-final">
        ${renderLeaderboard(game.leaderboard, escapeHtml(game.title || 'Topplista'))}
      </div>`;
  }

  const options = game.question?.options ?? [];

  if (game.phase === 'question') {
    return `
      ${questionHeadHtml()}
      <ol class="live-options">
        ${options.map((option, o) => `
        <li class="live-option live-opt--${o}"><span class="live-option__letter">${LETTERS[o]}</span>${escapeHtml(option)}</li>`).join('')}
      </ol>
      <p class="live-tally" data-answered></p>
      <div class="actions actions--wrap">
        <button class="btn btn--primary btn--lg" type="button" data-host-action="reveal">Visa svar</button>
      </div>`;
  }

  /* reveal */
  const counts = game.distribution ?? [];
  const most = Math.max(1, ...counts);
  const last = game.currentIndex + 1 >= game.questionCount;
  return `
    ${questionHeadHtml()}
    <ol class="live-options live-options--reveal">
      ${options.map((option, o) => `
      <li class="live-option live-opt--${o}${o === game.correct ? ' live-option--correct' : ''}">
        <span class="live-option__letter">${o === game.correct ? '&#10003;' : LETTERS[o]}</span>
        <span class="live-option__text">${escapeHtml(option)}</span>
        <span class="live-option__bar" style="--share:${(counts[o] ?? 0) / most}"></span>
        <strong class="live-option__count">${counts[o] ?? 0}</strong>
      </li>`).join('')}
    </ol>
    <div class="host-result">${renderLeaderboard((game.leaderboard ?? []).slice(0, 5), 'Topp 5')}</div>
    <div class="actions actions--wrap">
      <button class="btn btn--primary btn--lg" type="button" data-host-action="next">${last ? 'Visa resultat' : 'Nästa fråga'}</button>
    </div>`;
}

async function hostAction(action) {
  if (hostBusy) return;
  hostBusy = true;
  renderHost();
  try {
    applyGame(await apiRequest(gamePath(), {
      method: 'PATCH',
      headers: hostHeaders(),
      /* Frågan värden tittar på – servern avvisar om läget hunnit ändras */
      body: JSON.stringify({ action, currentIndex: game?.currentIndex }),
    }));
  } catch (error) {
    /* 409: någon annan flik (eller auto-reveal) hann före – hämta läget och fortsätt */
    if (error.status === 409) await fetchGame().catch(() => {});
    else {
      autoRevealPausedUntil = Date.now() + 3000;
      toast(error.message);
    }
  } finally {
    hostBusy = false;
    if (state.view === 'host' && state.gameId) {
      renderHost();
      startGamePolling(); // ny fas → ny takt
    }
  }
}

/* Frågan är klar när alla har svarat eller tiden (plus nätmarginalen) är ute.
   shortcut: logiken ligger hos värden – frågan står still om värdens flik stängs. */
function maybeAutoReveal() {
  if (!game || game.phase !== 'question' || hostBusy || Date.now() < autoRevealPausedUntil) return;
  const everyone = game.joined.length > 0 && game.answeredCount >= game.joined.length;
  const timeUp = game.questionEndsAt > 0 && serverNow() > game.questionEndsAt + ANSWER_GRACE_MS;
  if (everyone || timeUp) hostAction('reveal');
}

els.startQuiz.addEventListener('click', () => {
  if (!game?.joined?.length && !confirm('Ingen har gått med än. Starta ändå?')) return;
  hostAction('start');
});

els.hostStage.addEventListener('click', (e) => {
  const button = e.target.closest('[data-host-action]');
  if (button) hostAction(button.dataset.hostAction);
});

els.endGame.addEventListener('click', () => {
  if (!confirm('Avsluta spelet för alla och visa resultatet? Det går inte att ångra.')) return;
  hostAction('end');
});

els.hostNewGame.addEventListener('click', () => {
  leaveGame();
  show('editor');
});

/* ---------- Deltagare ---------- */

const me = () => game?.leaderboard?.find((row) => row.playerId === state.playerId);
const answeredOnServer = () => (game?.answeredIds ?? []).includes(state.playerId);

function renderPlayer() {
  if (!game) return;
  els.playerName.textContent = state.name || 'Deltagare';
  if (answering && answering.index !== game.currentIndex) answering = null;

  const sent = game.phase === 'question' && (Boolean(answering) || answeredOnServer());
  const key = `${game.phase}:${game.currentIndex}:${sent}:${answering?.failed ?? ''}`;
  if (renderedKey === key) return;
  renderedKey = key;
  els.playerStage.innerHTML = playerStageHtml(sent);
  document.title = `${game.phase === 'lobby' ? 'Väntar' : phaseTitle()} · Fredagsquiz`;
  if (game.phase === 'finished' && celebrated !== state.gameId) {
    celebrated = state.gameId;
    celebrate();
  }
}

function playerStageHtml(sent) {
  if (game.phase === 'lobby') {
    return `
      <h2 class="panel__title">Du är med!</h2>
      <p class="panel__lead">Väntar på att värden startar ${escapeHtml(game.title || 'quizet')} …</p>`;
  }

  if (game.phase === 'question') {
    const options = game.question?.options ?? [];
    const chosen = answering?.choice;
    const status = answering?.failed
      ? `<p class="live-tally">${escapeHtml(answering.failed)}</p>`
      : sent ? '<p class="live-tally">Svar inskickat &#10003;</p>' : '';
    return `
      ${questionHeadHtml()}
      <div class="live-answers">
        ${options.map((option, o) => `
        <button class="live-answer live-opt--${o}${chosen === o ? ' is-chosen' : ''}" type="button" data-choice="${o}" ${sent ? 'disabled' : ''}>
          <span class="live-option__letter">${LETTERS[o]}</span>${escapeHtml(option)}
        </button>`).join('')}
      </div>
      ${status}`;
  }

  const row = me();
  const standing = row
    ? `<p class="live-standing">${row.score} p &middot; plats ${row.rank} av ${game.leaderboard.length}</p>`
    : '';

  if (game.phase === 'reveal') {
    const result = game.lastResults?.[state.playerId];
    const correctText = escapeHtml(game.question?.options?.[game.correct] ?? '');
    const verdict = !result?.answered
      ? '<h2 class="panel__title live-verdict">Inget svar</h2>'
      : result.correct
        ? `<h2 class="panel__title live-verdict live-verdict--ok">Rätt! +${result.points}</h2>`
        : '<h2 class="panel__title live-verdict live-verdict--bad">Fel</h2>';
    return `
      <p class="panel__eyebrow">${escapeHtml(phaseTitle())}</p>
      ${verdict}
      <p class="panel__lead">Rätt svar: ${LETTERS[game.correct] ?? ''} &middot; ${correctText}</p>
      ${standing}`;
  }

  /* finished */
  return `
    <h2 class="panel__title">${row ? `Plats ${row.rank}!` : 'Quizet är slut'}</h2>
    ${standing}
    <div class="host-result">${renderLeaderboard(game.leaderboard)}</div>`;
}

els.playerStage.addEventListener('click', (e) => {
  const button = e.target.closest('[data-choice]');
  if (!button || game?.phase !== 'question' || answering || answeredOnServer()) return;
  sendAnswer(game.currentIndex, Number(button.dataset.choice));
});

/* Skickas om tills tiden är ute. 409 "Redan svarat" betyder att ett tidigare
   försök gick in – det räknas som lyckat. */
async function sendAnswer(index, choice) {
  answering = { index, choice };
  renderPlayer();

  while (answering?.index === index) {
    try {
      await apiRequest(gamePath('/answers'), {
        method: 'POST',
        body: JSON.stringify({ playerId: state.playerId, questionIndex: index, choice }),
      });
      return;
    } catch (error) {
      if (error.serverMessage === 'Redan svarat') return;
      const tooLate = error.status === 409
        || (game?.questionEndsAt && serverNow() > game.questionEndsAt + ANSWER_GRACE_MS);
      const permanent = Number.isInteger(error.status) && error.status < 500;
      if (tooLate || permanent) {
        if (answering?.index === index) {
          answering.failed = error.status === 409 ? 'Hann inte – frågan är stängd.' : `Svaret gick inte fram: ${error.message}`;
          renderPlayer();
        }
        return;
      }
      await new Promise((resolve) => { setTimeout(resolve, 1000); });
    }
  }
}

/* ---------- Topplista ---------- */

/* Raderna kommer färdigrankade från servern (1, 1, 3 vid delad plats). */
function renderLeaderboard(rows, heading = 'Topplista') {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return `<h3>${heading}</h3><p>Ingen har gått med i spelet.</p>`;

  const joined = game?.joined ?? [];
  const items = list.map((row) => `
        <li class="host-result__item host-result__item--${row.rank}${row.playerId === state.playerId ? ' live-me' : ''}">
          <span class="host-result__rank">${row.rank}</span>
          <span class="host-result__body">
            <span class="host-result__name"><span class="host-players__avatar magnet--${Math.max(0, joined.findIndex((p) => p.playerId === row.playerId)) % 6}" aria-hidden="true">${escapeHtml(row.name.charAt(0))}</span>${escapeHtml(row.name)}</span>
          </span>
          <strong class="host-result__score">${row.score}<span class="host-result__of">p</span></strong>
        </li>`).join('');

  return `
    <h3>${heading}</h3>
    <ol class="host-result__list">${items}
    </ol>`;
}

/* ---------- Hjälpare ---------- */

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
  const colors = ['#ffe45c', '#ffa3c6', '#93d4ff', '#b9ef9c', '#ffbd6b', '#cfbcff'];
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

/* QR-länk: ?kod=ABCDE → förifyll spelkoden. Ett pågående spel i samma
   webbläsare vinner bara om det är samma kod. */
const joinCode = codeFromUrl();
if (joinCode) {
  els.gameCode.value = joinCode;
  if (state.gameId !== joinCode) state.view = 'start';
  try {
    const clean = new URL(location.href);
    clean.searchParams.delete('kod');
    clean.searchParams.delete('code');
    history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
  } catch {
    /* history kan vara otillgängligt – spelkoden är ändå ifylld */
  }
}

show(state.view);
if (state.view === 'start' && joinCode) (state.name ? els.joinGame : els.name).focus();

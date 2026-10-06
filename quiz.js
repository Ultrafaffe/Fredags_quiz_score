/* =========================================================
   Fredagsquiz · Quiz
   Quizeditor och presentationsläge.

   Filen vet inget om appen i övrigt – den kopplas via Quiz.init(ctx)
   från app.js (state, save, toast, render osv.). Två funktioner är
   rena och kan används utan init: sanitizeQuiz() och parsePastedQuiz().

   Quizet lagras bara i värdens webbläsare och skickas aldrig till API:t.
   ========================================================= */

'use strict';

window.Quiz = (function () {
  /* Längdgränser – desamma i load(), inklistring och import */
  const MAX_QUESTION = 300;
  const MAX_OPTION = 120;
  const MAX_ANSWER = 120;
  const MAX_ELIM_QUESTION = 300;
  const MAX_ELIM_ANSWER = 120;

  const PHASES = ['questions', 'review-intro', 'review', 'done'];
  const FILE_NAME = 'fredagsquiz-quiz.json';

  const DEFAULT_LIMITS = {
    ANSWER_DESIGNS: ['letters', 'numbers', 'text'],
    MIN_COUNT: 1,
    MAX_COUNT: 100,
    MIN_ANSWER_COUNT: 1,
    MAX_ANSWER_COUNT: 10,
  };

  let ctx = null;
  let state = null;
  let limits = DEFAULT_LIMITS;
  let els = {};
  let wakeLock = null;
  let idleTimer = null;
  let parsedPaste = null;
  let storageOk = true;

  const $ = (sel) => document.querySelector(sel);

  function esc(value) {
    const str = String(value ?? '');
    if (ctx && ctx.escapeHtml) return ctx.escapeHtml(str);
    return str.replace(/[&<>"']/g, (ch) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  function asText(value, max) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, max);
  }

  const isFreeText = () => state.answerDesign === 'text';

  function labelFor(index) {
    if (state.answerDesign === 'numbers') return String(index + 1);
    return String.fromCharCode(65 + index);
  }

  function designName(design) {
    if (design === 'text') return 'fritext';
    if (design === 'numbers') return '1, 2, 3';
    return 'A, B, C';
  }

  /* ---------- Datamodell ---------- */

  function emptyQuestion() {
    if (isFreeText()) return { text: '', options: [], answerText: '' };
    const options = [];
    for (let i = 0; i < state.answerCount; i++) options.push('');
    return { text: '', options };
  }

  function questionAt(index) {
    const list = state.quiz && Array.isArray(state.quiz.questions) ? state.quiz.questions : [];
    const q = list[index];
    return q && typeof q === 'object' ? q : emptyQuestion();
  }

  function hasElimination() {
    return Boolean(state.eliminationQuestion);
  }

  /* Utslagssidan visas bara om frågan faktiskt är skriven */
  function showEliminationSlide() {
    if (!hasElimination() || !state.quiz || !state.quiz.elimination) return false;
    return Boolean(asText(state.quiz.elimination.text, MAX_ELIM_QUESTION));
  }

  const slides = () => state.count + (showEliminationSlide() ? 1 : 0);
  const editorPages = () => Math.max(1, state.count) + (hasElimination() ? 1 : 0);

  function hasContent() {
    const quiz = state.quiz;
    if (!quiz || !Array.isArray(quiz.questions)) return false;
    if (quiz.questions.some((q) => q && asText(q.text, MAX_QUESTION))) return true;
    if (quiz.elimination && (asText(quiz.elimination.text, MAX_ELIM_QUESTION)
      || asText(quiz.elimination.answer, MAX_ELIM_ANSWER))) return true;
    return false;
  }

  function ensureQuiz() {
    if (!state.quiz || typeof state.quiz !== 'object' || !Array.isArray(state.quiz.questions)) {
      state.quiz = { questions: [], elimination: { text: '', answer: '' } };
    }
    if (!state.quiz.elimination || typeof state.quiz.elimination !== 'object') {
      state.quiz.elimination = { text: '', answer: '' };
    }
    adapt({ notify: false, truncate: false });
    return state.quiz;
  }

  /* Sanerar ett quiz-objekt efter samma regler oavsett om det kommer från
     lagringen, en JSON-fil eller inklistring. Ren funktion – rör ingen DOM. */
  function sanitizeQuiz(raw, settings) {
    const opts = settings || {};
    const freeText = opts.answerDesign === 'text';
    const maxOptions = clampInt(
      opts.answerCount,
      DEFAULT_LIMITS.MIN_ANSWER_COUNT,
      DEFAULT_LIMITS.MAX_ANSWER_COUNT,
      DEFAULT_LIMITS.MAX_ANSWER_COUNT
    );
    const maxQuestions = DEFAULT_LIMITS.MAX_COUNT;

    if (!raw || typeof raw !== 'object') return null;
    if (!Array.isArray(raw.questions)) return null;

    const questions = [];
    for (const entry of raw.questions.slice(0, maxQuestions)) {
      const source = entry && typeof entry === 'object' ? entry : {};
      const text = asText(source.text, MAX_QUESTION);
      if (freeText) {
        questions.push({ text, options: [], answerText: asText(source.answerText, MAX_ANSWER) });
        continue;
      }
      const question = { text, options: [] };
      const rawOptions = Array.isArray(source.options) ? source.options : [];
      const total = Math.min(rawOptions.length, maxOptions);
      for (let i = 0; i < total; i++) {
        question.options.push(asText(rawOptions[i], MAX_OPTION));
      }
      const correct = source.correct;
      if (Number.isInteger(correct) && correct >= 0 && correct < question.options.length) {
        question.correct = correct;
      }
      questions.push(question);
    }

    const rawElim = raw.elimination && typeof raw.elimination === 'object' ? raw.elimination : {};
    return {
      questions,
      elimination: {
        text: asText(rawElim.text, MAX_ELIM_QUESTION),
        answer: asText(rawElim.answer, MAX_ELIM_ANSWER),
      },
    };
  }

  /* Anpassar quizet till aktuella inställningar: fyll på, och (vid ett
     fastställt värde) korta av. Vid byte till/från fritext nollställs
     alternativ och rätt svar. Returnerar true om något ändrades. */
  function adapt(options) {
    const opts = options || {};
    const notify = opts.notify === true;
    const truncate = opts.truncate !== false;
    if (!state || !state.quiz || typeof state.quiz !== 'object') return false;

    const quiz = state.quiz;
    if (!Array.isArray(quiz.questions)) quiz.questions = [];
    if (!quiz.elimination || typeof quiz.elimination !== 'object') {
      quiz.elimination = { text: '', answer: '' };
    }

    const before = JSON.stringify(quiz);
    let designReset = false;
    const freeText = isFreeText();

    quiz.questions = quiz.questions.map((entry) => {
      const source = entry && typeof entry === 'object' ? entry : {};
      const text = asText(source.text, MAX_QUESTION);
      if (freeText) {
        const hadOptions = (Array.isArray(source.options) && source.options.some((o) => asText(o, MAX_OPTION)))
          || Number.isInteger(source.correct);
        if (hadOptions) designReset = true;
        return { text, options: [], answerText: asText(source.answerText, MAX_ANSWER) };
      }
      const hadAnswer = Boolean(asText(source.answerText, MAX_ANSWER));
      if (hadAnswer) designReset = true;
      const question = { text, options: [] };
      const rawOptions = Array.isArray(source.options) ? source.options : [];
      for (let i = 0; i < state.answerCount; i++) {
        question.options.push(asText(rawOptions[i], MAX_OPTION));
      }
      const correct = source.correct;
      if (Number.isInteger(correct) && correct >= 0 && correct < state.answerCount) {
        question.correct = correct;
      }
      return question;
    });

    if (truncate) {
      while (quiz.questions.length > state.count) quiz.questions.pop();
    }
    while (quiz.questions.length < state.count) quiz.questions.push(emptyQuestion());

    for (const question of quiz.questions) {
      if (freeText) continue;
      if (!Array.isArray(question.options)) question.options = [];
      if (truncate) {
        while (question.options.length > state.answerCount) question.options.pop();
      }
      while (question.options.length < state.answerCount) question.options.push('');
      if (Number.isInteger(question.correct) && question.correct >= question.options.length) {
        delete question.correct;
      }
    }

    const changed = JSON.stringify(quiz) !== before;
    if (changed && notify && ctx && ctx.toast) {
      ctx.toast(designReset
        ? (freeText
          ? 'Fritextläge: svarsalternativ och rätt svar har rensats i quizet.'
          : 'Alternativläge: rätta svaren har rensats – fyll i dem igen.')
        : (freeText
          ? `Quizet justerades till ${state.count} frågor.`
          : `Quizet justerades till ${state.count} frågor med ${state.answerCount} svarsalternativ.`));
    }
    return changed;
  }

  /* ---------- Statusrad i "Skapa nytt spel" ---------- */

  function isComplete(question) {
    if (!question || !asText(question.text, MAX_QUESTION)) return false;
    if (isFreeText()) return Boolean(asText(question.answerText, MAX_ANSWER));
    const options = Array.isArray(question.options) ? question.options : [];
    if (options.length < state.answerCount) return false;
    if (options.some((option) => !asText(option, MAX_OPTION))) return false;
    return Number.isInteger(question.correct) && question.correct >= 0 && question.correct < options.length;
  }

  function eliminationComplete() {
    if (!state.quiz || !state.quiz.elimination) return false;
    return Boolean(asText(state.quiz.elimination.text, MAX_ELIM_QUESTION)
      && asText(state.quiz.elimination.answer, MAX_ELIM_ANSWER));
  }

  function filledCount() {
    if (!state.quiz || !Array.isArray(state.quiz.questions)) return 0;
    let total = 0;
    for (let i = 0; i < state.count; i++) {
      if (isComplete(questionAt(i))) total++;
    }
    if (hasElimination() && eliminationComplete()) total++;
    return total;
  }

  function syncSetupStatus() {
    if (!els.status) return;
    if (!state.quiz || !hasContent()) {
      els.status.textContent = '';
      return;
    }
    const pages = state.count + (hasElimination() ? 1 : 0);
    const done = filledCount();
    els.status.textContent = done >= pages
      ? `Quiz klart: ${state.count} frågor`
      : `Quizutkast: ${done} av ${pages} ifyllda`;
  }
  /* ---------- Editor ---------- */

  function renderEditor() {
    if (!state.quiz) return;
    adapt({ notify: false, truncate: false });

    const total = state.count;
    const pages = editorPages();
    state.editorIndex = clampInt(state.editorIndex, 0, pages - 1, 0);
    const eliminationPage = hasElimination() && state.editorIndex >= total;

    els.step.textContent = eliminationPage
      ? 'Utslagsfråga'
      : `Fråga ${state.editorIndex + 1} av ${total}`;

    const pct = Math.round(((state.editorIndex + 1) / pages) * 100);
    els.bar.style.width = `${pct}%`;
    els.progress.setAttribute('aria-valuenow', String(pct));

    renderChips(eliminationPage);
    els.body.innerHTML = eliminationPage ? eliminationHtml() : questionHtml(state.editorIndex);

    els.prev.disabled = state.editorIndex === 0;
    els.next.textContent = state.editorIndex >= pages - 1 ? 'Klar' : 'Nästa fråga';

    syncSetupStatus();
    if (ctx.save) ctx.save();
  }

  function renderChips(eliminationPage) {
    const html = [];
    for (let i = 0; i < state.count; i++) {
      const complete = isComplete(questionAt(i));
      html.push(`
        <button class="chip${complete ? '' : ' chip--empty'}" type="button" data-page="${i}"
                aria-pressed="${i === state.editorIndex}">${i + 1}</button>`);
    }
    if (hasElimination()) {
      const complete = eliminationComplete();
      html.push(`
        <button class="chip${complete ? '' : ' chip--empty'}" type="button" data-page="${state.count}"
                aria-pressed="${eliminationPage}" aria-label="Utslagsfrågan">Utslag</button>`);
    }
    els.chips.innerHTML = html.join('');
  }

  function refreshChip(page) {
    const chip = els.chips.querySelector(`[data-page="${page}"]`);
    if (!chip) return;
    const complete = page >= state.count ? eliminationComplete() : isComplete(questionAt(page));
    chip.classList.toggle('chip--empty', !complete);
  }

  function questionHtml(index) {
    const question = questionAt(index);
    const number = index + 1;
    const text = String(question.text || '');

    let html = `
      <div class="ed-field">
        <label class="field__label" for="ed-text">Fr&aring;ga ${number}</label>
        <textarea class="input ed-field__area" id="ed-text" data-field="text" rows="3"
                  maxlength="${MAX_QUESTION}" placeholder="Skriv fr&aring;gan">${esc(text)}</textarea>
        <p class="field__hint"><span id="ed-text-count">${text.length}</span>/${MAX_QUESTION} tecken</p>
      </div>`;

    if (isFreeText()) {
      html += `
      <div class="ed-field">
        <label class="field__label" for="ed-answer">R&auml;tt svar</label>
        <input class="input" id="ed-answer" data-field="answer" type="text" maxlength="${MAX_ANSWER}"
               value="${esc(question.answerText || '')}" placeholder="R&auml;tt svar p&aring; fr&aring;ga ${number}"
               autocomplete="off" spellcheck="false">
        <p class="field__hint">Fritextl&auml;ge – deltagarna skriver svaret sj&auml;lva.</p>
      </div>`;
      return html;
    }

    const rows = [];
    for (let i = 0; i < state.answerCount; i++) {
      const value = question.options && typeof question.options[i] === 'string'
        ? question.options[i]
        : '';
      const checked = question.correct === i;
      const label = labelFor(i);
      rows.push(`
        <div class="ed-opt${checked ? ' is-correct' : ''}" data-row="${i}">
          <span class="ed-opt__key" aria-hidden="true">${label}<span class="ed-opt__tick">&#10003;</span></span>
          <input class="input ed-opt__text" data-field="option" data-option="${i}" type="text"
                 maxlength="${MAX_OPTION}" value="${esc(value)}"
                 placeholder="Svarsalternativ ${label}" autocomplete="off" spellcheck="false"
                 aria-label="Svarsalternativ ${label} p&aring; fr&aring;ga ${number}">
          <label class="ed-opt__pick">
            <input type="radio" name="ed-correct" data-field="correct" value="${i}" ${checked ? 'checked' : ''}
                   aria-label="${label} &auml;r r&auml;tt svar p&aring; fr&aring;ga ${number}">
            <span class="ed-opt__radio" aria-hidden="true">&#10003;</span>
            <span class="ed-opt__picktext">R&auml;tt svar</span>
          </label>
        </div>`);
    }

    html += `<div class="ed-opts" role="group" aria-labelledby="ed-opts-label"><span class="field__label" id="ed-opts-label">Svarsalternativ &ndash; markera r&auml;tt svar</span>${rows.join('')}</div>`;
    return html;
  }

  function eliminationHtml() {
    const elimination = state.quiz.elimination;
    return `
      <div class="ed-field">
        <label class="field__label" for="ed-el-text">Utslagsfr&aring;ga</label>
        <textarea class="input ed-field__area" id="ed-el-text" data-field="elim-text" rows="3"
                  maxlength="${MAX_ELIM_QUESTION}" placeholder="Skriv utslagsfr&aring;gan">${esc(elimination.text)}</textarea>
        <p class="field__hint">Visas som en sista sida efter de vanliga fr&aring;gorna.</p>
      </div>
      <div class="ed-field">
        <label class="field__label" for="ed-el-answer">R&auml;tt svar</label>
        <input class="input" id="ed-el-answer" data-field="elim-answer" type="text" maxlength="${MAX_ELIM_ANSWER}"
               value="${esc(elimination.answer)}" placeholder="R&auml;tt svar p&aring; utslagsfr&aring;gan"
               autocomplete="off" spellcheck="false">
      </div>`;
  }

  function goToPage(page) {
    const pages = editorPages();
    state.editorIndex = clampInt(page, 0, pages - 1, 0);
    renderEditor();
  }

  function openEditor() {
    ensureQuiz();
    state.view = 'editor';
    hideIssues();
    setIo('');
    checkStorage();
    if (ctx.save) ctx.save();
    if (ctx.render) ctx.render();
    if (ctx.scrollToTop) ctx.scrollToTop();
    const area = els.body.querySelector('[data-field="text"]');
    if (area) area.focus();
  }

  function closeEditor() {
    hideIssues();
    if (!hasContent()) {
      state.quiz = null;
      state.present = { index: 0, phase: 'questions' };
      if (ctx.toast) ctx.toast('Quizet var tomt – inget quiz sparades');
    }
    state.view = 'setup';
    if (ctx.save) ctx.save();
    if (ctx.render) ctx.render();
    if (ctx.scrollToTop) ctx.scrollToTop();
  }

  /* ---------- Validering ---------- */

  function validate() {
    const issues = [];
    for (let i = 0; i < state.count; i++) {
      const question = questionAt(i);
      const label = `Fråga ${i + 1}`;
      if (!asText(question.text, MAX_QUESTION)) {
        issues.push({ page: i, message: `${label} saknar frågetext` });
      }
      if (isFreeText()) {
        if (!asText(question.answerText, MAX_ANSWER)) {
          issues.push({ page: i, message: `${label} saknar rätt svar` });
        }
        continue;
      }
      if (!Number.isInteger(question.correct) || question.correct < 0
        || question.correct >= state.answerCount) {
        issues.push({ page: i, message: `${label} saknar rätt svar` });
      }
      const options = Array.isArray(question.options) ? question.options : [];
      for (let oi = 0; oi < state.answerCount; oi++) {
        if (!asText(options[oi], MAX_OPTION)) {
          issues.push({ page: i, message: `${label}: svarsalternativ ${labelFor(oi)} saknar text` });
        }
      }
    }
    if (hasElimination()) {
      const elimination = state.quiz.elimination;
      if (!asText(elimination.text, MAX_ELIM_QUESTION)) {
        issues.push({ page: state.count, message: 'Utslagsfrågan saknar frågetext' });
      } else if (!asText(elimination.answer, MAX_ELIM_ANSWER)) {
        issues.push({ page: state.count, message: 'Utslagsfrågan saknar rätt svar' });
      }
    }
    return issues;
  }

  function showIssues(issues) {
    els.issuesText.textContent = issues.length === 1
      ? '1 fråga är ofullständig – gå till den eller spara ändå:'
      : `${issues.length} frågor är ofullständiga – gå till dem eller spara ändå:`;
    els.issuesList.innerHTML = issues.map((issue) => `
      <li class="editor__issue">
        <span>${esc(issue.message)}</span>
        <button class="btn btn--ghost btn--sm" type="button" data-jump="${issue.page}">G&aring; till</button>
      </li>`).join('');
    els.issues.hidden = false;
    const first = els.issuesList.querySelector('[data-jump]');
    if (first) first.focus();
  }

  function hideIssues() {
    if (els.issues) els.issues.hidden = true;
  }

  /* ---------- Inmatning i editorn ---------- */

  function currentQuestion() {
    return state.editorIndex >= state.count ? null : questionAt(state.editorIndex);
  }

  function onEditorInput(event) {
    const field = event.target.dataset ? event.target.dataset.field : null;
    if (!field) return;
    const value = event.target.value;

    if (field === 'elim-text' || field === 'elim-answer') {
      if (!state.quiz.elimination) state.quiz.elimination = { text: '', answer: '' };
      if (field === 'elim-text') {
        state.quiz.elimination.text = value.slice(0, MAX_ELIM_QUESTION);
      } else {
        state.quiz.elimination.answer = value.slice(0, MAX_ELIM_ANSWER);
      }
    } else {
      const question = currentQuestion();
      if (!question) return;
      if (field === 'text') {
        question.text = value.slice(0, MAX_QUESTION);
        const counter = els.body.querySelector('#ed-text-count');
        if (counter) counter.textContent = String(value.length);
      } else if (field === 'answer') {
        question.answerText = value.slice(0, MAX_ANSWER);
      } else if (field === 'option') {
        if (!Array.isArray(question.options)) question.options = [];
        while (question.options.length < state.answerCount) question.options.push('');
        const index = Number(event.target.dataset.option);
        if (Number.isInteger(index) && index >= 0 && index < question.options.length) {
          question.options[index] = value.slice(0, MAX_OPTION);
        }
      } else {
        return;
      }
    }

    hideIssues();
    const stored = ctx.save ? ctx.save() : true;
    if (!stored) showStorageWarning();
    refreshChip(state.editorIndex);
    syncSetupStatus();
  }

  function onEditorChange(event) {
    if (!event.target.dataset || event.target.dataset.field !== 'correct') return;
    const question = currentQuestion();
    if (!question) return;
    const index = Number(event.target.value);
    if (Number.isInteger(index) && index >= 0 && index < state.answerCount) {
      question.correct = index;
    } else {
      delete question.correct;
    }
    for (const row of els.body.querySelectorAll('.ed-opt')) {
      row.classList.toggle('is-correct', Number(row.dataset.row) === question.correct);
    }
    hideIssues();
    if (ctx.save) ctx.save();
    refreshChip(state.editorIndex);
    syncSetupStatus();
  }

  /* Enter i ett alternativfält går till nästa fält – inte till nästa fråga */
  function onEditorKeydown(event) {
    if (event.key !== 'Enter' || event.target.tagName === 'TEXTAREA') return;
    const field = event.target.dataset ? event.target.dataset.field : null;
    if (field !== 'option' && field !== 'answer' && field !== 'elim-answer') return;
    event.preventDefault();
    const fields = [...els.body.querySelectorAll(
      'input[data-field="option"], input[data-field="answer"], input[data-field="elim-answer"]'
    )];
    const position = fields.indexOf(event.target);
    if (position >= 0 && position < fields.length - 1) fields[position + 1].focus();
  }

  function showStorageWarning() {
    storageOk = false;
    if (els.storage) els.storage.hidden = false;
  }

  function checkStorage() {
    storageOk = true;
    try {
      localStorage.setItem('quiz.probe.v1', '1');
      localStorage.removeItem('quiz.probe.v1');
    } catch {
      storageOk = false;
    }
    if (els.storage) els.storage.hidden = storageOk;
    return storageOk;
  }

  /* ---------- Klistra in ---------- */

  function stripLabel(line) {
    const match = line.match(/^([A-Za-z]|\d{1,2})[).:]\s*/);
    return match ? line.slice(match[0].length) : line;
  }

  /* Parser för inklistrat quiz. Ren funktion: ingen DOM, inget state.
     Returnerar { quiz, warnings } – varningar pekar ut radnummer. */
  function parsePastedQuiz(text, settings) {
    const opts = settings || {};
    const freeText = opts.answerDesign === 'text';
    const eliminationEnabled = opts.eliminationQuestion !== false;
    const warnings = [];
    const warn = (line, message) => warnings.push({ line: Number(line) || 0, message });
    const maxQuestions = DEFAULT_LIMITS.MAX_COUNT;
    const maxOptions = DEFAULT_LIMITS.MAX_ANSWER_COUNT;

    const rows = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let block = null;
    rows.forEach((row, index) => {
      if (!row.trim()) {
        block = null;
        return;
      }
      if (!block) {
        block = { start: index + 1, rows: [] };
        blocks.push(block);
      }
      block.rows.push({ line: index + 1, text: row.trim() });
    });

    const questions = [];
    let elimination = { text: '', answer: '' };

    for (const entry of blocks) {
      const head = entry.rows[0];

      if (questions.length >= maxQuestions) {
        warn(entry.start, `Högst ${maxQuestions} frågor – resten ignoreras.`);
        break;
      }

      /* Utslagsfråga: "Utslag: ..." följt av en "Svar:"-rad */
      if (/^utslag\s*:/i.test(head.text)) {
        if (!eliminationEnabled) {
          warn(head.line, 'Utslagsfrågan är avstängd i inställningarna – blocket ignoreras.');
          continue;
        }
        if (elimination.text || elimination.answer) {
          warn(head.line, 'Utslagsfrågan finns redan – det andra blocket ignoreras.');
          continue;
        }
        let questionText = head.text.replace(/^utslag\s*:\s*/i, '').trim();
        let answer = '';
        for (const row of entry.rows.slice(1)) {
          const match = row.text.match(/^svar\s*:\s*(.*)$/i);
          if (match) {
            answer = match[1].trim().slice(0, MAX_ELIM_ANSWER);
            continue;
          }
          if (!questionText) {
            questionText = row.text;
            continue;
          }
          warn(row.line, 'Raden kan inte tolkas i utslagsfrågan och ignoreras.');
        }
        if (!questionText) warn(head.line, 'Utslagsfrågan saknar frågetext.');
        if (!answer) warn(head.line, 'Utslagsfrågan saknar en rad som börjar med "Svar:".');
        elimination = { text: questionText.slice(0, MAX_ELIM_QUESTION), answer };
        continue;
      }

      if (freeText) {
        const question = { text: head.text.slice(0, MAX_QUESTION), options: [], answerText: '' };
        for (const row of entry.rows.slice(1)) {
          const match = row.text.match(/^svar\s*:\s*(.*)$/i);
          if (match) {
            if (question.answerText) {
              warn(row.line, 'Extra "Svar:"-rad – den första används.');
              continue;
            }
            question.answerText = match[1].trim().slice(0, MAX_ANSWER);
            continue;
          }
          warn(row.line, 'Raden kan inte tolkas i fritextläge (saknar "Svar:") och ignoreras.');
        }
        if (!question.answerText) {
          warn(head.line, 'Frågan saknar rätt svar – skriv en rad som börjar med "Svar:".');
        }
        questions.push(question);
        continue;
      }

      const question = { text: head.text.slice(0, MAX_QUESTION), options: [] };
      let correct = null;
      for (const row of entry.rows.slice(1)) {
        let line = row.text;
        let star = false;
        if (/^\*/.test(line)) {
          star = true;
          line = line.replace(/^\*\s*/, '');
        }
        line = stripLabel(line);
        if (/\*\s*$/.test(line)) {
          star = true;
          line = line.replace(/\s*\*$/, '').trim();
        }
        if (/^svar\s*:/i.test(line)) {
          warn(row.line, '"Svar:"-rader används bara i fritextläge – raden ignoreras.');
          continue;
        }
        if (question.options.length >= maxOptions) {
          warn(row.line, `Högst ${maxOptions} svarsalternativ – raden ignoreras.`);
          continue;
        }
        if (star) correct = question.options.length;
        question.options.push(line.slice(0, MAX_OPTION));
      }
      if (question.options.length === 0) {
        warn(head.line, 'Frågan har inga svarsalternativ.');
      }
      if (correct !== null) question.correct = correct;
      else warn(head.line, 'Frågan saknar rätt svar – markera det med "*".');
      questions.push(question);
    }

    if (!freeText && questions.length > 0 && questions.every((q) => q.options.length === 0)) {
      warn(0, 'Inga svarsalternativ hittades. Om du klistrade in "Svar:"-rader måste svarsdesignen vara fritext.');
    }
    if (eliminationEnabled && !elimination.text && !elimination.answer) {
      warn(0, 'Ingen utslagsfråga hittades – lägg till ett block som börjar med "Utslag:".');
    }

    return { quiz: { questions, elimination }, warnings };
  }

  function openPasteDialog() {
    els.pasteText.value = '';
    resetPastePreview();
    if (typeof els.dialog.showModal === 'function') els.dialog.showModal();
    else els.dialog.setAttribute('open', '');
    els.pasteText.focus();
  }

  function closePasteDialog() {
    if (typeof els.dialog.close === 'function') els.dialog.close();
    else els.dialog.removeAttribute('open');
  }

  function resetPastePreview() {
    parsedPaste = null;
    els.pastePreview.hidden = true;
    els.pastePreview.innerHTML = '';
    els.pasteUse.disabled = true;
  }

  function pasteSettings() {
    return {
      answerDesign: state.answerDesign,
      answerCount: state.answerCount,
      eliminationQuestion: state.eliminationQuestion,
    };
  }

  function previewPaste() {
    const settings = pasteSettings();
    const result = parsePastedQuiz(els.pasteText.value, settings);
    parsedPaste = { result, settings };
    renderPastePreview(result, settings);
    els.pasteUse.disabled = result.quiz.questions.length === 0;
  }

  function renderPastePreview(result, settings) {
    const questions = result.quiz.questions;
    const freeText = settings.answerDesign === 'text';

    if (questions.length === 0) {
      els.pastePreview.innerHTML = '<p class="dialog__summary">Inga frågor hittades – kontrollera formatet.</p>';
      els.pastePreview.hidden = false;
      return;
    }

    const missing = questions.filter((q) => (
      freeText ? !asText(q.answerText, MAX_ANSWER) : !Number.isInteger(q.correct)
    )).length;
    const counts = questions.map((q) => (Array.isArray(q.options) ? q.options.length : 0));
    const most = counts.reduce((a, b) => Math.max(a, b), 0);
    const fewer = counts.filter((n) => n < most).length;

    const parts = [`${questions.length} frågor`];
    if (missing > 0) parts.push(`${missing} saknar rätt svar`);
    if (fewer > 0) parts.push(`${fewer} har färre alternativ än övriga`);

    const warnings = result.warnings.map((w) => `
      <li>${w.line ? `<strong>Rad ${w.line}:</strong> ` : ''}${esc(w.message)}</li>`).join('');

    els.pastePreview.innerHTML = `
      <p class="dialog__summary">${esc(parts.join(', '))}.</p>
      ${result.warnings.length
        ? `<ul class="dialog__warnings">${warnings}</ul>`
        : '<p class="dialog__ok">Allt tolkades – inga varningar.</p>'}`;
    els.pastePreview.hidden = false;
  }

  function usePastedQuiz() {
    if (!parsedPaste || !parsedPaste.result) return;
    const { result, settings } = parsedPaste;
    if (result.quiz.questions.length === 0) return;
    if (hasContent() && !confirm('Quizet har redan innehåll. Ersätta det med det inklistrade?')) return;

    const answerCount = settings.answerDesign === 'text'
      ? state.answerCount
      : result.quiz.questions.reduce((max, q) => Math.max(max, (q.options || []).length), 0);

    applyExternalQuiz(result.quiz, {
      count: result.quiz.questions.length,
      answerCount,
      answerDesign: settings.answerDesign,
    });
    closePasteDialog();
  }

  /* ---------- Export och import ---------- */

  function exportQuiz() {
    if (!state.quiz || !hasContent()) {
      setIoError('Det finns inget quiz att exportera.');
      return;
    }
    try {
      const payload = {
        version: 1,
        answerDesign: state.answerDesign,
        answerCount: state.answerCount,
        questions: state.quiz.questions,
        elimination: state.quiz.elimination,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = FILE_NAME;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setIo(`Exporterat till ${FILE_NAME}. Filen innehåller rätt svar – dela den inte med deltagarna.`);
    } catch {
      setIoError('Kunde inte exportera quizet i den här webbläsaren.');
    }
  }

  function importFile(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setIoError('Filen är för stor (max 5 MB) – inget importerades.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setIoError('Filen kunde inte läsas – inget importerades.');
    reader.onload = () => importQuizText(String(reader.result ?? ''));
    reader.readAsText(file);
  }

  function importQuizText(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      setIoError('Filen är inte giltig JSON – inget importerades.');
      return;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      setIoError('Filen har oväntat format – inget importerades.');
      return;
    }
    if (data.version !== undefined && data.version !== 1) {
      setIoError(`Okänd filversion (${esc(data.version)}) – inget importerades.`);
      return;
    }
    if (!Array.isArray(data.questions)) {
      setIoError('Filen saknar en frågelista ("questions") – inget importerades.');
      return;
    }

    const valid = data.questions.filter((q) => q && typeof q === 'object');
    const skipped = data.questions.length - valid.length;
    if (valid.length === 0) {
      setIoError('Filen innehåller inga frågor – inget importerades.');
      return;
    }

    const design = limits.ANSWER_DESIGNS.includes(data.answerDesign)
      ? data.answerDesign
      : state.answerDesign;
    let answerCount = state.answerCount;
    if (design !== 'text') {
      if (data.answerCount !== undefined && Number.isFinite(Number(data.answerCount))) {
        answerCount = ctx.clampAnswerCount(Number(data.answerCount));
      } else {
        const most = valid.reduce((max, q) => Math.max(max, Array.isArray(q.options) ? q.options.length : 0), 0);
        if (most > 0) answerCount = ctx.clampAnswerCount(most);
      }
    }

    applyExternalQuiz({ questions: valid, elimination: data.elimination }, {
      count: valid.length,
      answerCount,
      answerDesign: design,
    });

    const notes = [];
    if (skipped > 0) notes.push(`${skipped} poster var inte frågor och hoppades över`);
    if (questionsNeedSanitizing(valid, design, answerCount)) notes.push('längder och ogiltiga värden sanerades');
    setIo(`Importerade ${Math.min(valid.length, ctx.clampCount(valid.length))} frågor från filen`
      + `${notes.length ? ` (${notes.join(', ')})` : ''}.`);
  }

  /* Kontrollerar om filen innehåller värden som saneringen måste rätta till */
  function questionsNeedSanitizing(questions, design, answerCount) {
    return questions.some((question) => {
      if (typeof question.text !== 'string' || question.text.trim().length > MAX_QUESTION) return true;
      if (design === 'text') {
        return typeof question.answerText !== 'string'
          || (typeof question.answerText === 'string' && question.answerText.length > MAX_ANSWER);
      }
      const options = Array.isArray(question.options) ? question.options : [];
      if (options.length > answerCount) return true;
      if (options.some((o) => typeof o !== 'string' || o.length > MAX_OPTION)) return true;
      return !(Number.isInteger(question.correct) && question.correct >= 0 && question.correct < options.length)
        && question.correct !== undefined;
    });
  }

  /* Delas av inklistring och import: justerar inställningarna till det
     som hittades och lägger in det sanerade quizet. */
  function applyExternalQuiz(rawQuiz, options) {
    const nextDesign = limits.ANSWER_DESIGNS.includes(options.answerDesign)
      ? options.answerDesign
      : state.answerDesign;
    const nextCount = ctx.clampCount(options.count);
    const nextAnswerCount = nextDesign === 'text'
      ? state.answerCount
      : ctx.clampAnswerCount(options.answerCount || state.answerCount);

    const changes = [];
    if (nextCount !== state.count) changes.push(`${nextCount} frågor`);
    if (nextDesign !== state.answerDesign) changes.push(`svarsdesign ${designName(nextDesign)}`);
    else if (nextDesign !== 'text' && nextAnswerCount !== state.answerCount) {
      changes.push(`${nextAnswerCount} svarsalternativ`);
    }

    const designChanged = nextDesign !== state.answerDesign;
    const optionsChanged = nextAnswerCount !== state.answerCount;
    state.answerDesign = nextDesign;
    state.count = nextCount;
    state.answerCount = nextAnswerCount;
    if ((designChanged || optionsChanged) && ctx.resetAnswers) ctx.resetAnswers();

    state.quiz = sanitizeQuiz(rawQuiz, {
      count: state.count,
      answerCount: state.answerCount,
      answerDesign: state.answerDesign,
    });
    ensureQuiz();
    state.editorIndex = clampInt(state.editorIndex, 0, editorPages() - 1, 0);
    state.present = { index: 0, phase: 'questions' };

    if (ctx.save) ctx.save();
    if (ctx.toast && changes.length) ctx.toast(`Inställningarna justerades: ${changes.join(', ')}`);
    if (state.view === 'editor') renderEditor();
    syncSetupStatus();
  }

  function setIo(message) {
    if (!els.io) return;
    els.io.textContent = message;
    els.io.classList.remove('is-error');
  }

  function setIoError(message) {
    if (!els.io) return;
    els.io.textContent = message;
    els.io.classList.add('is-error');
  }

  /* ---------- Presentationsläge ---------- */

  function answerBlock(answer) {
    return `
      <p class="present__answer">
        <span class="present__answer-label">R&auml;tt svar</span>
        <strong class="present__answer-text">${esc(asText(answer, MAX_ANSWER) || '–')}</strong>
      </p>`;
  }

  function slideHtml(review) {
    const index = state.present.index;
    const eliminationSlide = showEliminationSlide() && index >= state.count;

    if (eliminationSlide) {
      const elimination = state.quiz.elimination;
      return `
        <p class="present__kind">Utslagsfr&aring;gan</p>
        <h2 class="present__q" id="present-question" tabindex="-1">${esc(elimination.text)}</h2>
        ${review ? answerBlock(elimination.answer) : ''}`;
    }

    const question = questionAt(index);
    const heading = asText(question.text, MAX_QUESTION)
      ? esc(question.text)
      : `<span class="present__q-missing">Fråga ${index + 1} saknar text</span>`;

    let html = `<h2 class="present__q" id="present-question" tabindex="-1">${heading}</h2>`;

    if (isFreeText()) {
      if (review) html += answerBlock(question.answerText);
      return html;
    }

    const options = Array.isArray(question.options) ? question.options : [];
    const total = Math.max(options.length, state.answerCount);
    const columns = total > 3 ? 2 : 1;
    const hasCorrect = Number.isInteger(question.correct) && question.correct >= 0 && question.correct < total;

    html += `<ol class="present__opts${columns === 2 ? ' present__opts--2' : ''}">`;
    for (let i = 0; i < total; i++) {
      const correct = review && hasCorrect && question.correct === i;
      const dimmed = review && hasCorrect && question.correct !== i;
      const value = asText(options[i], MAX_OPTION) || '–';
      html += `
        <li class="present__opt${correct ? ' is-correct' : ''}${dimmed ? ' is-dim' : ''}">
          <span class="present__opt-key">${labelFor(i)}</span>
          <span class="present__opt-text">${esc(value)}</span>
          ${correct ? '<span class="present__opt-tick" aria-hidden="true">&#10003;</span>' : ''}
        </li>`;
    }
    html += '</ol>';
    return html;
  }

  function renderPresent() {
    if (!state.quiz) {
      exitPresent();
      return;
    }
    const total = slides();
    const present = state.present;
    if (!PHASES.includes(present.phase)) present.phase = 'questions';
    present.index = clampInt(present.index, 0, Math.max(0, total - 1), 0);

    els.code.textContent = state.gameCode || '-----';

    let stage = '';
    if (present.phase === 'questions' || present.phase === 'review') {
      stage = slideHtml(present.phase === 'review');
    } else if (present.phase === 'review-intro') {
      stage = `
        <h2 class="present__q present__q--center" id="present-question" tabindex="-1">Alla fr&aring;gor &auml;r visade</h2>
        <p class="present__lead">G&aring; igenom en gång till med r&auml;tt svar, eller avsluta visningen.</p>
        <div class="present__actions">
          <button class="btn btn--primary btn--lg" type="button" data-present-action="review">G&aring; igenom med facit</button>
          <button class="btn btn--ghost btn--lg" type="button" data-present-action="exit">Avsluta</button>
        </div>`;
    } else {
      stage = `
        <h2 class="present__q present__q--center" id="present-question" tabindex="-1">Quizet &auml;r slut</h2>
        <div class="present__actions">
          <button class="btn btn--primary btn--lg" type="button" data-present-action="exit">Tillbaka till v&auml;rdvyn</button>
        </div>`;
    }

    els.stage.innerHTML = stage;

    const onQuestions = present.phase === 'questions' || present.phase === 'review';
    els.counter.hidden = !onQuestions;
    els.counter.textContent = `${present.index + 1} / ${total}`;
    els.pPrev.disabled = present.phase === 'questions' && present.index === 0;
    els.pNext.textContent = present.phase === 'review-intro' ? 'Med facit' : 'Nästa';

    const heading = document.getElementById('present-question');
    if (heading && typeof heading.focus === 'function') heading.focus();

    pokeControls();
    acquireWakeLock();
    if (ctx.save) ctx.save();
  }

  function nextSlide() {
    const present = state.present;
    const last = slides() - 1;
    if (present.phase === 'questions') {
      if (present.index < last) present.index++;
      else present.phase = 'review-intro';
    } else if (present.phase === 'review-intro') {
      present.phase = 'review';
      present.index = 0;
    } else if (present.phase === 'review') {
      if (present.index < last) present.index++;
      else present.phase = 'done';
    } else {
      return;
    }
    renderPresent();
  }

  function prevSlide() {
    const present = state.present;
    if (present.phase === 'review') {
      if (present.index > 0) present.index--;
      else present.phase = 'review-intro';
    } else if (present.phase === 'review-intro') {
      present.phase = 'questions';
      present.index = slides() - 1;
    } else if (present.phase === 'done') {
      present.phase = 'review';
      present.index = slides() - 1;
    } else if (present.index > 0) {
      present.index--;
    } else {
      return;
    }
    renderPresent();
  }

  function openPresent() {
    if (!state.quiz) return;
    state.present = { index: 0, phase: 'questions' };
    state.view = 'present';
    if (ctx.save) ctx.save();
    if (ctx.render) ctx.render();
  }

  function exitPresent() {
    releaseWakeLock();
    clearTimeout(idleTimer);
    if (els.controls) els.controls.classList.remove('is-idle');
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      try { document.exitFullscreen(); } catch { /* ignoreras */ }
    }
    state.present = { index: 0, phase: 'questions' };
    state.view = state.gameId ? 'host' : 'setup';
    if (ctx.save) ctx.save();
    if (ctx.render) ctx.render();
    if (ctx.scrollToTop) ctx.scrollToTop();
  }

  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        if (typeof document.exitFullscreen === 'function') document.exitFullscreen();
      } else if (typeof document.documentElement.requestFullscreen === 'function') {
        document.documentElement.requestFullscreen();
      }
    } catch {
      /* helskärm stöds inte – ignoreras */
    }
  }

  function pokeControls() {
    if (!els.controls) return;
    els.controls.classList.remove('is-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (state.view === 'present') els.controls.classList.add('is-idle');
    }, 3000);
  }

  async function acquireWakeLock() {
    try {
      if (!wakeLock && navigator.wakeLock && state.view === 'present') {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch {
      wakeLock = null; /* stöds inte / avvisat – ignoreras */
    }
  }

  function releaseWakeLock() {
    try {
      if (wakeLock && typeof wakeLock.release === 'function') wakeLock.release();
    } catch {
      /* ignoreras */
    }
    wakeLock = null;
  }

  /* ---------- Händelser ---------- */

  function bindEvents() {
    els.chips.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-page]');
      if (!chip) return;
      hideIssues();
      goToPage(Number(chip.dataset.page));
    });

    els.body.addEventListener('input', onEditorInput);
    els.body.addEventListener('change', onEditorChange);
    els.body.addEventListener('keydown', onEditorKeydown);

    els.prev.addEventListener('click', () => {
      hideIssues();
      goToPage(state.editorIndex - 1);
    });

    els.next.addEventListener('click', () => {
      hideIssues();
      if (state.editorIndex >= editorPages() - 1) {
        const issues = validate();
        if (issues.length) {
          showIssues(issues);
          return;
        }
        closeEditor();
        return;
      }
      goToPage(state.editorIndex + 1);
    });

    els.cancel.addEventListener('click', () => closeEditor());
    els.issuesClose.addEventListener('click', hideIssues);
    els.saveAnyway.addEventListener('click', () => closeEditor());

    els.issuesList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-jump]');
      if (!button) return;
      goToPage(Number(button.dataset.jump));
      const target = els.body.querySelector('[data-field="text"], [data-field="elim-text"]');
      if (target) target.focus();
    });

    els.pasteBtn.addEventListener('click', openPasteDialog);
    els.pasteCancel.addEventListener('click', closePasteDialog);
    els.pasteCheck.addEventListener('click', previewPaste);
    els.pasteUse.addEventListener('click', usePastedQuiz);
    els.pasteText.addEventListener('input', resetPastePreview);

    els.exportBtn.addEventListener('click', exportQuiz);
    els.importBtn.addEventListener('click', () => {
      els.file.value = '';
      els.file.click();
    });
    els.file.addEventListener('change', () => importFile(els.file.files && els.file.files[0]));

    els.stage.addEventListener('click', (event) => {
      const button = event.target.closest('[data-present-action]');
      if (!button) return;
      if (button.dataset.presentAction === 'review') {
        state.present = { index: 0, phase: 'review' };
        renderPresent();
      } else {
        exitPresent();
      }
    });

    els.pPrev.addEventListener('click', () => prevSlide());
    els.pNext.addEventListener('click', () => nextSlide());
    els.pExit.addEventListener('click', () => exitPresent());
    els.pFull.addEventListener('click', () => toggleFullscreen());

    document.addEventListener('fullscreenchange', () => {
      if (els.pFull) els.pFull.textContent = document.fullscreenElement ? 'Avsluta helskärm' : 'Helskärm';
    });

    document.addEventListener('keydown', (event) => {
      if (!state || state.view !== 'present') return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key;
      if (key === 'Escape') {
        /* Vid helskärm avslutar webbläsaren den först – klicka en gång till */
        if (document.fullscreenElement) return;
        event.preventDefault();
        exitPresent();
        return;
      }
      if (key === 'f' || key === 'F') {
        event.preventDefault();
        toggleFullscreen();
        return;
      }
      if (key === ' ' || key === 'Spacebar' || key === 'ArrowRight' || key === 'PageDown') {
        event.preventDefault();
        nextSlide();
        return;
      }
      if (key === 'ArrowLeft' || key === 'PageUp') {
        event.preventDefault();
        prevSlide();
      }
    });

    document.addEventListener('pointermove', () => {
      if (state.view === 'present') pokeControls();
    });
    document.addEventListener('pointerdown', () => {
      if (state.view === 'present') pokeControls();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) releaseWakeLock();
      else if (state.view === 'present') acquireWakeLock();
    });

    window.addEventListener('pagehide', releaseWakeLock);
  }

  /* ---------- Init ---------- */

  function init(context) {
    ctx = context;
    state = ctx.state;
    limits = ctx.limits || DEFAULT_LIMITS;
    els = {
      status: $('#quiz-status'),
      step: $('#editor-step'),
      progress: $('#editor-progress'),
      bar: $('#editor-progress-bar'),
      chips: $('#editor-chips'),
      storage: $('#editor-storage'),
      body: $('#editor-body'),
      issues: $('#editor-issues'),
      issuesText: $('#editor-issues-text'),
      issuesList: $('#editor-issues-list'),
      saveAnyway: $('#editor-save-anyway'),
      issuesClose: $('#editor-issues-close'),
      prev: $('#editor-prev'),
      next: $('#editor-next'),
      cancel: $('#editor-cancel'),
      io: $('#editor-io'),
      pasteBtn: $('#quiz-paste'),
      exportBtn: $('#quiz-export'),
      importBtn: $('#quiz-import'),
      file: $('#quiz-file'),
      dialog: $('#paste-dialog'),
      pasteText: $('#paste-text'),
      pastePreview: $('#paste-preview'),
      pasteCheck: $('#paste-check'),
      pasteUse: $('#paste-use'),
      pasteCancel: $('#paste-cancel'),
      code: $('#present-code'),
      counter: $('#present-counter'),
      stage: $('#present-stage'),
      controls: $('#present-controls'),
      pPrev: $('#present-prev'),
      pNext: $('#present-next'),
      pFull: $('#present-full'),
      pExit: $('#present-exit'),
    };
    bindEvents();
  }

  return {
    init,
    sanitizeQuiz,
    parsePastedQuiz,
    adapt,
    ensureQuiz,
    hasContent,
    renderEditor,
    renderPresent,
    openEditor,
    openPresent,
    syncSetupStatus,
  };
})();

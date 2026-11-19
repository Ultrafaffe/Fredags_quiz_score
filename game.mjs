/* Ren spellogik för live-quizet – ingen AWS här, så den kan testas med `node --test`. */

/* Poäng för ett svar. at och startedAt är serverns epoch-ms. */
export function pointsFor(quiz, index, answer, startedAt) {
  if (!answer || answer.choice !== quiz.questions[index]?.correct) return 0;
  if (quiz.scoring !== "speed") return 1;
  const t = Math.min(1, Math.max(0, answer.at - startedAt) / (quiz.timeLimitSec * 1000));
  return Math.round(1000 * (1 - t / 2)); // 1000 direkt, 500 precis vid gongen
}

/* Topplistan, sorterad, med rank. Alla som gått med finns med, även med 0 p. */
export function scoreGame(game) {
  const quiz = game.quiz;
  const totals = new Map();

  for (const player of Object.values(game.joined ?? {})) {
    totals.set(player.playerId, { playerId: player.playerId, name: player.name, score: 0, time: 0 });
  }

  const limitMs = (Number(quiz.timeLimitSec) || 0) * 1000;

  /* Bara frågor som har öppnats (har startedAt) räknas. */
  for (const [index, started] of Object.entries(game.startedAt ?? {})) {
    const startedAt = Number(started) || 0;
    const byPlayer = game.answers?.[index] ?? {};
    for (const row of totals.values()) {
      const answer = byPlayer[row.playerId];
      row.score += pointsFor(quiz, Number(index), answer, startedAt);
      /* Obesvarat räknas som full tid – annars vinner den som hoppar över utslaget */
      row.time += answer ? Math.max(0, answer.at - startedAt) : limitMs;
    }
  }

  const speed = quiz.scoring === "speed";
  /* Snabbhet: lika poäng avgörs av total svarstid. Rätt/fel: lika poäng delar plats. */
  const ranked = [...totals.values()].sort((a, b) => (
    b.score - a.score || (speed ? a.time - b.time : 0) || a.name.localeCompare(b.name, "sv")
  ));
  const same = (a, b) => a.score === b.score && (!speed || a.time === b.time);

  return ranked.map((row, index) => {
    row.rank = index > 0 && same(row, ranked[index - 1]) ? ranked[index - 1].rank : index + 1;
    return row;
  });
}

export const MAX_QUESTIONS = 50;
export const MAX_PLAYERS = 100;
/* Svar som kommer strax efter gongen godtas – nätfördröjning. */
export const ANSWER_GRACE_MS = 1500;

const cleanText = (value, max) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= max ? text : null;
};

/* Returnerar { quiz } (städat) eller { error }. */
export function validateQuiz(raw) {
  const quiz = raw && typeof raw === "object" ? raw : {};
  const timeLimitSec = Number(quiz.timeLimitSec ?? 0);
  const scoring = quiz.scoring ?? "correct";
  const questions = Array.isArray(quiz.questions) ? quiz.questions : [];

  if (!Number.isInteger(timeLimitSec) || (timeLimitSec !== 0 && (timeLimitSec < 5 || timeLimitSec > 120))) {
    return { error: "Ogiltig timer – 0 eller 5–120 sekunder" };
  }
  if (scoring !== "correct" && scoring !== "speed") return { error: "Ogiltigt poängläge" };
  if (scoring === "speed" && timeLimitSec === 0) return { error: "Ogiltigt poängläge – snabbhet kräver timer" };
  if (questions.length < 1 || questions.length > MAX_QUESTIONS) {
    return { error: `Ogiltigt antal frågor – 1 till ${MAX_QUESTIONS}` };
  }

  const clean = [];
  for (const [index, question] of questions.entries()) {
    const text = cleanText(question?.text, 200);
    const options = Array.isArray(question?.options) ? question.options.map((option) => cleanText(option, 100)) : [];
    const correct = question?.correct;
    if (!text) return { error: `Ogiltig fråga ${index + 1} – text 1–200 tecken` };
    if (options.length < 2 || options.length > 6 || options.includes(null)) {
      return { error: `Ogiltig fråga ${index + 1} – 2–6 alternativ, 1–100 tecken var` };
    }
    if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) {
      return { error: `Ogiltig fråga ${index + 1} – välj rätt svar` };
    }
    clean.push({ text, options, correct });
  }

  return {
    quiz: {
      title: String(quiz.title ?? "").trim().slice(0, 100),
      timeLimitSec,
      scoring,
      questions: clean
    }
  };
}

const player = (entry) => ({ playerId: entry.playerId, name: entry.name });

/* Det GET returnerar. Facit och andras svar följer bara med efter reveal. */
export function publicState(game, { isHost = false, now = Date.now() } = {}) {
  const quiz = game.quiz ?? { title: "", timeLimitSec: 0, scoring: "correct", questions: [] };
  /* Gamla spel (före live-quizet) saknar phase – de kan bara visas som avslutade. */
  const phase = game.phase ?? "finished";
  const index = Number.isInteger(game.currentIndex) ? game.currentIndex : -1;
  const current = quiz.questions[index];
  const answers = game.answers?.[index] ?? {};

  const state = {
    gameId: game.gameId,
    gameCode: game.gameCode ?? game.gameId,
    hostName: game.hostName ?? "",
    title: quiz.title,
    phase,
    currentIndex: index,
    questionCount: quiz.questions.length,
    timeLimitSec: quiz.timeLimitSec,
    scoring: quiz.scoring,
    questionEndsAt: Number(game.questionEndsAt) || 0,
    serverNow: now,
    joined: Object.values(game.joined ?? {}).map(player),
    answeredIds: Object.keys(answers),
    answeredCount: Object.keys(answers).length
  };

  if (current && (phase === "question" || phase === "reveal")) {
    state.question = { text: current.text, options: current.options };
  }

  if (current && phase === "reveal") {
    const startedAt = Number(game.startedAt?.[index]) || 0;
    state.correct = current.correct;
    state.distribution = current.options.map((_, option) => (
      Object.values(answers).filter((answer) => answer.choice === option).length
    ));
    state.lastResults = Object.fromEntries(Object.keys(game.joined ?? {}).map((playerId) => {
      const answer = answers[playerId];
      const points = pointsFor(quiz, index, answer, startedAt);
      return [playerId, { answered: Boolean(answer), correct: Boolean(answer) && answer.choice === current.correct, points }];
    }));
  }

  if (phase === "reveal" || phase === "finished") state.leaderboard = scoreGame({ ...game, quiz });
  if (isHost) state.quiz = quiz;

  return state;
}

/* null om svaret får sparas, annars { status, error }. Dubbelsvar fångas
   även av villkoret i DynamoDB – det här är bara den snabba kollen. */
export function checkAnswer(game, body, now) {
  const index = Number(body.questionIndex);
  const choice = body.choice;
  const playerId = String(body.playerId ?? "");

  if (!game.joined?.[playerId]) return { status: 403, error: "Gå med i spelet först" };
  if (game.phase !== "question" || index !== game.currentIndex) {
    return { status: 409, error: "Frågan är stängd" };
  }
  if (game.questionEndsAt && now > game.questionEndsAt + ANSWER_GRACE_MS) {
    return { status: 409, error: "Tiden är ute" };
  }
  const options = game.quiz?.questions?.[index]?.options ?? [];
  if (!Number.isInteger(choice) || choice < 0 || choice >= options.length) {
    return { status: 400, error: "Ogiltigt svar" };
  }
  if (game.answers?.[index]?.[playerId]) return { status: 409, error: "Redan svarat" };
  return null;
}

/* Tillståndsmaskinen för PATCH. Returnerar { from, set, startedIndex? } eller { error }.
   `from` blir ett villkor i DynamoDB så att två snabba klick inte hoppar över en fråga.
   expectedIndex (frivilligt) är frågan värden tittade på – ett gammalt läge får inte
   stänga eller hoppa över nästa fråga. */
export function transition(game, action, now, expectedIndex) {
  const phase = game.phase;
  if (Number.isInteger(expectedIndex) && expectedIndex !== game.currentIndex && action !== "end") {
    return { error: "Spelet har redan gått vidare" };
  }
  const finish = { from: phase, set: { phase: "finished", endedAt: new Date(now).toISOString() } };
  const count = game.quiz?.questions?.length ?? 0;
  const timeLimitMs = (game.quiz?.timeLimitSec ?? 0) * 1000;
  const open = (index) => ({
    from: phase,
    set: { phase: "question", currentIndex: index, questionEndsAt: timeLimitMs ? now + timeLimitMs : 0 },
    startedIndex: index
  });

  if (action === "start" && phase === "lobby" && count > 0) return open(0);
  if (action === "reveal" && phase === "question") return { from: phase, set: { phase: "reveal" } };
  if (action === "next" && phase === "reveal") {
    return game.currentIndex + 1 < count ? open(game.currentIndex + 1) : finish;
  }
  if (action === "end" && phase && phase !== "finished") return finish;
  return { error: "Spelet har redan gått vidare" };
}

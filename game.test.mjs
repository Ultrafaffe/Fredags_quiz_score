// Kör: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreGame, publicState, validateQuiz, checkAnswer, transition } from "./game.mjs";

const T0 = 1_000_000;

/* Två frågor, rätt svar 0 respektive 1. */
const makeGame = (scoring, answers, timeLimitSec = 20) => ({
  quiz: {
    title: "Test",
    timeLimitSec,
    scoring,
    questions: [
      { text: "A?", options: ["a", "b"], correct: 0 },
      { text: "B?", options: ["a", "b"], correct: 1 }
    ]
  },
  phase: "finished",
  currentIndex: 1,
  startedAt: { 0: T0, 1: T0 },
  joined: {
    p1: { playerId: "p1", name: "Anna" },
    p2: { playerId: "p2", name: "Bo" },
    p3: { playerId: "p3", name: "Cia" }
  },
  answers
});

const byId = (board) => Object.fromEntries(board.map((row) => [row.playerId, row]));

test("rätt/fel: 1 p per rätt, 0 för fel och obesvarat", () => {
  const board = byId(scoreGame(makeGame("correct", {
    0: { p1: { choice: 0, at: T0 + 5000 }, p2: { choice: 1, at: T0 + 100 } },
    1: { p1: { choice: 1, at: T0 + 5000 } }
  })));
  assert.equal(board.p1.score, 2);
  assert.equal(board.p2.score, 0);
  assert.equal(board.p3.score, 0);
});

test("snabbhet: 1000 p direkt, 500 p vid gongen och efter den", () => {
  const board = byId(scoreGame(makeGame("speed", {
    0: {
      p1: { choice: 0, at: T0 },          // direkt
      p2: { choice: 0, at: T0 + 20000 },  // precis vid gongen
      p3: { choice: 0, at: T0 + 21000 }   // inom nätmarginalen efter gongen
    },
    1: { p1: { choice: 1, at: T0 + 10000 } } // halva tiden → 750
  })));
  assert.equal(board.p1.score, 1750);
  assert.equal(board.p2.score, 500);
  assert.equal(board.p3.score, 500);
});

test("rätt/fel: lika poäng delar plats (1, 1, 3)", () => {
  const board = scoreGame(makeGame("correct", {
    0: { p1: { choice: 0, at: T0 + 9000 }, p2: { choice: 0, at: T0 + 100 } }
  }));
  assert.deepEqual(board.map((row) => [row.name, row.score, row.rank]), [
    ["Anna", 1, 1],
    ["Bo", 1, 1],
    ["Cia", 0, 3]
  ]);
});

test("snabbhet: lika poäng avgörs av lägst total svarstid", () => {
  /* p1: 1000 + 500 = 1500, p2: 500 + 1000 = 1500, men p2 svarade snabbare totalt
     (20 s + 0 s mot 0 s + 20,9 s). */
  const board = scoreGame(makeGame("speed", {
    0: { p1: { choice: 0, at: T0 }, p2: { choice: 0, at: T0 + 20000 } },
    1: { p1: { choice: 1, at: T0 + 20900 }, p2: { choice: 1, at: T0 } }
  }));
  assert.deepEqual(board.map((row) => [row.name, row.score, row.rank]), [
    ["Bo", 1500, 1],
    ["Anna", 1500, 2],
    ["Cia", 0, 3]
  ]);
});

test("publicState: facit syns inte för spelare under fråga, men vid reveal", () => {
  const game = { ...makeGame("correct", { 0: { p1: { choice: 0, at: T0 } }, 1: {} }), phase: "question", currentIndex: 0 };
  const during = publicState(game, { isHost: false, now: T0 + 1000 });
  assert.equal(during.correct, undefined);
  assert.equal(during.leaderboard, undefined);
  assert.equal(during.lastResults, undefined);
  assert.equal(during.quiz, undefined);
  assert.deepEqual(during.question, { text: "A?", options: ["a", "b"] });
  assert.deepEqual(during.answeredIds, ["p1"]);
  assert.equal(during.hostToken, undefined);

  const revealed = publicState({ ...game, phase: "reveal" }, { isHost: false, now: T0 + 1000 });
  assert.equal(revealed.correct, 0);
  assert.deepEqual(revealed.distribution, [1, 0]);
  assert.deepEqual(revealed.lastResults.p1, { answered: true, correct: true, points: 1 });
  assert.equal(revealed.leaderboard[0].name, "Anna");

  assert.ok(publicState(game, { isHost: true, now: T0 }).quiz.questions[0].correct === 0);
});

test("validateQuiz: snabbhet kräver timer, och taken hålls", () => {
  const ok = { title: "Q", timeLimitSec: 20, scoring: "speed", questions: [{ text: "?", options: ["a", "b"], correct: 1 }] };
  assert.equal(validateQuiz(ok).error, undefined);
  assert.ok(validateQuiz({ ...ok, timeLimitSec: 0 }).error);
  assert.ok(validateQuiz({ ...ok, timeLimitSec: 3 }).error);
  assert.ok(validateQuiz({ ...ok, questions: [{ text: "?", options: ["a"], correct: 0 }] }).error);
  assert.ok(validateQuiz({ ...ok, questions: [{ text: "?", options: ["a", "b"], correct: 2 }] }).error);
  assert.ok(validateQuiz({ ...ok, questions: Array(51).fill(ok.questions[0]) }).error);
});

test("checkAnswer: fel fas, fel fråga, för sent och redan svarat ger 409", () => {
  const game = { ...makeGame("correct", { 0: { p1: { choice: 0, at: T0 } }, 1: {} }), phase: "question", currentIndex: 0, questionEndsAt: T0 + 20000 };
  const body = { playerId: "p2", questionIndex: 0, choice: 1 };
  assert.equal(checkAnswer(game, body, T0 + 21000), null); // inom marginalen
  assert.equal(checkAnswer(game, body, T0 + 21600).status, 409);
  assert.equal(checkAnswer(game, { ...body, questionIndex: 1 }, T0).status, 409);
  assert.equal(checkAnswer({ ...game, phase: "reveal" }, body, T0).status, 409);
  assert.equal(checkAnswer(game, { ...body, playerId: "p1" }, T0).status, 409);
  assert.equal(checkAnswer(game, { ...body, choice: 5 }, T0).status, 400);
  assert.equal(checkAnswer(game, { ...body, playerId: "okänd" }, T0).status, 403);
});

test("transition: lobby → fråga → reveal → nästa → slut, och fel fas avvisas", () => {
  const game = { ...makeGame("correct", {}), phase: "lobby", currentIndex: -1 };
  const start = transition(game, "start", T0);
  assert.deepEqual(start, { from: "lobby", set: { phase: "question", currentIndex: 0, questionEndsAt: T0 + 20000 }, startedIndex: 0 });
  assert.ok(transition(game, "reveal", T0).error);
  assert.equal(transition({ ...game, phase: "question", currentIndex: 0 }, "reveal", T0).set.phase, "reveal");
  assert.equal(transition({ ...game, phase: "reveal", currentIndex: 0 }, "next", T0).set.currentIndex, 1);
  assert.equal(transition({ ...game, phase: "reveal", currentIndex: 1 }, "next", T0).set.phase, "finished");
  assert.equal(transition({ ...game, phase: "question", currentIndex: 0 }, "end", T0).set.phase, "finished");
  assert.ok(transition({ ...game, phase: "finished" }, "end", T0).error);
});

test("snabbhet: obesvarad fråga räknas som full tid i utslaget", () => {
  /* Båda 1000 p. Anna hoppade över fråga 2, Bo svarade fel efter 5 s → Bo går före. */
  const board = scoreGame(makeGame("speed", {
    0: { p1: { choice: 0, at: T0 }, p2: { choice: 0, at: T0 } },
    1: { p2: { choice: 0, at: T0 + 5000 } }
  }));
  assert.deepEqual(board.slice(0, 2).map((row) => row.name), ["Bo", "Anna"]);
});

test("transition: fel frågeindex avvisas, så ett gammalt läge inte stänger nästa fråga", () => {
  const game = { ...makeGame("correct", {}), phase: "question", currentIndex: 1 };
  assert.ok(transition(game, "reveal", T0, 0).error);
  assert.equal(transition(game, "reveal", T0, 1).set.phase, "reveal");
  assert.ok(transition({ ...game, phase: "finished" }, "end", T0).error);
  assert.ok(typeof transition(game, "end", T0).set.endedAt === "string");
});

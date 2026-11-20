import {
  DynamoDBClient
} from "@aws-sdk/client-dynamodb";

import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";

import { randomUUID } from "node:crypto";

/* Ren spellogik (testas med `node --test`). Ska deployas tillsammans med lambda.mjs. */
import {
  MAX_PLAYERS,
  checkAnswer,
  publicState,
  transition,
  validateQuiz
} from "./game.mjs";

const client = new DynamoDBClient({});
const database = DynamoDBDocumentClient.from(client);
const tableName = process.env.TABLE_NAME;

/* DynamoDB TTL räknar sekunder sedan epoch. Spel sparas i 30 dagar. */
const GAME_TTL_SECONDS = 30 * 24 * 60 * 60;

const response = (statusCode, body) => ({
  statusCode,
  headers: {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,x-host-token",
    "access-control-allow-methods": "GET,POST,OPTIONS,PATCH"
  },
  body: JSON.stringify(body)
});

const header = (event, name) => {
  const headers = event?.headers ?? {};
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key ? headers[key] : undefined;
};

const getGame = async (gameId) => (await database.send(new GetCommand({
  TableName: tableName,
  Key: { gameId },
  /* Annars kan en läsning direkt efter värdens PATCH ge gamla fasen i upp till ~1 s */
  ConsistentRead: true
}))).Item;

const isHost = (event, game) => {
  const token = header(event, "x-host-token");
  return Boolean(token) && token === game.hostToken;
};

const isConditionFailure = (error) => error?.name === "ConditionalCheckFailedException";

/* Long-poll: GET svarar först när fas/fråga ändrats, max så här länge */
const LONG_POLL_MS = 6000; // under appens 8 s-timeout i apiRequest
const LONG_POLL_STEP_MS = 150;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export const handler = async (event, context) => {
  const method = event?.requestContext?.http?.method
    ?? event?.httpMethod
    ?? "GET";

  if (method === "OPTIONS") {
    return response(204, {});
  }

  const requestedGameId = event?.pathParameters?.gameId;

  /* API Gateway ger antingen rawPath (HTTP API) eller resource (REST API). */
  const rawPath = String(
    event?.rawPath
    ?? event?.path
    ?? event?.requestContext?.http?.path
    ?? event?.requestContext?.resourcePath
    ?? ""
  );
  const route = String(event?.routeKey ?? event?.resource ?? "");
  const isRoute = (name) => new RegExp(`/${name}/?$`).test(rawPath) || new RegExp(`/${name}$`).test(route);

  let body = {};

  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return response(400, {
      error: "Request body must be valid JSON"
    });
  }

  if (!body || typeof body !== "object") body = {};

  // POST /games/{gameId}/players
  /* Tillåts i alla faser utom finished. Sena deltagare får 0 p på missade frågor. */
  if (method === "POST" && requestedGameId && isRoute("players")) {
    const playerId = String(body.playerId ?? "").trim().slice(0, 64);

    if (!playerId) {
      return response(400, { error: "playerId is required" });
    }

    const game = await getGame(requestedGameId);

    if (!game) return response(404, { error: "Game not found" });
    if (game.phase === "finished" || !game.phase) return response(409, { error: "Spelet är avslutat" });

    const alreadyJoined = Boolean(game.joined?.[playerId]);
    if (!alreadyJoined && Object.keys(game.joined ?? {}).length >= MAX_PLAYERS) {
      return response(409, { error: `Spelet är fullt (max ${MAX_PLAYERS} deltagare)` });
    }

    const joined = {
      playerId,
      name: String(body.name ?? "").trim().slice(0, 40) || "Deltagare",
      joinedAt: new Date().toISOString()
    };

    try {
      const result = await database.send(new UpdateCommand({
        TableName: tableName,
        Key: { gameId: requestedGameId },
        /* if_not_exists behåller första anmälningstiden vid omladdning */
        UpdateExpression: "SET joined.#pid = if_not_exists(joined.#pid, :joined)",
        ExpressionAttributeNames: {
          "#pid": playerId,
          "#phase": "phase"
        },
        ExpressionAttributeValues: {
          ":joined": joined,
          ":finished": "finished"
        },
        // Skyddar mot att spelet avslutas mellan läsning och skrivning
        ConditionExpression: "attribute_exists(gameId) AND #phase <> :finished",
        ReturnValues: "ALL_NEW"
      }));

      return response(200, publicState(result.Attributes));
    } catch (error) {
      if (isConditionFailure(error)) return response(409, { error: "Spelet är avslutat" });
      throw error;
    }
  }

  // POST /games/{gameId}/answers
  if (method === "POST" && requestedGameId && isRoute("answers")) {
    const playerId = String(body.playerId ?? "").trim().slice(0, 64);
    const game = await getGame(requestedGameId);

    if (!game) return response(404, { error: "Game not found" });

    /* `at` sätts av servern – klientens klocka används aldrig för poäng. */
    const now = Date.now();
    const rejected = checkAnswer(game, { ...body, playerId }, now);
    if (rejected) return response(rejected.status, { error: rejected.error });

    const index = String(game.currentIndex);

    try {
      await database.send(new UpdateCommand({
        TableName: tableName,
        Key: { gameId: requestedGameId },
        UpdateExpression: "SET answers.#q.#pid = :answer",
        ExpressionAttributeNames: {
          "#q": index,
          "#pid": playerId,
          "#phase": "phase"
        },
        ExpressionAttributeValues: {
          ":answer": { choice: body.choice, at: now },
          ":question": "question",
          ":index": game.currentIndex
        },
        /* Ett svar per person och fråga, och bara medan frågan är öppen */
        ConditionExpression: "attribute_not_exists(answers.#q.#pid) AND #phase = :question AND currentIndex = :index"
      }));
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
      const current = await getGame(requestedGameId);
      return response(409, {
        error: current?.answers?.[index]?.[playerId] ? "Redan svarat" : "Frågan är stängd"
      });
    }

    return response(200, { ok: true, questionIndex: game.currentIndex });
  }

  // POST /games
  if (method === "POST" && !requestedGameId) {
    const { quiz, error } = validateQuiz(body.quiz);

    if (error) return response(400, { error });

    const gameId = createGameCode();
    const hostToken = randomUUID();
    const createdAt = new Date();

    const game = {
      gameId,
      gameCode: gameId,
      hostToken,
      hostName: String(body.hostName ?? "").trim().slice(0, 40),
      quiz,
      phase: "lobby",
      currentIndex: -1,
      startedAt: {},
      questionEndsAt: 0,
      /* DynamoDB kan bara skriva answers.#q.#pid om answers.#q redan finns */
      answers: Object.fromEntries(quiz.questions.map((_, index) => [String(index), {}])),
      joined: {},
      createdAt: createdAt.toISOString(),
      /* Sekunder sedan epoch – DynamoDB tar bort spelet efter 30 dagar. */
      expiration_time: Math.floor(createdAt.getTime() / 1000) + GAME_TTL_SECONDS
    };

    await database.send(new PutCommand({
      TableName: tableName,
      Item: game,
      ConditionExpression: "attribute_not_exists(gameId)"
    }));

    // Endast skaparen får tokenen – den finns med här men aldrig i GET-svar
    return response(201, { ...publicState(game, { isHost: true }), hostToken });
  }

  // PATCH /games/{gameId}  { action: "start" | "reveal" | "next" | "end" }
  if (method === "PATCH" && requestedGameId) {
    const game = await getGame(requestedGameId);

    if (!game) return response(404, { error: "Game not found" });
    if (!isHost(event, game)) return response(403, { error: "Endast värden kan styra spelet" });

    /* Idempotent: ett redan avslutat spel avslutas inte igen */
    if (body.action === "end" && game.phase === "finished") {
      return response(200, publicState(game, { isHost: true }));
    }

    const now = Date.now();
    const expectedIndex = Number.isInteger(body.currentIndex) ? body.currentIndex : undefined;
    const step = transition(game, body.action, now, expectedIndex);
    if (step.error) return response(409, { error: step.error });

    const names = { "#phase": "phase", "#currentIndex": "currentIndex" };
    const values = { ":from": step.from, ":fromIndex": game.currentIndex };
    const sets = [];

    for (const [key, value] of Object.entries(step.set)) {
      names[`#${key}`] = key;
      values[`:${key}`] = value;
      sets.push(`#${key} = :${key}`);
    }
    if (step.startedIndex !== undefined) {
      names["#i"] = String(step.startedIndex);
      values[":now"] = now;
      sets.push("startedAt.#i = :now");
    }

    try {
      const result = await database.send(new UpdateCommand({
        TableName: tableName,
        Key: { gameId: requestedGameId },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        /* Två snabba klick: det andra hittar fel fas/fråga och hoppar inte över en fråga */
        ConditionExpression: "#phase = :from AND #currentIndex = :fromIndex",
        ReturnValues: "ALL_NEW"
      }));

      return response(200, publicState(result.Attributes, { isHost: true, now }));
    } catch (error) {
      if (isConditionFailure(error)) return response(409, { error: "Spelet har redan gått vidare" });
      throw error;
    }
  }

  // GET /games/{gameId}
  if (method === "GET" && requestedGameId) {
    let game = await getGame(requestedGameId);

    if (!game) return response(404, { error: "Game not found" });

    /* ?wait=fas:index – vänta tills värden byter läge. Lämnar 1 s marginal mot Lambdas timeout. */
    const wait = event?.queryStringParameters?.wait;
    if (wait) {
      const budget = Math.min(LONG_POLL_MS, (context?.getRemainingTimeInMillis?.() ?? 3000) - 1000);
      const deadline = Date.now() + budget;
      while (`${game.phase}:${game.currentIndex}` === wait && Date.now() + LONG_POLL_STEP_MS < deadline) {
        await sleep(LONG_POLL_STEP_MS);
        game = (await getGame(requestedGameId)) ?? game;
      }
    }

    /* Spelare ser aldrig facit före reveal, och aldrig värdtokenen */
    return response(200, publicState(game, { isHost: isHost(event, game) }));
  }

  return response(404, {
    error: "Route not found"
  });
};

function createGameCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let index = 0; index < 5; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return code;
}

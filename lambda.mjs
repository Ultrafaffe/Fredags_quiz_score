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

const client = new DynamoDBClient({});
const database = DynamoDBDocumentClient.from(client);
const tableName = process.env.TABLE_NAME;

/* DynamoDB TTL räknar sekunder sedan epoch. Spel och resultat sparas i 30 dagar. */
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

/* Värdtokenen får bara lämnas ut till den som skapade spelet (POST /games).
   Allt annat svar – inklusive listor med resultat – ska rensas.
   Spelare lagras som en karta per playerId men lämnas alltid ut som lista. */
const publicGame = (game) => {
  if (!game) return game;
  const { hostToken, players, joined, ...rest } = game;
  return {
    ...rest,
    players: Object.values(players ?? {}),
    joined: Object.values(joined ?? {})
  };
};

const header = (event, name) => {
  const headers = event?.headers ?? {};
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key ? headers[key] : undefined;
};

/* Nycklad karta per playerId – inte en lista (då blir varje om-spar en dubblett). */
const isPlayerMap = (players) => Boolean(players)
  && typeof players === "object"
  && !Array.isArray(players);

/* Äldre spel saknar joined-kartan. DynamoDB kan inte skriva till en nestad
   karta som inte finns, så den skapas först – en befintlig karta behålls. */
const ensureJoinedMap = async (gameId, game) => {
  if (isPlayerMap(game?.joined)) return;

  await database.send(new UpdateCommand({
    TableName: tableName,
    Key: { gameId },
    UpdateExpression: "SET joined = if_not_exists(joined, :empty)",
    ExpressionAttributeValues: {
      ":empty": {}
    },
    ConditionExpression: "attribute_exists(gameId)"
  }));
};

export const handler = async (event) => {
  const method = event?.requestContext?.http?.method
    ?? event?.httpMethod
    ?? "GET";

  if (method === "OPTIONS") {
    return response(204, {});
  }

  const pathParameters = event?.pathParameters ?? {};
  const requestedGameId = pathParameters.gameId;

  /* API Gateway ger antingen rawPath (HTTP API) eller resource (REST API).
     Rutten /games/{gameId}/players skiljs från /games/{gameId}/scores. */
  const rawPath = String(
    event?.rawPath
    ?? event?.path
    ?? event?.requestContext?.http?.path
    ?? event?.requestContext?.resourcePath
    ?? ""
  );
  const route = String(event?.routeKey ?? event?.resource ?? "");
  const isPlayersRoute = /\/players\/?$/.test(rawPath) || /\/players$/.test(route);

  let body = {};

  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return response(400, {
      error: "Request body must be valid JSON"
    });
  }

  // POST /games/{gameId}/players
  /* Anmäler en deltagare som gått med i spelet. Resultatet sparas först
     senare via /scores, så värden kan se vilka som väntar på att svara. */
  if (method === "POST" && requestedGameId && isPlayersRoute) {
    const playerId = String(body.playerId ?? "").trim();

    if (!playerId) {
      return response(400, {
        error: "playerId is required"
      });
    }

    const existing = await database.send(new GetCommand({
      TableName: tableName,
      Key: {
        gameId: requestedGameId
      }
    }));

    if (!existing.Item) {
      return response(404, {
        error: "Game not found"
      });
    }

    if (existing.Item.status !== "active") {
      return response(409, {
        error: "Spelet är avslutat"
      });
    }

    const playerKey = playerId.slice(0, 64);
    const joined = {
      playerId,
      name: String(body.name ?? "").trim().slice(0, 40) || "Deltagare",
      joinedAt: new Date().toISOString()
    };

    try {
      await ensureJoinedMap(requestedGameId, existing.Item);

      const result = await database.send(new UpdateCommand({
        TableName: tableName,
        Key: {
          gameId: requestedGameId
        },
        UpdateExpression: "SET joined.#pid = :joined",
        ExpressionAttributeValues: {
          ":active": "active",
          ":joined": joined
        },
        ExpressionAttributeNames: {
          "#pid": playerKey,
          "#status": "status"
        },
        // Skyddar mot att spelet avslutas mellan läsning och skrivning
        ConditionExpression: "attribute_exists(gameId) AND #status = :active",
        ReturnValues: "ALL_NEW"
      }));

      return response(200, publicGame(result.Attributes));
    } catch (error) {
      if (error.name === "ConditionalCheckFailedException") {
        const current = await database.send(new GetCommand({
          TableName: tableName,
          Key: { gameId: requestedGameId }
        }));

        return current.Item
          ? response(409, { error: "Spelet är avslutat" })
          : response(404, { error: "Game not found" });
      }

      throw error;
    }
  }

  // POST /games/{gameId}/scores
  if (method === "POST" && requestedGameId) {
    const playerId = String(body.playerId ?? "").trim();

    if (!playerId) {
      return response(400, {
        error: "playerId is required"
      });
    }

    const existing = await database.send(new GetCommand({
      TableName: tableName,
      Key: {
        gameId: requestedGameId
      }
    }));

    if (!existing.Item) {
      return response(404, {
        error: "Game not found"
      });
    }

    const game = existing.Item;

    if (game.status !== "active") {
      return response(409, {
        error: "Spelet är avslutat"
      });
    }

    const score = Number(body.score);
    const questionCount = Number(game.questionCount) || 10;

    if (!Number.isInteger(score) || score < 0 || score > questionCount) {
      return response(400, {
        error: "Ogiltigt resultat"
      });
    }

    const name = String(body.name ?? "").trim().slice(0, 40) || "Deltagare";
    const eliminationAnswer = String(body.eliminationAnswer ?? "").slice(0, 200);

    /* Spelare lagras i en karta per playerId: samma spelare skrivs över i
       stället för att läggas till igen – senaste resultatet vinner. */
    const playerKey = playerId.slice(0, 64);
    const player = {
      playerId,
      name,
      score,
      eliminationAnswer,
      submittedAt: new Date().toISOString()
    };

    try {
      /* Kartformat uppdateras med ett nyckeluttryck (konkurrenssäkert).
         Allt annat – äldre listor eller saknat attribut – konverteras en gång
         först, annars går det inte att skriva över enskilda spelare. */
      if (!isPlayerMap(game.players)) {
        const players = {};

        if (Array.isArray(game.players)) {
          for (const stored of game.players) {
            if (stored && typeof stored === "object" && stored.playerId) {
              players[String(stored.playerId).slice(0, 64)] = stored;
            }
          }
        }

        players[playerKey] = player;

        /* Den som skickar in ett resultat har bevisligen gått med – se till
           att spelaren finns med i deltagarlistan även för äldre spel. */
        const joined = isPlayerMap(game.joined) ? { ...game.joined } : {};
        joined[playerKey] = joined[playerKey] ?? {
          playerId,
          name,
          joinedAt: player.submittedAt
        };

        try {
          const migrated = await database.send(new UpdateCommand({
            TableName: tableName,
            Key: {
              gameId: requestedGameId
            },
            UpdateExpression: "SET players = :players, joined = :joined",
            ExpressionAttributeValues: {
              ":players": players,
              ":joined": joined,
              ":active": "active"
            },
            ExpressionAttributeNames: {
              "#status": "status"
            },
            ConditionExpression: "attribute_exists(gameId) AND #status = :active",
            ReturnValues: "ALL_NEW"
          }));

          return response(200, publicGame(migrated.Attributes));
        } catch (migrationError) {
          /* Redan konverterat av någon annan, eller spelet avslutat/borta –
             uppdateringen nedan hanterar båda fallen. */
          if (migrationError.name !== "ConditionalCheckFailedException") {
            throw migrationError;
          }
        }
      }

      await ensureJoinedMap(requestedGameId, game);

      const result = await database.send(new UpdateCommand({
        TableName: tableName,
        Key: {
          gameId: requestedGameId
        },
        /* if_not_exists bevarar den ursprungliga anmälningstiden om spelaren
           redan står med i deltagarlistan. */
        UpdateExpression: "SET players.#pid = :player, joined.#pid = if_not_exists(joined.#pid, :joined)",
        ExpressionAttributeValues: {
          ":active": "active",
          ":player": player,
          ":joined": {
            playerId,
            name,
            joinedAt: player.submittedAt
          }
        },
        ExpressionAttributeNames: {
          "#pid": playerKey,
          "#status": "status"
        },
        // Skyddar även mot att spelet avslutas mellan läsning och skrivning
        ConditionExpression: "attribute_exists(gameId) AND #status = :active",
        ReturnValues: "ALL_NEW"
      }));

      return response(200, publicGame(result.Attributes));
    } catch (error) {
      if (error.name === "ConditionalCheckFailedException") {
        const current = await database.send(new GetCommand({
          TableName: tableName,
          Key: { gameId: requestedGameId }
        }));

        return current.Item
          ? response(409, { error: "Spelet är avslutat" })
          : response(404, { error: "Game not found" });
      }

      throw error;
    }
  }

  // POST /games
  if (method === "POST") {
    /* Någon kan inte skapa hur stort spel som helst – 1..100 frågor.
       Fältet får utelämnas (då gäller 10 som förut). */
    const questionCount = body.questionCount === undefined || body.questionCount === null
      ? 10
      : Number(body.questionCount);

    if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 100) {
      return response(400, {
        error: "Ogiltigt antal frågor – måste vara ett heltal mellan 1 och 100"
      });
    }

    const gameId = createGameCode();
    const hostToken = randomUUID();
    const createdAt = new Date();

    const game = {
      gameId,
      gameCode: gameId,
      hostToken,
      hostName: String(body.hostName ?? "").trim().slice(0, 40),
      status: "active",
      questionCount,
      answerCount: Math.min(10, Math.max(1, Number(body.answerCount) || 4)),
      answerDesign: ["letters", "numbers", "text"].includes(body.answerDesign)
        ? body.answerDesign
        : "letters",
      eliminationQuestion: body.eliminationQuestion === true,
      createdAt: createdAt.toISOString(),
      /* Sekunder sedan epoch – DynamoDB tar bort spelet efter 30 dagar. */
      expiration_time: Math.floor(createdAt.getTime() / 1000) + GAME_TTL_SECONDS,
      players: {},
      joined: {}
    };

    await database.send(new PutCommand({
      TableName: tableName,
      Item: game,
      ConditionExpression: "attribute_not_exists(gameId)"
    }));

    // Endast skaparen får tokenen – den finns med här men aldrig i GET-svar
    return response(201, { ...game, players: [], joined: [] });
  }

  // PATCH /games/{gameId}
  if (method === "PATCH" && requestedGameId) {
    const stored = await database.send(new GetCommand({
      TableName: tableName,
      Key: { gameId: requestedGameId }
    }));

    if (!stored.Item) {
      return response(404, {
        error: "Game not found"
      });
    }

    const requestToken = header(event, "x-host-token");

    if (!requestToken || requestToken !== stored.Item.hostToken) {
      return response(403, {
        error: "Endast värden kan avsluta spelet"
      });
    }

    /* Idempotent: ett redan avslutat spel ska inte få ett nytt endedAt */
    if (stored.Item.status === "inactive") {
      return response(200, publicGame(stored.Item));
    }

    try {
      const result = await database.send(new UpdateCommand({
        TableName: tableName,
        Key: { gameId: requestedGameId },
        UpdateExpression: "SET #status = :status, endedAt = :endedAt",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: {
          ":status": "inactive",
          ":endedAt": new Date().toISOString()
        },
        ConditionExpression: "attribute_exists(gameId)",
        ReturnValues: "ALL_NEW"
      }));

      return response(200, publicGame(result.Attributes));
    } catch (error) {
      if (error.name === "ConditionalCheckFailedException") {
        return response(404, {
          error: "Game not found"
        });
      }

      throw error;
    }
  }

  // GET /games/{gameId}
  if (method === "GET" && requestedGameId) {
    const result = await database.send(new GetCommand({
      TableName: tableName,
      Key: {
        gameId: requestedGameId
      }
    }));

    if (!result.Item) {
      return response(404, {
        error: "Game not found"
      });
    }

    // Spelkod + resultat, men aldrig värdtokenen
    return response(200, publicGame(result.Item));
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
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
   Allt annat svar – inklusive listor med resultat – ska rensas. */
const publicGame = (game) => {
  if (!game) return game;
  const { hostToken, ...rest } = game;
  return rest;
};

const header = (event, name) => {
  const headers = event?.headers ?? {};
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key ? headers[key] : undefined;
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

  let body = {};

  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return response(400, {
      error: "Request body must be valid JSON"
    });
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

    try {
      const result = await database.send(new UpdateCommand({
        TableName: tableName,
        Key: {
          gameId: requestedGameId
        },
        UpdateExpression: [
          "SET players = list_append(if_not_exists(players, :empty), :player)"
        ].join(" "),
        ExpressionAttributeValues: {
          ":empty": [],
          ":active": "active",
          ":player": [
            {
              playerId,
              name,
              score,
              eliminationAnswer,
              submittedAt: new Date().toISOString()
            }
          ]
        },
        ExpressionAttributeNames: {
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
    const gameId = createGameCode();
    const hostToken = randomUUID();

    const game = {
      gameId,
      gameCode: gameId,
      hostToken,
      hostName: String(body.hostName ?? "").trim(),
      status: "active",
      questionCount: Number(body.questionCount) || 10,
      answerCount: Math.min(10, Math.max(1, Number(body.answerCount) || 4)),
      answerDesign: ["letters", "numbers", "text"].includes(body.answerDesign)
        ? body.answerDesign
        : "letters",
      eliminationQuestion: body.eliminationQuestion === true,
      createdAt: new Date().toISOString(),
      players: []
    };

    await database.send(new PutCommand({
      TableName: tableName,
      Item: game,
      ConditionExpression: "attribute_not_exists(gameId)"
    }));

    // Endast skaparen får tokenen – den finns med här men aldrig i GET-svar
    return response(201, game);
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
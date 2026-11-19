# Plan: Live-quiz i Kahoot-stil

Mål: värden bygger ett quiz med frågor, svarsalternativ och rätt svar, startar det och visar
en fråga i taget på storskärmen. Deltagarna svarar från mobilen, rättningen sker automatiskt och
topplistan uppdateras mellan frågorna.

Beslut (2026-11-19):

| # | Beslut |
| --- | --- |
| 1 | Frågor, alternativ och rätt svar skrivs in i appen. Rättningen är automatisk. |
| 2 | Värden styr. En fråga är klar när **alla har svarat**, när **timern** går ut, eller när **värden går vidare** tidigare. Timern (sekunder per fråga) ställs in när quizet skapas. |
| 3 | Poängläge väljs när quizet skapas: **Rätt/fel** (1 p per rätt) eller **Snabbhet** (Kahoot-poäng). |
| 4 | Sidan hämtar status ungefär en gång per sekund mot nuvarande Lambda och DynamoDB. Inga WebSockets. |

Utanför v1: fritextfrågor, bilder i frågor, utslagsfråga och redigering av ett startat quiz.
Det stående svarsformuläret i roten finns kvar för fritext och manuell rättning.

---

## 1. Datamodell (samma DynamoDB-post per spel)

Befintliga fält behålls (`gameId`, `hostToken`, `hostName`, `joined`, `createdAt`,
`expiration_time`). Nya och ändrade fält:

```js
{
  quiz: {
    title: "Fredag v47",
    timeLimitSec: 20,          // 0 = ingen timer (då är bara läget "correct" tillåtet)
    scoring: "correct",        // "correct" | "speed"
    questions: [
      { text: "Huvudstad i Peru?", options: ["Lima", "Quito", "La Paz", "Bogotá"], correct: 0 }
    ]
  },
  phase: "lobby",              // lobby | question | reveal | finished  (ersätter status)
  currentIndex: -1,            // aktiv fråga, -1 i lobbyn
  startedAt: { "0": 1763550000000 }, // epoch-ms per fråga, sätts av servern (behövs för snabbhetspoäng)
  questionEndsAt: 0,           // epoch-ms för aktuell fråga, 0 = ingen timer
  answers: {                   // en karta per fråga, skapas tom vid POST /games
    "0": { "<playerId>": { choice: 2, at: 1763550000123 } }
  }
}
```

- **Varför `answers` är en karta per fråga:** DynamoDB kan bara skriva till en nästlad nyckel
  om föräldrakartan finns. Därför skapas `answers: { "0": {}, "1": {}, ... }` direkt vid
  POST /games. Då blir varje svar en enda `SET answers.#q.#pid`.
- **Storlek:** en post får vara högst 400 KB. Med tak på 50 frågor och 100 deltagare blir det
  max ungefär 250 KB. Validera taken i POST /games och POST /players.
  *shortcut: allt ligger i en post; flytta svaren till egna poster (sort key) om taken behöver höjas.*
- **Bakåtkompatibilitet:** behövs inte. Live-spel lever bara 30 dagar (TTL), och de gamla
  spelen kan bara avslutas.

## 2. API (lambda.mjs)

| Metod | Route | Vem | Vad |
| --- | --- | --- | --- |
| `POST` | `/games` | värd | Skapar spel **med quiz**. Validerar allt (se nedan). Returnerar `hostToken`. |
| `GET` | `/games/{id}` | alla | Status. Med rätt `x-host-token` kommer allt med, annars ett nedskuret svar (se 2.2). |
| `POST` | `/games/{id}/players` | deltagare | Som i dag, men tillåts i alla faser utom `finished` (sena deltagare får 0 p på missade frågor). |
| `POST` | `/games/{id}/answers` | deltagare | **Ny.** `{ playerId, questionIndex, choice }`. |
| `PATCH` | `/games/{id}` | värd | **Utökas** till `{ action: "start" \| "reveal" \| "next" \| "end" }`. |

Ta bort `/scores`. Poängen räknas av servern. Lägg till rutten `POST /games/{id}/answers`
i API Gateway med samma Lambda-integration.

### 2.1 Validering i POST /games

- 1–50 frågor; text 1–200 tecken; 2–6 alternativ, 1–100 tecken var; `correct` är ett giltigt index.
- `timeLimitSec` är 0 eller 5–120.
- `scoring === "speed"` kräver `timeLimitSec > 0`, annars **400**.

### 2.2 Vad GET returnerar

Allt räknas fram i en ren funktion `publicState(game, { isHost, now })`:

- Alltid: `phase`, `currentIndex`, `questionCount`, `timeLimitSec`, `scoring`, `questionEndsAt`,
  `serverNow`, `joined` (namn), `answeredCount` för aktuell fråga.
- Under `question`: frågetext och alternativ för **aktuell** fråga, men **aldrig `correct`**.
- Under `reveal`: dessutom `correct`, fördelningen per alternativ, varje spelares
  `lastResult` (rätt/fel och poäng) och topplistan.
- Under `finished`: hela topplistan.
- Värden får dessutom hela `quiz`, så att värdens sida klarar en omladdning.

`serverNow` gör att klienterna kan räkna ut nedräkningen själva, även om mobilens klocka går fel:
`offset = serverNow - Date.now()` vid varje svar.

### 2.3 POST /answers – regler

- Avvisa med **409** om `phase !== "question"`, om `questionIndex !== currentIndex`, eller om
  `now > questionEndsAt + 1500` (1,5 s marginal för nätfördröjning).
- `at` sätts av **servern**, aldrig av klienten. Det skyddar mot fusk och fel klockor.
- Ett svar per person och fråga: `ConditionExpression: attribute_not_exists(answers.#q.#pid)`.
  Ett andra försök ger 409 `"Redan svarat"`, och klienten behandlar det som att svaret gick in.
  Det gör omförsök ofarliga.

### 2.4 PATCH – tillståndsmaskin

```
lobby ──start──▶ question(0) ──reveal──▶ reveal ──next──▶ question(i+1) … ──next(sista)──▶ finished
         alla faser ──end──▶ finished
```

- `start` och `next` sätter `currentIndex`, `startedAt[i] = now` och
  `questionEndsAt = timeLimitSec ? now + timeLimitSec*1000 : 0`.
- Varje övergång kräver rätt fas (`ConditionExpression #phase = :expected`). Två snabba klick
  hoppar då inte över en fråga.
- **Vem trycker på reveal?** Värdens sida gör det automatiskt när den ser att
  `answeredCount >= antal deltagare` eller att timern har gått ut, och värden kan trycka själv
  tidigare. *shortcut: frågan står still om värden stänger fliken; flytta logiken till servern
  (t.ex. i POST /answers) om det blir ett problem.*

### 2.5 Poäng – en ren funktion `scoreGame(game)`

```js
// per fråga och spelare
if (choice !== correct) return 0;
if (scoring === "correct") return 1;
const t = Math.min(1, (at - startedAt[i]) / (timeLimitSec * 1000));
return Math.round(1000 * (1 - t / 2));   // 1000 direkt, 500 precis vid gongen
```

- Lika poäng: vid snabbhet avgör lägst total svarstid, vid rätt/fel delas platsen
  (behåll dagens rankning 1, 1, 3).
- Skriv några `assert` direkt i en liten testfil (`live/score.test.mjs`) som täcker rätt, fel,
  snabbhet vid 0 s och vid timeout, samt lika poäng.

## 3. Frontend (live/)

`live/app.js` skrivs om. Det här återanvänds rakt av: `apiRequest`, `friendlyApiError`,
`startPolling`, `renderHostQr`, `joinUrl`, `toast`, `escapeHtml`, `celebrate` och
topplisterankningen ur `renderLeaderboard`. Formuläret och rättningen tas bort från live,
eftersom de finns i roten. `styles.css` delas med formuläret. Lägg nya klasser där, med
prefixet `live-`.

### 3.1 Värd

1. **Skapa quiz** – titel, timer (av/10/20/30/60 s), poängläge (rätt/fel / snabbhet; snabbhet
   är gråat när timern är av) och en lista med frågor (text, 2–6 alternativ, klick för att
   markera rätt svar, flytta upp/ner, ta bort). Utkastet sparas i `localStorage` medan du
   skriver. **Exportera/importera JSON** gör att ett quiz kan återanvändas och delas.
2. **Lobby** – spelkod, QR-kod, deltagarlista och knappen **Starta quiz**.
3. **Fråga** – stor frågetext, färgade alternativ, nedräkning, "7 av 9 har svarat" och knappen
   **Visa svar**. Sidan går själv till reveal när alla har svarat eller tiden är ute.
4. **Reveal** – rätt alternativ markeras, staplar visar hur många som valde vad, topp 5 och
   knappen **Nästa fråga** (eller **Visa resultat** efter sista frågan).
5. **Slut** – pall med topp 3, hela listan och confetti.

### 3.2 Deltagare

1. **Gå med** – namn och kod (som i dag, inklusive `?kod=` från QR-koden).
2. **Väntar** – "Du är med! Väntar på att värden startar …"
3. **Fråga** – stora knappar i alternativens färger, med frågetexten ovanför (så det fungerar
   utan storskärm) och nedräkningen. Efter ett tryck: "Svar inskickat" och knapparna låses.
4. **Reveal** – "Rätt! +840" eller "Fel", total poäng och placering.
5. **Slut** – slutplacering och topplistan.

### 3.3 Polling

| Fas | Intervall |
| --- | --- |
| lobby | 2 s |
| question | 1 s |
| reveal / finished | 2 s, stoppa vid `finished` |

- Behåll dagens regel att inte hämta när fliken är dold. Lägg till en hämtning direkt vid
  `visibilitychange`, så att en mobil som väcks hänger med på en gång.
- Rendera bara om när `phase` eller `currentIndex` ändras, eller när räknarna ändras. Det
  hindrar att knapparna flimrar.
- **Kostnad, grovt:** 30 deltagare × 1 anrop/s × 20 min ≈ 36 000 anrop per quiz. Det är
  några ören i Lambda och DynamoDB. Budgetlåset på $5 i README gäller fortfarande.

### 3.4 Omladdning och avbrott

- Deltagaren: `playerId` och `gameId` ligger i `localStorage`. Vid omladdning hämtas status och
  man hamnar direkt i rätt fas. Svaret på aktuell fråga visas som skickat om servern har det.
- Värden: `hostToken` och `gameId` ligger i `localStorage`. GET med token återställer allt.
- Ett misslyckat svar skickas om automatiskt tills tiden är ute. Ett 409 "Redan svarat"
  räknas som lyckat.

## 4. Ordning att bygga i

Varje steg går att testa för sig.

1. **Lambda – skapa och läsa:** ny datamodell, validering i POST /games, `publicState`, och
   `serverNow` i GET. Testa med `test-api.ps1`.
2. **Lambda – flöde:** PATCH-actions med fasvillkor och POST /answers med sina regler. Lägg till
   rutten i API Gateway och deploya.
3. **Lambda – poäng:** `scoreGame` med `score.test.mjs`. Koppla in i reveal och finished.
4. **Utöka `test-api.ps1`:** skapa quiz → två spelare går med → start → svara → dubbelsvar
   ger 409 → reveal → next → end. Kontrollera att `correct` **inte** syns för en spelare
   under `question`.
5. **Frontend – quizredigeraren** (bara lokalt, ingen server).
6. **Frontend – värdflödet:** lobby → fråga → reveal → slut.
7. **Frontend – deltagarflödet.**
8. **Provspel** med 3–4 mobiler på riktigt nät. Titta särskilt på nedräkningen, auto-reveal
   och omladdning mitt i en fråga.
9. Uppdatera README (live-avsnittet och API-tabellen) och `aws/deploy.ps1` så att `live/` laddas upp.

## 5. Risker att hålla koll på

- **Facit läcker:** `correct` får aldrig följa med till en spelare före reveal. Testas i steg 4.
- **Klockor:** använd bara serverns tid för poäng och deadline. Klientens tid används bara för
  att rita nedräkningen.
- **Dubbelklick på värdens knappar:** fasvillkoren i PATCH gör övergångarna idempotenta.
- **Värden försvinner:** spelet står still tills värden kommer tillbaka. Det är okej i v1.
- **Postens storlek:** taken i 2.1 måste hållas, annars börjar skrivningar fallera vid 400 KB.

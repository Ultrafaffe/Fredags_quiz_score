# Fredagsquiz

Två delar i samma repo:

- **Svarsformuläret** (`index.html`, `app.js`) &ndash; fristående. Skriv namn, välj upplägg,
  kryssa i svar och rätta själv med ✓/✗. Ingen server, ingen spelkod. Använd det när någon
  annan håller i quizet och rättningen görs manuellt.
- **Live** (`live/`) &ndash; en **värd** skapar ett spel och får en spelkod, deltagarna går med
  från mobilen, värden visar en fråga i taget på storskärmen och deltagarna svarar från mobilen. Servern
  rättar och räknar poäng, och topplistan visas mellan frågorna (Kahoot-stil).

## Kom igång

Ingen installation, ingen build – men öppna sidan via en **webbserver**, inte genom att
dubbelklicka på `index.html`. Med `file://` når sidan varken API:t eller QR-koden.

```powershell
# inbyggd server i repot (PowerShell, inget att installera)
powershell -ExecutionPolicy Bypass -File serve.ps1
# eller
python -m http.server 8000
# eller
npx serve .
```

Besök sedan `http://localhost:8123` (eller porten du valde).

Vill du testa mot det riktiga API:t behöver sidan nå `API_BASE_URL` i `live/app.js`.

## Så fungerar det

### Svarsformuläret (roten)

1. **Starta** &ndash; skriv namn, välj antal svarsalternativ (1&ndash;10), svarsdesign
   (A/B/C, 1/2/3 eller fritext), utslagsfråga och antal frågor (1&ndash;100).
2. **Svara** &ndash; kryssa i svarsalternativ, eller skriv fritext. Svaren sparas direkt i
   webbläsaren, så en oavsiktlig uppdatering tappar inget.
3. **Rätta** &ndash; i sammanfattningen sitter **✓** och **✗** på varje svarsruta. ✓ räknas som
   rätt i poängen, ✗ gör rutan röd.

### Live-quiz (`live/`)

1. **Skapa quiz (värd)** &ndash; titel, tid per fråga (av/10/20/30/60 s), poängläge och frågor
   med 2&ndash;6 alternativ. Klicka i rundknappen vid det rätta alternativet. Utkastet sparas i
   webbläsaren medan du skriver, och **Exportera/Importera JSON** gör att ett quiz kan
   återanvändas och delas. Tryck **Skapa spel**.
2. **Lobby** &ndash; spelkod och QR-kod visas. Deltagarna skriver namn och kod (eller skannar)
   och dyker upp i listan. Tryck **Starta quiz**.
3. **Fråga** &ndash; frågan och de färgade alternativen visas hos alla, med nedräkning.
   Deltagaren trycker på ett alternativ och knapparna låses. Frågan stängs när **alla har
   svarat**, när **tiden** är ute, eller när värden trycker **Visa svar**.
4. **Reveal** &ndash; rätt svar markeras, staplar visar hur många som valde vad, och topp 5
   visas. Deltagaren ser "Rätt! +840" eller "Fel" och sin placering. **Nästa fråga**.
5. **Slut** &ndash; hela topplistan och confetti, hos värden och hos alla deltagare.

**Poäng:** *Rätt/fel* ger 1 p per rätt svar, och lika poäng delar plats (1, 1, 3).
*Snabbhet* (kräver timer) ger 1000 p för ett direkt rätt svar och 500 p precis vid gongen.
Lika poäng avgörs då av lägst total svarstid. Svarstiden mäts av servern, inte mobilen.

**Omladdning:** både värd och deltagare hamnar i rätt fas efter en omladdning (spelet ligger
i `localStorage`). Ett svar som inte gick fram skickas om automatiskt tills tiden är ute.

**Om värden stänger fliken** står frågan still tills värden öppnar sidan igen &ndash; det är
värdens sida som går vidare till reveal.

### Tangentbord (på kvällen är det snabbast)

| Tangent | Funktion |
| --- | --- |
| Valda svarstangenter | Svar på den aktuella frågan |
| `↑` `↓` (eller `K` `J`) | Byt fråga |
| `Home` / `End` | Hoppa till första/sista frågan |

Antalet frågor kan ändras både före och under quizen – redigerade frågor behåller sina svar.

## API:t

`live/app.js` pratar med en Lambda bakom API Gateway (`API_BASE_URL` högst upp i `live/app.js`),
lagringen är en DynamoDB-tabell (`TABLE_NAME`). Lambdan består av `lambda.mjs` (routes och
DynamoDB) och `game.mjs` (ren spellogik: validering, poäng, faser, vad som får visas).
**Båda filerna ska deployas.**

| Metod | Route | Beskrivning |
| --- | --- | --- |
| `POST` | `/games` | Skapar spel med `{ hostName, quiz }`. Validerar quizet (1&ndash;50 frågor, 2&ndash;6 alternativ, timer 0 eller 5&ndash;120 s, snabbhet kräver timer &ndash; annars **400**). Returnerar **enbart här** `hostToken`. |
| `GET` | `/games/{id}` | Spelets läge: fas, aktuell fråga, `joined`, `answeredCount`, `serverNow`. Facit, fördelning och topplista följer bara med under reveal/slut. Med rätt `x-host-token` kommer hela quizet med. |
| `POST` | `/games/{id}/players` | Går med (`playerId` + `name`). Tillåts i alla faser utom slut (annars **409**). Max 100 deltagare. |
| `POST` | `/games/{id}/answers` | Svar `{ playerId, questionIndex, choice }`. **409** om frågan är stängd, tiden är ute (+1,5 s marginal) eller spelaren redan svarat. **403** om spelaren inte gått med. |
| `PATCH` | `/games/{id}` | Värden styr med `{ action: "start" \| "reveal" \| "next" \| "end" }`. Kräver `x-host-token` (annars **403**). Fel fas ger **409**, så ett dubbelklick hoppar inte över en fråga. |

CORS sätts i Lambda-svaren (`access-control-allow-headers: content-type,x-host-token`).
Om du istället styr CORS i API Gateway måste `x-host-token` finnas med i *Allowed headers*,
annars faller `PATCH` tyst i webbläsaren.

Rutterna `POST /games/{id}/players` och `POST /games/{id}/answers` måste finnas i API Gateway
med samma Lambda-integration. Rutten `/scores` används inte längre och kan tas bort.

**Tester:** `node --test` kör spellogiken (`game.test.mjs`) lokalt. `test-api.ps1` kör hela
flödet mot det riktiga API:t (skapa → gå med → start → svara → reveal → nästa → slut) och
kontrollerar att facit inte syns för deltagare under en fråga.

### Nätverk

- Alla anrop har en **8 sekunders timeout**.
- Live-sidan hämtar läget **varje sekund under en fråga** och var 2:a sekund annars, bara när
  fliken är synlig. När fliken blir synlig igen hämtas läget direkt. Pollningen slutar när
  spelet är slut. Grovt räknat blir det ~36 000 anrop för 30 deltagare i 20 minuter.

## Övriga finesser

- **Valfritt antal frågor via länk:** `index.html?frgor=25` (eller `?questions=25`) startar
  svarsformuläret direkt med 25 frågor.
- **QR-kod i värdvyn:** bredvid spelkoden visas en QR-kod som pekar på
  `live/?kod=ABCDE`. Den som skannar får spelkoden ifylld och behöver bara skriva
  sitt namn och trycka **Gå med**. Parametern `?kod=` (eller `?code=`) fungerar även att
  klistra in manuellt, och städas bort från adressfältet när den använts.
  QR-koden ritas lokalt av `qrcode.js` (MIT, Kazuhiko Arase) – ingen extern tjänst.
- **Fritext:** svarsdesignen `text` visar ett textfält per fråga i stället för A–D, och
  svarsrutorna i rättningsvyn blir bredare så svaret får plats bredvid ✓/✗.
- **Utskriftsvyn** färgmarkera rätt/fel och döljer knappar, så rättningslistan går att skriva ut.
- **Sparat lokalt:** i svarsformuläret ligger namn, svar och markeringar bara i
  `localStorage`. I live-quizet skickas varje svar till servern.

## Filer

| Fil | Innehåll |
| --- | --- |
| `index.html`, `app.js` | Fristående svarsformulär: inställningar, svar, rättning, confetti |
| `live/index.html`, `live/app.js` | Live-quizet: gå med, quizredigerare, värdvy (lobby/fråga/reveal/slut), deltagarvy, polling |
| `styles.css` | Fredagsquiz-temat (delas av båda), responsiv layout, utskriftsstilar |
| `qrcode.js` | QR-generator (MIT, Kazuhiko Arase) som ritar koden i live-värdvyn |
| `serve.ps1` | Liten statisk server för lokal testning (`http://localhost:8123`) |
| `lambda.mjs` | API:ns handler: routes, DynamoDB, värdtoken |
| `game.mjs`, `game.test.mjs` | Ren spellogik (validering, poäng, faser, publikt läge) och dess tester (`node --test`) |
| `test-api.ps1` | Smoke-test av hela live-flödet mot API:t |
| `aws/` | CloudFormation (S3 + CloudFront), `deploy.ps1`, Amplify-config |

## Drift i AWS

- **Budgetlås:** lägg en budget på $5 (Billing → Budgets → Create budget) med e-postalert.
  Det är din skyddsnät om ett fel någonsin startar en pollnings-loop.
- **Deploy:** `aws/deploy.ps1` laddar upp statiken och invaliderar CloudFront-cache. Se till
  att den laddar upp `live/` också. Lambdan deployas med både `lambda.mjs` och `game.mjs`.
- **TTL:** aktivera DynamoDB TTL på tabellen med attributet `expiration_time`. Lambda sätter
  attributet till 30 dagar efter att spelet skapades, så gamla spel och resultat städas bort
  automatiskt (DynamoDB tar bort dem inom några dagar efter utgången tid).

## Anpassa

- **Färger:** ändra variablerna i `:root` överst i `styles.css` (`--ok`, `--bad` styr
  rätt/fel-markeringarna).
- **Gränsen 1&ndash;100 frågor:** konstanten `MAX_COUNT` i `app.js`.
- **Snabbvalen 5&ndash;50:** `data-count`-värdena på knapparna i `index.html`.
- **Pollningstakten:** `pollInterval()` i `live/app.js` (1 s under fråga, annars 2 s).
- **Taken för quiz och deltagare:** `MAX_QUESTIONS` och `MAX_PLAYERS` i `game.mjs`. En
  DynamoDB-post får vara högst 400 KB, så höj inte taken utan att flytta svaren till egna poster.
- **Lagringstid:** konstanten `GAME_TTL_SECONDS` i `lambda.mjs` (standard 30 dagar). Kräver att
  TTL är aktiverat på attributet `expiration_time` i DynamoDB.

# Fredagsquiz &middot; Svarsformulär

Ett svarsformulär i Fredagsquiz-tema för kvällens quiz: en **värd** skapar ett spel och får en
spelkod, alla andra går med på koden från sina egna mobiler, kryssar i sina svar, rättar dem
och sparar sitt resultat. Värden ser hur många som skickat in – och topplistan dyker upp så
fort spelet avslutas.

Inga frågor och inga rätta svar ligger i appen: själva rättningen gör du i sammanfattningen.

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

Vill du testa mot det riktiga API:t behöver sidan nå `API_BASE_URL` i `app.js`.

## Så fungerar det

1. **Skapa spel (värd)** &ndash; skriv namn, välj antal svarsalternativ (1&ndash;10), svarsdesign
   (A/B/C, 1/2/3 eller fritext), utslagsfråga och antal frågor (1&ndash;100). Tryck **Starta**,
   så får du en femtecknig **spelkod** att dela.
2. **Gå med (deltagare)** &ndash; skriv namn och spelkod, så låses spelets inställningar och
   formuläret fylls i. Antalet frågor kan inte ändras av den som gått med.
3. **Svara** &ndash; kryssa i svarsalternativ, eller skriv fritext när quizmästaren valt det.
   Svaren sparas direkt i webbläsaren, så en oavsiktlig uppdatering tappar inget.
4. **Rätta** &ndash; i sammanfattningen sitter **✓** och **✗** på varje svarsruta. ✓ räknas som
   rätt i poängen, ✗ gör rutan röd. Tomma rutor går också att markera.
5. **Spara resultat** &ndash; skickas till API:t. Värden ser uppdaterad räknare ("1 har skickat
   in") inom ~10 sekunder, och när spelet avslutas visas topplistan hos alla som sparat.

### Tangentbord (på kvällen är det snabbast)

| Tangent | Funktion |
| --- | --- |
| Valda svarstangenter | Svar på den aktuella frågan |
| `↑` `↓` (eller `K` `J`) | Byt fråga |
| `Home` / `End` | Hoppa till första/sista frågan |

Antalet frågor kan ändras både före och under quizen – redigerade frågor behåller sina svar.

## API:t

`app.js` pratar med en Lambda bakom API Gateway (`API_BASE_URL` högst upp i `app.js`),
lagringen är en DynamoDB-tabell (`TABLE_NAME`). Lambdan ligger i `lambda.mjs`.

| Metod | Route | Beskrivning |
| --- | --- | --- |
| `POST` | `/games` | Skapar spel + spelkod. Returnerar **enbart här** en `hostToken` som sparas i värdens webbläsare. |
| `GET` | `/games/{id}` | Hämtar spel, inställningar och spelare. `hostToken` strippas alltid. |
| `POST` | `/games/{id}/scores` | Sparar ett resultat. Kräver `status = active` (annars **409**) och `score` heltal `0…questionCount` (annars **400**). |
| `PATCH` | `/games/{id}` | Avslutar spelet. Kräver header `x-host-token` (annars **403**) – endast värden kan avsluta. |

CORS sätts i Lambda-svaren (`access-control-allow-headers: content-type,x-host-token`).
Om du istället styr CORS i API Gateway måste `x-host-token` finnas med i *Allowed headers*,
annars faller `PATCH` tyst i webbläsaren.

### Nätverk

- Alla anrop har en **8 sekunders timeout** – istället för att hänga får du "Svarar inte –
  kontrollera nätverket".
- Misslyckas sparningen av resultatet försöker sidan **igen automatiskt** så fort nätet är
  tillbaka (`online`-händelsen).
- Vyn pollar API:t var **10:e sekund** (bara när fönstret är synligt) och slutar så fort
  spelet avslutats eller du byter vy.

## Övriga finesser

- **Valfritt antal frågor via länk:** `index.html?frgor=25` (eller `?questions=25`) startar
  direkt med 25 frågor – praktiskt när quizledaren delar ut samma länk till alla.
- **QR-kod i värdvyn:** bredvid spelkoden visas en QR-kod som pekar på
  `index.html?kod=ABCDE`. Den som skannar får spelkoden ifylld och behöver bara skriva
  sitt namn och trycka **Gå med**. Parametern `?kod=` (eller `?code=`) fungerar även att
  klistra in manuellt, och städas bort från adressfältet när den använts.
  QR-koden ritas lokalt av `qrcode.js` (MIT, Kazuhiko Arase) – ingen extern tjänst.
- **Fritext:** svarsdesignen `text` visar ett textfält per fråga i stället för A–D, och
  svarsrutorna i rättningsvyn blir bredare så svaret får plats bredvid ✓/✗.
- **Utskriftsvyn** färgmarkera rätt/fel och döljer knappar, så rättningslistan går att skriva ut.
- **Sparat lokalt:** namn, svar och markeringar ligger i `localStorage` i deltagarens egen
  webbläsare. Bara resultat och spelstatus skickas till servern.

## Filer

| Fil | Innehåll |
| --- | --- |
| `index.html` | Sidans struktur: start, värdvy, svarsformulär, sammanfattning |
| `styles.css` | Fredagsquiz-temat (neonpub), responsiv layout, utskriftsstilar |
| `app.js` | Spelkod/flöde, svarsval, rättning, sparning, polling, confetti |
| `qrcode.js` | QR-generator (MIT, Kazuhiko Arase) som ritar koden i värdvyn |
| `serve.ps1` | Liten statisk server för lokal testning (`http://localhost:8123`) |
| `lambda.mjs` | API:ns handler: spel, resultat, värdtoken, validering |
| `test-api.ps1` | Smoke-test mot API:t (skapar spel, testar token och 409) |
| `aws/` | CloudFormation (S3 + CloudFront), `deploy.ps1`, Amplify-config |

## Drift i AWS

- **Budgetlås:** lägg en budget på $5 (Billing → Budgets → Create budget) med e-postalert.
  Det är din skyddsnät om ett fel någonsin startar en pollnings-loop.
- **Deploy:** `aws/deploy.ps1` laddar upp statiken och invaliderar CloudFront-cache.

## Anpassa

- **Färger:** ändra variablerna i `:root` överst i `styles.css` (`--ok`, `--bad` styr
  rätt/fel-markeringarna).
- **Gränsen 1&ndash;100 frågor:** konstanten `MAX_COUNT` i `app.js`.
- **Snabbvalen 5&ndash;50:** `data-count`-värdena på knapparna i `index.html`.
- **Pollningstakten:** tredje argumentet i `startPolling(fn, ms)` i `app.js` (standard 10000).

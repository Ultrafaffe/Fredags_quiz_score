# Fredagsquiz &middot; Svarsformulär

Ett svarsformulär i Fredagsquiz-tema: deltagaren väljer **hur många frågor** kvällen har och
kryssar sedan i sina svar **A–D**. Inga frågor och inga rätta svar ingår – det här är
enbart ett formulär att skriva svar i.

## Kom igång

Ingen installation, ingen build. Öppna `index.html` i webbläsaren – eller kör en enkel
statisk server om du vill testa som på riktigt:

```powershell
python -m http.server 8000
# eller
npx serve .
```

Besök sedan `http://localhost:8000`.

## Så fungerar det

1. **Start** &ndash; skriv namn, välj antal svarsalternativ (1&ndash;10), välj svarsdesign
  (bokstäver eller siffror) och välj antal frågor (1&ndash;100).
2. **Svar** &ndash; kryssa i valt svarsalternativ för varje fråga. Svaren sparas direkt i
  webbläsaren, så en oavsiktlig uppdatering tappar inget.
3. **Skicka in** &ndash; en sammanfattning visar alla svar, med knappar för att redigera
  eller börja om.

### Tangentbord (på kvällen är det snabbast)

| Tangent | Funktion |
| --- | --- |
| Valda svarstangenter | Svar på den aktuella frågan |
| `↑` `↓` (eller `K` `J`) | Byt fråga |
| `Home` / `End` | Hoppa till första/sista frågan |

Antalet frågor kan ändras både före och under quizen – redigerade frågor behåller sina svar.

## Övriga finesser

- **Valfritt antal frågor via länk:** `index.html?frgor=25` (eller `?questions=25`) startar
  direkt med 25 frågor – praktiskt när quizledaren delar ut samma länk till alla.
- **Inga frågor, inga poäng:** formuläret vet aldrig vad frågorna heter eller vilket svar som är
  rätt. Rättningen sker utanför sidan.
- **Inget konto, ingen server:** allt ligger i `localStorage` i deltagarens egen webbläsare.
  Ingenting skickas någonstans.

## Filer

| Fil | Innehåll |
| --- | --- |
| `index.html` | Sidans struktur: start, svarsformulär, sammanfattning |
| `styles.css` | Fredagsquiz-temat (neonpub), responsiv layout, utskriftsstilar |
| `app.js` | Frågegenerering, svarsval, tangentbord, sparning, sammanfattning, confetti |

## Anpassa

- **Färger:** ändra variablerna i `:root` överst i `styles.css`.
- **Gränsen 1&ndash;100 frågor:** konstanten `MAX_COUNT` i `app.js`.
- **Snabbvalen 5&ndash;50:** `data-count`-värdena på knapparna i `index.html`.

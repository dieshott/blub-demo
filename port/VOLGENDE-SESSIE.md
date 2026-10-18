# Volgende sessie: werkplan

Startpunt: `main` op 35c186b (engine 28, twee reviewrondes, het nieuwe kanon).
**Let op:** de bronrepo kent engine 28 en het nieuwe kanon nog niet. Een `npm run
sync` overschrijft ze, tenzij ze eerst zijn overgezet (zie `port/README.md` en
`port/engine-27-to-28.diff`).

Tests staan in `port/tests/`. Draai ze vanuit de map met de build:
- `node port/tests/t28.js index.html 1500`: crashes, determinisme en kratten
- `node port/tests/chk28.js <oud.html> index.html 1000`: vergelijkt oud met nieuw
- `node port/tests/smokef.js fast 1 2 3 12`: browser, ook de onderschepte
  tekenfouten
- `node port/tests/stress.js index.html desktop 2`, en daarna `phone`: tempo,
  canvas-lekken en fouten
- `node port/tests/rperf.js oud.html index.html`: rekentijd per frame
- `node port/tests/shotw.js <n> <seed> <prefix> <tijden>`: screenshots

## 1. Kansdrops vallen direct op de Blub en werken meteen
Wens: de krat die de 5%-kans oplevert, landt direct op de Blub en activeert meteen.
Bij het oppakken komt er een gloed om die Blub: rood, groen of goud.

Aanpak:
- In `boxTurn`: geen `boxSpot`, geen ophaler en geen wachtende krat meer. De krat
  valt direct op de Blub die de kans won, net als de supply drops in de regen.
  - Groen of rood: event `drop` met `box: 1`, daarna `dropHit`.
  - Goud: `openGold(t, u, g, [u.x, u.y], turn, 'box')`.
- Het ophalen achter een schakelaar zetten (`RULES.boxFetch: false`) in plaats van
  het te verwijderen. Dat geldt voor `fetchBox`, `fetcher`, `pinned`, `k.had`,
  `boxReach`, `mistBoxes` en `pickBox`. Laat de rng-trekkingen per beurt gelijk, zodat
  de andere streams niet verschuiven.
- View: een gloed om de Blub (een pulserende ring en een aura van zo'n 1,2 s in
  `#4BE08F` voor groen, `#FF5C77` voor rood en `#FFD447` voor goud). Leg de beat
  vast in `boxBeat` of in de `drop`-fx, en houd hem stil bij "rustig". Werk de
  Round info-tekst ("Chance drops") en `describe('box')` bij.
- Daarna balans meten: per perk de winkans tegenover `chancePct = 0`, en de
  bias per kant.

## 2. De pizza wordt te weinig gegeten
Gemeten in engine 28 (2402 pizzadozen):
- Gemiddeld worden **2,08 van de 6 punten** gegeten, goed voor ongeveer 16 HP per doos.
- **33% van de dozen** wordt nooit aangeraakt. Maar 11% gaat helemaal op.
- Oorzaak: `pizzaRun` werkt alleen als de doos binnen één beurt lopen ligt
  (`search(u, u.move, …)`), de Blub op 60% HP of minder staat en er niemand in
  reikwijdte is. Blubs die verder weg staan, komen nooit terug.

Voorgesteld mechanisme, liefst een combinatie:
- **Bezorgen:** de Blub met de telefoon gooit één keer per beurt een punt naar de
  zwaarst gewonde teamgenoot binnen 3 tegels die op 60% HP of minder staat. Dat
  kost zijn beurt niet, en er vliegt een punt pizza door de lucht.
- **Terug naar de doos:** een Blub op 40% HP of minder, zonder vijand binnen 2
  tegels, loopt ook over meerdere beurten naar de doos, tot hooguit 2 beurten ver.
- Meten: gegeten punten per doos (doel 4–5), dozen die onaangeroerd blijven (doel
  onder 10%), en de winkans van het team met de pizza.

## 3. Diamond Hand: 3/3/3 in plaats van 2/2/2
Eén regel: `diamondDmg: 2` wordt `diamondDmg: 3` (RULES, rond regel 3963). De tekst
in het spel leest het getal uit RULES en past zich dus vanzelf aan. Daarna de
winkans meten van het team dat de Diamond Hand claimt.

## Suggesties
1. **Perks in kratten voelen zwak** (review, 24.000 rondes): WAGMI, Pump, Dev Wallet,
   Paper Hands en Gas Fees maken nauwelijks verschil (rond ±0,5 procentpunt). Sniper
   Bot (+5,2) en NGMI (−2,9) zijn de uitschieters. Voorstel uit de review:
   - `wagmiHp` 1 → 6
   - `pumpDmg` 1 → 2, en `pumpTurns` 3 → 5
   - `devwalletShare` 40 → 70
   - `paperTurns` 1 → 2
   - `gasHp` 2 → 4

   Dit verandert de regen ook mee. Kies dus bewust, of maak er waarden speciaal
   voor kansdrops van.
2. **De Big Gun** heeft nog zijn oude tekening, terwijl het 2x2-kanon nu
   gedetailleerd is. Teken hem in dezelfde stijl: 3x3, met een gouden band.
3. **Bouwfase 2 van het kanon** zie je nooit, want een bouw duurt maar 2 stappen.
   Maak de bouw visueel 3 stappen, of laat fase 2 kort tussendoor zien.
4. **De dubbelganger** van de Coin Flip wint nog 64,6% van de rondes na kop
   (zonder Coin Flip ongeveer 50%). Munt staat tegenover Blub weg, dus misschien is
   dat prima. Even meten wat de Coin Flip in totaal oplevert.
5. **Overzetten naar de bronrepo** heeft de hoogste prioriteit voor het andere
   account, anders gaan engine 28 en het kanon verloren bij de volgende sync.
6. **Review van de laatste fixronde:** de lens die de nieuwste engine-fixes
   (fixes28) zou controleren, liep tegen de sessielimiet aan. Draai die review
   nog een keer.

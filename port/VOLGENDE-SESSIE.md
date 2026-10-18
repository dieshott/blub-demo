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

Voorgesteld mechanisme, een combinatie. **De eigenaar is akkoord met dit voorstel.**
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

## 4. Coin Flip: munt wordt een doodshoofd
Wens: de muntzijde (nu de `$` van $BLUB) wordt een kruis of doodshoofd, omdat munt
betekent dat de Blub uit de ronde ligt.
- De art staat in `FX_ART.flipcoin` (rond regel 13658, 16 px, 7 frames):
  - frame 0: kop (de Blub);
  - frames 1–5: de draaiing;
  - frame 6: munt, nu de `$`.
- Teken een doodshoofd op frame 6 (en het begin ervan op frames 4–5): wit/`S` met
  `k`-oogkassen, of een zwart kruis op goud. Mijn voorstel is een doodshoofd: dat leest
  op 16 px duidelijker dan een kruis, en een kruis lijkt op het rode kruis van de
  Medic.
- Pas ook het icoon (`ICONS.gold.coin` / `gb_coin`) en de teksten aan, waar die
  "tails" of de `$` noemen.

## 5. Big Gun (3x3): de Blub met de Blueprint zit erin en is deels beschermd
Wens: de Big Gun opnieuw tekenen in de stijl van het nieuwe 2x2-kanon. De Blub die de
gouden Blueprint krijgt, gaat in het kanon zitten en is daar deels beschermd tegen
schade, tot het kanon uitgeschakeld is of hij doodgaat.

Uitwerking:
- **Engine:**
  - Zodra de Big Gun af is, stapt de Blueprint-Blub (de `crew`, of de `engineer`
    als er geen eigen Builder is) erin, als een `ride`. Hij beweegt niet meer en
    bedient het kanon.
  - Schade aan die Blub wordt verminderd met `bigGuard`%. Voorstel: 50%.
  - Hij stapt eruit (en vecht weer gewoon) zodra het kanon op 0 HP staat
    (`broken`), en tot een reparatie.
  - Gaat hij KO, dan is het kanon niet bemand. Het vuurt dan minder vaak of niet,
    en dat moet nog gebalanceerd worden.
  - Zijn eigen wapen gebruikt hij niet. Mogelijk krijgt de Big Gun een iets kortere
    reload zolang er iemand in zit.
  - Hergebruik waar het kan de ride-logica van de Green Candle en de Diamond Hand
    (`ride`, `rideOk`, `dump`, `anchored`).
- **View:**
  - De Blub zichtbaar in de stuurstoel of achter een schild van de Big Gun.
  - Een schild-icoon bij zijn HP-balk zolang hij beschermd is.
  - Bij `broken` springt hij eruit.
  - De nieuwe 3x3-tekening heeft dezelfde lagen als het 2x2-kanon: onderstel,
    wielen, loop met gouden band, schade, wrak en bouwfases.
- **Balans meten:** de winkans van het team met de Blueprint (nu een gouden drop
  met +6,7 punten winkans gemiddeld), de schade die de schutter incasseert, en hoe
  vaak het kanon tot het einde van de ronde bemand blijft.

## 6. Coin Flip: gouden doodshoofd, en direct flippen van het rad (nieuw)
Het doodshoofd staat er al (engine 29). Nog te doen:
- **Gouden doodshoofd:** het doodshoofd wordt goudkleurig in plaats van bot-wit,
  bijvoorbeeld in reliëf in het goud zoals de Blub-kop op de kopzijde (`A`/`o`/`y`/`Y`
  met een `k`-rand voor de oogkassen). Pas `SKULL` aan in `FX_ART.flipcoin`
  (frames 4–6).
- **Van het rad betekent direct flippen:** komt de munt van het rad van de Gambler
  (`openGold(..., 'gamble')`), dan flipt de Blub hem **aan het begin van zijn
  volgende beurt**. Hij wacht dus niet op lage HP of op `coinBy`. Zet daarvoor
  `coins[t].flipBy = turn + 1` als de bron `'gamble'` is, en laat `coinHurt` het
  niet uitstellen.
- **Dood zonder flip betekent nooit meer:** gaat de Blub KO voordat hij flipte, dan
  doet de munt de rest van de match niets meer. Vandaag flipt hij hem nog bij het
  neergaan (`flipCoins(d.team, true)` in `knockOut`), en kop brengt dan nog de
  dubbelganger. Die flip bij het neergaan vervalt. Hij geldt ook niet in latere
  rondes van de match: per team en per match onthouden, dus ook in `matchRounds`.
  Overleg nog of dat alleen voor de munt van het rad geldt of voor elke munt.
- Teksten (`GOLDS` 'coin', Round info en de log) aanpassen. Daarna meten: winkans
  met de munt, en hoe vaak hij verloren gaat.

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
2. (De Big Gun staat nu als punt 5 hierboven.)
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

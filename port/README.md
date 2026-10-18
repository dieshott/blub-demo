# Engine 28: overzetten naar de bronrepo

De demo (`index.html`) draait nu op **engine 28**. Die is hier rechtstreeks in
`index.html` gebouwd, bovenop engine 27 (ee1ba63). De bronrepo (`lib/squad.mjs`,
`src/squad/*`) kent deze code nog niet. **Een volgende `npm run sync` overschrijft
engine 28 dus weer**, net zoals eerder met engines 22 en 23 gebeurde. Zet de
wijzigingen eerst over naar de bron en sync pas daarna.

## Wat hier staat

- `engine-27-to-28.diff`: de volledige diff van `index.html`, van engine 27
  (ee1ba63) naar engine 28. Daar zitten ook de golden drops van engine 22 in, die
  opnieuw zijn ingebouwd.
- In `index.html` is elke wijziging gemarkeerd. Zoek op `engine 28` en `engine 22`
  om ze terug te vinden.

## Wat er in engine 28 zit

### 1. Chance drops (vervangen de teamkrat aan het begin van de ronde)
- `RULES.chancePct: 5`: elke beurt krijgt een team dat nog geen krat heeft gehad
  5% kans per levende Blub. Bij Supply Drop Rain is dat `chanceRain: 2` keer zo veel.
- De krat landt binnen `boxNear: 3` tegels van die Blub, in zijn zicht en buiten de
  mist. Groen of rood is even waarschijnlijk, met een perk uit `DROPS`.
- Ophalen is verplicht. De dichtstbijzijnde Blub van het team loopt erheen, en valt
  die uit, dan neemt de volgende het over. De perk is voor de Blub die de krat pakt.
- Er komt maximaal één krat per team per ronde. Komt de mist er eerder, dan is de
  krat weg (`boxgone`).
- `goldPct: 1`: 1% per Blub per ronde (×2 in de regen) dat de krat van die ronde
  goud is (`GOLDS`).
- `teamCrate: false`: de oude teamkrat. De code bestaat nog, als schakelaar. Als hij
  uit staat, geeft `chestSpin` ook geen teambuff of -nerf meer; ze worden nog wel
  getrokken, zodat de stream gelijk blijft.
- `boxReach: 4`: de ophaalplicht gaat alleen over op een Blub die binnen 4 tegels van
  de krat staat en niet vastzit (verstrikt, gevangen of vastgehouden door een
  Guardian). Is er niemand, dan wacht de krat.
- Een golden crate krijgt zijn soort vast toegewezen zodra hij landt (`goldFor`,
  `goldHad`), zodat de tekst klopt met wat eruit komt. `boxgone` heeft een
  `why`: `mist`, `nuke` of `crushed`.
- Engine-functies: `boxTurn`, `fetchBox`, `pickBox`, `mistBoxes` en `openGold`.
  De nieuwe rng-stream is `BOX_SALT = 7`, met een vast aantal trekkingen per beurt.
- View: de beats `box`, `boxgone` en `gopen`, verder `drawBox` en de sectie
  "Chance drops" in Round info.

### 2. De Gambler (power, één per team)
- In zijn eerste beurten blijft hij in zijn spawn en draait hij aan het rad, één
  keer per beurt. Hij heeft `gambleGold: 25`% kans op een golden drop; de rest is
  rood en levert niets op.
- Het aantal beurten hangt af van zijn stance (`gambleSpins`): attack 3, middle 4,
  evade 4, hold 5. De laatste draai is **ALL IN**, met `gambleAllIn: 50`% kans.
- Bij zijn eerste golden drop stopt hij, op zijn hoogtepunt.
- Spins worden geteld (`u.spins`). Een gemiste spin, bijvoorbeeld door bevriezing,
  haalt hij binnen `gambleLate: 2` extra beurten in. De laatste spin is altijd
  ALL IN. Een Gambler die nog draait, wordt niet gekozen voor de Green Candle, de
  Diamond Hand, de Lambo of de stunt cannon.
- Engine: `gamble(u, turn)` en `gambleTurn()`. Die laatste trekt elke beurt 4 waarden
  per unit-slot uit `GAMBLE_SALT = 8`, dus een vast aantal trekkingen. View: de beat
  `gamble` (het rad, `wheelLayout`). Een rode spin die niet de laatste is, is kort
  (`MS.gambleQ`). Verder `ICONS.pow.gambler`.
- Gemeten in de simulaties: de Gambler krijgt in ongeveer 70% van de rondes goud
  en ALL IN valt ongeveer 50% raak. De winrate van de power ligt rond de 50%.

### 3. Golden drops (engine 22, opnieuw ingebouwd, nu midden in de ronde te openen)
- De zes uit `GOLDS`: Big Gun Blueprint, Shiba Inu, Ray Gun, Coin Flip, Pizza Phone
  en Pump.fun Pill.
- Een team krijgt elke golden drop hooguit één keer (`goldHad`). Daarnaast:
  `goldGrace: 4` en `pizzaWait: 2`.
- De Coin Flip-dubbelganger krijgt `foxhole`, `ammo` en `gambled`. Zonder `ammo`
  deed elke treffer NaN schade en schakelde die de Blub in één klap uit.
- Een Blueprint die laat opent, mag nog `cannonStart` beurten na het openen een
  kanon uitzetten (`meme.printAt`). Staat het kanon van het team al, dan helpt
  hij dat afbouwen en repareren.
- De kooi van de Shiba komt op een vrije tegel naast de krat (`perk.dog`).
- Tunnels en terugkeer uit het Field Hospital of de Rug Pull landen nooit op een
  krat die nog moet worden opgehaald.

### 4. Fixes uit de review van engine 27
- Mist: een Blub die uit de mist wil maar eerst opzij moet, bleef staan tot hij KO
  ging. Nu loopt hij door (`walk(..., out)`). `leaveMist` kiest eerst een veilige
  tegel die hij deze beurt nog haalt (`search(..., plain)`), en als een route
  geblokkeerd is probeert hij de volgende.
- Field Hospital: een Blub kan niet meer op de brancard als hij pas na beurt 20
  terug zou komen. `standing()` telt alleen nog Blubs die op tijd terug kunnen
  komen.
- Een Airdrop zet een Rage Mode die al aan staat niet opnieuw klaar. Daardoor geen
  dubbele Rage meer en geen Gas Fees of Sniper Bot voor niets.
- Een knock-out wist de statussen van supply drops (Pump, Bagholder, Gas, NGMI en
  Paper), net als de view al deed.
- Pump en Bagholder tellen ook de beurt mee waarin de Rug Pull de Blub weghaalt.
- View: de Sniper Bot of Paper Hands uit een supply drop markeert de chip van de
  kist niet meer als gebruikt (`paper` heeft nu `drop: 1`).
- View: bij twee kratten in één beurt landt de eerste eerst.
- View: de rand van de mist schuift alleen naar buiten, zodat een veilige tegel
  nooit roze wordt getekend.
- Teksten: Alpha Leak noemt nu ook de Sniper Bot, en NGMI zegt "swing or shot at a
  Blub".

### 5. Renderer (het onzichtbare-arena-probleem)
- De canvas-state wordt elke frame gereset (`freshCtx`). Elk draw-item heeft zijn
  eigen `guard` met save/restore. Een fout in één effect haalt dat effect weg in
  plaats van de rest van de frame.
- Canvassen gebruiken `willReadFrequently` (software), zodat ze niet leeg raken
  als de GPU-context wegvalt.
- In `frame()` en `runQ` vangt elke stap zijn eigen fouten af (`fault`, die ook
  `window.__sqvFaults` telt). De klok en het tempo lopen dan gewoon door.

## Advies voor de bronrepo
1. Pas de diff toe op de gegenereerde build, of zet per `engine 28`-marker de code
   over naar `lib/squad.mjs` (engine) en `src/squad/*` (view).
2. Draai daarna `npm run sync` en vergelijk de nieuwe `index.html` met deze. Op
   wat de sync zelf genereert na hoort het verschil leeg te zijn.

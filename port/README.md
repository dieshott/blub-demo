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

### 6. Tweede reviewronde
- Ophalen: als er al een ophaler is geweest, gaat de plicht niet meer over zolang
  er een vijand binnen 2 tegels van de krat staat (`k.had`). Rondes waarin een team
  twee of meer ophalers verliest: van 15 naar 1 per 3000.
- `leaveMist` kiest eerst een uitweg waar geen screen of val op ligt. `walk(..., out)`
  stopt nooit zijwaarts in de mist naast een screen.
- De Coin Flip-dubbelganger komt met zijn HP in beeld (`coin.hp`), niet meer op 0.
- Close-up: het zichtbare canvas wordt pas in `cutIn` gereset. De overlays zijn
  gewrapt in een guard, en een fout in `follow` valt terug op het vaste punt. Een
  fout tijdens een close-up laat het veld dus niet meer leeg.
- Een verborgen tab pauzeert ook de clip-opname.

### 7. Het nieuwe kanon van de Builder
- Een klassiek veldkanon in pixel art. In `index.html` staan de data in `CANNON_ART`
  en de frames in `FX_ART.cannonC`/`cannonB`/`cannonW`/`cannonFx`/`cannonSmoke`/
  `cannonShot`/`cannonUp`/`bigUp`. Het kanon heeft:
  - een ijzeren loop met ringen, handvatten en een knop achteraan;
  - een eiken onderstel met beslag;
  - twee spaakwielen met ijzeren banden;
  - een staart met handspaak, een kogelstapel en een kruitvat.
- Het wordt in lagen getekend: onderstel, wielen, loop en de teamband (`gunLook`,
  `gunHurt`, `gunKick`, `gunRoll`, `gunAim`, `drawBuild`, `partFoot`). Er zijn twee
  schadebeelden (onder 2/3 en onder 1/3 HP) en een wrak.
- Animaties:
  - De lont vonkt tijdens het aanleggen en de loop draait naar zijn doel (tot ±40°).
  - Bij het schot slaat de loop 3 px terug en rolt het onderstel met draaiende
    wielen achteruit.
  - Daarna volgen mondingsvuur in vier frames, een rookring, een rookpluimpje, en
    een kogel met schaduw op de grond.
  - Bij het bouwen vallen de onderdelen er stuk voor stuk in.
  - Een treffer laat het kanon schudden, met splinters en vonken. Bij een
    reparatie lost de schade op.
  - De Big Gun krijgt dezelfde effecten.
  - Bij "rustig" (reduced motion) blijft het kanon stilstaan.
- `MS` kreeg alleen nieuwe sleutels (`gunKick`, `gunRoll`, `gunSmoke`, `gunWisp`,
  `gunShake`, `gunFix`). Geen bestaande timing is veranderd. Gemeten tekenkosten:
  1,12 ms per frame tegen 1,10 ms voorheen.
- Na de review: een snelheidswissel verschuift ook de eigen klokken van het kanon
  (`hitT`, `fix.t0` en `bld.*`), zodat een afgebouwd kanon zijn bouw niet opnieuw
  afspeelt. De lont neemt hooguit 35% van de vluchttijd, waardoor korte schoten hun
  boog houden. Het mondingsvuur draait mee met de loop (`cannonFx`: 2 richtingen ×
  5 hoeken × 4 frames, gedraaid rond de monding). De frames van de Big Gun worden
  maar één keer opgebouwd (`bigGrid`). Het rookpluimpje stopt met de beat.

## Engine 29
### Kansdrops vallen direct op de Blub
- `RULES.boxFetch: false`: het ophalen (`fetcher`/`fetchBox`/`pickBox`/`mistBoxes`/
  `boxSpot`) blijft in de code staan als schakelaar. De krat valt direct op de Blub
  die de kans won (`boxLands`, `dropBox`): event `box` met `direct: 1`, gevolgd door
  `drop` (`box: 1, direct: 1`) en `dropHit`, of bij goud door `openGold`. Het aantal
  BOX_SALT-trekkingen per beurt is gelijk gebleven. Een ruiter, een Blub in de
  Diamond Hand of een Gambler die nog draait kan geen krat vangen; die gaat dan naar
  de volgende Blub die ook raak gooide.
- View: de krat valt aan zijn parachute op de Blub (`MS.boxDrop`/`boxDropHit`), met
  daarna een gloed (`drawGlow`/`glowOn`, `MS.boxGlow`): groen `#4BE08F`, rood
  `#FF5C77`, goud `#FFD447`.
- Gemeten (3200 rondes): groen +1,6, rood −2,1 en goud +6,0 procentpunt winkans.

### Pizza bezorgen
- De Blub met de telefoon gooit aan het begin van elke eigen beurt gratis een punt
  naar de zwaarst gewonde teamgenoot binnen `pizzaToss: 3` tegels die op `pizzaAt`%
  HP of minder staat. Hij mag ook zelf eten. Event `toss`, gevolgd door een heal.
- Een Blub op `pizzaLow: 40`% HP of minder, zonder vijand binnen 2 tegels, loopt tot 2
  beurten ver terug naar de doos.
- Herbalanceerd: `pizzaHp` 8 → 4 en `pizzaAt` 60 → 75. Per doos worden nu 4,6 van de
  6 punten gegeten (was 2,1), en 5–7% van de dozen blijft onaangeroerd (was
  31–38%). Winkans ongeveer +9 procentpunt.
- View: de beat `toss` met `FX_ART.pizzaslice` (een draaiende punt in een boog), en
  een stapel punten bij de Blub met de telefoon.

### Diamond Hand en Coin Flip
- `diamondDmg` 2 → 3. Het team dat hem claimt wint nu 55,5% (was 48,9%).
- Coin Flip: de muntzijde is een doodshoofd (`FX_ART.flipcoin` frames 4–6). Alle
  teksten zeggen "Skull" in plaats van "Tails".

### Big Gun: nieuwe art en een vergrendelde schutter (engine 29)
- Nieuwe 3x3-art (`BIG_ART`, `bigImg`, `bigWheel`, `bigPut`, `BIG_STAGES`): een zwaar
  belegeringskanon met gouden banden en mondingsrem, spaakwielen, een gepantserde
  koepel met luik, kogels en kruitvaten. Het heeft 4 bouwfases, twee schadeniveaus,
  een wrak en 5 richthoeken.
- De schutter (`RULES.bigBoard: 2`, `bigManned: 4`, `bigGuard: 50`): de Blueprint-
  Blub klimt in de afgebouwde Big Gun en zit daar LOCKED IN. Hij bedient het kanon
  (+4 schade per schot) en krijgt 50% minder schade. Er zijn drie manieren waarop het
  eindigt:
  - wordt het kanon uitgeschakeld, dan wordt hij eruit geslingerd;
  - gaat hij zelf KO, dan staat het kanon onbemand;
  - komt de mist eraan, dan breekt hij uit en sloopt het kanon van binnenuit.
- Events: `gunner` (in/uit) en `breakout`. View: de beats `gunin`, `breakout` en
  `gunout`, met een close-up van het opsluiten (luik dicht, klemmen, "LOCKED IN",
  slot-icoon) en van het uitbreken (schudden, bouten, luik eraf, rook, wrak).
- Gemeten: het team dat de Blueprint opent wint 59,2% (was 58,6%). Bij 70% van de
  afgebouwde kanonnen stapt de schutter in en hij blijft er gemiddeld 10 beurten in.
  60% van de schutters breekt uit bij de mist.

### Rookbom (engine 29)
- De rookbom gaat ook af als een vijand binnen `smokeStep: 1` tegel komt. `smokeNear`
  gaat van 2 naar 3. Hij rolt uit tot een rookmuur (`smokeWall: 5` breed,
  `smokeDeep: 2` diep, gericht naar de vijand). 91,7% van de rookbommen gaat nu af
  (was 57,8%). Het team met een rookbom wint 52,4%, tegen 49,7% zonder.
- Muren die elkaar raken, worden als één bank getekend (`wallBanks`, `bankOf`,
  `drawWallBank`): één rand, en hoger langs de naad. Als ze samenkomen verschijnt
  "WALL OF SMOKE!". Met de huidige kit (elk object één keer per team) komt dit
  alleen voor als er ooit meer rookbommen per team worden toegestaan.

### Coin Flip (engine 29)
- De Blub flipt de munt aan het begin van de volgende beurt (`flipBy = turn + 1`).
  Gaat hij eerder KO, dan is de munt weg (`coinlost`). Het doodshoofd is in goud
  gestempeld.

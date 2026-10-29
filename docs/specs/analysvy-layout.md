# Analysvyn – ny layout (avdelning och hästkort)

Status: godkänd 2026-10-29 efter mockupen `docs/mockups/analysvy-layout-mockup-v2.html`, **alternativ B · Zonerna staplade överst**. Typ: **Omfattande**.

Den här filen kompletterar `spelvarde.md`. Den ändrar **4 Sidor och navigation** (tillbaka-knappen och bottenmenyn), **S2 Avdelningen** (desktop och mobil), **S2b Loppstatistik** (desktop) och **S3 Hästkortet** (desktop och mobil). Där de säger olika gäller den här filen. Beteendet i övrigt (cache, utkorg, optimistisk sparning, riktodds, X-faktor, tips, resultat) är oförändrat.

**Inget i datamodellen eller API:t ändras.** Allt som visas finns redan i `RoundResponse` och `StartDetailResponse`.

**Mikaels beslut 2026-10-29**
1. Alternativ B: avdelningar, fas och verktyg i en rad överst, loppet till vänster och hästkortet till höger.
2. Loppstatistiken blir en textrad i loppets tavla. Detaljerna finns under **Loppstatistik**.
3. Faserna visas som i mockupen: en segmentkontroll med alla fyra.
4. 1440 som i mockupen: smal startlista och knappen **Tabell** när hästkortet är öppet.
5. Statistiktabellen (I år / I fjol / Totalt) byggs som i mockupen. **Kan ändras** (Mikael har inte tagit ställning).
6. Två Unibet-hämtningar syns, och resten nås via "Alla N".
7. En rad per tips. Citatet visas när man trycker.
8. Mobilen: hästkortet är en lång sida med två fasta menyer: hoppknapparna överst (scroll-spy) och Intressant, Spelbar, Bet och X nederst.

**Underlag i koden**
- `components/round/RaceWorkspace.tsx`: `Workspace`, `DeskRow`, `StartRow`, `DeskStats`, `ReviewBar`, `UnibetChip`, `SortButton`, `WorkspaceSkeleton`. Det är här navigeringen sker (`go`, `openHorse`, `backToList`, `selectLeg`) och tangentbordet hanteras.
- `components/round/HorseCard.tsx`: `HorseCard`, `SignalsBlock`, `StatsBlock`, `Records`, `Comments`, `CommentItem`, `NewComment`.
- `components/round/Riktodds.tsx` (`RiktoddsBox`, `WhyList`, `modelLabel`), `XFactor.tsx` (`XFactorBlock`, `XCycleButton`, `xLockReason`), `UnibetHistory.tsx`, `TipsSection.tsx`.
- `components/round/parts.tsx` (`PhaseRail`, `RaceTabs`, `Counts`, `MarkBadges`, `RiktCell`, `RoundLinks`, `firstTodoLeg`), `RaceStats.tsx` (`RaceStatsContent`), `RaceResult.tsx`, `TagRace.tsx` (`TagCta`), `StreckOdds.tsx` (`RefreshBoardButton`, `RefreshBanner`).
- `components/shell/AppHeader.tsx` (`AppHeader`, `DeskHeader`, `NAV`), `components/shell/BottomNav.tsx`.
- `components/ui/board.tsx` (`FlapNumber`, `Badge`, `LampToggle`, `SpelbarToggle`, `BetToggle`, `FormStrip`, `Banner`, `Skeleton`), `components/ui/Sheet.tsx`, `components/ui/icons.tsx`, `components/hooks.ts` (`DESKTOP_QUERY`, `useIsDesktop`).
- `app/(app)/omgang/[roundId]/layout.tsx` (`RoundProvider`). Sidorna `avd/[nr]/page.tsx` och `avd/[nr]/hast/[startId]/page.tsx` renderar båda `RaceWorkspace` och ändras inte.
- `styles/app.css`: blocket "Desktop" (rad 446–530), "S3 Hästkortet" (rad 355–392), `.qlinks`/`.qlink` (rad 534–538), `.seg`, `.btn`, `.chip`, `.tabbar`, `.actbar`.
- `docs/DESIGN.md`: tokens, `Segmented`, `Button`, avstånd. Avvikelser står i **14**.

---

## 1. Rutnätet

Alla mått är CSS-variabler i `styles/app.css`, under en ny rubrik `/* ============ Analysvyn: rutnät ============ */`. Komponenterna använder bara variablerna, aldrig egna pixelvärden för höjder och marginaler.

```css
:root {
  --u: 8px;            /* avståndssteg */
  --av-m: 16px;        /* sidmarginal */
  --av-g: 16px;        /* mellanrum mellan paneler */
  --av-hd: 56px;       /* toppmenyn (desktop) */
  --av-band: 56px;     /* zonraden överst */
  --av-ph: 32px;       /* panelrubrik, samma i alla paneler och sektioner */
  --av-pad: 16px;      /* inre vänster- och högermarginal i alla paneler */
  --av-th: 32px;       /* tabellhuvud (bred tabell) */
  --av-cols: 24px;     /* kolumnrubrik (smal lista, som mobilen) */
  --av-ctl: 44px;      /* knappar, segment och reglage */
  --av-board: 64px;    /* tavlan i loppet och i hästkortet */
  --av-vr: 80px;       /* valraden: 8 + 16 + 4 + 44 + 8 */
  --av-r2: 236px;      /* andra raden sektioner i hästkortet */
  --av-rad: 8px;       /* hörnradie på paneler */
  /* Hästraden i bred tabell: 44 px när 15 rader ryms, annars ned till 40 px (1.3). */
  --av-row: clamp(40px, calc((100dvh - 290px) / 15), 44px);
}
/* Smal lista (1.3, 3.6): ingen tavla och ingen tabellrubrik på 32 px i loppanelen. */
.av[data-list="narrow"] { --av-row: clamp(40px, calc((100dvh - 218px) / 15), 44px); }
```

`--av-` är prefixet för analysvyn, så att variablerna inte krockar med andra vyer. Mobilen använder `--av-row: 44px` (raden är exakt 44 px enligt DESIGN.md).

### 1.1 Kolumner (desktop ≥ 1024 px)
- `main.av` är ett grid med **8 lika kolumner**: `grid-template-columns: repeat(8, minmax(0, 1fr))`, `column-gap: var(--av-g)`, `padding: var(--av-m)`. I 1920 är varje kolumn 222 px (16 + 8 × 222 + 7 × 16 + 16 = 1920).
- Rader: `grid-template-rows: var(--av-band) minmax(0, 1fr)`, `row-gap: var(--av-g)`. `main.av` har `height: calc(100dvh - var(--av-hd))` och `overflow: hidden`. **Sidan skrollar inte på desktop.**
- Namngivna områden:

```css
grid-template-areas:
  "avd  avd  avd  fas  fas  tool tool tool"
  "race race race card card card card card";
```

- Kanten mellan `race` och `card` (efter kolumn 3) fortsätter upp som kanten mellan `avd` och `fas`. Byggaren kontrollerar det med mätningen i 12.

### 1.2 Fasta linjer i 1920 × 950
| Linje | y |
|---|---|
| Panelernas överkant i zonraden | 72 (56 + 16) |
| Lopp- och hästkortspanelens överkant | 144 (72 + 56 + 16) |
| Panelrubrikernas nederkant | 176 |
| Tavlornas nederkant (loppet och hästkortet) | 240 |
| Panelernas nederkant | 934 (950 − 16) |

### 1.3 Höjdbudget och regeln om kanter
- **Loppanelen, bred tabell:** `32 + 64 + 32 + 15 × --av-row` + 2 px kant. Vid 950 px fönsterhöjd blir `--av-row` 44 och panelen 790 px (`950 − 56 − 16 − 56 − 16 − 16`). Formeln `(100dvh − 290px) / 15` kommer därifrån: 290 = 56 + 16 + 56 + 16 + 16 + 2 + 32 + 64 + 32.
- **Loppanelen, smal lista:** `32 + 24 + 15 × --av-row` + 2 px kant (ingen tavla, se 3.6). 218 = 290 − 64 − 32 + 24. Vid 900 px höjd blir raden 44 px.
- I Mikaels Chrome-flik (cirka 905 px hög, se skärmdumpen `overview.png`) blir raden i bred tabell 41 px. Alla 15 hästar syns ändå. Under 890 px är raden 40 px, och listan får egen skroll inne i panelen.
- **Hästkortet:** `32 + 64 + 80 + rad 1 + 236` + 2 px kant. Rad 1 = resten (376 px vid 950, 331 px vid 905).
- **Kanter får aldrig lägga till höjd.** Hästrader, tabellhuvud, panelrubriker, valrad och sektionsrubriker ritar sina skiljelinjer med `box-shadow: inset 0 -1px 0 var(--line)` (eller `--line-strong` för tabellhuvudet), aldrig med `border-bottom` eller `border-top`. Tabellen har `border-collapse: collapse` och inga `border` på `td`/`th`. Paneler har `box-sizing: border-box`, så deras 1 px kant ingår i panelens höjd.
  - Krav: varje `tbody tr` i startlistan har exakt höjden `--av-row`, `thead tr` exakt `--av-th`, och kolumnrubriken i smal lista exakt `--av-cols`. Mät i webbläsaren, inte i koden (12).
  - Bakgrund: med 1 px `border-bottom` blev listan 15 px för hög i mockupen, och rad 15 klipptes.

### 1.4 Panelen (en stil för alla zoner)
- `.pn`: `background: var(--surface)`, `border: 1px solid var(--line)`, `border-radius: var(--av-rad)`, `overflow: hidden`, `min-width: 0`, `min-height: 0`.
- `.pn-h` (panelrubrik): höjd `--av-ph`, `padding: 0 var(--av-pad)`, `background: var(--surface-2)` och `box-shadow: inset 0 -1px 0 var(--line)`. Typsnitt Barlow Condensed 700 12,5 px, versaler, `letter-spacing: .09em`, `color: var(--ink-2)`. Innehållet till höger ligger i `.pn-h .end` (`margin-left: auto`, gap 8 px).
- **Vänsterkanter:** text, tabellens första kolumn, knappar och tavlans innehåll börjar `--av-pad` in från panelens inre kant, i alla paneler och sektioner.
- Hästkortets sex sektioner använder samma `.pn-h`. Deras rubriker ligger därför på två linjer (rad 1 och rad 2).

---

## 2. Komponentstilar (färre varianter)

Analysvyn använder bara dessa. Allt finns redan i `styles/app.css` och kompletteras enligt tabellen.

| Stil | Klass | Används till | Ändring |
|---|---|---|---|
| **Primär** | `.btn.primary` | Bara Trollspöt (en per vy) | ingen |
| **Sekundär** | `.btn.secondary` | Unibets odds, Spelförslag, Efteranalys, Spara, Tagga i loppet, Försök igen | ingen |
| **Sekundär liten** | `.btn.secondary.xs` (ny) | Bara i panelrubriker: Loppstatistik ›, Unibet ↗, ?, Tabell, ‹ › i hästkortet | höjd 24 px, `padding: 0 8px`, 12 px text, `border-radius: 5px`, ingen underkant. Träffyta 44 px med `::after` som `.btn.sm`. Ikonvarianten `.xs.ic` är 24 × 24 |
| **Segment** | `.seg` | Fas, avdelningar, X-faktor, Startlista/Resultat, Tabell, mobilens hoppknappar | `.seg.nav`: valt läge (`aria-selected="true"` eller `aria-current`) får `background: var(--fill); color: var(--fill-ink)`. Utan `.nav` gäller dagens `--ink`-bakgrund (värdeval) |
| **Textlänk** | `.linkish` | "Alla 7", "Visa fler", "Alla tips", "Inga intressanta här", "Återställ", "Rensa", "Använd" | träffyta 44 px (`::after` som `.btn.sm`) |
| **Reglage** | `LampToggle labeled`, `SpelbarToggle`, `BetToggle labeled`, `Stepper` | Valraden och mobilens knapplist | höjd 44, radie 7 px, kant 1,5 px `--line-strong` (som i dag) |
| **Bricka** | `.chip`, `.chip-auto` | 2600 m, Auto, Klass II | **`.chip-k` (fylld bärnsten) används inte längre i analysvyn.** Klassbrickan blir en vanlig `.chip` |

- Regel: **navigering väljs i bärnsten, värden i `--ink`.** Regeln läggs in i DESIGN.md under `Segmented` efter bygget.
- `.qlinks`, `.qlink`, `.qlink.troll-link`, `.vt`, `.vlist`, `.rail-side` och `.dstats` används inte längre i analysvyn. Ta bort dem om inget annat använder dem (sök i hela `components/` och `app/`).

---

## 3. Zonerna på desktop (≥ 1024 px)

### 3.1 Toppmenyn (`DeskHeader` i `AppHeader.tsx`)
- Höjd `--av-hd` (56 px, i dag 60). Grid: `var(--col) minmax(0,1fr) auto auto`, där `--col` är en kolumns bredd (`calc((100vw - 2 * var(--av-m) - 7 * var(--av-g)) / 8)`). Loggan och "SPELVÄRDE" står i kolumn 1, och menyn börjar på kolumn 2:s vänsterkant. Första menylänken har ingen vänsterutfyllnad.
- `deskMeta` som i dag ("V85 · Bjerke · lör 31 okt 2026" och "Fas: analys"), och `RefreshBoardButton` längst till höger.
- **Omgång** i menyn leder till `/omgang/[roundId]` när man är i en omgång (7.4).
- Höjden 56 gäller analysvyn. De andra vyerna kan behålla 60 tills vidare. Ändra hellre överallt om det är enkelt, och skriv det i rapporten.

### 3.2 Zonraden: Avdelning, Fas och Verktyg (ny `RoundBand`)
Ny komponent `components/round/RoundBand.tsx`. Den ersätter `nav.dside` i `RaceWorkspace` (fasraden, `ul.vlist` och `RoundLinks className="side"`).

Tre paneler `.pn.bandp` på raden `--av-band`. Varje panel har rubriken **inne på raden**: `h2.bl` till vänster, 72 px bred, samma typsnitt som `.pn-h`, och sedan reglagen. Reglagen är 44 px höga och centrerade lodrätt. `padding: 0 var(--av-pad)`, gap `--av-pad`.

**Avdelning** (`grid-area: avd`, kolumn 1–3)
- `RaceTabs` får en ny variant `variant="band"`, med samma komponent och tangentbordslogik som i dag (`role="tablist"`, roving `tabIndex`, ←/→, Home/End, `aria-controls="avd-panel"`).
- Utseende: `.seg.nav` med en flik per avdelning, lika breda. Varje flik har `FlapNumber` 24 × 28 och `Counts`-märket I med antal Intressanta, på en rad med gap 6 px. Vald flik är bärnstensgul, med inverterad fällbladsruta (`--fill-ink` bakgrund, `--fill` siffra) och I-märket i `--fill-ink`.
- Flikens `aria-label`: "Avdelning 5, STL Klass II/Klass I, 16:28, 4 intressanta" (+ ", genomgången" som i dag).
- Genomgången avdelning utan Intressanta visar "✓" i stället för I-märket.
- Inställd avdelning: fliken är kvar, med dämpad siffra och "… inställd" i `title` och `aria-label`.

**Fas** (`grid-area: fas`, kolumn 4–5)
- `PhaseRail` får varianten `variant="seg"`, som ritar `nav.seg.nav` (`aria-label` "Veckans faser") med fyra rutor. Varje ruta har `b` (Analys, Odds, Live, Klart) och `small` (dagetiketten ur `steps`).
- Samma länkar som i dag: Analys → `analysHref`, Odds → `oddsHref`. Live och Klart är `span` tills deras vyer finns.
- Aktiv fas har `aria-current="step"` och är bärnstensgul. Klar fas har "✓ " före etiketten och `.sr` ", klar".

**Verktyg** (`grid-area: tool`, kolumn 6–8)
- `RoundLinks` får varianten `variant="row"`: `nav` (`aria-label` "Odds och spel") med `display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: var(--u)`.
- Knapparna är **Trollspöt** (`.btn.primary` med `WandSpark`), **Unibets odds** och **Spelförslag** (`.btn.secondary` med mockupens ikoner). Efteranalys (`analysis`) kommer först som `.btn.secondary`, och raden får då fyra knappar.
- Samma adresser som i dag.

### 3.3 Loppanelen (`grid-area: race`, kolumn 1–3)
`section.pn.race#avd-panel` (`role="tabpanel"`, `aria-labelledby="tab-{leg}"` som i dag). Grid-rader i bred layout: `var(--av-ph) var(--av-board) var(--av-th) minmax(0,1fr)`.

**1. Panelrubrik** `.pn-h`
- Vänster: "Avd 5 · start 16:28 · 15 hästar · 1:a pris 150 000 kr". Strukna ger "· 1 struken" före priset, som i `.drace .k` i dag.
- Höger (`.end`): `.btn.secondary.xs` **Loppstatistik ›** (`aria-haspopup="dialog"`), **Unibet ↗** (dagens `UnibetChip` som `.xs`, ny flik, samma `aria-label`), **?** (`aria-label` "Förklaring av kolumnerna", `aria-haspopup="dialog"`), och i smal layout även **Tabell** (3.6).

**2. Tavlan** `.rb.brd` (höjd `--av-board`, `padding: 8px var(--av-pad)`, rader `28px 16px`, radavstånd 4 px)
- Rad 1: `h1#race-h` med loppnamnet (`shortRaceName`, 22 px Barlow Condensed 700, versaler, ellipsis, `title` med hela namnet), och till höger brickorna 2600 m, Auto/Volte och klassen.
  - Efter start (E4a): segmentet **Startlista | Resultat** (`.seg`, 28 px högt med träffyta 44, `aria-label` "Visa avdelningen") längst till höger i rad 1. Brickorna står mellan namnet och segmentet.
- Rad 2: statistikraden `.statl` (12,5 px, `--head-ink-2`, siffror i `--head-ink` mono 700), med samma innehåll som mobilens `statline` i dag:
  - "Spår 1 vinner **14,1 %**" (`bestNumber`), "Spår 2 plats **38,2 %**" (`bestPlace`, annars "Spår 1 **x %**"), "Favorit vinner **–**" och "Kuskligan V85 **–**" (ledaren ur `useRaceStats`, som i `DeskStats`).
  - Saknas statistik: "Statistik saknas just nu" och `.linkish` **Hämta igen** (dagens `missingStats`).
  - Längst till höger i rad 2: `ReviewBar` som `.linkish` "Inga intressanta här", eller "Genomgången · **Ångra**", med samma villkor som i dag.
- `DeskStats` (2 × 2-rutorna) tas bort. Banans egen siffra ("Bjerke 17,2 %") finns i Loppstatistik.

**3. Startlistan** (rad 3–4, `.twrap` med `overflow: hidden`, eller `overflow-y: auto` när den inte ryms, se 3.7)
- Bred layout (≥ 1800 px): dagens tabell (`DeskRow`), med kolumnerna och bredderna från mockupen:

| Kolumn | Bredd | Innehåll |
|---|---|---|
| Nr (`SortButton`) | 56 | `FlapNumber` med signalsiffran |
| Häst | resten | namn och märken (`MarkBadges`, `GallopBadge`). Rad 2: ålder · rekord och tipstagg eller Lågt streck |
| Kusk / tränare | 118 | kusk (eller "↻ Ny: …"). Rad 2: "tr …" |
| Form | 62 | `FormStrip` |
| Vinst (år+fjol) | 46 | `QuickPct` |
| Plats (år+fjol) | 46 | `QuickPct` |
| Intjänat (tot · /start) | 62 | tkr, med tkr per start under |
| Spår | 44 | `postPct` |
| Rikt | 58 | `RiktCell two` |
| Intr. | 52 | `LampToggle` |

  - `thead th` har höjd `--av-th` och `tbody tr` höjd `--av-row`. Första kolumnen har `padding-left: var(--av-pad)`.
  - Vald rad `tr.sel` får `--accent-soft`. Intressant får 4 px vänsterkant (`box-shadow: inset 4px 0 0 var(--fill)` på första cellen).
  - Förklaringstexten under tabellen (`p.help` i dag) flyttas oförändrad till dialogen bakom **?** (`Sheet` med titeln "Kolumnerna i startlistan").
- Smal layout: se 3.6.
- Efter start, med Resultat valt: `RaceResult` (desktop) fyller rad 3–4 och får egen skroll, med `TagCta` överst.

**Loppstatistik** (S2b) öppnas i `Sheet` (dialog 560 px på desktop) med `RaceStatsContent`, som i mobilen. Den utfällbara `.dpanel` under tavlan tas bort, och `statsOpen` styr bara arket. Titel och underrad som i dag.

**`RefreshBanner`** (efter Hämta streck och odds på den här sidan) ligger mellan tavlan och startlistan med `className="m10"`. Medan den visas får startlistan egen skroll. Den stängs som i dag.

### 3.4 Hästkortspanelen (`grid-area: card`, kolumn 4–8)
`article.pn.hc` (`aria-labelledby` hästens `h2`). Grid: `grid-template-columns: repeat(3, minmax(0,1fr))` och `grid-template-rows: var(--av-ph) var(--av-board) var(--av-vr) minmax(0,1fr) var(--av-r2)`. Rubrik, tavla och valrad spänner `1 / -1`.

**1. Panelrubrik** `.pn-h`: "Hästkortet" och `.meta` "· 1 av 15" (platsen i listans visningsordning `ordered`). Till höger (`.end`):
- **Sparstatus** (`.meta`, `aria-live="polite"`): utkorgens text ("Sparas …", "I kö (2)", "Sparat"), efter första ändringen i kortet. Den ersätter `p.help.status` i `XFactorBlock` och `Comments`.
- **Unibet ↗** (`.btn.secondary.xs`, samma som `acts-row .unib` i dag).
- **‹** och **›** (`.btn.secondary.xs.ic` i `role="group"` `aria-label` "Byt häst"): `aria-label` "Föregående häst: 14 Burn" / "Nästa häst: 2 Peacekeeper". De byter häst som ↑/↓ (replace i historiken) och är avstängda vid första och sista hästen.

**2. Tavlan** `.hb.brd` (höjd `--av-board`, `padding: 0 var(--av-pad)`, grid `auto minmax(0,1fr) auto auto`, gap `--av-pad`, centrerat lodrätt)
- `FlapNumber` md (30 × 36) med signalsiffran.
- Identitet: `h2.nm` (24 px Barlow Condensed 700, versaler, ellipsis, `tabIndex={-1}`, `ref={headingRef}` som i dag). Raden under (13,5 px, `--head-ink-2`, ellipsis): "4 år valack · rekord 1.14,5aL · **Ole Johan Østre** · tr Tobias Modig". Vid kuskbyte ersätts kusknamnet av "↻ Ny kusk: Ole Johan Østre (förut Eirik Høitomt)" i `--head-ink`.
- **Flaggor** (`.hb-flags`, högst 240 px, bara när något gäller, två rader om 22 px):
  - Galopp: `Badge g/gd` och texten ur `start.form.warning` ("Galopp i 1 av 5, 13 sep Åby"), med ellipsis och hela texten i `aria-label`. Ram 1 px `--gal` (GD 2 px).
  - Bet: biljettikonen, oddset (mono 700) och "spelad i dag 10:12" på ljus bricka, som `.bstub` i dag. Har Unibet ändrats: "· Unibet nu 7,20".
- **Nyckeltal** (`.keys`, `role="list"` `aria-label` "Nyckeltal"): fyra celler med 1 px vänsterkant `--head-line` och `padding: 0 var(--av-pad)`. Varje cell har en etikett (10 px versaler, `--head-ink-2`) och ett värde (rader 12 + 30 px, värdena på samma baslinje):
  - **Riktodds plats** (med X-faktor: **Med X-faktor**): 28 px mono, `--head-ink` med sken. Osäkert: "*" och `.sr` "(osäkert)".
  - **Unibet plats**: 20 px mono `--head-title`. Över riktoddset: `--head-up` och "▲". Nära: "NÄRA" efter siffran. Struken hos Unibet eller saknas: "–".
  - **Vinnare**: Unibets vinnarodds, annars "–".
  - **Signaler**: "2/10".
  - Värdena räknas som i `RiktoddsBox` (`riktX`, `oddsClass`, `scratchedAtUnibet`). Uppdelningen står i 4.1.

**3. Valraden** `.vr` (höjd `--av-vr`, `padding: var(--u) var(--av-pad)`, `display: flex`, gap `--av-pad`, `box-shadow: inset 0 -1px 0 var(--line)`, 1 px avdelare `.vsep` mellan grupperna)

Varje grupp `.vg` är ett grid med raderna `16px var(--av-ctl)` och 4 px radavstånd. Etikettraden innehåller etikett och status, och reglageraden reglagen. Därför delar alla reglage över- och underkant.

| Grupp | Etikettrad (vänster · höger) | Reglagerad |
|---|---|---|
| **Markeringar** | "Markeringar" · "S: inte föreslagen · B: inte spelad". Spelbar: "Förslag" / "Satt av dig" / "Borttagen av dig" / "Inte föreslagen". Bet: "Spelad" / "Utan odds" / "Inte spelad". Vid override: "· **Återställ**" (`.linkish`, `setSpelbar(…, "auto")`) | `LampToggle labeled`, `SpelbarToggle`, `BetToggle labeled` |
| **X-faktor** | "X-faktor" + knappen **i** (16 px, träffyta 44, `aria-expanded`, öppnar en popover med hjälptexten i 9) · effekttexten `xEffectText` när den finns, annars "sänker riktoddset" | `.seg` `role="radiogroup"` med Ingen ÷1,00, Tror på ÷1,25 och Stark känsla ÷1,50 (etikett och faktor på två rader i knappen, bredd 288 px). Logik och tangenter som `XFactorBlock` i dag |
| **Källstöd** | "Källstöd" · kort `sourceSupportText` ("inte ifyllt · 3 källor", "2 av 3 källor"), "· **Rensa**" när ifyllt, "· Fler än dina påslagna källor nu", "· Tips säger **2** · **Använd**" (förslaget från Hämta tips, med samma toast och Ångra som i dag). Inga påslagna källor: "Inga påslagna källor · **Lägg till källor**" (länk till `/kallor`) | `Stepper` − värde + |

- Låst (loppet har startat, eller hästen är struken): alla reglage avstängda med `aria-disabled`. Etikettraden i Markeringar visar "Låst: loppet har startat" eller "Låst: struken i dag 09:12" i stället för statusen. Har loppet startat, och hästen inte är struken och loppet inte inställt, står **Tagga i loppet** (`.btn.secondary`, 44 px) sist i valraden. Bet kan tas bort på en struken häst, som i dag.

**4. Sektionerna** (rad 4 = 1fr, rad 5 = `--av-r2`). Sex celler `section.cell`, med `grid-template-rows: var(--av-ph) minmax(0,1fr)`. Cellerna har 1 px vänsterkant (utom kolumn 1) och 1 px överkant i rad 5, ritade med `box-shadow` (1.3). Brödtexten `.pn-b` har `padding: 12px var(--av-pad)` (rad 5: `8px var(--av-pad)`), är en flex-kolumn med gap `--u` och har `overflow: hidden`. Ryms innehållet inte (3.7) får just den cellen `overflow-y: auto`, och rubriken står kvar.

| Cell | Rubrik · höger | Innehåll (bygger på) |
|---|---|---|
| R1 K1 | **Riktodds plats** · `.mver` "v1.2, kalibrerad" | `uncertainLine`/`noteLine`. Meningen: `riktoddsSentence` eller `boxVerdict` med `.hsv`-brickan "+0,66"/"NÄRA" och källan "Hämtat tors 18:05." / "Eget odds.". Taggarna "Under 2,00" och "Struken hos Unibet". Med X: "Riktodds utan X **6,24** · ÷1,25 Tror på". Sist `WhyList` (högst 3 + 3) och `formula` (`calcLineWithX`). Saknas riktodds: `missingReason` |
| R1 K2 | **Positiva signaler** · stapeln (10 × 8 px) och "**2 av 10**" | `SignalsBlock`: hjälptexten, `lowbox` (Lågt streck), "Streck saknas än …" och listan med alla tio (12,5 px, 3 px utfyllnad per rad, kolumnerna 12 · 52 · 1fr) |
| R1 K3 | **Statistik** *(kan ändras)* | Tabellen nedan och fyra rader `kv`: "Spår 1, 2600 m auto, vinst", "Spår 1, plats (alla banor, 1 284 lopp)" (om `placePct` finns), "Kusken vinner i år" och "Tränaren vinner i år" |
| R2 K1 | **Unibets odds över tid** · `.linkish` "Alla 7" (när fler än 2 hämtningar) | Tavelrutan med kurvan (svg 64 px, förklaringen på samma rad som "Plats · mån–tors") och de **två** senaste hämtningarna (`historyRows`, rader om 28 px). "Alla N" öppnar `Sheet` "Unibets odds över tid" med dagens fulla `UnibetHistory` |
| R2 K2 | **Tips och kommentarer** · `.linkish` "Alla tips" (när tips finns) | Tips: en rad per gällande tips (3.5). Kommentarer: den senaste (när, taggar och första raden med ellipsis) och "Alla N kommentarer" (`.linkish`, öppnar `Sheet` med dagens lista med Redigera och Ta bort). Sist `NewComment` med textfält på 52 px (två rader), Spara och "Följer hästen till kommande omgångar." Utan tips och kommentarer: "Inga tips om hästen än. Inga kommentarer än." |
| R2 K3 | **5 senaste starter** · `.linkish` "Visa fler" (när `recordsTotal > 5`) | `Records`: tabell med fem rader om 28 px och teckenförklaringen. "Visa fler" öppnar `Sheet` "Senaste starter" med alla rader i `records` (högst 10) och underraden "10 senaste av 13". Fel, Försök igen och Debuterar som i dag |

**Statistiktabellen** (R1 K3, *kan ändras*): `table.stt` med `caption.sr` "Statistik för {häst} per år" och kolumnerna I år, I fjol och Totalt:

| Rad | I år | I fjol | Totalt |
|---|---|---|---|
| Starter | `thisYear.starts` | `lastYear.starts` | `life.starts` |
| Vinst % | `yearLine(thisYear, "win")` | `yearLine(lastYear, "win")` | `life.winPct` (utan signal) |
| Plats % | `yearLine(thisYear, "place")` | `yearLine(lastYear, "place")` | `life.placePct` (utan signal) |
| Intjänat, kr | `earnings` | `earnings` | `life.earnings ?? start.horse.earnings` |
| Per start, kr | – | – | som "Per start, totalt" i dag |

Raderna är 24 px, och siffrorna mono 700 och högerställda. De gröna signalbrickorna (`pctSignal`) behålls för I år och I fjol. Saknat värde visas som "–". Alla tolv värden från dagens `StatsBlock` finns med.

### 3.5 Tips (R2 K2)
- En rad per gällande tips (`APPROVED` och inte ersatt), högst 28 px: `RoleTag`, källan, "ons 28 okt 14:10" och artikeltiteln med ellipsis. Raden är en knapp med `aria-expanded`.
- Ett tryck fäller ut tipset under raden: citatet (`Quote`), historiken ("Tidigare: ~~Nämnd~~ …"), **Rätta** (som i dag, inte efter start) och **Artikeln ↗**. Bara ett tips är utfällt åt gången, och cellen får egen skroll medan det är utfällt.
- Väntande tips utan godkända: "2 tips väntar på granskning. **Granska**".
- Före E5, eller utan tips, visas ingen tipsrad (`FEATURES.tips` som i dag).

### 3.6 Bredder och brytpunkter på desktop
| Fönsterbredd | Loppet | Hästkortet |
|---|---|---|
| **≥ 1800 px** (1920 är målet) | Bred tabell med tavla (3.3) | 3 sektionskolumner |
| **1280–1799 px** (1440 är målet) | **Smal lista** med knappen **Tabell** | 3 sektionskolumner |
| **1024–1279 px** | Smal lista med Tabell | 2 sektionskolumner. Sektionerna i ordningen R1K1, R1K2, R1K3, R2K1, R2K2, R2K3, och sektionsytan får egen skroll |

**Smal lista** (`main.av[data-list="narrow"]`):
- Loppanelens rader är `var(--av-ph) var(--av-cols) minmax(0,1fr)`, alltså **ingen tavla**. Loppets namn (`h1`, i panelrubrikens typsnitt men i `--ink`) står i panelrubriken. Brickorna och knapparna står till höger: Statistik ›, Tabell, ?. "Avd 5 · start 16:28 · 15 hästar" och statistikraden finns i Loppstatistik-arket. Unibet ↗ finns i hästkortets rubrik.
- Listan är mobilens `StartRow` (`ul.list.mlist`, `.g-an`), med kolumnrubriken `.cols` (höjd `--av-cols`) och rader med höjden `--av-row` (smal formel, 1).
- "Inga intressanta här" står under listan, som i mobilen.

**Tabell** (`.btn.secondary.xs`, `aria-pressed`, sparas i `localStorage` `sv-tabell`, tål blockerad lagring):
- På: `grid-template-areas` blir `"avd avd avd fas fas tool tool tool" "race race race race race card card card"`. Loppet visar den breda tabellen med tavla (bred formel för `--av-row`). Hästkortet blir en spalt med sektionerna under varandra i samma ordning, och sektionsytan får egen skroll. Rubrik, tavla och valrad står kvar.
- Av: smal lista och sektionerna i kolumner.
- Knappen visas inte vid ≥ 1800 px.

**1440 × 900 i siffror:** kolumnen är 162 px. Loppet blir 518 px och hästkortet 874 px (sektioner om 291 px). Panelhöjden är 740 px. Den smala listan får 44 px rader (32 + 24 + 660 = 716 ≤ 738). Rad 1 i hästkortet blir 326 px. Positiva signaler behöver cirka 370 px vid 291 px bredd och får därför egen skroll i cellen. Det är godkänt, eftersom Mikaels krav om ingen skroll gäller 1920 × 950.

### 3.7 När innehållet inte ryms
- Startlistan: `.twrap` får `overflow-y: auto` när `scrollHeight > clientHeight`, alltså vid mer än 15 hästar, låg skärm eller en synlig banderoll. Tabellhuvudet och `.cols` är `position: sticky; top: 0`.
- Sektioner: bara den cell som inte ryms får skroll, och rubriken står kvar. Typfall är 3 + 3 skäl i 1440, ett utfällt tips, många tips och långa kommentarer.
- Sidan skrollar aldrig på desktop. Dialogerna (`Sheet`) har egen skroll.

### 3.8 Ingen häst vald (desktop)
På desktop väljer `/avd/N` utan häst automatiskt den första hästen i `ordered`, med `go(hastUrl(...), "replace")`. Det gäller även vid byte av avdelning (`selectLeg`), så kortet är aldrig tomt. Mobilen påverkas inte: där visar `/avd/N` listan. Dagens `.pick`-text tas bort, och tangenthjälpen flyttar till dialogen bakom **?** (9).

---

## 4. Vad som flyttas, slås ihop eller tas bort i koden

### 4.1 Hästkortet delas upp
`HorseCard.tsx` blir en sammansättning av mindre delar, så att desktop och mobil kan ordna dem olika. Logiken är oförändrad.

| Ny del | Fil | Kommer från | Används i |
|---|---|---|---|
| `useRiktView(race, start, data)` | `Riktodds.tsx` | beräkningarna i `RiktoddsBox` | `RiktKeys`, `RiktDetail` |
| `RiktKeys` | `Riktodds.tsx` | rutans siffror (`.rbox`) | desktoptavlan (`.keys`), mobilens nyckeltal |
| `RiktDetail` | `Riktodds.tsx` | meningen, taggarna, X-raden, `WhyList` och `formula` | R1 K1, mobilens sektion Riktodds |
| `HorseBoard` | `HorseCard.tsx` | `.hk-hero` (namn, info, ny kusk, `bstub`, `galwarn`) | desktoptavlan, mobilens rubrik och tavla |
| `MarkControls` | `HorseCard.tsx` | `acts-row`, `acts-sub` | valraden (desktop), knapplisten (mobil) |
| `XFactorSeg`, `SourceSupport` | `XFactor.tsx` | `XFactorBlock`, uppdelad i två med gemensam status | valraden, mobilens sektion Riktodds |
| `UnibetHistoryCompact` | `UnibetHistory.tsx` | kurvan och de två senaste raderna | R2 K1 |
| `SignalsBlock` | oförändrad | – | R1 K2, mobil |
| `StatsTable` | `HorseCard.tsx` | `StatsBlock`, i ny form (3.4) | R1 K3, mobil |
| `Records` | oförändrad logik | "Visa fler" blir dialog på desktop | R2 K3, mobil |
| `TipsCompact` | `TipsSection.tsx` | en rad per tips och utfällning | R2 K2, mobilens sektion Noter |
| `CommentsCompact` | `HorseCard.tsx` | senaste kommentaren, "Alla N" och `NewComment` | R2 K2 |

- `HorseCard` får propen `layout: "desk" | "mobile"`. Desktop renderar 3.4 och mobilen 5.2.
- `XCycleButton` används i mobilens knapplist (X).
- `SignalsBlock`, `Records`, `CommentItem`, `NewComment`, `WhyList` och `TipEditSheet` behåller sitt beteende.

### 4.2 `RaceWorkspace.tsx`
- `nav.dside` (fasraden, `ul.vlist`, `RoundLinks side`) → `RoundBand` (3.2).
- `section.drace` och `DeskStats` → panelrubriken och tavlan i loppanelen (3.3). `DeskStats` tas bort.
- `section.dpanel` (Loppstatistik under remsan) tas bort. `Sheet` används på alla bredder (`open={statsOpen}`).
- `p.help` under tabellen → dialogen bakom **?**.
- `ReviewBar` → `.linkish` i tavlans rad 2 i bred layout. I smal lista och mobil står den under listan som i dag.
- `aside.daside` → `article.hc` i griden. `div.pick` tas bort (3.8).
- `main.ws` → `main.av` på desktop (griden i 1.1), med `data-list="wide" | "narrow"`. Mobilen behåller `.ws[data-view]` och växlar lista och häst som i dag.
- `openHorse`, `backToList` och `go` ändras enligt 7 (historik och hästbyte).
- Ny state: `section` (vald sektion i mobilens hästkort) och `tableMode` (Tabell).
- `WorkspaceSkeleton` ritar på desktop `main.av` med zonraden (skelettflikar), loppanelen (rubrik, tavla och 15 skelettrader) och hästkortet (rubrik, tavla, valrad och sex sektioner med `SkeletonBlock`), så att layouten inte hoppar när datan kommer.

### 4.3 `parts.tsx`
- `RaceTabs`: ny prop `variant?: "flaps" | "band" | "scroll"`. Standard är `"flaps"` (dagens). `"band"` beskrivs i 3.2 och `"scroll"` (mobilens rad) i 5.1.
- `PhaseRail`: ny prop `variant?: "rail" | "seg"`.
- `RoundLinks`: ny prop `variant?: "grid" | "row"`.

### 4.4 `AppHeader.tsx` och `BottomNav.tsx`
- Ny prop `back.text`, synlig text bredvid pilen ("Avd 5" eller "Omgång"). Mobilens tillbaka-knapp blir `BackLink` (7.1).
- Ny prop `horseNav?: { prev, next, index, total }` för mobilens ‹ › i hästkortets rubrik (7.2).
- `NAV` får funktionen `hrefFor(pathname)`. Omgång leder till `/omgang/{roundId}` när adressen börjar med `/omgang/{roundId}`, annars till `/` (7.4). `BottomNav` och `DeskHeader` använder den.

### 4.5 `styles/app.css`
- **Tas bort eller ersätts** (blocket "Desktop", rad 446–530): `.ws`-gridet med 240/1fr/380, `.dside`, `.vlist`, `.vt`, `.drace`, `.dr-l`, `.d-miss`, `.dstats`, `.dpanel`, `.review` (desktopdelen) och `.daside .hk-*`. `.slist`-reglerna som inte längre gäller tas också bort. `.tbl` behålls, men `border-bottom` byts mot `box-shadow` (1.3) och höjderna mot variablerna.
- `.hk-hero`, `.acts-row`, `.hk-sec` och `.rbox` används bara i mobilen efter bygget. Desktop använder `.hb`, `.vr`, `.vg`, `.cell` och `.keys`.
- **Läggs till:** variablerna (1), `.av`, `.pn`, `.pn-h`, `.bandp`, `.bl`, `.race`, `.rb`, `.statl`, `.hc`, `.hb`, `.hb-flags`, `.keys`, `.key`, `.vr`, `.vg`, `.vl`, `.vsep`, `.cell`, `.stt`, `.btn.secondary.xs` och `.seg.nav`. För mobilen: `.mhd` (hästkortets rubrik), `.mjump`, `.mkeys`, `.mact` och `.mavs` (5). Värdena tas ur mockupen och räknas om till variablerna.
- Inga hex-värden i nya regler. Mockupens fasta färger (`#46D37E`, `#2A3038`, `#000` för X-märket) byts mot `--head-up`, `--led-off` och dagens `XBadge`.

---

## 5. Mobil (< 1024 px)

Mobilen behåller dagens två vyer: listan på `/avd/N` och hästkortet som helsida på `/avd/N/hast/{id}`. Sidan skrollar. Sidmarginalen är `max(16px, env(safe-area-inset-left/right))`, och avståndet mellan block 16 px.

### 5.1 Avdelningen (listan)
Fast överst (`.stick`, som i dag) ligger rubriken, avdelningsraden, remsan, eventuellt segmentet Startlista | Resultat, och kolumnrubriken.
1. **Rubrik** (`AppHeader`, 54 px): `BackLink` "← Omgång" (7.1), titeln "Avd 5 · STL Klass II/Klass I", underraden "V85 · Bjerke · start 16:28 · 15 hästar" och `RefreshBoardButton` som i dag.
2. **Avdelningsraden** (`RaceTabs variant="scroll"`): en rad knappar som går att svepa (`overflow-x: auto`, `scroll-snap-type: x proximity`, ingen synlig rullist).
   - Varje knapp är 44 px hög, med `FlapNumber` 24 × 28, kort namn (`shortRaceName` utan "STL ", ellipsis efter 14 tecken) och under det "16:28 · I 4" (11 px mono).
   - Vald knapp är bärnstensgul och scrollas in med `scrollIntoView({ inline: "center", block: "nearest" })` när avdelningen byts.
   - Raden är fortfarande `role="tablist"` med ←/→ och Home/End. Svep på listan (60 px) fungerar som i dag.
   - Siffrorna i hörnen från varv 1 används inte.
3. **Remsan:** brickorna (2600 m, Auto, Klass II som vanlig `.chip`), **Loppstatistik ›** och statistikraden som i dag, med "4 intressanta" sist.
4. **Kolumnrubrik och rader** som i dag (`.g-an`, 44 px, linjer med `box-shadow` enligt 1.3).
5. **Inga intressanta här** under listan, som i dag.

### 5.2 Hästkortet (en lång sida)
Uppifrån och ned:

**A. Rubriken** (`.mhd.brd`, fast med `position: sticky; top: 0`, `z-index: 20`, höjd 56 px + `env(safe-area-inset-top)`, `padding-top: env(safe-area-inset-top)`)
- Vänster: `BackLink` "← Avd 5" (7.1).
- Mitten: `FlapNumber` md med signalsiffran och `h1` med hästens namn (20 px Barlow Condensed 700, versaler, ellipsis, `tabIndex={-1}`). Rubriken är fokusmålet när kortet öppnas, som `headingRef` i dag. Under namnet: "1 av 15 · Ole Johan Østre" (11,5 px versaler, `--head-ink-2`).
- Höger: gruppen **‹ ›** (7.2).

**B. Hoppknapparna** (`nav.mjump`, fast direkt under rubriken)
- Placering: `position: sticky; top: calc(56px + env(safe-area-inset-top))`, höjd 52 px, `--surface` med 1 px linje under, `z-index: 19`.
- `aria-label` "Hoppa till avsnitt". Sex länkar (`a href="#hk-{id}"`), 32 px höga med träffyta 44: **Riktodds**, **Signaler**, **Statistik**, **Starter**, **Odds** och **Noter**.
- Raden skrollar i sidled om den inte ryms. Den aktiva länken scrollas in med `inline: "nearest"`, utan att sidan flyttas lodrätt.
- Aktiv länk är bärnstensgul (`--fill`/`--fill-ink`) och har `aria-current="location"`.
- Beteendet står i 5.3.

**C. Tavlan** (`.mkeys.brd`, skrollar med sidan, direkt under menyerna): de tre nyckeltalen Riktodds (eller Med X-faktor), Unibet plats och Signaler från `RiktKeys`, och under dem flaggorna (galopp, Bet, ny kusk) som rader.

**D. Sektionerna**, var och en en `.pn` med `.pn-h` (32 px) och ett `id` för hoppknapparna:

| `id` | Rubrik | Innehåll |
|---|---|---|
| `hk-riktodds` | Riktodds plats · `.mver` | `RiktDetail`, sedan `XFactorSeg` (full bredd, hjälptexten bakom **i**), statusraderna "Spelbar: satt av dig · **Återställ till förslag**" och "Bet: inte spelad", och sist `SourceSupport` |
| `hk-signaler` | Positiva signaler · stapel och "2 av 10" | `SignalsBlock` |
| `hk-statistik` | Statistik | `StatsTable` och `kv` |
| `hk-starter` | 5 senaste starter · Visa fler | `Records` (Visa fler fäller ut i sektionen, som i dag) |
| `hk-odds` | Unibets odds över tid | dagens fulla `UnibetHistory` (kurvan och alla hämtningar) |
| `hk-noter` | Tips och kommentarer | `TipsCompact` (en rad per tips, citatet vid tryck) och dagens `Comments` med `NewComment` |

- Struken häst: `Banner warn` "**Struken i dag 09:12.** Hästen startar inte." överst i C.
- Loppet har startat: "Loppet har startat. Intressant, Spelbar, Bet, X-faktor och källstöd är låsta." och **Tagga i loppet** överst i sektionen Riktodds.
- `RefreshBanner` som i dag, överst i C.

**E. Knapplisten** (`.mact`)
- Placering: `position: fixed; left: 0; right: 0; bottom: calc(64px + env(safe-area-inset-bottom))`, höjd 68 px, `z-index: 15`, `--surface`, med linje och skugga uppåt som `.actbar`. Sidoutfyllnaden är `max(16px, env(safe-area-inset-left/right))`.
- `role="group"` `aria-label` "Markeringar för Yellowstone Doc".
- Innehåll: `LampToggle labeled` (Intressant), `SpelbarToggle`, `BetToggle labeled` och `XCycleButton` (högerställd).
- Knapparna har kompakt utfyllnad (`0 8px 0 6px`, gap 6, 13 px text), så att raden ryms i 360 px: tre reglage + X är cirka 350 px.
- Låst: knapparna är avstängda, med orsaken i `aria-describedby` (`.sr`).
- När hästkortet är öppet flyttas toasterna upp: `.toast-region { bottom: calc(140px + env(safe-area-inset-bottom)) }` (samma mönster som för `.actbar` i dag).

**Utrymme, så att inget hamnar bakom menyerna**
- Sektionerna har `scroll-margin-top: calc(56px + 52px + 8px + env(safe-area-inset-top))`.
- Sidan har `padding-bottom: calc(68px + 64px + 16px + env(safe-area-inset-bottom))`, så att sista sektionen och textfältet kan skrollas fram ovanför knapplisten.
- Textfältet: när tangentbordet visas görs `scrollIntoView({ block: "center" })` på fältet. Knapplisten döljs medan ett textfält i kortet har fokus (`:has(textarea:focus)`), så att tangentbordet och listen inte tar halva skärmen.

### 5.3 Hoppknapparna: scroll-spy och hopp
- **Spy:** `IntersectionObserver` på sektionerna med `rootMargin: "-{56+52+8}px 0px -55% 0px"`. Topp-offset inklusive safe-area räknas ut i JS.
  - Aktiv sektion = den sista vars överkant har passerat linjen under menyerna.
  - Innan första sektionen nått linjen är ingen länk aktiv (läget "top").
  - Är sidan skrollad till botten (`scrollY + innerHeight ≥ scrollHeight − 2`) blir sista sektionen aktiv.
  - Spy-byten läses inte upp.
- **Hopp:** ett tryck ger `scrollIntoView({ block: "start", behavior })`, med `"smooth"`, eller `"auto"` vid `prefers-reduced-motion: reduce`.
  - Under hoppet är spyn låst (aktiv = målet) tills skrollningen har stått still i 150 ms, så att länkarna inte blinkar.
  - Fokus flyttas till sektionens `h2` (`tabIndex={-1}`, `focus({ preventScroll: true })`).
  - URL:en ändras inte (ingen `#`), så historiken växer inte.
- **Sektionen behålls vid hästbyte (‹ ›):** `section` sparas i `RaceWorkspace`-state och i `sessionStorage` `sv-hk-sek` (tål blockerad lagring). När den nya hästen har ritats:
  - "top": `scrollTo(0, 0)`.
  - Annars: `scrollIntoView({ block: "start", behavior: "auto" })` på samma `id`. När `detail` har laddats och höjderna har ändrats görs det en gång till, om Mikael inte har skrollat själv under tiden (en `wheel`, `touchmove` eller `keydown` avbryter).
  - Fokus stannar på knappen ‹ eller ›.
- **Öppna från listan:** alltid "top" (`section` nollställs).

### 5.4 Mobil under 360 px
Ingen sidledsskroll ned till 360 px (DESIGN.md). Under 360 px visas X i knapplisten utan text, och avdelningsknapparna visar bara siffra och tid.

---

## 6. Tangentbord (desktop)

| Tangent | Var | Gör |
|---|---|---|
| ← / → | överallt utom i textfält och flikgrupper | föregående / nästa avdelning (dagens `selectLeg`). Första hästen väljs (3.8) |
| ← / → / Home / End | i Avdelning-flikarna (fokus där) | byter flik och flyttar fokus (`RaceTabs`) |
| ← / → / ↑ / ↓ / Home / End | i X-faktorns radiogrupp | byter läge (som i dag, stoppar spridningen) |
| ↑ / ↓ | överallt utom i textfält | föregående / nästa häst i `ordered`, med replace i historiken. Raden scrollas in med `block: "nearest"` |
| Home / End | överallt utom i textfält och grupper | första / sista hästen (nytt) |
| Enter | på en rad, men inte på knapp eller länk | fokus till hästens `h2` |
| I | – | växlar Intressant på vald häst |
| X / Shift + X | – | stegar X-faktorn framåt / bakåt |
| R | när Startlista/Resultat visas | växlar (som i dag) |
| Esc | i dialog och popover | stänger och ger tillbaka fokus |

- Vid hästbyte med ↑/↓ eller ‹ › läser en `aria-live="polite"`-region (`.sr` i `RaceWorkspace`) upp "Häst 2 av 15: Peacekeeper". Fokus flyttas inte.
- Vid byte av avdelning läses "Avdelning 6, Axel Jensens Minnelopp Ston, 15 hästar" upp.
- `isTyping` och `dialog[open]` gäller som i dag.
- Dialogen bakom **?** listar tangenterna under rubriken "Tangenter" (texten i 9).

---

## 7. Tillbaka och byte av häst i mobilen

### 7.1 Tillbaka (`BackLink`)
- **Utseende:** pil med skaft (ny `IconArrowLeft` i `icons.tsx`: `M19 12H5M11 6l-6 6 6 6`) och **synlig text** bredvid ("Avd 5" i hästkortet, "Omgång" i listan). Ghostknapp på tavlan med bärnstensgul text (`--head-ink`), 44 px hög, `padding: 0 12px 0 8px`, längst till vänster i rubriken.
- Det skiljer den från ‹ ›, som är chevroner i fyrkantiga knappar med kant, i en grupp längst till höger (7.2). **Pil + text betyder tillbaka. Två chevroner betyder byt häst.**
- `aria-label`: "Tillbaka till avd 5" / "Tillbaka till omgången".

| Var | ← Tillbaka leder till | Webbläsarens och telefonens bakåt |
|---|---|---|
| Hästkortet `/avd/5/hast/{id}` | listan `/avd/5` (samma avdelning, skrolläget och fokus på raden återställs som i dag) | samma: `/avd/5` |
| Avdelningen `/avd/5` | omgångens översikt `/omgang/{roundId}` | föregående sida i historiken (normalt översikten) |

### 7.2 Byt häst (‹ ›)
- Gruppen har `role="group"` `aria-label` "Byt häst" och två knappar om 44 × 44 med 1 px kant (`--board-btn-line`) och chevronerna `IconBack`/`IconChev`. Den står längst till höger i rubriken.
- `aria-label` "Föregående häst: 14 Burn" / "Nästa häst: 2 Peacekeeper". Knapparna är avstängda vid första och sista hästen, och listan går inte runt.
- Ordningen följer `ordered` (startnummer eller signaler, samma som listan).
- Bytet görs med `go(hastUrl(leg, id, vy), "replace")`. **Historiken växer inte**, så bakåt går alltid till listan, hur många hästar man än har bläddrat.
- Efter bytet: sektionen behålls (5.3), live-regionen läser upp "Häst 2 av 15: Peacekeeper", och `prefetchDetails` körs för grannarna som i dag.
- Svep i sidled byter **inte** häst i kortet, eftersom det krockar med hoppknapparnas sidledsskroll och med textfälten.

### 7.3 Historiken (så att ← och bakåt alltid gör samma sak)
- **Öppna från listan:** `history.pushState({ sv: "hast" }, "", hastUrl)` (dagens `openHorse`, nu med state) och `pushed.current = true`.
- **← i hästkortet:** är posten skapad av appen (`history.state?.sv === "hast"`) körs `history.back()`. Annars `go(avdUrl, "replace")`.
- **Direktlänk eller omladdning** på `/avd/N/hast/{id}` i mobilen, när `history.state?.sv` saknas: appen lägger en gång in listan bakom kortet, med `history.replaceState({ sv: "avd" }, "", avdUrl)` och sedan `history.pushState({ sv: "hast" }, "", hastUrl)`. Då leder både ← och telefonens bakåt till `/avd/N`. Vid nästa omladdning finns `sv: "hast"` redan i state, och inget läggs in igen.
- **Byte av avdelning** i listan görs med replace (som i dag). Bakåt från listan går därför till sidan före avdelningen, normalt översikten.
- **Desktop:** hästbyte och avdelningsbyte görs med replace (som i dag). Ingen tillbaka-knapp behövs, eftersom allt syns. Bakåt lämnar analysvyn.
- Byggaren provar att `pushState` och `replaceState` med eget `state` synkas med Next 14:s `usePathname` utan omladdning (samma mönster som i dag, där state är `null`). Fungerar inte `sv` i state används en modulvariabel med samma innebörd, och det står i rapporten.

### 7.4 Bottenmenyn och toppmenyn
- **Omgång** leder till översikten **för omgången du är i**, `/omgang/{roundId}`, från alla vyer under `/omgang/{roundId}/…` (avdelning, hästkort, odds och spel). Utanför en omgång leder den till `/` (aktuell omgång) som i dag.
- Fliken är markerad (`aria-current="page"`) i alla omgångsvyer, som i dag.
- Ett tryck ger vanlig navigering (push). Ett påbörjat kommentarsutkast sparas när kortet stängs (`NewComment` flush, som i dag).
- Desktop: samma regel för **Omgång** i toppmenyn.

---

## 8. Lägen

| Läge | Desktop | Mobil |
|---|---|---|
| **Omgången laddas** | `WorkspaceSkeleton` i griden (4.2): zonraden med 8 skelettflikar, loppanelen med 15 skelettrader och hästkortet med skelett i varje sektion | skelettlistan som i dag, och avdelningsraden med 8 tomma knappar |
| **Hästkortets detalj laddas** | tavla, valrad och nyckeltal syns direkt (ur cachen). R1K1 (skälen), R1K3, R2K1, R2K2 och R2K3 visar `SkeletonBlock`, och rubrikerna står kvar | samma per sektion |
| **Detalj gick inte att hämta** | R2K3: "Senaste starter kunde inte hämtas" och **Försök igen** (som i dag). Övriga celler: "Kunde inte hämta" och Försök igen | samma |
| **Struken häst** | raden i listan grå och genomstruken. I kortet: etikettraden "Låst: struken i dag 09:12", reglagen avstängda (Bet kan tas bort), nyckeltalen "–" och `missingReason` i R1K1 | banderollen överst och knapplisten avstängd |
| **Loppet har startat** | "Låst: loppet har startat" och **Tagga i loppet** i valraden. Segmentet Startlista \| Resultat i tavlan, med Resultat förvalt och `TagCta` överst i resultatytan | texten och Tagga i loppet i sektionen Riktodds, och Resultat i listvyn som i dag |
| **Inställt lopp** | fliken dämpad, tavlan visar "Inställt" och valraden har inga reglage | som i dag |
| **Inga Unibet-odds** | nyckeltalen Unibet plats och Vinnare visar "–". R1K1: "Fyll i Unibet-odds för att se om hästen är spelbar." R2K1: "Inga odds från Unibet än. Kurvan visas från två hämtningar, efter Hämta streck och odds." Ingen "Alla"-länk | samma texter |
| **En hämtning** | R2K1 visar raden och "Kurvan visas från två hämtningar." | samma |
| **Med Unibet-odds** | Unibet plats i `--head-up` med "▲" när det är över riktoddset, och "NÄRA" när det är nära. R1K1 med `.hsv` "+0,66" och "**Spelbar:** Unibet ger 6,90, över riktoddset 6,24. Hämtat tors 18:05." R2K1 med kurvan, två rader och "Alla 7" | kurvan och alla hämtningar i sektionen Odds |
| **Med X-faktor** | nyckeltalet heter "Med X-faktor". R1K1 har raden "Riktodds utan X 6,24 · ÷1,25 Tror på" | samma |
| **Tips finns** | R2K2: en rad per tips, utfällning vid tryck och "Alla tips". Väntande: "2 tips väntar på granskning. Granska" | samma i Noter |
| **Inga signaler** (struken) | R1K2: "Signaler räknas inte för strukna hästar." | samma |
| **Debuterar** | R2K3: "Debuterar. Hästen har inga tidigare starter." | samma |
| **Statistik saknas** (loppet) | tavlans rad 2: "Statistik saknas just nu · Hämta igen" | remsan som i dag |
| **Offline / sparfel** | utkorgens texter i sparstatusen och toasterna, som i dag | samma |
| **Fler än 15 hästar eller låg skärm** | startlistan får egen skroll (3.7) | listan skrollar som i dag |

---

## 9. Texter

| Var | Text |
|---|---|
| Zonraden, rubriker | "Avdelning", "Fas", "Verktyg" |
| Loppets panelrubrik | "Avd 5 · start 16:28 · 15 hästar · 1:a pris 150 000 kr" |
| Knappar i loppets rubrik | "Loppstatistik ›" (smal lista: "Statistik ›"), "Unibet ↗", "?" (aria "Förklaring av kolumnerna"), "Tabell" |
| Dialogen ? | Titeln "Kolumnerna i startlistan". Dagens förklaringstext, därefter rubriken "Tangenter" och "← → byter avdelning. ↑ ↓ byter häst, Home och End går till första och sista. Enter går till hästkortet. I växlar Intressant. X stegar X-faktorn (Shift + X baklänges). R växlar Startlista och Resultat." |
| Hästkortets panelrubrik | "Hästkortet · 1 av 15" |
| ‹ › | aria "Föregående häst: 14 Burn" / "Nästa häst: 2 Peacekeeper", gruppen "Byt häst" |
| Valraden | "Markeringar", "X-faktor", "Källstöd". Status enligt 3.4. Låst: "Låst: loppet har startat" / "Låst: struken i dag 09:12" |
| Popover i | "Din egen känsla. Sänker riktoddset, så att hästen lättare blir spelbar. Appen sätter aldrig X-faktorn." |
| Sektionsrubriker | "Riktodds plats", "Positiva signaler", "Statistik", "Unibets odds över tid", "Tips och kommentarer", "5 senaste starter" |
| Länkar i sektionerna | "Alla 7" (N = antal hämtningar), "Alla tips", "Alla 3 kommentarer", "Visa fler" |
| Dialoger | "Unibets odds över tid", "Senaste starter" (underrad "10 senaste av 13"), "Mina kommentarer" |
| Tillbaka i mobilen | "Avd 5" (aria "Tillbaka till avd 5"), "Omgång" (aria "Tillbaka till omgången") |
| Mobilens hoppknappar | "Riktodds", "Signaler", "Statistik", "Starter", "Odds", "Noter" · nav-aria "Hoppa till avsnitt" |
| Mobilens knapplist | aria "Markeringar för {häst}" |
| Live-region | "Häst 2 av 15: Peacekeeper" · "Avdelning 6, Axel Jensens Minnelopp Ston, 15 hästar" |
| Inga tips och inga kommentarer | "Inga tips om hästen än. Inga kommentarer än." |

Siffror och datum skrivs som i dag (`odds`, `pct`, `money`, `relTime`, `shortDay`).

---

## 10. Tillgänglighet (WCAG 2.2 AA)

- **Landmärken:** `header` (toppmenyn), `nav` "Huvudmeny" och `main.av`. I zonraden: `nav` "Avdelningar" (med `tablist`), `nav` "Veckans faser" och `nav` "Odds och spel". Loppet är en `section` (tabpanel) och hästkortet en `article`.
- **Rubriker, desktop:** `h1` är loppets namn (i tavlan, i smal lista i panelrubriken). `h2` är zonrubrikerna (`.bl`) och hästens namn ("Hästkortet" i panelrubriken är `span`). `h3` är sektionerna.
- **Rubriker, mobil:** `h1` är rubrikens titel (avdelningen i listan, hästens namn i kortet). `h2` är sektionerna.
- **Flikar:** Avdelning är `role="tablist"` med roving `tabIndex`, `aria-selected` och `aria-controls="avd-panel"`. Fas och hoppknapparna är länkar med `aria-current` (`step` respektive `location`), inte flikar.
- **Fokusordning, desktop:**
  1. Toppmenyn.
  2. Avdelning (en tabbstopp), Fas och Verktyg.
  3. Loppets rubrikknappar, och tavlans segment och länk.
  4. Tabellen (per rad: namnlänken och lampan).
  5. Hästkortets rubrik (Unibet ↗, ‹, ›).
  6. Valraden (Intressant, Spelbar, Återställ, Bet, i, X-faktor, Källstöd − och +, Rensa, Använd).
  7. Sektionerna i ordningen R1K1, R1K2, R1K3, R2K1, R2K2, R2K3 (rad för rad, vänster till höger).
- **Fokusordning, mobil:** rubriken (Tillbaka, ‹, ›), hoppknapparna, tavlan, sektionerna och sist knapplisten. Knapplisten ligger sist i DOM:en men syns hela tiden.
- **Fokus:**
  - När hästkortet öppnas i mobilen flyttas fokus till `h1` (som i dag).
  - Vid hopp flyttas fokus till sektionens `h2`.
  - Vid hästbyte stannar fokus på knappen.
  - Tillbaka ger fokus till raden i listan (som i dag).
  - Dialogerna fångar fokus och ger tillbaka det (`Sheet`).
- **Synlig fokusring:** 3 px `--focus` med 2 px avstånd, även på tavlan och i `.seg` (där `outline-offset: -3px`, som `.xseg` i dag).
- **Tryckytor:** alla reglage är 44 px. `.btn.secondary.xs` och `.linkish` har 44 px träffyta med `::after` och syns minst 24 × 24 (2.5.8). ‹ › i mobilen är 44 × 44.
- **Färg bär aldrig ensam:** Unibet över har "▲" och nära har "NÄRA". Vald flik har bakgrund och `aria-selected`, och aktiv hoppknapp har `aria-current`. Signalerna har ✓ / – / ? och ordet. Galopp har märket och ordet.
- **Kontrast:** `--ink-2` på `--surface-2` (panelrubrikerna) ska ha minst 4,5:1 i båda temana. Byggaren mäter `.pn-h`, `.vl .st` (11 px), `.statl` och mobilens "16:28 · I 4", och justerar mot tokens om något understiger.
- **Skärmläsartexter:**
  - `FlapNumber` har `.sr` "Nr 1, 2 positiva signaler" (som i dag).
  - Nyckeltalen läses som en lista: "Riktodds plats 6,24", "Unibet plats saknas".
  - Sparstatusen är `aria-live="polite"`, och `xEffectText` har `aria-live` som i dag.
  - Live-regionen fungerar enligt 6.
- **Rörelse:** smooth scroll används bara utan `prefers-reduced-motion`. Inga nya animationer.
- **Zoom:** vid 200 % zoom på 1920 är fönstret i praktiken 960 px brett, och mobillayouten används. Den ska fungera utan sidledsskroll.

---

## 11. Ljust och mörkt tema

- Alla nya regler använder tokens. Tavlorna (`.brd`) är mörka i båda temana. Panelerna är `--surface` med rubriker i `--surface-2`, på `--bg`.
- Ljust tema: kontrollera att panelkanterna syns (`--line` #D0D6DD mot `--bg` #E4E8EC). Är de för svaga får `.pn`-kanten `--line-strong`, men bara i ljust tema.
- Valt segment i bärnsten (`--fill`/`--fill-ink`) och i `--ink`/`--bg` fungerar i båda temana.

---

## 12. Provkörning och skärmbilder (frontend-dev)

Kör `npm run typecheck`, `npm test`, `npm run build` och `npm run lint`. Provkör sedan med omgången V85 Bjerke 31 okt (avd 5, Yellowstone Doc) i dev, eller med preview-datan.

**Skärmbilder** (Playwright eller Chrome DevTools, med fönstrets **innerstorlek**):

| # | Storlek | Tema | Vy | Läge |
|---|---|---|---|---|
| 1 | 1920 × 950 | mörkt | avd 5, häst 1 | utan Unibet-odds |
| 2 | 1920 × 950 | ljust | avd 5, häst 1 | utan Unibet-odds |
| 3 | 1920 × 950 | mörkt | avd 5, en häst med Unibet-odds, tips och X-faktor | flest rader |
| 4 | 1920 × 905 | mörkt | som 1 | Mikaels faktiska fönster |
| 5 | 1440 × 900 | mörkt | avd 5, häst 1 | smal lista |
| 6 | 1440 × 900 | ljust | samma med Tabell på | bred tabell, kortet i en spalt |
| 7 | 390 × 844 | mörkt | listan avd 5 | – |
| 8 | 390 × 844 | ljust | hästkortet, överst | – |
| 9 | 390 × 844 | mörkt | hästkortet, efter hopp till Statistik | scroll-spy markerar Statistik, och rubriken är inte dold |
| 10 | 390 × 844 | mörkt | hästkortet, längst ned | Noter syns ovanför knapplisten |
| 11 | 360 × 780 | ljust | hästkortet | knapplisten ryms |

**Kontroller med mätning** (skriv in värdena i rapporten):
- [ ] 1920 × 950: rad 15 i startlistan är helt synlig. `getBoundingClientRect().bottom` för rad 15 ≤ loppanelens inre nederkant, och `.twrap` har `scrollHeight === clientHeight`.
- [ ] 1920 × 950: varje `tbody tr` är exakt 44,0 px och `thead tr` exakt 32,0 px.
- [ ] 1920 × 950: hästkortet skrollar inte. `scrollHeight <= clientHeight` gäller för alla sex `.cell .pn-b`, både med häst 1 och med hästen i skärmbild 3.
- [ ] 1920 × 950: sidan skrollar inte (`document.documentElement.scrollHeight === innerHeight`).
- [ ] 1920 × 905: alla 15 rader syns (raderna är 41 px).
- [ ] 1440 × 900, smal lista: alla 15 rader syns och är 44 px.
- [ ] Linjerna i 1.2, mätta med `getBoundingClientRect`: zonradens överkant på y = 72, loppets och kortets överkant på y = 144, tavlornas nederkant på samma y och panelernas nederkant på y = 934.
- [ ] Kanten mellan loppet och hästkortet ligger på samma x som kanten mellan Avdelning och Fas.
- [ ] Mobil: efter ett hopp hamnar sektionsrubriken direkt under hoppknapparna, inte bakom dem. Sista sektionen kan skrollas fram ovanför knapplisten.
- [ ] Mobil: ‹ › byter häst och behåller sektionen. ← Tillbaka och webbläsarens bakåt går båda till listan, även efter att du bläddrat genom fem hästar och efter en omladdning på hästkortets adress.
- [ ] Mobil: Omgång i bottenmenyn leder till `/omgang/{roundId}` från hästkortet.
- [ ] Tangentbord (desktop): ←/→, ↑/↓, Home/End, I, X och Enter fungerar enligt 6. Tabb går genom hela vyn i fokusordningen.

Rapportera vad som är kontrollerat, vad som inte är det, och eventuella avvikelser från mockupen med skäl.

---

## 13. Acceptanskriterier

- [ ] Desktop har zonraden (Avdelning, Fas, Verktyg), loppanelen och hästkortspanelen enligt rutnätet i 1, med samma panelstil och rubrikhöjd i alla zoner.
- [ ] Vänsterkolumnen, 2 × 2-rutorna, den utfällbara Loppstatistiken och `.pick` finns inte kvar.
- [ ] 1920 × 950: alla 15 hästar och allt i hästkortet syns utan skroll. Inga kanter lägger till höjd.
- [ ] Hästkortet har en tavla med nyckeltal, en valrad med gemensam baslinje och sex sektioner med rubrikerna på två linjer. Allt innehåll från dagens hästkort finns, direkt eller bakom länkarna i 3.4.
- [ ] 1440: smal lista, Tabell och tre sektionskolumner. Under 1280: två kolumner.
- [ ] Bara knappstilarna i 2 används i analysvyn.
- [ ] Mobilen har avdelningsraden med namn, och hästkortet som en lång sida med fasta hoppknappar (scroll-spy) och fast knapplist, med `scroll-margin` och safe-area enligt 5.2.
- [ ] Tillbaka, ‹ › och historiken fungerar enligt 7, och Omgång leder till omgångens översikt.
- [ ] Tangentbordet fungerar enligt 6, och tillgängligheten uppfyller 10.
- [ ] Lägena i 8 fungerar i ljust och mörkt tema.
- [ ] Skärmbilderna och mätningarna i 12 är gjorda och redovisade.
- [ ] Inga ändringar i Prisma, API eller DTO:er.

---

## 14. Avvikelser från DESIGN.md (uppdateras efter bygget)

1. **Desktop:** "tre kolumner med avdelningar (240 px), huvudinnehåll och sidopanel (380 px)" ersätts av zonraden och 8-kolumnsrutnätet i 1.
2. **Segmented:** varianten `.seg.nav`, med bärnsten för navigering.
3. **Button:** varianten `.btn.secondary.xs` (24 px, träffyta 44) för panelrubriker.
4. **RaceStrip/chip-k:** klassbrickan är neutral i analysvyn.
5. **Täthet på desktop:** hästraden får krympa till 40 px när fönstret är lägre än vad 15 rader om 44 px kräver (1.3). Mobilen behåller exakt 44 px.
6. **AppHeader:** tillbaka visas som pil med text i mobilen, och desktopmenyn är 56 px hög i analysvyn.

---

## 15. Beslut (Claudes, Mikael kan ändra)

1. **Första hästen väljs automatiskt på desktop** (3.8), så att kortet aldrig är tomt och layouten inte hoppar vid byte av avdelning.
2. **Raden krymper till 40 px i låga fönster** i stället för att rad 15 klipps. Mikaels flik är cirka 905 px hög enligt skärmdumpen, och där blir raden 41 px.
3. **"Alla"-länkarna öppnar dialoger på desktop** i stället för att fälla ut i cellen, så att hästkortets rutnät inte rubbas. I mobilen fäller de ut i sektionen som i dag.
4. **Tillbaka har pil och text, och byt häst har chevroner i en grupp till höger.** Det svarar på Mikaels fråga om att de inte ska förväxlas.
5. **Hästbyte växer inte historiken.** Bakåt går alltid till listan.
6. **Omgång i menyn leder till omgången du är i**, inte alltid till den aktuella.
7. **Knapplisten döljs medan kommentarsfältet har fokus** i mobilen, så att tangentbordet får plats.
8. **Svep byter inte häst** i mobilens hästkort.
9. **Smal lista har ingen tavla.** Loppets namn och brickor står i panelrubriken, och statistikraden finns i Loppstatistik. Det gör att 15 rader om 44 px ryms i 1440 × 900.

## 16. Öppna punkter

1. **Statistiktabellen** (I år / I fjol / Totalt) byggs som i mockupen och kan ändras när Mikael har tagit ställning (koordinatorn förklarar frågan).
2. **Fönsterhöjden:** specen garanterar att hästkortet inte skrollar från cirka 900 px höjd i 1920 bredd. Kör skärmbild 4 (1920 × 905) och säg till om någon cell behöver skroll där.
3. **Next 14 och `history.state`** (7.3): om `sv` i state inte överlever Nexts synk används en modulvariabel. Byggaren rapporterar vilket.

## 17. Filer

**Skapas**
- `components/round/RoundBand.tsx` (`RoundBand`)

**Ändras**
- `components/round/RaceWorkspace.tsx`: griden, `RoundBand`, loppanelen, auto-valet, historiken, mobilens sektioner och spy, live-regionen, Tabell och `WorkspaceSkeleton`. `DeskStats` och `.pick` tas bort
- `components/round/HorseCard.tsx`: `layout`, `HorseBoard`, `MarkControls`, `StatsTable`, `CommentsCompact`
- `components/round/Riktodds.tsx`: `useRiktView`, `RiktKeys`, `RiktDetail`
- `components/round/XFactor.tsx`: `XFactorSeg`, `SourceSupport`
- `components/round/UnibetHistory.tsx`: `UnibetHistoryCompact`
- `components/round/TipsSection.tsx`: `TipsCompact`
- `components/round/parts.tsx`: varianterna av `RaceTabs`, `PhaseRail` och `RoundLinks`
- `components/shell/AppHeader.tsx`: `BackLink`, `horseNav`, `NAV.hrefFor`, desktopmenyn 56 px i analysvyn
- `components/shell/BottomNav.tsx`: `hrefFor`
- `components/ui/icons.tsx`: `IconArrowLeft`
- `styles/app.css` (4.5)
- `docs/DESIGN.md` (14)
- `docs/specs/spelvarde.md`: hänvisning hit från 4, S2, S2b och S3

**Ändras inte**
- `prisma/`, `app/api/`, `lib/dto.ts`, `lib/types.ts`
- `app/(app)/omgang/[roundId]/layout.tsx` och sidorna under `avd/`

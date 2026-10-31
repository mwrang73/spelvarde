# E8 – Live-sidan: se loppet, tagga och visa resultat

Status: spec 2026-10-31. Omfattande bygge. Utseendet följer den godkända mockupen `docs/mockups/live-sidan-mockup.html`, alternativ A, utom där avsnitt 1.2 säger annat. Där den här filen och `docs/specs/spelvarde.md` (3.1, 3.2, 4, S5, S7), `docs/specs/e4a-resultat.md` eller `docs/specs/e7-atg-fil.md` säger olika gäller den här filen.

Specen innehåller inga färdiga kodändringar. Namn på modeller, fält, filer och funktioner är bindande där de står i en tabell, eftersom backend och frontend bygger mot dem var för sig.

**Underlag i koden:** `prisma/schema.prisma`, `prisma/migrations/`, `lib/phase.ts`, `lib/features.ts`, `lib/coupon.ts`, `lib/results-view.ts`, `lib/results-ui.ts`, `lib/quick-tags.ts`, `lib/outbox.ts`, `lib/round-overlay.ts`, `lib/round-server.ts`, `lib/e2-server.ts`, `lib/dto.ts`, `lib/migration-check.ts`, `app/api/rounds/[id]/coupon/route.ts`, `app/api/comments/[clientId]/route.ts`, `app/api/rounds/[id]/races/[leg]/tags/route.ts`, `components/outbox/outbox-client.ts`, `components/round/` (`TagRace`, `tagStore`, `RaceResult`, `RaceWorkspace`, `RoundBand`, `RoundOverview`, `HorseCard`, `parts`, `RoundProvider`, `resultsStore`), `components/spel/` (`RadPanel`, `RadSheets`, `RadActionBar`, `Kupong`), `components/shell/` (`AppHeader`, `BottomNav`), `components/ui/board.tsx`, `docs/DESIGN.md`.

---

## 1. Beslut och avvikelser

### 1.1 Beslut som gäller

- Dator: alternativ A, en kolumn per häst med alla 13 taggar under varje häst. Bet är biljett och ram, Rad är rund pill och streckad list.
- Live är sidan där Mikael ser loppet och taggar, direkt och i efterhand, även i tidigare omgångar.
- Resultat visas per lopp med **Visa resultat**. Valet minns per lopp på enheten. **Dölj resultat** tar tillbaka läget.
- Med resultatet visat ersätts kolumnerna av **resultatlistan** (avsnitt 7).
- Analys, hästkortet, Omgång och Nästa steg följer samma val (avsnitt 8). Fliken Resultat blir kvar i Analys.
- Odds gäller fram till första start.
- En inlämnad rad per omgång. **Ersätt raden** och **Ångra** finns. Lägg till som rad 2 finns inte.
- Videon ligger inte bredvid i samma fönster. Under 1100 px bredd visas en häst i taget.
- `features.raceView` slås på, `features.live` förblir av. Streckbevakningen ingår inte.

### 1.2 Här avviker specen från mockupen

| Mockupen | Specen | Varför |
|---|---|---|
| Resultat visat: placeringschip i kolumnerna, Startnr/Placering, Träff i hästhuvudet | Finns inte. Kolumnerna visar aldrig resultat. Resultatlistan tar över, på dator och i mobil | Mikaels tillägg |
| Knappen "Dölj resultatet" på dator, "Dölj" i mobil | **Dölj resultat** överallt | Mikaels ord |
| Rad 1, Rad 2, "RAD 1+2", "Lägg till som rad 2", summa per rad | Finns inte. Märket är alltid RAD | Beslut: en rad per omgång |
| Streckade B-knappar i kolumnerna | Byggs inte. De finns bara i mockupen, Bet är låst efter start | Mockupen säger det själv |
| Med färre hästar räcker kolumnerna längre ned i bredd | Fast gräns: kolumner från 1100 px, oavsett antal hästar | Annars byter samma fönster layout mellan loppen |
| "Filen du laddade ner 14:05" i valet av rad | "Raden du laddade ner eller kopierade 14:05" | `copiedSelections` skiljer inte på fil och kopiering, och fältet ändras inte |
| Steg 4 i arket: "Kontrollera att ATG visar …" | E7:s text behålls, med steg 5 tillagt | E7:s text varnar för att ett bekräftat spel inte kan ångras |
| Arket utan Kopiera texten före spelstopp | Kopiera texten finns kvar | E7. Mockupen förkortade här |
| "4 … ströks efter inlämningen" | "4 … är struken" | Hästen kan ha varit struken redan när raden markerades |
| "lör 14:32", "144 kr" | `relTime` och `krText`: "i dag 14:32", "144,00 kr" | Appens format (`docs/DESIGN.md`) |

---

## 2. Mål och ansvar

**Användare:** Mikael, ensam spelare, med telefon eller dator. **Mål:** se ett lopp på ATG, tagga hästarna medan eller efter att han sett det, utan att appen avslöjar utfallet innan han väljer det. **Nästa steg efter vyn:** nästa lopp, eller Efteranalys när omgången är klar.

### 2.1 Ansvarsfördelning

| Område | `supabase-backend` | `frontend-dev` |
|---|---|---|
| Databas | Modell, migrering, Prisma-relationer | – |
| API | `PUT`/`DELETE /api/rounds/[id]/submitted-row`, validering | Anropen via utkorgen |
| Delade typer | `SubmittedRowDto`, fältet `submittedRow` i `RoundResponse`, `SUBMITTED_ROW_*`-texter | Läser typerna |
| Fas och Nästa steg | `lib/phase.ts`, `lib/round-server.ts`, `lib/phase.test.ts` (avsnitt 3.4–3.5) | Rendering av kortet, `withNextStep` i `lib/round-overlay.ts` |
| Rena funktioner | `lib/submitted-row.ts` | `lib/live-view.ts`, `lib/reveal.ts`, `lib/race-tags.ts`, ändringar i `lib/results-ui.ts`, `lib/results-view.ts` |
| Utkorg och cache | – | Nya `meta`-typer, `applyPending`, `applyDone`, `retryText`, `rejectedText`, `onDone` |
| Gränssnitt | – | Allt under `app/(app)` och `components/`, `styles/app.css`, `features.raceView` |
| Dokument | Fas- och datadelen i `docs/specs/spelvarde.md` | `docs/DESIGN.md`, S5- och S7-hänvisningar i `spelvarde.md` |
| Skärmbilder | – | Provkörningen i avsnitt 18 |

Backend bygger först och lämnar över typerna och API:t. Frontend ska inte ändra `prisma/` och backend ska inte ändra `components/`.

---

## 3. Rutter, navigering, fasraden och Nästa steg

### 3.1 Rutter

| Rutt | Innehåll | Ändring |
|---|---|---|
| `/omgang/[roundId]/live` | Live, väljer lopp enligt 3.2 | Ny |
| `/omgang/[roundId]/live?avd=4` | Live, V85-4 | Ny |
| `/omgang/[roundId]/live?avd=4&hast=<startId>` | Live, V85-4 med hästen aktiv. Från hästkortet | Ny |
| `/omgang/[roundId]/lopp/[nr]` | Byggs inte. Rutten i `spelvarde.md` 4 stryks | S7 är nu Live |
| `/omgang/[roundId]/live` för S5 | S5 ingår inte. Rutten har nytt innehåll | Streckbevakningen hamnar under Odds om den byggs |

- Sidan ligger under `app/(app)/omgang/[roundId]/live/page.tsx` och delar `RoundProvider` med övriga sidor, så byte av lopp och häst gör inga anrop mot omgången.
- `avd` och `hast` läses ur `window.location` i klienten. Byte av lopp görs med `history.replaceState`, som i `RaceWorkspace`, så att sidan inte laddas om. `hast` tas bort ur adressen vid första byte av häst eller lopp.
- Ogiltigt `avd` behandlas som saknat. Ogiltigt `hast` ignoreras.
- Tillbaka (mobil) går till `/omgang/[roundId]`. Toppmenyn är oförändrad på dator, och Omgång är markerad.

### 3.2 Vilket lopp öppnas

Väljs **en gång** när sidan öppnas, aldrig igen medan Mikael är kvar:

1. `avd` i adressen.
2. Loppet som pågår: senast startade, inte inställt, utan resultat, högst 30 min efter start (`POLL_WINDOW_MS`).
3. Första startade, ej inställda loppet där ingen löpande häst har taggar. Kräver att taggarna för alla startade lopp är lästa, eller att läsningen har misslyckats. Skelett visas under tiden, högst 3 s. Därefter gäller nästa punkt.
4. Första startade, ej inställda loppet. Har inget startat: första loppet.

### 3.3 Vägarna in

| Plats | Beteende |
|---|---|
| Fasraden, rutan Live | Länk till `/omgang/[id]/live`. Fungerar alltid, också före start och i tidigare omgångar |
| Nästa steg | "Till Live", se 3.5 |
| Analys (S2), efter start | Kortet `LiveLink` på samma plats som dagens `TagCta`: "V85-4 har startat. Se loppet i Live ›" till `?avd=4`. Inställt lopp: inget kort |
| Hästkortet, efter start | Länken "Tagga i Live ›" till `?avd=4&hast=<startId>`, ersätter knappen Tagga i loppet på båda ställena (`HorseCard.tsx` rad 186 och 254). Struken häst eller inställt lopp: ingen länk |
| Bottenmenyn | Visas **inte** på Live under 1024 px (`BottomNav` returnerar inget på Live-rutten). Föregående och Nästa behöver platsen |

### 3.4 Fasen

**Ansvar: backend, `lib/phase.ts`.**

| Fas | Gäller | Ändring |
|---|---|---|
| Analys | Från hämtning till D−2 18:00 | Ingen |
| Odds | D−2 18:00 till **första start** | Var D 12:00 |
| Live | Från första start tills alla lopp har resultat eller är inställda | Var D 12:00 |
| Klart | Som i dag (`isRoundFinished`) | Ingen |

- Första start = tidigaste `startAt` bland **alla** omgångens lopp, också inställda. Det är samma regel som spelstoppet i `RadPanel` (`data.races.some(raceStarted)`), så att fas och spelstopp aldrig säger olika.
- Omgång utan lopp: D 12:00 gäller som reserv.
- `phaseRail` får första start som tredje argument. `dayLabel` och `from` för Live blir "lör 16:20". Saknas första start: "lör 12:00".
- Banderoll eller kort som villkoras på `phase === "ODDS"` (`RoundOverview`, `OddsFetchCard`) gäller därmed på lördagen fram till start. Det är avsikten.

**Fasraden (`PhaseRail`), ansvar frontend:**

- Nya props: `liveHref` och `activePage` (`"ANALYS" | "ODDS" | "LIVE"`, frivillig).
- Rutan Live blir en länk i båda varianterna. Klart förblir text.
- Automatiken styr ✓ på rutorna, som i dag.
- Med `activePage` får den rutan `aria-current="page"` och bärnstensgul bakgrund, och automatikens ruta är inte tänd. Utan `activePage` gäller automatiken med `aria-current="step"`.
- Live anger `LIVE`, `RoundBand` (Analys på dator) anger `ANALYS`. `RoundOverview` anger inget.

### 3.5 Nästa steg

**Ansvar: backend, `lib/phase.ts`.** Bara med `f.raceView`. Med flaggan av är allt som i dag.

| Punkt | Villkor | Rubrik | Text | Knapp |
|---|---|---|---|---|
| Odds, klart | Fas Odds, inget kvar att göra (dagens `ALL_REVIEWED`) | Allt klart – första start {lör 16:20} | Alla {åtta} lopp är genomgångna. Live börjar när första loppet startar. | Ingen |
| 3 | Fas Live, larm | Oförändrad, kräver `f.live`, som är av | – | – |
| 4a, ny kind `LIVE_RUNNING` | Fas Live och ett lopp pågår enligt 3.2 punkt 2 | {V85-4} pågår | `mineSentence` | Till Live → `?avd=4` |
| 4b `LIVE_NEXT_RACE` | Fas Live, inget pågår, nästa lopp finns | {V85-5} startar {18:20} | `mineSentence` | Till Live → `?avd=5` |
| 4c `LIVE_WAITING` | Alla har startat, något saknar resultat | Väntar på resultat i {V85-7} | Placeringen hämtas automatiskt från ATG. | Till Live → `?avd=7` |
| 9 `SEE_ANALYSIS` | Fas Klart | Efteranalysen är klar | **Efteranalysen visar resultatet för alla lopp.** Summeringen skrivs inte längre i kortet | Se efteranalysen |

- `legLink` pekar i dag på `/lopp/[nr]` med `f.raceView`. Det ändras till `/live?avd=n` med etiketten "Till Live". Väg utan flaggan är oförändrad.
- Rubriken "Allt genomgånget – odds fylls i torsdag kväll" behålls bara i fas Analys. Den är fel redan i dag från torsdag kväll.
- **Frontend:** `withNextStep` i `lib/round-overlay.ts` skickar i dag ingen `gameType`, så ett omräknat kort skulle säga V85 även på V75. Rätta det när kortet ändå ändras (`data.round.gameType`).

---

## 4. Användarflöden

**A. Direkt, dator**
1. Nästa steg visar "V85-4 pågår". Mikael trycker Till Live.
2. Kolumnerna visas. Han klickar direkt på en tagg under en häst, eller väljer häst med siffra och taggar med bokstav.
3. Taggen lyser direkt. Statusen visar "Sparat · Galopp på 5 Ble Du Rask". Fel väg: se 6.3.
4. V85-5 startar medan han taggar. En rad säger det, med Byt till V85-5. Inget byts av sig självt.
5. Resultatet kommer. Inget visas utom knappen Visa resultat och raden "Resultatet har kommit".

**B. I efterhand, mobil**
1. Fasraden, rutan Live. Första otaggade loppet öppnas.
2. Han väljer häst i remsan, trycker taggar, går vidare med Nästa.
3. Sist trycker han Visa resultat. Resultatlistan ersätter taggningen.
4. Vill han ändra en tagg: Dölj resultat, tillbaka till taggningen på samma häst.

**C. Inlämnad rad**
1. V85-rad, Spela hos ATG. Laddar ner filen, lämnar in hos ATG.
2. Trycker Jag har lämnat in raden i rutan. Kopian sparas. Offline: i kö, se 9.5.
3. Live visar RAD på hästarna i kopian.
4. Fel: markerade fel rad → Ångra markeringen, eller Ersätt raden om han har makulerat hos ATG.
5. Glömde: efter spelstopp, Jag lämnade in raden före start. Sparas som markerad efter spelstopp.

**D. Analys efter start**
1. Öppnar V85-4 i Analys. Startlistan visas, inte Resultat.
2. Trycker Resultat. Om resultatet är dolt visas Visa resultat, inget annat. Finns inget resultat: väntelägena från E4a.
3. Efter Visa resultat visas dagens resultatvy, och Live visar resultatlistan för samma lopp.

---

## 5. Live: layout och komponenter

Mockupens avsnitt "A · En kolumn per häst" och "Lägen i Live" gäller för mått och utseende. CSS-reglerna `.tk`, `.rad`, `.vd`, `.lt`, `.ltabs`, `.rbar`, `.ga`, `.hc`, `.hh`, `.tb`, `.ftb`, `.ftpop`, `.kbh` och `.lband` överförs från mockupen till `styles/app.css`, utan de delar som bara rör grön ram, `.mb`, `.pch` och alternativ B. Inga hex-värden i komponenterna.

### 5.1 Layoutlägen

| Fönster | Läge |
|---|---|
| Från 1100 px bredd | **Kolumner.** Toppmeny 56 px, `.lband` 68 px (lopprad + fasrad 300 px), `.rbar` 50 px, rutnätet |
| Under 1100 px | **En häst i taget.** Vyrubrik, lopprad, remsa, hästhuvud, taggar, nav längst ned |
| 600–1099 px | En häst i taget med tre kolumner taggar. Tangenterna visas när `(hover: hover)` |
| 1024–1099 px | Som ovan, med toppmenyn (`DeskHeader`) överst |

- Sidan är `position: fixed; inset: 0` med flex, som dagens `.tagr`, så att skalets bottenmarginal inte påverkar. Högsta höjd i `dvh`, plats för `safe-area-inset-bottom` i navraden.
- Ingen sidskroll i sidled ner till 360 px.

**Mått i kolumnläget**

| Villkor | Taggrad | Tagg-text | Hästnamn |
|---|---|---|---|
| Normal | 44 px | 13 px | 15 px |
| `min-width: 1800px` och `min-height: 1000px` | 52 px | 14,5 px | 18 px |
| `max-height: 800px` och `pointer: fine` | 40 px | 13 px | 15 px |

- Kolumnerna är `minmax(0, 200px)` och ligger från vänster. Struken häst har 44 px. Fler än 15 löpande: lägsta kolumnbredd 70 px och vågrät skroll inne i rutnätet.
- Hästhuvudet är klistrat överst i rutnätet när fönstret skrollar.

### 5.2 Delar

**Lopprad.** `RaceTabs` får varianten `live` med propen `tagged: Record<leg, { tagged: number; total: number } | null>`.
- Innehåll per lopp: fällbladsnummer, `legName`, tid och efter start "3/15". Pulserande prick när loppet pågår. B om loppet har Bet. Inställt: "Inställt", klassen `.off`.
- Aldrig något om resultatet.
- Dator: åtta (sju) lika kolumner. Mobil: svepbar `.mavs`, vald flik centreras.
- Tangentbord som i dag: piltangenter, Home, End. PageUp/PageDown byter lopp från resten av sidan.

**Raden för loppet (`.rbar`), dator.** Rubrik `h1` "{V85-4} · {loppnamn}", underrad "{2140 m auto} · {Pågår · startade 17:50}". Därefter resultatkontroll (5.3), status, "n av m taggade" och `?`.

**Vyrubrik, en häst i taget.** Tillbaka, `h1` "Live · {V85-4}", underrad med läget, resultatkontroll till höger.

**Kolumn (`LiveColumn`).** `section` med `role="group"` och full `aria-label`, se 14.
- Huvudet: fällbladsnummer med spårbricka, RAD-pill överst till höger, namn på högst två rader, fjärde raden är Bet-biljetten eller märkena I och S.
- 13 taggknappar i `QUICK_TAGS`-ordning, sedan `+ Fritext` eller `✎ {början av texten}`.
- Vald tagg: bärnstensgul gradient, "✓" och fetstil. Ovald: raka band, zebra.
- Aktiv häst: bärnstensgul överkant på huvudet. Klick på huvudet gör hästen aktiv. Klick på en tagg gör också hästen aktiv.
- Tangentbokstaven visas bara i den aktiva kolumnen.
- Bet: 3 px ram `--bet`, huvudet inverterat. Rad: streckad list under huvudet. Båda kan gälla samtidigt. Intressant: namnet i `--accent`.
- Komponenten memoiseras per häst, så att ett klick bara ritar om en kolumn (195 knappar).

**Struken häst, kolumn.** 44 px, randig, utan taggar, namnet lodrätt och genomstruket med "Struken". Med i inlämnad rad: "· i raden". Med Bet: "· Bet".

**Fritext.** Popover över kolumnen, `label` "Fritext · {5} {Ble Du Rask}", `textarea` högst 2000 tecken, knappen Klar. Öppnas till vänster i kolumnernas högra halva.
- Sparas när fältet lämnas, vid Klar, vid Esc, vid byte av lopp och när sidan döljs.
- I mobil ligger fältet i flödet under taggarna, som i dagens `TagSheet`.

**En häst i taget (`LiveSingle`).** Återanvänder klasserna från `TagSheet` (`.tstrip`, `.tgb`, `.thead`, `.tname`, `.tmeta`, `.qc`, `.tnav`, `.tstat`).
- Remsan har inte längre placering. `small` tas bort, och raden visar `BET` på biljetten, RAD-etikett och antal taggar. Bara löpande hästar.
- Hästhuvud: stort nummer, namn, kusk, RAD-pill, märken. Med Bet inverterat huvud och biljett till höger. Med Rad streckad list.
- Föregående och Nästa med nummer och namn. Nästa är primär.
- Strukna hästar: raden "Struken: {4 Namn} · i raden · {11 Namn}" under taggarna.
- Ordningen är alltid startnummer.

**Bet och Rad.** Nya komponenter i `components/ui/board.tsx`:
- `BetTicket`: rak biljett med hack, "BET 2,40". Utan odds: "BET". På vanlig rad är bakgrunden `--bet` och texten `--bet-ink`, i inverterat huvud tvärtom. Dagens `BetBadge` används kvar i övriga vyer.
- `RadPill`: rund pill med "RAD", mörk tavla och `--head-ink`. Med `hit`: fylld och "✓ RAD".
- `Verdict`: flyttas ur `RaceResult` eller återanvänds. Ord och ikon, aldrig bara färg.
- Bet läses från `outcome.bet` när den finns, annars `mark.bet`. Oddset från `mark.betOdds`. Träff räknas som i `raceResultView`: placering 1–3 och inte diskad.

**Tangentbord.** Se 14.3. Hjälpen `?` är panelen `.kbh` i mockupen.

### 5.3 Resultatkontrollen

| Läge (`resultMode`) | Dolt | Visat |
|---|---|---|
| `before` | Ingen kontroll | – |
| `waiting` | Statustext "Väntar på resultat" | – |
| `late` | Statustext "Resultatet har inte kommit än", knappen Hämta resultat | – |
| `result` | Statustext "Resultatet är dolt" (dator), knappen **Visa resultat** | Knappen **Dölj resultat**, summan för raden |
| `cancelled` | Ingen kontroll | – |

**Beslut: innan resultatet finns visas ingen knapp.** En avstängd knapp går inte att göra något med och tar ett tabbstopp. Texten säger läget. Så fort `resultAt` kommer visas knappen, vilket inte säger något om utfallet.

- Knappen är `secondary` på dator och `ghost` i vyrubriken i mobil. Minst 44 px hög.
- Tangenten R är en tagg i Live. Ingen tangent visar resultat, så det kan inte ske av misstag.
- Visas resultatet för ett lopp och `resultAt` senare blir tomt (rättning hos ATG) gäller läget som saknat, medan valet ligger kvar.

---

## 6. Alla lägen och texter

Lopp benämns alltid med `legName(gameType, leg)`, spelformen med `round.gameType`. `{V85-4}` och `{V85}` nedan är exempel. Ingen text innehåller "Avd" eller "avdelning". Texterna samlas i `lib/live-view.ts` för Live och i `lib/submitted-row.ts` för raden.

### 6.1 Sidan

| Läge | Visning | Text |
|---|---|---|
| Laddar, ingen cache | Lopprad som skelett, rutnät som skelett, `aria-busy` | – |
| Omgången finns inte | `Banner info` | Omgången finns inte. Länk: Till aktuell omgång |
| Kunde inte hämta, ingen cache | `Banner err` med Försök igen | {felet från API:t} |
| Omgång utan lopp | `EmptyState` | **Inga lopp än** · Startlistan är inte hämtad. · Till omgången |
| Tidigare omgång | Tunn banderoll under lopprad. Dator: i `deskMeta` | Det här är en tidigare omgång. Till aktuell omgång |
| Offline | Status (6.3). Allt annat fungerar | – |

### 6.2 Loppet

| Läge | Visning | Text |
|---|---|---|
| Har inte startat | Dator: kolumnhuvuden utan taggar. `EmptyState` under | **{V85-5} startar {18:20}** · Taggarna öppnas vid start. Förberedelserna gör du i Analys. · Till analysen (`/avd/5`) |
| Pågår | Underrad med pulserande prick | Pågår · startade {17:50} |
| Väntar, inget resultat | Underrad och status. Taggning fungerar | Väntar på resultat. Du kan tagga under tiden. Placeringen hämtas automatiskt från ATG. |
| Resultatet dröjer (`late`) | `Banner warn` med knapp | **Resultatet har inte kommit än.** ATG har inte publicerat placeringen. Den hämtas också i kväll. · Hämta resultat |
| Hämtning misslyckades | `Banner err`, `role="alert"` | **Resultatet kunde inte hämtas.** ATG svarade inte. Försök igen om en stund. · Försök igen |
| Offline och väntar | `Banner warn` | Ingen uppkoppling. Resultatet hämtas när du är uppkopplad igen. |
| Resultatet kommer medan loppet är öppet | `Banner info`, försvinner vid Visa resultat eller byte av lopp | **Resultatet har kommit.** Det är dolt tills du väljer att visa det. · Visa resultat |
| Resultat finns, dolt | Kolumner eller taggning. Underrad | Startade {lör 17:50} · resultat dolt |
| Resultat visat | Resultatlistan (7). Underrad | Startade {lör 17:50} · resultat visas |
| Nytt lopp startar medan ett annat är öppet | `Banner warn`, gäller senaste startade loppet, försvinner vid byte | **{V85-5} har startat.** Du taggar fortfarande {V85-4}. · Byt till {V85-5} |
| Inställt | `EmptyState`, inga taggar | **Loppet är inställt** · ATG har ställt in loppet. Det räknas inte i statistiken. |

### 6.3 Taggning och status

Statusraden: `.tstat`, `aria-live="polite"`. Står i `.rbar` på dator, under taggarna i mobil. Räknas på utkorgens poster för omgången (`meta.round.id`), inte bara loppet. Högst en av raderna gäller, uppifrån:

| Läge | Text |
|---|---|
| Taggarna läses | Läser taggarna … Knapparna är avstängda |
| Läsningen misslyckades | `Banner err`: **Kunde inte läsa taggarna.** Du kan inte tagga förrän de är lästa, annars kan dina tidigare taggar skrivas över. · Försök igen |
| Kön pausad, utloggad (`status.kind === "paused"`) | Logga in igen för att spara taggarna. |
| Offline med poster i kön (`!useOnline`) | I kö ({2}) · skickas när nätet är tillbaka |
| Nät, försök har misslyckats (`tries > 0`) | Toast från utkorgen, status "Sparas …" |
| Poster skickas | Sparas … |
| Inom 10 s efter ändring, tom kö | Sparat · {Galopp på 5 Ble Du Rask} eller {Tog bort Galopp från 5 Ble Du Rask} + Ångra |
| Efter Ångra | Sparat · Ångrade senaste ändringen |
| Offline, tom kö | Ingen uppkoppling · taggar sparas i kön |
| Annars | Sparas direkt · följer hästen |

**Dagens `TagSheet` testar `status.kind === "paused"` för offline. Det är fel läge** (paused betyder utloggad) och ska inte följa med.

| Felväg | Text | Var |
|---|---|---|
| Utkorgen försöker igen | Kunde inte spara {Galopp} för {Ble Du Rask}. Försöker igen. | Toast, kräver `what` i `CommentMeta` (12.5) |
| Servern avvisar | {serverns mening} | Toast, taggarna läses om (12.4) |

**Räknare:** "{3} av {15} taggade". Mobil: under taggarna. Dator: `.rbar`.

**Ingen inlämnad rad:** "Ingen inlämnad rad" i `.rbar`, `.help` under taggarna i mobil. Syns bara efter start.

---

## 7. Resultatlistan

Ersätter kolumnerna (dator) och remsa, hästhuvud, taggar och Föregående/Nästa (en häst i taget). Lopprad, rubrik och Dölj resultat står kvar.

### 7.1 Ordning (`liveResultList`, ren funktion)

1. Placerade med `place >= 1`, inte diskade, stigande. Dött lopp: samma siffra, sedan startnummer (`byPlace`).
2. Oplacerade (`place` 0 eller null, inte diskade), efter `finishOrder`, sedan startnummer. Utan `result`: sist i gruppen.
3. Diskade, efter startnummer.
4. Strukna visas inte.

### 7.2 Rad

| Del | Innehåll |
|---|---|
| Placering | **Topp 3:** `FlapNumber placed`, bärnstensgul. Övriga: `.plc` med siffran. Oplacerad: "–". Diskad: "d" |
| Startnummer | `FlapNumber size="sm"` utan spårbricka och signaler |
| Häst | `.pn` på en rad med ellipsis. Diskad: taggen "Diskad" efter namnet |
| Kusk | `driver.name`, annars "Kusk saknas" |
| Bet | `BetTicket` + `Verdict` Träff eller Miss. Tomt utan Bet |
| RAD | `RadPill`, med `hit` och "✓ RAD" om hästen vann loppet. Tomt om hästen inte är med i inlämnad rad |
| Taggar | Högst 2 `.tag` (Galopp och Diskad med `.bad`, som i `CommentItem`), sedan "+{n}". Hela listan i `title` och skärmläsartexten |

**Finns inte i listan:** senaste 5 starterna, signaler, riktodds, statistik, märkena I, S och X, Trollspöt, km-tid, odds och galoppmärke från resultatet. En Galopp syns om han har taggat den.

**Topp 3:** bakgrund `--accent-soft`, 3 px `--fill` till vänster. Texten är densamma, och placeringssiffran bär informationen, så färgen är aldrig ensam.

**Raderna är inte klickbara** och har ingen hover-effekt. För att ändra taggar: Dölj resultat. Det sägs i hjälpraden under listan: "Vill du ändra taggar? Tryck Dölj resultat."

### 7.3 Responsivt

- **Under 1024 px:** minst 60 px hög. Rutnät placering 32 · nummer 28 · namn och kusk `1fr` · högerspalt `auto` med Bet och RAD under varandra. Taggarna på egen rad under kusken. Listan skrollar, rubriken står kvar.
- **Från 1024 px:** en rad, högst 56 px. Kolumner placering 48 · nr 40 · häst `minmax(180px, 1.5fr)` · kusk `minmax(120px, 1fr)` · Bet 150 · RAD 70 · taggar `minmax(140px, 1.2fr)`. Listan är högst 1200 px bred och ligger till vänster. Kolumnrubriker i versaler, `aria-hidden`.
- Långa namn kortas med ellipsis, fullständigt i `title`.
- Få hästar: listan är bara så hög den behöver vara.

### 7.4 Summan för raden

Bara när loppets resultat visas, och bara med inlämnad rad. Dator: `.score` i `.rbar`. Mobil: raden `.tstrip-h` över listan.

| Läge | Text |
|---|---|
| Inte alla lopp visade | Raden: {3} rätt av {4} visade |
| Alla ej inställda lopp visade | Raden: {6} rätt av {8} |
| Ingen inlämnad rad | Ingen inlämnad rad |

---

## 8. Resultatskyddet: kartläggning

### 8.1 Valet

- `lib/reveal.ts` (rena funktioner) och `components/round/revealStore.ts` (lager med `useSyncExternalStore`, `localStorage`-nyckel `sv-visat`). Formen är omgångs-id mot lista av lopp. Tål blockerad lagring: valet gäller då till omladdning. Högst 40 omgångar sparas, äldst först bort. `storage`-händelsen synkar flikar.
- Serverns ögonblicksbild är "inget visat", så ingen ritning kan blinka resultat före hydreringen.
- Regeln: ett lopp visas när `resultAt` finns, loppet inte är inställt och valet är satt. Med `FEATURES.raceView` av räknas allt som visat, så att dagens beteende gäller till driftsättningen.
- Klienten har resultatet i minnet och i `localStorage` (hela `RoundResponse`). Skyddet gäller vad som visas och läses upp, inte vad som går att hitta i utvecklarverktygen.

### 8.2 Varje ställe i dagens kod

| # | Plats | Vad den visar i dag | Vad som gäller |
|---|---|---|---|
| 1 | `RaceWorkspace.tsx` 197–200 | Hoppar själv till Resultat efter start | Dolt: Startlista förvald. Visat: Resultat förvalt, som i dag |
| 2 | `RaceWorkspace.tsx` 361, 428–434 | R och segmenten | Fungerar kvar. Resultat när dolt visar `ResultGate`, inte resultatet |
| 3 | `RaceWorkspace.tsx` 200–211, 253 | `?vy=resultat` i adressen | Får inte visa något själv. Dolt: `ResultGate` |
| 4 | `RaceWorkspace.tsx` 636–640 | "· resultat", "Hämtat från ATG 17:55" | Tillåtet. Säger att resultatet finns, inte vad det blev |
| 5 | `RaceResult.tsx` 41–48 | Uppläsning: "Kentucky River vann. Bet 1 av 2 träff." | Dolt: "Resultatet för {V85-7} har kommit. Det är dolt." Visat: som i dag |
| 6 | `RaceResult.tsx` 64 | Summering på tavlan | Bara visat |
| 7 | `RaceResult.tsx` 65–96 | Placering 1–4 | Bara visat |
| 8 | `RaceResult.tsx` 97–132 | Bet som missade, 5 eller sämre, övriga | Bara visat |
| 9 | `RaceResult.tsx` 58–61 | Väntar, inställt | Oförändrat, inget utfall |
| 10 | `RaceResult.tsx` 135–157, `results-view.ts` `nextCard` | "V85-7 · resultat, Träff 1/1", "Omgången är klar + summering" | Nästa lopp dolt: "{V85-7} · resultat dolt", text "Tryck Visa resultat i loppet." Sista kortet: summeringen bara när alla ej inställda lopp är visade, annars "Alla lopp har resultat." |
| 11 | `results-ui.ts` `legRow`, `RoundOverview.tsx` 160, 210–255 | **Omgång-listan:** "Vinnare 5 Kentucky River", "Bet: 5 … 1:a · 10 … miss", "Träff 1/2", "Intressant 1/1 topp 3" | Ny `kind: "hidden"`. Rad 1 loppnamnet, rad 2 "Startade {17:50} · resultatet är dolt", höger taggen "Dolt". Märkena I, S och B visas inte i högerdelen. Visat: som i dag |
| 12 | `RoundOverview.tsx` 130–132, `data.results.summary` | **Summeringen "Hittills" och "Omgången"** | Räknas i klienten bara över visade lopp (`revealedSummary`), från `race.summary`. Inget visat: ingen ruta. Delvis: rubriken "Visade lopp ({3} av {5})". Alla visade: "Hittills" eller "Omgången" som i dag. `data.results.summary` läses inte i klienten med flaggan på |
| 13 | `phase.ts` 267–272, `RoundOverview.tsx` `NextStepCard` | **Nästa steg:** summeringstext i Efteranalys-kortet | Servern känner inte valet på enheten, så texten tas bort (3.5) |
| 14 | `phase.ts` 197–216 | Titlar om start och väntan | Tillåtet, inget utfall |
| 15 | `RoundOverview.tsx` 32, 111–137 | "klar", "Resultat hämtade från ATG …" | Tillåtet |
| 16 | `HorseCard.tsx` 993 `commentWhen`, `dto.ts` 155 | **Hästkortet:** "1:a", "diskad" efter kommentaren, också i `aria-label` på Redigera och Ta bort | Kommentar från **samma omgång** med dolt lopp: placeringen utelämnas. Andra omgångar visas som i dag, de är hästens historik. Servern ändras inte |
| 17 | `HorseCard.tsx`, `round-server.ts` 733–734 | 5 senaste starter, statistik per år | Inget att dölja i listan: posterna filtreras med `date < omgångens datum`. Se risk R1 för statistiken |
| 18 | `round-server.ts` 162, `FormStrip` | Formrutorna i startlistan | Samma filter, säkert |
| 19 | `TagRace.tsx` 23, 63, 68, 163, 192, 197, 213 | Placering i remsan, aria-etiketten, hästhuvudet och sortering | Försvinner med `TagRace` (13). Finns inte i Live |
| 20 | `app/(app)/omgang/[id]/analys`, `RoundAnalysisView` | Allt, alla lopp | **Skyddas inte.** Öppnas bara med eget tryck. Kortet varnar (3.5) och sidan har en rad överst: "Efteranalysen visar resultatet för alla lopp, också de du inte har visat." |
| 21 | `/statistik`, `OverTimeView`, `buildOverTime` | **Statistiken** räknar in alla omgångar med minst en träff, också dagens | **Skyddas inte.** En rad överst under pågående omgång: "Statistiken räknar med alla lopp som har resultat, också de du inte har visat." |
| 22 | `/api/rounds/current`, `legs[].winner`, `betResults`, `summary` | Skickas men **renderas ingenstans** (`CurrentRound` läser bara id och `nextStep`) | Ingen ändring. Får inte börja visas utan valet |
| 23 | `RaceTabs`, `RoundLinks`, `PlatsPanel`, `TrollPanel`, `RadPanel`, `Kupong`, `SourcesView` | Inget utfall (kontrollerat i koden) | Ingen ändring |
| 24 | `Efteranalys`-länkar till `/avd/n/hast/x` | Öppnar hästkortet | Följer tabellen ovan. Har han sett efteranalysen men inte tryckt Visa är loppet fortfarande dolt |

### 8.3 `ResultGate`

Visas i fliken Resultat i Analys när `resultMode === "result"` och loppet är dolt.

- Text: **Resultatet för {V85-4} är dolt.** Tryck på Visa resultat när du är redo. Det ligger sedan kvar tills du trycker Dölj resultat. · Visa resultat (`primary`).
- Efter Visa resultat: fokus på rubriken Placering. `RaceResult` får knappen **Dölj resultat** (`ghost`) i rubriken. Den växlar till Startlista och flyttar fokus till segmentet Startlista.
- Inget annat än rubriken och väntelägena visas, inget Nästa-kort med utfall.

Valet är gemensamt: visat i Analys är visat i Live och på Omgång, och tvärtom.

---

## 9. Inlämnad rad: datamodell och API

**Ansvar: backend.** Fälten `Coupon.copiedAt` och `Coupon.copiedSelections` och deras beteende ändras inte. E7 fortsätter som i dag.

### 9.1 Modell `SubmittedRow`

Ny tabell, inte fält på `Coupon`: `selections` räknas om vid varje ändring och `copiedSelections` skrivs över vid varje uttag, medan kopian aldrig får ändras av appen.

| Fält | Typ | Regel |
|---|---|---|
| `id` | text, cuid | Primärnyckel |
| `userId` | text | FK till `User`, `onDelete: Cascade`. Alltid från sessionen |
| `roundId` | text | FK till `Round`, `onDelete: Cascade` |
| `selections` | JSONB | Kopia, `{ "1": [2, 5], … }`, sorterad och utan dubbletter. Struken häst stannar kvar |
| `rows` | int | Räknas av servern. Check `>= 1` |
| `cost` | decimal(14,2) | `couponCost(rows, rowPrice)`. Check `>= 0` |
| `rowPrice` | decimal(6,2) | Radpriset vid markeringen. Check `> 0` |
| `markedAt` | timestamp(3) | När Mikael tryckte, enligt klienten |
| `markedLate` | boolean, default false | `markedAt` >= första start (3.4). Räknas av servern vid varje PUT |
| `createdAt`, `updatedAt` | timestamp(3) | Som övriga tabeller |

- Unikt: `(userId, roundId)`. Index: `roundId`. `@@schema("spelvarde")`. Relationer läggs till på `User` och `Round`.
- Radkommentar i `schema.prisma` hänvisar till den här specen. `Per användare`-listan överst i filen uppdateras.

### 9.2 Migrering

- Mapp `prisma/migrations/20261031120000_e8_submitted_row/`.
- **Additiv:** `CREATE TABLE`, FK, index, CHECK och `ENABLE ROW LEVEL SECURITY`. Inget på befintliga tabeller, inga `UPDATE`.
- Rubrikkommentar som i E6: vad, varför, att inget skrivs om.
- Ska passera `npm run check:migration`. Allt kvalificerat med `"spelvarde"`. Testet i `fetch-round.db.test.ts` som räknar tabeller utan RLS ska fortsätta ge noll.
- Drift: `bash BettingBBW/scripts/prod-db.sh deploy`, bara `migrate deploy`, efter Mikaels ja och **före** koden.
- Inga befintliga kuponger kopieras över. Tidigare omgångar saknar rad, och Live säger "Ingen inlämnad rad".

### 9.3 API

Rutten `app/api/rounds/[id]/submitted-row/route.ts`, med `withUser`, `isId`, `readJson(req, 16_000)` och logik i `lib/e2-server.ts`-stil i `lib/submitted-row-server.ts`, så att den går att testa mot databasen. Ingen GET: raden följer med `GET /api/rounds/[id]`.

**`PUT /api/rounds/[id]/submitted-row`** – idempotent upsert på `(userId, roundId)`. Täcker både markering och Ersätt raden.

Kropp:

| Fält | Regel |
|---|---|
| `selections` | Objekt med lopp som nyckel, tolkas med samma regler som `parseSelections` i `lib/coupon.ts`, som exporteras |
| `rowPrice` | 0,01–100 kr, avrundas till hundradelar |
| `markedAt` | ISO-tid med tidszon, samma format som `copiedAt`. Högst 5 min framåt |

Okänt fält ger 400.

| Fel | Status | Text |
|---|---|---|
| Ogiltig omgång | 400 | Ogiltig omgång. |
| Ogiltig kropp | 400 | Ogiltig begäran. |
| Okänt fält | 400 | Okänt fält i raden. |
| Lopp utanför spelformen | 400 | {V85-9} finns inte i omgången. |
| Startnummer finns inte | 400 | Startnummer {16} finns inte i {V85-3}. |
| Lopp utan häst | 400 | {V85-3} har inga hästar i raden. |
| Fler än 2 000 000 000 rader | 400 | Raden har för många rader. |
| Fel radpris | 400 | Radpriset ska ligga mellan 0,01 och 100 kr. |
| Fel tid | 400 | Ogiltig tid för markeringen. |
| Omgången finns inte | 404 | Omgången finns inte. |

- **Tidsspärr finns inte och inget 409:** en markering får göras efter spelstopp, och en köad markering måste gå igenom. `markedLate` är svaret på frågan.
- Struken häst är tillåten, eftersom kopian kan ha varit inlämnad innan hästen ströks. Startnumret ska bara finnas i loppet.
- Svar 200: `{ submittedRow: SubmittedRowDto }`.

**`DELETE /api/rounds/[id]/submitted-row`** – hård borttagning med `deleteMany` på `userId` och `roundId`. Idempotent: svarar `{ ok: true }` även utan rad. Ångra skickar en PUT med de gamla värdena.

**Behörighet:** `userId` tas alltid från sessionen, aldrig från kroppen. En användare kan aldrig läsa eller ändra någon annans rad. Inget ADMIN-krav.

**DTO och omgången:** `SubmittedRowDto` = `roundId`, `selections`, `rows`, `cost`, `rowPrice`, `markedAt`, `markedLate`, `updatedAt`. Lägg `submittedRow?: SubmittedRowDto | null` i `RoundResponse` och fyll i `buildRoundResponse`. Fältet är frivilligt i typen, eftersom äldre cachade svar saknar det. Läs med `?? null`.

### 9.4 Rena funktioner, `lib/submitted-row.ts`

`parseSubmittedRowBody`, `rowsOfSelections` (rader, kostnad, spärr för antal), `isLateMark(markedAt, races)`, `sameRow(a, b)`, `rowDiff(submitted, current, gameType)` med texten "{V85-3} +7. {V85-4} +12 −10." (äkta minustecken), `winnersInRow(row, races, shownLegs)`. Testas i 17.2.

### 9.5 Utkorg, offline och cache

**Ansvar: frontend.**

| Handling | Post | Meta |
|---|---|---|
| Markera, Ersätt, Ångra borttagning | `PUT /api/rounds/{id}/submitted-row` | `{ kind: "submitted-row", roundId }` |
| Ångra markeringen | `DELETE /api/rounds/{id}/submitted-row` | `{ kind: "submitted-row-delete", roundId }` |

| Plats | Ändring |
|---|---|
| `ItemMeta` | De två nya typerna |
| `RoundProvider` | `submitRow(body)` och `removeSubmittedRow()` |
| `applyPending` | Sista posten för omgången vinner: PUT ger en `SubmittedRowDto` räknad ur kroppen med `pending: true`, DELETE ger `null`. Villkoret för tidig retur utökas |
| `applyDone` | PUT skriver svaret, DELETE sätter `null`. `withNextStep` körs inte om |
| `onDone` i `outbox-client.ts` | Listan över typer som patchar omgången utökas |
| `retryText` | Kunde inte spara markeringen. Försöker igen. **Måste läggas till.** Annars faller typen igenom till kommentarstexten, som läser `horseName` |
| `rejectedText` | Kunde inte spara markeringen: {serverns mening} |
| `conflictText` | Används inte, servern svarar aldrig 409 |

**Offline, steg för steg:**

1. Tryck: `markedAt` sätts till klockan vid trycket och posten läggs i kön.
2. Överlägget gör att rutan genast visar ✓ Inlämnad och Live visar RAD. Status: "I kö · sparas när nätet är tillbaka".
3. Omladdning offline: posten och den cachade omgången ligger i `localStorage` och läggs ihop som vanligt.
4. Nät igen: posten skickas. Skickades den efter spelstopp men trycktes före: `markedAt` avgör, och `markedLate` blir false.
5. Status: "Sparad. Live visar den här raden."
6. 4xx: posten tas bort, överlägget försvinner, toast. 401: kön pausas, "Logga in igen".
7. Två PUT i kö slås ihop av `enqueue` (senaste kroppen vinner). PUT följt av DELETE skickas i ordning.

---

## 10. Regler för raden

| Fråga | Regel |
|---|---|
| **Vad sparas** | Raden som står på kupongen i rutan. `live`: `view.selections`. `legacy` och `started`: `selectionsOf(saved)`. Finns `copiedSelections` som skiljer sig väljer Mikael, och den raden är förvald |
| **Vems uppgift** | Mikaels egen markering. Appen vet inte vad ATG har tagit emot. Det står vid varje knapp och i rutan |
| **Ingen markerad rad** | Inga RAD-märken, ingen summa, texten "Ingen inlämnad rad". Appens uträknade rad och `copiedSelections` räknas **aldrig** som spelad |
| **Raden ändras efteråt** | Arbetsraden räknas om som i dag. Kopian ändras aldrig. Banderoll i V85-raden, före spelstopp, när raderna skiljer sig (`rowDiff`). När en inlämnad rad finns ersätter den banderollen `copyChangedText`, så att bara en visas. Fälten bakom ändras inte |
| **Struken efter inlämning** | Står kvar i kopian. Syns som struken i V85-raden och i Live ("· i raden"). Banderoll per häst. Räknas inte som rätt, vilket följer av att den inte kan vinna. Rader och kostnad i kopian ändras inte |
| **Inställt lopp** | Raden står kvar. Loppet räknas varken som rätt eller i nämnaren. Hur ATG räknar är inte känt, och texten lovar inget |
| **Träffräkning** | Rätt = vinnaren (`place === 1`, inte diskad) finns i kopian. Dött lopp: någon av vinnarna. Räknas bara på lopp som är visade på enheten, och syns bara när det aktuella loppets resultat visas. Texten är Spelvärdes räkning, inte ATG:s rättning |
| **Efter spelstopp** | Stopp vid första start, som i dag. Knappen heter Jag lämnade in raden före start, `markedLate` blir true och texten "markerad efter spelstopp" står i rutan. Live visar samma märken |
| **Efter spelstopp och markerad** | Ersätt finns inte. Ångra markeringen finns kvar, sedan kan han markera igen |
| **Samma rad igen** | "✓ Den här raden är markerad som inlämnad." Ingen knapp |
| **Ersätt raden** | Bara före spelstopp och när raden skiljer sig. Skriver över hela posten. Ångra i 10 s återställer gamla värden, med gamla `markedAt` |
| **Ångra markeringen** | Tar bort raden, med Ångra i 10 s. Spelet hos ATG påverkas inte, och det står i texten |

---

## 11. V85-raden: gränssnitt

**Ansvar: frontend.** Mockupens avsnitt "V85-raden". Komponenten `SubmittedBox` i `components/spel/`.

**Placering.** Dator: i `.drad-l` efter `.dact`, före budgetbanderollen. Mobil: efter budgetrutan. Efter spelstopp och med inlämnad rad visar `.drad-r` kopian, med rubriken "Inlämnad rad per lopp", i enkla kort (`SubmittedRowLegs`, fällbladsnummer, namn, "Struken"). Annars är `RadLegCard` oförändrad.

**Rutan**

| Läge | Innehåll |
|---|---|
| Inget, före spelstopp | Sekundär knapp **Jag har lämnat in raden**, öppnar arket. Avstängd med `blocked`. Hjälptext: Din egen markering. Appen vet inte vad ATG har tagit emot. |
| Inget, efter spelstopp, sparad kupong | **Ingen rad är markerad som inlämnad.** Live visar ingen rad. Knapp **Jag lämnade in raden före start**. Samma hjälptext |
| Inget, efter spelstopp, ingen kupong | **Ingen rad är markerad som inlämnad.** Live visar ingen rad. Ingen knapp |
| Inlämnad | Tavla, stämpel **✓ Inlämnad**, raden "{i dag 14:32} · {288} rader · {144,00 kr}" + " · markerad efter spelstopp". Länkar **Visa raden**/**Dölj raden** (fäller ut `Kupong`, `aria-expanded`) och **Ångra markeringen**. Samma hjälptext |
| Inlämnad, i kö | Som ovan, med statusen I kö · sparas när nätet är tillbaka |
| Efter sparning | Status (`role="status"`): Sparad. Live visar den här raden. |
| Efter Ångra markeringen, 10 s | `Banner warn` med Ångra: **Markeringen är borttagen.** Live visar inte den raden längre. Spelet hos ATG påverkas inte. |
| Efter Ersätt, 10 s | `Banner info` med Ångra: **Raden är ersatt.** Den tidigare markeringen är borttagen. |

**Banderoller i `.drad-r`**

| Läge | Ton | Text |
|---|---|---|
| Raderna skiljer sig, före spelstopp | warn + Spela hos ATG | **Raden här har ändrats efter inlämningen:** {V85-3 +7. V85-4 +12 −10.} Din inlämnade rad är oförändrad. Ändringen gäller inte hos ATG förrän du lämnar in igen. |
| Struken häst i kopian | warn | **{4 Namn} i {V85-5} är struken.** Den står kvar i din sparade rad. ATG:s regler avgör vad som händer med den, så kontrollera kupongen hos ATG. Spelvärde räknar den inte som rätt. |
| Efter spelstopp | info, oförändrad | `startedText` |

**Arket (`RadAtgSheet`).** Ny del `.subact` efter knapparna i E7.

| Läge | Innehåll |
|---|---|
| Före spelstopp, inget uttaget | Ladda ner ATG-fil primär. **Jag har lämnat in raden** sekundär |
| Före spelstopp, `copiedAt` finns | Ladda ner ATG-fil sekundär. **Jag har lämnat in raden** primär |
| Uttagen rad skiljer sig | Fieldset **Vilken rad lämnade du in?** Raden du laddade ner eller kopierade {14:05} · {rader · kostnad} (förvald). Raden som visas i appen nu · {rader · kostnad}. Kupongen visar valet |
| Annan rad än den inlämnade | Sekundär knapp **Ersätt raden**. Hjälptext: Ersätt bara om du har makulerat raden hos ATG. |
| Samma rad som den inlämnade | ✓ Den här raden är markerad som inlämnad. |
| Efter spelstopp, inget markerat | Kopiera texten (ghost). **Jag lämnade in raden före start** primär. Hjälptext: Sparas som markerad efter spelstopp. Det är din egen markering, och appen vet inte vad ATG har tagit emot. |
| Efter spelstopp, markerad | ✓ Inlämnad {i dag 14:32}. |

- Hjälptext före spelstopp, i arkets skrollande del: Sparar raden på kupongen ovan: {rader · kostnad}. Det är din egen markering, och appen vet inte vad ATG har tagit emot.
- Nytt steg 5 i "Så spelar du raden": Tryck **Jag har lämnat in raden** när ATG har tagit emot spelet.
- E7:s krav gäller: statusrad och knappar är klistrade och ska synas i 360 × 640. **Bara knappen ligger i den klistrade delen.** Fieldset och hjälptext ligger i den skrollande delen.
- Arket stängs efter markeringen. Fokus flyttas till statusraden i rutan (`tabIndex={-1}`).

**Handlingsraden i mobil (`RadActionBar`).** Ny prop `submitted`.

| Läge | Vänster | Knapp |
|---|---|---|
| Före spelstopp, inget inlämnat | {rader} · {kostnad} / Inte markerad som inlämnad. Över budget: dagens text i stället | Spela hos ATG |
| Före spelstopp, inlämnad | **✓ Inlämnad** / {rader} · {kostnad} för kopian | Spela hos ATG |
| Efter spelstopp | Som ovan | Visa kupongen (sekundär) |

---

## 12. Taggning: så sparas den

**Ansvar: frontend.** Befintligt RACE-flöde återanvänds: en `HorseComment` av typen RACE per start, `PUT`/`DELETE /api/comments/[clientId]` genom utkorgen och `GET /api/rounds/[id]/races/[leg]/tags`. Ingen ändring i API eller databas. Taggarna syns kvar under Mina kommentarer och i Efteranalys.

### 12.1 En häst i taget, utan fördröjning

- Varje klick ändrar lagret synkront, ritar om den kolumnen och lägger en post i utkorgen. **Ingen debounce**, ingen delad timer och inget samlat sparande. Så kan klick på olika hästar inte blandas ihop.
- Varje häst har egen `clientId` och därmed egen adress, så posterna kan aldrig skriva över varandra.
- Utkorgen skickar i ordning, en i taget. Posten som skickas ändras inte. Nästa ändring för samma häst blir en ny post, och senare ändringar slås ihop in i den (`enqueue`). Kroppen är alltid hela läget, så det sista klicket vinner.
- Klicket ska aldrig vänta på nätet och taggen tänds i samma ritning.

### 12.2 Snabba klick får inte tappa taggar

**Problem i dag:** `TagSheet` räknar `toggleTag(curTags, tag)` på värdet från senaste ritningen. Två klick innan React hunnit rita, eller en tangent som hålls, utgår från samma lista, och en tagg försvinner.

**Krav:** Två nya funktioner i `tagStore`. Båda läser hästens **aktuella** värde ur lagret i samma stund:

| Funktion | Gör |
|---|---|
| `toggleRaceTag(ctx, start, tag)` | Läser `tags` och `text` ur lagret, använder `toggleTag`, sparar. Returnerar läget före, för Ångra. Inget händer om loppets taggar inte är lästa |
| `setRaceText(ctx, start, text)` | Läser `tags` ur lagret, sparar texten. Inget händer om texten är oförändrad |

Komponenter skickar aldrig in en färdig lista. `saveRaceTag` blir intern och används för Ångra.

### 12.3 Lagret efter omladdning och i kö

**Problem i dag:** Lagret ligger bara i minnet. Efter en omladdning med poster i kön hämtar `loadRaceTags` serverns läge utan köns ändringar. Då ser Mikael gamla taggar, nästa klick skriver över det köade, och en häst utan kommentar får ny `clientId`. När båda skickas stoppar det unika indexet `HorseComment_one_race_per_start_key` den andra med 422.

**Krav:** `loadRaceTags` lägger köns poster för loppet ovanpå serverns svar med den rena funktionen `applyPendingRaceTags(comments, queue)` i `lib/race-tags.ts`. PUT med `body.kind === "RACE"` ger hästens läge med postens `clientId`. DELETE matchas på `clientId` och ger tomma taggar med samma `clientId`.

### 12.4 Läsning och flera enheter

- Live läser taggarna för **alla** startade lopp när sidan öppnas (högst 8 GET, parallellt), eftersom loppraden ska visa antal och taggning ska fungera offline efter öppning.
- Knappar för ett lopp är avstängda tills det loppets taggar är lästa.
- `loadRaceTags(force)` låter i dag lokala värden vinna över alla servervärden, så andra enheters ändringar syns aldrig. Med force gäller: servern vinner för hästar utan post i kön, kön vinner för övriga.
- Läses om med force när sidan syns igen (`visibilitychange`) och när utkorgen avvisar en RACE-kommentar (`onRejected`). Det senare fångar 422 från det unika indexet, och status visar serverns mening.
- Samma häst ändrad på två enheter: senaste skrivning vinner. Det är accepterat.

### 12.5 Ångra, meta och övrigt

- Ångra gäller senaste ändringen, i vilket lopp och på vilken häst den än var, i 10 s. Djup 1. Statusraden säger vilken häst. Z och Ctrl/Cmd + Z utanför textfält.
- Tog bort sista taggen och ingen text: `DELETE`. En ny tagg: `PUT` på samma `clientId`. Det befintliga flödet klarar det.
- `CommentMeta` får det frivilliga fältet `what` (taggen). `retryText` använder det. Befintliga köade poster utan fältet får dagens text.
- Egna taggar utanför `QUICK_TAGS` behålls (`toggleTag`). De har ingen knapp men syns i resultatlistan.
- Vibration 10 ms vid tagg där det stöds, som i dag.
- Taggning är bara möjlig efter start och på löpande hästar, i gränssnittet. API:t är oförändrat.

---

## 13. Vad som tas bort

Tas bort i **samma ändring som `features.raceView` slås på**, inte förr. Dagens taggning ska fungera tills Live är i drift.

| Tas bort | Fil |
|---|---|
| `TagRace`, `TagCta`, `TagSheet` | `components/round/TagRace.tsx`, hela filen |
| `TagRace` och `TagCta` i arbetsvyn | `RaceWorkspace.tsx` 51, 471, 489, 739 |
| Knapparna Tagga i loppet och `openTagging` | `HorseCard.tsx` 35, 186–190, 254–258 |
| `openTagging`, `selectTagStart`, `closeTagging`, `useTaggingOpen`, variabeln `open` | `tagStore.ts` |
| `.tagcta`, `.tagr`, `.tagr-top`, `.tagr-body`, `.vr-tag`, `.race > .rwrap .tagcta`, `.khelp` om den inte används annat | `styles/app.css` 602, 667, 1505–1513, 1554 |
| Texten "Använd Tagga loppet …" → "Tagga hästarna i Live efter start." | `components/analysis/parts.tsx` 211 |
| Texten "Taggarna kommer från Tagga loppet." → "Taggarna kommer från Live." | `lib/analysis.ts` 206 |

**Befintliga taggar försvinner inte.** Ingen data rörs: taggarna är `HorseComment` och läses av samma GET. Inga migreringar eller skript. Köade poster i utkorgen fungerar efter uppdateringen, eftersom URL, kropp och meta är kompatibla.

**Kvar till driftsättningen:** med `FEATURES.raceView = false` renderas dagens `TagCta` och `TagSheet`, dagens Resultat-förval och dagens Nästa steg. Ingen uppdelning på enheter behövs, eftersom flaggan sitter i koden.

---

## 14. Tillgänglighet

### 14.1 Semantik och fokus

- Landmärken `header`, `nav` (huvudmeny, faser), `main`. `h1` i `.rbar` eller vyrubriken. Hästnamn `h2`.
- Lopprad: `role="tablist"`, panel `role="tabpanel"`. Remsan: `role="tablist"`, som i dag.
- Taggknapp: `aria-pressed`, `aria-label` "{Galopp}, {5} {Ble Du Rask}".
- Kolumn: `role="group"`, `aria-label` "{5} {Ble Du Rask}, Bet spelad till 2,40, med i din rad, Spelbar, Intressant". Aldrig placering.
- Resultatlista: `ul` med `aria-label` "Resultat {V85-4}". Varje `li`: en `.sr`-mening, synliga delar `aria-hidden`, exempel: "1:a, nummer 7, Nordic Sunset, A. Lindqvist. Bet, spelad till 2,40, träff. Med i din inlämnade rad, vann loppet. Taggar: Tog spets, Ledde hela vägen." Oplacerad: "Oplacerad, nummer 3, …". Diskad: "Diskad, nummer 5, …".
- Färg bär aldrig ensam: Bet har ord och ram, Rad ord och streckad list, Träff och Miss ord och ikon, topp 3 siffran, vald tagg ✓.
- Kontrast: kontrollera `--ink` på `--accent-soft`, `.vd.y` i båda teman och `--ink-2` på zebra.

**Fokus:**
- Dator: skip-ordning lopprad → fasrad → resultatkontroll → aktiv taggknapp (rovande `tabindex`, en häst i rutnätet) → `?`.
- Efter Visa resultat: rubriken "Resultat {V85-4}" i listan (`tabIndex={-1}`, synlig för skärmläsare). Efter Dölj resultat: knappen Visa resultat.
- Byte av häst i mobil: rubriken med hästnamnet, som i dag.
- Fritext: fokus i fältet vid öppning, tillbaka till Fritext-knappen vid stängning.
- Dialoger: som `Sheet`. Toasten ligger under modala dialoger (E7), så arkets egna besked går i statusraden.

### 14.2 Uppläsning

| Händelse | Text (`aria-live="polite"`) |
|---|---|
| Tagg | Sparat · {Galopp på 5 Ble Du Rask}. |
| Byte av lopp | {V85-5}, {Klass I}, {13} hästar. |
| Resultat kommer, dolt | Resultatet för {V85-4} har kommit. Det är dolt. |
| Visa resultat | Resultatet för {V85-4} visas. |
| Dölj resultat | Resultatet för {V85-4} är dolt. |
| Nytt lopp startat | {V85-5} har startat. Du taggar fortfarande {V85-4}. |

Vid dolt lopp läses aldrig placering, vinnare, träff eller summa upp.

### 14.3 Tangentbord i kolumnläget och läget en häst i taget

Av när fokus står i textfält eller en dialog är öppen, och i resultatlistan utom PageUp/PageDown, `?` och Esc.

| Tangent | Gör |
|---|---|
| 1–15 | Väljer häst. Har loppet 10 eller fler hästar väntar appen 600 ms efter en etta. Strukna ignoreras |
| Bokstav (`QUICK_TAGS`) | Växlar taggen på aktiv häst |
| ← → | Häst. ↑ ↓: tagg, och nedåt från sista taggen till Fritext |
| Mellanslag, Enter | Växlar taggen med fokus (vanlig knapp) |
| + | Öppnar Fritext |
| Z, Ctrl/Cmd + Z | Ångra |
| PageUp, PageDown | Byter lopp |
| ? | Visar eller döljer hjälpen |
| Esc | Stänger Fritext och hjälpen |

**Regel mot fel häst:** Väntar appen på en andra siffra och en bokstav trycks, väljs hästen med den första siffran direkt, innan taggen sätts. En tagg får aldrig hamna på föregående häst för att timern inte hunnit gå ut.

`prefers-reduced-motion`: pulsen och alla övergångar av. Ingen information bärs av rörelse.

---

## 15. Komponenter och filer

### Backend

| Fil | Åtgärd |
|---|---|
| `prisma/schema.prisma` | `SubmittedRow`, relationer |
| `prisma/migrations/20261031120000_e8_submitted_row/migration.sql` | Ny |
| `app/api/rounds/[id]/submitted-row/route.ts` | Ny |
| `lib/submitted-row.ts`, `.test.ts` | Ny |
| `lib/submitted-row-server.ts`, `lib/submitted-row.db.test.ts` | Ny |
| `lib/coupon.ts` | Exportera `parseSelections` |
| `lib/dto.ts`, `lib/types.ts` | `submittedRowDto`, `SubmittedRowDto`, `RoundResponse.submittedRow` |
| `lib/round-server.ts` | Läs raden, `phaseRail` med första start |
| `lib/phase.ts`, `lib/phase.test.ts` | Avsnitt 3.4–3.5 |

### Frontend, nytt

| Fil | Innehåll |
|---|---|
| `app/(app)/omgang/[roundId]/live/page.tsx` | Sidan |
| `components/live/LivePage.tsx` | Laddning, val av lopp, val av läge, tangenter |
| `components/live/LiveColumns.tsx`, `LiveColumn` | Kolumnläget |
| `components/live/LiveSingle.tsx` | En häst i taget |
| `components/live/LiveResultList.tsx` | Avsnitt 7 |
| `components/live/LiveStatus.tsx` | Statusrad, Ångra |
| `components/live/LiveBanners.tsx` | Lägen i 6.2 |
| `components/live/useLiveTags.ts` | Läsning för alla lopp, omläsning |
| `components/round/LiveLink.tsx`, `ResultGate.tsx` | Analys |
| `components/round/revealStore.ts` | 8.1 |
| `components/spel/SubmittedBox.tsx`, `SubmittedRowLegs.tsx` | Avsnitt 11 |
| `lib/live-view.ts`, `lib/reveal.ts`, `lib/race-tags.ts` med tester | Rena funktioner |

### Frontend, ändras

| Fil | Ändring |
|---|---|
| `lib/features.ts` | `raceView: true`, sista steget |
| `lib/results-ui.ts`, `.test.ts` | `legRow` med `hidden`, `resultAnnouncement` för dolt, `revealedSummary` |
| `lib/results-view.ts`, `.test.ts` | `nextCard` med visade lopp |
| `lib/round-overlay.ts`, `.test.ts` | Meta, `applyPending`, `applyDone`, `retryText`, `rejectedText`, `withNextStep` |
| `components/outbox/outbox-client.ts` | `onDone`, `onRejected` |
| `components/round/tagStore.ts` | Avsnitt 12 och 13 |
| `components/round/RaceWorkspace.tsx` | Förval, gate, `LiveLink` |
| `components/round/RaceResult.tsx` | Dolt läge, Dölj resultat, uppläsning |
| `components/round/RoundOverview.tsx` | Omgång-listan, summeringen, fasraden |
| `components/round/RoundBand.tsx`, `parts.tsx` | `PhaseRail`, `RaceTabs` variant `live` |
| `components/round/HorseCard.tsx` | `commentWhen`, Tagga i Live |
| `components/round/RoundProvider.tsx` | `submitRow`, `removeSubmittedRow` |
| `components/spel/RadPanel.tsx`, `RadSheets.tsx`, `RadActionBar.tsx` | Avsnitt 11 |
| `components/ui/board.tsx` | `BetTicket`, `RadPill` |
| `components/shell/BottomNav.tsx`, `AppHeader.tsx` | Dölj på Live, exportera `DeskHeader` |
| `components/analysis/RoundAnalysisView.tsx`, `OverTimeView.tsx`, `parts.tsx`, `lib/analysis.ts` | Raderna i 8.2 och 13 |
| `styles/app.css` | Nya regler, borttag |
| `docs/DESIGN.md`, `docs/specs/spelvarde.md` | 3.1, 3.2, 4, S5, S7, Live, Bet-biljetten, Rad-pillen. Ta bort alla "Tagga loppet" |

---

## 16. Byggordning

| Steg | Vem | Vad | Klart när |
|---|---|---|---|
| 1 | Backend | Modell, migrering, lokalt `db:migrate:local`, `check:migration` | Migreringen går igenom på tom och befintlig databas |
| 2 | Backend | `lib/submitted-row`, API, DTO, `RoundResponse` | Tester i 17.2, `.db.test` grönt |
| 3 | Backend | `phase.ts`, `round-server.ts`, uppdaterade tester | Tester i 17.1 |
| 4 | Mikaels ja | `prod-db.sh deploy`, sedan koden i drift. Flaggan är av. Inget syns förutom fasen | Status visar migreringen, ingen befintlig rad ändrad |
| 5 | Frontend | `revealStore`, rena funktioner, `applyPending` och utkorgens meta | Tester i 17.3–17.6 |
| 6 | Frontend | `tagStore` (12), med `TagSheet` använder nya funktioner | Dagens taggning fungerar, testet för snabba klick grönt |
| 7 | Frontend | Live: kolumner, en häst i taget, lägen, tangenter. Lokalt med flaggan på | Skärmbilder |
| 8 | Frontend | Resultatlistan | Skärmbilder |
| 9 | Frontend | Resultatskyddet, alla rader i 8.2 | Genomgång rad för rad |
| 10 | Frontend | V85-raden (11) | Offline provad |
| 11 | Frontend | Provkörning (18) med flaggan på lokalt | Alla punkter |
| 12 | Frontend | **Samma ändring:** `raceView: true` och borttag (13), dokument | Typkontroll, tester, build |

Steg 5–11 kan driftsättas med flaggan av. Den som bygger får inte slå på flaggan före steg 12.

---

## 17. Testfall för rena funktioner

### 17.1 `lib/phase.test.ts`

| # | Fall | Väntat |
|---|---|---|
| 1 | Första start 16:20, klockan lör 12:00 | `ODDS` |
| 2 | Klockan lör 16:19:59 | `ODDS` |
| 3 | Klockan lör 16:20:00 | `LIVE` |
| 4 | Omgång utan lopp, lör 12:00 | `LIVE` |
| 5 | Första loppet inställt med passerad tid | `LIVE` (samma som spelstoppet) |
| 6 | Alla resultat | `KLART` |
| 7 | `phaseRail(D, "ODDS", första start)` | Live `dayLabel` "lör 16:20", `from` = första start |
| 8 | `phaseRail(D, "ODDS", null)` | "lör 12:00" |
| 9 | `f.raceView`, ett lopp startat för 10 min sedan utan resultat | `LIVE_RUNNING`, "V85-4 pågår", `/omgang/r1/live?avd=4`, "Till Live" |
| 10 | Samma, 31 min sedan, nästa lopp finns | `LIVE_NEXT_RACE`, "V85-5 startar …", `?avd=5` |
| 11 | Alla startade, V85-7 saknar | `LIVE_WAITING`, `?avd=7` |
| 12 | `f.raceView = false` | Dagens kort, oförändrat |
| 13 | Fas Klart, med summering, `f.raceView` | Texten innehåller inte "träff" eller "topp 3" |
| 14 | Fas Odds, allt klart | "Allt klart – första start …" |
| 15 | V75 | Texterna säger V75-n |

Fall som i dag förväntar `LIVE` vid 12:00 och "Till V85-3" uppdateras.

### 17.2 `lib/submitted-row.test.ts`

| # | Fall | Väntat |
|---|---|---|
| 1 | Giltig kropp, 8 lopp | ok, sorterad, utan dubbletter |
| 2 | Okänt fält | Fel |
| 3 | Lopp 9, `selections` som array, nummer 31 | Fel |
| 4 | Radpris 0, 101, text | Fel med rätt text |
| 5 | `markedAt` utan tidszon, ogiltig | Fel |
| 6 | `rowsOfSelections` 2×1×3×3×4×1×3×3 | 648 rader, kostnad vid 0,50: 324,00 |
| 7 | Tomt lopp | Fel med V85-3 |
| 8 | V75 med 7 lopp, lopp 8 | Fel: V75-8 finns inte |
| 9 | Mer än gränsen | Fel: för många rader |
| 10 | `isLateMark` före, exakt vid och efter första start | false, true, true |
| 11 | `sameRow` olika ordning | true |
| 12 | `rowDiff` | "V85-3 +7. V85-4 +12 −10. V85-5 −4." med U+2212 |
| 13 | `rowDiff` lika | Tomt |
| 14 | `winnersInRow`: 4 visade, 3 rätt | "Raden: 3 rätt av 4 visade" |
| 15 | Alla visade | "Raden: 6 rätt av 8" |
| 16 | Dolt lopp som vanns | Räknas inte |
| 17 | Inställt lopp | Inte i nämnaren |
| 18 | Dött lopp, en vinnare i raden | Rätt |
| 19 | Diskad med `place` 1 | Inte rätt |
| 20 | Struken i raden | Inte rätt, rader oförändrade |
| 21 | Ingen text innehåller "Avd" | Sant |

**`lib/submitted-row.db.test.ts`** (riktig databas): PUT skapar, PUT igen uppdaterar samma rad. Två användare hindrar inte varandra, en ser aldrig den andres. Andra PUT med `markedAt` efter start ger `markedLate`, och köad med `markedAt` före start ger false. DELETE utan rad svarar ok. Befintlig `Coupon` med `copiedSelections` är oförändrad. RLS på. Radering av omgång tar bort raden. `GET /api/rounds/[id]` innehåller `submittedRow`.

### 17.3 `lib/reveal.test.ts`

Tom och skadad lagring ger tomt. Visa lägger till ett lopp, Dölj tar bort det, andra lopp och omgångar rörs inte. Över 40 omgångar tar bort äldsta. `isShown`: inget `resultAt` ger false, inställt ger false, satt och resultat ger true.

### 17.4 `lib/live-view.test.ts`

| # | Fall | Väntat |
|---|---|---|
| 1 | `liveResultList` med platser 1, 2, 3, 4, 6 | I ordning |
| 2 | Dött lopp 1, 1, 3 | Båda ettor, efter startnummer, sedan 3 |
| 3 | `place` 0 med `finishOrder` 7 och 5 | 5 före 7, efter placerade |
| 4 | Diskad | Efter oplacerade |
| 5 | Struken | Saknas |
| 6 | Utan `result` | Sist bland oplacerade |
| 7 | `top3` | Sant för 1–3, falskt för 4 och diskad |
| 8 | Bet med plats 3, 4, diskad | Träff, Miss, Miss |
| 9 | Bet utan `outcome`, `mark.bet` | Bet visas, läses från `mark` |
| 10 | RAD: i kopian och vann | `hit` |
| 11 | RAD: i kopian, kom tvåa | Inte `hit` |
| 12 | Ingen inlämnad rad | Inget RAD-fält |
| 13 | Tre taggar | Två + "+1", alla i skärmläsartexten |
| 14 | `rowSr` | Exakt meningen i 14.1 |
| 15 | `defaultLiveLeg` | Pågående före otaggat, otaggat före första, inställt hoppas över, inget startat ger 1 |
| 16 | Layout, V75 | 7 lopp |
| 17 | Ingen text innehåller "Avd" | Sant |

### 17.5 `lib/race-tags.test.ts` och `tagStore`

| # | Fall | Väntat |
|---|---|---|
| 1 | Två `toggleRaceTag` utan ritning emellan, olika taggar | Båda taggarna kvar, sista posten har båda |
| 2 | Tre klick på samma tagg | Tagg på, två poster slås ihop rätt |
| 3 | Klick på häst A, B, A i följd | A med båda, B med sin. Egna adresser |
| 4 | Posten för A skickas, nytt klick på A | Ny post, den skickade ändras inte |
| 5 | Ta bort sista taggen | DELETE. Ny tagg: PUT med samma `clientId` |
| 6 | Läsning med köad PUT för ny häst | Köns `clientId` och taggar i lagret |
| 7 | Läsning med köad DELETE | Tomma taggar, samma `clientId` |
| 8 | Klick innan taggarna är lästa | Ingen post |
| 9 | Force: annan enhet har ändrat, ingen post i kö | Serverns värde |
| 10 | Force med post i kö | Köns värde |
| 11 | `setRaceText` efter tagg | Kroppen har taggen och texten |
| 12 | Ångra på annan häst | Rätt häst återställs |

### 17.6 Övriga

| Fil | Fall |
|---|---|
| `lib/results-ui.test.ts` | `legRow` dolt: `kind: "hidden"`, varken "Vinnare" eller hästnamn i texten. Visat: som i dag. `resultAnnouncement` dolt: inget hästnamn. `revealedSummary`: bara visade lopp, tom vid inget visat, lika med `results.summary` vid alla |
| `lib/results-view.test.ts` | `nextCard` nästa lopp dolt: ingen "Träff". Sista lopp, ej alla visade: ingen summering |
| `lib/round-overlay.test.ts` | PUT ger överlägg med `pending`. DELETE ger null. PUT, DELETE, PUT: sista gäller. `applyDone` för båda. `retryText` för båda nya typerna: inte kommentarstexten. Cachat svar utan fält fungerar |
| `lib/outbox.test.ts` | PUT mot `submitted-row` slås ihop, DELETE bryter ihopslagning |
| Sök i testerna | Inget hårdkodat "Avd". `/lopp/` förekommer inte i `phase.ts` |

---

## 18. Provkörning

Med flaggan på lokalt, ljust och mörkt, seedad omgång med 15 hästar i ett lopp, strukna, Bet och inlämnad rad. Skärmbilder sparas och gås igenom innan något visas för Mikael. Vid varje bild kontrolleras: läser man något om resultatet där inget ska synas?

**Skärmbilder**

- [ ] 1400 × 900: kolumner, V85-4 pågår, 15 hästar, Bet + RAD på samma häst
- [ ] 1920 × 1080: stort läge
- [ ] 1400 × 760: lågt läge, klistrat hästhuvud, två strukna
- [ ] 1100 × 800: gränsen, kolumner. 1099 × 800: en häst i taget med toppmeny
- [ ] 900 × 720: tre kolumner taggar
- [ ] 390 × 844: taggning, Bet + RAD, strukna
- [ ] 360 × 640: ingen sidskroll, Nästa synlig
- [ ] Dölj och visa: V85-4 dolt, samma lopp visat, dator och mobil
- [ ] Resultatlistan: dött lopp, diskad, oplacerad, Bet med Miss, ✓ RAD, långa namn, dator och mobil
- [ ] Lägen i 6.2: före start, väntar, dröjer, resultatet kom, nytt lopp startat, inställt, tidigare omgång
- [ ] Omgång: alla lopp dolda, delvis visade (Visade lopp), alla visade
- [ ] Analys: Startlista förvald, gate, resultat efter tryck, Dölj resultat
- [ ] Hästkortet: kommentar utan placering vid dolt lopp, Tagga i Live
- [ ] V85-rad: alla lägen i 11, arket vid 360 × 640
- [ ] V75-omgång: sju lopp, V75-n i alla texter

**Beteende**

- [ ] 20 klick på under 5 s över 5 hästar: alla taggar rätt i databasen, ingen på fel häst
- [ ] Håll en bokstav, tryck "1" och en bokstav snabbt vid 15 hästar: rätt häst
- [ ] Offline: tagga, ladda om, tagga vidare, slå på nätet. Allt sparat, inget 422
- [ ] Offline: markera raden, ladda om, RAD syns, slå på nätet efter simulerad start. `markedLate` är false
- [ ] Tagga på telefon, byt till datorns flik: taggen syns utan att skrivas över
- [ ] Fönster öppet när resultatet kommer: ingen placering någonstans, skärmläsartexten utan namn (kontrollera `aria-live`-noden)
- [ ] Visa resultat, ladda om: visat. Annat lopp: dolt. Blockerad lagring: inget fel
- [ ] Ersätt raden, Ångra: gamla värden och gamla tid
- [ ] Ändrad arbetsrad efter inlämning: kopian oförändrad, en banderoll
- [ ] Befintliga taggar från före bygget syns i Live, Mina kommentarer och Efteranalys
- [ ] Tangentbord genom hela Live. Fokus synligt. Inga tangenter i listan. `prefers-reduced-motion`
- [ ] Sök i koden: `TagRace`, `openTagging`, "Tagga loppet" är borta. Inga `Avd` i nya texter
- [ ] `npm run typecheck`, `npm test`, `npm run check:migration`, `npm run build`

---

## 19. Öppna tekniska risker

| # | Risk | Hantering |
|---|---|---|
| R1 | **Hästkortets statistik kan avslöja indirekt.** "Hämta omgången igen" efter loppet skriver `horseStatsJson`, `earnings` och `record` från ATG (`fetch-round.ts` 279–281, 400). Vinster i år och intjänat kan då innefatta dagens lopp. Pollningen av resultat rör inte fälten | Skyddas inte. Knappen är ett eget val och sällsynt efter start. Går det emot Mikaels beslut krävs att fälten fryses vid start, vilket är en större ändring |
| R2 | Resultatet finns i klientens minne och `localStorage` | Accepterat, se 8.1 |
| R3 | Valet är per enhet. Ny enhet eller rensad lagring: allt dolt igen, också sett | Följer beslutet |
| R4 | Tidigare omgångar blir dolda vid driftsättning, också sedda | Fråga 1 nedan |
| R5 | 195 knappar kan ge märkbar ritning på svag dator | Memoisering per kolumn är krav. Mät med 15 hästar. Tänd tagg ska synas inom 100 ms |
| R6 | Klientens klocka avgör `markedLate` | Accepterat: Mikaels egen markering. Framtid över 5 min nekas |
| R7 | Sticky-delen i arket blir högre (E7:s krav vid 360 × 640) | Bara knappen är klistrad. Kontrolleras i provkörningen |
| R8 | Fritext-popovern kan klippas i `overflow`-behållare | Förankras uppåt från Fritext-raden, och `.hc` får inte ha `overflow: hidden` |
| R9 | ATG-filen är inte provad skarpt (E7 2). Markeringen säger inget om ATG tog emot den | Texterna lovar inget |
| R10 | Live i V75 från slutet av november, och sju lopp i lopprad och rutnät | V75-fixtur i test och provkörning |
| R11 | 8 parallella GET för taggar vid öppning | Bara startade lopp. Fel i ett lopp påverkar inte andra. Vid behov ett samlat anrop senare |
| R12 | Tagg som är ändrad på två enheter: senaste skrivning vinner, och en tagg kan försvinna | Accepterat. Omläsning när sidan syns minskar risken |
| R13 | `Start.place` har 0 för oplacerad och null för diskad, medan `result` saknas innan hämtning | `liveResultList` testas mot alla tre |

### Det här går emot eller tänjer på besluten

Inget beslut är ändrat. Två saker bör Mikael känna till:

1. **R1:** "avslöjar inget resultat" gäller inte fullt ut för årsstatistiken efter en manuell omhämtning.
2. **Efteranalys och Statistik** visar resultat utan att fråga, enligt mockupen. Specen lägger till varningstexter men spärrar inget (8.2 rad 20–21).

---

## 20. Öppna frågor och antaganden

**Frågor till Mikael.** Avgjort 2026-10-31: förvalen gäller, utom fråga 3 där texten blir "Ersätt raden".

1. **Tidigare omgångar:** vid driftsättningen blir också omgångar du redan sett dolda, med ett tryck per lopp. Förval: samma regel utan undantag. Alternativ: alla lopp i omgångar som var klara före driftsättningen räknas som visade.
2. **Efteranalys och Statistik:** räcker varningstexten, eller ska de spärras när lopp är dolda? Förval: varningstext.
3. **Texten på knappen:** avgjort. Det finns bara en rad, så texten är **Ersätt raden**, och specen är rättad.

**Antaganden**

- Bet går inte att ändra i Live, eftersom Mark är låst efter start.
- Klart i fasraden förblir text. Hörde till E4 och länkades aldrig.
- Raderna i resultatlistan går inte att klicka på. Hästkortet nås via Analys.
- `Ersätt` och `Ångra markeringen` kräver ingen bekräftelsedialog, eftersom Ångra finns i 10 s.
- Ingen automatisk påminnelse i Nästa steg om att markera raden.
- Ingen svepgest för att byta häst i Live. Föregående, Nästa och remsan räcker. S7:s gester gäller inte.
- `features.stats` förblir av.

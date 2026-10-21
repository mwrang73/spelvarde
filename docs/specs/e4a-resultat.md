# E4a – Resultat

Status: beslutad 2026-10-21. Typ: **Omfattande**. Ingen ny mockup. Utseendet följer skärm **7b Resultat** och **Omgången klar** i den godkända flödesmockupen `docs/mockups/spelvarde-flode-mockup.html` (funktionerna `scrRes` och `scrKlar`, klasserna `.rrow`, `.hit`, `.sumb` och `.plc`). Den ska vara i drift före V85 lördag 2026-10-24.

Den här filen kompletterar `spelvarde.md`. Varje avsnitt säger vilket avsnitt i huvudspecen det ändrar eller lägger till. Där de två säger olika gäller den här filen för E4a.

**Underlag i koden**
- `prisma/schema.prisma`: `Outcome`, `Race` (`resultAt`, `cancelled`), `Start` (`place`, `finishOrder`, `disqualified`, `galloped`, `resultAt`) och `Round` (`liveSyncAt`, `liveOkAt`, `finishedAt`)
- `lib/atg.ts` (`parseResult`, `hasResult`, `cancelled`)
- `lib/fetch-round.ts` (steg 1 sparar redan placering, `resultAt` och `finishedAt`)
- `lib/e2-server.ts` och `lib/marks.ts` (låsningen med 409)
- `lib/phase.ts` (`computePhase`, `isRoundFinished`, `nextStep`)
- `lib/features.ts`
- `components/round/RaceWorkspace.tsx` (S2), `RoundOverview.tsx` (S1) och `RoundProvider.tsx`
- `vercel.json`

**Vad som redan finns och inte ska byggas om**
- **Låsningen vid starttiden** finns. `saveMark` (`lib/e2-server.ts`) svarar 409 "Loppet har startat" för alla fält i `PUT /api/marks/[startId]`. Kupongen och Unibet-rutterna har samma låsning. Klienten visar redan låsta reglage (`RaceWorkspace`, `HorseCard`).
- **Placeringen sparas** i steg 1 (`fetchGame`): `Start.place`, `finishOrder`, `disqualified`, `galloped`, `kmTime`, `finalOdds`, `placeOddsMin/Max` och `resultAt`, `Race.resultAt`/`cancelled` och `Round.finishedAt` när alla lopp har resultat eller är inställda.
- **`StartDto.result`** (`lib/types.ts`) finns redan.
- **Saknas:** frysningen av `Outcome` (inga skrivningar finns), automatisk hämtning, cron-jobbet, resultatvyn och resultatet i S1.

---

## Var resultatvyn finns (beslut, ändrar 4 och S7)

**Resultatvyn är ett läge i avdelningsvyn S2**, `/omgang/[roundId]/avd/[nr]?vy=resultat`, inte en egen rutt.

Skäl:
- S7 och rutten `/lopp/[nr]` finns inte. Snabbkommentarerna, som är huvudinnehållet i S7, ligger utanför E4a.
- S2 har redan avdelningsflikarna 1–8, cachen och desktoplayouten med hästkortet till höger. Resultatet hör ihop med startlistan i samma lopp.
- Innehållet i 7b (summering, placeringar och Nästa) följer flödesmockupen. Det enda nya är segmentkontrollen.
- När S7 byggs i E4 kan samma komponent, `RaceResult`, flyttas dit eller användas på båda ställena.

Navigation:
- **Segmentkontrollen "Startlista | Resultat"** (`Segmented`, `aria-pressed`) står under loppremsan när loppet har startat eller är inställt. Före start visas den inte.
- **Standardvalet** är **Resultat** när loppet har startat, och annars Startlista. Valet syns i URL:en (`?vy=resultat` eller ingen parameter) och byts med `router.replace`, utan omladdning.
- Byter Mikael avdelning med flikarna står valet kvar om den nya avdelningen också har startat. Annars visas Startlista.
- **Vyrubriken** i resultatläget: titeln "Avd 7 · resultat" och underraden "Hämtat från ATG 17:19". I väntläget är underraden "Startade 17:13". I startlistan är den som i dag.
- **Desktop:** mittkolumnen visar resultatlistan i stället för tabellen. Ett klick på en häst visar hästkortet i högerkolumnen som i dag.
- **Tangentbord:** **R** växlar mellan Startlista och Resultat när segmentkontrollen visas (inte i textfält, ark eller dialoger).

---

## Resultatvyn (`RaceResult`, nytt avsnitt i 5, ersätter "Resultatläge (7b)" i S7 för E4a)

Uppifrån och ned, som `scrRes` i flödesmockupen.

### 1. Summeringen på tavlan (`.sumb`, `BoardPanel`)
Tre rutor:
- **Bet** "1 / 2" "träff"
- **Spelbar** "1 / 2" "topp 3"
- **Intressant** "3 / 4" "topp 3"

Regler:
- Värdena räknas från de frysta `Outcome` för avdelningen (6.4), inte från dagens `Mark`. En ändrad tolerans eller X-faktor efter start ändrar alltså inte summeringen.
- En grupp utan hästar visar "–" och texten "ingen".
- Saknar avdelningen markeringar visas summeringen inte. I stället står "Inga markeringar i avdelningen." (`.help`).
- Skärmläsaren läser "Bet: 1 av 2 träff. Spelbar: 1 av 2 topp 3. Intressant: 3 av 4 topp 3." (`role="group"`, `aria-label` "Summering avd 7").

### 2. Placering 1–4
Rubriken "PLACERING" (`.sl.tight`). En rad per häst med placering 1–4, sorterad på placeringen (`.rrow`, minst 52 px):

| Del | Innehåll |
|---|---|
| Placering | `FlapNumber` variant `placed` (bärnstensgul) med 1, 2, 3 eller 4 |
| Startnummer | `FlapNumber sm` |
| Namn | namnet, och under det kusken. Med galopp i loppet (`galloped`) läggs taggen "Galopp" till (röd, `tag bad`) |
| Märken | I, S, B och X enligt `Outcome` (frysta värden), via `MarkBadges` |
| Bet-utfall | Bet med placering 1–3: **"Träff ✓"** (`.hit.y`: bakgrund `--up`, text `--surface`, bock). Bet med placering 4: **"Miss ✗"** (`.hit.n`: `--down-soft`, ring och text `--down`) |

- **Dött lopp:** två hästar med samma placering står båda med den siffran, i startnummerordning.
- Ett tryck på raden öppnar hästkortet (mobil: S3, desktop: högerkolumnen).
- Skärmläsarens text för raden: "1:a, nummer 5, Kentucky River, Magnus A Djuse. Bet, träff."

### 3. "5 eller sämre"
Rubriken "5 ELLER SÄMRE".
- **Bet som missade** och inte står i listan ovan får en egen rad:
  - I placeringsrutan står "5+" (oplacerad eller placering 5 och sämre), eller "d" när hästen är diskvalificerad.
  - Under namnet står taggen "Galopp" när den gäller, och taggen **"Diskad"** när hästen är diskvalificerad.
  - Märkena I, S och B, och **"Miss ✗"**.
- **Övriga hästar** (inte Bet, inte strukna, inte i 1–4) står på en rad (`.rest`), i startnummerordning: "1 Laredo Boko · 2 Great Time Trot · 4 Harpy · …".
  - Intressant och Spelbar får märket efter namnet ("6 Boscha Diablo I").
  - Diskvalificerade får "(diskad)" efter namnet.
- **Strukna hästar visas inte** någonstans i resultatvyn.

### 4. Nästa
Kortet `.next` med etiketten "NÄSTA":

| Läge | Rubrik | Mening | Knapp (sekundär) |
|---|---|---|---|
| Nästa avdelning har inte startat | "Avd 8 startar 17:35" | Dina hästar där: "Blixt Lane är Bet. Django Silver är Intressant." Utan markeringar: loppnamnet | "Till avd 8" (S2, Startlista) |
| Nästa avdelning har startat | "Avd 8 · resultat" eller "Avd 8 pågår" | "Träff 1/1." eller "Väntar på resultat." | "Till avd 8" (S2, Resultat) |
| Sista avdelningen | "Omgången är klar" eller "Väntar på avd 6" | Summeringen för hela omgången, eller vilka avdelningar som saknar resultat | "Till omgången" (S1) |

### 5. Lägen

| Läge | När | Visning |
|---|---|---|
| **Väntar på resultat** | Loppet har startat, saknar resultat och det har gått högst 30 min | `EmptyState` med en klockikon på tavlan. Rubriken "Väntar på resultat …", meningen "Loppet startade 17:13. Placeringen hämtas automatiskt från ATG." och raden "Senast kollat 17:16 · nästa 17:17" (`.help`, `aria-live="polite"`). Ingen knapp. Summeringen visas inte |
| **Resultatet har inte kommit** | Mer än 30 min efter start och inget resultat | Rubriken "Resultatet har inte kommit än", meningen "ATG har inte publicerat placeringen. Den hämtas också i kväll." och sekundärknappen **Hämta resultat** |
| **Resultatet kunde inte hämtas** | 3 fel i rad i pollningen, eller fel vid Hämta resultat | Banderoll `err` (`role="alert"`) ovanför väntläget: "**Resultatet kunde inte hämtas.** ATG svarade inte. Försök igen om en stund." och sekundärknappen **Försök igen**. Senast hämtade läge visas kvar |
| **Loppet är inställt** | `Race.cancelled` | `EmptyState`: rubriken "Loppet är inställt", meningen "ATG har ställt in loppet. Det räknas inte i statistiken." Inga rader. Nästa visas |
| **Offline** | `useOnline()` är falskt | Banderoll `warn`: "Ingen uppkoppling. Resultatet hämtas när du är uppkopplad igen." Knapparna är avstängda |
| **Laddar** | Första ritningen utan cache | Skelett: tavelruta och 4 rader |
| **Resultat finns** | `Race.resultAt` | Avsnitt 1–4 |

- Kommer resultatet medan vyn är öppen ritas vyn om. `aria-live="polite"` läser då upp "Resultat i avd 7: Kentucky River vann. Bet 1 av 2 träff." en gång.
- Rörelse: placeringsrutorna får fällbladsfallet när de ritas första gången (DESIGN.md, Rörelse). Det stängs av vid `prefers-reduced-motion`.

---

## Omgången S1 under och efter loppen (ändrar S1)

### Avdelningsraderna (`.orow`)
| Läge | Rad 1 (`.on`) | Rad 2 (`.om`) | Till höger |
|---|---|---|---|
| Inte startat | som i dag | som i dag | räknarna I, S och B, som i dag |
| Startat, utan resultat | loppnamnet | "Startade 17:13 · väntar på resultat" | taggen "Pågår" |
| Resultat | "Vinnare 5 Kentucky River" | Bet: "Bet: 5 Kentucky River 1:a · 10 Barack Face miss". Utan Bet, men med I eller S: "Intressant 2/3 topp 3". Utan markeringar: "Inga markeringar" | Med Bet: `.hit.y` "Träff 1/2" om minst en träff, annars `.hit.n` "Miss 0/1". Utan Bet: räknarna I, S och B |
| Inställt | loppnamnet | "Inställt" | taggen "Inställt" |

- Raden är fortfarande en länk till S2, i läget Resultat när loppet har startat.
- `aria-label` på högerdelen: "Bet 1 av 2 träff".

### Summeringen på tavlan
När minst en avdelning har resultat står `.sumb` direkt under Nästa steg, med rubriken "HITTILLS" (en eller flera avdelningar kvar) eller "OMGÅNGEN" (alla klara). Rutorna är Bet, Spelbar och Intressant, räknade från de frysta `Outcome` i avdelningar med resultat. Inställda lopp räknas inte.

### Omgången klar
- Fasraden visar Klart (`computePhase` finns).
- Vyrubrikens underrad: "V85 · Jägersro · lör 24 okt · klar".
- Raden "Startlistan hämtad …" ersätts av "Resultat hämtade från ATG lör 19:02".
- Blocket "V85-raden: 6 rätt av 8" och knappen "Se statistik" från mockupen ingår **inte** i E4a (se Utanför).

### Nästa steg (ändrar 3.2 punkt 4 och 9)
- **4. Fas Live, nästa lopp som inte har startat:** "Avd 8 startar 17:35". Meningen är dina hästar i avdelningen ("Blixt Lane är Bet. Django Silver är Intressant.") eller loppnamnet. Knappen "Till avd 8" leder till S2 i stället för S7.
- **4b (nytt). Fas Live, alla lopp har startat, något saknar resultat:** "Väntar på resultat i avd 8", meningen "Placeringen hämtas automatiskt från ATG." och knappen "Till avd 8" (S2, Resultat). I dag har `LIVE_WAITING` ingen knapp.
- **9. Fas Klart:** utan Statistik (S9 är inte byggd) blir det rubriken "Omgången är klar", meningen "Bet 2/4 träff · Spelbar 3/6 topp 3 · Intressant 6/13 topp 3." och ingen knapp. Finns nästa V85 och den inte är hämtad gäller punkt 1 som i dag (Hämta omgång).

---

## Regler

### 6.4 Placering, träff och låsning (förtydligar 6.4)
- **Låsning:** oförändrad, och redan byggd. Kontrollera bara att alla skrivande rutter för en start svarar 409 efter starttiden: `PUT /api/marks/[startId]`, kupongen och Unibets rutter. Kommentarer är undantagna.
- **Frysning** (`freezeOutcomes(db, roundId, now)` i `lib/outcomes.ts`, ny):
  - Gäller för varje lopp med `startAt ≤ now` som inte är inställt, och varje `Mark` i loppet med `interesting || bet` (för alla användare) där starten inte är struken.
  - Skapar en `Outcome` om den saknas (`createMany` med `skipDuplicates` på `(userId, startId)`).
  - Värden: `interesting`, `spelbar` (räknat med 6.1 med användarens tolerans, X-faktor och riktlinje vid frysningen), `bet`, `unibetOdds`, `betOdds`, `riktodds` (aktivt riktodds), `xFactor`, `xFactorValue`, `riktoddsX`, `sourceSupport`, `sourceTotal` (påslagna källor) och `frozenAt = now`.
  - En häst med `override = ON` räknas som Spelbar. Spelbar kräver Intressant, så filtret `interesting || bet` räcker.
  - Funktionen är idempotent. Befintliga rader ändras aldrig, bortsett från resultatfälten.
  - Den anropas av `GET /api/rounds/[id]`, `POST /api/rounds/[id]/results` och cron-jobbet. Förenklingen i 10.4 gäller: värdena tas när den första läsningen efter start sker, och eftersom `Mark` är låst är de desamma som vid starttiden.
- **Resultat på `Outcome`** (`applyResults` i samma fil), för lopp med `Race.resultAt`:
  - `place = Start.place` och `disqualified = Start.disqualified`.
  - `hit = !disqualified && place ∈ {1, 2, 3}`.
  - `place = 0` (oplacerad) eller `null` ger `hit = false`.
  - Inställt lopp ger `hit = null`, och raden räknas inte i någon summering.
- **Struken efter frysningen** (ATG visar hästen som struken i resultatet): dess `Outcome` tas bort.
- **Ändrat resultat** (till exempel efter en protest): nästa hämtning skriver de nya värdena. `resultAt` står kvar från första gången, och `place` och `hit` uppdateras.
- **Summeringar** (`outcomeSummary`, en ren funktion): per grupp `{hits, total}`.
  - Bet = `bet`
  - Spelbar = `spelbar`
  - Intressant = `interesting`
  - Lopp utan resultat och inställda lopp räknas inte.
  - En häst kan ingå i flera grupper.
- **Omgången klar:** `Round.finishedAt` sätts när `isRoundFinished` gäller (finns i `lib/phase.ts`, och i steg 1). Den sätts också av den nya resultathämtningen.

### 6.10 Automatisk resultathämtning (nytt)
- **Bara ATG, aldrig inmatning.** Mikael skriver aldrig in resultat.
- **Pollning medan appen är öppen** (hooken `useResultPolling` i `RoundProvider`):
  - Aktiv när fasen är Live och det finns ett lopp som har passerat starttiden, saknar resultat, inte är inställt och startade för högst 30 min sedan.
  - Intervall 60 s. Ett anrop i taget.
  - Pausar när sidan inte syns (`visibilitychange`), och hämtar direkt när den syns igen.
  - Efter fel försöker den igen efter 5, 10 och 15 s. Efter 3 fel i rad blir läget "Resultatet kunde inte hämtas", och den nästa ordinarie 60-sekundersrundan försöker igen.
  - Annars ingen pollning. Ingen LIVE-snapshot av strecket och inga larm, de hör till E3.
- **Hämta resultat** (knapp, och Försök igen) gör samma anrop med `force: true`.
- **Claim mot ATG:** `Round.liveSyncAt` används som claim (som 9.2), så att ATG anropas högst var 50:e sekund oavsett antal flikar, och var 15:e sekund vid `force`. Den som inte får claimet svarar med senast sparade läge. `Round.liveOkAt` = senaste lyckade hämtning, som visas som "Senast kollat".
- **Hämtningen** (`syncResults` i `lib/fetch-round.ts`): läser `games/<atgGameId>` med befintlig tolkning (`lib/atg.ts`) och skriver bara:
  - resultatfälten på `Start` (som steg 1)
  - `Start.scratched` och `scratchedAt`
  - `Race.resultAt`, `cancelled` och `atgStatus`
  - `Round.atgStatus`, `finishedAt`, `liveOkAt` och `rev` (+1 när något ändrades).

  Den skriver **ingen** `RoundSnapshot` eller `StreckValue` och räknar inte om riktodds. Därefter körs `freezeOutcomes` och `applyResults`. Loggas i `FetchLog` med `step = "RESULTS"`.
- **När något ändrades** (`rev` ökade) läser klienten om hela omgången (`loadRound`), som i dag efter en hämtning.

---

## 10.4 Cron-jobbet `GET /api/cron/results` (ändrar 10.4)

- **Skyddat** av `CRON_SECRET` (`Authorization: Bearer`) som `app/api/cron/hist`. `maxDuration = 60`.
- **Gör:**
  1. Hittar omgångar med datum i dag eller i går (Europe/Stockholm) och `finishedAt = null`.
  2. Kör `syncResults` med tvingat claim.
  3. Kör `freezeOutcomes(now)` och `applyResults` för alla användare.
  4. Sätter `finishedAt` när alla lopp har resultat eller är inställda.
  5. Svarar `{ rounds: [{ roundId, legsWithResult, finished }] }`.

  Det är idempotent och kan köras om utan dubbletter.
- **Schema (beslut):** tre körningar på lördagen, som egna poster i `vercel.json` med en parameter, så att varje post körs högst en gång per dygn. Det fungerar också på Vercels Hobby-plan, som bara tillåter dagliga jobb och kan köra dem när som helst inom timmen.

  | Post | Schema (UTC) | Svensk tid (sommar / vinter) | Syfte |
  |---|---|---|---|
  | `/api/cron/results?slot=em` | `0 15 * * 6` | 17:00 / 16:00 | Frysning och resultat för de första avdelningarna, även om appen är stängd |
  | `/api/cron/results?slot=kvall` | `0 18 * * 6` | 20:00 / 19:00 | Resultaten samma kväll. V85 slutar vanligen 17:30–18:30 |
  | `/api/cron/results?slot=natt` | `30 22 * * 6` | 00:30 / 23:30 | Reserv: sena resultat och ändringar efter protest |

  - Den befintliga posten `/api/cron/hist` (`0 4 * * *`) står kvar.
  - Byggaren kontrollerar att Vercel godtar flera poster mot samma sökväg med olika `?slot=`. Gör den inte det får rutterna egna sökvägar (`/api/cron/results-em` och så vidare) mot samma funktion.
  - På Pro-planen kan eftermiddagsposten i stället vara `*/20 13-17 * * 6`, men det behövs inte för E4a.
- Baseline-jobbet i 10.4 (E3) ingår inte.

---

## 12. API-rutter (nya och ändrade)

| Rutt | Beskrivning |
|---|---|
| `POST /api/rounds/[id]/results` | Kroppen `{ force?: boolean }`. Claim, `syncResults`, frysning och resultat (6.10). Svarar `{ serverTime, rev, changed, syncedAt, nextSyncAt, races: [{ leg, resultAt, cancelled }] }`. Fel från ATG ger 502 `{ error: "ATG svarade inte." }`. Svarar 404 för okänd omgång och 401 utan inloggning. `maxDuration = 60` |
| `GET /api/cron/results` | Se 10.4 |
| `GET /api/rounds/[id]` (ändrad) | Kör `freezeOutcomes` innan svaret byggs, och lägger till fälten nedan |
| `GET /api/rounds/current` (ändrad) | `legs[]` får resultatfälten nedan, och `nextStep` följer det nya 3.2 |

**DTO-fält** (`lib/types.ts`)

| Typ | Nya fält |
|---|---|
| `StartDto` | `outcome: { interesting: boolean; spelbar: boolean; bet: boolean; xFactor: XFactor; hit: boolean \| null } \| null`. De frysta värdena, som resultatvyn använder för märken och träff |
| `RaceDto` | `summary: OutcomeSummary \| null` (null före resultat eller när loppet är inställt). `OutcomeSummary = { bet: {hits, total}, spelbar: {hits, total}, interesting: {hits, total} }` |
| `RoundResponse` | `results: { syncedAt: string \| null; nextSyncAt: string \| null; summary: OutcomeSummary \| null }`. `syncedAt` = `Round.liveOkAt` |
| `LegSummary` | `cancelled: boolean`, `winner: { number: number; name: string } \| null`, `betResults: { number: number; name: string; place: number \| null; disqualified: boolean }[]`, `summary: OutcomeSummary \| null` |
| `NextStepKind` | Ingen ny typ. `LIVE_NEXT_RACE` och `LIVE_WAITING` får länken `{ type: "link", href: ".../avd/n" }`, och `ROUND_DONE` får texten med summeringen |
| `Features` (`lib/features.ts`) | `results: true`. `raceView` och `stats` är kvar som `false` |

Skärmläsar- och visningstexterna byggs i klienten av fälten. Placeringen skrivs som "1:a", "2:a", "3:e" och "4:e" (`ordinal` i `HorseCard`).

---

## 8. Datamodell (förslag till backend)

**Ingen migrering krävs.** Alla fält finns:
- `Outcome` (alla frysta fält samt `place`, `disqualified` och `hit`)
- `Race.resultAt` och `cancelled`
- `Start.place`, `finishOrder`, `disqualified` och `galloped`
- `Round.liveSyncAt`, `liveOkAt` och `finishedAt`.

Förslag som backend får ändra:
- `Round.liveSyncAt` och `liveOkAt` används redan nu för resultathämtningen. När E3 bygger livepollningen delar den claimet, som 9.2 avser.
- Behövs snabbare summeringar kan ett index `Outcome(roundId, userId)` räcka. `@@index([userId, roundId])` finns redan.
- Vill backend logga varför ett resultat saknas kan `FetchLog.message` användas. Inget nytt fält behövs.

---

## 13. Rena funktioner med tester (lägg till)

- `lib/outcomes.ts`: `freezeValues(mark, start, settings)` med `spelbar` och `riktoddsX`, `hitOf(place, disqualified, cancelled)`, `outcomeSummary(outcomes)` och dött lopp i sorteringen.
- `lib/results-view.ts`: listan 1–4, "5 eller sämre" med Bet-raderna, raden med övriga, strukna bortfiltrerade och Nästa-kortet.
- `lib/phase.ts`: de nya texterna och länkarna i Nästa steg.
- `lib/fetch-round.ts` (`syncResults`): testas mot `test/fixtures/atg/game-V85_2026-10-17_16_5-results.json`, utan att `StreckValue` skrivs.

---

## 14. Acceptanskriterier E4a

- [ ] Efter starttiden svarar alla skrivande rutter för starten 409 "Loppet har startat". Det finns redan och ska verifieras med test.
- [ ] Första läsningen efter starttiden (`GET /api/rounds/[id]`, `POST /results` eller cron) skapar exakt en `Outcome` per användare och start med Intressant eller Bet, inte för strukna hästar. Spelbar, X-faktor, riktoddset med X, odds och källstöd sparas med värdena vid frysningen. En ny körning ger inga dubbletter.
- [ ] Med appen öppen på lördagen hämtas resultatet automatiskt var 60:e sekund efter starttiden, i högst 30 min. Pollningen pausar när sidan inte syns. Flera flikar ger högst ett ATG-anrop per 50 s. Inga streck-snapshots skrivs.
- [ ] Cron-jobbet hämtar resultat och fryser `Outcome` även när appen är stängd, i de tre körningarna i 10.4, och sätter `finishedAt` när alla lopp har resultat eller är inställda.
- [ ] `hit` är sant för placering 1–3 utan diskning och falskt för 4, 5+, 0 och diskad. Inställda lopp får `hit = null` och räknas inte.
- [ ] S2 visar segmentkontrollen "Startlista | Resultat" när loppet har startat. Resultat är förvalt, och valet syns i URL:en.
- [ ] Resultatvyn visar summeringen på tavlan, placering 1–4 med märken och "Träff ✓", Bet som missade med "Miss ✗", "Diskad", raden med övriga och Nästa. Strukna hästar syns inte. Mot fixturen 2026-10-17 stämmer placeringarna med ATG.
- [ ] Lägena "Väntar på resultat …", "Resultatet har inte kommit än" med Hämta resultat, "Resultatet kunde inte hämtas" med Försök igen, "Loppet är inställt" och Offline visas med texterna i specen.
- [ ] S1 visar per avdelning vinnaren och dina Bet ("Träff 1/2" eller "Miss 0/1"), "Pågår" och "Inställt", och summeringen "Hittills" eller "Omgången".
- [ ] Nästa steg följer det nya 3.2: "Avd n startar hh:mm" med länk till S2, "Väntar på resultat i avd n" med länk, och "Omgången är klar" med summeringen.
- [ ] Ett resultat som ändras efter protest slår igenom vid nästa hämtning.
- [ ] Tillgänglighet: summeringen och raderna har skärmläsartexterna i specen, "Träff" och "Miss" bärs av text och ikon och inte bara av färg, ett nytt resultat läses upp en gång, och fällbladsfallet stängs av vid reducerad rörelse.
- [ ] Förhandsvisning i 390 och 1280 px, ljust och mörkt: S2 Resultat (resultat, väntar, inställt) och S1 under och efter loppen.
- [ ] vitest täcker funktionerna i 13.

---

## 15. Utanför E4a (senare)

- Snabbkommentarerna och kommentarsarket i S7, och rutten `/omgang/[roundId]/lopp/[nr]`. "Dina noteringar" i resultatraderna kommer med S7.
- S5 Lördag live: strecket var 5:e minut, LIVE-snapshot, utgångsläget på fredagen (cron-jobbet `baseline`) och larm (E3).
- Sidan Statistik (S9), knappen "Se statistik" och Tidigare omgångar i S1.
- V85-raden mot rätt rad ("6 rätt av 8").
- Push-notiser när ett resultat kommer.

---

## 16. Beslut

1. Resultatet hämtas bara automatiskt från ATG, med pollning när appen är öppen och cron som reserv. Mikaels beslut.
2. Resultatvyn är ett läge i S2 med segmentkontrollen "Startlista | Resultat", inte en egen rutt. Skälet står överst. Claudes beslut, och Mikael kan ändra det.
3. Summeringar och märken i resultatet läses från de frysta `Outcome`, så att senare ändringar av inställningarna inte skriver om utfallet.
4. Pollningen gäller bara de första 30 minuterna efter start. Därefter finns knappen Hämta resultat och cron-körningarna.
5. Cron körs tre gånger på lördagen (17, 20 och 00:30 sommartid) som dagliga poster, vilket fungerar på Hobby-planen. Claudes beslut.
6. Resultathämtningen skriver ingen streck-snapshot och delar claimet `Round.liveSyncAt` med den framtida livepollningen.
7. En häst med placering 4 som har Bet står i listan 1–4 med "Miss ✗". "5 eller sämre" visar Bet-hästar som missade utanför topp 4.
8. Ingen migrering i E4a.

## 17. Öppna frågor

Inga som stoppar bygget. Byggaren kontrollerar att Vercel godtar flera cron-poster mot samma sökväg (10.4) och väljer annars egna sökvägar.

---

## 18. Tillägg: Trollspöt i uppföljningen (beslut 2026-10-21)

Mikael vill veta hur bra Trollspöt är över tid. Därför fryses Trollspöt vid loppets start, på samma sätt som markeringarna. Statistikvyn byggs senare (med mockup), men datan måste sparas från och med lördagens V85.

**Frysning (ändrar 6.4 och 8)**
- Vid frysningen av ett lopp räknas Trollspöt som det såg ut **precis före loppets starttid**: `trollspot(races, startTime − 1 ms, tolerans)` med omgångens data. Hästarna från just det loppet som fanns i listan får `trollspotRank` (1–10).
  - Listan fylls på när lopp startar. Per lopp är den därför bara entydig om den räknas vid det loppets egen starttid.
- `Outcome` skrivs för varje start där **I, S, B gäller eller hästen var i Trollspöt**.
- Nya fält på `Outcome` (förslag, migrering behövs):
  - `trollspotRank Int?`
  - `trollspotMinOdds Decimal?(6,2)`, alltså "minst X" vid start
  - `trollspotEstOdds Decimal?(6,2)`, alltså det uppskattade platsoddset.
- `unibetOdds` på `Outcome` sparas för alla frysta starter. `Mark.unibetOdds` finns för alla hästar efter en hämtning (E2.2). Det gör att ROI "spela alla Trollspöts hästar till Unibets odds" kan räknas senare.
- Saknas data för Trollspöt (inget streck eller ingen modell) blir `trollspotRank` null. Det är aldrig ett fel.

**Resultatvyn (ändrar avsnittet Resultatvyn)**
- Summeringen får en rad till: "Trollspöt 2/3 topp 3". Den visas bara om loppet hade Trollspöt-hästar.
- Hästar i placeringslistan och i "5 eller sämre" som var i Trollspöt får Trollspöt-märket (samma ikon som fliken Trollspöt, med `aria-label` "Trollspöt").
- S1:s summering för omgången får också "Trollspöt n/m topp 3".

**Unibets odds S4 och Spelförslag S6 (ändrar e2.2, gruppen "Inte markerade men spelbara odds")**
- Gruppen döps om till **"Inte markerade (n)"** och innehåller hästar som inte är Intressant, inte har Bet, inte är strukna och vars lopp inte har startat, och som **antingen** är i Trollspöt **eller** har spelbara odds (över eller nära).
- Trollspöt-hästarna står först, sorterade efter Trollspöt-plats och med Trollspöt-märket. Därefter kommer övriga efter skillnad, största först. En häst står bara en gång.
- Hjälptext: "Hästar du inte har markerat som är med i Trollspöt eller har spelbara odds. Tänd Intressant så kommer de med."
- En Trollspöt-häst utan odds visar fältet tomt, och under det står "minst 2,40" (Trollspöts minst X).
- Länkarna "Visa n omarkerade" och ankaret `#omarkerade` fungerar som förut.

**Acceptanskriterier (lägg till i 14)**
- [ ] Vid frysningen sparas `trollspotRank` för hästar som var i Trollspöt vid loppets start, även om de inte var markerade. Det är testat med en omgång där listan fylls på efter att ett tidigare lopp startat.
- [ ] Resultatvyn och S1 visar "Trollspöt n/m topp 3" och märket.
- [ ] Gruppen "Inte markerade (n)" i S4 och S6 visar Trollspöt-hästar först, utan dubbletter.

**Utanför:** statistikvyn för Trollspöt över tid (träff %, ROI till Unibets odds, per omgång och totalt). Den kommer senare med mockup.

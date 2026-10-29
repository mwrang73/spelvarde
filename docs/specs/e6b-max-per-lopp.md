# E6b – Max hästar per lopp och prioriterat lopp

Status: godkänd 2026-10-29 efter mockupen `docs/mockups/v85-maxtak-mockup.html`, **alternativ A · Stegare + prioriterat lopp**. Typ: **Omfattande** (ny kolumn i databasen).

Den här filen kompletterar `docs/specs/e6-v85-rad.md` (kallas **E6** nedan). Varje avsnitt säger vad i E6 det ändrar. Där de två säger olika gäller den här filen. Allt gäller alla spelformer (V85, V75, V86, GS75) via `Round.gameType`.

**Mikaels beslut 2026-10-29**
1. Alternativ A. Raden "Allgardering" (Auto | Välj avd) i kortet Regler för raden ersätts av två rader: **Max hästar per lopp** (stegare, byggd som Spikar) och **Prioriterat lopp** (Auto | Välj avd).
2. Inget lopp får fler än N hästar. N är ett **tak**, inte ett krav: appen får ta färre om budgeten gör mer nytta i andra lopp.
3. Prioriterat lopp: **Auto** (mest öppna loppet, samma val som dagens auto-allgardering) eller **valt** av Mikael. Det loppet får gå upp till N om budgeten räcker.
4. Lägsta N är **3**, standard **7**, högsta = största fältet i omgången, som visas som **"Alla"** och betyder inget tak (= dagens allgardering). Ingen separat Alla-knapp.
5. Är N minst lika stort som antalet startande i ett lopp tas alla med ("Alla 11").
6. Egna val (pennan i avdelningskortet) går före taket och blockeras inte, som med favoritspärren. Hjälptexten visar "Över taket".
7. Rader som sparades med allgardering visas oförändrade efter spelstopp ("Avd 5 allgarderades.").
8. Taket gäller även när appen går ifrån mallen för att hålla budgeten.
9. En avdelning med appens spik kan väljas som prioriterat lopp, och spiken flyttar då, som i dag.

**Underlag i koden**
- `lib/tippa.ts`: `buildRad`, `decide`, `chooseAllg`, `minimumPicks`, `openHiOf`, `OPEN_SHARE_MAX`, `targetRows`, `targetParts`, `openOptions`, `allgOptions`, `ALLG_DROP_MAX`, `OPEN_RELAXED_MIN`, `BUDGET_OVER_MAX`, `BUDGET_UNDER_MAX`, `legRolesOf`, `TippaRules`, `TippaResult`
- `lib/tippa-text.ts`: `spikHelp`, `allgHelp`, `legTypeLabel`, `legWhy`, `legWhyStarted`, `desktopSummary`, `rulesDontFitText`, `previewChangeText`, `spikPreviewTexts`, `templateDeviationText`
- `lib/coupon.ts` (`couponText`, `CouponInput`, `parseCouponBody`, `asLegRoles`, `ROLE_KINDS`, `ALLG_MODE_ERROR`), `lib/coupon-ui.ts` (`couponBody`), `lib/types.ts` (`CouponDto`, `AllgMode`, `LegRoleKind`), `lib/dto.ts` (`couponDto`), `lib/round-overlay.ts` (`CouponBody`, `couponDtoOf`), `lib/e2-server.ts` (`saveCoupon`), `app/api/rounds/[id]/coupon/route.ts`
- `prisma/schema.prisma` (`Coupon`, `enum AllgMode`), `prisma/migrations/20261028120000_e6_v85_rad/migration.sql` (mönstret för CHECK)
- `components/spel/RadRules.tsx`, `RadSheets.tsx` (`RadAllgSheet`, `RadSpikSheet`, `RadAtgSheet`, `withLock`), `RadLegCard.tsx`, `RadPanel.tsx` (`RadDraft`, `draftOf`, `lockLeg`, `legacyBody`, `bodyOf`, `Budget`, kupongen, frysta regler)
- `styles/app.css` (`.stp`, `.rl`, `.lr.allg`, `.budget .allfit`, `.rs.wrn`), `docs/DESIGN.md` (`Stepper`, `Sheet`)

---

## 1. Mål och användare

Mikael gör V85-raden inom en budget. I dag tar allgarderingen alla hästar i det mest öppna loppet, och då får fyra andra lopp bara 2 hästar. Med ett tak får det mest öppna loppet fortfarande flest hästar, men aldrig fler än N, och resten av budgeten går till de andra loppen. Nästa steg efter vyn är oförändrat: Kopiera till ATG.

## 2. Användarflöde (ändrar steg 4e i E6 "Användarflöde")

1. Mikael öppnar Spelförslag › V85-rad. Raden räknas med taket (standard 7 för en ny rad) och det prioriterade loppet (Auto).
   - 1a. Kupongen sparades före E6b: taket är **Alla**, det prioriterade loppet är det sparade `allgMode`/`allgLeg`, och raden blir exakt som förut (avsnitt 4.5).
   - 1b. Spelstopp har passerat: den sparade raden visas låst. En rad med allgardering visar "Avd 5 allgarderades." (avsnitt 5.7).
2. Han trycker **−** eller **+** i Max hästar per lopp. Raden räknas om direkt och sparas efter 600 ms (som Spikar).
   - 2a. Vid 3 är − avstängd. Hjälptexten säger varför.
   - 2b. Ett steg över största fältet − 1 visar **Alla**, och + stängs av. Det prioriterade loppet får då alla sina hästar.
   - 2c. Har ett eget val fler hästar än taket visas taggen "Över taket". Inget blockeras.
3. Han väljer prioriterat lopp:
   - 3a. **Auto**: appen väljer det mest öppna loppet.
   - 3b. **Välj avd** öppnar arket **Välj lopp att prioritera**. Han väljer en avdelning › **Prioritera avd 3**. Segmentet byter först när valet är gjort. **Avbryt**, Esc eller × lämnar allt oförändrat.
   - 3c. Väljer han en avdelning där appen har en spik flyttar spiken till nästa lopp i spikordningen.
   - 3d. Blir den valda avdelningen låst (eget val, egen spik) eller inställd väljer appen ett annat lopp och säger det i hjälptexten.
4. Ryms inte taket i det prioriterade loppet i budgeten får loppet färre (högst 2 färre), och kortet säger "Taket är 7, men budgeten räcker till 6 här."
5. Ryms inte reglerna alls: som i dag (E6 6.5.10), med texten om det prioriterade loppet.
6. Han trycker Kopiera till ATG. Det prioriterade loppet skrivs som nummer ("Avd 5: 1, 3, 4, 6, 9, 11, 12"), eller som "alla (1–13)" när alla hästar är med.

Felvägar: som i E6 (offline, sparfel, 409 för startad avdelning). Servern avvisar ett tak utanför 3–30 med 400 (avsnitt 4.3).

## 3. Mockups

`docs/mockups/v85-maxtak-mockup.html`, alternativ A: mobil A1 (Regler, Auto), A2 (arket), A3 (avdelningskortet), A4 (efter spelstopp), desktop AD, och de gemensamma avsnitten "Avdelningskortet för prioriterat lopp" och "Lägen i raden". B och C byggs inte.

**Avvikelser från mockupen (beslutade här)**
- Exemplets siffror i mockupens jämförelseruta "I dag" (624 rader) var ritade. Med dagens algoritm blir samma omgång 832 rader (avsnitt 4.2, exempel 1). Rutan finns inte i appen.
- Mockupens hjälptext "Inget lopp kan prioriteras: alla är spikar, dina egna val eller inställda." blir utan "spikar": det prioriterade loppet väljs före spikarna, så en spik hindrar aldrig ett val.
- Typtaggen använder befintliga `.lr.allg` (samma utseende som mockupens `.lr.prio`). Ingen ny klass.
- Handlingsraden heter fortsatt **Kopiera till ATG** (mockupen visade "Spela hos ATG").

---

## 4. Regler och data (supabase-backend)

### 4.1 Begrepp (ändrar E6 "Begrepp")

| Begrepp | Betydelse |
|---|---|
| **Tak**, N | Högsta antal hästar som appen ger ett lopp. `maxPerLeg`, 3–30 eller `null` = **Alla** (inget tak). |
| **Prioriterat lopp**, P | Loppet som får gå upp till taket. Ersätter allgarderingen. Väljs av appen (**Auto**) eller av Mikael (**Välj avd**). Lagras i de befintliga fälten `allgMode`/`allgLeg`. |
| **Målet** för P | `mål = min(N, n)`, där n = antal löpande i P. N = Alla ger `mål = n`. |
| **Allgardering** | Finns kvar som **utfall**: P har alla sina löpande hästar. Då är typen `ALLG`, och kopieringen skriver "alla (1–13)". Annars är typen `PRIO`. |
| **Största fältet**, F | Högsta antalet löpande i en avdelning som inte är inställd. Stegarens översta läge (Alla) motsvarar F. |
| **Öppen avdelning** | Som i E6, utom att P inte är öppen. |

### 4.2 Algoritmen (ändrar E6 6.5.4, 6.5.7, 6.5.8 och avsnittet "Budgeten som mål" i `lib/tippa.ts`)

**Indata.** `TippaRules` får fältet `maxPerLeg: number | null`. Övriga fält oförändrade. `allgMode`/`allgLeg` betyder nu prioriterat lopp.

**Konstanter** (i `lib/coupon.ts`, så att servern och `lib/tippa.ts` delar dem):
- `MAX_PER_LEG_MIN = 3`, `MAX_PER_LEG_DB_MAX = 30` (som högsta startnumret i `parseSelections`), `DEFAULT_MAX_PER_LEG = 7`.
- I `lib/tippa.ts`: `ALLG_DROP_MAX` byter namn till **`PRIO_DROP_MAX = 2`**. `OPEN_SHARE_MAX`, `OPEN_RELAXED_MIN`, `BUDGET_OVER_MAX` och `BUDGET_UNDER_MAX` är oförändrade.

**Steg 1 – Välj P** (`chooseAllg` byter namn till `choosePrio`, logiken är oförändrad):
- CHOSEN och `allgLeg` är FRI: den avdelningen.
- CHOSEN men avdelningen är låst, inställd eller saknas: som Auto, och `prioFallback` = `LOCKED`, `CANCELLED` eller `MISSING`.
- Auto: bland FRIA avdelningar den med lägst favoritstreck (preliminär: lägst favoritandel). Vid lika: flest med v ≥ 5, flest löpande, lägst avdelningsnummer.
- Ingen FRI avdelning: inget P (`prioLeg = null`).
- P väljs **före spikarna** och är aldrig spikkandidat. Väljer Mikael en avdelning där appen har spik flyttar spiken därför till nästa kandidat i spikordningen (E6 6.5.5).

**Steg 2 – Favoritspärren** (E6 6.5.6, oförändrad i sak): P räknas som en tvingad favorit (`F0` och kvoten `Q`), precis som allgarderingen. Därför är **favoriten alltid med i P** (steg 3).

**Steg 3 – P:s alternativ och hästordning**
- `mål = min(N, n)` (N = Alla: `mål = n`).
- Alternativen `k` för P: från `max(lo(P), mål − PRIO_DROP_MAX)` till `mål`. `lo(P)` = minsta valet enligt mallen (oftast 3, med 1–3 löpande = n). Varje häst under målet kostar **1 avvikelse** (`pen = mål − k`), precis som `allgOptions` i dag.
- **Taket täcker hela fältet** (`mål = n`): dagens regel oförändrad. Alla löpande, och tappar budgeten hästar går de lägst rankade först (rangordningen, E6 6.5.2 punkt 9). Det gör att N = Alla ger exakt dagens rad.
- **Taket är mindre än fältet** (`mål < n`): P fylls enligt mallen, med favoriten först:
  1. **Favoriten** (som Topp 3, ersätter E6 6.5.7 steg 1).
  2. **Mellan**, 3. **Skräll**, 4–5. ersättarna `LOW` och `NOMEL`, som i E6 6.5.7.
  6. Fortsättningen: övriga löpande i värdeordningen (`valueScore`, samma som för öppna lopp).
  - `k` hästar = de första k i den ordningen. `minimumPicks` får en flagga `forceFav` för steg 1.
- Typen blir `ALLG` när P:s val innehåller alla löpande, annars `PRIO`.

**Steg 4 – Öppna avdelningar**: som i dag, men det högsta antalet kapas av taket:
- `hi(L) = min(N, openHiOf(lo, |A(L)|, n))`, och aldrig under `lo(L)`. (N ≥ 3 ≥ lo, så det kan inte krocka.) N = Alla: som i dag.
- Avvikelsen "ett öppet lopp går ned till 2" (`OPEN_RELAXED_MIN`) är oförändrad.

**Steg 5 – Budgeten** (`targetRows`, oförändrad): ett alternativ per öppet lopp och ett för P. Inom bandet 90–105 % av budgeten vinner minst avvikelse, sedan flest hästar, sedan högst värde, sedan närmast budgeten, sedan billigast. Når ingen kombination bandet: den största under 105 %. Eftersom alla alternativ är ≤ N kan **ingen avvikelse från mallen ge fler än N hästar** (beslut 8).
- `minRows` (för "Reglerna ryms inte", förslagen och `defaultSpikCount`) räknas med P:s minsta alternativ, `max(lo(P), mål − 2)`.

**Steg 6 – Låsta avdelningar**: oförändrade. Ett eget val med fler än N hästar behålls och listas i `overCapLegs` (beslut 6).

**Steg 7 – Inställda, utan startande, strukna**: som i E6 6.5.3. En inställd eller tom avdelning kan inte bli P. Strukna hästar räknas inte i n.

**Nya och ändrade fält i `TippaResult`**

| Fält | Betydelse |
|---|---|
| `maxPerLeg` | Taket som gällde (`null` = Alla). |
| `fieldMax` | F, högsta antalet löpande i en avdelning som inte är inställd. 0 utan löpande. |
| `prioLeg` | P, eller `null`. Ersätter `allgLeg` i sin gamla betydelse. |
| `prioAuto`, `prioFallback`, `prioRequested` | Ersätter `allgAuto`, `allgFallback`, `allgRequested` (samma innehåll). |
| `prioTarget` | Målet `min(N, n)`. 0 utan P. |
| `prioCount` | Antal hästar P fick. |
| `prioShort` | `prioTarget − prioCount` (0–2). Ersätter `allgDropped`. |
| `allgLeg` | **Ny betydelse:** P när typen är `ALLG` (alla löpande med), annars `null`. Styr kopieringstexten, kupongens "Alla" och ATG-texten. |
| `overCapLegs` | Låsta avdelningar (`OWN`) med fler hästar än N, stigande. Tom vid Alla. |
| `capLimited` | true när taket kapar något: P har `mål < n`, eller en öppen avdelning har `hi` kapad av N. |

`TippaLegResult` för P: `kind` `PRIO` eller `ALLG`, `lo` = minsta alternativet, `hi` = målet, `horses` i hästordningen ovan med skälen (`reasonsOf`, inklusive `LOW`/`NOMEL`), `favBanned` alltid false.

`allFit` räknas som i dag (alla alternativ på sitt högsta ryms). Med `capLimited` säger texten att taket begränsar (avsnitt 6).

**Exempel** (testfall 1–5 i avsnitt 7 bygger på dem)

*Exempel 1 – mockupens omgång.* V85, budget 400 kr, radpris 0,50 (bandet 720–840 rader), 2 spikar (avd 2 och 6). P = avd 5 med 13 löpande. Fem öppna lopp med 12, 15, 12, 14 och 12 löpande (`lo` 3, `hi` 6–7).
- **Tak 7:** P får alternativen 5–7. Utan avvikelse blir raden 7 × 3⁵ = 1 701 rader, för mycket. Minsta avvikelse som når bandet är 2: P = 7 och två öppna lopp med 2. Raden: 7 · 3 · 3 · 3 · 2 · 2 = **756 rader · 378,00 kr**, 22 hästar. Avd 5 får typen `PRIO` och "7 av 13". (Det här är mockupens rad.)
- **Alla:** P får alternativen 11–13. Minsta avvikelse i bandet är 4: P = 13, ett öppet lopp med 4 och fyra med 2. Raden: 13 · 4 · 2 · 2 · 2 · 2 = **832 rader · 416,00 kr**. Avd 5 får typen `ALLG`, "Alla 13". (Det här är dagens rad.)
- **Tak 3:** P har bara alternativet 3, och de öppna loppen har `hi` 3. Raden: 3⁶ = **729 rader · 364,50 kr**. `allFit` och `capLimited` är true.
- **Tak 13 eller 14:** samma rad som Alla.

*Exempel 2 – budgeten räcker inte till taket.* V85, budget 50 kr, radpris 0,50 (bandet 90–105 rader), 5 spikar, P med 13 löpande, två öppna lopp med 8 löpande (`lo` 3, `hi` 4), `favLimit` 8 i testet.
- **Tak 7:** utan avvikelse ger 7 · 3 · 3 = 63 eller 7 · 3 · 4 = 84 för lite och 7 · 4 · 4 = 112 för mycket. Med en avvikelse ryms P = 6: 6 · 4 · 4 = **96 rader · 48,00 kr**. `prioShort` 1, kortet "6 av 13" och "Taket är 7, men budgeten räcker till 6 här."
- **Alla:** P = 13 och ett öppet lopp med 2: 13 · 2 · 4 = **104 rader · 52,00 kr**.

*Exempel 3 – N är större än fältet.* Tak 12, P med 11 löpande: `mål` = 11 = n, typen `ALLG`, "Alla 11", och hjälptexten "Taket 12 är fler än de startande."

*Exempel 4 – P i en spikavdelning.* Väljer Mikael avd 2 (appens säkraste spik) som P blir avd 2 inte spikkandidat. Spikarna blir de två första av de övriga kandidaterna i spikordningen, och `previewChangeText` säger "Spiken flyttar från avd 2 till avd 8."

*Exempel 5 – eget val över taket.* Låst avd 3 med 9 hästar och tak 7: avd 3 har kvar sina 9, `overCapLegs` = [3], och resten räknas som vanligt.

### 4.3 Datamodell (ändrar E6 8.5)

**Rekommendation: ett nytt fält, och återanvänd `allgMode`/`allgLeg` för prioriterat lopp.**
- Det ger minst risk: en additiv kolumn, ingen omskrivning av data, inget nytt enum och inga namnbyten (som migreringskontrollen inte tillåter).
- Det prioriterade loppet väljs exakt som allgarderingen, så de sparade värdena betyder samma sak. Bara namnen i koden ändras.

```prisma
model Coupon {
  // … befintliga fält oförändrade …
  // CHOSEN: Mikaels prioriterade lopp. AUTO: det lopp appen valde vid senaste sparningen.
  // (Hette allgardering före E6b; samma fält.)
  allgMode         AllgMode?
  allgLeg          Int?
  // E6b: Max hästar per lopp, 3–30. null = Alla (inget tak), också för kuponger sparade före E6b.
  maxPerLeg        Int?
}
```

**Migreringen** `prisma/migrations/20261029120000_e6b_max_per_leg/migration.sql`:
```sql
ALTER TABLE "spelvarde"."Coupon" ADD COLUMN "maxPerLeg" INTEGER;
ALTER TABLE "spelvarde"."Coupon" ADD CONSTRAINT "Coupon_maxPerLeg_check" CHECK ("maxPerLeg" IS NULL OR "maxPerLeg" BETWEEN 3 AND 30);
```
- Additiv: ingen `DROP`, `UPDATE` eller `RENAME`, och varje sats nämner `spelvarde`. `npm run check:migration` ska vara grön. RLS finns redan på `Coupon`.
- Körs mot drift först efter Mikaels ja, via `bash scripts/prod-db.sh deploy`.
- `enum AllgMode` och `Coupon_allgLeg_check` är oförändrade. Kommentaren på enumet ändras till "Prioriterat lopp: Auto eller valt (hette allgardering före E6b)".

**`legRoles`** (version 1, additivt): `k` får värdet **`PRIO`**, med `h` (valda hästar och koder) som `OPEN`. `ALLG` betyder fortsatt alla hästar, med `fav`. Ingen ny version: gamla rader är giltiga som de är.

### 4.4 API (ändrar E6 12)

**`PUT /api/rounds/[id]/coupon`**: kroppen får ett frivilligt fält.

| Fält | Typ | Regel | Saknas |
|---|---|---|---|
| `maxPerLeg` | heltal 3–30 eller `null` | `null` = Alla. Ingen kontroll mot omgången: ett tak över största fältet fungerar som Alla | behåll sparat |

- `CouponInput` och `COUPON_KEYS` i `lib/coupon.ts` får `maxPerLeg`. `parseCouponBody` avvisar decimaltal, strängar och värden utanför 3–30 med **"Max hästar per lopp ska vara 3–30 eller Alla."** (400).
- `saveCoupon` skriver fältet bara när det finns i kroppen (som övriga E6-fält).
- Felsvaren för det prioriterade loppet får nya texter (logiken är oförändrad):
  - `ALLG_MODE_ERROR`: "Prioriterat lopp ska vara Auto eller en vald avdelning."
  - "Välj vilket lopp som ska prioriteras." (i dag "Välj vilken avdelning som ska allgarderas.")
  - "Det prioriterade loppet kan inte vara en låst avdelning." (i dag "Allgarderingen kan inte ligga i en låst avdelning.")
- `asLegRoles` och `ROLE_KINDS` godtar `PRIO`.
- `readJson(req, 16_000)` räcker. Route-filens kommentar får `maxPerLeg?`.

**`GET` (kupongen, omgången, current)**: `CouponDto` i `lib/types.ts` får `maxPerLeg?: number | null`, `couponDto` i `lib/dto.ts` tar med det, och `LegRoleKind` får `"PRIO"`. Äldre cachade svar saknar fältet: läs med `?? null` (= Alla). `CouponBody` och `couponDtoOf` i `lib/round-overlay.ts` tar med fältet och faller tillbaka på `data.coupon`. `couponBody` i `lib/coupon-ui.ts` får `maxPerLeg` bland E6-fälten.

### 4.5 Sparade kuponger (ändrar E6 6.5.14)

| Kupong | Tak i appen | Prioriterat lopp | Resultat |
|---|---|---|---|
| Ingen `Coupon` | `DEFAULT_MAX_PER_LEG` (7) | Auto | Ny rad. Sparas vid första ändringen eller Kopiera. |
| E6-kupong (`spikCount` satt, `maxPerLeg` null), före spelstopp | **Alla** | sparat `allgMode`/`allgLeg` | **Exakt samma rad som före E6b.** Ingen omsparning (raden skiljer sig inte från den sparade). Stegaren visar "Alla". |
| Gammal rad före E6 (`spikCount` null) | 7 när den räknas om | Auto | Som i E6: visas som den är. **Räkna om med reglerna** eller en regeländring sätter också `maxPerLeg = 7`. Ångra sparar tillbaka med `maxPerLeg: null`. |
| Efter spelstopp | det sparade värdet (null = Alla), avstängt | ur `legRoles` | Visas som den sparades. `ALLG` ger "Avd 5 allgarderades." |

Att `null` betyder Alla gör att en sparad kupong aldrig byter rad av den här ändringen, eftersom N = Alla ger dagens regel för P (avsnitt 4.2 steg 3). Det enda som ändras för en sådan rad är att ett P som tappat hästar (mindre än alla) nu visas som `PRIO` med nummer i stället för som allgardering (avsnitt 5.6).

---

## 5. Gränssnittet (frontend-dev)

### 5.1 Klientens tillstånd (ändrar E6 9.3)
- `RadDraft` får `maxPerLeg: number | null`. `draftOf`: ingen kupong ger 7. Gammal rad (före E6) ger 7. Övriga: `c.maxPerLeg ?? null`.
- `change()` för en gammal rad sätter också `maxPerLeg = DEFAULT_MAX_PER_LEG`. `legacyBody` skickar `maxPerLeg: null`.
- `rules` (till `buildRad`) får `maxPerLeg`. `bodyOf` skickar alltid `maxPerLeg: d.maxPerLeg`.
- `lockLeg` och `withLock` (låses det valda prioriterade loppet blir det Auto) är oförändrade i sak. Kommentarerna byter "allgarderingen" mot "det prioriterade loppet".
- `SheetState` `{ kind: "allg" }` byter namn till `{ kind: "prio" }`. `RadAllgSheet` byter namn till `RadPrioSheet`.
- `FrozenRules` får `maxPerLeg: number | null` och `prio: { leg: number; kind: "ALLG" | "PRIO" } | null` (ur `legRoles`).
- Stegaren ändrar inte Ångra-toasten. Den sparas som Spikar, utan toast.

### 5.2 Kortet Regler för raden (`RadRules`, ändrar E6 S6b rad 3)
Raderna i ordning: **Spikar**, **Egna spikar**, **Max hästar per lopp**, **Prioriterat lopp**, **Favoritspärren**. Efter spelstopp: Spikar, Max hästar per lopp och Prioriterat lopp, avstängda.

**Max hästar per lopp** (`.rl`)
- Etikett `.flbl` "Max hästar per lopp" med id. `Stepper` (`.stp`, knappar 40 × 44, `role="group"`, `aria-labelledby` etiketten). Byggs exakt som Spikar.
- Värdet `output`: talet N, eller **"Alla"** när `maxPerLeg` är null eller ≥ `fieldMax`. "Alla" får klassen `.word` (Barlow Condensed 14 px, versaler, `min-width: 40px`). Ingen `aria-live`.
- **−** (`aria-label` "En häst färre per lopp"): från Alla till `max(3, fieldMax − 1)`, annars N − 1. Avstängd vid 3, eller när `fieldMax ≤ 3`.
- **+** (`aria-label` "En häst till per lopp"): N + 1. Blir värdet ≥ `fieldMax` sparas `null` (Alla). Avstängd vid Alla.
- Hjälptext `.help` (helt fält under). Se avsnitt 6.1.

**Prioriterat lopp** (`.rl`)
- Etikett "Prioriterat lopp" med id. `.seg` (`role="group"`, `aria-labelledby`) med **Auto** och **Välj avd** (`aria-pressed`, `aria-haspopup="dialog"` på Välj avd). Beteendet är dagens Allgardering:
  - Auto sätter `allgMode = AUTO`, `allgLeg = null` direkt.
  - Välj avd öppnar arket. Segmentet byter först när valet är gjort.
  - Vald: länken `.linkish` **Byt avdelning** efter hjälptexten (`aria-haspopup="dialog"`).
- Hjälptext: se avsnitt 6.2.

**Spikar**: bara texterna i `spikHelp` ändras (avsnitt 6.4).

**Lägen**: avstängda kontroller efter spelstopp, med rubrikens `<span>` "Låst vid spelstopp" (som i dag). Raden räknas inte i läget "Raden kan inte räknas än": stegaren fungerar ändå och sparas.

### 5.3 Arket Välj lopp att prioritera (`RadPrioSheet`, ersätter E6 "Ark: Välj avdelning att allgardera")
`Sheet` med titeln **"Välj lopp att prioritera"** och underraden (avsnitt 6.3). Desktop: dialog 520 px (som i dag).
- `ul.hchips` med `role="radiogroup"` och `aria-label` "Avdelningar". En `button.hchip.hc2` per avdelning med `role="radio"` och `aria-checked`, ↑/↓ (och ←/→) flyttar valet, rullande tabbstopp (som i dag).
- Varje rad: `FlapNumber sm`, `hc-name` "Avd 5 · 18:00", taggen `.rs.st` **"Mest öppna"** på Auto-valet, underraden `.help` och till höger `.hc-st`:
  - Värdet = vad P skulle få om avdelningen väljs (`buildRad` med CHOSEN): "7 av 13", eller "Alla 11" när alla löpande kommer med. Under det `small` "756 rader".
  - Ryms inte: `.rs.lim` "Ryms inte" i stället för värdet.
- Underraden: "13 startande · fav 16,4 % · 9 med minst 5 %". Appens spik nu: "Spik nu · fav 58,1 %". Låst: "Ditt val, låst" (avstängd). Inställd: "Inställt lopp" (avstängd). Utan startande: "Inga startande" (avstängd).
- Förval: nuvarande P.
- Knappar (`.shbtns`): primär **"Prioritera avd 5"** (utan val: "Prioritera", avstängd), ghost **Avbryt**. Valet sätter `allgMode = CHOSEN`, `allgLeg`, stänger arket och räknar om. Ingen toast (som i dag).
- Fokus: vald rad när arket öppnas, Välj avd (eller Byt avdelning) när det stängs.

### 5.4 Avdelningskortet för P (`RadLegCard`, ändrar E6 "Avdelningskortet")

| Läge | Typtagg (`.lr.allg`) | Innehåll | Varför-raden |
|---|---|---|---|
| `PRIO`, taket nått | "7 av 13" | hästraderna (`ul.lhl`) med skälen | avsnitt 6.5 |
| `PRIO`, budgeten räcker inte till målet | "6 av 13" | hästraderna | avsnitt 6.5 |
| `ALLG` (alla löpande) | "Alla 13" | nummerrutorna `.allgn` (som i dag) | avsnitt 6.5 |
| Efter spelstopp, `PRIO` | `.lr` "Startat" | hästraderna med sparade skäl ur `legRoles` | "Prioriterat lopp vid spelstopp: **7 av 13**, tak 7." |
| Efter spelstopp, `ALLG` | `.lr` "Startat" | nummerrutorna | "Allgardering vid spelstopp." (som i dag) |

- Före typtaggen en `.sr`-text "Prioriterat lopp, " så att taggen läses "Prioriterat lopp, 7 av 13".
- Nummerrutorna `.allgn` visas **bara** för `ALLG` (i dag även när allgarderingen hade tappat hästar, vilket visade fel rutor).
- Pennan fungerar som för andra lopp. Ett eget val i P låser avdelningen, och P blir Auto (som i dag).

### 5.5 Desktop (≥ 1024 px)
Samma rader i vänsterkolumnen (`aside`). `desktopSummary` (avsnitt 6.6). Arket är dialog. Inga andra skillnader mot E6.

### 5.6 Kopiera, kupongbilden och Spela hos ATG (ändrar E6 6.5.13 och A6)
- `couponText` skriver "Avd 5: alla (1–13)" **bara** när `opts.allgLeg` är avdelningen **och** valet innehåller alla ej strukna startnummer i `numbersByLeg`. Annars skrivs numren. Skyddet ligger i `couponText`, så att en gammal rad där allgarderingen tappade hästar också kopieras rätt.
- `RadPanel` skickar `allgLeg = result.allgLeg` (bara `ALLG`). Efter spelstopp: avdelningen med `k: "ALLG"` i `legRoles`, som i dag.
- Kupongbildens kolumnrubrik: `ALLG` "Alla", `PRIO` "7 st" (som ett öppet lopp).
- `RadAtgSheet`: meningen "Avd 5 är allgarderad. Hos ATG trycker du på **Alla** i avd 5." visas bara för `ALLG`. Texten är oförändrad.

### 5.7 Efter spelstopp (ändrar E6 6.5.12)
- Max hästar per lopp: avstängd stegare med det sparade värdet ("7", eller "Alla" för `null`), ingen hjälptext.
- Prioriterat lopp: avstängt segment (Auto eller Välj avd tryckt efter sparat `allgMode`), hjälptexten i avsnitt 6.2 "Efter spelstopp".
- Korten enligt tabellen i 5.4.

### 5.8 Budgetrutan
`Budget` får `capLimited` och `maxPerLeg`. Raden `.allfit` visar texten i avsnitt 6.7. Inget annat ändras.

---

## 6. Texter

Fetstil markeras med `**…**` (`boldParts`). Procent som `pctText` ("16,4 %"), med hårt mellanslag i gränssnittet som i dag. N, n och k är tal.

### 6.1 Max hästar per lopp (`capHelp(r)`, ny)

| Läge | Text |
|---|---|
| N satt | "Inget lopp får fler än **7 hästar**. Appen tar färre där budgeten gör mer nytta i andra lopp." |
| N = 3 | "Inget lopp får fler än **3 hästar**. Lägre går inte: varje öppet lopp behöver topp 3, mellan och skräll." |
| Alla, P har alla | "Inget tak. Avd 5 får **alla 13**, som en allgardering." |
| Alla, P saknas eller har färre | "Inget tak. Det prioriterade loppet får alla sina hästar om budgeten räcker." |
| Tillägg: ett eget val över taket | taggen `.rs.wrn.rs-inline` "Över taket" och sedan "Ditt eget val i avd 3 har 9. Ditt val går först, och inget blockeras." |
| Tillägg: flera | "Över taket" och "Dina egna val i avd 3 och 7 har fler än 7. Ditt val går först, och inget blockeras." |

`.rs-inline` (ny klass): `display: inline-flex; vertical-align: 1px; margin-right: 4px` (från mockupen). Taggen står först i tillägget, efter grundtexten och ett mellanslag.

### 6.2 Prioriterat lopp (`prioHelp(r)`, ersätter `allgHelp`)
"{vem}" = "mest öppna loppet" (Auto) eller "ditt val" (CHOSEN). Preliminär rad: "mest öppna loppet enligt modellen" och favoritens andel med "enligt modellen".

| Läge | Text |
|---|---|
| `PRIO`, k = målet | "Avd 5 får **7 av 13**, {vem}. Favoriten har **16,4 %**." |
| `PRIO`, k < målet, N satt | "Avd 5 får **6 av 13**, {vem}. Budgeten räcker inte till 7 där." |
| `PRIO`, k < n, Alla eller N ≥ n | "Avd 5 får **11 av 13**, {vem}. Budgeten räcker inte till alla 13 där." |
| `ALLG`, Alla | "Avd 5 får **alla 13**, {vem}. Favoriten har **16,4 %**." |
| `ALLG`, N satt och N ≥ n | "Avd 6 får **alla 11**, {vem}. Taket 12 är fler än de startande." |
| Reglerna ryms inte | "Avd 5, {vem}. Favoriten har **16,4 %**." |
| Vald avd låst | "Din valda avd 3 är ditt eget val och låst, så appen prioriterar avd 5. Avd 5 får **7 av 13**." |
| Vald avd inställd | "Din valda avd 3 är inställd, så appen prioriterar avd 5. Avd 5 får **7 av 13**." |
| Vald avd saknas | "Din valda avd 9 kan inte prioriteras, så appen prioriterar avd 5. Avd 5 får **7 av 13**." |
| (reservfallen med `ALLG`) | "… Avd 5 får **alla 13**." |
| Inget P | "Inget lopp kan prioriteras: alla är dina egna val eller inställda." |
| Efter spelstopp, `PRIO` | "Avd 5 fick **7 av 13** hästar (Auto)." / "… (ditt val)." |
| Efter spelstopp, `ALLG` | "Avd 5 allgarderades." (som i dag) |
| Efter spelstopp, inget | "Inget lopp prioriterades." |

Vid "ditt val" följer länken **Byt avdelning**, som i dag. Saknar favoriten streck (preliminär) används modellens andel.

### 6.3 Arket
- Titel: "Välj lopp att prioritera".
- Underrad, N satt: "Loppet får upp till 7 hästar, om budgeten räcker. Inget lopp får fler än 7."
- Underrad, Alla: "Loppet får alla sina hästar, om budgeten räcker. Appen räknar om resten."
- Radernas texter och knapparna: avsnitt 5.3.

### 6.4 Spikar (`spikHelp`)
- 0 spikar: "Inga spikar. Alla lopp får minst 3 hästar." (i dag "… utom allgarderingen …")
- `spikMax` lägre än taket: " Högst 5 spikar nu: övriga lopp är dina egna val, det prioriterade loppet, inställda eller saknar riktodds."
- Övriga oförändrade.

### 6.5 Avdelningskortet för P (`legWhy`, `legTypeLabel`, `legWhyStarted`)
`legTypeLabel`: `PRIO` "{k} av {n}", `ALLG` "Alla {n}" (som i dag).

`legWhy` för P. "{fav}" = "favoriten **6 Staro Diamant** har **16,4 %**" (preliminär: "… enligt modellen").

| Läge | Text |
|---|---|
| `PRIO`, k = målet, Auto | "Prioriterat, mest öppna loppet: {fav}, lägst av omgångens favoriter. Taket 7 är nått. Ej med: 2, 5, 7, 8, 10 och 13." |
| `PRIO`, k = målet, valt | "Prioriterat, ditt val: {fav}. Taket 7 är nått. Ej med: 2, 5, 7, 8, 10 och 13." |
| `PRIO`, k < målet, N satt | "Prioriterat, mest öppna loppet. **Taket är 7, men budgeten räcker till 6 här.** Höj budgeten för att få med fler." (valt: "Prioriterat, ditt val. …") |
| `PRIO`, k < n, Alla eller N ≥ n | "Prioriterat, mest öppna loppet. **Budgeten räcker till 11 av 13 här.** Höj budgeten för att få med alla." (valt: "Prioriterat, ditt val. …") |
| `ALLG`, Alla, Auto | "Prioriterat, mest öppna loppet: {fav}, lägst av omgångens favoriter. Inget tak, så alla 13 är med. Hos ATG trycker du på **Alla**." |
| `ALLG`, Alla, valt | "Prioriterat, ditt val: {fav}. Inget tak, så alla 13 är med. Hos ATG trycker du på **Alla**." |
| `ALLG`, N ≥ n | "Prioriterat, {mest öppna loppet / ditt val}: {fav}. Taket 12 är fler än de startande, så alla 11 är med. Hos ATG trycker du på **Alla**." |

- "Ej med": ej valda **löpande** hästars startnummer, stigande, `joinSv`. Strukna räknas inte.
- `legWhyStarted(kind, opts?: { count: number; field: number; cap: number | null })`: `PRIO` ger "Prioriterat lopp vid spelstopp: **7 av 13**, tak 7." (Alla: "…: **11 av 13**, inget tak."). `ALLG` "Allgardering vid spelstopp." (oförändrad). `count` = antal valda, `field` = löpande i avdelningen, `cap` = sparat `maxPerLeg`.

### 6.6 Andra texter som berörs

| Funktion | Ny text |
|---|---|
| `desktopSummary` | "22 hästar · spikar i avd 2 och 6 · avd 5 prioriterad, 7 av 13 · favoriten bortvald i avd 1 och 7". `ALLG`: "… · avd 5 prioriterad, alla 13 · …". (I dag "allgardering i avd 5".) |
| `rulesDontFitText` | "{spikar}, prioriterat lopp avd 5 (minst 5 hästar){, ditt eget val …} och minst 3 hästar i de 4 andra loppen ger minst …". (I dag "allgardering av avd 5 (12 hästar)".) |
| `previewChangeText` | "Det prioriterade loppet flyttar till avd 3." (i dag "Allgarderingen flyttar …"). P jämförs som ett öppet lopp: "Avd 5 går från 7 till 6 hästar (3 Tangen Kraft tas bort) för att raden ska komma nära **300 kr**." |
| `spikPreviewTexts` | "Avd 5 är prioriterat lopp nu. Prioriteringen flyttar till avd 3, näst mest öppna loppet." / "Avd 5 är prioriterat lopp nu. Inget annat lopp kan prioriteras." / "Avd 5 är ditt prioriterade lopp. Väljer du spik här blir prioriterat lopp Auto." |
| `templateDeviationText` | P med `prioShort > 0`: "Avd 5 har 6 av 13 hästar (taket är 7)". Alla eller N ≥ n: "Avd 5 har 11 av 13 hästar" (som i dag). Ingången "För att komma nära din budget avviker raden från mallen." och delen om 2 hästar är oförändrade. Läser `prioShort`, `prioTarget`, `prioLeg` och `maxPerLeg` i stället för `allgDropped`/`allgLeg`. |
| `RadAtgSheet` | oförändrad text, bara för `ALLG` (5.6). |
| `couponText` | `PRIO`: "Avd 5: 1, 3, 4, 6, 9, 11, 12". `ALLG`: "Avd 5: alla (1–13)" (med strukna "… utom 7"). |
| Kommentarer i `RadRules.tsx`, `RadSheets.tsx` | "Allgardering" byts mot "Max hästar per lopp och Prioriterat lopp". |

### 6.7 Budgetrutan (`.allfit`)
- `allFit` och `capLimited`: "Budgeten räcker till fler hästar än taket på 7 tillåter."
- `allFit` utan `capLimited`: "Budgeten räcker till alla hästar i de öppna loppen." (som i dag)

### 6.8 Felsvar från API:t
"Max hästar per lopp ska vara 3–30 eller Alla.", "Prioriterat lopp ska vara Auto eller en vald avdelning.", "Välj vilket lopp som ska prioriteras.", "Det prioriterade loppet kan inte vara en låst avdelning." (visas i utkorgens fel-toast som i dag).

---

## 7. Tillgänglighet (WCAG 2.2 AA, kompletterar E6)

- **Stegaren:** `role="group"` med `aria-labelledby` på "Max hästar per lopp". Knapparna har `aria-label` "En häst färre per lopp" / "En häst till per lopp", tryckytan 40 × 44 (som `Stepper` i DESIGN.md). Avstängd knapp är `disabled`. Värdet "Alla" är ett ord, inte en symbol.
- **Live-regionen** (E6) läser upp summan efter ändringen. Stegarens `output` har ingen `aria-live`, så att inget läses två gånger.
- **Fokusordning:** … Spikar − och + › varje × för egen spik › Välj egen spik › **Max − och +** › **Auto, Välj avd (Byt avdelning)** › Favoritspärren saknar fokusbara delar › strykningsbanderollerna › pennorna › Kopiera till ATG.
- **Arket:** fångar Tab, Esc stänger utan ändring, fokus tillbaka till knappen som öppnade det. `radiogroup` med ↑/↓, ←/→ och rullande tabbstopp. Avstängda rader är `disabled` och hoppas över av piltangenterna.
- **Typtaggen** får `.sr` "Prioriterat lopp, " före texten. Nummerrutorna har sin `aria-label` som i dag.
- **Färg bär aldrig ensam:** "Över taket" är en ordtagg. "Ryms inte" är en ordtagg.
- **Kontrast:** `.rs.wrn` och `.lr.allg` finns redan och är mätta i E6. `.stp output.word` använder `--ink` på `--surface`.
- **Rörelse:** inga nya animationer.

---

## 8. Tester

### `lib/tippa.test.ts` (supabase-backend)
Hjälpfunktionen för reglerna får `maxPerLeg: null`, så att **alla befintliga testfall är oförändrade** (Bjerke 576 rader osv.).

1. **Exempel 1, tak 7:** syntetisk omgång enligt 4.2 (avd 2 och 6 med spikhäst riktX 1,20 och 1,30; avd 5 med 13 löpande och lägst favoritstreck 16,4; avd 1, 3, 4, 7, 8 med 12, 15, 12, 14, 12 löpande och både Mellan och Skräll; övriga riktX ≥ 1,80). Budget 400, radpris 0,50, `spikCount` 2. Förväntat: `prioLeg` 5, typ `PRIO`, `prioCount` 7, `prioShort` 0, de öppna loppens antal sorterade `[2, 2, 3, 3, 3]`, rader 756, kostnad 378, 22 hästar, favoriten i avd 5:s val.
2. **Exempel 1, Alla:** samma omgång med `maxPerLeg: null`: typ `ALLG`, 13 hästar, öppna `[2, 2, 2, 2, 4]`, rader 832, `allgLeg` 5.
3. **Exempel 1, tak 3:** alla lopp 3, rader 729, `allFit` och `capLimited` true. **Tak 13 och 14:** samma `selections` som Alla.
4. **Exempel 2:** tak 7 ger P 6 av 13 (`prioShort` 1), öppna `[4, 4]`, 96 rader. Alla ger P 13, öppna `[2, 4]`, 104 rader. (`favLimit` 8.)
5. **Exempel 4:** CHOSEN avd 2 (appens spik): avd 2 typ `PRIO` eller `ALLG`, inte i `spikLegs`, och `spikLegs` innehåller nästa kandidat.
6. **Exempel 5:** låst avd 3 med 9 hästar, tak 7: avd 3 oförändrad, `overCapLegs` `[3]`.
7. **Hästordningen i P** (`mål < n`): favoriten först även när den inte är bäst rangad, sedan Mellan, Skräll och värdeordningen. Skälen har `FAV`, och `LOW`/`NOMEL` när ersättarna används.
8. **Reserv:** CHOSEN i låst avdelning ger Auto och `prioFallback` "LOCKED". Inställd ger "CANCELLED".
9. **`minRows` och förslagen** med tak 7 räknas med P = 5 (`mål − 2`). `defaultSpikCount` räknas med taket.
10. **`fieldMax`** = högsta antalet löpande utom inställda lopp, och strukna räknas inte.
11. **Inget lopp utom låsta har fler än N** när N är satt, även när raden går ifrån mallen (`relaxedLegs`).

### `lib/tippa.property.test.ts` (supabase-backend)
- **Regression mot dagens rad:** innan algoritmen ändras läggs ett test till som räknar de 1 000 omgångarna med dagens kod och sparar `{ status, rows, selections }` per omgång som vitest-snapshot. Efter ändringen ska samma omgångar med `maxPerLeg: null` ge exakt samma snapshot.
- Generatorn får `maxPerLeg` slumpat ur `null, 3–10` (hälften `null`).
- Nya egenskaper: (a) med N satt har varje avdelning av typ `OPEN`, `SPIK`, `PRIO` högst N hästar, och `ALLG` förekommer bara när N ≥ n; (b) P innehåller alltid favoriten; (c) `prioCount` ligger i `[max(lo, mål − 2), mål]`; (d) P är aldrig låst, inställd eller spik.
- Egenskap 9 (uttömmande sökning): P:s intervall blir `[max(lo, mål − PRIO_DROP_MAX), mål]` med avvikelse `mål − v`, och öppna lopp `hi = min(N, …)`.
- `ALLG_DROP_MAX` byts mot `PRIO_DROP_MAX` i importen. Prestandatestet körs med `maxPerLeg: null` och 7 och ska klara samma tider.

### `lib/tippa-text.test.ts` (frontend-dev)
Alla texter i avsnitt 6.1–6.7 med fixturerna ovan, i V85 och V75: `capHelp` (satt, 3, Alla, ett och flera över taket), `prioHelp` (alla rader i tabellen), `legTypeLabel` ("7 av 13", "Alla 13"), `legWhy` för P (alla rader, inklusive "Ej med"), `legWhyStarted` (`PRIO` med och utan tak, `ALLG`), `spikHelp` (0 spikar, `spikMax`), `desktopSummary`, `rulesDontFitText`, `previewChangeText` (P flyttar, P tappar en häst), `spikPreviewTexts`, `templateDeviationText` (tak och Alla), `.allfit`-texten.

### `lib/coupon.test.ts` (supabase-backend)
- `parseCouponBody`: `maxPerLeg` 3, 7, 30 och `null` godtas; 2, 31, 7,5 och "7" ger "Max hästar per lopp ska vara 3–30 eller Alla."; saknat fält ger `undefined`.
- `asLegRoles` godtar `k: "PRIO"` med `h`.
- `couponText`: `allgLeg` 5 med alla löpande ger "Avd 5: alla (1–13)"; `allgLeg` 5 där valet saknar två löpande ger numren; utan `allgLeg` ger numren.
- De nya felsvarstexterna för prioriterat lopp.

### `lib/e2.db.test.ts` (testdatabasen, supabase-backend)
- PUT med `maxPerLeg: 7` sparas och läses tillbaka. `null` sparas som null. En kropp utan fältet lämnar det sparade orört.
- En kupong som skapades före migreringen (fältet saknas) läses med `maxPerLeg: null`.
- `CHECK`: en direkt `UPDATE … SET "maxPerLeg" = 2` (och 31) mot testdatabasen avvisas av `Coupon_maxPerLeg_check`.
- `legRoles` med `PRIO` sparas, och för en startad avdelning skrivs den inte över (som i dag).
- CHOSEN med låst `allgLeg` ger 400 med den nya texten.

### Övriga
- `lib/round-overlay.test.ts`: `couponDtoOf` tar med `maxPerLeg` och faller tillbaka på cachen.
- `lib/coupon-ui.test.ts`: `couponBody` tar med `maxPerLeg`.
- `lib/migration-check.test.ts`: den nya migreringen godkänns utan ändringar i kontrollen.

---

## 9. Arbetsfördelning (i den här ordningen)

**1. supabase-backend**
1. Regressionssnapshoten (avsnitt 8) mot dagens kod, committad **innan** något annat ändras.
2. `prisma/schema.prisma` (`maxPerLeg`, kommentarerna) och migreringen `20261029120000_e6b_max_per_leg`. `npm run check:migration`. Kör mot testdatabasen. **Inte mot drift** förrän Mikael har sagt ja.
3. `lib/coupon.ts`: konstanterna, `CouponInput`, `COUPON_KEYS`, `parseCouponBody`, `ROLE_KINDS`, `asLegRoles`, `couponText` (skyddet för "alla"), felsvaren. `lib/types.ts` (`CouponDto.maxPerLeg`, `LegRoleKind` med `PRIO`), `lib/dto.ts`, `lib/round-overlay.ts`, `lib/coupon-ui.ts` (`couponBody`), `lib/e2-server.ts` (`saveCoupon`), route-kommentaren.
4. `lib/tippa.ts`: `TippaRules.maxPerLeg`, `choosePrio`, P:s alternativ och hästordning (`minimumPicks` med `forceFav`), `hi` med taket, `PRIO_DROP_MAX`, de nya fälten i `TippaResult`, `legRolesOf` med `PRIO`, uppdaterad toppkommentar. Fältnamnen `allg*` som byter namn (avsnitt 4.2) byts i hela `lib/`.
5. Testerna i avsnitt 8 som är märkta supabase-backend. `npm test`, typkontroll och build gröna. Rapportera antalet DP-tillstånd med tak 7 i kommentaren.

**2. frontend-dev** (efter att 1 är klart och grönt)
1. `lib/tippa-text.ts`: `capHelp`, `prioHelp` (ersätter `allgHelp`) och alla ändrade texter i avsnitt 6, med testerna.
2. `components/spel/RadRules.tsx` (två nya rader, frysta lägen), `RadSheets.tsx` (`RadPrioSheet`, ATG-texten bara för `ALLG`), `RadLegCard.tsx` (taggen, `.sr`, nummerrutorna bara för `ALLG`, varför-raden, startat-läget), `RadPanel.tsx` (`RadDraft`, `draftOf`, `change`, `legacyBody`, `bodyOf`, `FrozenRules`, kupongens rubrik, `Budget`-texten, sheet-kind `prio`).
3. `styles/app.css`: `.stp output.word` och `.rs-inline` (värden ur mockupen). Inga andra nya klasser.
4. `docs/DESIGN.md`: V85-raden har Max hästar per lopp och Prioriterat lopp i stället för Allgardering. `docs/specs/e6-v85-rad.md`: en rad överst som pekar hit.
5. Skärmbilder med skillen för förhandsvisning, 390 px och 1280 px, ljust och mörkt: Regler med tak 7 och Auto, tak 3, tak Alla, eget val över taket, valt lopp med Byt avdelning, reservläget (låst), arket öppet, kortet i lägena 7 av 13, 6 av 13, Alla 13, och efter spelstopp för en ny rad (`PRIO`) och en gammal rad (`ALLG`, "Avd 5 allgarderades.").

## 10. Acceptanskriterier

- [ ] Kortet Regler för raden har Max hästar per lopp (3 … Alla, standard 7) och Prioriterat lopp (Auto | Välj avd), och ingen rad Allgardering.
- [ ] Med tak N har inget lopp som appen fyller fler än N hästar, även när raden går ifrån mallen. Egna val behålls och visar "Över taket".
- [ ] Det prioriterade loppet får upp till N (alla om N ≥ n), högst 2 färre när budgeten inte räcker, och alltid favoriten.
- [ ] Exempel 1 ger 756 rader med tak 7 och 832 med Alla.
- [ ] Kuponger sparade före E6b ger exakt samma rad som förut (regressionssnapshoten är grön), och visar "Alla".
- [ ] Efter spelstopp visar gamla rader "Avd 5 allgarderades." och nya "Avd 5 fick 7 av 13 hästar (Auto).".
- [ ] Kopieringen skriver "alla (1–13)" bara när alla löpande är med.
- [ ] Migreringen är additiv, `npm run check:migration` är grön, och CHECK-villkoret avvisar 2 och 31.
- [ ] Alla tester i avsnitt 8 är gröna, och skärmbilderna i 9.2.5 är granskade.

## 11. Utanför E6b

- Ett förslag "Sänk taket" i banderollen "Reglerna ryms inte". Förslagen är fortfarande Höj budgeten och Fler spikar.
- Fördelningsremsan från alternativ C. Den kan läggas till senare utan att något annat ändras.
- Fler än ett prioriterat lopp.

## 12. Beslut (Claudes, Mikael kan ändra)

1. **Återanvänd `allgMode`/`allgLeg`** för prioriterat lopp och lägg bara till `maxPerLeg`. Minst risk och ingen omskrivning av data.
2. **`null` = Alla**, också för kuponger sparade före E6b. Så ändras ingen sparad rad, och ingen datamigrering behövs. Bara nya rader får standardvärdet 7.
3. **`PRIO_DROP_MAX = 2`** ersätter `ALLG_DROP_MAX`: P får högst 2 färre än målet, och varje häst under målet räknas som en avvikelse. Så prioriteras P före de andra loppen, men budgeten kan ta en häst där om den gör mer nytta i ett annat lopp, och Alla blir exakt dagens regel.
4. **Favoriten är alltid med i P**, som i allgarderingen. Spärrens räkning blir då oförändrad.
5. **När taket täcker hela fältet tappas de lägst rankade** (dagens regel). Annars fylls P enligt mallen och värdeordningen, som de öppna loppen. Två regler, men det är det som gör att sparade rader inte ändras.
6. **"Alla" i kopieringen och kupongen bara när alla löpande är med.** Det rättar samtidigt ett fel i dag, där en allgardering som tappat hästar ändå kopierades som "alla".
7. **Ingen kontroll av taket mot omgången på servern.** Ett tak över största fältet fungerar som Alla, så det finns inget ogiltigt värde i 3–30.
8. **Ingen ny version av `legRoles`.** `PRIO` läggs till som ett nytt värde för `k`.

## 13. Öppna frågor och risker

**Öppna frågor:** inga. Allt är beslutat enligt Mikaels svar ovan.

**Risker**
1. **En gammal webbläsarflik med förra versionen** läser `legRoles` med `PRIO` som ogiltigt (`asLegRoles` ger null) och visar då inga skäl efter spelstopp. Det gäller bara tills fliken laddas om, och inget sparat skrivs över.
2. **Avvikelsen räknas per lopp, inte per häst** för öppna lopp. Med lågt tak och låg budget kan appen ge ett lopp 5 och fyra lopp 2 i stället för en jämnare rad (dagens regel, oförändrad). Taket gör det ovanligare men tar inte bort det.
3. **Stegarens steg ovanför fältet i P** ger samma rad (t.ex. tak 13 och 14 när P har 13). Hjälptexten "Taket 12 är fler än de startande" förklarar det.

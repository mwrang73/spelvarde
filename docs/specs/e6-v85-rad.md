# E6 – Tippa V85 (V85-raden)

> **E6b (2026-10-29):** Allgarderingen är ersatt av Max hästar per lopp och Prioriterat lopp. Se `docs/specs/e6b-max-per-lopp.md`, som gäller där de två säger olika.

Status: godkänd 2026-10-28 efter mockupen `docs/mockups/v85-rad-mockup.html` (https://claude.ai/artifact/EFfCheA9vhPcBr31U8oL6E), **alternativ A · Inställningar överst och lista per avdelning**, med kupongbilden från B i arket **Spela hos ATG**. Typ: **Omfattande**.

Den här filen kompletterar `spelvarde.md`. Varje avsnitt säger vilket avsnitt i huvudspecen det ändrar eller lägger till. Där de två säger olika gäller den här filen. **S6b och 6.5 i huvudspecen ersätts helt.** "Föreslå inom budget", `suggestCoupon`, `suggestionOrder`, `stepLeg` och stegaren per avdelning tas bort.

Allt gäller både **V85** (8 avdelningar, spärr 4) och **V75** (7 avdelningar, spärr 3), och även V86 och GS75, via `Round.gameType`. Där texten säger "V85" eller "8" byts det mot spelformen och dess antal avdelningar.

**Mikaels beslut 2026-10-28**
1. Alternativ A, med kupongbilden från B i arket Spela hos ATG.
2. **Topp 3** = streckplats 1–3. Delad plats räknas för alla som delar den. **Mellan** = alla som inte är topp 3 och har minst 5 % streck. **Skräll** = under 5 %.
3. Ryms reglerna inte i budgeten föreslås ingen ny rad. Appen visar vad som behövs och erbjuder lösningar ("Höj till 162 kr", "5 spikar · minst 54,00 kr" m.fl.). Reglerna släpps aldrig i tysthet.
4. "Så bred som möjligt" = **flest hästar**. Vid lika avgör rangpoängen.
5. **Säker spik** = lägst riktodds med X i loppet. Lopp väljs i ordningen lägst sådant riktodds.
6. **Felstreckad** = modellens andel av fältet (ur 1/riktodds med X, normerat) är minst 1,5 × strecket och minst 3 pe högre.
7. **Rangpoäng**: 100 / riktodds med X, +3 per positiv signal, +10 felstreckad, +5/+10/+15 för I/S/B (högsta gäller). X ger inget extra.
8. Allgarderingen räknas mot favoritspärren.
9. Egna val styr alltid. Går favoriten över spärren tar appen bort den i ett annat lopp. Går inte det visas "över spärren" utan att något blockeras.
10. Favoriter med Spelbar eller Bet skyddas först. Spärren tar favoriterna där modellen tror minst på dem jämfört med strecket.
11. Strecket saknas: preliminär rad på modellens ordning.
12. Struken häst ersätts automatiskt. Struken egen spik ger ett fel med val.
13. Spikar 0–7 på V85 och 0–6 på V75, spärr 4 och 3, som konstanter i `lib/game-type.ts`.
14. Desktop får en egen flik **V85-rad** i full bredd.
15. Kopiera-texten som i dag, med allgarderingen som "Avd 5: alla (1–12)".
16. Stegaren per avdelning försvinner. Ändringar görs i arket, som låser avdelningen.

**Underlag i koden**
- `components/spel/RadPanel.tsx` (budgetrutan `Budget`, `LegRow` med `Stepper`, `LegSheet` "Eget val", Kopiera rad), `components/spel/Spelforslag.tsx` (flikarna, `.dtabs`, `.dcols`)
- `lib/coupon.ts` (`rowCount`, `couponCost`, `couponText`, `parseCouponBody`, `asSelections`, `sameNumbers`, `BUDGET_SLIDER`), `lib/coupon-ui.ts` (`couponLegs`, `selectionsOf`, `couponSummary`, `couponBody`, `parseBudget`, `parseRowPrice`, `toggleNumber`) och deras tester
- `prisma/schema.prisma` (`Coupon`), `lib/e2-server.ts` (`getCoupon`, `saveCoupon`), `lib/dto.ts` (`couponDto`), `app/api/rounds/[id]/coupon/route.ts`
- `lib/round-overlay.ts` (`CouponBody`, `couponDtoOf`, `applyPending`, `applyDone`), `components/round/RoundProvider.tsx` (`saveCoupon` via utkorgen), `lib/outbox.ts` (två PUT mot samma adress slås ihop)
- `lib/positive-signals.ts` (`SignalResult.count`, `LOW_STRECK_MIN = 4`), `lib/signals.ts`, `lib/xfactor-ui.ts` (`riktX`, `xOf`), `lib/game-type.ts` (`legsFor`), `lib/migration-check.ts`, `lib/phase.ts` (`BUILD_COUPON`)
- `components/ui/board.tsx` (`FlapNumber`, `Badge`, `BetBadge`, `XBadge`, `Banner`, `Skeleton`), `components/ui/Sheet.tsx`, `components/ui/Toast.tsx`, `components/clipboard.ts` (`copyText`), `components/hooks` (`useOnline`, `useNow`)
- `docs/DESIGN.md` (tokens, `Stepper`, `Sheet`, raderna 52 px)

**Vad som redan finns och inte ska byggas om**
- Budgetrutan på tavlan (reglage 20–1 000 kr, exakt belopp, Rader, Kostnad, Kvar/Över budget, radpriset med Ändra som sparas i inställningarna).
- Sparningen via utkorgen: hela kupongen som idempotent PUT efter 600 ms paus, och vid `visibilitychange` och när vyn lämnas.
- 409 när valet i en avdelning som har startat ändras.
- Reservarket för kopiering ("Kopiera raden" med `textarea.copybox`).

---

## Begrepp (lägger till i 2)

| Begrepp | Betydelse |
|---|---|
| **Tippa V85** | Funktionen som räknar fram V85-raden ur budgeten och reglerna. Fliken heter "V85-rad". |
| **Regler för raden** | Antal spikar, egna spikar, allgardering och favoritspärren. Raden räknas om direkt när något ändras. |
| **Spik** | En avdelning med exakt en häst. **Appens spik** väljs av appen, **egen spik** av Mikael (en låst avdelning med en häst). "Antal spikar" räknar båda. |
| **Eget val** | En låst avdelning med två eller fler hästar som Mikael har valt i arket. Appen ändrar den aldrig. |
| **Allgardering** | En avdelning där alla startande är med. Väljs av appen (**Auto**) eller av Mikael (**Välj avd**). |
| **Öppen avdelning** | En avdelning som appen fyller: inte låst, inte spik, inte allgarderad och inte inställd. |
| **Streckplats** | Hästens plats efter strecket i loppet. 1 = mest streckad. Delad plats vid lika streck. |
| **Topp 3 / Mellan / Skräll** | Streckplats 1–3 / övriga med minst 5 % / under 5 %. Kallas **grupp**. |
| **Favorit** | Den mest streckade hästen i loppet (streckplats 1). |
| **Favoritspärren** | Favoriten får vara med i högst 4 lopp på V85 (3 på V75). |
| **Modellens andel** | Hästens andel av fältet enligt modellen: `(1 / riktX) / Σ(1 / riktX)` i procent, där riktX är riktoddset med X-faktor. Jämförbar med strecket. |
| **Felstreckad** | Modellens andel ≥ 1,5 × strecket och minst 3 pe högre. |
| **Rangpoäng** | Appens ordning inom loppet (6.5.2). |
| **Minsta rad** | Raden när varje öppen avdelning har minsta antal hästar enligt reglerna. |
| **Preliminär rad** | Raden när strecket saknas. Modellens andel ersätter strecket. |

## Veckoflödet (ändrar punkt 4–5 i 3)

- **Måndag–fredag:** Mikael öppnar Spelförslag › V85-rad. Raden är preliminär tills strecket finns och räknas om varje gång han ändrar en markering, X-faktor eller regel.
- **Lördag före spelstopp:** strecket uppdateras. Raden räknas om. Mikael ställer in budget och regler, ändrar eventuellt en avdelning och trycker **Kopiera till ATG**.
- **Efter spelstopp** (första loppets starttid): raden är låst och visas som den sparades.

---

## Användarflöde

1. Mikael öppnar Spelförslag med fliken V85-rad (från Nästa steg, segmentet i mobilen eller fliken på desktop).
2. Appen räknar raden i klienten ur omgångens cache och Mikaels regler (6.5). Ingen nätverksförfrågan behövs.
   - 2a. Strecket saknas: preliminär rad och banderollen "Strecket kommer måndag." (fortsätt 3).
   - 2b. Riktodds och streck saknas helt: läget "Raden kan inte räknas än" (slut).
   - 2c. Raden sparades före E6: den visas som den är, med banderollen och knappen **Räkna om med reglerna** (fortsätt 3 efter tryck eller regeländring).
   - 2d. Spelstopp har passerat: den sparade raden visas låst (slut).
3. Han ser budgeten, reglerna och raden per avdelning, med skälen per häst.
4. Han ändrar något. Raden räknas om direkt och sparas i bakgrunden efter 600 ms.
   - 4a. **Budget** (reglage eller exakt belopp).
   - 4b. **Spikar** (stegaren). Gränserna är antalet egna spikar och `spikMax`.
   - 4c. **Välj egen spik** (ark A5): välj avdelning och häst › **Lägg till som spik**. Avdelningen låses. Går favoriten över spärren visar arket vad appen gör (byter bort favoriten i ett annat lopp, eller "över spärren").
   - 4d. **Ta bort egen spik** (×): avdelningen släpps, appen väljer den igen. Toast med Ångra.
   - 4e. **Allgardering**: Auto, eller Välj avd (ark) › **Allgardera avd 3**.
   - 4f. **Ändra en avdelning** (pennan, ark A4): tryck på hästar. Avdelningen låses och förhandsrutan visar vad omräkningen ger. **Klar · räkna om resten**, Esc eller × sparar. **Släpp eget val** lämnar tillbaka avdelningen till appen.
5. Ryms reglerna inte i budgeten: ingen ny rad. Banderollen visar vad som behövs och knapparna **Höj till 162 kr** och **5 spikar · minst 54,00 kr**. Ett tryck ändrar regeln och raden räknas.
   - 5a. Är det hans eget val som inte ryms: raden visas över budget, med **Ändra avd 7** och **Höj till 486 kr**. Inget blockeras.
6. Han trycker **Spela hos ATG**. Arket visar kupongbilden, ATG-filen och texten att kopiera, se `docs/specs/e7-atg-fil.md`. **Öppna ATG ↗** öppnar ATG i ny flik.
   - 6a. Urklipp fungerar inte: reservarket med texten.
   - 6b. Struken egen spik eller lopp utan startande: knappen är avstängd med orsaken.
7. Ändras raden efter kopieringen (nytt streck, struken häst, ny markering) visar banderollen "Raden har ändrats sedan du kopierade den …". Han kopierar igen om han vill.
8. Nästa steg efter vyn: spela hos ATG. Efter spelstopp används raden i statistiken (senare etapp).

Felvägar: offline (raden räknas och sparas senare, kopiering fungerar), sparfel (utkorgens toasts som i dag), 409 för startad avdelning (utkorgens text som i dag).

---

## S6 Spelförslag (ändrar S6)

- **Mobil:** segmentet är oförändrat: **Trollspöt | Platsspel | V85-rad** (`?flik=trollspot|plats|rad`).
- **Desktop (≥ 1024 px):** `.dtabs` får **tre** flikar i samma ordning: "Trollspöt", "Platsspel", "V85-rad" (`{gameType}-rad`). Varje flik visar sin panel i full bredd. `.dcols` (Platsspel och raden sida vid sida) tas bort. Platsspel får `max-width: 900px` och ligger vänsterställd under fliken.
- `tabOf` och `?flik=` är oförändrade. `aria-controls` på fliken V85-rad pekar på `p-rad`.
- `RefreshRow` ligger kvar överst under flikarna.
- Avvikelse från `docs/DESIGN.md` ("Spelförslaget visar två kolumner sida vid sida"), beslutad av Mikael. DESIGN.md uppdateras.

## S6b V85-rad (ersätter S6b)

Underlag: mockupskärmarna A1–A6, desktop A och Lägen. Klasser från mockupen flyttas till `styles/app.css` (se Filer).

### Uppifrån och ned (mobil 360–430 px)
1. `RefreshRow` (som i dag).
2. **Vyns banderoller** (se Lägen): spelstopp, gammal rad, preliminär, saknat underlag, offline, ändrad sedan kopiering. Högst två visas samtidigt, i den ordningen. `Banner` med klassen `m10`.
3. **Budgetrutan** (`Budget`, ändras, nedan).
4. **Budgetbanderollen**, direkt under rutan: "Reglerna ryms inte" eller "Eget val ryms inte" (`.ban.m`).
5. **Kortet Regler för raden** (`RadRules`).
6. **Strykningsbanderollerna**: struken häst, struken egen spik, strukna i eget val, lopp utan startande.
7. **Rubriken** `h2.sl` "Raden per avdelning" med `<span>` "27 hästar · 576 rader" till höger.
8. **Ett kort per avdelning** (`RadLegCard`), avd 1 först.
9. **Handlingsraden** (`RadActionBar`), fast längst ned ovanför bottenmenyn.

Panelen får `padding-bottom: 140px` i mobilen, så att handlingsraden inte döljer sista kortet.

### Budgetrutan (`Budget`, ändras)
Oförändrad utom:
- **`.sum` får inte längre `aria-live`.** Uppläsningen sköts av vyns enda live-region (Tillgänglighet).
- **Reglerna ryms inte** (status `RULES_DONT_FIT`): Rader "–", Kostnad "–" och tredje rutan `.over` med etiketten "Behövs minst" och "162,00 kr". Under rutorna `.over-line`: "Reglerna kräver minst 324 rader".
- **Eget val över budget** (status `OWN_OVER_BUDGET`): som "Över budget" i dag: Rader 972, Kostnad 486,00 kr, `.over` "Över budget" 186,00 kr och `.over-line` "Över budget med 186,00 kr".
- **Allt ryms** (`allFit`): under rutorna en rad i `--head-ink-2`, 12,5 px: "Budgeten räcker till alla hästar i de öppna loppen."
- Efter spelstopp: reglaget, fältet och Ändra är avstängda (som i dag).

### Kortet Regler för raden (`RadRules`)
`section.rules` med `h2` "Regler för raden" och `<span>` "Raden räknas om direkt". Fyra rader `.rl`, i ordning:

**1. Spikar**
- Etikett `.flbl` "Spikar" (id för gruppen). `Stepper` (`.stp`, 40 × 44, `role="group"`, `aria-labelledby` etiketten), värdet = `spikEffective`.
  - − : `aria-label` "En spik färre". Avstängd vid `spikMin` (= antal egna spikar).
  - + : `aria-label` "En spik till". Avstängd vid `spikMax`.
  - `output` utan `aria-live`.
- Hjälptext `.help` (helt fält under):

| Läge | Text |
|---|---|
| Appen väljer flera | "Appen väljer 3, i de lopp där modellen är säkrast: avd 2, 8 och 6." (ordningen är appens) |
| Appen väljer en | "Appen väljer 1, i loppet där modellen är säkrast: avd 2." |
| Alla spikar är egna | "Alla 4 är dina egna." |
| 0 spikar | "Inga spikar. Alla lopp utom allgarderingen får minst 3 hästar." |
| Ett lopp hoppades över (tillägg) | " Avd 7 hoppades över: spiken där vore favoriten, och favoritspärren är full." (flera: "Avd 1 och 7 hoppades över: …") |
| `spikMax` lägre än spelformens tak (tillägg) | " Högst 5 spikar nu: övriga lopp är dina egna val, allgarderingen, inställda eller saknar riktodds." |
| Riktodds saknas i omgången | "Riktodds saknas, så appen väljer inga spikar. Du kan välja egna." |

**2. Egna spikar**
- Etikett "Egna spikar" och värdet `.rv` "1 av 4" (egna av `spikEffective`).
- En rad `.osp` per egen spik, i avdelningsordning: `FlapNumber sm` (`aria-hidden`), namnet (`.hn`), `small` "Avd 4" och knappen × (`.ibtn`, 44 × 44, `aria-label` "Ta bort egen spik Baron Tilly, avd 4").
  - Struken egen spik: namnet genomstruket och taggen `.rs.scr` "Struken" efter namnet.
- Inga egna spikar: `.help` "Inga egna spikar. Appen väljer alla."
- Knappen **Välj egen spik** (sekundär, plusikon, `aria-haspopup="dialog"`). Avstängd när `ownSpikes` = spelformens tak (V85 7), med `.help` "Alla 7 spikar är redan dina egna. Ta bort en först."
- × tar bort låsningen för avdelningen (`spikCount` ändras inte, appen tar över platsen). Toast "Egen spik 1 Baron Tilly i avd 4 är borttagen · Ångra". Fokus flyttas till nästa ×, annars till Välj egen spik.

**3. Allgardering**
- Etikett "Allgardering" (id) och `.seg` (`role="group"`, `aria-labelledby`) med **Auto** och **Välj avd** (`aria-pressed`).
  - Auto: sätter `allgMode = AUTO` direkt.
  - Välj avd: öppnar arket Välj avdelning (nedan). Segmentet byter först när ett val är gjort.
- Hjälptext:

| Läge | Text |
|---|---|
| Auto | "Avd 5, mest öppna loppet. Favoriten har **14,2 %**." |
| Auto, preliminär | "Avd 5, mest öppna loppet enligt modellen." |
| Vald | "Avd 3, ditt val. Favoriten har **27,5 %**." och länken (`.linkish`) "Byt avdelning" |
| Vald avd blev låst eller inställd | "Din valda avd 3 är låst, så appen valde avd 5." ("… är inställd, …") |
| Ingen avd kan allgarderas | "Ingen avdelning kan allgarderas: alla är dina egna val eller inställda." |

**4. Favoritspärren**
- Etikett "Favoritspärren" och `.rv` "4 av 8". Över spärren: `.rv` i `--down`, "5 av 8 · över".
- Remsan `.favs` med en ruta per avdelning (8 kolumner på V85, 7 på V75), `role="img"`:

| Läge | Ruta | Liten text |
|---|---|---|
| Favoriten är med | `.on` (bärnstensgul fällbladsruta) | "✓ fav" |
| Spärren tog bort den | `.out` | "spärr" (`--head-down`) |
| Inte med av annat skäl | standard | "–" |
| Inställt lopp | standard | "inst" |

  `aria-label`: "Favoriten är med i avdelning 2, 3, 4 och 5. Bortvald av spärren i avdelning 1 och 7. Högst 4 på V85."
- Hjälptext:

| Läge | Text |
|---|---|
| Inget bortvalt | "Favoriten (mest streckad) får vara med i högst **4 lopp på V85**." |
| Bortvalt | "… Bortvald i avd 1 och 7, där modellen tror minst på den." |
| Över, egna val | "Dina egna val har favoriten i 5 lopp, över spärren på 4. Inget blockeras." |
| Över, spikarna | "Spikarna kräver favoriten i 5 lopp, över spärren på 4. Välj färre spikar för att hålla spärren." |

### Avdelningskortet (`RadLegCard`)
`section.lg` med `aria-labelledby` på rubriken.

**Rubriken** (`.lg-h`, minst 52 px): `FlapNumber sm` (`aria-hidden`), `.lg-t` med `h3` "Avd 1 · 16:20" och raden "12 startande · fav 31,0 %" (preliminär: "12 startande · streck saknas", inställt: "Inställt"), typtaggen `.lr` och pennan `.lg-e` (44 × 44, `aria-label` "Ändra avd 1", `aria-haspopup="dialog"`).

| Typ | `.lr` |
|---|---|
| Öppen | "3 hästar" (en häst: "1 häst") |
| Appens spik | `.lr.spik` "Spik" |
| Egen spik | `.lr.lock` med hänglås "Egen spik" |
| Eget val | `.lr.lock` med hänglås "Eget val" |
| Allgardering | `.lr.allg` "Alla 12" |
| Inställt | `.lr` "Inställt" |
| Efter spelstopp | `.lr` "Startat" |

Pennan är avstängd efter spelstopp och för inställda lopp (`title` "Inställt lopp").

**Hästraderna** (`ul.lhl`, `aria-label` "Valda hästar i avd 1"), i rangordning (6.5.2). `li.lh`, minst 52 px, zebra, kolumner 24 px · `minmax(0,1fr)` · 56 px:
- `FlapNumber sm` (`aria-hidden`), och `.sr` "Nr 7, " före namnet.
- Rad 1 (`.hl`): namnet (`.hn` 16,5 px, ellipsis) och märkena: `Badge s` för Spelbar, annars `Badge i` för Intressant, `XBadge`, `BetBadge` med bet-oddset.
- Rad 2 (`.rsn`): skälen som taggar `.rs` (6.5.2, "Skälen"). Får taggarna inte plats bryts `.rsn` till en andra rad (`flex-wrap`) och raden blir högre.
- Höger (`.lst`): strecket "22,4 %" med `.sr` "Streck ". Preliminär: "–" och under det `small` "rikt 1,75".
- Bet: `.lh.is-b` (5 px vänsterkant `--bet`), som i dag.
- Struken (bara medan strykningsbanderollen visas): `.lh.scr`, namnet genomstruket, strecket "–", taggen "Struken", sist i listan.
- Ny efter strykning: `.lh.new` (4 px vänsterkant `--up`) och taggen `.rs.new` "Ny" först.

**Allgarderingen** visar inga hästrader utan nummerrutorna `.allgn`: en `b` per startnummer i loppet (1–N), favoriten med `.fv` (ring). Strukna: genomstruken siffra och `opacity: .45`. `role="img"`, `aria-label` "Alla 12 hästar, 1 till 12. Favoriten är nummer 6." (med strukna: "Alla 11 startande hästar, 1 till 12 utom 7. Favoriten är nummer 6.").

**Varför-raden** (`p.lg-w`, under hästarna):

| Typ | Text |
|---|---|
| Appens spik, först i ordningen | "Säkrast enligt modellen: rikt **1,22**, lägst av loppen som kunde bli spik." |
| Appens spik, övriga | "Säkrast enligt modellen: rikt **1,30**." |
| Tillägg när spiken inte är favoriten | " Favoriten 1 Moe Tjalve har rikt **1,85** (33,5 %)." |
| Egen spik | "Din spik. Avdelningen är låst och räknas inte om." |
| Eget val | "Ditt val. Avdelningen är låst och räknas inte om." |
| Allgardering, auto | "Mest öppna loppet: favoriten **6 Tekno Odin** har **14,2 %**, lägst av omgångens favoriter. 7 hästar har minst 5 %." |
| Allgardering, vald | "Ditt val av allgardering. Favoriten **6 Tekno Odin** har **14,2 %**." |
| Inställt | "Loppet är inställt. Hos ATG räknas alla hästar som vinnare, så en häst räcker." |
| Öppen, få startande | "Bara 2 startande. Båda är med." |
| Öppen | ingen rad |
| Efter spelstopp | "Spik vid spelstopp." / "Egen spik vid spelstopp." / "Allgardering vid spelstopp." / ingen rad för öppna |

**Spärrraden** (`p.lg-x`, när favoriten är spärrad i en öppen avdelning): taggen `.rs.lim` "Spärr" och texten "Ej med: **3 Lannem Lyn**, favorit 31,0 %. Favoritspärren: modellen tror minst på den jämfört med strecket (rikt **2,10**)." Preliminär: "… favorit enligt modellen. Favoritspärren: …". Struken favorit ger ingen rad.

### Handlingsraden (`RadActionBar`, mobil)
`.actbar`, fast längst ned (`bottom: calc(64px + env(safe-area-inset-bottom))`), skugga uppåt. Ingen `aria-live`.
- Vänster `.ab`: rad 1 "**576** rader · **288,00 kr**", rad 2 "Kvar 12,00 kr av 300 kr". Över budget: rad 2 "Över budget med 186,00 kr" i `--down`. Reglerna ryms inte: rad 1 "Ingen rad", rad 2 "Ryms inte i 100 kr".
- Höger: primärknappen **Kopiera till ATG** (kopieringsikon, `aria-haspopup="dialog"`). Avstängd, med orsaken i `aria-describedby` (en `.sr`-text):
  - Reglerna ryms inte: "Raden ryms inte i budgeten."
  - Struken egen spik: "Välj en ny spik i avd 4 först."
  - Lopp utan startande: "Avd 3 har inga startande."
  - Underlag saknas: "Raden kan inte räknas än."
- Efter spelstopp är raden kvar, med knappen aktiv (kopiering av den sparade raden skadar inte).

### Ark A4: Ändra avdelning (`RadLegSheet`)
`Sheet` med titeln "Avd 7 · välj hästar" och underraden "18:50 · 15 startande · i appens ordning. Väljer du själv låses avdelningen." Desktop: dialog 520 px.
1. **Förhandsrutan** `.prev.brd` (`aria-live="polite"`): vänster `small` "Avd 7" och `b` "5 hästar · låst" (1 häst: "1 häst · egen spik", 0: "Ingen häst vald"). Höger `small` "Efter omräkning", `b` "540 rader", `small` "270,00 kr". Under, `p` med ändringen (6.5.11, `previewChangeText`):
   - "Avd 3 går från 4 till 3 hästar (1 Järvsö Elina tas bort) för att raden ska rymmas i **300 kr**."
   - "Avd 1 går från 3 till 4 hästar (5 Hagmyren Kid kommer med)."
   - "Spiken flyttar från avd 7 till avd 1." / "Allgarderingen flyttar till avd 3." / "Antal spikar blir 5."
   - "Övriga avdelningar ändras inte."
   - Eget val ryms inte: "Raden blir 972 rader · 486,00 kr, över budget med 186,00 kr."
   - Ingen häst vald: "Ingen häst vald. Stänger du arket väljer appen avdelningen igen."
   - Flera meningar läggs efter varandra i den ordningen. Högst 3 avdelningsmeningar, därefter "… och 2 avdelningar till."
2. **Hästerna** (`ul.hchips`, `aria-label` "Hästar i avd 7, i appens ordning"): alla startande i rangordning, sist strukna. `button.hchip.hc2` med `aria-pressed`: nummer, namn och märken, skälen (`.rsn`) där favoriten som spärren tog får `.rs.lim` "Spärr", strecket och "✓" när vald. Strukna är avstängda (utom om de är valda, så att de kan väljas bort).
3. **Knapparna** (`.shbtns`): primär **Klar · räkna om resten**, ghost **Släpp eget val** (visas när avdelningen är låst eller blir låst i arket).
- Första trycket på en häst låser avdelningen. Utgångsläget är avdelningens nuvarande hästar (en allgardering: alla).
- Klar, Esc och × sparar valet. Släpp eget val tar bort låsningen, stänger arket och visar toasten "Avd 7 räknas av appen igen · Ångra".
- Låses den valda allgarderingen blir `allgMode = AUTO`.
- Fokus: första valda hästen när arket öppnas, pennan när det stängs.

### Ark A5: Välj egen spik (`RadSpikSheet`)
Titel "Välj egen spik", underraden "Avdelningen låses med en häst. Appen väljer resten av spikarna."
1. **Avdelningsflikarna** `.avd` (`role="tablist"`, `aria-label` "Avdelning"), en `button.avd-t` (`role="tab"`) per avdelning. Avdelningar med egen spik har `.tick` "✓ spik" och `aria-label` "Avd 4, har egen spik". Inställda är `aria-disabled` med `title` "Inställt lopp". Förvald flik: första avdelningen i appens spikordning som inte har egen spik, annars avd 1. ←/→ byter flik, Home/End första/sista.
2. **Förhandsbanderollen** (`.ban.warn`, bara när något av följande gäller för vald häst, `aria-live="polite"`):
   - "**Favoriten blir med i 5 av 8.** Appen tar då bort favoriten i avd 3 i stället (5 Mellby Harley, S och B 2,40), eftersom ditt val går först."
   - "**Favoriten blir med i 5 av 8, över spärren på 4.** Ditt val går först, och inget blockeras."
   - "Avd 5 allgarderas nu. Allgarderingen flyttar till avd 3, näst mest öppna loppet."
   - "Avd 5 är din allgardering. Väljer du spik här blir allgarderingen Auto."
   - "Du har redan 4 egna spikar. Antal spikar blir 5."
3. **Hästerna** (`ul.hchips`, `role="radiogroup"`, `aria-label` "Hästar i avd 6"): `role="radio"` med `aria-checked`. Rangordning, skälen, strecket. Appens nuvarande spik får `.rs.st` "Appens spik nu". Strukna avstängda. Förvald: avdelningens egen spik om den finns, annars ingen. ↑/↓ flyttar valet.
4. **Knapparna:** primär **Lägg till som spik** (har avdelningen redan egen spik: **Byt spik**), avstängd tills en häst är vald. Ghost **Avbryt**.
- Efter tryck: avdelningen låses med hästen. `spikCount = max(spikCount, ownSpikes)`. Är avdelningen vald allgardering blir `allgMode = AUTO`. Arket stängs, toast "Egen spik 7 Dreamliner Sund i avd 6 · Ångra".

### Ark: Välj avdelning att allgardera (`RadAllgSheet`)
Titel "Välj avdelning att allgardera", underraden "Alla hästar i loppet kommer med. Appen räknar om resten."
- `ul.hchips` med `role="radiogroup"`, en rad per avdelning (`role="radio"`): `FlapNumber sm`, "Avd 5 · 18:00", underraden "12 startande · fav 14,2 % · 7 med minst 5 %", taggen `.rs.st` "Mest öppna" på appens val, och till höger raderna det skulle ge, "576 rader", eller `.rs.lim` "Ryms inte".
- Låsta avdelningar är avstängda med underraden "Ditt val, låst". Inställda "Inställt lopp".
- Knappar: primär **Allgardera avd 5**, ghost **Avbryt**. Valet sätter `allgMode = CHOSEN`, `allgLeg`.

### Ark A6: Spela hos ATG (`RadAtgSheet`)
Titel "Spela hos ATG", underraden "V85 Bjerke lör 31 okt · 576 rader · 288,00 kr".
1. **Kupongbilden** (`Kupong`, `.kup.brd.mini`, `role="group"`, `aria-label` "Kupongen"): raden `.kst` "**576** rader · **288,00 kr**" och "kvar 12,00 kr · favoriten **4 av 8**". Rutnätet `.kg` med en kolumn per avdelning: rubriken `.kh` (siffran och `small` "3 st", "Spik", "Egen", "Alla", "Eget", "Inst."), därefter en ruta `.kc` per startnummer 1 till det högsta startnumret i omgången. Vald: `.on`. Favorit: `.fv` (ring). Struken: `.kc.scr` (siffran dämpad med snedstreck). Nummer som inte finns i loppet: `.kc.nil`. Rubrikerna är `span`, inte knappar. Rutnätet är `aria-hidden`, och en `.sr`-text upprepar innehållet: "Avd 1: 7, 10, 12. Avd 2: 2. … Avd 5: alla, 1 till 12." Förklaringen `.kleg`: "med i raden" och "ring = favoriten".
2. **Hjälptext:** "Avd 5 är allgarderad. Hos ATG trycker du på **Alla** i avd 5. Texten som kopieras har avdelningarna i ordning, och sist rader och kostnad." Utan allgardering bara sista meningen.
3. **Knappar:** primär **Kopiera texten** (kopieringsikon) och sekundär länk **Öppna ATG** med ikonen ↗ (`https://www.atg.se/spel/{gameType}`, `target="_blank"`, `rel="noopener noreferrer"`, `aria-label` "Öppna ATG (öppnas i ny flik)").
- Kopiera texten: `copyText(couponText(...))`. Lyckas: statusraden "Raden är kopierad." (`docs/specs/e7-atg-fil.md`), arket står kvar, och raden sparas med `copiedAt` och `copiedSelections` (9.3). Misslyckas: reservarket som i dag, och raden sparas ändå som kopierad.

### Desktop (≥ 1024 px)
`.drad`: två kolumner, `380px minmax(0,1fr)`, mellanrum 24 px, utfyllnad 16 × 20 px.
- **Vänster** (`aside`, `position: sticky; top: 12px`, `max-height: calc(100dvh - 24px)`, `overflow: auto`): budgetrutan (`.budget.flat`), `.dact` med primärknappen **Spela hos ATG** i full bredd och `.help` (centrerad) "Visar kupongen, ATG-filen och texten att kopiera", budgetbanderollen och Regler för raden (`docs/specs/e7-atg-fil.md`). Handlingsraden visas inte (summan står i budgetrutan).
- **Höger** (`section`): `h2.dsec` "Raden per avdelning" med `small` "27 hästar · spikar i avd 2, 4, 6 och 8 · allgardering i avd 5 · favoriten bortvald i avd 1 och 7" (delar som saknas utelämnas), strykningsbanderollerna och `.lgg` med korten i två kolumner (412 px vid 1280), ordning 1–8 radvis.
- Vyns banderoller ligger över båda kolumnerna.
- Arken är dialoger (520 px, centrerade).

### Lägen

| Läge | Var | Ton | Text | Handlingar |
|---|---|---|---|---|
| Omgången laddas | hela vyn | – | skelettet i `Spelforslag` (som i dag) | – |
| Underlag saknas (inga riktodds och inget streck) | vyns banderoll | info | "**Raden kan inte räknas än.** Den behöver riktodds eller streck. Hämta omgången igen när riktoddsen är räknade." | – |
| Riktodds saknas, streck finns | vyns banderoll | info | "Riktodds saknas. Raden bygger på strecket och dina markeringar, och appen väljer inga spikar." | – |
| Preliminär | vyns banderoll | info | "**Strecket kommer måndag.** Raden är preliminär: topp 3, mellan och skräll räknas på modellens ordning, och favoriten är hästen med lägst riktodds. Raden räknas om när strecket finns." (måndag och senare: "**Strecket saknas än.** …") | – |
| Gammal rad (`spikCount = null`) | vyns banderoll | info | "Raden sparades före de nya reglerna och visas som den är." | sekundär **Räkna om med reglerna** |
| Ändrad sedan kopiering | vyns banderoll | info | "**Raden har ändrats sedan du laddade ner eller kopierade den** i dag 14:05. V85-3 och V85-7 är ändrade. Ladda ner en ny fil eller kopiera igen om du vill spela den nya raden." | sekundär **Spela hos ATG** (`docs/specs/e7-atg-fil.md`) |
| Offline | vyns banderoll | warn | "Ingen uppkoppling. Raden räknas om här och sparas när du är online igen. Kopiera fungerar ändå." | – |
| Spelstopp passerat | vyns banderoll | info | "V85 har startat – raden kan inte längre spelas. Den finns kvar för statistiken." | – |
| Reglerna ryms inte | budgetbanderoll, `role="alert"` | err | "**Reglerna ryms inte i 100 kr.** 4 spikar, allgardering av avd 5 (12 hästar) och minst 3 hästar i de 3 andra loppen ger minst 324 rader, alltså 162,00 kr. Ingen ny rad föreslås förrän det ryms." | se 6.5.10 |
| Eget val ryms inte | budgetbanderoll | warn | "**Avd 7 med 9 hästar ryms inte.** Även när de andra loppen har minsta antal blir raden 972 rader · 486,00 kr. Ingenting blockeras, men raden är över budget." | **Ändra avd 7**, **Höj till 486 kr** |
| Struken häst i appens avdelning | strykning, `role="status"` | warn | "**11 Tangen Haap i avd 7 är struken.** Den togs bort, och 5 Odd Herakles kom med i stället som Mellan. Raden är fortfarande 576 rader · 288,00 kr." (ändrat: "Raden är nu 540 rader · 270,00 kr.") | × stäng |
| Struken egen spik | strykning, `role="alert"` | err | "**Din spik 1 Baron Tilly i avd 4 är struken.** Hos ATG ersätts den med reservhästen. Välj en ny spik, eller låt appen välja." | **Välj ny spik** (A5 på avd 4), **Låt appen välja** (släpper låsningen) |
| Struken i eget val | strykning | warn | "**8 Stål Viking i avd 7 är struken** och togs bort ur ditt val." Alla strukna: "**Alla dina hästar i avd 7 är strukna.** Appen väljer avdelningen igen." | × stäng |
| Lopp utan startande (inte inställt) | strykning, `role="alert"` | err | "**Avd 3 har inga startande hästar.** Raden kan inte kopieras förrän loppet är inställt hos ATG. Hämta omgången igen." | – |
| Ingen skräll under 5 % | i kortet | – | taggen `.rs.wrn` "Ingen under 5 %" på hästen som valdes | – |
| Ingen mellan | i kortet | – | taggen `.rs.wrn` "Ingen mellan" | – |
| Inställt lopp | i kortet | – | typen "Inställt", varför-raden | – |
| Över spärren | Favoritspärren | – | texterna i Regler, rad 4 | – |
| Allt ryms | budgetrutan | – | "Budgeten räcker till alla hästar i de öppna loppen." | – |
| Kopiering misslyckas | ark | – | reservarket som i dag | – |
| Sparfel / 409 | toast | – | utkorgens texter som i dag | – |

- Strykningsbanderollerna skapas när raden räknas och en häst i den **senast sparade** raden är struken. De står kvar tills de stängs med × (44 × 44, "Stäng meddelandet") eller vyn lämnas, även efter att den nya raden har sparats. Felbanderollerna (struken egen spik, inga startande) står kvar tills orsaken är löst.

---

## 6.5 V85-rad (ersätter 6.5)

Allt räknas i klienten med rena funktioner i `lib/tippa.ts`. Servern räknar inte raden, den sparar och kontrollerar den.

### 6.5.1 Indata

```ts
type TippaStart = {
  number: number; name: string; scratched: boolean;
  streck: number | null;        // procent, 2 decimaler
  riktX: number | null;         // riktX(start) ur lib/xfactor-ui.ts
  signals: number | null;       // StartDto.signals?.count
  interesting: boolean; spelbar: boolean; bet: boolean; betOdds: number | null;
  xFactor: "NONE" | "TROR" | "STARK";
};
type TippaLeg = { leg: number; startAt: string; cancelled: boolean; starts: TippaStart[] };
type TippaRules = {
  gameType: string; budget: number; rowPrice: number;
  spikCount: number;                       // önskat antal spikar totalt
  allgMode: "AUTO" | "CHOSEN"; allgLeg: number | null;
  locked: Record<number, number[]>;        // låsta avdelningar och deras val
};
buildRad(legs: TippaLeg[], rules: TippaRules, opts?: { favLimit?: number }): TippaResult
```
- `couponLegs` i `lib/coupon-ui.ts` byggs om till `tippaLegs(data: RoundResponse, factors)` och ger `TippaLeg[]` för avdelning 1..`legsFor(gameType)`.
- Indata sorteras först på startnummer, så att resultatet inte beror på ordningen i cachen.
- **Löpande hästar** `R(L)` = ej strukna starter i avdelningen. Alla jämförelser nedan gäller `R(L)`.

### 6.5.2 Per avdelning och häst (`legFacts`)
Körs för varje avdelning med minst en löpande häst. **Preliminär** (`prelim`) = ingen häst i avdelningen har streck > 0.

1. **Modellens andel:** `inv = 1 / riktX` för hästar med riktX. `andel = 100 × inv / Σ inv` (summan över löpande med riktX). null utan riktX.
2. **Jämförelsetal** `v`: strecket (null = 0). Preliminär: modellens andel (null = 0).
3. **Streckplats:** `plats = 1 + antal löpande med v strikt större`. Lika v ger samma plats.
4. **Favorit:** löpande med plats 1. Flera med plats 1: lägst riktX (null sist), sedan lägst nummer. Exakt en favorit per avdelning.
5. **Grupp:** `T3` om plats ≤ 3. Annars `MEL` om v ≥ 5. Annars `SKR`. Med 1–3 löpande är alla `T3`.
6. **Felstreckad:** inte preliminär, andel och streck finns, och `andel ≥ 1,5 × streck − 1e-9` och `andel − streck ≥ 3 − 1e-9`.
7. **Signaler:** `signals ?? 0`.
8. **Rangpoäng** i hundradelar, så att jämförelsen blir exakt:
   `poäng = round(10000 / riktX) + 300 × signaler + (felstreckad ? 1000 : 0) + märke`
   där `märke` = 1500 med Bet, annars 1000 med Spelbar, annars 500 med Intressant, annars 0. Utan riktX är första termen 0. X ger inget eget tillskott (det ingår i riktX). En häst med X är alltid Intressant (6.8) och får därmed 500.
9. **Rangordning:** poäng fallande, sedan riktX stigande (null sist), sedan streck fallande (null sist), sedan nummer stigande.
10. **Kvoten** för spärren: `kvot = andel / streck` (preliminär: `kvot = andel`). Saknas andel: 0.

**Skälen** (`ReasonCode`, taggar i fast ordning):

| Kod | Tagg (`.rs`-klass) | När |
|---|---|---|
| `PRE` | "Prel." (`.pre`) | preliminär |
| `T3` | "Topp 3" (`.t3`) | grupp T3 |
| `MEL` | "Mellan" (`.mel`) | grupp MEL |
| `SKR` | "Skräll" (`.skr`) | grupp SKR |
| `LOW` | "Ingen under 5 %" (`.wrn`) | ersätter gruppens tagg för skrällersättaren (6.5.7) |
| `NOMEL` | "Ingen mellan" (`.wrn`) | ersätter gruppens tagg för mellanersättaren (6.5.7) |
| `FEL` | "Felstreckad" (`.fel`, ▲ före) | felstreckad |
| `SIG4`–`SIG10` | "4 signaler" (`.sig`) | minst `LOW_STRECK_MIN` = 4 signaler |
| `FAV` | "Favorit" (`.fav`) | favoriten |

Bara i gränssnittet: "Ny" (`.new`), "Struken" (`.scr`), "Spärr" (`.lim`, i arken), "Appens spik nu" och "Mest öppna" (`.st`).

### 6.5.3 Avdelningarnas typ
Gäller bara före spelstopp (6.5.12). I ordning:
1. **INSTÄLLD** (`CANCELLED`): `race.cancelled`. Val: den första i rangordningen (har avdelningen ett låst val: det). Räknas inte som spik, inte i spärren och kan inte allgarderas.
2. **UTAN STARTANDE**: inte inställd och `R(L)` tom. Status `NO_STARTERS`. Avdelningen räknas som faktor 1 så att resten kan visas, men raden kan inte kopieras.
3. **LÅST** (`locked[L]` finns): valet = de låsta numren som finns i `R(L)`.
   - Var en låst häst struken och valet hade en häst: **struken egen spik** (`struckOwnSpik`). Avdelningen behåller det sparade numret, räknas som faktor 1 och egen spik, och raden kan inte kopieras.
   - Var hästar strukna och minst en finns kvar: de strukna tas bort (`struckRemoved`). Finns en kvar blir avdelningen egen spik.
   - Var alla strukna och valet hade flera: låsningen släpps (`unlockedLegs`), och avdelningen blir FRI.
   - Exakt en häst: **EGEN SPIK** (`OWN_SPIK`). Fler: **EGET VAL** (`OWN`).
4. Övriga: **FRI**.

Låsta avdelningar kontrolleras inte mot grupperna. De rörs aldrig av appen.

### 6.5.4 Allgardering
- `CHOSEN` och `allgLeg` är FRI: den avdelningen.
- `CHOSEN` men avdelningen är låst, inställd eller saknas: som AUTO, och `allgFallback` = orsaken (`LOCKED` eller `CANCELLED`).
- `AUTO`: bland FRIA avdelningar, den med **lägst favoritstreck** (preliminär: lägst andel för favoriten). Vid lika: flest hästar med v ≥ 5, sedan flest löpande, sedan lägst avdelningsnummer.
- Ingen FRI avdelning: ingen allgardering (`allgLeg = null`).
- Valet = alla i `R(L)`. Typ **ALLG**. Favoriten är alltid med.

### 6.5.5 Spikar
- `ownSpikes` = antal EGEN SPIK (inklusive struken egen spik).
- **Kandidater** = FRIA avdelningar utom allgarderingen, med minst en löpande häst med riktX. Spikhästen = lägst riktX i avdelningen (lika: högre poäng, sedan lägre nummer). Nyckel = spikhästens riktX.
- **Ordning:** nyckel stigande, sedan avdelningsnummer stigande.
- `spikMax = min(SPIK_MAX[gameType], ownSpikes + antal kandidater)`. `spikMin = ownSpikes`.
- `spikEffective = clamp(spikCount, spikMin, spikMax)`. `appSpikes = spikEffective − ownSpikes`.
- **Favoritkvot före spikarna:** `Q = favLimit − (låsta avdelningar där valet innehåller favoriten) − (allgardering ? 1 : 0)`.
- **Varv 1:** gå igenom kandidaterna i ordning tills `appSpikes` är valda. Är spikhästen favorit: välj bara om `Q > 0` (då `Q −= 1`), annars hoppa över och spara avdelningen i `skippedSpik`.
- **Varv 2:** saknas spikar, ta avdelningarna i `skippedSpik` i samma ordning. De bryter spärren: `favOver = "SPIKES"`, och de tas bort ur `skippedSpik`.
- Valda avdelningar får typ **SPIK** med spikhästen. `spikLegs` behåller valordningen (texten "avd 2, 8 och 6").

### 6.5.6 Favoritspärren
- `favLimit = FAV_LIMIT[gameType]` (V85 4, V75 3, V86 4, GS75 3).
- **Öppna avdelningar** = FRIA som inte är allgardering eller spik.
- **Tvingade favoriter** `F0` = låsta med favoriten + allgarderingen + spikar som är favorit + öppna avdelningar med 1–3 löpande (där alla är med).
- Är `F0 > favLimit`: `favOver = "OWN"` (om det inte redan är `"SPIKES"`). Inget blockeras.
- **Kvar till öppna** `Qopen = max(0, favLimit − F0)`.
- **Behållordning** för öppna avdelningar med minst 4 löpande: först de där favoriten har Spelbar eller Bet, sedan efter `kvot` fallande (modellen tror mest), sedan avdelningsnummer stigande.
- De första `Qopen` får ha favoriten (`favAllowed`). Övriga får **favoriten spärrad** (`favBanned`): favoriten kan inte väljas i 6.5.7 eller 6.5.8, och kortet visar spärrraden.
- `favCount` (siffran "4 av 8") = antal avdelningar där favoriten finns i den slutliga raden, inställda borträknade. Över spärren när `favCount > favLimit`.

En tillåten favorit som inte kommer med (för låg rang eller för liten budget) lämnar kvoten oanvänd. Den flyttas inte till ett annat lopp, så att spärrraden blir lätt att förklara (Beslut 4).

### 6.5.7 Minsta val i öppna avdelningar
Med `n` löpande och favoriten borttagen om den är spärrad:
- **n ≤ 3:** alla löpande (spärren gäller inte här, se `F0`). Typ OPEN med `few = true`.
- **Annars**, i ordning:
  1. **Topp 3:** den bäst rangade T3-hästen.
  2. **Mellan:** den bäst rangade MEL-hästen, om någon finns.
  3. **Skräll:** den bäst rangade SKR-hästen, om någon finns.
  4. Saknas skräll: den ej valda hästen med **lägst v** (lika: högre poäng, lägre nummer). Taggen `LOW`.
  5. Saknas mellan: den bäst rangade ej valda hästen. Taggen `NOMEL`.
  - Finns ingen T3 utom en spärrad favorit tas den bäst rangade ej valda hästen.
- `lo(L)` = antal valda (oftast 3).
- **Fortsättning** `A(L)`: övriga löpande i rangordning, utan spärrad favorit. `hi(L) = lo(L) + |A(L)|`.

### 6.5.8 Budget och "flest hästar"

**Grundtal (heltal, inga flyttal i jämförelsen)**
- `prisÖre = round(rowPrice × 100)`, `maxRader = floor(budget × 100 / prisÖre)`.
- `fast = Π antal i alla avdelningar som inte är öppna` (spik 1, egen spik 1, eget val k, allgardering n, inställd 1, utan startande 1).
- `minRader = fast × Π lo(L)`. `R = floor(maxRader / fast)`.

**Status**
- `minRader ≤ maxRader`: fortsätt nedan (status `OK`).
- Annars, om `minRader` räknat med varje EGET VAL som 1 häst ryms (`≤ maxRader`): status **`OWN_OVER_BUDGET`** (det är det egna valet som inte ryms). Raden = minsta raden. Den sparas och kan kopieras.
- Annars: status **`RULES_DONT_FIT`**. Raden = minsta raden, som visas men inte sparas och inte kan kopieras (6.5.10).

**Problemet:** välj `k(L)` i `[lo(L), hi(L)]` för varje öppen avdelning så att `Π k(L) ≤ R`, med största `Σ k(L)`. Avdelningens hästar är då minsta valet plus de första `k(L) − lo(L)` i `A(L)`.

**Varför inte den giriga regeln "lägg till där kostnaden ökar minst":** att lägga till i avdelning L multiplicerar raderna med `(k+1)/k`, så den billigaste ökningen är alltid i den bredaste avdelningen. Med tak på antalet hästar ger det fel svar. Exempel: A har `lo 3, hi 4`, B har `lo 3, hi 12`, `R = 36`. Girigt (A först vid lika): (4, 9) = 13 hästar. Bäst: (3, 12) = 15 hästar. Därför löses problemet exakt.

**Snabbväg:** är `Π hi(L) ≤ R` tas alla hästar i alla öppna avdelningar (`allFit = true`). Inga öppna avdelningar: klart.

**Exakt lösning (dynamisk programmering över produkten)**
1. Öppna avdelningar i stigande avdelningsnummer `L1 … Lm`. `Rcap = min(R, Π hi(L))`.
2. Tillstånd: en `Map` från produkt `p` till bästa `{ hästar h, poäng s, bakåtpekare }`. Start: `{ 1: (0, 0) }`.
3. För varje avdelning `Li`, för varje tillstånd `(p, h, s)` i Map-ordning, för `k = lo … hi` stigande:
   - `p' = p × k`. Är `p' > Rcap`: bryt slingan över k (större k blir bara större).
   - `h' = h + k`, `s' = s + tillägg(Li, k)`, där `tillägg` = summan av poängen för de första `k − lo` hästarna i `A(Li)` (förberäknad prefixsumma).
   - Spara i nästa Map om `p'` saknas, eller om `(h', s')` är **strikt** bättre: större h, eller lika h och större s. Lika: behåll det som redan finns (första vinner, och ordningen ovan gör det deterministiskt).
4. Efter sista avdelningen: välj tillståndet med störst h, sedan störst s, sedan **minst p** (billigast), sedan det första i Map-ordningen. Följ bakåtpekarna och sätt `k(L)`.

**Varför det är exakt:** varje kombination av k som ryms har en produkt ≤ R och nås via sina delprodukter, och för varje delprodukt behålls den bästa delsumman. Eftersom fortsättningen bara beror på produkten går ingen bättre lösning förlorad (som en ryggsäck med produkt i stället för summa).

**Komplexitet och tak**
- Antal tillstånd per steg ≤ antal olika produkter ≤ `Rcap` som går att bilda av tal ≤ 20 (startnummer). De är 19-släta tal och få: under 1 000 vid `R ≤ 10 000` och några tiotusental vid `R = 10 000 000`. Byggaren mäter det exakta antalet i prestandatestet och skriver in det i kommentaren i `lib/tippa.ts`.
- Iterationer ≤ `m × tillstånd × max(hi − lo + 1)` ≤ 7 × tillstånd × 17. Typfallet (300 kr, radpris 0,50) har R ≤ 100 och under 2 000 iterationer.
- Hårt tak: `R` begränsas av `BUDGET_MAX = 100 000` kr och radpriset ≥ 0,01 kr, alltså högst 10 000 000.
- Steg 6.5.2–6.5.7 är `O(Σ n log n)`.
- Reglaget går via `useDeferredValue`, så att omräkningen aldrig hackar.

### 6.5.9 Avslut
- `selections[L]` = valda nummer sorterade stigande. Låsta oförändrade (utom strukna enligt 6.5.3).
- `rows = rowCount(selections, legsFor(gameType))`, `cost = couponCost(rows, rowPrice)`. Struken egen spik och utan startande räknas som 1 häst i summan, men raden kan inte kopieras.
- `canCopy` = status `OK` eller `OWN_OVER_BUDGET`, ingen struken egen spik och inga avdelningar utan startande.
- `legRoles` byggs (8.5).

### 6.5.10 När reglerna inte ryms (`RULES_DONT_FIT`)
**Förslagen** (`suggestions`, högst två knappar, i den här ordningen):
1. **Höj budgeten:** `X = ceil(minRader × prisÖre / 100)` hela kronor. Knapp "Höj till 162 kr". Visas om `X ≤ BUDGET_MAX`.
2. **Fler spikar:** för `s = spikEffective + 1 … spikMax`, räkna 6.5.4–6.5.7 med `spikCount = s`. Det första `s` där `minRader(s) ≤ maxRader` ger knappen "5 spikar · minst 54,00 kr" (kostnaden för `minRader(s)`). Finns inget s: ingen knapp.

**Texten** (`rulesDontFitText`), ihopsatt av delar som finns:
"**Reglerna ryms inte i {budget} kr.** {spikar}{, allgardering av avd N (n hästar)}{, ditt eget val i avd 3 (4 hästar)} och minst {lo} hästar i de {m} andra loppen ger minst {minRader} rader, alltså {minKostnad}. Ingen ny rad föreslås förrän det ryms."
- `{spikar}`: "4 spikar" / "1 spik" / "Inga spikar". Har öppna lopp olika `lo` (få startande): "minst 2–3 hästar". Inga öppna lopp: "{spikar}{, …} ger minst …".

**Ett tryck** på en knapp ändrar budgeten eller `spikCount`, och raden räknas. Toast "Budgeten är 162 kr · Ångra" eller "5 spikar · Ångra". Fokus flyttas till budgetrutans summa (`tabindex="-1"`).

**Eget val ryms inte** (`OWN_OVER_BUDGET`): knapparna **Ändra avd 7** (öppnar A4 för det låsta valet med flest hästar, lika: lägst avdelning) och **Höj till {ceil(kostnad)} kr**.

### 6.5.11 Förhandsvisning och ändringstexter
- `previewChangeText(before: TippaResult, after: TippaResult, leg)` jämför per avdelning antal och nummer, `spikLegs`, `allgLeg` och `spikEffective`, och ger meningarna i A4.
- Arket A5 räknar `buildRad` med den tänkta låsningen och jämför `favBanned` och `allgLeg` för texterna.

### 6.5.12 Efter spelstopp
När första loppet har startat (`raceStarted` för någon avdelning) räknas inget. Vyn visar den sparade raden, `legRoles` för skälen (finns de inte: inga taggar), typerna ur `legRoles` och "Startat" som `.lr`. Alla kontroller är avstängda.

### 6.5.13 Kopiera-texten (ändrar 6.5)
`couponText(round, selections, rowPrice, opts?: { allgLeg?: number | null; numbersByLeg?: Record<number, { all: number[]; scratched: number[] }> })`:
```
V85 Bjerke lör 31 okt 2026
Avd 1: 7, 10, 12
Avd 2: 2
Avd 3: 1, 5, 9, 13
Avd 4: 1
Avd 5: alla (1–12)
Avd 6: 3
Avd 7: 3, 4, 11, 14
Avd 8: 4
576 rader · 288,00 kr
```
- Allgarderingen: "Avd 5: alla ({min}–{max})" över loppets startnummer. Med strukna: "Avd 5: alla (1–12, utom 7)" (flera: "utom 3 och 7").
- Utan `opts` som i dag, så att gamla rader kopieras oförändrade.
- V75: sju avdelningar och "V75" först.

### 6.5.14 Standardvärden och gamla rader
- **Ny rad** (ingen `Coupon`): budget `DEFAULT_BUDGET`, radpris från inställningarna, `allgMode = AUTO`, inga låsta, och `spikCount` = `defaultSpikCount` = det minsta `s` i `[ownSpikes, spikMax]` där `minRader(s) ≤ maxRader`. Finns inget: `spikMax`. Den räknas om tills Mikael ändrar något, och sparas först vid hans första ändring eller vid Kopiera texten.
- **Gammal rad** (`Coupon` finns men `spikCount = null`, sparad före E6): visas som den är, utan omräkning, med banderollen. **Räkna om med reglerna**, eller en ändring av en regel, sätter `spikCount = defaultSpikCount`, `allgMode = AUTO`, behåller låsta avdelningar som egna val och räknar om resten. Toast "Raden är räknad med reglerna · Ångra". Ångra sparar tillbaka den gamla kroppen med `spikCount: null`.

---

## 8.5 Datamodell (lägger till i 8)

```prisma
enum AllgMode {
  AUTO
  CHOSEN
  @@schema("spelvarde")
}

model Coupon {
  // … befintliga fält oförändrade …
  // E6. null = raden sparades före E6 (visas som den är, 6.5.14).
  spikCount        Int?
  allgMode         AllgMode?
  // CHOSEN: Mikaels val. AUTO: den avdelning appen valde vid senaste sparningen.
  allgLeg          Int?
  // Skälen per avdelning och häst vid senaste sparningen (se nedan).
  legRoles         Json?
  // Senaste Kopiera texten.
  copiedAt         DateTime?
  copiedSelections Json?
}
```

- **Ingen `NONE` i `AllgMode`.** Mikael har inte valt att kunna stänga av allgarderingen. Behövs det senare läggs värdet till med `ALTER TYPE … ADD VALUE`, som kontrollen godkänner.
- **Egen spik och eget val** behöver inga fält: en låst avdelning (`lockedLegs`) med en häst respektive flera i `selections`.
- Spärren och spiktaket är konstanter i `lib/game-type.ts`, inte inställningar.

**`legRoles`** (version 1):
```json
{ "v": 1, "prelim": false, "favLimit": 4,
  "legs": {
    "1": { "k": "OPEN", "h": { "7": ["T3","SIG4"], "10": ["MEL","FEL"], "12": ["SKR","SIG5"] }, "favOut": 3 },
    "2": { "k": "SPIK", "h": { "2": ["T3","SIG6","FAV"] } },
    "4": { "k": "OWN_SPIK", "h": { "1": ["T3","SIG5","FAV"] } },
    "5": { "k": "ALLG", "fav": 6 }
  } }
```
- `k` ∈ `OPEN`, `SPIK`, `OWN_SPIK`, `OWN`, `ALLG`, `CANCELLED`. `h` = valda hästar och deras koder i taggordningen (6.5.2, utan gränssnittskoderna). `favOut` = spärrad favorits nummer. `fav` = favoritens nummer (bara ALLG).
- Högst 6 000 tecken som JSON.

**Migreringen** (`prisma/migrations/<tid>_e6_v85_rad/migration.sql`):
```sql
CREATE TYPE "spelvarde"."AllgMode" AS ENUM ('AUTO', 'CHOSEN');
ALTER TABLE "spelvarde"."Coupon"
  ADD COLUMN "spikCount" INTEGER,
  ADD COLUMN "allgMode" "spelvarde"."AllgMode",
  ADD COLUMN "allgLeg" INTEGER,
  ADD COLUMN "legRoles" JSONB,
  ADD COLUMN "copiedAt" TIMESTAMP(3),
  ADD COLUMN "copiedSelections" JSONB;
ALTER TABLE "spelvarde"."Coupon" ADD CONSTRAINT "Coupon_spikCount_check" CHECK ("spikCount" IS NULL OR "spikCount" BETWEEN 0 AND 8);
ALTER TABLE "spelvarde"."Coupon" ADD CONSTRAINT "Coupon_allgLeg_check" CHECK ("allgLeg" IS NULL OR "allgLeg" BETWEEN 1 AND 8);
```
- Additiv: inga `DROP`, `UPDATE` eller `RENAME`, och varje sats nämner `spelvarde`. `npm run check:migration` ska vara grön. RLS finns redan på `Coupon`.
- **Befintliga rader** får null i alla nya kolumner och tolkas som gamla rader (6.5.14). Inget skrivs om.
- Körs mot drift först efter Mikaels ja, via `bash scripts/prod-db.sh deploy`.

---

## 12. API (ändrar)

### `PUT /api/rounds/[id]/coupon`
Kroppen är fortfarande hela kupongen. Nya fält, alla frivilliga så att äldre köade kroppar fungerar:

| Fält | Typ | Regel | Saknas |
|---|---|---|---|
| `spikCount` | heltal 0–`SPIK_MAX[gameType]` eller `null` | null = gammal rad (bara Ångra i 6.5.14). Ska vara ≥ antal låsta avdelningar med exakt en häst | behåll sparat |
| `allgMode` | `"AUTO"` \| `"CHOSEN"` \| `null` | null bara tillsammans med `spikCount: null` | behåll |
| `allgLeg` | heltal 1–`legsFor(gameType)` eller `null` | krävs vid CHOSEN. Får inte ligga i `lockedLegs` vid CHOSEN | behåll |
| `legRoles` | objekt enligt 8.5 eller `null` | `v` = 1, nycklar 1–8, kända `k` och koder, högst 6 000 tecken | behåll |
| `copiedAt` | ISO-tid eller `null` | högst 5 min fram i tiden | behåll |
| `copiedSelections` | som `selections` eller `null` | krävs när `copiedAt` sätts | behåll |

- `parseCouponBody` i `lib/coupon.ts` får de nya nycklarna i listan över tillåtna och returnerar `undefined` för saknade. Kontrollerna som kräver omgången (`SPIK_MAX`, `legsFor`, startnumren i `copiedSelections`) görs i `saveCoupon`.
- **Felsvar (400):** "Antalet spikar ska vara 0–7 på V85.", "Antalet spikar kan inte vara färre än dina egna spikar (2).", "Allgarderingen ska vara Auto eller en vald avdelning.", "Välj vilken avdelning som ska allgarderas.", "Allgarderingen kan inte ligga i en låst avdelning.", "Avd 9 finns inte i omgången.", "Ogiltiga skäl i raden.", "Ogiltig kopieringstid."
- **Spelstopp:** regeln om 409 för ändrat val i en startad avdelning gäller som i dag. För startade avdelningar behålls de sparade `legRoles[L]` (servern slår ihop), så att skälen vid spelstopp inte skrivs över.
- `readJson(req, 8_000)` höjs till `16_000`.
- Allt annat (upsert, radpris) som i dag.

### `GET /api/rounds/[id]/coupon`, `GET /api/rounds/[id]`, `GET /api/rounds/current`
`CouponDto` (`lib/types.ts`, `couponDto` i `lib/dto.ts`) får:
```ts
spikCount: number | null;
allgMode: "AUTO" | "CHOSEN" | null;
allgLeg: number | null;
legRoles: LegRolesDto | null;
copiedAt: string | null;
copiedSelections: Record<string, number[]> | null;
```
- `LegRolesDto` och `ReasonCode` som i 8.5. `couponDto` tolkar `legRoles` med en ny `asLegRoles(x)` som ger null vid fel form.
- Äldre cachade svar saknar fälten: läs med `?? null`.
- `couponDtoOf` i `lib/round-overlay.ts` tar med de nya fälten ur kroppen och faller tillbaka på `data.coupon` för fält som saknas.

---

## 9.3 Klienten: tillstånd och sparning (lägger till)

**Tillstånd i `RadPanel`**
- `draft: RadDraft | null` = `{ budget, rowPrice, spikCount, allgMode, allgLeg, locked: Record<number, number[]>, copiedAt, copiedSelections, legacy: boolean }`. Utgångsläge ur `data.coupon` (6.5.14), annars standardvärdena.
- `result = buildRad(tippaLegs(data), rulesOf(draft))` med `useMemo`. Reglaget går via `useDeferredValue`.
- `notices` (strykningsbanderollerna) i komponentens tillstånd, skapade när `result.struckRemoved`, `struckOwnSpik`, `unlockedLegs` eller en struken häst i den senast sparade raden dyker upp. De lever tills de stängs eller vyn lämnas.
- `sheet: null | { kind: "leg", leg } | { kind: "spik" } | { kind: "allg" } | { kind: "atg" } | { kind: "copy-fallback", text }`.

**Vad som sparas** (via `saveCoupon` i `RoundProvider`, utkorgen, 600 ms paus som i dag):
`{ budget, rowPrice, selections: result.selections, lockedLegs, spikCount: spikEffective, allgMode, allgLeg: result.allgLeg, legRoles: result.legRoles, copiedAt, copiedSelections }`
- **Alltid hela kroppen**, så att sammanslagningen i utkorgen aldrig tappar `copiedAt`.
- **Sparas när:** Mikael ändrar något, trycker Kopiera texten, eller när en `Coupon` redan finns och den räknade raden skiljer sig från den sparade (nytt streck, strykning, ändrad markering). Jämförelsen: `sameNumbers` per avdelning, `allgLeg`, `lockedLegs` och `spikCount`.
- **Sparas inte:** vid `RULES_DONT_FIT` sparas reglerna (budget, spikar, allgardering) men `selections` och `legRoles` behåller sina sparade värden. Gammal rad sparas inte förrän den räknas om. Efter spelstopp sparas inget.
- **Räknas i klienten:** allt i 6.5, rader, kostnad, skälen och texterna.

**Ångra** (toasten): sparar tillbaka hela förra kroppen.

**Nästa steg** (`lib/phase.ts`, `BUILD_COUPON`): titeln "Gör {gameType}-raden", texten "Appen föreslår raden inom din budget. Kopiera den till ATG." och knappen "Till raden". Villkoret är oförändrat.

---

## Texter (samlade, utöver tabellerna ovan)

| Var | Text |
|---|---|
| Panelrubrik (`h2#h-rad`) | "V85-rad" (`{gameType}-rad`). Desktop: bara för skärmläsare (`.sr`), fliken räcker |
| Kortrubrik | "Regler för raden" · "Raden räknas om direkt" |
| Listrubrik | "Raden per avdelning" · "27 hästar · 576 rader" |
| Handlingsknapp | "Kopiera till ATG" |
| Statusrad efter kopiering | "Raden är kopierad." (`docs/specs/e7-atg-fil.md`) |
| Reservark | titeln "Kopiera raden", underraden "Kopieringen fungerade inte i den här webbläsaren. Markera texten och kopiera den själv." (som i dag) |
| Toast: egen spik tillagd | "Egen spik 7 Dreamliner Sund i avd 6 · Ångra" |
| Toast: egen spik borttagen | "Egen spik 1 Baron Tilly i avd 4 är borttagen · Ångra" |
| Toast: eget val släppt | "Avd 7 räknas av appen igen · Ångra" |
| Toast: gammal rad omräknad | "Raden är räknad med reglerna · Ångra" |
| Toast: förslag använt | "Budgeten är 162 kr · Ångra" / "5 spikar · Ångra" |
| Live-region, normal | "4 spikar. 576 rader, 288,00 kronor. Kvar 12,00 kronor." |
| Live-region, ryms inte | "Reglerna ryms inte i 100 kronor. Behövs minst 162,00 kronor." |
| Live-region, över budget | "972 rader, 486,00 kronor. Över budget med 186,00 kronor." |

Belopp skrivs "288,00 kr", streck "31,0 %" (`pct`), riktodds "1,22" (`odds`), tider "16:20" (`hhmm`), som i dag.

---

## Tillgänglighet (WCAG 2.2 AA)

- **Landmärken och rubriker:** panelen är `section#p-rad` med `aria-labelledby="h-rad"`. `h2` för Regler och Raden per avdelning, `h3` per avdelning. Desktopkolumnen till vänster är `aside` med `aria-label` "Budget och regler".
- **En live-region** (`.sr`, `role="status"`, `aria-live="polite"`) i `RadPanel` läser upp summan 500 ms efter senaste ändringen (texterna ovan). `.sum`, stegarens `output` och handlingsraden har ingen `aria-live`, så att inget läses två gånger.
- **Färg bär aldrig ensam:** varje tagg är ett ord, favoritrutan har "✓ fav" och "spärr", kupongens valda rutor har siffran och skärmläsartexten, Felstreckad har ▲ och ordet.
- **Kontrast:** taggarna `.rs` är 10,5 px fet text och ska ha minst 4,5:1 i båda temana. Byggaren mäter `.rs.skr`, `.rs.fel`, `.rs.sig`, `.rs.lim` och `.rs.wrn` och justerar mot tokens om något understiger.
- **Tryckytor** minst 44 × 44: pennan, ×, stegarens knappar (40 × 44 som `Stepper` i DESIGN.md), segmentet, flikarna, häst- och avdelningsraderna i arken (48–54 px).
- **Fokusordning:** flikarna › `RefreshRow` › vyns banderollers knappar › budgetrutan (reglage, exakt belopp, Ändra radpris) › budgetbanderollens knappar › Spikar − och + › varje × för egen spik › Välj egen spik › Auto, Välj avd (Byt avdelning) › strykningsbanderollernas knappar › pennorna avd 1–8 › Kopiera till ATG. Desktop: Kopiera till ATG kommer efter reglerna och före strykningsbanderollerna och pennorna.
- **Arken** fångar Tab, stängs med Esc, låser skrollningen och ger tillbaka fokus (`Sheet`, som i dag). A4 sparar valet även vid Esc och ×.
- **Tangentbord i arken:** A5:s flikar ←/→/Home/End (automatisk aktivering), hästarna ↑/↓ (`radiogroup`). Allgarderingsarket ↑/↓. A4:s hästar är vanliga knappar med `aria-pressed`.
- **Skärmläsartexter:** hästraden läses "Nr 7, Rälsen Rask, Spelbar, Topp 3, 4 signaler, Streck 22,4 %". Kupongen har sin `.sr`-text. Favoritremsan och allgarderingens rutor har `aria-label` (ovan). Avstängd Kopiera har orsaken i `aria-describedby`.
- **Rörelse:** inga nya animationer. `prefers-reduced-motion` respekteras via de globala reglerna.
- **Långa namn:** ellipsis i `.hn`, med fullt namn i skärmläsartexten. Mockupens mått gäller: namnkolumnen 250 px i mobil (längsta exemplet "Kaptein Sabeltann" med I och X ryms), 292 px på desktop, 237 px i arken.

---

## 13. Rena funktioner med tester (lägg till)

| Fil | Funktioner |
|---|---|
| `lib/game-type.ts` | `SPIK_MAX` (V85 7, V75 6, V86 7, GS75 6), `FAV_LIMIT` (V85 4, V75 3, V86 4, GS75 3), `spikMaxFor`, `favLimitFor` |
| `lib/tippa.ts` | `legFacts`, `modelShares`, `streckPlaces`, `rankScore`, `rankOrder`, `chooseAllg`, `chooseSpikes`, `applyFavLimit`, `minimumPicks`, `maximizeHorses` (6.5.8), `buildRad`, `defaultSpikCount`, `suggestions` |
| `lib/tippa-text.ts` | `reasonLabel`, `spikHelp`, `allgHelp`, `favHelp`, `favStripLabel`, `legWhy`, `favOutText`, `rulesDontFitText`, `ownOverText`, `previewChangeText`, `scratchNotice`, `copyChangedText`, `liveSummary` |
| `lib/coupon.ts` | `couponText` (allgardering), `parseCouponBody` (nya fält), `asLegRoles` |
| `lib/coupon-ui.ts` | `tippaLegs`, `couponBody` (nya fält), `couponSummary` (oförändrad) |

`suggestCoupon`, `suggestionOrder`, `favoriteStreck`, `stepLeg` och `legMax` tas bort med sina tester.

## 14. Testfall

### Fixturen Bjerke (`lib/tippa.fixture.ts`)
V85 Bjerke lör 31 okt 2026. Regler: budget 300, radpris 0,50, `spikCount` 4, `allgMode` AUTO, `locked` `{ 4: [1] }`. Streck i %, riktX = riktodds med X (det som går in), sig = signaler. Märken: S = Spelbar (och Intressant), I = Intressant, X/X+ = X-faktor (och Intressant), B = Bet. Ej nämnda: inga märken, 0 signaler.

| Avd | Nr · namn · streck · riktX · sig · märken |
|---|---|
| 1 (12) | 3 Lannem Lyn 31,0 · 2,10 · 2 — 7 Rälsen Rask 22,4 · 1,75 · 4 · S — 5 Hagmyren Kid 12,0 · 2,60 · 1 — 10 Fly Express 9,8 · 2,10 · 2 · I X — 12 Kaptein Sabeltann 3,1 · 5,60 · 5 · I — 1: 6,0 · 4,50 — 2: 5,2 · 5,00 · 1 — 4: 3,5 · 7,00 — 6: 2,5 · 8,00 — 8: 2,0 · 9,00 — 9: 1,5 · 10,0 — 11: 1,0 · 12,0 |
| 2 (11) | 2 Gigant Tider 52,3 · 1,22 · 6 · S — 1: 12,0 · 3,00 — 3: 9,0 · 3,50 — 4: 7,0 · 4,00 — 5: 5,0 · 5,00 — 6: 4,0 · 6,00 — 7: 3,5 · 7,00 — 8: 2,8 · 8,00 — 9: 2,0 · 9,00 — 10: 1,5 · 10,0 — 11: 0,9 · 12,0 |
| 3 (14) | 5 Mellby Harley 27,5 · 1,80 · 4 · S B 2,40 — 2 Tekla Vind 18,0 · 2,50 · 1 — 7 Röde Orm 14,0 · 3,00 — 9 Hulda Hall 11,2 · 2,10 · 4 — 1 Järvsö Elina 7,6 · 2,70 · 2 · I — 13 Admiral Kåre 2,4 · 7,20 · 1 · X — 3: 5,0 · 6,00 — 4: 4,0 · 7,00 — 6: 3,0 · 8,00 — 8: 2,0 · 9,00 — 10: 1,8 · 10,0 — 11: 1,5 · 11,0 — 12: 1,2 · 12,0 — 14: 0,8 · 14,0 |
| 4 (12) | 1 Baron Tilly 44,8 · 1,50 · 5 · S B 2,15 — 2–12: streck 15,0 / 10,0 / 7,0 / 5,5 / 4,5 / 3,8 / 3,2 / 2,5 / 1,8 / 1,2 / 0,7 och riktX 2,5 / 3 / 4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 |
| 5 (12) | 6 Tekno Odin 14,2 · 2,40 — 2: 13,5 · 2,50 — 9: 12,8 · 2,60 — 1: 11,0 · 2,80 — 4: 10,4 · 3,00 — 11: 9,6 · 3,20 — 7: 8,0 · 3,50 — 3: 4,5 · 5,00 — 5: 4,2 · 5,50 — 8: 4,0 · 6,00 — 10: 3,9 · 6,50 — 12: 3,9 · 7,00 |
| 6 (13) | 7 Dreamliner Sund 29,0 · 1,90 · 4 · S — 3 Peggy Boko 24,1 · 1,38 · 5 · I X+ — 1 Grisle Tora 12,8 · 2,60 — 9 Hallsta Lotus 7,1 · 3,50 · 5 — 12 Mustang Sally 3,4 · 5,50 · 1 · I — 2: 6,0 · 4,50 — 4: 5,0 · 5,00 — 5: 4,0 · 6,00 — 6: 3,0 · 7,00 — 8: 2,2 · 8,00 — 10: 1,6 · 9,00 — 11: 1,0 · 10,0 — 13: 0,8 · 12,0 |
| 7 (15) | 6 Vardø Storm 33,2 · 2,20 · 2 — 3 Blizzard Diamant 18,6 · 1,45 · 4 · X — 11 Tangen Haap 8,9 · 2,30 · 3 · S — 4 Stoltheim Prinsen 6,2 · 2,80 · 4 — 14 Ble Rapp 1,9 · 6,50 · 4 — 2 Svart Pil 5,5 · 5,00 — 5 Odd Herakles 5,0 · 4,50 — 1: 2,0 · 9,00 — 7: 4,5 · 6,00 — 8 Stål Viking 3,6 · 7,00 — 9: 3,0 · 8,00 — 10: 2,5 · 9,00 — 12: 2,0 · 10,0 — 13: 1,8 · 11,0 — 15: 1,3 · 13,0 |
| 8 (10) | 1 Moe Tjalve 33,5 · 1,85 · 2 — 4 Bokli Viktor 26,7 · 1,30 · 5 — 2: 12,0 · 2,80 — 3: 9,0 · 3,20 — 5: 6,0 · 4,00 — 6: 4,5 · 5,00 — 7: 3,5 · 6,00 — 8: 2,5 · 7,00 — 9: 1,5 · 8,00 — 10: 0,8 · 10,0 |

Avvikelse från mockupen: rangexemplet i mockupens regelruta (Tangen Haap 1,90 → 72) var avrundat och utan Intressant för X. I fixturen har Tangen Haap riktX 2,30 (poäng 6248) så att den inte blir felstreckad, och Blizzard Diamant får +500 för Intressant (8597). Raden blir ändå exakt mockupens.

### `lib/tippa.test.ts`
1. **Bjerke, mockupens rad:** `selections` = `{1:[7,10,12], 2:[2], 3:[1,5,9,13], 4:[1], 5:[1…12], 6:[3], 7:[3,4,11,14], 8:[4]}`. `rows` 576, `cost` 288, status OK, `allgLeg` 5 (AUTO), `spikLegs` `[2,8,6]` i den ordningen, `ownSpikLegs` `[4]`, `favBanned` `[1,7]`, `favCount` 4, `favOver` null, 27 hästar.
2. **Bjerke, skälen:** avd 1 `7: [T3,SIG4]`, `10: [MEL,FEL]`, `12: [SKR,SIG5]`. Avd 3 `5: [T3,SIG4,FAV]`, `9: [MEL,SIG4]`, `1: [MEL,FEL]`, `13: [SKR]`. Avd 7 `3: [T3,SIG4]`, `11: [T3]`, `4: [MEL,FEL,SIG4]`, `14: [SKR,SIG4]`. Hästordningen i avd 3 är 5, 9, 1, 13 och i avd 7 3, 11, 4, 14.
3. **Bjerke, rangpoäng:** Rälsen Rask 7914, Fly Express 6862, Mellby Harley 8256, Järvsö Elina 5804, Blizzard Diamant 8597, Tangen Haap 6248. Felstreckade: Fly Express, Järvsö Elina, Stoltheim Prinsen. Inte: Kaptein Sabeltann (2,71 pe), Hulda Hall, Admiral Kåre, Tangen Haap, Ble Rapp.
4. **Bjerke, valet mellan 11-hästarsraderna:** med `R = 50` och `lo` (3, 3, 3) i avd 1, 3 och 7 är (3, 4, 4) bäst på poäng (12 052), före (4, 3, 4) (10 394) och (3, 5, 3) (10 104).
5. **Bjerke 100 kr:** status `RULES_DONT_FIT`, `minRows` 324, `minCost` 162, förslagen `[{ kind: "BUDGET", budget: 162 }, { kind: "SPIKES", spikCount: 5, minCost: 54 }]`, och texten "**Reglerna ryms inte i 100 kr.** 4 spikar, allgardering av avd 5 (12 hästar) och minst 3 hästar i de 3 andra loppen ger minst 324 rader, alltså 162,00 kr. Ingen ny rad föreslås förrän det ryms."
6. **Bjerke 5 spikar:** spikarna `[2,8,6,7]`, Blizzard Diamant spik, `minRows` 108.
7. **Bjerke, eget val avd 7 = [3,4,8,11,14] (A4):** rader 540, kostnad 270, avd 3 = `[5,9,13]`. `previewChangeText` innehåller "Avd 3 går från 4 till 3 hästar (1 Järvsö Elina tas bort) för att raden ska rymmas i **300 kr**."
8. **Bjerke, eget val avd 7 med 9 hästar:** status `OWN_OVER_BUDGET`, rader 972, kostnad 486, förslagen `[{ kind: "EDIT_LEG", leg: 7 }, { kind: "BUDGET", budget: 486 }]`, `canCopy` true.
9. **Bjerke, egen spik 7 Dreamliner Sund i avd 6 (A5):** `spikCount` 4, appens spikar `[2,8]`, favoriten spärrad i 1, 3 och 7, avd 3 = `[1,2,9,13]`, `favCount` 4.
10. **Över spärren av egna val:** egna spikar 2 i avd 2, 5 i avd 3, 7 i avd 6 och 1 i avd 8 (alla favoriter): `favCount` 5, `favOver` "OWN", status OK, och favoriten spärrad i 1 och 7.
11. **Spik hoppas över:** tre kandidater där den säkraste är favorit och kvoten är 0: den hoppas över och nästa tas, `skippedSpik` = den. Med fler spikar än icke-favoriter: varv 2 tar den och `favOver` = "SPIKES".
12. **Behållordningen:** tre öppna lopp med favoriter utan märken och kvot 0,5, 0,8 och 1,2, `Qopen` = 1: bara 1,2 får behålla. Har favoriten med kvot 0,5 Bet behålls den i stället.
13. **Struken häst (mockupens läge):** Bjerke med 11 Tangen Haap struken: avd 7 = `[3,4,5,14]`, Stoltheim Prinsen är T3, 5 Odd Herakles MEL, rader 576, och `scratchNotice` ger mockupens text med "5 Odd Herakles kom med i stället som Mellan".
14. **Struken egen spik:** Bjerke med 1 Baron Tilly struken: `struckOwnSpik` `[4]`, `canCopy` false, raden räknas med avd 4 som 1.
15. **Strukna i eget val:** låst `[3,8]` med 8 struken ger egen spik `[3]` och `struckRemoved` `[{ leg, numbers: [8] }]`. Låst `[3,8]` med båda strukna ger `unlockedLegs` `[leg]`, och appen fyller avdelningen.
16. **Ingen skräll** (`minimumPicks` direkt): 8 löpande med streck 36,0 / 15,0 / 11,0 / 9,4 / 8,0 / 7,2 / 6,9 / 6,5 (nr 2, 1, 3, 6, 4, 5, 7, 8) och riktX 1,60 / 2,40 / 2,80 / 2,60 / 3,50 / 4,00 / 4,50 / 3,00, där 2 är Spelbar och 6 har 4 signaler: valet `[2,6,8]`, och 8 har `[LOW, FEL]`.
17. **Få startande:** 2 löpande: båda valda, `few` true, inget fel. 1 löpande: 1 häst, räknas inte som spik.
18. **Inställt lopp:** typ CANCELLED, 1 häst (bäst rangad), inte spik, inte i `favCount`, aldrig allgardering.
19. **Lopp utan startande:** status `NO_STARTERS`, `canCopy` false.
20. **Preliminär:** inget streck i omgången: alla hästar har `PRE`, ingen `FEL`, favoriten = lägst riktX, grupperna efter modellens andel, och allgarderingen = lägst favoritandel.
21. **Riktodds saknas:** inga spikkandidater, `spikMax` = `ownSpikes`, och raden byggs på strecket.
22. **Mycket hög budget:** budget 100 000, radpris 0,50: alla hästar i öppna lopp, `allFit` true.
23. **Budget 0:** `RULES_DONT_FIT`, `maxRows` 0, förslaget att höja budgeten.
24. **V75:** sju avdelningar, `favLimit` 3, `spikMax` ≤ 6, `rowCount` över 7.
25. **Allgardering vald i låst avdelning:** behandlas som AUTO och `allgFallback` = "LOCKED".
26. **Motexemplet till den giriga regeln:** A `lo 3, hi 4`, B `lo 3, hi 12`, `R = 36`: `maximizeHorses` ger (3, 12).
27. **Lika antal och poäng:** den billigaste (minst produkt) väljs.
28. **`defaultSpikCount`:** Bjerke med 300 kr ger 4 (3 spikar ger 3 × 3 × 3 × 3 × 12 = 972 rader, 4 ger 324). Med 100 kr ger den 5. Ryms ingen: `spikMax`.
29. **Ordningsoberoende:** starterna i omvänd ordning ger samma resultat.

### Egenskaper (`lib/tippa.property.test.ts`)
Egen frögenerator (mulberry32, fröet `20261028`, inget nytt beroende). 1 000 omgångar, hälften V85 och hälften V75, 6–16 löpande per lopp, slumpat streck (summa 100), riktX 1,10–30, signaler 0–8, märken, 10 % strukna, 5 % inställda lopp, 0–2 låsta avdelningar med 1–4 hästar, `spikCount` 0–max, budget 0–2 000 kr och radpris 0,25, 0,50 eller 1,00. För varje omgång gäller:
1. Status OK ger `cost ≤ budget`.
2. Varje öppen avdelning med minst 4 löpande har en T3 (eller ersättaren), en MEL eller `NOMEL`, och en SKR eller `LOW`.
3. `favCount ≤ favLimit`, eller `favOver` är satt och de tvingade favoriterna `F0` är fler än gränsen.
4. Låsta avdelningar är oförändrade, utom strukna hästar enligt 6.5.3.
5. Ingen struken häst är vald i en avdelning som appen fyller.
6. Antal spikavdelningar (appens och egna) = `spikEffective`.
7. Allgarderingen ligger aldrig i en låst eller inställd avdelning.
8. **Lokalt maximal:** ingen öppen avdelning kan få nästa häst i `A(L)` utan att budgeten spricker.
9. **Optimal:** för de 300 första omgångarna med högst 3 öppna lopp och högst 8 löpande jämförs totala antalet hästar med en uttömmande sökning över alla k.
10. Samma indata två gånger ger samma resultat, och starterna i omvänd ordning ger samma resultat.

**Prestanda:** 7 öppna lopp med 16 löpande, budget 100 000 kr, radpris 0,01: `buildRad` klar på under 1 s i vitest. Typfallet (Bjerke) i snitt under 5 ms över 100 körningar. Antalet tillstånd skrivs ut och förs in i kommentaren i `lib/tippa.ts`.

### Övriga tester
- `lib/tippa-text.test.ts`: alla texter i Regler, korten, banderollerna och förhandsvisningen med Bjerke-fixturen, i V85 och V75 ("högst **3 lopp på V75**", "Antalet spikar ska vara 0–6 på V75.").
- `lib/coupon.test.ts`: `couponText` med `allgLeg` 5 ger "Avd 5: alla (1–12)" och med struken 7 "Avd 5: alla (1–12, utom 7)". Mockupens hela text för Bjerke. `parseCouponBody` godtar de nya fälten, avvisar okänd `allgMode`, `spikCount` 9 och `legRoles` med okänd kod, och lämnar saknade fält som `undefined`. Testerna för `suggestCoupon` och `suggestionOrder` tas bort.
- `lib/coupon-ui.test.ts`: `tippaLegs` ger riktX med X-faktor, signalerna och Bet. `couponBody` tar med de nya fälten. Testerna för `stepLeg` tas bort.
- `lib/e2.db.test.ts` (testdatabasen): PUT med `spikCount`, `allgMode`, `legRoles` och `copiedAt` sparas och läses tillbaka. En äldre kropp utan fälten lämnar dem orörda. CHOSEN med låst `allgLeg` ger 400. `spikCount` under egna spikar ger 400. `legRoles` för en startad avdelning skrivs inte över.
- `lib/round-overlay.test.ts`: `couponDtoOf` tar med de nya fälten och faller tillbaka på cachen.
- `lib/migration-check.test.ts`: den nya migreringen godkänns utan ändringar i kontrollen.

## 15. Acceptanskriterier E6

- [ ] Fliken V85-rad visar budgetrutan, Regler för raden och ett kort per avdelning i mobil (390 px), och två kolumner på desktop (1280 px) som egen flik.
- [ ] Med Bjerke-fixturen blir raden exakt mockupens: 576 rader, 288,00 kr, appens spikar i avd 2, 8 och 6 och egen i 4, allgardering i avd 5, och favoriten bortvald i avd 1 och 7.
- [ ] Varje vald häst visar sina skäl som ord: Topp 3, Mellan, Skräll, Felstreckad, signaler och Favorit. Varje spik och allgardering har sin varför-rad, och spärrade favoriter har spärrraden.
- [ ] Raden räknas om direkt vid ändrad budget, spikar, egen spik, allgardering eller avdelning, och vid nytt streck, strykning eller ändrad markering. Låsta avdelningar rörs aldrig.
- [ ] Raden ryms alltid i budgeten när status är OK. Ryms reglerna inte visas ingen ny rad, utan "Behövs minst …" och knapparna Höj till och N spikar.
- [ ] Eget val som inte ryms visas över budget med Ändra avd och Höj till, utan att något blockeras.
- [ ] Favoritspärren håller 4 på V85 och 3 på V75. Spelbar- och Bet-favoriter behålls först. Över spärren av egna val visas utan blockering.
- [ ] Ändra-arket låser avdelningen, förhandsrutan visar resultatet och ändringen i andra avdelningar, och Klar, Esc och × sparar.
- [ ] Välj egen spik låser avdelningen med en häst, och arket säger vad som händer med spärren och allgarderingen.
- [ ] Kopiera till ATG visar kupongbilden. Kopiera texten ger mockupens text med "Avd 5: alla (1–12)" och toasten. Ändras raden efteråt visas banderollen.
- [ ] Struken häst ersätts automatiskt med banderollen. Struken egen spik ger felet med Välj ny spik och Låt appen välja, och Kopiera är avstängd.
- [ ] Preliminär rad före strecket, med Prel. på hästarna och banderollen.
- [ ] Gamla rader visas som de är tills Räkna om med reglerna eller en regeländring.
- [ ] Efter spelstopp är raden låst och visar skälen ur `legRoles`.
- [ ] V75 ger sju avdelningar, spärr 3, högst 6 spikar och "V75" i alla texter.
- [ ] Migreringen är additiv och `npm run check:migration` är grön.
- [ ] Tillgänglighet: en live-region för summan, taggar och rutor bärs av ord, arken fångar och ger tillbaka fokus, flikar och radioknappar fungerar med piltangenter, och tryckytorna är minst 44 px.
- [ ] Förhandsvisning i 390 och 1280 px, ljust och mörkt: A1–A6, desktop och lägena i mockupens Lägen (budget för låg, ingen skräll, strecket saknas, struken häst, struken egen spik, startat, eget val ryms inte, offline, kopierad).
- [ ] vitest täcker funktionerna i 13 med testfallen i 14, inklusive egenskaperna och prestandatestet.

## 16. Utanför E6

- Efteranalysen av raden ("Skrällarna gav 1 av 3"). Datan (`legRoles`, `copiedSelections`) sparas för den.
- Att stänga av allgarderingen (`NONE`).
- Spärren och spiktaket som inställningar.
- Att ladda upp raden till ATG. Se `docs/specs/e7-atg-fil.md`: appen skapar en ATG-fil och Mikael laddar upp den själv.
- B som huvudvy (kupongtavlan med utfällbar förklaring).

## 17. Beslut (Claudes, Mikael kan ändra)

1. **Exakt optimering i stället för girig.** "Lägg till där kostnaden ökar minst" ger fel svar när ett lopp har få hästar (exemplet i 6.5.8). Dynamisk programmering över produkten ger garanterat flest hästar, och poängen avgör vid lika. I Bjerke-exemplet ger båda 11 hästar i de öppna loppen, och poängen väljer mockupens 576 rader före 540.
2. **Spikar före spärren.** En spik som är favorit tar en plats i spärren före de öppna loppen. Är spärren full hoppas loppet över, och nästa säkraste blir spik. Räcker inte loppen tas favoritspikarna ändå, och det visas som "över spärren".
3. **Felstreckad och modellens andel räknas med riktX** (med X-faktor), som rangpoängen och spikvalet, så att alla tre bygger på samma tal.
4. **Spärrens kvot fördelas före budgeten.** En tillåten favorit som inte kommer med lämnar platsen oanvänd i stället för att flytta den. Det gör spärrraden lätt att förklara ("modellen tror minst på den").
5. **Inställt lopp får 1 häst**, eftersom ATG räknar alla hästar som vinnare. Det räknas inte som spik eller i spärren.
6. **Standardantalet spikar** för en ny rad är det minsta som ryms i budgeten, alltså den bredaste raden som går.
7. **Gamla rader räknas inte om automatiskt.** De kan ha spelats.
8. **Kopieringen sparas** (`copiedAt`, `copiedSelections`) så att appen kan säga när raden har ändrats efter kopieringen. Det fanns inte i mockupen, men utan det kan strecket på lördagen ändra en rad som redan är spelad utan att Mikael märker det.
9. **Arket Spela hos ATG kopierar inte vid öppning.** Knappen Kopiera texten gör det, som i mockupskärm A6. Desktoptexten under knappen blir därför "Visar kupongbilden och texten att kopiera" i stället för mockupens "Kopierar texten och visar kupongbilden".
10. **"Höj till" avrundar till hel krona** i båda fallen (162 kr och 486 kr). Mockupen visade 490 i ett av fallen.
11. **Ingen NONE i AllgMode**, eftersom ingen kan välja det än.

## 18. Öppna frågor och risker

**Frågor till Mikael (stoppar inte bygget)**
1. Räcker `https://www.atg.se/spel/V85` för Öppna ATG, eller vill du ha en länk direkt till omgången?
2. Inställt lopp: stämmer det att ATG räknar alla hästar som vinnare i V85 (Beslut 5)? Annars ska loppet behandlas som en spik.
3. Ska kopieringen räknas som "spelad rad" i statistiken senare, eller ska det vara ett eget val "Jag har spelat raden"?

**Risker**
1. **Raden ändras av strecket.** På lördagen kan nytt streck flytta en häst mellan Topp 3 och Mellan, eller byta favorit, och raden ändras. Banderollen efter kopiering fångar det, men Mikael måste läsa den.
2. **Prestanda vid extrema radpriser.** Med radpris 0,01 och mycket hög budget blir tillstånden många. Prestandatestet sätter taket. Blir det för långsamt används snabbvägen "allt ryms" oftare genom att `R` kapas vid `Π hi(L)` (redan i specen), och annars rapporterar byggaren det innan resten byggs.
3. **Små skillnader i riktodds avgör spikar.** Spikordningen följer riktX med två decimaler. Lika värden avgörs av poängen och sedan avdelningsnumret, vilket kan se godtyckligt ut. Varför-raden visar talen.
4. **Skälen tar plats.** Med fem taggar bryts `.rsn` på två rader och raden blir högre än 52 px. Det är tillåtet, men listan blir längre i mobilen (mockupen räknade med ungefär 3 skärmar).

## 19. Filer

**Skapas**
- `prisma/migrations/<tid>_e6_v85_rad/migration.sql`
- `lib/tippa.ts`, `lib/tippa.test.ts`, `lib/tippa.fixture.ts`, `lib/tippa.property.test.ts`
- `lib/tippa-text.ts`, `lib/tippa-text.test.ts`
- `components/spel/RadRules.tsx` (`RadRules`)
- `components/spel/RadLegCard.tsx` (`RadLegCard`, `ReasonTags`)
- `components/spel/RadSheets.tsx` (`RadLegSheet`, `RadSpikSheet`, `RadAllgSheet`, `RadAtgSheet`)
- `components/spel/Kupong.tsx` (`Kupong`)
- `components/spel/RadActionBar.tsx`

**Ändras**
- `prisma/schema.prisma` (`AllgMode`, nya fält i `Coupon`)
- `lib/game-type.ts` (`SPIK_MAX`, `FAV_LIMIT`, `spikMaxFor`, `favLimitFor`)
- `lib/coupon.ts` (`couponText`, `parseCouponBody`, `asLegRoles`. `suggestCoupon`, `suggestionOrder`, `favoriteStreck` tas bort) och `lib/coupon.test.ts`
- `lib/coupon-ui.ts` (`tippaLegs` ersätter `couponLegs`, `couponBody`. `stepLeg`, `legMax` tas bort) och `lib/coupon-ui.test.ts`
- `lib/e2-server.ts` (`saveCoupon`, `getCoupon`), `lib/dto.ts` (`couponDto`), `lib/types.ts` (`CouponDto`, `LegRolesDto`, `ReasonCode`), `app/api/rounds/[id]/coupon/route.ts` (`readJson` 16 000)
- `lib/round-overlay.ts` (`CouponBody`, `couponDtoOf`) och `lib/round-overlay.test.ts`
- `lib/phase.ts` (texterna i `BUILD_COUPON`) och `lib/phase.test.ts` vid behov
- `lib/e2.db.test.ts`
- `components/spel/RadPanel.tsx` (byggs om: tillstånd, sparning, banderoller, desktoplayouten. `LegRow`, `LegSheet` och knappen Föreslå inom budget tas bort)
- `components/spel/Spelforslag.tsx` (tre flikar på desktop, `.dcols` bort)
- `styles/app.css`: `.rules`, `.rl`, `.rv`, `.osp`, `.favs`, `.lg`, `.lg-h`, `.lg-t`, `.lg-e`, `.lr`, `.lhl`, `.lh`, `.lm`, `.rsn`, `.lst`, `.lg-w`, `.lg-x`, `.allgn`, `.rs` med varianterna, `.actbar`, `.ab`, `.prev`, `.hc2`, `.hcm`, `.kup`, `.kst`, `.kg`, `.kh`, `.kc` (ny `.kc.scr`), `.kleg`, `.drad`, `.dact`, `.lgg`, `.avd`, `.avd-t`, `.tick`, med värdena från mockupen. `.vrow`, `.vpick`, `.vlist2`, `.vfoot` och `.dcols` tas bort om inget annat använder dem
- `docs/DESIGN.md` (Spelförslaget: tre flikar på desktop, V85-raden i två kolumner 380 px · 1fr, nya komponenter `RadLegCard`, `Kupong` och skälstaggen `.rs`)
- `docs/specs/spelvarde.md` (etapptabellen får raden E6 som pekar hit, och S6b och 6.5 får en hänvisning hit)

## Mikaels svar 2026-10-28
1. Öppna ATG: länken `atg.se/spel/V85` räcker.
2. Inställda V85-lopp händer i praktiken aldrig – behåll specens enkla hantering, ingen extra logik.
3. En kopierad rad räknas **inte** som spelad i statistiken eller efteranalysen. `copiedAt`/`copiedSelections` används bara för banderollen om att raden ändrats efter kopieringen.
4. **Bara allgarderingen har alla hästar.** Ett öppet lopp som appen fyller får högst hälften av de löpande (`floor(n/2)`, `OPEN_SHARE_MAX` i `lib/tippa.ts`), men aldrig färre än minsta valet. Dina egna val (låsta avdelningar) begränsas inte. Allgarderingen väljs automatiskt (Auto) eller av dig (Välj avd), som förut.

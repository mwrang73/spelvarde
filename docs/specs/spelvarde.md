# Spelvärde – spec

Status: godkänd för bygge, typen är **Omfattande**. Gäller hela appen och är uppdelad i fem etapper. Etapp 1 byggs först. Tillägget **X-faktor** (E2.1, 6.8) beslutades 2026-10-19 och byggs utan mockup, på Mikaels beslut.

**Underlag**
- Mikaels spec `BettingBBW/bettingbbw.docx` och hans beslut efter flödesmockupen (2026-10-19).
- Designsystemet: `docs/DESIGN.md`.
- Mockups: `spelvarde-flode-mockup.html` (flöde och skärmar) och `v85-tema-mockup.html` (komponentark, riktning B). De ska kopieras till `docs/mockups/`, se DESIGN.md. Skärmnumren nedan (S1–S10) följer flödesmockupen.
- Teknisk förlaga: `tabellgissningen-app`.
  - Next.js 14 med App Router, TypeScript, Prisma mot Postgres i Supabase och vitest.
  - Egen inloggning under `app/api/auth` med `lib/jwt.ts`, `lib/session.ts`, `lib/auth.ts` och `middleware.ts`.
  - Vercel-crons i `vercel.json` skyddade av `CRON_SECRET`.
  - Pollningen i `components/round/useRoundLive.ts` och synken med "claim" i `lib/shl-sync.ts`.

**Etapper.** Varje avsnitt är märkt **[E1]**–**[E5]**.

| Etapp | Innehåll |
|---|---|
| E1 | Grund: projekt, inloggning, datamodell, Hämta omgång, Omgången, Avdelningen, hästkortet (5 senaste, galopp), Intressant, egna kommentarer, avdelningens statistik från ATG och travstatistik.se |
| E2 | Riktodds v1, Unibet-odds (knappsats 4B), Spelbar, Bet, Spelförslag (platsspel och V85-rad) |
| E2.1 | X-faktor: Mikaels egen krydda som sänker riktoddset, källstöd i hästkortet och faktorerna i Inställningar (6.8) |
| E2.2 | Hämta streck och odds: en knapp för ATG:s streck och Unibets odds för alla hästar, ögonblicksbilder, grön markering av spelbara odds och toleransen för "nära". Spec: `e2.2-hamta-streck-och-odds.md` (gäller före denna fil där de skiljer sig) |
| E3 | Fredagens utgångsläge (cron), lördag live, larm |
| E4 | Under loppet (snabbkommentarer), automatisk placering, Omgången klar, Statistik |
| E5 | Källor och Hämta tips med Claude-API:t (sidan och datamodellen byggs i E1, läsningen i E5) |

---

## 1. Mål och användare
**Användaren** är Mikael ensam, som inloggad användare med rollen ADMIN. Datamodellen ska ändå klara fler användare senare. Det som är hans eget hör till en användare, och omgångar, lopp, hästar och starter är gemensamma. Inga flerspelarfunktioner syns i gränssnittet.

**Mål:** varje vecka hitta hästar i V85 som har chans till topp tre men ändå ger **mer än två gånger pengarna** i platsodds hos Unibet. Appen gör grovjobbet: hämtar startlistan, sammanställer statistik, räknar riktodds, följer strecket och hämtar resultat. Mikael gör bedömningen och fattar alla beslut. Appen spelar aldrig själv och hanterar inga pengar.

## 2. Begrepp
| Begrepp | Betydelse |
|---|---|
| **Omgång** | En V85-omgång, alltså ett ATG-spel `V85_<datum>_<banId>_<n>` med 8 avdelningar. |
| **Avdelning (avd)** | Ett av de 8 loppen i V85, numrerade 1–8 i V85-ordning. |
| **Start** | En häst i en avdelning med startnummer, kusk, tränare och eventuellt resultat. |
| **Intressant (I)** | Mikaels markering av en häst han tror på. Kan sättas på flera hästar per avdelning. |
| **Riktodds** | Appens uträknade "rättvisa" odds för **plats** (topp 3): `1 / sannolikhet för topp 3`. Lågt riktodds betyder stor chans. |
| **X-faktor (X)** | Mikaels egen krydda: känsla, och att flera källor pekar ut samma häst. Tre lägen per häst: **Ingen**, **Tror på** (÷1,25) och **Stark känsla** (÷1,50). Faktorerna går att ändra i S10. Appen sätter aldrig X-faktorn själv. Se 6.8. |
| **Riktodds med X-faktor** | `max(1,01, round2(riktodds / faktor))`. Är X-faktorn Ingen är det samma som riktoddset. Det är det här värdet som Spelbar räknas mot. |
| **Källstöd** | "n av m källor pekar ut hästen", där m är antal påslagna källor i Källor och n fylls i av Mikael (från E5 kan Hämta tips föreslå n). Bara information, påverkar inget. |
| **Unibet-odds** | Unibets fasta platsodds som Mikael själv för in. |
| **Spelbar (S)** | Appen föreslår Spelbar när hästen är Intressant och Unibet-oddset är **högre** än riktoddset med X-faktor. Mikael kan alltid ta bort flaggan eller sätta den själv. |
| **Riktlinje 2,00** | Unibet-odds under 2,00 får en informativ tagg. Ingenting blockeras. |
| **Bet (B)** | Mikael markerar att han har spelat hästen på plats hos Unibet, med oddset han fick. Kan sättas när som helst fram till loppets start. |
| **Streck** | Andel av V85-insatsen på hästen i procent (ATG `betDistribution`). |
| **pe** | Procentenheter. Rörelse i streck räknas som "streck nu − utgångsläget" (till exempel 5,0 % → 17,0 % = +12,0 pe). |
| **Utgångsläge** | Streck sparat fredag kväll, som rörelsen räknas från. |
| **Rusning / Tappar** | Larm i appen: en omarkerad häst stiger mer än gränsen, eller en egen häst (I, S eller B) sjunker mer än gränsen. Gränsen är 10 pe och går att ställa in. |
| **Galoppvarning (G / GD)** | Galopp i någon av de 5 senaste starterna (G). Galopp som gav diskning visas starkare (GD). |
| **Träff / miss** | För Bet: placering 1–3 är träff, allt annat är miss. Samma mått används för I och S i statistiken (topp 3). |
| **Fas** | Veckans läge: Analys, Odds, Live eller Klart (se 3.1). |

## 3. Veckoflödet
1. **Söndag kväll eller senare:** Mikael trycker på **Hämta omgång** (S1). Appen hittar nästa V85, hämtar startlista, hästarnas senaste starter och statistik och räknar riktodds (från E2). Ett nytt tryck på **Hämta igen** uppdaterar strykningar, kuskbyten och streck. Mikaels markeringar, odds och kommentarer finns kvar.
2. **Måndag–torsdag (Analys):** han går igenom en avdelning i taget (S2), öppnar hästkort (S3), tänder **Intressant** och skriver kommentarer. Känns en häst extra stark sätter han **X-faktor** och fyller i källstödet i hästkortet (E2.1). En avdelning räknas som genomgången när den har minst en Intressant eller när han har tryckt **Inga intressanta här**.
3. **Torsdag kväll (Odds):** han för in Unibets platsodds med knappsatsen (S4). X-faktorn kan ändras i samma vy utan att flödet bryts. Spelbar sätts direkt som förslag. När alla odds är ifyllda visas en lätt sammanfattning där han kan ta bort förslag.
4. **Fredag kväll:** ett cron-jobb sparar streck som **utgångsläge** (E3). Mikael gör ingenting.
5. **Lördag från 12:00 (Live):** med appen öppen uppdateras strecket var femte minut (S5). Larm visas i appen.
6. **Lördag före start:** i Spelförslag (S6) markerar han **Bet** på platsspelen, rättar oddset om det har ändrats och bygger **V85-raden** inom sin budget. Raden kopieras och spelas hos ATG.
7. **Under loppen:** snabbkommentarer i S7 utan väntan mellan hästar.
8. **Efter varje lopp:** placeringen hämtas automatiskt. Bet visar träff eller miss. När alla 8 lopp har resultat är omgången **Klar** och syns i Statistik (S9).

### 3.1 Faser [E1]
Fasen räknas i Europe/Stockholm. `D` är omgångens datum (lördag).

| Fas | Gäller när | Primär handling i Nästa steg |
|---|---|---|
| **Analys** | Från hämtning till `D−2 18:00` | Nästa avdelning som inte är genomgången |
| **Odds** | `D−2 18:00` till `D 12:00` | "Fyll i Unibets odds (n kvar)", därefter "Markera Bet" och "Bygg V85-raden" |
| **Live** | `D 12:00`, eller tidigare om något lopp har startat, tills alla 8 lopp har resultat | Larm som inte är kvitterade, annars "Avd n startar hh:mm" som leder till Under loppet |
| **Klart** | Alla 8 lopp har resultat, eller alla startade lopp har resultat och resten är inställda | "Se statistik", och "Hämta nästa omgång" när nästa V85 finns |

Faserna styr bara vad som föreslås. Alla vyer går alltid att öppna via fasraden. Allt som rör en start (I, S, B, X-faktor, källstöd, odds) låses vid **loppets starttid**. Kommentarer går att skriva även efter start.

### 3.2 Nästa steg [E1, utökas i E2–E4]
Bara **ett** kort visas. Välj det första som stämmer i listan:
1. Ingen omgång eller nästa V85 finns men är inte hämtad: "Hämta omgång – V85 <bana> <dag datum>".
2. Hämtningen är ofullständig (något steg misslyckades): "Slutför hämtningen" (fortsätter där det tog stopp).
3. Fas Live och olarmade larm finns: "Rusning i avd n – <häst>" eller "Tappar …".
4. Fas Live: nästa lopp som inte har startat, "Avd n startar hh:mm", som leder till S7.
5. Fas Odds och Intressant utan Unibet-odds: "Fyll i Unibets odds – n kvar" (S4).
6. Fas Odds och Spelbar utan Bet: "Markera Bet – n spelbara" (S6a).
7. Fas Odds och ingen V85-rad sparad: "Bygg V85-raden" (S6b).
8. Fas Analys: "Analysera avd n – <loppnamn>" (första som inte är genomgången). Är alla genomgångna står "Allt genomgånget – odds fylls i torsdag kväll" utan primärknapp.
9. Fas Klart: "Se statistik", eller "Hämta omgång" om nästa V85 finns.

---

## 4. Sidor och navigation [E1]
Bottenmeny i mobilen och toppmeny på desktop har tre delar: **Omgång**, **Källor** och **Statistik**. Inställningar nås från ikonknappen ⚙ i Omgångs vyrubrik.

| Rutt | Skärm | Etapp |
|---|---|---|
| `/login` | Inloggning | E1 |
| `/` | S1 Omgången (aktuell omgång) | E1 |
| `/omgang/[roundId]` | S1 för en viss omgång (även äldre) | E1 |
| `/omgang/[roundId]/avd/[nr]` | S2 Avdelningen | E1 |
| `/omgang/[roundId]/avd/[nr]/hast/[startId]` | S3 Hästkortet (helsida i mobilen, sidopanel på desktop) | E1 |
| `/omgang/[roundId]/odds` | S4 Unibets platsodds | E2 |
| `/omgang/[roundId]/spel?flik=plats\|rad` | S6 Spelförslag | E2 |
| `/omgang/[roundId]/live?avd=n` | S5 Lördag live | E3 |
| `/omgang/[roundId]/lopp/[nr]` | S7 Under loppet och resultat | E4 |
| `/kallor` | S8 Källor | E1 (sidan), E5 (Hämta tips) |
| `/statistik` | S9 Statistik | E4 |
| `/installningar` | S10 Inställningar | E1 (tema), E2 (riktlinje, radpris, modell), E2.1 (X-faktorer), E3 (larmgräns) |

- Tillbaka-knappen i vyrubriken går till föräldern (Häst → Avdelning → Omgång), inte till webbläsarens historik.
- Avdelningsflikarna 1–8 i S2, S5 och S7 byter avdelning **utan att sidan laddas om**. All omgångsdata ligger i klientens cache (se 9), och URL:en uppdateras med `router.replace`.
- Är omgången äldre än den aktuella visas en tunn banderoll i S1: "Det här är en tidigare omgång. Till aktuell omgång".

---

## 5. Skärm för skärm
För varje skärm anges innehåll, lägen och interaktion. Utseendet följer mockupen.

### S1 Omgången [E1, utökas E2–E4]
**Innehåll, uppifrån och ned**
1. **Vyrubrik:** logga "SPELVÄRDE", underraden "V85 · <bana> · <dag datum> · <första start>" och ikonknapparna **Hämta igen** (↻, `aria-label` "Hämta omgången igen") och **Inställningar** (⚙).
2. **Fasrad:** `PhaseRail` med de fyra faserna och vald fas markerad. Varje ruta är en länk:
   - Analys leder till första avdelningen som inte är genomgången.
   - Odds leder till S4.
   - Live leder till S5.
   - Klart leder till S9.
3. **Nästa steg** enligt 3.2.
4. **Hämtstatus:** en rad med "Startlistan hämtad sön 21:14" och, om det finns, "Ändrat sedan förra hämtningen: 2 strykningar, 1 kuskbyte" (länk som visar listan i ett ark).
5. **Tips** (E5): "Tips: 18 fakta på 11 hästar · hämtat tis 21:14". Före E5 visas raden inte.
6. **Avdelningar:** 8 rader med startnummer i fällbladsruta, loppnamn, "start · distans startmetod · antal hästar" och räknarna I, S och B (S och B från E2). Ännu inte genomgången avdelning visar taggen "Ej genomgången". Hela raden är en länk till S2.
7. I fas Klart: summeringen "Bet 2/4 träff · Spelbar 3/6 topp 3 · Intressant 6/13 topp 3", "V85-raden: 6 rätt av 8" och per avdelning vinnaren och dina markeringars resultat (E4).
8. Längst ned: **Tidigare omgångar** (E4), de 10 senaste med datum, bana och Bet-träffar, och en länk till fler.

**Lägen**
| Läge | Visning |
|---|---|
| Ingen omgång hämtad | `EmptyState`: ikon, "Ingen omgång hämtad", "Hämta veckans V85 från ATG. Startlistan brukar finnas från söndag kväll." och primärknappen **Hämta omgång**. |
| Ingen V85 hittad | Banderoll `info`: "ATG har ingen V85 de närmaste 7 dagarna än. Försök igen senare." Knappen Hämta omgång finns kvar. |
| Hämtar | Knappen visar "Hämtar …" och är avstängd. En stegrad visas med "Startlista ✓ · Avd 3 av 8 … · Statistik · Riktodds", `aria-live="polite"`. |
| Hämtningen delvis klar | Banderoll `warn`: "Hämtningen stannade vid avd 5: ATG svarade inte. Det som redan hämtats är sparat." och **Försök igen**, som fortsätter från steget som misslyckades. |
| Fel vid hämtning | Banderoll `err`: "Kunde inte nå ATG. Kontrollera uppkopplingen och försök igen." |
| Laddar vyn | Skelett för fasraden och för 8 rader. |
| Offline | Banderoll `warn` med "Ingen uppkoppling. Du ser senast sparade läge." Hämta-knapparna är avstängda. |
| Ny V85 finns medan nuvarande är klar | Nästa steg visar "Hämta omgång – V85 <bana> <datum>". |

### S2 Avdelningen [E1, kolumnen riktodds från E2, X-faktor från E2.1]
**Innehåll**
1. **Vyrubrik:** "Avd 7 · 17:13" och underraden med loppnamnet.
2. **Avdelningsflikar** 1–8. Fliken för en genomgången avdelning har en liten bock under siffran, och fliken med olarmat larm har en röd prick (E3).
3. **Loppremsa:**
   - Chips för distans ("2640 m"), startmetod (Auto/Volte), klass ("Gr. II Int.") och "1:a pris 400 000 kr" (bara på desktop), samt knappen **Loppstatistik ›**.
   - Statistikraden med de tre viktigaste värdena: vinst % för hästarnas bästa spår på distansen och startmetoden, spår 1, och "Favorit vinner 54,5 %".
4. **Kolumnrubrik:** "Nr · Häst · kusk · Form · Rikt · Intr." I E1 visas Rikt som "–".
5. **Täta rader** (44 px), en per start i startnummerordning, med:
   - startnummer
   - namn med märkena G/GD och, från E2, S och B, och från E2.1 X-märket (6.8)
   - kusk, där kuskbyte visas som "↻ Ny: <kusk>" i `--accent`
   - formen för de 5 senaste
   - riktodds, från E2.1 **riktodds med X-faktor** när hästen har X (visning i 6.8)
   - lampan Intressant.
6. **Längst ned:** knappen **Inga intressanta här**. Den visas bara om ingen häst i avdelningen är Intressant och avdelningen inte redan är markerad som genomgången. Efter tryck står "Genomgången · Ångra".

**Interaktion**
- Ett tryck på en rad (namnytan) öppnar S3. Lampan är en egen knapp som inte öppnar hästkortet.
- Lampan sparas optimistiskt (se 9.3). Efter loppets start är lampan avstängd med `aria-disabled` och tooltipen "Loppet har startat".
- Avdelningsflikar: tryck eller piltangenterna ←/→ byter avdelning direkt från cachen. På mobil går det också att svepa vågrätt på listan (tröskel 60 px, vågrät rörelse ska dominera).
- **Loppstatistik** öppnar S2b.
- X-faktorn sätts inte i mobilens rad (ingen plats för ett reglage till). Den sätts i hästkortet, i S4 och med tangenten **X** på desktop.

**Lägen**
- **Laddar:** skelettrader (12 st).
- **Struken häst:** raden är grå, namnet genomstruket, taggen "Struken" visas och lampan är avstängd. Raden ligger kvar på sin plats.
- **Färre än 5 starter:** tomma formrutor och riktoddset märks "osäkert" med en asterisk och förklaring i hästkortet.
- **15 hästar:** listan skrollar. Vyrubrik, flikar, remsa och kolumnrubrik ligger fast (`position: sticky`).
- **Saknad statistik från travstatistik.se:** statistikraden visar "Statistik saknas just nu" och "Hämta igen".
- **Fel vid sparning:** lampan går tillbaka till tidigare läge och en toast visar "Kunde inte spara Intressant för <häst>. Försöker igen." Ändringen ligger i kön (9.3).

**Desktop:** tre kolumner.
- Vänster: avdelningslista med fasrad och räknare I/S/B per avdelning.
- Mitten: loppremsa på tavlan med fyra statistikrutor, och sedan en tabell med kolumnerna Nr, Häst (namn, ålder, kön, rekord, märken), Kusk/tränare, Form, Vinst %, Plats %, Spår %, Rikt och Intressant. Rikt visar två rader när hästen har X (6.8).
- Höger: hästkortet S3 för vald rad. Klick på en rad byter häst i panelen utan att sidan laddas om.
- Tangentbord: ↑/↓ flyttar vald rad, Enter öppnar hästkortet, **I** växlar Intressant och **X** stegar X-faktorn (Ingen → Tror på → Stark känsla → Ingen) på vald rad.

### S2b Loppstatistik [E1]
Bottenark i mobilen och en utfällbar panel under loppremsan på desktop. Innehåll:
- **Vinst % per startnummer** för loppets distansgrupp och startmetod, som staplar 1–15. Segmentet "Alla banor | <bana>" byter urval. Hästarnas egna spår är markerade.
- **Favoriter:** "Mest streckade vinner X % av V85-loppen" och topp 3-andel om källan har den.
- **Kuskform** och **tränarform** för loppets kuskar och tränare: vinst % i år från ATG och plats i V85-ligan från travstatistik.se. Kuskar som inte gick att matcha visas med sitt förkortade namn och taggen "ej kopplad".
- **Källa och tid** för varje block ("travstatistik.se · hämtat sön 21:15").
- **Lägen:** "Ingen statistik för den här distansen" och, om hämtningen misslyckades, "Kunde inte hämta statistiken" med Försök igen.

### S3 Hästkortet [E1, riktodds E2, X-faktor E2.1, tips E5]
**Innehåll, uppifrån och ned**
1. **Tavelhuvud** med startnummer (stort), namn, "ålder kön · rekord" och "kusk · tr tränare".
2. **Galoppvarning**, om den gäller: "Galopp i 1 av 5 senaste starterna, 13 sep på Åby". För GD står i stället "Galopp med diskning 13 sep på Åby", med starkare ram.
3. **Handlingar:** `LampToggle labeled` (Intressant), `SpelbarToggle` (E2) och `BetToggle labeled` (E2). Har Spelbar ändrats för hand står det i underraden, till exempel "Satt av dig".
4. **X-faktor och källstöd** (E2.1): blocket `XFactorBlock` enligt 6.8, direkt under handlingarna så att effekten syns i riktoddsrutan strax under.
5. **Riktodds plats** (E2): `RiktoddsBox` med riktodds, Unibet-odds om det finns och en mening om läget:
   - "Spelbar: Unibet ger 0,90 mer än riktoddset"
   - "Inte spelbar: Unibet ger 0,10 mindre än riktoddset"
   - "Fyll i Unibet-odds för att se om hästen är spelbar"
   - Under 2,00 läggs riktlinjetaggen till: "Under 2,00".
   - Med X-faktor (E2.1) visar rutan båda värdena och meningen jämför mot riktoddset med X-faktor, se 6.8.

   Under rutan kommer `WhyList` med högst 3 rader "Talar för" och 3 rader "Talar emot" (se 7.4) och beräkningsraden: "Chans till topp 3 ≈ 31 % → 1 / 0,31 = 3,20". Med X-faktor förlängs raden med X-steget (6.8). Är riktoddset osäkert står det överst: "Osäkert: färre än 5 starter".
6. **Statistik:** vinst % och plats % i år och i fjol, spår % på distansen, kuskens och tränarens form.
7. **5 senaste starter:** tabell med Datum, Bana, Distans och startmetod, Spår, Placering och Km-tid. Galopp ger röd rad och plaketten "g", och diskning "d". Länken "Visa fler" visar de 10 senaste.
8. **Fakta från tips** (E5): lista med källa och tid. Före E5 visas inte blocket.
9. **Mina kommentarer:** alla Mikaels kommentarer om hästen från tidigare och aktuell omgång, nyast först, med datum, omgång, avdelning, resultat, snabbvalstaggar och text. Varje kommentar kan redigeras och tas bort (med Ångra).
10. **Ny kommentar:** textfält med etiketten "Kommentar inför loppet". Kommentaren sparas med knappen Spara eller automatiskt 1 s efter att Mikael slutat skriva, och följer hästen.

**Lägen:** laddar (skelett per block) och "Senaste starter kunde inte hämtas" med Försök igen. En häst helt utan tidigare starter visar "Debuterar". En struken häst visar banderollen "Struken <tid>". Efter start är handlingarna, X-faktorn och källstödet låsta och det står "Loppet har startat. Intressant, Spelbar, Bet, X-faktor och källstöd är låsta."

### S4 Unibets platsodds [E2, X-faktor E2.1]
**Beslut: 4B, egen knappsats, en häst i taget.**

**Kö:** alla Intressant och alla med Bet i omgången, i avdelnings- och startnummerordning. Hästar som redan har odds ligger sist, så att en ny körning börjar med det som saknas. Struken häst och lopp som har startat hoppas över. (En häst med X-faktor är alltid Intressant, 6.8, och kommer därför med.)

**Innehåll**
- Vyrubrik "Unibets platsodds" med underraden "Häst 9 av 13", och en förloppslist.
- Hästkort: startnummer, namn, avdelning, starttid och kusk. Till höger i kortet knappen **X-faktor** (`XCycleButton`, 6.8) från E2.1.
- Två tavelrutor: **Riktodds** och **Unibet plats** (LED-display). Med X-faktor visar riktoddsrutan riktoddset med X-faktor stort och det vanliga under, se 6.8.
- Resultatrad: "0,70 över riktoddset · föreslås som Spelbar", "0,10 under riktoddset · inte spelbar" eller "Under 2,00 (riktlinje)". Med X-faktor jämförs mot riktoddset med X-faktor och det står "riktoddset med X" i stället för "riktoddset".
- Knapparna **‹ Föregående** och **Hoppa över**.
- Knappsatsen: 1–9, Radera, 0 och **Nästa ›**.

**Inmatningsregler**
- Siffrorna tolkas med två decimaler: 3-1-0 blir 3,10, 1-2-5-0 blir 12,50, och 2 blir 0,02 tills fler siffror kommer. Högst 4 siffror. Godkänt intervall är 1,01–99,99.
- Vid **tre siffror** och ett odds på 1,01–9,99 sparas oddset och appen går vidare till nästa häst efter 350 ms. Under den tiden syns resultatraden, och ett nytt tryck avbryter övergången. Med fyra siffror krävs Nästa.
- Radera tar bort en siffra. Radera på en tom display tar bort sparat odds efter frågan "Ta bort oddset för <häst>?" (Ja/Avbryt).
- På desktop: siffertangenterna, Backsteg, Enter (= Nästa), ← (Föregående), Tab (Hoppa över) och **X** (stegar X-faktorn, E2.1). Komma och punkt ignoreras, så "3,10" och "310" ger samma resultat.
- Varje odds sparas direkt och optimistiskt (9.3). Spelbar räknas om direkt (6.1).
- **X-faktorn och 350 ms-hoppet (E2.1):** X-knappen påverkar inte siffrorna. Trycks den innan siffrorna skrivs gäller den bara för hästen och flödet är oförändrat. Trycks den under 350 ms-fönstret räknas det som ett nytt tryck: hoppet avbryts, oddset står kvar sparat, resultatraden räknas om med den nya X-faktorn, och Mikael går vidare med **Nästa**. Trycks den inte alls är flödet exakt som förut.

**Avslut: sammanfattning i stället för 4C.** När kön är slut öppnas ett ark "Klart – 13 odds ifyllda" med listorna "Spelbara (6)" och "Inte spelbara (7)". Varje rad har Unibet, riktodds och skillnad. Med X-faktor visas X-märket efter namnet och riktoddset i kort form, "rikt 3,00 → X 2,40", och skillnaden räknas mot riktoddset med X-faktor (6.8). På de spelbara finns knappen **Ta bort Spelbar** och på de övriga **Gör spelbar**. Arkets enda primärknapp är **Klar**. Arket är ingen bekräftelse: förslagen gäller redan, och arket går att stänga direkt.
- **Varför:** Mikael vill att förslaget sätts och att han avmarkerar. En tvingande granskningsskärm vore ett extra steg varje torsdag. En sammanfattning direkt efter inmatningen ger ändå överblick när han har siffrorna i huvudet.
- Samma ändringar kan göras senare i Spelförslag och i hästkortet.

**Lägen:** inga Intressant ger `EmptyState` med "Inga intressanta hästar än. Markera Intressant i avdelningarna först." och länken "Till avd 1". Riktodds saknas ger "Riktodds saknas – hämta omgången igen", och oddset sparas ändå. Offline ger "Sparas när du är uppkopplad igen" med antal i kö.

### S5 Lördag live [E3]
**Innehåll**
- **Vyrubrik:** pulserande prick, "Lördag live" och underraden "Uppdaterad 14:05 · nästa 14:10". Ikonknappen **Uppdatera nu** kan användas högst en gång per 60 s och är annars avstängd med "Nyss uppdaterad".
- **Avdelningsflikar** med röd prick för avdelningar som har olarmade larm.
- **Larm** för vald avdelning, ett `AlarmCard` per larm:
  - Rusning: "<nr> <häst> har rusat +12,0 pe sedan fredag (5,0 → 17,0 %). Du har inte markerat hästen."
  - Tappar: "<nr> <häst> (Spelbar) har tappat −10,4 pe sedan fredag (18,0 → 7,6 %)."
  - Knappar: **Visa hästen** (S3) och **Kvittera**. Ett kvitterat larm blir en rad med "Larm kvitterat 14:06" och Ångra.
- **Kolumnrubrik:** "Nr · Häst · Nu % · Sedan fre".
- **Grupp "Dina hästar"** (I, S eller B), sorterad efter startnummer, och **grupp "Övriga"**, sorterad efter störst absolut rörelse. Varje rad (44 px) har startnummer, namn med märken (även X), underraden "Fre 5,0 %", streck nu och rörelse.
- **Fotnot:** "Jämfört med utgångsläget fre 21:00".

**Lägen**
| Läge | Visning |
|---|---|
| Före 12:00 lördag | Banderoll `info`: "Live startar 12:00. Fram till dess visas fredagens streck." Ingen automatisk uppdatering, men Uppdatera nu fungerar. |
| Utgångsläge saknas | Banderoll `warn`: "Utgångsläget från fredag kunde inte sparas. Rörelsen räknas från lör 12:05." Referensen är dagens första sparade streck. |
| Varken utgångsläge eller dagens streck | "Rörelse visas efter första uppdateringen." Kolumnen Sedan fre visar "–". |
| Uppdatering misslyckades | Banderoll `err`: "Kunde inte uppdatera 14:10. Visar streck från 14:05. Nytt försök 14:15." med Försök nu. Efter 3 fel i rad läggs "Ingen kontakt med ATG" till. |
| Offline | Banderoll `warn`: "Ingen uppkoppling. Siffrorna är från 14:05." |
| Lopp har startat | Raden visar "Startat" i stället för rörelse och sedan placeringen när den finns. Larm för avdelningen stängs. |
| Omgången klar | Live visar slutläget och banderollen "Omgången är klar" med länk till S1. |

**Desktop:** tre kolumner. Avdelningar till vänster med röda prickar. I mitten tabellen Nr, Häst, Fre 21:00, Nu, Sedan fre, Rörelse (stapel från mitten, 5 px per pe, högst 65 px), Rikt och Unibet, grupperad som i mobilen. Rikt visas som i S2 desktop (med X-faktor när den finns). Till höger `UpdatedLine`, larmkort och "Händelser i dag", alltså en logg med tid, avdelning, häst och rörelse för varje larm och för de största rörelserna, nyast först.

### S6 Spelförslag [E2]
Segmentkontroll: **Platsspel | V85-rad** (`?flik=plats|rad`).

**S6a Platsspel**
- Hjälptext: "Markera Bet på det du spelar hos Unibet. Rätta oddset om det har ändrats."
- **Spelbara (n):** rader med startnummer, namn, "Avd n · rikt 2,40", fält för Unibet-odds och `BetToggle`. Med X-faktor (E2.1) får namnet X-märket och underraden blir "Avd n · rikt 3,00 → X 2,40". Ändras oddset står "Ändrat från 4,10 kl. 14:18". Hamnar det under riktoddset (med X-faktor, om sådan finns) varnar raden med "Under riktoddset nu, inte längre föreslagen". Har Mikael satt Spelbar för hand står den flaggan kvar.
- **Med Bet men inte spelbara:** egen grupp om sådana finns.
- **Intressant men inte spelbara (n):** en hopfälld rad med namn som länkar till S4.
- **Fältet för Unibet-odds:** `inputmode="decimal"` och samma tolkning som i S4. Sparas vid blur eller Enter. Fel ger "Oddset ska ligga mellan 1,01 och 99,99."
- **Bet-tangenten** sätter `bet = true` och `betOdds` = aktuellt Unibet-odds. Rättas oddset efter Bet ändras både `unibetOdds` och `betOdds`, om inte Mikael har satt dem olika.
- X-faktorn ändras inte i S6a. Ett tryck på namnet öppnar hästkortet, där den kan ändras.

**S6b V85-rad**
- **Budgetruta på tavlan:** budget i kr (reglage 20–1 000 i steg om 10 och ett fält för exakt belopp), rader, kostnad och "Kvar" eller "Över budget". Radpriset 0,50 kr står under rutan med **Ändra** (sparas i inställningar).
- **Per avdelning:** valda startnummer som fällbladsrutor, namnen under och `Stepper` för antal hästar (1 till antal startande). Med 1 häst står taggen "Spik". Ett tryck på avdelningsraden öppnar ett ark där Mikael väljer exakt vilka hästar som ska vara med (chips per häst med S, I och streck). Väljer han själv låses avdelningen mot automatiska förslag, vilket visas med ett hänglås och "Eget val".
- **Föreslå inom budget** fyller avdelningar som inte är låsta enligt 6.5.
- **Kopiera rad** kopierar texten enligt 6.5 och visar toasten "Raden är kopierad. Klistra in hos ATG."
- **Lägen:**
  - Budgeten överskrids: summan blir röd med "Över budget med 32,00 kr". Ingenting blockeras.
  - Avdelning har startat: avdelningen låses med "Startat".
  - Omgången har startat: banderollen "V85 har startat – raden kan inte längre spelas", men raden finns kvar för statistiken.
- Raden sparas automatiskt vid varje ändring, en per användare och omgång.

**Desktop:** Platsspel och V85-rad sida vid sida. Tabellen för platsspel har kolumnerna Nr, Häst, Rikt, Unibet (fält), Skillnad och Bet. Rikt visas som i S2 desktop, och Skillnad räknas mot riktoddset med X-faktor.

### S7 Under loppet och resultat [E4]
**Mål: blixtsnabbt.** All data för omgången finns redan i klienten (9.1). Att byta häst är bara ett lokalt tillstånd, utan nätverksanrop och utan omladdning. Kommentarer sparas optimistiskt i bakgrunden och läggs i kö om nätet försvinner (9.3).

**Innehåll, när loppet pågår eller inte har startat**
- Vyrubrik med prick, "Avd 7 pågår" eller "Avd 7 startar 17:13", och underraden "Tryck på en häst".
- Avdelningsflikar.
- Hästlista med 44 px rader: startnummer, namn med B och I och underraden med dina noteringar ("Galopp · Dåligt läge") eller kusken. Till höger antal noteringar och en plusknapp.
- **Kommentarsark** för vald häst:
  - En **remsa med alla startnummer** överst (fällbladsrutor på 44 × 44 som skrollar vågrätt). Vald häst är tänd, och hästar med noteringar har en prick.
  - Rubrik "<nr> <namn>" och underraden "Sparas direkt · följer hästen".
  - **Snabbval** (13 chips, 6.6).
  - **Fritext**, valfri. Den sparas 800 ms efter att Mikael slutat skriva och när arket stängs.
  - Status längst ned: "Sparat" när servern har bekräftat, "Sparas …", eller "I kö (2) – skickas när nätet är tillbaka".
  - **Ångra**, som ångrar senaste ändringen och gäller i 10 s.
  - Knappen **Klar**, som stänger arket.

**Gester och kortkommandon**
| Handling | Mobil | Desktop |
|---|---|---|
| Välj häst | Tryck på raden eller på numret i remsan | Skriv startnumret, en eller två siffror. Har loppet 10 hästar eller fler väntar appen 600 ms efter en etta på en andra siffra. |
| Föregående / nästa häst | Svep vänster eller höger på arket (≥ 60 px, vågrätt dominerar) | ← / → eller J / K |
| Snabbval | Tryck på chippet | Bokstaven som visas på chippet (6.6) |
| Fritext | Tryck i fältet | Enter fokuserar fältet. Esc i fältet går tillbaka till snabbvalen. |
| Ångra | Ångra i statusraden | Z eller Ctrl/Cmd + Z (utanför fritext) |
| Stäng | Klar, svep ned på greppet eller tryck utanför arket | Esc |
| Hjälp | – | ? visar kortkommandona |

- Arket stängs **inte** när Mikael byter häst. Byte flyttar fokus till rubriken i arket och läser upp "<nr> <namn>, 2 noteringar" via `aria-live`.
- Kortkommandon är avstängda medan fokus står i fritextfältet.
- Om enheten stödjer det ger ett snabbval en kort vibration på 10 ms (`navigator.vibrate`).
- På desktop ligger arket som en fast panel till höger om listan i stället för som bottenark.

**Resultatläge (7b)** visas automatiskt när placeringen har kommit. Segmentkontrollen "Kommentera | Resultat" gör att det går att kommentera även efteråt.
- **Summering på tavlan:** Bet 1/2 träff · Spelbar 1/2 topp 3 · Intressant 3/4 topp 3.
- **Placering 1–4:** placering i bärnstensgul ruta, startnummer, namn, kusk, märken I, S och B samt "Träff ✓" för Bet-hästar.
- **"5 eller sämre":** Bet-hästar som missade får egna rader med "Miss ✗" och dina noteringar. Övriga listas på en rad. Diskade hästar visas med "Diskad", och strukna hästar visas inte.
- **Nästa:** "Avd 8 startar 17:35" som länk.

**Lägen:**
- "Väntar på resultat …" efter starttiden fram till att placeringen kommer. Under den tiden hämtas resultat varje minut (9.2).
- "Resultatet kunde inte hämtas" med Försök igen.
- "Loppet är inställt" om ATG anger det. Det räknas inte i statistiken.

### S8 Källor [E1 sida och datamodell, E5 Hämta tips]
**E1**
- Lista med källor (namn, adress, på/av, senast läst och status).
- Fältet "Lägg till källa" (`type="url"`) med **Lägg till**, och möjlighet att byta namn, stänga av och ta bort med Ångra.
- **Hämta tips** är avstängd med hjälptexten "Läsning av tips kommer i en senare version." (E1–E4).
- **Tomt läge:** `EmptyState` med "Inga källor än" och "Lägg till länkar till travsajter du litar på. Hämta tips läser dem och lägger fakta på hästarna i omgången."
- **Fel:**
  - Ogiltig adress ger "Det här ser inte ut som en webbadress. Den ska börja med https://."
  - En dubblett ger "Källan finns redan."
- Antalet påslagna källor är m i hästkortets källstöd (6.8). Stängs en källa av eller tas bort ändras m direkt i hästkorten för lopp som inte har startat.

**E5**
- **Hämta tips** läser alla påslagna källor för aktuell omgång (11).
- Medan det pågår: "Läser 2 av 4 källor …".
- Resultat: "15 nya fakta på 9 hästar".
- Per källa: "Läst 09:12 · 9 fakta", "Inga tips för omgången ännu" eller "Kunde inte läsas: sidan kräver inloggning" med Försök igen.
- Senaste fakta visas som förhandstitt.

### S9 Statistik [E4]
**Innehåll**
- **Period:** Säsong (kalenderår), 10 senaste omgångarna eller Allt.
- **Jämförelse på tavlan:** topp 3-andel för **Intressant**, **Spelbar** och **Bet**, som staplar med procent och bråktal ("41 % · 36 / 88").
- **X-faktor:** en egen ruta som visar om hästar med X-faktor gick bättre än riktoddset trodde (6.7).
- **Dela upp på:** Häst, Kusk, Spår (startnummer), Distans (Kort ≤ 1 700 m, Medel 1 701–2 400 m, Lång ≥ 2 401 m, var för sig för auto och volte) eller Klass.
- **Tabell** med kolumnerna Intressant, Spelbar och Bet träff (bråktal och procent under). Häst och Kusk visar de 20 med flest markeringar och sedan "Visa alla".

Statistiken räknar bara träff eller miss, inga kronor.

**Lägen:** innan första omgången är klar visas "Statistik visas när din första omgång är klar." Ett urval utan data visar "Inga markeringar i det här urvalet".

### S10 Inställningar
| Inställning | Standard | Etapp |
|---|---|---|
| Tema: System, Ljust eller Mörkt | System | E1 |
| Riktlinje för Unibet-odds | 2,00 | E2 |
| Radpris V85 | 0,50 kr | E2 |
| X-faktor Tror på (1,05–3,00) | 1,25 | E2.1 |
| X-faktor Stark känsla (1,05–3,00, större än Tror på) | 1,50 | E2.1 |
| Larmgräns i pe (1,0–30,0 i steg om 0,5) | 10,0 | E3 |
| Riktoddsmodell: aktiv version, vikter och "Räkna om omgången" (bara ADMIN) | v1 | E2 |
| Konto: byt lösenord, logga ut | – | E1 |

Vikterna redigeras i en enkel tabell, ett nummerfält per vikt. Att spara skapar en **ny** modellversion (v1.1 och så vidare), som blir aktiv. Gamla versioner finns kvar.

X-faktorerna ligger i avsnittet "Odds och V85-rad" under radpriset, med samma fältmönster som riktlinjen (`NumberSetting` i `components/settings/GameSettings.tsx`). Texter och regler står i 6.8.

---

## 6. Regler

### 6.1 Spelbar [E2, X-faktor E2.1]
- `riktoddsX = xFactor === "NONE" ? riktodds : max(1,01, round2(riktodds / faktor))`, där `faktor` är användarens faktor för läget (6.8). Är `riktodds` null är `riktoddsX` null.
- `forslag = intressant && unibetOdds != null && riktoddsX != null && unibetOdds > riktoddsX`
- `spelbar = override === "ON" ? true : override === "OFF" ? false : forslag`
- `override` är `NONE` (följer förslaget), `ON` (satt av dig) eller `OFF` (borttagen av dig). Knappen i hästkortet växlar mellan på och av.
  - Ett tryck som ger samma värde som förslaget sätter `NONE`.
  - Ett annat värde än förslaget sätter `ON` eller `OFF`.
  - "Återställ till förslag" finns i hästkortet när override inte är `NONE`.
  - Ändras X-faktorn räknas förslaget om. Ett `override` som är `ON` eller `OFF` står kvar, och X-faktorn ändrar det aldrig.
- Sätts Spelbar för hand på en häst som inte är Intressant blir den också Intressant, eftersom Spelbar alltid är en delmängd av Intressant. Tas Intressant bort nollställs `override` till `NONE` och X-faktorn till Ingen (6.8), och toasten "Spelbar togs också bort · Ångra" visas (texterna med X-faktor står i 6.8).
- Riktlinjen 2,00: `unibetOdds < riktlinje` ger taggen "Under 2,00" på Spelbar-rader och i S4. Den gäller fortfarande Unibet-oddset, inte riktoddset med X-faktor, och påverkar inte förslaget.
- Skillnaden som visas ("0,70 över riktoddset", kolumnen Skillnad) är `unibetOdds − riktoddsX`.
- Spelbar räknas fram vid läsning och lagras inte som eget fält. Vid loppets start fryses värdet i `Outcome` (6.4).

### 6.2 Galopp [E1]
- Underlag: de 5 senaste tidigare starterna (`HorseRecord`, sorterade på datum, nyast först, före omgångens datum).
- **G:** minst en post med `galloped = true`.
- **GD:** minst en post med `galloped = true` och `disqualified = true`. GD ersätter G.
- **Formrutor:**
  - Placering visas som 1–9.
  - Oplacerad eller placering 0 visas som "0".
  - Diskning utan galopp visas som "d".
  - Galopp ger röd ruta. Står placering eller "d" i rutan behålls det tecknet, annars står "g".
  - Seger (1) ger bärnstensgul ruta, om inte galopp ger röd.
- Skärmläsartext: "Form, senaste först: 1:a, galopp oplacerad, 2:a, 1:a, oplacerad".

### 6.3 Rusning och tappar [E3]
- `delta = streckNu − referens` i pe. Referensen är utgångsläget (BASELINE). Saknas det används dagens första LIVE-snapshot.
- `egen = intressant || spelbar || bet`, och `T` = användarens larmgräns.
- **Rusning:** `!egen && delta > T`. **Tappar:** `egen && delta < −T`.
- Strukna hästar och lopp som har startat larmar inte.
- **Livscykel:** första gången villkoret gäller skapas ett `LiveAlarm` (aktivt, okvitterat). Kvittera sätter `ackAt`.
  - Larmet återställs när villkoret har släppt med minst 2 pe marginal (`delta ≤ T − 2` för rusning, eller `delta ≥ −(T − 2)` för tappar).
  - Gäller villkoret igen efter det skapas ett nytt larm.
  - Ändras gränsen räknas allt om vid nästa läsning.
- Larm visas bara i appen: kort i S5, prick på avdelningsflik, Nästa steg i S1 och händelselogg på desktop.

### 6.4 Placering, träff och låsning [E4]
- ATG `result.place`: 1–4 visas som placering. 0, null efter resultat eller över 4 räknas som "5 eller sämre".
- `disqualified` visas som "Diskad" och räknas som "5 eller sämre".
- **Träff** = placering 1–3. Gäller Bet, och topp 3 för I och S.
- **Struken** (`scratched`) räknas inte alls: ingen `Outcome`, och hästen syns inte i statistiken.
- **Låsning vid loppets starttid:** därefter avvisar servern ändringar av I, S, B, X-faktor, källstöd, Unibet-odds och bet-odds med 409 och "Loppet har startat". Vid starttiden fryses en `Outcome`-rad per användare och start där minst en av I, S eller B gäller. Den innehåller också X-läget, faktorn, riktoddset med X-faktor och källstödet (8.2). Placering och träff fylls i när resultatet kommer.

### 6.5 V85-rad [E2]
- `rader = Π antal valda per avdelning` och `kostnad = rader × radpris`. Radpriset är 0,50 kr.
- **Ordning för förslag per avdelning:** Spelbar (lägst riktodds först), sedan övriga Intressant (lägst riktodds först) och sist resten efter högst streck. Saknas riktodds sorteras på streck. Från E2.1 sorteras på riktoddset med X-faktor.
- **Föreslå inom budget**, en girig algoritm:
  - Börja med 1 häst i varje avdelning som inte är låst.
  - Gå sedan varv efter varv igenom avdelningarna, sorterade efter **lägst streck för favoriten** (mest öppna lopp först), och lägg till nästa häst i ordningen om kostnaden ryms i budgeten.
  - Avsluta när inget varv kan lägga till något.
- **Kopiera rad**, textformat:
  ```
  V85 Jägersro lör 24 okt 2026
  Avd 1: 3, 10
  Avd 2: 5
  …
  288 rader · 144,00 kr
  ```

### 6.6 Snabbval under loppet [E4]
Följande kortkommandon gäller på desktop.

| Snabbval | Tangent | | Snabbval | Tangent |
|---|---|---|---|---|
| Galopp | G | | Dåligt läge | A |
| Tog spets | P | | Stark avslutning | S |
| Ledde hela vägen | L | | Spurtade i tredjespår | T |
| Satt i rygg ledaren | R | | Tröttnade | M |
| Satt fast i rygg | F | | Defensivt körd | E |
| Utvändigt utan rygg | U | | Diskad | X |
| Dödens | D | | | |

Listan ligger i en konstant (`lib/quick-tags.ts`) och kan ändras utan migrering. Taggarna sparas som text. (I S7 betyder X alltså Diskad. Tangenten X för X-faktor gäller bara i S2, S3 och S4, och X-faktorn är ändå låst när loppet har startat.)

### 6.7 Statistik [E4]
- **Underlag:** `Outcome` för användaren i omgångar där loppet har resultat. Strukna och inställda lopp räknas inte.
- **Grupp I:** `intressant`. **S:** `spelbar`. **B:** `bet`. En häst kan ingå i flera grupper.
- **Mått:** antal, träffar (placering 1–3) och andel.
- **Uppdelning:**
  - Häst (`horseId`), Kusk (`driverId` vid start) och Spår (startnummer).
  - Distans: grupp och startmetod.
  - Klass: `Race.classLabel`, se 10.3.
- **X-faktor:** för hästar med X-läge Tror på respektive Stark känsla (och, som jämförelse, Intressant utan X) visas antal, faktisk topp 3-andel, väntad andel enligt riktoddset (medel av `1 / riktodds`) och väntad andel enligt riktoddset med X-faktor (medel av `1 / riktoddsX`). Exempel: "Tror på: 9 av 20 topp 3 (45 %) · riktoddset väntade 34 % · med X 42 %". Underlaget är de frysta värdena i `Outcome`, så att en senare ändring av faktorerna i S10 inte skriver om historiken. Källstödet kan läggas till som uppdelning ("2 eller fler källor") när det finns data.

### 6.8 X-faktor och källstöd [E2.1]
**Syfte.** X-faktorn är Mikaels egen krydda: känsla, och att flera källor pekar ut samma häst. Den sänker riktoddset, alltså ger hästen större chans, och påverkar därmed förslaget på Spelbar. Appen sätter aldrig X-faktorn själv. Källstödet är information som hjälper honom att bestämma sig.

**Lägen och beräkning**
| Läge (`xFactor`) | Text | Standardfaktor | Märke |
|---|---|---|---|
| `NONE` | Ingen | 1 (ändras inte) | – |
| `TROR` | Tror på | 1,25 | "X" |
| `STARK` | Stark känsla | 1,50 | "X+" |

- `riktoddsX = max(1,01, round2(riktodds / faktor))`. Exempel med standardfaktorerna: riktodds 3,00 ger 2,40 (Tror på) och 2,00 (Stark känsla). Riktodds 3,20 ger 2,56 och 2,13. Riktodds 1,20 med Stark känsla ger 0,80, som blir 1,01.
- Räknas vid läsning, i klienten för direkt visning och på servern för `forslag`/`spelbar`, med samma rena funktion (`lib/xfactor.ts`). Lagras bara i `Outcome` vid start.
- Osäkert riktodds (asterisk) gäller också riktoddset med X-faktor.
- Saknas riktodds kan X-faktorn ändå sättas. Den sparas och används när riktoddset finns.
- Ändras faktorerna i S10 gäller de direkt för alla lopp som inte har startat. Lopp som har startat har sina värden frysta i `Outcome`.

**Koppling till Intressant – beslut**
- **X-faktor Tror på eller Stark känsla sätter Intressant automatiskt**, precis som Spelbar gör. Skäl: en häst Mikael har en extra känsla för är per definition intressant. Dessutom tar S4 bara med Intressant och Bet, och förslaget kräver Intressant, så en X-faktor på en häst som inte är Intressant skulle inte göra någonting och bara förvirra.
- **Tas Intressant bort nollställs X-faktorn till Ingen**, i samma ändring som `override` nollställs. Skäl: X utan Intressant har ingen verkan, och ett dolt läge som plötsligt slår igenom när lampan tänds igen vore överraskande. Ångra återställer allt.
  - Bara X-faktor togs bort: toasten "X-faktor togs också bort · Ångra".
  - Både Spelbar och X-faktor: "Spelbar och X-faktor togs också bort · Ångra".
  - Ångra skickar en enda PUT med `interesting: true`, tidigare `spelbar` och tidigare `xFactor`.
- **Källstödet påverkas inte** av Intressant. Det är en uppgift om hästen, inte en markering, och ligger kvar.
- X-faktor Ingen tänder eller släcker aldrig Intressant.

**Källstöd**
- Texten är "n av m källor pekar ut hästen". `m` = antal påslagna källor (`Source.enabled`) för användaren just nu. `n` (`Mark.sourceSupport`) fylls i av Mikael, 0–20, eller är tomt (`null`).
- Från E5 kan Hämta tips föreslå `n` (antal olika källor med minst ett faktum om hästen i omgången). Förslaget visas som "Hämta tips räknade 3" med knappen **Använd**. Mikaels ifyllda värde ändras aldrig automatiskt.
- Källstödet påverkar inte riktoddset eller Spelbar. Det sparas i `Outcome` vid start för statistiken.

**Komponenter** (nya, byggda av befintliga mönster)

`XFactorBlock` – sektion i hästkortet (S3 punkt 4), `section.hk-sec` med rubriken `h3` "X-faktor".
- **Hjälptext** (`.help`): "Din egen känsla. Sänker riktoddset, så att hästen lättare blir spelbar. Appen sätter aldrig X-faktorn."
- **Lägesväljare:** segmentkontroll med tre lika breda segment (befintlig `.seg full`, som temaväljaren i `components/settings/SettingsView.tsx`), men med semantiken `role="radiogroup"` och `aria-labelledby` på rubriken. Varje segment har två rader: läget i Barlow Condensed versaler och faktorn i mono 11 px ("Ingen" / "÷1,00", "Tror på" / "÷1,25", "Stark känsla" / "÷1,50"). Höjd 52 px, ryms i tre kolumner på 360 px.
  - Valt segment: `--ink` som bakgrund som i `Segmented`, plus "✓" före texten, så att valet inte bärs av färg.
  - Fokus: 3 px `--focus`. Hover på desktop: `--surface-3`.
  - Avstängd (loppet startat eller hästen struken): `aria-disabled="true"` på gruppen, platt `--surface-3`, och raden "Loppet har startat" respektive "Hästen är struken" under.
- **Effektrad** under väljaren (`aria-live="polite"`), bara när läget inte är Ingen: "Riktodds 3,00 · med X-faktor 2,40". Ändrar valet förslaget läggs " · nu föreslagen som Spelbar" eller " · inte längre föreslagen" till. Saknas riktodds: "Riktodds saknas. X-faktorn används när riktoddset finns."
- **Källstöd:** etiketten "Källstöd", meningen "2 av 4 källor pekar ut hästen" och en stegare (befintlig `.stp` från `components/spel/RadPanel.tsx`: − och + på 40 × 44 med `output` emellan).
  - Tomt värde: meningen "Inte ifyllt · 4 påslagna källor" och `output` "–". + ger 1 och − ger 0.
  - − är avstängd vid 0 och + vid m (och vid 20). Är det sparade värdet större än m (en källa har stängts av) visas det ändå, med tillägget "Fler än dina påslagna källor nu", och − fungerar.
  - Länken **Rensa** (ghost, `linkish`) sätter tomt. Den visas bara när ett värde finns.
  - Inga påslagna källor (m = 0): ingen stegare, i stället "Inga påslagna källor. Lägg till källor" med länk till `/kallor`.
  - Avstängd efter start som lägesväljaren.
- **Sparning:** som övriga markeringar, optimistiskt via utkorgen (9.3). Hästkortets statusrad visar "Sparas …", "I kö (n)" eller "Sparat".

`XCycleButton` – knapp i S4:s hästkort (`.kcard`), högerställd.
- En sekundärknapp (`.btn secondary sm`, minst 44 × 44) med texten "X · Ingen", "X · Tror på" eller "X · Stark känsla". Med X satt har knappen bärnstensgul kant (`--fill`) och märket "X"/"X+" i stället för ordet "X".
- Ett tryck stegar Ingen → Tror på → Stark känsla → Ingen. Ett tryck i 350 ms-fönstret avbryter hoppet (se S4).
- `aria-label` "X-faktor för <häst>: <läge>. Tryck för att byta." Nytt läge läses upp i resultatradens `aria-live`.
- Avstängd (`aria-disabled`) när hästen är låst, som knappsatsen.
- Fokus: står fokus på knappen och Mikael trycker Enter stegas läget (vanlig knapp), inte Nästa. Det följer befintlig regel i `components/odds/OddsEntry.tsx` att Enter på en knapp trycker på knappen.

`Badge` får två nya slag, `x` och `xp`:
- 17 × 17 px (`xp` får bredden av texten, högst 22 px) med `--head` som bakgrund och `--head-ink` som text, det vill säga "lysande" tavelstil. Det skiljer sig från I (ring), S (fylld bärnsten) och B (inverterad) utan att bara bäras av färg, eftersom texten är "X" och "X+".
- `role="img"`, `aria-label` "X-faktor: Tror på" och "X-faktor: Stark känsla". `wide`-varianten skriver "Tror på" och "Stark känsla".
- Märket ligger efter S och B (`MarkBadges` i `components/round/parts.tsx`) och visas därmed överallt där S och B visas: S2, S5, S6, S7 och sammanfattningsarket i S4.

**Visning per vy**
| Var | Visning med X-faktor |
|---|---|
| S2 mobil, kolumnen Rikt (38 px) | Riktoddset med X-faktor (som alltid är lägre, så det får plats), i `--accent`. Färgen är inte ensam: X-märket står i samma rad. `title` och skärmläsartext: "Riktodds 3,00, med X-faktor 2,40". Osäkert-asterisken behålls. Raden är fortfarande 44 px, så avd 7 med 12 hästar får plats utan skroll. |
| S2, S5 och S6a desktop, kolumnen Rikt | Två rader i cellen: riktoddset med X-faktor (13,5 px, `--accent`) och under det "3,00 utan X" (11 px, `--ink-2`). |
| S3 `RiktoddsBox` | Stora siffran är riktoddset med X-faktor med etiketten "Med X-faktor". Bredvid, i samma storlek som Unibet, "Riktodds 3,00". Under rutan "÷1,25 · Tror på". Meningen jämför mot riktoddset med X-faktor: "Spelbar: Unibet ger 0,70 mer än riktoddset med X-faktor". |
| S3 beräkningsraden | Förlängs med X-steget: "Chans till topp 3 ≈ 31 % → 1 / 0,31 = 3,20 → ÷ 1,25 (Tror på) = 2,56". Raden byggs av serverns rad och ett X-steg som klienten lägger till, så att den ändras direkt när läget byts. |
| S4 tavelrutan Riktodds | Etiketten "Riktodds med X", siffran = riktoddset med X-faktor, och under den i `--head-ink-2` "utan X 3,00". |
| S4 resultatraden | "0,70 över riktoddset med X · föreslås som Spelbar". |
| S4 sammanfattningsarket och S6a mobil (underraden) | Kort form: "rikt 3,00 → X 2,40". Skillnaden räknas mot 2,40. |

**Tangentbord (desktop)**
- **X** i S2 (vald rad), i S3 (när fokus inte står i ett textfält) och i S4: stegar Ingen → Tror på → Stark känsla → Ingen. **Shift + X** stegar baklänges.
- Tangenten gör ingenting när hästen är låst, och läser då upp "Loppet har startat" i den befintliga `aria-live`-regionen.
- Hjälptexten i S4 blir: "Tangentbord: siffror, Backsteg, Enter = Nästa, ← = Föregående, Tab = Hoppa över och X = X-faktor. Komma och punkt behövs inte."
- Kortkommandon är avstängda i textfält och när ett ark eller en dialog är öppen, som i dag.

**Låsning, offline och fel**
- **Efter loppets start** avvisar servern `xFactor` och `sourceSupport` med 409, som övriga fält (6.4). Utkorgen rullar tillbaka och visar "<häst>: loppet hade redan startat, ändringen sparades inte." (9.3).
- **Offline:** ändringen syns direkt och ligger i utkorgen. `PUT /api/marks/[startId]` med hela tillståndet för de fält som skickas är idempotent, så omsändning gör ingen skada. Flera snabba tryck på X för samma häst slås ihop till den sista posten i utkorgen.
- **Ogiltigt värde** (400): "Okänt läge för X-faktor." eller "Källstödet ska vara ett heltal mellan 0 och 20." Posten tas bort och felet visas som toast.

**Faktorerna i S10**
- Två fält i avsnittet "Odds och V85-rad", samma mönster som riktlinjen (`NumberSetting`):
  - "X-faktor Tror på", hjälptext: "Riktoddset delas med faktorn. 1,25 gör 3,00 till 2,40. Mellan 1,05 och 3,00."
  - "X-faktor Stark känsla", hjälptext: "Riktoddset delas med faktorn. 1,50 gör 3,00 till 2,00. Mellan 1,05 och 3,00 och större än Tror på."
- Fel: "Faktorn ska ligga mellan 1,05 och 3,00." och "Stark känsla ska vara större än Tror på."
- Sparas vid blur eller Enter som i dag. Efter sparning uppdateras omgångens cache med de nya faktorerna (som riktlinjen i `refreshCurrentRound`), och förslagen räknas om.

---

## 7. Riktoddsmodell v1 [E2]
Modellen gäller bara **plats** (topp 3). Den är märkt **v1, okalibrerad**. Kalibrering mot historiska omgångar görs i en senare etapp, se 7.6. X-faktorn (6.8) ligger utanför modellen och läggs på efteråt. Den ändrar aldrig `Riktodds`-raden.

### 7.1 Indata per start
| Nyckel | Indata | Källa | Saknas |
|---|---|---|---|
| `plats` | Platsandel (1–3) i år och i fjol, krympt mot fältets medel: `(p + k·p0) / (n + k)` med `k = 6`, `p0 = 3 / N` | ATG `horse.statistics` | Används p0 |
| `vinst` | Vinstandel på samma sätt, med `w0 = 1 / N` | ATG | Används w0 |
| `form` | Medel av poäng för de 5 senaste: 1:a = 1,0, 2:a = 0,8, 3:a = 0,6, 4:a = 0,4, 5:a = 0,2, annars 0 | `HorseRecord` | Fältets medel |
| `spar` | `ln(spårets vinst % / medel)` för startnumret på distansgruppen och startmetoden | travstatistik.se | 0 |
| `kusk` | Kuskens vinstandel i år, krympt med `k = 20` mot fältets medel | ATG `driver.statistics` | Medel |
| `tranare` | Tränarens vinstandel i år, krympt med `k = 20` | ATG | Medel |
| `galopp` | Antal galopper bland de 5 senaste, där GD räknas som 1,5 | `HorseRecord` | 0 |
| `streck` | `ln(streck)`. Vikten är 0 i v1, så att riktoddset är oberoende av marknaden | ATG | 0 |

`N` = antal startande som inte är strukna.

### 7.2 Beräkning
1. Standardisera varje indata inom loppet till z-värden (medel 0, standardavvikelse 1). Är standardavvikelsen 0 blir z = 0.
2. Styrka: `S_i = Σ w_j · z_ij`.
3. Vinstsannolikhet: `π_i = exp(β·S_i) / Σ exp(β·S_k)`.
4. Topp 3 med Harvilles formel, exakt summa över alla ordningar av ettan, tvåan och trean:
   `P3_i = π_i + Σ_{j≠i} π_j·π_i/(1−π_j) + Σ_{j≠i} Σ_{k≠i,j} π_j·π_k/(1−π_j)·π_i/(1−π_j−π_k)`
5. `riktodds = clamp(round2((1 / P3_i) · (1 + marginal)), 1,01, 99,99)`.
6. **Osäkert** om hästen har färre än 5 starter totalt eller saknar minst 2 av indata `plats`, `form` och `kusk`.
7. Lopp med färre än 4 startande får inget riktodds.

### 7.3 Standardvikter v1
`plats 1,0 · vinst 0,5 · form 0,6 · spar 0,4 · kusk 0,3 · tranare 0,2 · galopp −0,4 · streck 0`. Övriga parametrar: `β = 1,0`, `marginal = 0`.

Vikterna lagras i `ModelVersion.weights` (JSON) och går att justera i S10 utan att någon kod ändras.

### 7.4 Förklaring
- Bidrag `c_ij = w_j · z_ij` sparas per start.
- "Talar för" är de högst 3 största positiva bidragen och "Talar emot" de högst 3 största negativa, var och en med en mening från en mall per indata och det verkliga värdet:
  - `plats`: "Plats i 64 % av starterna i år"
  - `spar`: "Spår 10 på 2640 m auto vinner bara 3,1 %"
  - `galopp`: "Galopp i 1 av 5 senaste"
  - `kusk`: "Kusken vinner 21 % i år"
- Bidrag under 0,15 i absolut värde visas inte.
- Beräkningsraden visar P3 i hela procent och riktoddset. Med X-faktor läggs X-steget till (6.8).

### 7.5 När riktoddset räknas
Riktodds räknas efter varje hämtningssteg som ändrar indata (startlista, starter, statistik), när en häst stryks (fältet ändras) och vid "Räkna om omgången" i S10. Resultatet sparas per start och modellversion. Den aktiva versionen visas.

### 7.6 Senare kalibrering
Detta byggs inte i E2. Gränssnittet förbereds för `scripts/backtest.ts`:
- **Indata:** datumintervall, modellversion.
- **Körning:**
  - Hämta historiska V85-spel via kalendern och spelen med resultat.
  - Bygg indata **som de såg ut före loppet**: ta bara med `HorseRecord` med datum före loppet. Statistiken för år och kusk räknas från posterna, så att framtida data inte läcker in.
  - Räkna P3 och jämför med utfallet.
- **Utdata:** Brier-poäng, log loss, en kalibreringstabell (10 hinkar) och avkastning för regeln "spela när marknadens platsodds (`finalOdds` för plats om det finns) > riktodds". Resultatet sparas i `ModelVersion.backtest`.

---

## 8. Datamodell [E1, fält för senare etapper kan läggas till i deras migrering]
Prisma mot Postgres i Supabase, med samma inställningar som Tabellgissningen (`DATABASE_URL`, `DIRECT_URL`). Alla id är `cuid()`. Tider lagras i UTC, och decimaltal för odds och procent som `Decimal(6,2)`.

### 8.1 Gemensamt (delas mellan användare)
| Entitet | Fält (urval) | Relationer och unikhet |
|---|---|---|
| **Round** | `atgGameId` (t.ex. `V85_2026-10-24_7_5`), `date` (lokalt datum), `trackId`, `trackName`, `firstStartAt`, `atgStatus`, `fetchedAt`, `fetchStatus` (`COMPLETE`/`PARTIAL`/`FAILED`), `liveSyncAt` (claim), `liveOkAt`, `baselineAt`, `finishedAt`, `rev` (räknas upp vid varje ändring) | `atgGameId` unik. Har Race[], RoundSnapshot[], StatsSnapshot[] |
| **Race** | `roundId`, `atgRaceId`, `leg` (1–8), `raceNumber` (lopp på banan), `name`, `startAt`, `distance`, `startMethod` (`AUTO`/`VOLTE`), `prize` (kr), `classLabel`, `terms`, `atgStatus`, `resultAt`, `cancelled` | `atgRaceId` unik och `(roundId, leg)` unik |
| **Horse** | `atgHorseId`, `name`, `sex`, `birthYear`, `country` | `atgHorseId` unik. Kommentarer knyts hit |
| **Person** | `atgPersonId`, `firstName`, `lastName`, `shortName`, `statsJson` (år, starter, segrar, placeringar), `statsAt` | `atgPersonId` unik. Används för både kusk och tränare |
| **PersonAlias** | `source` (`TRAVSTATISTIK`), `rawName` (t.ex. "Kihlström Ö"), `personId?` | `(source, rawName)` unik |
| **Start** | `raceId`, `horseId`, `number`, `postPosition`, `distance` (med tillägg), `driverId`, `trainerId`, `prevDriverId?` (kuskbyte), `scratched`, `scratchedAt`, `age`, `record`, `earnings`, `horseStatsJson`, `shoes`, `sulky`, `lastFetchedAt`, `recordsFetchedAt`, resultat: `place?`, `disqualified`, `finalOdds?`, `resultAt?` | `(raceId, horseId)` unik och `(raceId, number)` unik |
| **HorseRecord** | `horseId`, `date`, `trackName`, `atgRaceRef?`, `distance`, `startMethod`, `postPosition?`, `place?`, `galloped`, `disqualified`, `kmTime`, `odds?`, `driverName?` | `(horseId, date, trackName)` unik. Gemensamt, eftersom det är ATG-fakta |
| **RoundSnapshot** | `roundId`, `takenAt`, `kind` (`BASELINE`/`LIVE`/`FETCH`) | Index `(roundId, kind, takenAt)`. Högst en BASELINE per omgång |
| **StreckValue** | `snapshotId`, `startId`, `value` (hundradelar av procent, Int) | `(snapshotId, startId)` unik |
| **StatsSnapshot** | `roundId`, `source` (sidnyckel, se 10.3), `fetchedAt`, `ok`, `error?`, `data` (JSON, tolkat) | Index `(roundId, source, fetchedAt)`. Senaste lyckade används |
| **ModelVersion** | `key` ("v1", "v1.1"), `weights` (JSON), `params` (JSON: β, marginal, k-värden), `active`, `createdAt`, `createdById`, `backtest?` (JSON) | Exakt en aktiv |
| **Riktodds** | `startId`, `modelVersionId`, `probTop3`, `odds`, `uncertain`, `inputs` (JSON), `contributions` (JSON), `computedAt` | `(startId, modelVersionId)` unik |
| **FetchLog** | `roundId`, `userId`, `step` (`GAME`/`RACE_n`/`STATS`/`RIKTODDS`), `startedAt`, `finishedAt`, `ok`, `message`, `changes` (JSON: strukna, kuskbyten) | Visas i S1 |

### 8.2 Per användare (`userId` på allt, aldrig delat)
| Entitet | Fält (urval) | Relationer och unikhet |
|---|---|---|
| **User** | Som i Tabellgissningen: `email`, `name`, `passwordHash`, `role` (USER/ADMIN), `status` (APPROVED …) | Mikael skapas med ett seed-skript och rollen ADMIN. Ingen registrering i gränssnittet |
| **UserSettings** | `userId` (pk), `rushThresholdPe` (10,0), `rowPrice` (0,50), `spelbarGuideline` (2,00), från E2.1 `xFactorTror` (`Decimal(4,2)`, 1,25) och `xFactorStark` (`Decimal(4,2)`, 1,50). Båda 1,05–3,00 och `xFactorStark > xFactorTror`, kontrolleras i API:t | 1–1 med User |
| **Mark** | `userId`, `startId`, `interesting`, `interestingAt`, `spelbarOverride` (`NONE`/`ON`/`OFF`), `bet`, `betAt`, `betOdds?`, `unibetOdds?`, `unibetOddsAt?`, `unibetOddsPrev?` (för "Ändrat från"), från E2.1 `xFactor` (enum `XFactor`: `NONE`/`TROR`/`STARK`, standard `NONE`), `xFactorAt?`, `sourceSupport?` (Int 0–20, null = inte ifyllt), `updatedAt` | `(userId, startId)` unik |
| **RaceReview** | `userId`, `raceId`, `reviewedAt`, `noneInteresting` | `(userId, raceId)` unik |
| **HorseComment** | `userId`, `horseId`, `startId?`, `roundId?`, `kind` (`NOTE` = inför loppet, `RACE` = under loppet), `tags` (String[]), `text`, `clientId` (uuid från klienten), `createdAt`, `updatedAt`, `deletedAt?` | `(userId, clientId)` unik. Högst en `RACE`-kommentar per `(userId, startId)` |
| **Coupon** | `userId`, `roundId`, `budget` (kr, Int), `rowPrice`, `selections` (JSON: `{ "1": [3,10], … }`), `lockedLegs` (Int[]), `updatedAt` | `(userId, roundId)` unik |
| **LiveAlarm** | `userId`, `startId`, `kind` (`RUSH`/`DROP`), `firstSeenAt`, `deltaAtFirst`, `lastDelta`, `ackAt?`, `rearmedAt?` | Index `(userId, startId, kind)` |
| **Outcome** | `userId`, `startId`, `roundId`, `interesting`, `spelbar`, `bet`, `unibetOdds?`, `betOdds?`, `riktodds?`, från E2.1 `xFactor` (`XFactor`), `xFactorValue` (`Decimal(4,2)`, 1,00 för `NONE`), `riktoddsX?`, `sourceSupport?`, `sourceTotal?` (m vid start), `frozenAt`, `place?`, `disqualified`, `hit?` | `(userId, startId)` unik. Skapas vid loppets start (6.4) |
| **Source** | `userId`, `name`, `url`, `enabled`, `sortOrder`, `lastReadAt?`, `lastStatus?`, `lastError?`, `lastFactCount?` | `(userId, url)` unik |
| **TipFact** [E5] | `userId`, `sourceId`, `roundId`, `startId?`, `horseId`, `text`, `kind` (`FACT`/`PATTERN`), `quote?`, `fetchedAt` | Visas i S3 |

**Princip:** gemensam ATG-data skrivs bara av hämtning, synk och cron. Allt Mikael gör skrivs med `userId` från sessionen, och varje fråga filtrerar på den.

**Migrering E2.1:** enum `XFactor`, de nya fälten på `Mark`, `UserSettings` och `Outcome`. Alla har standardvärden eller är nullbara, så befintliga rader behöver ingen omräkning. `Outcome`-rader som frystes före E2.1 får `xFactor = NONE`, `xFactorValue = 1,00` och `riktoddsX = riktodds`.

---

## 9. Klientdata, synk och offline

### 9.1 Omgången i klienten [E1]
- `GET /api/rounds/[id]` ger allt som behövs för S1–S7 i ett svar: alla avdelningar, starter med häst, kusk och tränare, form, märken, aktivt riktodds, användarens Mark, RaceReview, Coupon och senaste streck. Från E2.1 också X-faktorerna i `settings` och antalet påslagna källor (12).
- Svaret är cirka 100 starter, under 200 kB komprimerat. Det hålls i en klientcache, ett React-sammanhang `RoundProvider` med `rev`, och sparas i `localStorage` (`sv-round-<id>`) så att appen startar direkt och fungerar offline.
- Hästkortets tunga delar (alla tidigare starter, kommentarer och statistik) hämtas med `GET /api/starts/[id]`. Det sker när kortet öppnas och förhandsladdas för grannhästarna i S2 och S7 när det finns tid över (`requestIdleCallback`).
- Avdelningsbyte och hästbyte gör aldrig nätverksanrop.

### 9.2 Pollning [E3, resultat E4]
En hook `useLivePolling`, byggd som `useRoundLive.ts`:
- Ett anrop i taget, pausad när sidan inte syns och direkt hämtning när den syns igen.
- Efter fel försöker den igen efter 5, 10 och 15 s. Efter 3 fel i rad räknas den som offline.

| Läge | Intervall |
|---|---|
| Före `D 12:00` | Ingen pollning (Uppdatera nu finns) |
| `D 12:00` till sista resultatet | 5 min |
| Ett lopp har passerat starttiden men saknar resultat (högst 30 min efter start) | 60 s |
| Omgången klar | Ingen |

`GET /api/rounds/[id]/live` gör så här:
1. Tar ett claim på `Round.liveSyncAt`, så att ATG hämtas högst var 4:e minut. Väntar ett resultat är gränsen 50 s, och vid Uppdatera nu 60 s.
2. Den som fick claimet hämtar spelet från ATG och skriver en LIVE-snapshot, resultat och strykningar.
3. Svarar med lättdata för användaren: `serverTime`, `rev`, `syncedAt`, `nextSyncAt`, `reference` (`{kind, takenAt}`), per start `{startId, streck, referens, delta, scratched, place, disqualified}`, per avdelning `{raceId, status, resultAt}` och användarens larm.
4. Larm räknas och skapas här (6.3).
5. Ändrades något annat (`rev`) hämtar klienten hela omgången igen, som i Tabellgissningen.

### 9.3 Optimistisk sparning och kö [E1 för Mark och kommentarer, krav i E4]
- Alla användaråtgärder (Intressant, Spelbar, Bet, X-faktor, källstöd, odds, kommentarer, granskning och kupong) uppdaterar cachen direkt och läggs i en **utkorg** i `localStorage` (`sv-outbox`). Varje post har `{id: uuid, method, url, body, createdAt, tries}`.
- **Utkorgen** skickar posterna i ordning, en i taget. Den körs direkt, vid `online`, vid `visibilitychange` och var 10:e sekund så länge något finns kvar.
- **Idempotens:**
  - Kommentarer använder `PUT /api/comments/[clientId]`.
  - Mark använder `PUT /api/marks/[startId]` med hela tillståndet för de fält som skickas.
  - Coupon använder `PUT` med hela kupongen.
  - Att skicka om en post gör alltså ingen skada.
- **Svar:**
  - 2xx tar bort posten.
  - 409 ("Loppet har startat") tar bort posten, rullar tillbaka i cachen och visar toasten "<häst>: loppet hade redan startat, ändringen sparades inte."
  - 401 pausar utkorgen och visar "Logga in igen".
  - 4xx tar bort posten och visar felet.
  - 5xx och nätverksfel försöker igen med väntetiden 2, 5, 10 och 30 s.
- **Status i gränssnittet:** "Sparat", "Sparas …" eller "I kö (n)" i S7 och i hästkortet. En global prick på Omgång-fliken visas om kön inte är tom längre än 30 s.

---

## 10. Datahämtning och mappning

### 10.1 Hämta omgång [E1]
Knappen i S1 körs av klienten som en kedja av korta anrop, så att ingen enskild Vercel-funktion riskerar att nå tidsgränsen. Varje steg loggas i `FetchLog`.

| Steg | Anrop | Gör |
|---|---|---|
| 1 | `POST /api/rounds/fetch` `{ gameId? }` | Utan `gameId`: läser `calendar/day/<datum>` för i dag och 7 dagar framåt och väljer första `games.V85[]` vars första start är senare än nu − 12 h. Hämtar `games/<id>` och skriver Round, Race, Start, Horse och Person samt en FETCH-snapshot av strecket. Svarar med `roundId`, `legs` och `changes`. |
| 2–9 | `POST /api/rounds/[id]/fetch/races/[leg]` | För varje start: `races/<raceId>/start/<nr>` → `horse.results.records[]` sparas som `HorseRecord`. Uppdaterar häst- och personstatistik. Högst 6 samtidiga anrop mot ATG och 6 s timeout per anrop. |
| 10 | `POST /api/rounds/[id]/fetch/stats` | Läser sidorna på travstatistik.se (10.3) och sparar `StatsSnapshot`. Kopplar kusk- och tränarnamn. |
| 11 | `POST /api/rounds/[id]/riktodds` [E2] | Räknar riktodds med aktiv modell (7). |

- Klienten visar stegen. Om ett steg misslyckas står kedjan still där, och **Försök igen** fortsätter från det steget. Enskilda starter som misslyckas i steg 2–9 markeras och tas om vid nästa försök.
- **Hämta igen** kör hela kedjan. Steg 2–9 hoppar över starter vars `recordsFetchedAt` är nyare än 12 h, om inte starten är ny eller har ändrats.
- **Ändringar vid ny hämtning** visas i S1:
  - Ny `scratched = true` ger `scratchedAt` och "<häst> struken".
  - Ny kusk ger `prevDriverId` = gammal kusk och "Kuskbyte: <häst> – <ny kusk> (förut <gammal>)".
  - Allt användarägt (Mark, kommentarer, odds) ligger kvar, eftersom det är knutet till `Start` via `(raceId, horseId)` och till `Horse`.
- `GET /api/rounds/next-available` gör samma kalenderuppslag, cachat i 10 min, och används av Nästa steg.

### 10.2 ATG-mappning [E1]
API:t är inofficiellt. All tolkning ligger i `lib/atg.ts` med egna typvakter som inte litar på formen. Okända eller saknade fält ger `null` och ett varningsloggat fel, aldrig en krasch. Tester körs mot sparade svar i `test/fixtures/atg/`, där `game.json` för V85 Jägersro 2026-10-24 är första fixturen.

| ATG | Spelvärde |
|---|---|
| `calendar/day/<d>` → `games.V85[].id`, `.status`, `.startTime` | `Round.atgGameId`, `atgStatus`, `firstStartAt` |
| `games/<id>` → `races[].id`, `.number`, `.name`, `.startTime`, `.distance`, `.startMethod`, `.prize`, `.terms`, `.status` | `Race`. Avdelning = index i `races[]` + 1. Startmetod `auto`/`volte` |
| `races[].track.id/.name` | `Round.trackId/trackName` |
| `races[].starts[].number`, `.postPosition`, `.distance`, `.scratched` | `Start` |
| `starts[].horse.id`, `.name`, `.age`, `.sex`, `.record`, `.statistics`, `.shoes`, `.sulky` | `Horse` och `Start.age/record/horseStatsJson/shoes/sulky` |
| `starts[].driver` och `starts[].horse.trainer` med `id`, `firstName`, `lastName`, `shortName`, `statistics` | `Person` och `Start.driverId/trainerId` |
| `starts[].pools.V85.betDistribution` (hundradelar av procent) | `StreckValue.value`. Visas som `value / 100` med en decimal |
| `starts[].result.place`, `.finalOdds`, och diskning om ATG anger den | `Start.place`, `finalOdds`, `disqualified`, `resultAt` |
| `races/<raceId>/start/<nr>` → `horse.results.records[]`: `date`, `place`, `galloped`, `disqualified`, `kmTime`, `odds`, `track` | `HorseRecord` |

Att verifiera mot fixturen i E1:
- exakt fältnamn för strykning och diskning
- `kmTime` som objekt eller text
- var kuskens statistik ligger
- om `pools.plats` innehåller platsodds per häst, och i så fall om det kan sparas för backtest.

Avvikelser skrivs in i `lib/atg.ts`, inte i den här specen.

### 10.3 travstatistik.se [E1]
- Sidorna är HTML-tabeller som visar **den aktuella omgången** och uppdateras under veckan. De ska läsas efter att startlistan har hämtats, och vid Hämta igen.
- `lib/travstatistik.ts` hämtar med 8 s timeout och en tydlig `User-Agent` ("Spelvärde (privat bruk)"). Den tolkar med `node-html-parser` (nytt beroende) och sparar tolkade rader som JSON i `StatsSnapshot`.
- **Rimlighetskontroll:** stämmer inte veckans bana eller datum på sidan med omgången sparas `ok = false` med "Sidan visar en annan omgång". Då visar gränssnittet "Statistik saknas just nu".

| Sidnyckel | Sida | Förväntat innehåll, verifieras i E1 | Används i |
|---|---|---|---|
| `startnr` | `visaveckansnr.php` | Vinst % per startnummer för veckans lopp: distans och startmetod | S2 statistikrad, S2b, riktodds `spar` |
| `rank` | `visaveckansrankvalny.php` | Rankning och värdering av veckans hästar | S2b (visas som information, inte i v1) |
| `ms` | `visaveckansMS.php` | Statistik för mest streckade, t.ex. "54,5 % vinner" | S2 statistikrad, S2b |
| `bana` | `visaveckansbana.php` | Banstatistik för veckans bana | S2b, urvalet "<bana>" |
| `kuskliga` | `visakuskligan.php` | V85-ligan för kuskar (t.ex. Kihlström Ö 36) | S2b |
| `tranarliga` | `visatranarligan.php` | V85-ligan för tränare | S2b |
| `form` | `formtoppen.php` | Formtoppen för kuskar och tränare | S2b, kusk- och tränarform |
| `senaste` | `visasenasteomg.php` | Förra omgångens resultat | Kontroll av vilken omgång sidorna visar |

**Kuskar och tränare kopplas** i `lib/names.ts`:
1. Normalisera namnen: små bokstäver, blanksteg trimmade, bindestreck som mellanslag. Å, ä och ö behålls.
2. "Kihlström Ö" tolkas som efternamnet "kihlström" och initialen "ö".
3. Matcha mot `Person` som förekommer i omgången och har samma efternamn och förnamn som börjar på initialen.
4. Exakt en träff sparar `PersonAlias`. Ingen eller flera träffar sparar aliaset utan `personId`, och namnet visas med "ej kopplad".
5. Klassen `Race.classLabel` tas från loppnamn och villkor genom att matcha en lista över kända klasser i `lib/race-class.ts`: "Gulddivisionen", "Silverdivisionen", "Bronsdivisionen", "Stodivisionen", "Diamantstoet", "Klass I", "Klass II", "Klass III", "Brons mot Silver", "Lärlingslopp" och "Övrigt". Grupplopp ("Gr. I", "Gr. II") läggs till som prefix.

### 10.4 Jobb (Vercel Cron, skyddade av `CRON_SECRET` som i Tabellgissningen)
| Rutt | Schema (UTC) | Gör | Etapp |
|---|---|---|---|
| `GET /api/cron/baseline` | `0 19 * * 5`, vilket blir fredag 21:00 sommartid och 20:00 vintertid | Hittar V85 med datum i morgon i svensk tid. Finns omgången inte i databasen hämtas den (steg 1 i 10.1, utan användare). Sparar BASELINE om den inte redan finns, och sätter `Round.baselineAt`. Idempotent. | E3 |
| `GET /api/cron/results` | `0 22 * * 6`, vilket blir lördag 00:00 eller 23:00 lokal tid | Hämtar resultat för omgångar med datum i dag eller i går som inte är klara, fryser saknade `Outcome` och sätter `finishedAt` när alla lopp har resultat. Säkerställer statistiken även om appen inte var öppen. | E4 |

- Hämta omgång har **inget** schemalagt jobb, enligt Mikaels beslut. Undantaget är baseline-jobbet, som hämtar spelet om det saknas, eftersom utgångsläget annars inte går att spara.
- `Outcome` fryses vid loppets start av den första läsning som sker efter starttiden: live-rutten, `GET /api/rounds/[id]` eller cron. Den skrivs med `upsert` och värden från Mark som gällde vid starttiden. Ändringar efter start avvisas (6.4), så värdena är desamma. X-faktorns värde tas från användarens inställningar vid frysningen. (Ändrar Mikael faktorerna i S10 efter starttiden men före första läsningen används de nya. Det är en accepterad förenkling.)

---

## 11. Källor och Hämta tips [E5]
- `POST /api/sources/fetch-tips` `{ roundId }` läser varje påslagen källa och hämtar sidan med 10 s timeout. Texten tas fram ur HTML, och sidan skickas till Claude-API:t (`ANTHROPIC_API_KEY`) tillsammans med omgångens hästnamn, kuskar och lopp.
- **Instruktion:** returnera JSON `[{horseName, leg?, kind: FACT|PATTERN, text, quote}]`. Bara uppgifter som står på sidan får tas med.
- **Matchning:** hästnamnet matchas exakt (normaliserat) mot omgångens hästar. Det som inte går att matcha kastas och räknas.
- **Spärrar:**
  - högst en körning per 10 min
  - högst 20 källor
  - tak på antal token per körning, som en miljövariabel
  - fel per källa sparas i `Source.lastStatus/lastError`.
- **Lägen:** "Inga tips för omgången ännu" när modellen returnerar en tom lista, och "Kunde inte läsas: <orsak>".
- **Källstöd:** efter körningen räknas per häst antalet olika källor med minst ett faktum. Det visas som förslag i hästkortets källstöd (6.8) och skrivs aldrig över Mikaels ifyllda värde. X-faktorn sätts aldrig av Hämta tips.
- Mikael har inte bestämt vilka källor det blir. Mallen för instruktionen och fältlistan fastställs i E5.

## 12. API-rutter
Alla rutter utom `/api/auth/login` och `/api/cron/*` kräver inloggning (middleware som i Tabellgissningen). `getCurrentUser()` slår upp användaren färskt. Felsvar har formen `{ error: "<svensk mening>" }`.

| Metod och rutt | Etapp | Beskrivning |
|---|---|---|
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/password` | E1 | Som i Tabellgissningen, utan register och glömt lösenord |
| `GET /api/rounds/current` | E1 | Aktuell omgång: senaste som inte är klar, annars senaste. Svarar med fas, avdelningar med räknare och Nästa steg |
| `GET /api/rounds/next-available` | E1 | Nästa V85 i ATG:s kalender och om den redan är hämtad |
| `GET /api/rounds` | E4 | Tidigare omgångar, med sidindelning |
| `POST /api/rounds/fetch` | E1 | Steg 1 i 10.1 |
| `POST /api/rounds/[id]/fetch/races/[leg]` | E1 | Steg 2–9 |
| `POST /api/rounds/[id]/fetch/stats` | E1 | Steg 10 |
| `POST /api/rounds/[id]/riktodds` | E2 | Steg 11, och "Räkna om omgången" |
| `GET /api/rounds/[id]` | E1 | Hela omgången för klienten (9.1). Från E2.1 med `settings.xFactorTror`, `settings.xFactorStark` och `sourcesEnabled` (antal påslagna källor) |
| `GET /api/rounds/[id]/races/[leg]/stats` | E1 | Loppstatistik S2b |
| `GET /api/starts/[id]` | E1 | Hästkort: alla tidigare starter, kommentarer, statistik, riktoddsbidrag och tips (E5). `calcLine` är oförändrad, utan X-steget, som klienten lägger till (6.8) |
| `PUT /api/marks/[startId]` | E1 (interesting), E2 (övrigt), E2.1 (X-faktor, källstöd) | Body med något av `{interesting, spelbar: "on"\|"off"\|"auto", bet, unibetOdds, betOdds, xFactor: "NONE"\|"TROR"\|"STARK", sourceSupport: number\|null}`. Svarar med Mark och beräknad `spelbar`/`forslag`/`riktoddsX`. 409 efter start. Regler för E2.1 nedan |
| `PUT /api/races/[id]/review` | E1 | `{reviewed: boolean, noneInteresting: boolean}` |
| `GET /api/horses/[id]/comments` | E1 | Användarens kommentarer om hästen |
| `PUT /api/comments/[clientId]`, `DELETE /api/comments/[clientId]` | E1 | Idempotent upsert och mjuk borttagning. Body `{horseId, startId?, roundId?, kind, tags, text}` |
| `GET /api/rounds/[id]/live` | E3 | Pollning (9.2) |
| `POST /api/rounds/[id]/live/refresh` | E3 | Uppdatera nu: tvingat claim, högst var 60:e sekund |
| `POST /api/alarms/[id]/ack`, `DELETE /api/alarms/[id]/ack` | E3 | Kvittera och ångra |
| `GET /api/rounds/[id]/coupon`, `PUT /api/rounds/[id]/coupon` | E2 | V85-raden |
| `GET /api/stats?period=season\|last10\|all&by=horse\|driver\|post\|distance\|class` | E4 | Statistik. Svaret har också blocket `xFactor` (6.7) |
| `GET /api/settings`, `PUT /api/settings` | E1–E3 | Inställningar. Från E2.1 också `xFactorTror` och `xFactorStark` |
| `GET /api/admin/model`, `PUT /api/admin/model` | E2 | Aktiv modell. PUT skapar en ny version |
| `GET /api/sources`, `POST /api/sources`, `PATCH /api/sources/[id]`, `DELETE /api/sources/[id]` | E1 | Källor |
| `POST /api/sources/fetch-tips` | E5 | Svarar 501 med "Kommer i en senare version" före E5 |
| `GET /api/cron/baseline`, `GET /api/cron/results` | E3, E4 | Cron |

**`PUT /api/marks/[startId]` i E2.1**
- `xFactor` `TROR` eller `STARK` sätter också `interesting = true` (och `interestingAt` om den var släckt) och `xFactorAt = now`.
- `interesting: false` sätter också `xFactor = NONE` och `spelbarOverride = NONE`, även om `xFactor` inte skickas. Skickas både `interesting: false` och ett `xFactor` som inte är `NONE` svarar servern 400 med "X-faktor kräver Intressant."
- `sourceSupport`: heltal 0–20 eller `null`. Annat ger 400 med "Källstödet ska vara ett heltal mellan 0 och 20." Okänt `xFactor` ger 400 med "Okänt läge för X-faktor."
- Efter loppets start, eller när hästen är struken, ger `xFactor` och `sourceSupport` 409 som övriga fält.
- Idempotent: samma body två gånger ger samma tillstånd.

**DTO-fält som frontend behöver (E2.1)**
| Typ (`lib/types.ts`) | Nya fält |
|---|---|
| `MarkDto` | `xFactor: "NONE" \| "TROR" \| "STARK"`, `xFactorAt: string \| null`, `xFactorValue: number` (1 för `NONE`, annars användarens faktor), `riktoddsX: number \| null` (null när riktodds saknas), `sourceSupport: number \| null`. Befintliga `riktodds` är oförändrat riktoddset utan X. `forslag` och `spelbar` räknas mot `riktoddsX` |
| `SettingsDto` och `RoundResponse.settings` | `xFactorTror: number`, `xFactorStark: number` |
| `RoundResponse` | `sourcesEnabled: number` |
| `StartDetailResponse` | Från E5: `tipSourceCount: number \| null` (förslaget till källstöd) |
| Statistik (E4) | `xFactor: { level: "TROR" \| "STARK" \| "NONE_INTERESTING", count, hits, expectedRikt, expectedRiktX }[]` |

Utan `Mark` (häst som aldrig har markerats) räknar klienten med `xFactor = NONE`, `sourceSupport = null` och `riktoddsX = riktodds`.

## 13. Projekt och teknik [E1]
- **Struktur som `tabellgissningen-app`:**
  - kod i `app/`, `components/`, `lib/`, `prisma/`, `styles/tokens.css` och `test/fixtures/`
  - `vercel.json` med crons
  - `docs/DESIGN.md` och `docs/specs/`.
- **Beroenden** som i Tabellgissningen (next 14, react 18, prisma 5, jose, bcryptjs, vitest) plus `node-html-parser`. Från E5 tillkommer `@anthropic-ai/sdk`. Inget UI-bibliotek, inga ikonpaket (inline-SVG) och inget bibliotek för datum (använd `Intl` med `timeZone: "Europe/Stockholm"`).
- **Miljövariabler:** `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET` och `CRON_SECRET`, plus `ANTHROPIC_API_KEY` från E5.
- **Rena funktioner med vitest-tester:**
  - `lib/phase.ts` (fas och Nästa steg)
  - `lib/spelbar.ts`
  - `lib/xfactor.ts` (E2.1: faktor per läge, `riktoddsX` med golvet 1,01, nästa läge vid X och Shift + X, X-steget i beräkningsraden, kontroll av faktorer och källstöd)
  - `lib/gallop.ts` (G/GD och formrutor)
  - `lib/alarms.ts` (villkor och livscykel)
  - `lib/riktodds.ts` (z-värden, softmax, Harville, avrundning och förklaring)
  - `lib/coupon.ts` (kostnad, förslag och kopieringstext)
  - `lib/odds-input.ts` (siffror till odds, gränser och automatiskt hopp)
  - `lib/atg.ts` (mappning mot fixturer)
  - `lib/travstatistik.ts` (tolkning mot sparade HTML-fixturer)
  - `lib/names.ts`
  - `lib/race-class.ts`
  - `lib/outbox.ts` (kö, idempotens och väntetid)
  - `lib/stats.ts` (aggregering och undantag för strukna).
- **Förhandsvisning:** skärmbilder i 390 och 1280 px, ljust och mörkt, för de skärmar som etappen ändrar (som `scripts/preview` i Tabellgissningen). Byggagenterna lämnar dem för granskning.

---

## 14. Acceptanskriterier

### E1 – Grunden
- [ ] Mikael kan logga in, logga ut och byta lösenord. Utloggad användare skickas till `/login`, och API:t svarar 401.
- [ ] Hämta omgång hittar nästa V85 (även på söndag kväll) och sparar 8 avdelningar med alla starter, hästar, kuskar, tränare och streck. Stegraden visar förloppet.
- [ ] Om ett steg misslyckas visas felet, och Försök igen fortsätter från samma steg utan att data dubbleras.
- [ ] Hämta igen uppdaterar strykningar, kuskbyten och streck och visar ändringarna. Intressant, granskningar och kommentarer finns kvar.
- [ ] S1 visar fasrad, rätt fas enligt 3.1, ett enda Nästa steg enligt 3.2, hämtningstid och 8 avdelningar med antal Intressant och "Ej genomgången".
- [ ] S2 visar alla 12 hästar i avd 7 utan skroll på 390 × 844. Raderna är 44 px. Vyrubrik och flikar ligger fast med 15 hästar.
- [ ] Byte av avdelning via flik, svep eller pil gör inget nätverksanrop.
- [ ] Formrutorna och G/GD följer 6.2, och en struken häst visas enligt S2.
- [ ] Intressant sparas optimistiskt, överlever omladdning och offline (utkorgen), och avvisas med 409 efter loppets start.
- [ ] "Inga intressanta här" markerar avdelningen som genomgången och går att ångra.
- [ ] Hästkortet visar 5 senaste starter med galopp och diskning markerade, alla egna kommentarer om hästen från alla omgångar och en ny kommentar som sparas och syns i nästa omgång där hästen startar.
- [ ] S2b visar vinst % per startnummer för distansen och startmetoden från travstatistik.se, favoritstatistik och kuskarnas och tränarnas form. Okopplade namn visas med "ej kopplad". Läser sidan en annan omgång står "Statistik saknas just nu".
- [ ] S8 går att använda för att lägga till, ändra och ta bort källor. Hämta tips är avstängd med förklaring.
- [ ] Tema (System, Ljust, Mörkt) fungerar utan blink. Kontrast, fokus, tangentbord och reducerad rörelse följer DESIGN.md.
- [ ] vitest täcker funktionerna i 13 för E1, och mappningen testas mot `game.json`.

### E2 – Riktodds, odds och spel
- [ ] Riktodds v1 räknas för alla startande som inte är strukna. Summan av P3 i ett lopp är 3 (± 0,01). Osäkra hästar märks.
- [ ] Hästkortet visar riktodds, högst 3 + 3 skäl och beräkningsraden.
- [ ] Vikterna kan ändras i S10. Det skapar en ny modellversion och räknar om omgången.
- [ ] S4 med knappsatsen: 3-1-0 ger 3,10, sparas och hoppar till nästa häst inom 350 ms. Fyra siffror kräver Nästa. Intervallet 1,01–99,99 kontrolleras. Tangentbordet fungerar på desktop.
- [ ] Spelbar följer 6.1. Kentucky River (Unibet 3,10 mot riktodds 2,40) föreslås, och Diva Ek (1,25 mot 1,35) föreslås inte. Mikael kan ta bort och sätta Spelbar, och manuella val står kvar när oddset ändras.
- [ ] Odds under riktlinjen 2,00 får taggen "Under 2,00" men blockeras inte.
- [ ] Sammanfattningsarket efter S4 visar Spelbara och övriga och går att stänga direkt. Det finns ingen tvingande bekräftelse.
- [ ] Bet kan sättas på vilken häst som helst fram till loppets start och sparar bet-odds.
- [ ] S6b: rader, kostnad och kvar räknas om direkt med radpris 0,50. Föreslå inom budget följer 6.5 och respekterar låsta avdelningar. Kopiera rad ger texten i 6.5.

### E2.1 – X-faktor och källstöd
- [ ] `riktoddsX = max(1,01, round2(riktodds / faktor))`: med standardfaktorerna ger riktodds 3,00 värdet 2,40 (Tror på) och 2,00 (Stark känsla), 3,20 ger 2,56 och 2,13, och 1,20 med Stark känsla ger 1,01. Testat i `lib/xfactor.test.ts`.
- [ ] Spelbar räknas mot riktoddset med X-faktor: en Intressant häst med riktodds 3,20 och Unibet 2,80 föreslås inte utan X men föreslås med Tror på (2,56). Ett `override` ON eller OFF står kvar när X ändras.
- [ ] Riktlinjen 2,00 gäller fortfarande Unibet-oddset: Unibet 1,90 får taggen "Under 2,00" även om riktoddset med X-faktor är lägre.
- [ ] Att sätta Tror på eller Stark känsla på en häst som inte är Intressant tänder Intressant. Att släcka Intressant sätter X-faktor till Ingen, visar "X-faktor togs också bort · Ångra" (eller "Spelbar och X-faktor togs också bort · Ångra"), och Ångra återställer Intressant, Spelbar och X-faktor i ett anrop. Källstödet ligger kvar.
- [ ] Hästkortet visar `XFactorBlock` med tre lägen, effektraden "Riktodds 3,00 · med X-faktor 2,40", `RiktoddsBox` med båda värdena och beräkningsraden med X-steget. Allt ändras direkt när läget byts, utan nätverksanrop för visningen.
- [ ] Källstödet visar "n av m källor pekar ut hästen" där m är antal påslagna källor. Stegaren går 0–m, Rensa ger "Inte ifyllt", och utan påslagna källor visas länken till Källor.
- [ ] S2 mobil: X-märket efter namnet och riktoddset med X-faktor i kolumnen Rikt. Avd 7 med 12 hästar får fortfarande plats utan skroll på 390 × 844 och raderna är 44 px. Desktop visar två rader i Rikt.
- [ ] S4: X-knappen i hästkortet stegar läget. Utan tryck på X är flödet och 350 ms-hoppet oförändrat. Tryck på X under 350 ms-fönstret avbryter hoppet, oddset står kvar, resultatraden räknas om och Nästa krävs.
- [ ] Tangenten X (och Shift + X) fungerar i S2 desktop, S3 och S4, men inte i textfält, i öppna ark eller i S7.
- [ ] S6a och sammanfattningsarket visar "rikt 3,00 → X 2,40" och skillnaden räknas mot riktoddset med X-faktor.
- [ ] S10: faktorerna kan ändras inom 1,05–3,00, Stark känsla måste vara större än Tror på, felmeddelandena i 6.8 visas vid fältet, och förslagen i aktuell omgång räknas om direkt.
- [ ] X-faktor och källstöd sparas optimistiskt, överlever omladdning och offline (utkorgen, utan dubbletter) och avvisas med 409 efter loppets start eller när hästen är struken. Låsta reglage är avstängda med förklaring.
- [ ] `Outcome` fryser `xFactor`, `xFactorValue`, `riktoddsX`, `sourceSupport` och `sourceTotal` vid loppets start. En senare ändring av faktorerna i S10 ändrar inte frysta rader.
- [ ] Skärmläsare: lägesväljaren är en `radiogroup` med piltangenter, X-märket läses som "X-faktor: Tror på", och riktoddset i S2 läses som "Riktodds 3,00, med X-faktor 2,40". Kontrasten för märket och `--accent`-siffran håller i båda teman.

### E3 – Utgångsläge, live och larm
- [ ] Cron-jobbet på fredagen sparar exakt en BASELINE per omgång, även om omgången inte var hämtad. Det kan köras om utan dubbletter.
- [ ] Från lördag 12:00 uppdateras S5 var 5:e minut medan sidan syns, och pausas när den inte syns. Flera öppna flikar ger högst en ATG-hämtning per 4 min (claim).
- [ ] "Uppdaterad hh:mm · nästa hh:mm" stämmer. Före 12:00, utan utgångsläge, vid fel och offline visas lägena i S5.
- [ ] Rusning (omarkerad > +T) och Tappar (egen < −T) larmar enligt 6.3, med röd prick på fliken och kort i S5. Kvittera och Ångra fungerar. Ett nytt larm kommer först efter återställningen.
- [ ] Gränsen T kan ändras i S10 och gäller vid nästa läsning. Exemplet Mateo di Quattro 5,0 → 17,0 % ger Rusning med T = 10.

### E4 – Under loppet, placering och statistik
- [ ] I S7 gör hästbyte (tryck, remsa, svep, siffror eller ←/→) inget nätverksanrop och tar under 100 ms på en mellanklassmobil.
- [ ] Snabbval och fritext sparas optimistiskt. Med nätet avstängt står "I kö (n)", och allt skickas när nätet är tillbaka, utan dubbletter.
- [ ] Kortkommandona i 6.6 fungerar på desktop och är avstängda i fritextfältet. ? visar hjälpen.
- [ ] Placering hämtas automatiskt (poll varje minut efter start, och cron som reserv). Visningen är 1–4 och sedan "5 eller sämre", och Bet visar träff vid 1–3.
- [ ] Ändringar av I, S, B och odds avvisas efter start, och `Outcome` fryses vid start.
- [ ] Omgången blir Klar när alla lopp har resultat, och S1 visar summeringen.
- [ ] S9 visar topp 3-andel för I, S och B per period och uppdelning. Strukna och inställda lopp räknas inte.
- [ ] S9 visar X-faktorrutan enligt 6.7: faktisk topp 3-andel mot väntad enligt riktoddset och enligt riktoddset med X-faktor, från de frysta värdena.

### E5 – Hämta tips
- [ ] Hämta tips läser påslagna källor och lägger fakta på rätt hästar i aktuell omgång. Status per källa visas, och fel stoppar inte övriga källor.
- [ ] Spärrarna i 11 gäller. Tomt resultat ger "Inga tips för omgången ännu".
- [ ] Hästkortet föreslår källstöd från tipsen ("Hämta tips räknade 3" med Använd) utan att skriva över Mikaels värde.

## 15. Utanför omfånget
- Att spela hos ATG eller Unibet från appen, eller att hämta Unibet-odds automatiskt.
- Kronor, insatser, vinst och förlust i statistiken.
- Push-notiser, e-post och SMS. Larm visas bara i appen.
- Flerspelarfunktioner, delning, registrering och glömt lösenord (kan läggas till som i Tabellgissningen).
- Andra spelformer än V85, och vinnarodds.
- Kalibrering av riktoddsmodellen och backtest-körningar (bara förberett, se 7.6).
- Egen mobilapp. Webbappen ska fungera i mobilens webbläsare och kan sparas på hemskärmen (manifest som i Tabellgissningen).
- Att appen sätter X-faktorn själv, eller att källstödet påverkar riktoddset.

## 16. Beslut som tagits i specen
1. **4C är borttagen som egen skärm** och ersatt av ett sammanfattningsark när S4-kön är klar. Arket går att stänga direkt. Skälet står i S4.
2. **Spelbar räknas fram och lagras inte.** Mikaels val lagras som `override`, och värdet fryses i `Outcome` vid start. Det ger "förslaget sätts och han avmarkerar" utan att två fält riskerar att visa olika saker.
3. **Spelbar är en delmängd av Intressant.** Att sätta S sätter I, och att ta bort I tar bort S (med Ångra).
4. **Allt per start låses vid loppets starttid.** Kommentarer är undantagna. Det gör statistiken ärlig.
5. **Hämta omgång körs som en stegkedja från klienten**, så att Vercels tidsgräns för funktioner inte blir ett problem. Ett misslyckat steg kan återupptas.
6. **Två cron-jobb:** utgångsläget på fredagen (krävs) och resultat på lördagskvällen (reserv, så att statistiken blir komplett även om appen var stängd). Hämta omgång har inget cron-jobb.
7. **Resultat pollas varje minut** i högst 30 minuter efter ett lopps start. Annars gäller 5 minuter.
8. **Larm har en återställning med 2 pe marginal**, så att en häst som pendlar kring gränsen inte larmar om och om igen.
9. **Riktoddset v1 använder inte strecket** (vikt 0), så att det blir oberoende av marknaden. Det kan ändras med en vikt.
10. **"Spår" i statistiken är startnumret**, samma mått som travstatistik.se använder.
11. **X-faktor är en delmängd av Intressant**, som Spelbar. Att sätta X tänder I, och att släcka I nollställer X (med Ångra). X utan I skulle inte ha någon verkan.
12. **X-faktorn räknas fram och lagras bara som läge.** `riktoddsX` räknas vid läsning från riktoddset och användarens faktor, och fryses i `Outcome` vid start. Då slår en ändrad faktor igenom direkt på kommande lopp utan omräkning, medan historiken står fast.
13. **X-faktorn sätts i hästkortet, i S4 och med tangenten X på desktop**, inte i mobilens S2-rad. Raden har ingen plats för ett reglage till, och hästkortet är ett tryck bort. I S4 är X en egen knapp utanför knappsatsen, så att 350 ms-hoppet är oförändrat för den som inte trycker på den.
14. **S2 visar riktoddset med X-faktor i kolumnen**, eftersom det är det värdet Spelbar räknas mot. Det vanliga riktoddset syns i hästkortet, på desktop och i skärmläsartexten.

## 17. Öppna frågor
1. **Var ska koden ligga** (`BettingBBW/` eller en ny mapp `spelvarde-app/`), och ska det vara ett nytt Supabase-projekt och ett nytt Vercel-projekt? Förslag: nya projekt med namnet `spelvarde`.
2. **Vercels plan:** Hobby tillåter två dagliga cron-jobb, vilket räcker. Behövs fler (t.ex. en reserv för utgångsläget) krävs Pro.
3. **travstatistik.se:** får sidorna läsas automatiskt (villkor, robots), och hur ofta? Specen läser dem bara vid Hämta omgång och Hämta igen.
4. **Kuskform:** räcker "vinst % i år" från ATG i v1, eller ska formen vara de senaste 30 dagarna (kräver kuskens starter, vilket ger fler ATG-anrop)?
5. **Kopiering till ATG:** räcker textformatet i 6.5, eller ska raden följa ATG:s inklistringsformat om ett sådant finns?
6. **Tidigare omgångar:** hur långt bak ska S1 visa omgångar, och ska de gå att öppna med full detalj (finns i datan)?
7. **Bet utan Unibet-odds:** ska Bet få sättas utan odds? I specen går det, och då saknas oddset i statistiken.
8. **Inställda lopp och omstarter:** hur ska de visas utöver att de inte räknas? ATG:s fält verifieras i E1.
9. **E5:** vilka källor, och vilken kostnad per körning för Claude-API:t är rimlig?
10. **Mockupfilerna** ligger i en tillfällig mapp och behöver flyttas till `BettingBBW/docs/mockups/` (se DESIGN.md).
11. **X-faktor och V85-raden:** specen låter 6.5 sortera på riktoddset med X-faktor, så att X-hästar hamnar före i förslaget. Vill Mikael hellre att V85-raden bara följer det vanliga riktoddset?
12. **Källstöd utan X-faktor:** källstödet går att fylla i på alla hästar, även de som inte är Intressant. Räcker det, eller ska det bara visas för Intressant?
13. **X-märkets form:** "X" och "X+" på tavelfärg är ett förslag utan mockup. Mikael får se det i förhandsvisningen efter bygget och kan be om ändring.

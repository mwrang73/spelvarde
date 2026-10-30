# E7 – Ladda ner raden som ATG-fil

Status: spec 2026-10-30. Ingen mockup, Mikael har valt bort den. Beteende och texter står här, och utseendet följer `docs/DESIGN.md`. Där den här filen och E6 eller E6b säger olika gäller den här filen.

**Filformatet är inte provat mot ATG, se avsnitt 2. Mikael måste prova en fil skarpt, utan att bekräfta spelet, innan funktionen räknas som klar.**

**Underlag i koden**
- `components/spel/RadSheets.tsx` (`RadAtgSheet`, `useFocusOnOpen`), `RadPanel.tsx` (`copyNow`, `copyString`, `blocked`, `.dact`, `CopyButton`, `legacyBody`, arket "Spela hos ATG", reservarket copy-fallback), `RadActionBar.tsx`, `Kupong.tsx`
- `components/ui/Sheet.tsx`, `Toast.tsx`, `icons.tsx` (`IconDownload`, `IconTicket`, `IconCopy`, `IconExt` finns redan)
- `lib/coupon.ts` (`couponText`, `couponCost`, `DEFAULT_ROW_PRICE`), `lib/game-type.ts` (`legName`, `legNames`, `legsFor`, `GAME_ID_RE`), `lib/stockholm-time.ts` (`stockholmParts`), `lib/tippa-text.ts` (`copyBlockedReason`, `copyChangedText`, `krText`, `OFFLINE_TEXT`), `lib/phase.ts`
- `styles/app.css` (`.drad-l`, `.dact`, `.shbtns`, `.sheet-in`)

---

## 1. Mål och användare

Mikael har byggt raden i Spelvärde och vill spela den hos ATG utan att fylla i den för hand. Han laddar ner en fil från appen och laddar själv upp den under Spela reducerat → Filinlämning. **Appen lämnar aldrig in något.** Nästa steg efter vyn är att jämföra rader och pris hos ATG och bekräfta där.

Tre ändringar:
1. Knappen **Ladda ner ATG-fil** i rutan "Spela hos ATG", i mobil och webbläsare.
2. Knappen som öppnar rutan flyttas på desktop till direkt under budgetrutan, och heter **Spela hos ATG** i stället för Kopiera till ATG.
3. Uppmaningen "Klistra in hos ATG" tas bort. Vi har inte belägg för att ATG har något inklistringsfält.

Ingen ändring i databas eller API. Filen skapas i klienten och fungerar utan uppkoppling.

## 2. Det här är inte verifierat

Följande kommer från ett annat utvecklarprojekt (github.com/spangen87/v85-app, PR 109), som inte heller provade en riktig uppladdning. Det gick inte att bekräfta i ATG:s kod.
- Att elementet heter `v85Coupon`. Det publika schemat saknar V85.
- Att en kupong räcker för ett helt system.
- Att filnamnet ska ha en CRC, och att varianten är CRC-16/ARC.

Inte heller känt:
- Vad ATG tar som grundpris för en fil. Ingen körning har visat det, så appens kostnad kan vara fel även vid radpris 0,50 kr.
- Om ATG avvisar en V85-fil som pekar på schema 1.8.4, som saknar V85.
- Om tredje delen i `atgGameId` är samma sak som schemats `trackcode` (bara V86).
- Om Filinlämning finns i ATG:s mobilvy. Finns den bara på desktop går filen inte att använda i telefonen.
- Om nedladdningen fungerar när appen ligger på hemskärmen i iPhone.

**Skarp provning, Mikael (bekräfta inte spelet):**
1. Ladda ner filen för en öppen V85-omgång och ladda upp den hos ATG.
2. Kontrollera att ATG tar emot filen, att alla lopp och nummer stämmer mot kupongen i appen och att rader stämmer.
3. Notera ATG:s pris och jämför med appens kostnad.
4. Avbryt utan att bekräfta. Prova både mobil och desktop.

Utfall: Fungerar det tas banderollen "inte provad" bort (avsnitt 7) och det här avsnittet uppdateras. Avvisar ATG filen rättas formatet efter felmeddelandet, och knappen ska inte räknas som klar. Provningen gäller bara V85. När V75 tar över i slutet av november provas V75 på samma sätt.

## 3. Filformatet

**Källa:** `https://www.atg.se/services/schemas/filebet/1.8.4/atg_filebetting.xsd` (kopia i `/tmp/claude-atg/a.xsd`, ska kopieras till `test/fixtures/atg/atg_filebetting-1.8.4.xsd` eftersom `/tmp` inte är beständig). Nyare versioner svarar 404. Schemat innehåller v75Coupon, gs75Coupon och v86Coupon men **inte V85**.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<issuer xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://www.atg.se/services/schemas/filebet/1.8.4/atg_filebetting.xsd" company="Spelvarde" product="Spelvarde" version="1.0" createddate="YYYY-MM-DD" createdtime="HH:MM:SS" schemaversion="ATG File Betting XSD ver 1.8">
  <betcoupons>
    <v85Coupon couponid="1" date="YYYY-MM-DD" betmultiplier="1">
      <leg legno="1" marks="110100000000000"/>
    </v85Coupon>
  </betcoupons>
</issuer>
```

| Del | Regel |
|---|---|
| Text | UTF-8 utan BOM, radslut LF, indrag två blanksteg, en radbrytning efter `</issuer>`. Bara ASCII. Ingen fritext (banans namn, hästnamn) skrivs, så inget behöver escapas. |
| `createddate`, `createdtime` | Tiden vid klicket i svensk tid (`stockholmParts`), nollfyllt, 24-timmars. |
| Element | V85 → `v85Coupon`, V75 → `v75Coupon`, GS75 → `gs75Coupon`, V86 → `v86Coupon`. |
| `couponid` | Alltid 1. Hela systemet är en kupong. |
| `date` | Andra delen i `atgGameId` (`V85_2026-10-31_5_5`). `atgGameId` valideras med `GAME_ID_RE`. |
| `trackcode` | **Bara V86**, där schemat kräver det: tredje delen i `atgGameId`, heltal 1–99. Skrivs aldrig på andra spelformer. |
| `betmultiplier` | Alltid 1. Se nedan. |
| `leg` | Ett per lopp i ordning, `legsFor(gameType)` stycken, `legno` 1 och uppåt. |
| `marks` | 15 tecken 0/1 för startnummer 1–15, från vänster. |
| Skrivs inte | `r1`, `r2` (reserver), `v7`, `v8`. |
| Filnamn | `{spelform med gemener}_{date}_{crc}.xml`, till exempel `v85_2026-10-31_abcd.xml`, `gs75_2026-11-29_0a3f.xml`. |
| CRC | CRC-16/ARC av filens hela text i UTF-8: polynom 0x8005 reflekterat 0xA001, init 0. Fyra tecken gemen hex, nollfyllt. |

**`betmultiplier`:** antal gånger kupongen spelas. Schemats regel tillåter heltal 1–100, men dess dokumentation säger att bara 1, 2, 5, 10, 20, 50 och 100 är giltiga. Eftersom grundpriset inte är känt härleds värdet aldrig från radpriset. Det är alltid 1 i den här etappen.

## 4. Användarflöde

1. Mikael bygger raden och trycker **Spela hos ATG**: handlingsraden i mobilen, under budgetrutan på desktop.
   - `blocked` är satt: knappen är avstängd och arket öppnas inte (avsnitt 6).
2. Arket visar eventuella fel och varningar, kupongen, stegen och knapparna.
   - Filen kan inte skapas: Ladda ner ATG-fil är avstängd och orsaken står i arket. Kopiera texten och Öppna ATG fungerar.
3. Han trycker **Ladda ner ATG-fil**. Filen skapas med aktuell tid och webbläsaren laddar ner den. Arket står kvar, statusraden visar filnamnet och raden sparas som uttagen (`copiedAt`).
   - Nedladdningen kastar ett fel: felbanderoll, `copiedAt` sätts inte.
   - Spelstopp har passerat sedan arket öppnades: ingen fil, felbanderoll.
4. Han trycker **Öppna ATG** (ny flik), går till Spela reducerat och sedan Filinlämning, och laddar upp filen.
5. Han jämför rader och pris hos ATG med stegets värden och bekräftar där.
   - ATG tar inte emot filen, eller filen hittas inte: han fyller i raden för hand med kupongen som stöd, eventuellt med Kopiera texten.
6. Ändras raden efteråt (strykning, nytt streck): banderollen "Raden har ändrats" visas, och han laddar ner en ny fil.

## 5. Mockups

Inga, Mikael har valt bort dem.

## 6. Komponentspec

### 6.1 Knappen Spela hos ATG

**Beslut: knappen byter namn från Kopiera till ATG till Spela hos ATG, i alla tre lägen.** Knappen öppnar en ruta med flera val och den kopierar inget, så det gamla namnet stämmer inte. Spela hos ATG är samma ord som rubriken i rutan. "Hos ATG" säger att spelet läggs där och inte i appen. Beslutet ersätter E6b:s "Handlingsraden heter fortsatt Kopiera till ATG".

| Plats | Ändring |
|---|---|
| Desktop (`CopyButton`, `.dact`) | Ny plats, text, ikon och synlig orsak, se nedan |
| Mobil (`RadActionBar`) | **Bara text och ikon.** Plats, storlek, summan och beteendet är oförändrade. Texten blir kortare, så den ryms ner till 360 px |
| Banderollen "Raden har ändrats" | Sekundära knappen får samma text och ikon |

Ikon: `IconTicket` i stället för `IconCopy`. `aria-haspopup="dialog"` behålls.

**Desktop (≥ 1024 px):** `.dact` flyttas till direkt efter budgetrutan. Ordningen i `.drad-l` blir budgetrutan, `.dact`, budgetbanderollen, Regler för raden. DOM-ordningen ska vara densamma, så fokusordningen följer med.
- `.dact` behåller `margin-top: 12px` och `.d-only`. `.drad-l` behåller sticky och egen skrollning.
- Under knappen står `.help` (centrerad): "Visar kupongen, ATG-filen och texten att kopiera".
- Är knappen avstängd ersätts hjälptexten av orsaken från `blocked`, synligt, kopplad med `aria-describedby`. Den dolda `.sr`-texten i `CopyButton` tas bort.
- Krav: knappen och hjälptexten ska synas utan skrollning vid 1280 × 720 och 1024 × 600 med sidan oskrollad, och i alla budgetlägen utom öppet radprisfält.

### 6.2 Arket Spela hos ATG (`RadAtgSheet`)

Titel och underrad är oförändrade. Ordning uppifrån:

1. **Fel och varningar** (`Banner`, `.radsh .ban`), avsnitt 6.3. Överst så att de syns utan skrollning.
2. **Kupongen** (`Kupong`), oförändrad.
3. **Stegen:** rubriken "Så spelar du raden" i samma stil som `.sl`, sedan en `ol` med synliga nummer, 14 px Barlow, `--ink`, 4 px mellan stegen. Texter i avsnitt 8.
4. **Banderollen "inte provad"** (`Banner warn`) tills skarp provning är gjord.
5. **Hjälptext** (`.help`): meningen om allgardering och meningen om texten.
6. **Statusrad och knappar** (avsnitt nedan), klistrade mot arkets underkant.

**Knapparna. Beslut:**

| Ordning | Knapp | Variant | Varför |
|---|---|---|---|
| 1 | **Ladda ner ATG-fil** (`IconDownload`) | `primary`, hela bredden | Det är det enda sättet att få in raden utan att skriva den för hand |
| 2 | **Öppna ATG** (`IconExt`) | `secondary`, vänster halva | Nästa steg efter nedladdningen |
| 3 | **Kopiera texten** (`IconCopy`) | `ghost`, höger halva | Stöd vid ifyllning för hand |

- `.shbtns` får en variant med två lika kolumner där primärknappen spänner över båda. Övriga ark är oförändrade. Alla knappar minst 44 px höga.
- Ladda ner är en `button`, eftersom filen skapas vid klicket med aktuell tid. Öppna ATG är en länk till `https://www.atg.se/spel/reducerat` i alla spelformer, med `target="_blank"` och `rel="noopener noreferrer"`.
- **Klistring:** kupongen och stegen gör arket högre än 80 dvh i mobilen, och Mikael har redan missat en knapp under kanten. Statusraden och knapparna ligger därför kvar synliga mot arkets underkant när innehållet skrollar, utan glipa under, med bakgrund `--surface`, linje `--line` överst och plats för `safe-area-inset-bottom`. Vid fönsterhöjd under 560 px (liggande telefon) klistras de inte, utan ligger sist i flödet.
- Fokus när arket öppnas: primärknappen, som i dag. Är den avstängd: första aktiva knappen.

**Statusraden** (`role="status"`, 13 px, ovanför knapparna, finns alltid i DOM, tom utan innehåll). Långa filnamn bryts, och filnamnet står i JetBrains Mono.
- Efter nedladdning: "Filen {filnamn} är skapad {hh:mm}. Du hittar den bland nedladdade filer."
- Efter kopiering: "Raden är kopierad."
- Ändras filens innehåll medan arket är öppet: "Raden har ändrats sedan filen laddades ner. Ladda ner en ny fil."

**Toasten tas bort ur `copyNow`, och statusraden ersätter den.** `Toast` ligger utanför arkets modala `<dialog>`, alltså under dialogen och utanför det som skärmläsaren når, och i mobilen dessutom bakom arket. Ingen toast används i det här arket.

**Nedladdningen:** `application/xml`, en temporär länk med `download` och filnamnet. Adressen släpps först en kort stund efter klicket, så att Safari hinner hämta den. Webbläsaren säger inte om filen sparades, så texten lovar bara att filen är skapad.

### 6.3 Lägen

| Läge | Knappen i vyn | Ladda ner i arket | Visas i arket | Sparas som uttagen |
|---|---|---|---|---|
| Normal (`live`) | Aktiv | Aktiv | Stegen, knapparna | Ja |
| `blocked` satt (ryms inte, ingen data, struken egen spik, inga startande, ingen sparad rad) | Avstängd, arket öppnas inte | Blir `blocked` satt medan arket är öppet: avstängd | Orsaken från `blocked` i `Banner err` | Nej |
| Startnummer över 15 | Aktiv | Avstängd | `Banner err`, `role="alert"`, per lopp | Vid Kopiera, inte av filen |
| Inga valda hästar i ett lopp, eller alla valda strukna | Aktiv | Avstängd | `Banner err`, per lopp | Vid Kopiera, inte av filen |
| Radpris som inte är 0,50 kr | Aktiv | Aktiv, **blockeras inte** | `Banner warn` (avsnitt 8) | Ja |
| Allgarderat lopp | Aktiv | Aktiv | Hjälptexten | Ja |
| Struken häst i valet (bara gammal rad, `live` tar bort den själv) | Aktiv | Aktiv | `Banner warn` per häst, filens rader och kostnad i steg 4 | Ja |
| Gammal rad (`legacy`) | Aktiv | Aktiv | Som normal, utifrån den sparade raden | Ja, med `legacyBody` |
| Efter start (`started`) | Aktiv | **Visas inte** | Kupongen, en mening (avsnitt 8), bara Kopiera texten som `primary`. Stegen, Öppna ATG och banderollen "inte provad" visas inte | Nej, som i dag |
| Spelstopp passerar medan arket är öppet | – | Kontroll vid klicket mot aktuell tid (`raceStarted`): ingen fil skapas | `Banner err`, nästa rendering blir `started` | Nej |
| Offline | Aktiv | Aktiv | Som normal. `copiedAt` sparas i utkorgen som i dag | Ja |
| Nedladdningen kastar ett fel | – | Aktiv, kan provas igen | `Banner err`, `role="alert"` | Nej |
| Preliminär rad, över budget (`OWN_OVER_BUDGET`) | Aktiv | Aktiv | Som normal, vyns banderoller förklarar läget | Ja |

**Felen avgörs när arket renderas**, inte vid klicket, så att knappen är avstängd med synlig orsak från början.

**Strukna hästar:**
- Filen markerar aldrig en struken häst, i någon rad.
- **Allgarderat lopp:** alla startande i valet markeras men inte strukna. `live` har redan tagit bort dem ur valet, så ingen varning behövs: valet har inte ändrats. Kupongen visar den strukna hästen med snedstreck.
- **Struken häst i valet:** kan bara hända i en gammal rad. Den tas bort ur filen och varningen visas. Rader och kostnad i steg 4 och varningen räknas från filen, så att Mikael jämför rätt värden hos ATG.
- **Struken efter uppladdning:** appen vet inget om det. Banderollen "Raden har ändrats" visas, och ATG:s regler gäller för filen som redan är inlämnad.

**Inställt lopp:** valet (1 häst, `cancelledSel`) markeras som vanligt så att filen har ett `leg` för varje lopp. Hur ATG hanterar det är inte provat. Har loppet ingen häst att markera är det ett fel.

**Radpriset:** filen har inget fält för radpris, så Spelvärdes radpris påverkar aldrig filen. Skiljer sig `view.rowPrice` från `DEFAULT_ROW_PRICE` visas varningen. Filen går att ladda ner, eftersom priset ändå ska jämföras hos ATG.

### 6.4 Räknas nedladdningen som kopierad? Ja.

**Rekommendation: ja, en lyckad nedladdning sätter `copiedAt` och `copiedSelections`,** med samma två vägar som `copyNow` (`live` och `legacy`, inte `started`). Annars skulle Mikael kunna ladda ner en fil, få en strykning och inte se någon varning, vilket är det läge varningen finns för. Fälten behåller namnen, så ingen migrering behövs. Till skillnad från Kopiera, som sparar även när urklippet misslyckas, sparas nedladdningen bara när den inte kastat fel. Banderollens text ändras (avsnitt 8).

### 6.5 Ren funktion `lib/atg-file.ts`

Utan DOM, React eller klocka. Blob och länk ligger i komponenten.

**In:** `gameType`, `atgGameId`, `now` (`Date`) och per lopp: `leg`, `selection`, `scratched` (`{ number, name }[]`), `cancelled`.

**Ut:** antingen `ok` med `xml`, `filename`, `rows`, `markedByLeg` och `removed` (strukna som togs bort: `leg`, `number`, `name`), eller fel med en lista där varje post har `code`, `leg` (eller null), `numbers` och färdig `text`.

**Ordning per lopp:** ta bort strukna, kontrollera över 15, kontrollera tomt. Alla fel samlas, inte bara det första. Ett struket nummer över 15 är inget fel.

**Var indata kommer ifrån:** i `live` och `started` från `view.legs`. I `legacy` från `selectionsOf(saved)`, samma källa som `copyString`. `scratched` kommer från `view.legs[].scratched`. Rendering anropar med aktuell tid, och klicket anropar igen med ny tid, så att filen får rätt `createdtime` och CRC.

**Testfall (`lib/atg-file.test.ts`).** `now` = `2026-10-31T12:05:09Z` om inget annat anges.

| # | Fall | Förväntat |
|---|---|---|
| 1 | V85, 8 lopp, `V85_2026-10-31_5_5` | Hela texten exakt som facit (avsnitt 3), `createddate="2026-10-31"`, `createdtime="13:05:09"`. Facit tas fram med oberoende verktyg, inte funktionen själv |
| 2 | Lopp och ordning | `legno` 1–8 i ordning, exakt 8 `leg` |
| 3 | V75, GS75 | `v75Coupon`/`gs75Coupon`, 7 `leg`, ingen `trackcode`, filnamn `v75_…`/`gs75_…` |
| 4 | V86 | `v86Coupon`, `trackcode="5"`, 8 `leg`, filnamn `v86_…` |
| 5 | V85 | Ingen `trackcode` |
| 6 | Schema | Utfall V75, GS75, V86 valideras mot xsd-kopian (`xmllint` eller motsvarande, engångskontroll). V85 kan inte valideras |
| 7 | Alltid | `couponid="1"`, `betmultiplier="1"` oavsett radpris, ingen `r1`, `r2`, `v7`, `v8` |
| 8 | Marks: 1, 2, 4 | `110100000000000` |
| 9 | Marks: 15 | `000000000000001` |
| 10 | Marks: 1–15 | `111111111111111` |
| 11 | Marks: osorterat och dubbletter `[4, 1, 2, 4]` | `110100000000000`, 15 tecken |
| 12 | Allgarderat, 1–6 och 8–12 valda, 7 struken | `111111011111000`, tom `removed` |
| 13 | Struken i valet: 3, 8, 11 med 8 struken | `001000000010000`, `removed` = 8 med namn, `rows` räknad utan 8 |
| 14 | Inställt lopp med en häst | En markering, inget fel |
| 15 | CRC, kontrollvärde | ASCII `123456789` → `bb3d` |
| 16 | CRC, tom text och nollfyllnad | Tom text → `0000`, värdet 0x0A3F formateras `0a3f` |
| 17 | Filnamn | `v85_2026-10-31_` + CRC av exakt den returnerade texten + `.xml`. Skild `now` ger skild CRC |
| 18 | Text | Bara ASCII, ingen BOM, inga CR |
| 19 | Tid: sommartid `2026-07-01T12:00:00Z` | `14:00:00` |
| 20 | Tid: över midnatt `2026-10-30T23:30:00Z` | `createddate="2026-10-31"`, `createdtime="00:30:00"` |
| 21 | Fel: 16 i lopp 3 | `code` över 15, `leg` 3, text med "V85-3", exakt enligt avsnitt 8 |
| 22 | Fel: 16 och 17 i V75-2 | Text med "16 och 17" och "V75-2" |
| 23 | Fel i två lopp | Två poster |
| 24 | Struket nummer 16 | Inget fel, inte markerat |
| 25 | Fel: inga hästar i ett lopp, alla valda strukna, inställt utan häst, hela raden tom | Respektive text i avsnitt 8 |
| 26 | Fel: `atgGameId` matchar inte `GAME_ID_RE`, V86 med bana 120 | Texten för id |
| 27 | Inga fel-texter | Ingen text innehåller "Avd" eller "avdelning" |
| 28 | Mot `buildRad` (fixturen med Bjerke) | Avkodade `marks` = `result.selections`, `rows` = `result.rows` |

Texter som flyttas eller ändras i `lib/tippa-text.ts` testas i `lib/tippa-text.test.ts`, som ska uppdateras (rad 200 och 208).

### 6.6 Benämningar i nya texter

- Lopp skrivs alltid med `legName`/`legNames` och aktuell `gameType`: "V85-3", "V75-2", "V85-1 och V85-3" (`docs/DESIGN.md`). Aldrig "Avd", "avdelning" eller ett hårdkodat "V85-".
- Spelformen kommer från `round.gameType`, inte hårdkodad, så att allt fungerar när V75 tar över.
- Bara filnamnet har spelformen med gemener. `legno` i filen är siffran.
- Knappen och filen heter "ATG-fil"/"ATG-filen" och aldrig "XML-fil" i gränssnittet.

## 7. Tillgänglighet

- **Fokusordning desktop:** vyns banderoller › budgetrutan › Spela hos ATG › budgetbanderollens knappar › Regler för raden › strykningsbanderoller › pennorna. Mobilen är oförändrad.
- **Fokusordning arket:** Stäng (där `Sheet` har den), sedan knapparna i ordningen Ladda ner ATG-fil, Öppna ATG, Kopiera texten. Inga fokuserbara delar göms bakom den klistrade delen.
- **Status:** `role="status"` på statusraden, fel med `role="alert"` bara när de dyker upp. Arkets varningar har ingen `role`.
- **Avstängd Ladda ner:** `disabled` med `aria-describedby` till felbanderollen.
- **Stegen** är en riktig `ol`. Öppna ATG behåller `aria-label` "Öppna ATG (öppnas i ny flik)". Ikoner är `aria-hidden`.
- **Färg:** banderollerna har ikon och text. Ingen ny rörelse, och inget nytt färgvärde: bara `var(--…)`.

## 8. Texter

### Knappar och rubriker
| Plats | Text |
|---|---|
| Handlingsknapp, banderollens knapp | Spela hos ATG |
| Hjälptext under knappen, desktop | Visar kupongen, ATG-filen och texten att kopiera |
| Rubrik i arket | Så spelar du raden |
| Knappar i arket | Ladda ner ATG-fil · Öppna ATG · Kopiera texten |

### Stegen
1. Ladda ner ATG-filen.
2. Öppna ATG och gå till Spela reducerat och sedan Filinlämning.
3. Ladda upp filen.
4. Jämför rader och pris hos ATG med raden här: **{rader} · {kostnad}**. Bekräfta bara om allt stämmer. Ett bekräftat spel kan inte ångras.

Sista raden under stegen (`.help`): "Appen lämnar inte in något. Spelet läggs först när du bekräftar hos ATG."

### Hjälptext
- Allgarderat: "{V85-5} är allgarderad. Fyller du i raden för hand trycker du på **Alla** i {V85-5}."
- Alltid: "Texten som kopieras har loppen i ordning, och sist rader och kostnad. Den är ett stöd när du fyller i raden för hand."

### Banderoller i arket
| Läge | Ton | Text |
|---|---|---|
| Inte provad (tas bort efter skarp provning) | warn | **ATG-filen är inte provad hos ATG än.** Tar ATG inte emot den, fyll i raden för hand med kupongen. |
| Radpris | warn | **Radpriset i appen är {1,00 kr}.** Filen har inget radpris, så ATG kan visa ett annat pris än {288,00 kr}. Jämför priset innan du bekräftar. |
| Struken i valet | warn | **{8 Stål Viking} i {V85-7} är struken** och är inte med i ATG-filen. |
| Efter start | – (`.help`) | {V85} har startat, så ATG-filen går inte längre att ladda ner. |

### Felen (`err`)
| Kod | Text |
|---|---|
| Över 15 | Startnummer {16} i {V85-3} får inte plats i ATG-filen, som bara har startnummer 1–15. Ta bort hästen ur {V85-3}, eller fyll i raden för hand hos ATG. |
| Över 15, flera | Startnummer {16 och 17} i {V85-3} får inte plats i ATG-filen, som bara har startnummer 1–15. Ta bort hästarna ur {V85-3}, eller fyll i raden för hand hos ATG. |
| Tomt lopp | {V85-3} har inga valda hästar. Välj hästar i {V85-3} först. |
| Alla strukna | Alla valda hästar i {V85-3} är strukna. Välj nya hästar i {V85-3} först. |
| Inställt utan häst | {V85-3} är inställt och har ingen häst att markera. Fyll i raden för hand hos ATG. |
| Hela raden tom | Raden har inga valda hästar. |
| Fel id | Omgångens id hos ATG går inte att läsa, så ATG-filen kan inte skapas. Hämta omgången igen. |
| Spelstopp vid klick | {V85} har startat. ATG-filen skapades inte. |
| Nedladdningen misslyckades | Filen kunde inte laddas ner i den här webbläsaren. Prova igen, eller fyll i raden för hand hos ATG. |

### Texter som rättas
Toast-texten "Klistra in hos ATG" tas bort helt. Kopierad rad bekräftas med "Raden är kopierad." i statusraden.

| Var | Ny text |
|---|---|
| `lib/tippa-text.ts` `copyChangedText` | **Raden har ändrats sedan du laddade ner eller kopierade den** {i dag 14:05}. {V85-7 är ändrad.} Ladda ner en ny fil eller kopiera igen om du vill spela den nya raden. |
| `lib/tippa-text.ts` `OFFLINE_TEXT` | Ingen uppkoppling. Raden räknas om här och sparas när du är online igen. ATG-filen och kopieringen fungerar ändå. |
| `lib/tippa-text.ts` lopp utan startande | **{V85-3} har inga startande hästar.** Raden kan inte laddas ner eller kopieras förrän loppet är inställt hos ATG. Hämta omgången igen. |
| `lib/phase.ts`, Nästa steg `BUILD_COUPON` | Appen föreslår raden inom din budget. Sedan spelar du den hos ATG. |
| `scripts/preview-e2.mjs` rad 266 | Väntar på "Raden är kopierad." i stället. Skriptet letar också efter en knapp "Kopiera rad", så kontrollera att det över huvud taget fungerar. |
| `docs/DESIGN.md` rad 82 | V85-raden: budget, Spela hos ATG och regler till vänster. |
| `docs/specs/spelvarde.md` rad 291 och 973, `docs/specs/e6-v85-rad.md` rad 92, 295, 299, 313, 661, 803 | Tar bort påståendet om inklistring och pekar på den här specen. |

Reservarket copy-fallback ("Markera texten och kopiera den själv") är sant och oförändrat. Gamla mockups i `docs/mockups/` ändras inte.

## 9. Godkänt när

- [ ] Alla testfall i 6.5 går igenom, plus typkontroll och build.
- [ ] Skärmbilder, ljust och mörkt, 390 px och 1280 × 720: knappen under budgetrutan, arket med fil, arket med fel (startnummer 16), arket efter start.
- [ ] Knapparna i arket syns utan skrollning i 360 × 640 med 15 startande.
- [ ] En nedladdad fil öppnad: innehåll och filnamn stämmer. Provat i Chrome på desktop, Android och Safari på iPhone, också med appen på hemskärmen.
- [ ] Nedladdning och sedan ändrad rad ger banderollen. Ingen "Klistra in" finns kvar i `components`, `lib` och `scripts`.
- [ ] Den skarpa provningen i avsnitt 2 är gjord av Mikael. Den kan inte göras av `frontend-dev`.

## 10. Öppna frågor och antaganden

**Att besluta av Mikael**
1. Namnbytet ändrar texten och ikonen i `RadActionBar`, trots att mobilen annars är oförändrad. Godkänns det? Annars måste mobilen behålla ett namn som inte stämmer, eller skilja sig från desktop.
2. Fungerar nedladdningen inte med appen på hemskärmen i iPhone: räcker det att öppna Spelvärde i Safari, eller ska delningsarket läggas till i en senare etapp?

**Antaganden**
- `betmultiplier` är alltid 1, och reserver skrivs inte.
- Öppna ATG går till `/spel/reducerat`, även när filen inte kan skapas. Adressen svarar 200, men det säger inget om innehållet.
- Inga hästar i ett lopp markeras inte med en rad nollor, utan stoppar filen, även om schemats mönster tillåter nollor.
- Funktionen bygger på att schemat fortfarande gäller. Nyare versioner gick inte att hämta.

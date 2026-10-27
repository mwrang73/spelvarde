# Modellhistorik: riktodds v1 → v3

Sammanfattning av backtesterna 19–20 oktober 2026 och besluten de ledde till.
De fullständiga tabellerna finns i rapporterna bredvid:
`2026-10-19-v1.md` (v1 utan spår) och `2026-10-20-v1.md` (allt från spår till v3
och antalet signaler). Nya körningar skriver egna filer (`<datum>-<namn>.md`).

## Hur backtestet fungerar

- **Underlag:** alla V85-, V75-, V86- och GS75-omgångar 1 jan 2025 – 18 okt 2026
  från ATG: 2 181 lopp med minst 4 startande där alla har streck och vinnarodds.
- **Delning i tid:** de äldsta 1 527 loppen (t.o.m. 2 april 2026) används för att
  anpassa vikter. De senaste **654 loppen (från 3 april 2026)** används bara för
  att mäta. Alla siffror nedan gäller testdelen om inget annat står.
- **Inget läckage:** varje lopp ser bara data före loppdagen (tidigare starter,
  spårstatistik under två år före loppet). Hästens år/fjol och vinstsumma är
  ATG:s ögonblicksbild före loppet (stämmer i över 99 % av fallen).
- **Mått:**
  - *Log loss*: hur väl procentsatserna träffar. Lägre är bättre. Naiv gissning
    (alla lika) ger 0,580.
  - *Lägst odds topp 3*: hur ofta hästen med lägst riktodds kom topp 3.
  - *Kalibrering*: när modellen säger 40 %, blir det 40 %?
  - *ROI*: 1 kr på plats i ATG:s platspool med verklig utdelning.
- **Referenser:** marknaden ur strecket (log loss 0,5380) och ur vinnaroddsen
  (0,5010). Att spela plats på alla hästar ger −19,5 % (ATG:s avdrag).

## v1 – startpunkten (19 okt)

Vikter satta efter bedömning: plats 1,0 · vinst 0,5 · form 0,6 · spår 0,4 ·
kusk 0,3 · tränare 0,2 · galopp −0,4 · streck 0 · β 1.

| Variant | Log loss |
|---|---:|
| v1, β 1 | 0,7998 |
| v1, bästa β 0,25 | 0,5419 |
| Marknaden (streck) | 0,5380 |
| Marknaden (vinnarodds) | 0,5010 |

**Vad det betyder:** v1 hade rätt ordning på hästarna men var kraftigt
överkonfident (Nilla Lane fick 98 % topp 3). Med β 0,25 blev den rimlig men
fortfarande sämre än marknaden. Ingen regel av typen "platsodds > riktodds"
gick plus. Spåret kunde inte prövas eftersom det saknades historik.

**Beslut:** riktoddset med v1 ska inte användas som spelsignal. Bygg en egen
statistikbas så att spåret kan prövas.

## Statistikbasen och spåret (20 okt)

Alla svenska travlopp från ATG lästes in lokalt för okt 2023 – okt 2026
(21 727 lopp). Varje backtestlopp fick startnumrets plats % på sin distans och
startmetod ur lopp under de två åren före loppdagen.

| Variant | Log loss utan spår | Med spår |
|---|---:|---:|
| v1, bästa β | 0,5419 | 0,5394 |
| Anpassade vikter | 0,5393 | 0,5370 |
| Anpassade vikter + streck | 0,4928 | 0,4925 |

**Vad det betyder:** spåret ger en liten men verklig förbättring (vikt 0,13, i
nivå med kusk och tränare). Med strecket i modellen krymper vikten till 0,03:
spelarna har redan räknat in spåret när de streckar.

## v2 – strecket som grund (20 okt)

Den bästa anpassade modellen med streck hade flera små negativa vikter som
troligen är brus. v2 är den förenklade versionen:
**streck 0,88 · plats 0,10 · spår 0,03 · tränare 0,03 · β 1.**

| Variant | Log loss | Lägst odds topp 3 |
|---|---:|---:|
| Anpassade vikter + streck | 0,4925 | 62,8 % |
| **v2** | **0,4949** | **60,9 %** |
| Marknaden (vinnarodds) | 0,5010 | 61,8 % |

**Vad det betyder:** v2 är bättre än både strecket och vinnaroddsen på att
förutsäga topp 3. Den är välkalibrerad upp till ungefär 60 % men för säker
över det (85–95 % blev i verkligheten 75–80 %). ROI med regeln
"platsodds > riktodds" var −24,5 %.

**Felrättning:** backtestets v1-varianter räknades först utan streck även när
strecket hade vikt. Rättat så att backtestet räknar som appen.

## Intjänade pengar (20 okt)

Indata: log(1 + hästens vinstsumma per start i livet), jämfört inom loppet.

| Modell | Utan pengar | Med pengar | Vikt för pengar |
|---|---:|---:|---:|
| Utan streck | 0,5370 | **0,5251** | 0,38 (störst av alla) |
| Med streck | 0,4925 | 0,4925 | 0,05 |

**Vad det betyder:** utan strecket är pengarna den starkaste enskilda signalen.
Med strecket tillför de ingenting; marknaden har redan räknat in klassen.

**Beslut:** en egen modell utan streck med pengar som tyngsta vikt används i
lopp där inget streck finns än (innan V-spelet öppnat). Pengar visas i
startlistan som stöd.

## Signalerna 1–6 (20 okt)

Prövade en i taget ovanpå v2 och modellen utan streck. Δ = ändring i log loss
(negativt = bättre; ungefär 0,001 är gränsen för att det ska betyda något).

| Signal | Δ med streck | Δ utan streck | Bedömning |
|---|---:|---:|---|
| **Barfota runt om** | **−0,0011** | **−0,0027** | Bäst. Marknaden räknar med den för lite. |
| Vila (lång vila negativ) | 0 | −0,0006 | Hjälper utan streck. |
| Tid, bara extrema | 0 | −0,0005 | 5 % av starterna. Strecket fångar redan de snabba. |
| Galopp vid voltstart | −0,0002 | 0 | Liten. |
| Skor av sedan förra starten | +0,0001 | +0,0005 | Inget. Att vara barfota räknas, inte bytet. |
| Jänkarvagn, kuskbyte, klassbyte | 0 | ≈ 0 | Inget. |

**Tider:** Mikaels invändning (lopp körs olika, väder, årstid) ledde till att
tid bara räknas när en häst sticker ut extremt: bästa justerade km-tid i 5
senaste mer än 2 robusta standardavvikelser snabbare än fältets median.
Justeringen bygger på samma häst på olika distanser: **+1,0 s per 500 m**.
Referens 2140 m: auto 1.15,0, volte 1.17,0. Därför är 1.13,4 på 2140a bättre än
1.13,4 på 1640a.

## Kalibrering (20 okt)

Platt-kalibrering: P3' = sigmoid(a + b · logit P3), anpassad på träningsdelen.
För v2 gav den 0,4949 → 0,4933, men toppen var fortfarande för säker. En övre
gräns på 80 % löste det.

## v3 – i appen från 20 okt

Anpassad på exakt modellens indata, vikter under 0,03 satta till 0.

- **Med streck:** streck 0,86 · plats 0,08 · barfota 0,08 · vila −0,07 ·
  pengar 0,05 · form −0,05 · galopp −0,05 · spår 0,03 · tränare 0,03.
- **Utan streck:** pengar 0,38 · spår 0,17 · form 0,15 · barfota 0,13 ·
  plats 0,10 · kusk 0,10 · tränare 0,10 · vila −0,10 · vinst 0,08 · tid 0,08 ·
  galopp 0,03.
- **Kalibrering:** a −0,055 · b 0,947 · högst 80 %.

| Modell | Log loss | Lägst odds topp 3 | ROI (platsodds > riktodds) |
|---|---:|---:|---:|
| v2 | 0,4949 | 60,9 % | −24,5 % |
| **v3** | **0,4893** | **63,9 %** | **−21,5 %** |
| Marknaden (vinnarodds) | 0,5010 | 61,8 % | −13,1 % |
| v3 utan streck | 0,5218 | 56,3 % | −19,2 % |

Kalibreringen för v3 stämmer i alla nivåer: 45 % blev 44,6 %, 74 % blev 73,8 %.

**Vad det betyder:** v3 förutsäger topp 3 bättre än marknaden, men det räcker
inte för att gå plus mot ATG:s platspool efter avdraget. Spelvärdet måste
komma från skillnaden mot Unibets fasta odds.

**Aktivera:** Inställningar → Riktoddsmodell → *Fyll i rekommenderad modell*
→ *Spara som ny version*.

## Antal positiva signaler (20 okt)

Tio signaler med fasta gränser: spår (plats % minst 15 % över medel), extrem
tid, kusk och tränare i fältets topp 3, barfota, plats minst 75 %, vinst minst
50 %, form (minst 2 ettor/tvåor av 5), pengar per start i fältets topp 3 och
ingen galopp i 5. Hela underlaget, 23 880 starter.

| Signaler | Topp 3 verklig | Strecket säger | v3 säger | ROI platspool |
|---|---:|---:|---:|---:|
| 0 | 12 % | 9 % | 12 % | −29 % |
| 2 | 22 % | 20 % | 22 % | −20 % |
| 4 | 37 % | 40 % | 37 % | −14 % |
| 5 | 46 % | 51 % | 45 % | −10 % |
| 6+ | 57 % | 68 % | 57 % | −12 % |

**Många signaler men lågt streck** (minst 4, inte bland loppets 3 mest
streckade): topp 3 i 25–26 % mot strecket 20 %, lika i tränings- och testdelen.

**Vad det betyder:** antalet signaler säger mycket, men v3 räknar redan med det.
Strecket överskattar hästar med många signaler och underskattar dem med få
(favoriter spelas för mycket). Antalet är ett bra stöd för att förstå *varför*
en häst är bra och för att hitta hästar med lågt streck, men spelbeslutet ska
vila på riktoddset mot Unibet.

## Mikaels regel och Trollspöt (20 okt)

Rapport: `2026-10-20-trollspot.md`. ATG:s platsodds står i för Unibets. 304
omgångar, varav 90 i testdelen.

| Regel | Spel per omgång | Träff | Medelodds | ROI (testdelen) |
|---|---:|---:|---:|---:|
| v3 chans ≥ 50 % och odds ≥ 2,0 | 0,5 | 42,7 % | 2,34 | −3,4 % (+14,8 % på 45 spel) |
| v3 chans ≥ 45 % och odds ≥ 2,0 | 1,4 | 42,8 % | 2,28 | −6,0 % (−1,3 %) |
| Chans × odds ≥ 1,1 och odds ≥ 2,0 | 6,1 | 12,4 % | 11,81 | −32,8 % (−22,6 %) |
| Alla hästar med odds ≥ 2,0 | 60,9 | 18,0 % | 6,86 | −23,1 % (−22,0 %) |

**Vad det betyder:**
- Hästar där v3 säger minst 50 % men platspoolen ger minst 2,0 är få (en på två
  omgångar) och kom topp 3 i 43 %, inte 50–55 %. När modellen och marknaden
  är oense har marknaden oftare rätt.
- Regeln "chans × odds över 1" väljer just oenigheterna (långskott där modellen
  är mer optimistisk) och förlorar mest.
- Trollspöt rankad på modellens fördel mot strecket valde långskott (träff
  6 %). Rankad på högst chans bland hästar med uppskattat odds minst 1,8 gav
  den träff 29 % och ROI −15 % (alla hästar −23 %).

**Slutsats:** mot ATG:s pool finns ingen lönsam regel. Spelvärdet hos Unibet
uppstår bara om Unibets fasta odds är högre än vad marknaden (strecket och
platspoolen) säger. Jämför därför Unibets odds mot marknadens chans, inte bara
mot v3, och samla Unibet-odds med utfall för att mäta det.

## Bra form (27 okt)

Rapport: `2026-10-27-bra-form.md`. Bra form = platsat i båda de två senaste
starterna och senaste starten högst 4 veckor före loppdagen (Mikaels
definition). Underlaget har nu 2 320 lopp, test 695 (utländska hästar med sedan
commit 9dbc83b), samma delningsdatum.

| Signal | Andel | Topp 3 / strecket säger | Δ med streck | Δ utan streck | Bedömning |
|---|---:|---:|---:|---:|---|
| Bra form (4 v) | 19 % | 36,2 % / 39,3 % | 0 (vikt 0) | −0,0001 (vikt 0,03) | Inget. Redan inprisad, något överskattad. |

6 veckor eller ingen datumgräns gav samma resultat. Som bricka ändrade den inte
träffen för v3-favoriter, Mikaels regel eller spelbara (proxy) i testdelen.
**Beslut (förslag):** läggs inte in i modellen eller bland de positiva signalerna.

## Det som inte går att backtesta än

- **Unibets odds:** det enda som kan visa en verklig fördel. Appen sparar
  Unibet-odds och utfall för varje omgång; efter 15–20 omgångar kan avkastningen
  per grupp (favorit, oddsintervall, fältstorlek) mätas.
- **Strecket under veckan:** backtestet använder strecket vid start. Appen
  sparar strecket från fredag kväll och under lördagen, så rörelser kan prövas
  längre fram.
- **Topp 2 i små fält:** om Unibet bara betalar två platser med få startande
  räknar modellen fel sannolikhet. Ska kontrolleras mot Unibets regler.

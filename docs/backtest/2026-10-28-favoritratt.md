# Favoriträttning – v1.2 (2026-10-28)

Utgångspunkt: `2026-10-28-svag-favorit.md` visade att storfavoriter är överstreckade (favoritens vinst / streck 0,93 totalt, omgångens starkaste favorit 0,81). Frågan var om v3 ärver det via streckvikten 0,86, och om en rättning gör modellen bättre.

## Slutsats

**Ja, modellen blir bättre, men inte av den anledning vi trodde.** Strecket ska räknas som **log-streck utan skalning per lopp** (nytt indata `streckLog`, vikt 0,56) i stället för som z-värde inom loppet (`streck`, vikt 0,86). Det blir **v1.2**.

| Modell (testdelen, 695 lopp) | Log loss | Brier | Lägst odds topp 3 |
|---|---:|---:|---:|
| v3 (i appen 20–28 okt) | 0,4889 | 0,1604 | 64,3 % (447) |
| **v1.2** | **0,4864** | **0,1595** | **64,6 % (449)** |
| Marknaden (vinnarodds) | 0,4971 | | |

- **Δ log loss −0,0025, 95 % (bootstrap över lopp, 2 000 dragningar) −0,0041 till −0,0007.** Det klarar kravet (Δ ≤ −0,001 och intervallet utesluter 0). Siffrorna är räknade genom appens egen `computeRace`, så de gäller för exakt de värden som ligger i `RECOMMENDED_*`.
- Förbättringen syns i båda halvorna av testdelen (apr–jul: −0,0031, −0,0057 till −0,0012; jul–okt: −0,0020, −0,0038 till −0,0002), i träningsdelen (0,4819 → 0,4793) och i alla spelformer (V85 −0,0015, V86 −0,0033, GS75 −0,0038; bara GS75 har ett intervall helt under 0 för sig).
- **De direkta favoriträttningarna gav ingenting:** en extra indikator för loppets mest streckade, streck över 30/40/50 %, log-streck i kvadrat, strecket som andel, en lägre streckvikt, β och ett lägre tak gav alla Δ mellan −0,0001 och +0,0002. Vikterna för "favorit"-indata blev dessutom *positiva* på träningsdelen: modellen ville ge storfavoriterna *högre* chans, inte lägre.

**Varför:** v3 ger inte storfavoriterna strecket rakt av. Den räknar om log-strecket till z-värden inom varje lopp, alltså delat med hur utspritt strecket är i *hela* fältet. Ett fält med många hästar på 1–2 % blir utspritt, och då trycks favoriten ihop. Resultatet var att v3 gav storfavoriterna för *låg* chans till topp 3 och favoriterna i jämna lopp för *hög*:

| Streckfavoriten, hela underlaget | Lopp | Topp 3 verklig | v3 säger | v1.2 säger | Strecket (Harville) säger |
|---|---:|---:|---:|---:|---:|
| Favorit < 30 % | 554 | 48,0 % | 53,1 % | **50,8 %** | 66,1 % |
| Favorit 30–40 % | 726 | 61,3 % | 61,8 % | 62,0 % | 80,6 % |
| Favorit 40–50 % | 439 | 70,2 % | 68,5 % | **70,4 %** | 90,0 % |
| Favorit 50–60 % | 275 | 76,4 % | 73,1 % | **76,2 %** | 95,0 % |
| Favorit ≥ 60 % | 326 | 83,4 % | 78,1 % | **79,5 %** | 98,5 % |
| Omgångens starkaste favorit | 308 | 78,9 % | 77,3 % | **78,8 %** | 97,9 % |

Överstreckningen av favoriten som *vinnare* (kvot 0,93) är alltså redan mer än rättad i v3:s chans till *topp 3*: strecket genom Harville säger 98,5 % för en favorit på ≥ 60 %, v3 säger 78 % och utfallet är 83 %. Med `streckLog` blir vikten en fast exponent (styrkan följer streck^0,56 i alla lopp), och då hamnar favoriterna närmare utfallet i alla grupper utom ≥ 60 %, där taket på 80 % håller nere.

**Förbehåll om testdelen:** i testdelen gick storfavoriterna sämre än i resten av underlaget (≥ 50 % vann 50 %, mot 58 % totalt). Där säger v1.2 något för mycket för dem (omgångens starkaste favorit 79,2 % mot 72,2 % verkligt; v3 77,6 %), medan den träffar mycket bättre för svaga favoriter (< 30 %: 50,7 % mot 40,9 % verkligt; v3 52,3 %). Totalt vinner v1.2 ändå, och på hela underlaget ligger v1.2 närmast i varje grupp. "Omgångens storfavorit är överspelad" (värde 0,81 i svag-favorit-rapporten) gäller V-strecket som vinnarchans, och det tar modellen redan hand om.

**Rekommendation:** lägg in v1.2. Inställningar → Riktoddsmodell → *Fyll i rekommenderad modell* → *Spara som ny version*.

## v1.2

- **Med streck:** streckLog 0,56 · pengar 0,08 · barfota 0,08 · plats 0,06 · spår 0,06 · tränare 0,03 · vinst −0,05 · form −0,05 · galopp −0,05 · vila −0,07 · streck 0 · kusk 0 · tid 0 · galopp vid volte 0.
- **Utan streck (noStreck):** oförändrad från v3 (pengar 0,38 · spår 0,17 · form 0,15 · barfota 0,13 · plats 0,10 · kusk 0,10 · tränare 0,10 · vila −0,10 · vinst 0,08 · tid 0,08 · galopp 0,03). Strecket berörs inte där.
- **Kalibrering:** a −0,016 · b 0,979 · högst 80 % (v3: a −0,055 · b 0,947 · högst 80 %). β 1, marginal 0.
- Framtagen som v3: alla vikter anpassade på träningsdelen med koordinatsökning (start i streckLog 0,535 med övriga v3-vikter), vikter under 0,03 satta till 0, resten avrundade till två decimaler, sedan Platt på träningsdelen.

Kalibreringen av v1.2 utan Platt (a 0, b 1) ger 0,4865, och tak 0,75/0,85 ger 0,4864. Valet av tak spelar ingen roll; utan tak blir det 0,4867. Att även låta det gamla z-strecket få vikt bredvid streckLog gav vikt −0,025 och ingen förbättring (0,4863).

### Kalibrering, testdelen

| P3-hink | v3 antal | v3 säger | v3 verklig | v1.2 antal | v1.2 säger | v1.2 verklig |
|---|---:|---:|---:|---:|---:|---:|
| 0–10 % | 1852 | 6,9 % | 6,6 % | 1937 | 6,5 % | 6,9 % |
| 10–20 % | 1825 | 14,5 % | 16,1 % | 1725 | 14,6 % | 15,7 % |
| 20–30 % | 1125 | 24,9 % | 24,6 % | 1108 | 24,8 % | 25,7 % |
| 30–40 % | 950 | 34,7 % | 34,5 % | 930 | 34,7 % | 33,0 % |
| 40–50 % | 776 | 45,0 % | 44,7 % | 760 | 44,8 % | 43,7 % |
| 50–60 % | 532 | 54,8 % | 57,3 % | 543 | 54,6 % | 55,2 % |
| 60–70 % | 326 | 64,5 % | 62,0 % | 337 | 64,5 % | 64,7 % |
| 70–80 % | 169 | 74,3 % | 76,3 % | 179 | 74,7 % | 70,9 % |
| 80 % (taket) | 106 | 80,0 % | 77,4 % | 142 | 80,0 % | 79,6 % |

Topp-intervallen: 50–60 %, 60–70 % och taket träffar bättre med v1.2, 70–80 % sämre (179 starter, 70,9 % mot 74,7 %). Inget av det är systematiskt; båda modellerna är välkalibrerade.

### Vinnarchansen för favoriten (softmax före Harville)

| Streckfavoriten, hela underlaget | Lopp | Streck | Vinner verkligt | v3 vinstchans | v1.2 vinstchans |
|---|---:|---:|---:|---:|---:|
| Alla | 2320 | 41,8 % | 38,8 % | 28,0 % | 28,1 % |
| Favorit ≥ 60 % | 326 | 70,1 % | 66,0 % | 41,4 % | 45,0 % |
| Omgångens starkaste favorit | 308 | 68,0 % | 61,4 % | 40,5 % | 43,9 % |

Modellens vinstchans (`winProb`) är inte en kalibrerad vinnarsannolikhet: den anpassas så att chansen till *topp 3* blir rätt efter Harville, och Harville kräver en plattare vinstfördelning än verkligheten för att träffa topp 3. Den ska bara läsas inom loppet. Som vinnarchans är både v3 och v1.2 långt *under* utfallet, så modellen ärver inte överstreckningen av favoriterna.

### Spelregler, testdelen (ATG:s platspool)

| Regel | v3 spel | v3 träff | v3 ROI | v1.2 spel | v1.2 träff | v1.2 ROI |
|---|---:|---:|---:|---:|---:|---:|
| Platsodds > riktodds | 1150 | 20,8 % | −19,2 % | 955 | 27,1 % | −20,2 % |
| Mikaels regel (P3 ≥ 50 %, platsodds ≥ 2,0) | 40 | 57,5 % | +27,9 % | 42 | 54,8 % | +24,7 % |

Ingen skillnad som betyder något (40 spel ger ett intervall på ±30 procentenheter). Slutsatsen från 20 oktober står: mot ATG:s pool finns ingen lönsam regel, och spelvärdet måste komma från Unibets fasta odds.

## Alla varianter (testdelen)

Δ mot v3 som den låg i appen (0,4889). En variant i taget; bara de nämnda vikterna anpassas på träningsdelen, Platt anpassas om utom där annat står. 95 % intervall med bootstrap över lopp.

| Variant | Vikt | Log loss | Δ | 95 % intervall |
|---|---|---:|---:|---|
| v3, Platt omanpassad | | 0,4890 | 0,0000 | −0,0003 – 0,0002 |
| v3, Platt omanpassad, utan tak | | 0,4892 | +0,0003 | −0,0002 – 0,0011 |
| (b) streckvikten omanpassad | streck 0,835 | 0,4889 | 0,0000 | −0,0003 – 0,0001 |
| (b) β som gemensam skala | β 0,97 | 0,4889 | 0,0000 | −0,0003 – 0,0002 |
| (c) v3-kalibrering, tak 70 % | | 0,4891 | +0,0002 | −0,0007 – 0,0008 |
| (c) v3-kalibrering, tak 75 % | | 0,4888 | −0,0001 | −0,0006 – 0,0001 |
| (c) v3-kalibrering, tak 85 % | | 0,4891 | +0,0001 | −0,0001 – 0,0006 |
| (a) log-streck i kvadrat | −0,025 | 0,4889 | 0,0000 | −0,0003 – 0,0002 |
| (a) strecket som andel | −0,025 | 0,4889 | 0,0000 | −0,0003 – 0,0002 |
| (a) loppets mest streckade | −0,025 | 0,4889 | 0,0000 | −0,0004 – 0,0003 |
| (a) streck ≥ 30 % (+ streckvikt) | 0 · streck 0,835 | 0,4889 | 0,0000 | −0,0003 – 0,0001 |
| (a) streck ≥ 40 % (+ streckvikt) | +0,025 · streck 0,81 | 0,4889 | −0,0001 | −0,0005 – 0,0001 |
| (a) streck ≥ 50 % (+ streckvikt) | +0,075 · streck 0,81 | 0,4891 | +0,0001 | −0,0002 – 0,0004 |
| (a) log-överskott över 30 % (+ streckvikt) | 0 · streck 0,835 | 0,4889 | 0,0000 | −0,0003 – 0,0001 |
| (a) log-streck utan skalning bredvid streck | 0,05 · streck 0,76 | 0,4886 | −0,0003 | −0,0007 – −0,0001 |
| **(b2) log-streck utan skalning i stället för streck** | 0,535 · streck 0 | 0,4867 | −0,0022 | −0,0036 – −0,0007 |
| v3, alla vikter om (z-streck) | | 0,4890 | +0,0001 | −0,0003 – 0,0005 |
| **v1.2: (b2) + alla vikter om, förenklad** | streckLog 0,56 | **0,4864** | **−0,0025** | **−0,0041 – −0,0007** |

(Indikatorerna och andelen är z-värden inom loppet, som övriga indata. Sökningens minsta steg är 0,025.)

## Underlag och metod

- Samma underlag och delning som `2026-10-27-bra-form.md`: `.backtest-cache/` (läst som `--bara-cache`, inget nät), V85/V75/V86/GS75 2025-01-01 – 2026-10-18, **2 320 lopp** med minst 4 startande där alla har streck och vinnarodds. Träning 1 625 lopp t.o.m. 2026-04-02, **test 695 lopp från 2026-04-03**.
- Spår ur statistikbasen i den lokala databasen (127.0.0.1:54329): 25 623 av 25 642 starter. Driftdatabasen rördes inte.
- Skript: `scripts/favoritratt.ts` (`npx vite-node --config vitest.config.ts scripts/favoritratt.ts -- --ut <fil.json>`). Rådata: `2026-10-28-favoritratt.json`.
- Favorit = högst V-streck i loppet. Omgångens starkaste favorit = favoriten med högst streck i spelet.

## I appen

- Nytt indata **`streckLog`** ("Streck, samma skala i alla lopp") i `lib/riktodds.ts`: samma värde som `streck` (log av strecket i procent, saknat streck = 0), men bara centrerat inom loppet, inte delat med standardavvikelsen. Saknad vikt = 0, så v1–v3 räknar exakt som förut.
- Saknas strecket i hela loppet används vikterna utan streck när `streck` *eller* `streckLog` har vikt. Vikterna utan streck har alltid 0 för båda.
- `RECOMMENDED_WEIGHTS`, `RECOMMENDED_CALIBRATION` och `RECOMMENDED_KEY = "v1.2"` uppdaterade; v3 finns kvar som `V3_WEIGHTS`/`V3_CALIBRATION` för backtestet.
- Finns versionen v1.2 redan i databasen får den nya versionen namnet v1.3 (befintliga versioner skrivs inte över).

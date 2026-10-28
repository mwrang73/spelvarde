# Svag favorit – ska en spik vara andrahandaren? (2026-10-28)

Mikaels fråga: *"Om favoriten är svag i % så vinner andrahandaren oftare – ska minst en spik i V85-raden vara andrahandaren bakom den svagaste favoriten?"*

## Slutsats

**Nej – bygg ingen värdespik på andrahandaren nu.** Underlaget visar inte att andrahandaren vinner oftare än strecket säger när favoriten är svag.

- I lopp där favoriten har **under 25 %** vinner andrahandaren 16,5 % mot streck 19,3 %. Kvoten är **0,86 (95 %: 0,64–1,13)**, alltså snarare *över*streckad. Det är det motsatta mot hypotesen.
- Bara gruppen **15–20 %** lutar åt rätt håll: 7 vinster på 34 lopp, kvot 1,22 (0,62–2,19). Intervallet är för brett för att betyda något, och under 15 % finns bara 3 lopp.
- Regeln **(b) "andrahandaren i loppet med svagast favorit"** på 132 V85/V75-omgångar: träff 21,2 % mot streck 19,9 %, värde **1,07 (0,72–1,42)**. På alla 308 omgångar är värdet 0,99. Regeln är alltså lika bra som strecket, varken bättre eller sämre.
- Med en tröskel (spik bara när favoriten < 18 %) blir det 3 träffar på 6 omgångar. Det går inte att bygga en regel på det.
- Modellen (v3) fångar redan det som finns att fånga. Den ger andrahandaren i svaga lopp *lägre* chans än strecket (17,1 % mot 19,3 %), och det ligger närmare utfallet (16,5 %).

**Det som faktiskt syns:** favoriter i stort är något överstreckade (kvot 0,93, 0,89–0,98), och tydligast gäller det omgångens **starkaste favorit**. Regel (a) har värde **0,81 (0,69–0,93)** i V85/V75: favoriten har i snitt 68 % streck men vinner 55 %. Den spiken är "dyr" mot strecket, men den är också den säkraste spiken (55 % träff mot 21 %). Om något ska byggas är det snarare en varning, "omgångens storfavorit är överspelad", än en spik på andrahandaren.

**Pröva igen** när det finns minst cirka 100 lopp med favorit under 20 % (i dag 37), eller med fler säsonger i cachen.

## Underlag och metod

- Källa: `.backtest-cache/` läst som `scripts/backtest.ts --bara-cache` (samma `calendarGames`/`buildRaces` ur `lib/backtest.ts`, inget nät och ingen databas). Spel 2025-01-01 – 2026-10-18: 321 spel med resultat, varav 13 hoppades över (startdetaljer saknas i cachen) och 9 kalenderdagar saknades.
- **2 320 lopp** i 308 omgångar: V85 73 omg. (584 lopp), V75 59 (413), V86 91 (728), GS75 85 (595). Inget lopp ingick i två spel.
- Per lopp: strukna borträknade, inställda lopp och lopp utan resultat bort. Alla startande hade V-streck. **Favorit** = högst V-streck i spelets egen pool, **andrahandare** = näst högst (vid lika streck avgör startnumret). Vinnare = placering 1 och inte diskad. 7 lopp hade dött lopp om segern, och där räknas båda som vinnare.
- **Kvot** = verklig vinstandel / snittstreck (streck/100). Kvot > 1 betyder understreckad. 95 %-intervallet är Wilson på vinstandelen delat med snittstrecket. För grupperna och spikreglerna finns även bootstrap (2 000 dragningar av lopp respektive omgångar).
- **Värde** för en spikregel = antal träffar / Σ(streck/100) över omgångarna, det vill säga hur mycket oftare spiken vinner än strecket säger.
- **Modellen** = v3 som den rekommenderas i appen (`RECOMMENDED_WEIGHTS`, β 1, streck med). Spår saknas, eftersom statistikbasen inte lästes (driftdatabasen rördes inte), och spårvikten 0,03 blir därför 0. Vinstchansen är `inputs.winProb`, alltså softmax före Harville och Platt. Den är **inte kalibrerad som vinstchans** och är för platt (favoriterna i snitt 27,9 % mot 38,8 % verkligt). Den duger därför för rangordning och jämförelse inom loppet, inte som absolut sannolikhet. v3:s vikter är anpassade på loppen före 2026-04-02, så de 30 % efter det datumet är testdel.

## 1. Utfall per favoritens streck (alla spelformer)

| Favoritens streck | Lopp | Fav. vinner | Fav. streck | Kvot fav. | Andrah. vinner | Andrah. streck | Kvot andrah. (95 % Wilson) | Övriga vinner | Övriga streck |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| <15 % | 3 | 66,7 % | 11,5 % | 5,81 | 0,0 % (0) | 10,1 % | **0,00** (0,00–5,54) | 33,3 % | 78,4 % |
| 15–20 % | 34 | 17,6 % | 18,7 % | 0,95 | 20,6 % (7) | 16,8 % | **1,22** (0,62–2,19) | 61,8 % | 64,5 % |
| 20–25 % | 199 | 22,1 % | 23,0 % | 0,96 | 16,1 % (32) | 19,8 % | **0,81** (0,59–1,10) | 62,3 % | 57,1 % |
| 25–30 % | 336 | 24,1 % | 27,6 % | 0,87 | 24,1 % (81) | 22,1 % | **1,09** (0,90–1,31) | 51,8 % | 50,3 % |
| 30–40 % | 720 | 33,5 % | 34,8 % | 0,96 | 23,5 % (169) | 23,3 % | **1,01** (0,88–1,15) | 43,1 % | 42,0 % |
| 40–50 % | 436 | 41,5 % | 44,8 % | 0,93 | 25,0 % (109) | 22,1 % | **1,13** (0,96–1,32) | 33,7 % | 33,1 % |
| ≥50 % | 592 | 58,3 % | 62,9 % | 0,93 | 17,2 % (102) | 15,7 % | **1,10** (0,92–1,30) | 24,8 % | 21,4 % |

- Favoriten är något överstreckad i alla grupper med fler än 34 lopp (kvot 0,87–0,96).
- Andrahandarens kvot ligger runt 1,0–1,13 när favoriten har ≥ 25 %, men sjunker till 0,81 i 20–25 %. Det finns ingen stigande trend mot svagare favorit.
- "Övriga" vinner ungefär som strecket säger. I 20–25 % vinner de något oftare (62 % mot 57 %), vilket talar mot att just andrahandaren tar över.

**Bara testdelen (lopp från 2026-04-02):**

| Favoritens streck | Lopp | Fav. vinner | Fav. streck | Kvot fav. | Andrah. vinner | Andrah. streck | Kvot andrah. (95 % Wilson) | Övriga vinner | Övriga streck |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 15–20 % | 11 | 18,2 % | 18,6 % | 0,98 | 27,3 % (3) | 16,6 % | **1,64** (0,59–3,41) | 54,5 % | 64,8 % |
| 20–25 % | 56 | 23,2 % | 22,9 % | 1,01 | 16,1 % (9) | 19,7 % | **0,82** (0,44–1,41) | 62,5 % | 57,4 % |
| 25–30 % | 99 | 21,2 % | 27,8 % | 0,76 | 19,2 % (19) | 21,8 % | **0,88** (0,58–1,29) | 59,6 % | 50,4 % |
| 30–40 % | 235 | 37,9 % | 34,8 % | 1,09 | 19,6 % (46) | 23,5 % | **0,83** (0,64–1,07) | 42,6 % | 41,6 % |
| 40–50 % | 116 | 41,4 % | 44,7 % | 0,93 | 24,1 % (28) | 22,4 % | **1,08** (0,77–1,46) | 35,3 % | 32,9 % |
| ≥50 % | 186 | 51,1 % | 63,0 % | 0,81 | 23,1 % (43) | 15,7 % | **1,48** (1,13–1,89) | 26,3 % | 21,3 % |

Testdelen ger samma bild för svaga favoriter (20–30 %: kvot 0,82–0,88). Den enda tydliga avvikelsen är andrahandaren bakom en **stor** favorit (≥ 50 %, kvot 1,48), och den syns inte på samma sätt i hela underlaget (1,10). Den är troligen slump bland många jämförelser.

## 2. Är andrahandaren under- eller överstreckad när favoriten är svag?

| Grupp | Lopp | Andrah. vinner | Streck | Kvot | 95 % Wilson | 95 % bootstrap | Fav. kvot (95 %) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Favorit < 20 % | 37 | 18,9 % | 16,3 % | **1,16** | 0,58–2,10 | 0,47–1,98 | 1,20 (0,63–2,06) |
| Favorit < 25 % | 236 | 16,5 % | 19,3 % | **0,86** | 0,64–1,13 | 0,62–1,09 | 0,99 (0,77–1,25) |
| Favorit ≥ 25 % | 2084 | 22,1 % | 20,7 % | **1,07** | 0,99–1,16 | 0,98–1,16 | 0,93 (0,88–0,98) |
| Alla lopp | 2320 | 21,6 % | 20,5 % | **1,05** | 0,97–1,13 | 0,97–1,13 | 0,93 (0,89–0,98) |
| <20 % · V85/V75 | 19 | 15,8 % | 16,8 % | **0,94** | 0,33–2,24 | 0,00–1,93 | 0,57 (0,16–1,71) |
| <20 % · V86/GS75 | 18 | 22,2 % | 15,7 % | **1,41** | 0,57–2,87 | 0,35–2,68 | 1,88 (0,92–3,17) |
| <25 % · V85/V75 | 119 | 20,2 % | 19,2 % | **1,05** | 0,73–1,48 | 0,70–1,44 | 0,87 (0,60–1,23) |
| <25 % · V86/GS75 | 117 | 12,8 % | 19,4 % | **0,66** | 0,41–1,03 | 0,39–0,97 | 1,11 (0,80–1,50) |
| ≥25 % · V85/V75 | 878 | 22,9 % | 20,4 % | **1,12** | 0,99–1,26 | 0,98–1,25 | 0,92 (0,85–1,00) |
| ≥25 % · V86/GS75 | 1206 | 21,6 % | 20,9 % | **1,03** | 0,93–1,15 | 0,92–1,15 | 0,94 (0,88–1,00) |

- **Favorit < 25 %:** kvot 0,86 (0,64–1,13). Ingen understreckning, och punktvärdet pekar åt andra hållet.
- **Favorit < 20 %:** kvot 1,16 (0,58–2,10). Det är bara 37 lopp (19 i V85/V75) och 7 vinster, så det går inte att dra någon slutsats.
- Alla lopp: andrahandaren 1,05 (0,97–1,13), en svag antydan till understreckning som syns mest när favoriten är *stark* (≥ 25 %, V85/V75: 1,12, 0,99–1,26). Den hänger ihop med att favoriterna är överstreckade (0,93), eftersom pengarna som borde ligga på andrahanden ligger på favoriten.
- V85/V75 och V86/GS75 skiljer sig åt i < 25 % (1,05 mot 0,66), men båda intervallen är breda och överlappar.

## 3. Spikregler över omgångarna

En spik per omgång. Träff = spiken vann sitt lopp. Värde > 1 = spiken vinner oftare än strecket säger.

**V85/V75 (132 omgångar):**

| Regel | Omgångar | Träff | 95 % Wilson | Snittstreck | Värde | Värde 95 % (bootstrap) |
|---|---:|---:|---:|---:|---:|---:|
| (a) Favoriten i loppet med starkast favorit | 132 | 55,3 % (73) | 47 %–64 % | 68,1 % | **0,81** | 0,69–0,93 |
| (b) Andrahandaren i loppet med svagast favorit | 132 | 21,2 % (28) | 15 %–29 % | 19,9 % | **1,07** | 0,72–1,42 |
| (b0) Favoriten i loppet med svagast favorit (jämförelse) | 132 | 22,0 % (29) | 16 %–30 % | 23,8 % | **0,92** | 0,65–1,20 |
| (c) Högst vinstchans enligt v3 (hela omgången) | 132 | 53,8 % (71) | 45 %–62 % | 65,3 % | **0,82** | 0,70–0,94 |
| (c2) v3:s favorit i loppet med svagast favorit | 132 | 21,2 % (28) | 15 %–29 % | 22,8 % | **0,93** | 0,63–1,23 |
| (d) Störst v3-chans/streck (streck ≥ 10 %) | 132 | 15,2 % (20) | 10 %–22 % | 12,7 % | **1,19** | 0,74–1,68 |
| (b15) Andrahandaren i svagaste loppet, bara om favoriten < 15 % | 1 | 0,0 % (0) | 0 %–79 % | 12,6 % | **0,00** | 0,00–0,00 |
| (b18) Andrahandaren i svagaste loppet, bara om favoriten < 18 % | 6 | 50,0 % (3) | 19 %–81 % | 16,0 % | **3,12** | 1,03–5,17 |
| (b20) Andrahandaren i svagaste loppet, bara om favoriten < 20 % | 18 | 16,7 % (3) | 6 %–39 % | 16,8 % | **1,00** | 0,00–2,25 |

**Alla spelformer (308 omgångar):**

| Regel | Omgångar | Träff | 95 % Wilson | Snittstreck | Värde | Värde 95 % (bootstrap) |
|---|---:|---:|---:|---:|---:|---:|
| (a) Favoriten i loppet med starkast favorit | 308 | 61,4 % (189) | 56 %–67 % | 67,8 % | **0,91** | 0,83–0,98 |
| (b) Andrahandaren i loppet med svagast favorit | 308 | 20,1 % (62) | 16 %–25 % | 20,3 % | **0,99** | 0,77–1,21 |
| (b0) Favoriten i loppet med svagast favorit (jämförelse) | 308 | 23,7 % (73) | 19 %–29 % | 24,4 % | **0,97** | 0,79–1,17 |
| (c) Högst vinstchans enligt v3 (hela omgången) | 308 | 56,8 % (175) | 51 %–62 % | 64,6 % | **0,88** | 0,80–0,96 |
| (c2) v3:s favorit i loppet med svagast favorit | 308 | 25,3 % (78) | 21 %–30 % | 23,3 % | **1,09** | 0,88–1,30 |
| (d) Störst v3-chans/streck (streck ≥ 10 %) | 308 | 12,7 % (39) | 9 %–17 % | 12,5 % | **1,01** | 0,73–1,32 |
| (b15) Andrahandaren i svagaste loppet, bara om favoriten < 15 % | 3 | 0,0 % (0) | 0 %–56 % | 10,1 % | **0,00** | 0,00–0,00 |
| (b18) Andrahandaren i svagaste loppet, bara om favoriten < 18 % | 12 | 25,0 % (3) | 9 %–53 % | 14,6 % | **1,71** | 0,00–3,40 |
| (b20) Andrahandaren i svagaste loppet, bara om favoriten < 20 % | 36 | 19,4 % (7) | 10 %–35 % | 16,2 % | **1,20** | 0,50–1,96 |

- **(b)** andrahandaren bakom den svagaste favoriten: värde 1,07 i V85/V75 och 0,99 totalt, med intervall som tydligt omfattar 1. Den ger ingen fördel mot strecket och träffar bara var femte omgång. Som *spik* sänker den alltså radens träffchans kraftigt utan påvisbar vinst i värde.
- **(a)** och **(c)** (storfavoriten respektive v3:s högsta vinstchans, samma häst i 213 av 308 omgångar) är de enda reglerna med intervall helt under 1. Den säkra spiken är överspelad, och man betalar för säkerheten.
- **(d)** störst v3-chans/streck har högst värde i V85/V75 (1,19), men intervallet är 0,74–1,68 och totalt är värdet 1,01. Inte heller den är påvisad.
- Med en tröskel på favoritens streck blir det för få omgångar: < 18 % ger 6 omgångar och < 20 % ger 18.

## 4. Fångar modellen redan andrahandarens chans?

Snittlig vinstchans per grupp: strecket, v3 (`winProb`, okalibrerad), vinnaroddsen (1/odds normaliserat i loppet) och verkligt utfall.

| Favoritens streck | Lopp | Andrah. streck | Andrah. v3 | Andrah. vinnarodds | Andrah. verklig | Fav. streck | Fav. v3 | Fav. verklig | v3 har andrah. som etta |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| <15 % | 3 | 10,1 % | 22,5 % | 22,9 % | 0,0 % | 11,5 % | 26,8 % | 66,7 % | 0 % |
| 15–20 % | 34 | 16,8 % | 16,7 % | 16,5 % | 20,6 % | 18,7 % | 17,5 % | 17,6 % | 35 % |
| 20–25 % | 199 | 19,8 % | 17,1 % | 18,1 % | 16,1 % | 23,0 % | 19,1 % | 22,1 % | 28 % |
| 25–30 % | 336 | 22,1 % | 18,3 % | 20,2 % | 24,1 % | 27,6 % | 21,3 % | 24,1 % | 26 % |
| 30–40 % | 720 | 23,3 % | 19,3 % | 21,4 % | 23,5 % | 34,8 % | 25,0 % | 33,5 % | 16 % |
| 40–50 % | 436 | 22,1 % | 19,2 % | 21,0 % | 25,0 % | 44,8 % | 29,4 % | 41,5 % | 4 % |
| ≥50 % | 592 | 15,7 % | 17,2 % | 16,7 % | 17,2 % | 62,9 % | 37,7 % | 58,3 % | 1 % |
| **< 25 % totalt** | 236 | 19,3 % | 17,1 % | 17,9 % | 16,5 % | 22,2 % | 19,0 % | 22,0 % | 28 % |
| **Alla** | 2320 | 20,5 % | 18,4 % | 19,6 % | 21,6 % | 41,5 % | 27,9 % | 38,8 % | 12 % |

- I svaga favoritlopp (< 25 %) ger v3 andrahandaren 17,1 %, vinnarpoolen 17,9 % och strecket 19,3 %, och utfallet är 16,5 %. **Både modellen och vinnarpoolen värderar andrahandaren lägre än V-strecket**, och båda ligger närmare utfallet. Det finns ingen understreckning som modellen missar.
- v3 rankar redan andrahandaren som loppets etta i 28 % av de svaga favoritloppen (35 % i 15–20 %). Där modellen ser något hos andrahandaren syns det alltså redan i dess rangordning, och regel (c2) "v3:s favorit i loppet med svagast favorit" ger värde 0,93 i V85/V75 och 1,09 totalt (intervall över 1).
- Eftersom `winProb` är okalibrerad och för platt (favoriter 27,9 % mot 38,8 % verkligt) ska v3-kolumnen läsas relativt inom loppet. Kvoten andrah./fav. är 0,90 hos v3, 0,87 i strecket och 0,75 i utfallet. Inte heller det pekar mot att andrahandaren är undervärderad.

## Förbehåll

- Få lopp med riktigt svag favorit: 3 under 15 % och 37 under 20 %. Frågan kan inte avgöras för den gruppen, bara för < 25 % (236 lopp).
- Många grupper och regler är jämförda. Enstaka "signifikanta" celler, som ≥ 50 % i testdelen, ska väntas av slumpen.
- Värde mot strecket är inte samma sak som avkastning på en V85-rad. Utdelningen beror på hela raden och på hur andra har spelat. Måttet säger bara om spiken vinner oftare än marknaden tror.
- Spåret saknas i modellen (ingen statistikbas lästes), vilket påverkar v3 marginellt (vikt 0,03).

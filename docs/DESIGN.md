# Design – Spelvärde

Riktning B, **Totalisatorn**: kvällstrav under strålkastare. En mörk tavla med bärnstensgula siffror ligger överst i varje vy, och listan under den är läktaren. Alla regler gäller både mobil och desktop.

Underlag för utseendet (mockups, godkända 2026-10-19):
- `v85-tema-mockup.html`: komponentark för riktning B (fliken "B · Totalisatorn").
- `spelvarde-flode-mockup.html`: alla skärmar i mobil, desktop för skärm 2, 5 och 6, ljust och mörkt läge.

Båda filerna ligger i dag i sessionens scratchpad: `/tmp/claude-1000/-workspaces-Claude---Arbetsyta/d20e099c-c4b5-4786-93fa-ffcf16277faf/scratchpad/`. De ska kopieras till `BettingBBW/docs/mockups/` innan bygget börjar. Vid tveksamhet gäller mockupen före den här texten för utseendet, och specen `docs/specs/spelvarde.md` gäller för beteendet.

## Färger
- **Alla färgvärden finns i `styles/tokens.css`.** CSS och komponenter använder bara `var(--…)`. Inga hex-värden i komponenter.
- **Temat** styrs med `:root[data-theme="dark"]`. Ljust tema ligger under `:root`. Har användaren inte valt något följer appen `prefers-color-scheme`. Valet (`light`, `dark` eller `system`) sparas i `localStorage` under nyckeln `sv-theme` och ska tåla att lagringen är blockerad. Ett litet inline-skript i `app/layout.tsx` sätter `data-theme` före första ritningen, så att det inte blinkar.
- **Tavlan (`--head`) är mörk i båda teman.** Text på tavlan använder `--head-*`, aldrig `--ink`.

### Tokens
| Token | Ljust | Mörkt | Roll |
|---|---|---|---|
| `--page` | `#BFC6CD` | `#030405` | Bakom appen (desktopkant) |
| `--bg` | `#E4E8EC` | `#0C0E11` | Appens bakgrund |
| `--bg-glow` | `rgba(255,255,255,.7)` | `rgba(255,178,46,.08)` | Strålkastarsken i toppen av `--bg` |
| `--surface` | `#F9FAFB` | `#13161A` | Rader, kort |
| `--surface-2` | `#EEF1F4` | `#181C21` | Zebrarad, tonad yta |
| `--surface-3` | `#DDE2E8` | `#222730` | Hover, kolumnrubriker, tomma formrutor |
| `--ink` | `#0D1014` | `#F3EFE4` | Text |
| `--ink-2` | `#48505A` | `#A9B0BA` | Dämpad text (minst 4.5:1 mot `--surface`) |
| `--line` | `#D0D6DD` | `#262B33` | Linjer mellan rader |
| `--line-strong` | `#8E98A3` | `#3D444E` | Kanter på knappar och fält |
| `--accent` | `#A65300` | `#FFB22E` | Bärnsten som **text** (Intressant-namn, länkar) |
| `--accent-soft` | `#FCEBD0` | `rgba(255,178,46,.14)` | Vald rad, varningsbanderoll |
| `--fill` | `#FFB22E` | `#FFB22E` | Bärnsten som **fyllning** (tänd lampa, primärknapp, Spelbar) |
| `--fill-ink` | `#1A1000` | `#1A1000` | Text på `--fill` |
| `--fill-deep` | `#A45F00` | `#8F5200` | Underkant på primärknappen |
| `--focus` | `#0B62D6` | `#7CC4FF` | Fokusring |
| `--head` | `#101317` | `#050607` | Tavlan |
| `--head-ink` | `#FFB22E` | `#FFB22E` | Lysande siffror och rubriker på tavlan |
| `--head-ink-2` | `#C2C8CF` | `#B9C0C8` | Dämpad text på tavlan |
| `--head-text` | `#ECE8DD` | `#ECE8DD` | Brödtext på tavlan |
| `--head-line` | `#2E343B` | `#262B33` | Linjer på tavlan |
| `--flap-top` / `--flap-bot` | `#252A31` / `#1A1E23` | `#20242A` / `#16191D` | Fällbladsrutans övre och nedre halva |
| `--led-off` | `#C5CCD3` | `#2A3038` | Släckt lampa, tom stapel |
| `--glow` | `rgba(242,154,0,.40)` | `rgba(255,178,46,.55)` | Sken runt tänd lampa |
| `--up` / `--up-soft` | `#0E7A3B` / `#DDF3E5` | `#46D37E` / `rgba(70,211,126,.14)` | Stigande streck, träff, rusad rad |
| `--down` / `--down-soft` | `#C42B1F` / `#FBE1DD` | `#FF6B5A` / `rgba(255,107,90,.15)` | Sjunkande streck, miss, fel |
| `--gal` / `--gal-ink` | `#C42B1F` / `#FFFFFF` | `#FF5A45` / `#1A0400` | Galoppmärke, larmram |
| `--bet` / `--bet-ink` | `#0D1014` / `#FFFFFF` | `#F3EFE4` / `#0C0E11` | Bet-märke och tänd Bet-tangent |
| `--chip-auto-bg` / `-ink` | `#DCE7F3` / `#0D2A4A` | `#13263A` / `#A8D4FF` | Autostart |
| `--chip-volte-bg` / `-ink` | `#FBDCD6` / `#6E140C` | `#3A1610` / `#FFB8AA` | Voltstart |
| `--shadow` | se mockup | se mockup | Kort och Nästa steg |

Fasta värden som bara används på tavlan (samma i båda teman): vald fällbladsruta `linear-gradient(#FFC85C 50%, #F4A51F 50%)` med text `#1A1000`, LED-raster `radial-gradient(rgba(255,255,255,.05) 1px, transparent 1.3px)` med storleken 4 px, och rubriktext `#FFFFFF`. Lägg dem som tokens `--flap-on`, `--matrix` och `--head-title`.

### Färgernas betydelse
Färg är aldrig ensam informationsbärare. Varje färg har alltid en bokstav, en pil eller ett ord bredvid sig.
- **Bärnsten** betyder ditt val: Intressant, Spelbar, vald flik och primär handling.
- **Grönt med ▲** betyder stigande streck eller träff. **Rött med ▼** betyder sjunkande streck eller miss.
- **Rött märke "G"** betyder galopp. **"GD"** betyder galopp som gav diskning, det starkare läget.
- **Svart eller vitt märke "B"** (inverterat mot temat) betyder Bet.

## Typografi
| Roll | Typsnitt (Google Fonts) | Reserv | Användning |
|---|---|---|---|
| Display | **Doto** 600/800 | `"Courier New", ui-monospace, monospace` | Logotypen "SPELVÄRDE" och dagetiketter. Bara i 20 px och större, versaler, `letter-spacing: .06em`. |
| Namn och rubriker | **Barlow Condensed** 500/600/700 | `"Arial Narrow", "Roboto Condensed", sans-serif` | Hästnamn (17 px/700 i täta rader), vyrubriker (19 px versaler), etiketter (10.5–12.5 px versaler, `letter-spacing: .06–.09em`), knapptext (versaler). |
| Brödtext | **Barlow** 400–700 | `"Segoe UI", Roboto, Helvetica, Arial, sans-serif` | Löptext, kusk (12 px), hjälptext (12.5–14 px). |
| Siffror | **JetBrains Mono** 500/700 | `ui-monospace, Menlo, Consolas, monospace` | Startnummer, odds, streck, tider och procent. Alltid `font-variant-numeric: tabular-nums`. |

- Ladda typsnitten med `next/font/google` med `display: "swap"`. Inga andra externa resurser används.
- **Siffror skrivs på svenska:** decimalkomma ("3,10" och "12,2 %"), mellanslag före procenttecknet och tusentalsavgränsare med hårt mellanslag ("2 787 330 kr"). Odds har alltid två decimaler och streck en decimal. Rörelse skrivs med tecken och enhet: "+2,4 pe" och "−1,8 pe" med äkta minustecken (U+2212).
- **Datum och tid** skrivs relativt i svensk tid (Europe/Stockholm), som i Tabellgissningen: "i dag 14:05", "i går 21:00", "fre 23 okt 21:00".

## Avstånd och täthet
- **Mobil först, 390 px.** Ingen vy får skrolla i sidled ner till 360 px. Sidomarginalen är `max(16px, env(safe-area-inset-left))`, och samma till höger.
- **Täta rader.** En hästrad är **exakt 44 px hög** inklusive linjen på 1 px. En avdelning med 12 hästar ska få plats på en skärm på 390 × 844 tillsammans med vyrubrik (54 px), avdelningsflikar (54 px), loppremsa (cirka 60 px), kolumnrubrik (24 px) och bottenmeny (64 px). Med 15 hästar får listan skrolla, men rubriker och flikar ligger kvar.
- **Kolumner i täta rader** (från vänster, `column-gap: 6px`):
  - Analys: nummer 32 · namn och kusk `1fr` · form 52 · riktodds 38 · Intressant 44
  - Live: nummer 32 · namn `1fr` · streck nu 42 · rörelse 66
  - Under loppet: nummer 32 · namn och noteringar `1fr` · antal · plus 44
- **Namn kortas med ellipsis och märken krymper inte.** Galopp-, Intressant- och Spelbar-märket ligger direkt efter namnet med `flex: none`.
- **Kort och luftigare rader** (Omgång 56 px, Spelförslag 60 px, odds 52 px) används bara där raden har två rader text eller ett fält.
- Små inbördes avstånd är 3–6 px. Grupprubriker har 12 px luft ovanför och 6 px under.
- **Desktop (≥ 1024 px):** analysvyn (avdelning och hästkort) byggs på ett rutnät med 8 lika kolumner, 16 px marginal och 16 px mellanrum: en zonrad överst (Avdelning, Fas, Verktyg), loppet till vänster och hästkortet till höger. Sidan skrollar inte. Måtten är CSS-variabler (`--av-*` i `styles/app.css`), se `docs/specs/analysvy-layout.md` 1. Hästraden i den breda tabellen får krympa från 44 till 40 px när fönstret är lågt. Mobilen behåller exakt 44 px. Toppmenyn är 56 px hög. Spelförslaget har tre flikar (Trollspöt, Platsspel, V85-rad) som var och en visar sin panel i full bredd (E6, beslut av Mikael). Platsspel är högst 900 px brett. V85-raden har två kolumner, `380px minmax(0, 1fr)`: budget, Spela hos ATG och regler till vänster (fast vid skrollning), avdelningskorten i två kolumner till höger.

## Komponenter
Komponenterna ligger i `components/`. Namnen nedan är förslag. Utseendet för varje komponent står i komponentarket och i flödesmockupen.

### Tavlan
- `AppHeader`: vyrubrik på tavlan med tillbaka eller logga, titel och underrad (versaler, `--head-ink-2`), plus högst två ikonknappar. På desktop är den toppmeny med Omgång, Källor och Statistik (56 px). I analysvyn är tillbaka en pil med synlig text ("← Avd 5", "← Omgång"), och hästkortet har ‹ › i en grupp till höger. Pil + text betyder tillbaka, två chevroner betyder byt häst. Omgång i menyn leder till omgången du är i.
- `FlapNumber`: startnummer i en fällbladsruta med delad mitt (linje på 1 px vid 50 %) och bärnstensgula siffror med sken. Storlekar `sm` 24 × 28, `md` 30 × 36 och `lg` 46 × 56. Varianten `placed` är bärnstensgul ruta med mörk text och används för placering.
- Spårfördel på `FlapNumber`: bricka i övre vänstra hörnet, V (fylld grön, bäst vinstspår), P (ljusgrön, bäst platsspår) eller V+P (samma spår). Statistikraden visar samma märke som förklaring. Spår benämns via `lib/post-edge.ts`.
- Lopp benämns `V85-1`, `V75-1` osv. (`legName` i `lib/game-type.ts`), aldrig "Avd": avdelning är ATG:s egen numrering och kan vara en annan. Utan känd spelform: "Lopp 1".
- `RaceTabs`: avdelning 1–8 som fällbladsrutor, `role="tablist"`. Vald flik är bärnstensgul med sken. En röd prick (8 px, `aria-label` "rusningslarm") visar ett olarmat larm i avdelningen.
- `PhaseRail`: fyra rutor (Analys, Odds, Live och Klart) med dag under. Klara faser får "✓", och den aktiva har `aria-current="step"` och bärnstensgul bakgrund. Varje ruta är en länk till fasens vy.
- `RaceStrip`: chips för distans, startmetod och klass, knappen "Loppstatistik ›" och en statistikrad ("Spår 5 vinner 12,2 %"). Klassbrickan är neutral (vanlig `.chip`), inte fylld bärnsten.
- `BoardPanel`: generisk tavelyta med LED-raster för riktoddsrutan, budgeten, summeringar och jämförelsestaplar.

### Rader och märken
- `StartRow` har varianterna `analysis`, `live` och `note`, med kolumnerna ovan. Zebrarader (`--surface`/`--surface-2`). Hover ger `--surface-3`.
  - Intressant ger en bärnstensgul kant på 3 px till vänster med sken, och namnet blir `--accent`.
  - En rusad rad får `--up-soft`.
  - En struken häst visas grå och genomstruken med taggen "Struken", och lampan är avstängd.
- `Badge`: 17 × 17 px med bokstäverna I (ring), S (fylld bärnsten), B (inverterad), G (röd) och GD (röd med vit ring 1.5 px). Varianten `wide` har hela ordet. Varje märke har `role="img"` och en `aria-label` med hela ordet.
- `FormStrip`: fem rutor (9.6 × 18 px, senaste först). Seger har bärnstensgul ruta och galopp röd ruta med "g", och "0" betyder oplacerad. Tom ruta (`--surface-3`) betyder färre än fem starter. `aria-label` läser upp hela formen.
- `Move`: ▲/▼ + värde i pe, grönt eller rött. Över rusningsgränsen blir det en fylld grön eller röd bricka. Skärmläsartext: "upp 12,0 procentenheter".

### Reglage och knappar
- `LampToggle` (Intressant): träffyta 44 × 44 och en tangent på 28 × 28. Släckt tangent har en grå lysdiod, och tänd tangent är bärnstensgul med bock och sken. Använder `aria-pressed` och `aria-label` "Intressant: <häst>". Varianten `labeled` har texten "Intressant".
- `BetToggle`: samma tangent med biljettikon. Tänd tangent är inverterad (`--bet`).
- `SpelbarToggle`: chip med "S Spelbar". Ursprunget visas som underrad: "Förslag", "Satt av dig" eller "Borttagen av dig".
- `Button` har varianterna `primary` (bärnstensgul gradient, underkant på 3 px, trycks ned 2 px vid `:active`), `secondary` (tangent med kant och underkant), `ghost` (bärnstensgul text) och `icon` (44 × 44). `secondary xs` (24 px hög, 12 px text, träffyta 44 px) används bara i panelrubriker. Avstängd knapp är platt `--surface-3` utan skugga. Knapptext skrivs i versaler med Barlow Condensed 700.
- `Segmented`: segmentkontroll med `aria-pressed`, där valt segment har `--ink` som bakgrund. Varianten `.seg.nav` används för navigering (fas, avdelningar, flikar) och har valt läge i bärnsten (`--fill`/`--fill-ink`). Regel: **navigering väljs i bärnsten, värden i `--ink`.**
- `Stepper`: − och + på 40 × 44 med ett värde emellan. Knapparna stängs av vid gränsen. Ett värde som är ett ord ("Alla" i Max hästar per lopp) får klassen `.word` (Barlow Condensed 14 px, versaler).
- `OddsKeypad`: tolv tangenter på 58 px, siffrorna 0–9, Radera och "Nästa ›" (primär). LED-displayen visar oddset med två decimaler.
- `QuickChips`: snabbval på minst 44 px höjd. Valt chip är bärnstensgult med "✓", och kortkommandot visas som en liten bokstav på desktop.

### Kort och lägen
- `NextStepCard`: etiketten "Nästa steg", rubrik, en mening och **en** primärknapp. Kortet har en bärnstensgul kant till vänster.
- `RiktoddsBox`: tavelyta med riktodds (40 px), Unibet (26 px) och en mening om läget. Under den kommer `WhyList` med "Talar för · sänker riktoddset" (grönt ▼) och "Talar emot · höjer riktoddset" (rött ▲), och sist en rad med beräkningen i mono.
- `GallopWarning`: röd ram på tavlan med G- eller GD-märke och en mening, till exempel "Galopp i 1 av 5 senaste, 13 sep på Åby".
- `AlarmCard`: tavelyta med röd ram och sken, sirenikon, rubrik ("Rusning · avd 7" eller "Tappar · avd 7"), en mening och knapparna "Visa hästen" och "Kvittera". `role="alert"` används bara första gången larmet visas.
- `Banner` har varianterna `info`, `ok`, `warn` och `err`: kant på 4 px till vänster, ikon och text, med eventuell knapp under.
- `UpdatedLine`: "Uppdaterad 14:05 · nästa 14:10" och knappen Uppdatera.
- `Sheet`: bottenark i mobilen (max 80 % höjd, bärnstensgul överkant, grepplist och stängknapp). På desktop är det sidopanel eller dialog.
- `EmptyState`: ikon på tavlan, rubrik, en mening och en handling.
- `Skeleton`: skelettrader som skimrar och avstängs vid minskad rörelse.
- `CompareBars`: tre staplar på tavlan för Intressant, Spelbar och Bet.
- `StatsTable`: tabell med kolumnrubriker i versaler och procent under bråktalet.
- `RadLegCard` (V85-raden, E6): kort per avdelning med rubrik (fällbladsnummer, "Avd 1 · 16:20", typtagg och penna), hästrader på minst 52 px med skälen som taggar, varför-raden och spärrraden.
- Regler för raden (V85-raden, E6b): Spikar, Egna spikar, **Max hästar per lopp** (`Stepper` 3 … Alla, standard 7) och **Prioriterat lopp** (`Segmented` Auto | Välj avd, arket "Välj lopp att prioritera") i stället för Allgardering, och Favoritspärren. Det prioriterade loppet har typtaggen `.lr.allg` med "7 av 13" eller "Alla 13", och nummerrutorna bara när alla löpande är med. En ordtagg i löptext (t.ex. "Över taket") får `.rs-inline`. Se `docs/specs/e6b-max-per-lopp.md`.
- Skälstaggen `.rs`: 10,5 px versaler med ett ord per skäl ("Topp 3", "Mellan", "Skräll", "▲ Felstreckad", "4 signaler", "Favorit", "Spärr", "Prel."). Färgen bär aldrig ensam.
- `Kupong`: kupongbilden i arket Spela hos ATG, en kolumn per avdelning som på ATG:s kupong. Valda nummer bärnstensgula, favoriten med ring, strukna med snedstreck.

## Layoutmönster
- **Navigation:** bottenmeny i mobilen med Omgång, Källor och Statistik (64 px, 22 px ikon och etikett). Aktiv del har `aria-current="page"` och en bärnstensgul list överst. På desktop är det toppmeny på tavlan.
- **Omgång är navet.** Allt som hör till veckan (Avdelning, Häst, Odds, Live, Spelförslag och Under loppet) ligger under Omgång. Inställningar nås från ikonknappen i Omgångs vyrubrik.
- **En primär handling per vy.** På Omgång är den primära handlingen knappen i Nästa steg.
- **Ordning i listor:** det som kräver handling kommer först. I Live ligger egna hästar (I, S och B) överst och sedan övriga efter störst rörelse. I Spelförslag kommer Spelbara först.
- **Mobil och desktop:** samma innehåll och samma funktioner. Desktop kombinerar vyer: avdelning och hästkort, live och larm. Platsspel och V85-rad är egna flikar i Spelförslaget.

## Rörelse
| Rörelse | Var | Värden |
|---|---|---|
| Fällbladsfall | Startnummer när en lista ritas första gången, vald vyrubrik | `rotateX(-90deg)` till 0 på 450 ms, `cubic-bezier(.3,1.4,.5,1)`, 40 ms förskjutning per rad, högst 12 rader |
| Tangent | Knappar, lampa, Bet, knappsats | `translateY(2px)` och kortare underkant vid `:active`, 80 ms |
| Lampa | Intressant och Bet | Bakgrund och sken på 150–200 ms |
| Bottenark | Öppna | `translateY(100%)` till 0 på 320 ms, `cubic-bezier(.2,.9,.25,1)` |
| Puls | Livepricken, sirenen | Opacitet till 0,35 på 1,2–1,6 s, oändligt |
| Skimmer | Skelett | 1,2 s linjärt |

- Under `prefers-reduced-motion: reduce` stängs alla animationer och övergångar av. Information får aldrig hänga på rörelse.
- Rörelse används aldrig för att visa att data ändrats utan att också ändra text eller märke.

## Tillgänglighet (WCAG 2.2 AA)
- Text har kontrast på minst 4.5:1, och märken och kanter minst 3:1 mot sin bakgrund. Kontrollera dem båda teman, särskilt `--ink-2` på `--surface-2`.
- Alla tryckytor är minst 44 × 44, även när det synliga reglaget är mindre.
- Fokusringen är 3 px `--focus` med 2 px avstånd. På tavlan används samma ring, eftersom `--focus` har kontrast mot `--head` i båda teman.
- Semantik:
  - Landmärkena `header`, `nav` (huvudmeny) och `main`.
  - Vyrubriken är `h1` i varje vy.
  - Avdelningsflikar är `tablist` med piltangenter, Home och End.
  - Listor är `ul`/`li`, och tabeller på desktop är `table` med `caption`.
- **Reglage:** `aria-pressed` på Intressant, Bet, Spelbar och snabbval, och `role="radiogroup"` på betyg om det läggs till.
- **Ark och dialoger** fångar Tab, stängs med Esc, låser skrollningen under och ger tillbaka fokus till den som öppnade dem.
- **Uppläsning:** ändringar i Live (nytt larm, ny placering) läses upp i en `aria-live="polite"`-region, högst en mening per uppdatering. Ett nytt larm använder `role="alert"`.
- **Fält** har en synlig etikett. Felmeddelandet kopplas med `aria-describedby`, och fältet får `aria-invalid="true"`. Oddsfält använder `inputmode="decimal"`.
- **Ikoner** är `aria-hidden` och har skärmläsartext bredvid.

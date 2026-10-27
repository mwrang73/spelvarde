# Spelvärde

V85-analys för platsspel: hämtar startlistan från ATG, sammanställer
statistik (ATG och travstatistik.se) och låter Mikael markera Intressant och
skriva kommentarer. Spec: `docs/specs/spelvarde.md`. Design: `docs/DESIGN.md`.

Next.js 14 (App Router), TypeScript, Prisma 5 mot Postgres och vitest, med
samma upplägg och inloggning som `tabellgissningen-app`.

## Lokalt

Ingen Docker behövs: databasen är en riktig Postgres 17 som körs ur
npm-paketet `embedded-postgres`.

```bash
npm install
cp .env.example .env              # fyll i AUTH_SECRET och SEED_ADMIN_*
npm run db:local                  # terminal 1: Postgres på 127.0.0.1:54329 (data i .local-db/)
npm run db:migrate:local          # terminal 2: migreringen (vägrar om URL:en inte är lokal)
npm run db:seed                   # Mikael som ADMIN (lösenordet ändras inte om han redan finns)
npm run dev                       # http://localhost:3000
```

`npm run db:local -- --reset` raderar den lokala datan.

Provkörning utan nätet: `SPELVARDE_FIXTURES=atg,ts npm run dev` läser ATG och
travstatistik.se från `test/fixtures/`. Med bara `ts` anropas riktiga ATG.
Med `tips` läser Hämta tips (E5) Travstugan från `test/fixtures/travstugan`
och AI-svaren från `test/fixtures/tips-ai`, utan nät och utan
`ANTHROPIC_API_KEY`: `SPELVARDE_FIXTURES=atg,ts,tips npm run dev`.

## Kontroller

```bash
npx tsc --noEmit
npx vitest run                    # startar en egen tillfällig Postgres för kedjetestet
SKIP_DB_TESTS=1 npx vitest run    # utan databastestet
npm run check:migration           # migreringarna rör bara schemat spelvarde
npx next build
```

## Databasen

Ett eget schema, `spelvarde`, i Tabellgissningens Supabase-projekt.

- Alla modeller har `@@schema("spelvarde")` (Prismas `multiSchema`), så all
  genererad SQL är fullt kvalificerad.
- `DATABASE_URL` och `DIRECT_URL` slutar på `?schema=spelvarde`, så att
  `_prisma_migrations` också ligger i `spelvarde`.
- RLS är påslaget på varje tabell utan policies, och rättigheterna för
  `anon`/`authenticated` är indragna. Appen når databasen bara via Prisma.
- Mot drift körs bara `npx prisma migrate deploy`. Aldrig `migrate dev`,
  `migrate reset` eller `db push`.
- Nya migreringar: granska SQL:en (`npm run check:migration`), lägg till
  `ENABLE ROW LEVEL SECURITY` och `REVOKE` för nya tabeller, och ta bort
  eventuella `DROP INDEX` för de delvisa unika index som står sist i
  `20261019120000_init` (Prisma känner inte till dem).

## Hämta omgång

Klienten kör kedjan steg för steg (specen 10.1):

1. `POST /api/rounds/fetch` `{ gameId? }`
2. `POST /api/rounds/[id]/fetch/races/1` … `/8`
3. `POST /api/rounds/[id]/fetch/stats`

Varje steg är idempotent. `GET /api/rounds/[id]` anger `fetch.resumeFrom`
för Försök igen.

## Kod

- `lib/atg.ts`, `lib/travstatistik.ts`: tolkning, med avvikelserna mot specen överst i filerna.
- `lib/fetch-round.ts`: hämtningskedjan. `lib/round-server.ts`: läsningen.
- `lib/phase.ts` (fas, Nästa steg), `lib/gallop.ts`, `lib/names.ts`, `lib/race-class.ts`.
- `lib/outbox.ts`: utkorgen för klienten (9.3). `lib/types.ts`: API-svaren.
- `lib/tips/` (rena funktioner) och `lib/tips-server.ts`: Hämta tips (E5,
  `docs/specs/e5-hamta-tips.md`). Fixturerna i `test/fixtures/travstugan` är
  upphovsrättsskyddad text och används bara i testerna.

#!/usr/bin/env bash
# Kör Spelvärdes databaskommandon mot driftdatabasen (Tabellgissningens
# Supabase-projekt, schema spelvarde). Adresserna läses ur Tabellgissningens
# .env och får alltid schema=spelvarde, så att inget annat schema berörs.
# Lösenord och adresser skrivs aldrig ut.
#
#   bash BettingBBW/scripts/prod-db.sh status   # prisma migrate status
#   bash BettingBBW/scripts/prod-db.sh deploy   # prisma migrate deploy
#   bash BettingBBW/scripts/prod-db.sh seed     # skapar adminkontot (se seed.mjs)
#   bash BettingBBW/scripts/prod-db.sh sources  # listar källorna, läser bara
#
# Bara dessa fyra kommandon finns; migrate dev, reset och db push går inte att köra.
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=../tabellgissningen-app/.env
[ -f "$ENV_FILE" ] || { echo "Hittar inte $ENV_FILE" >&2; exit 1; }

read_var() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'"; }
with_schema() {
  case "$1" in
    *schema=*) echo "Adressen har redan ett schema satt. Avbryter." >&2; exit 1 ;;
    *\?*) printf '%s&schema=spelvarde' "$1" ;;
    *) printf '%s?schema=spelvarde' "$1" ;;
  esac
}

db=$(read_var DATABASE_URL); direct=$(read_var DIRECT_URL)
[ -n "$db" ] && [ -n "$direct" ] || { echo "DATABASE_URL eller DIRECT_URL saknas i $ENV_FILE" >&2; exit 1; }
export DATABASE_URL; DATABASE_URL=$(with_schema "$db")
export DIRECT_URL; DIRECT_URL=$(with_schema "$direct")

case "${1:-}" in
  status) npx prisma migrate status ;;
  deploy) npx prisma migrate deploy ;;
  seed)
    export SEED_ADMIN_EMAIL=mikael.wrang@gmail.com
    PW_FILE="$HOME/.spelvarde-admin-password"
    if [ ! -s "$PW_FILE" ]; then
      (umask 077; openssl rand -base64 18 | tr -d '/+=' > "$PW_FILE")
      echo "Nytt tillfälligt lösenord sparat i $PW_FILE"
    fi
    SEED_ADMIN_PASSWORD=$(cat "$PW_FILE"); export SEED_ADMIN_PASSWORD
    node scripts/seed.mjs
    ;;
  sources) node scripts/list-sources.mjs ;;
  *) echo "Användning: prod-db.sh status|deploy|seed|sources" >&2; exit 2 ;;
esac

#!/bin/sh
# The only path to any database (docs/pilot/DATA_MODEL.md §2.3). AWS deploy.sh and Railway call it:
#   docker run --rm --env-file <env file> smartfleet-api:<sha> sh prisma/scripts/migrate.sh
#
# - An existing database with tables but no migration history (made by `prisma db push`) is taken
#   over once, by the baseline release only: a last `db push` (it refuses data loss), a drift check
#   that proves live equals the baseline, then 0_baseline is marked applied.
# - An empty database (CI, local, new environments) simply gets 0_baseline from `migrate deploy`.
#   That needs PostGIS and a role allowed to CREATE EXTENSION.
# - `migrate deploy` applies each pending migration in one transaction. A migration that fails
#   (MIGRATION_BLOCKED pre-check or an error) changes nothing and stops the deploy before the
#   restart: fix the data, run `npx prisma migrate resolve --rolled-back <name>`, deploy again.
set -eu
cd "$(dirname "$0")/.."          # /app/prisma inside the image
# Absolute paths: npx runs the CLI from the package root (/app, or apps/api in the repo), not from here.
DIR=$(pwd)
SCHEMA="$DIR/schema.prisma"

if ! out=$(npx prisma db execute --schema "$SCHEMA" --file "$DIR/scripts/assert-baselined.sql" 2>&1); then
  case "$out" in *DB_NOT_BASELINED*) ;; *) echo "$out"; exit 1 ;; esac
  if [ "$(ls -d migrations/*/ | wc -l)" -ne 1 ] || [ ! -d migrations/0_baseline ]; then
    echo "DB_NOT_BASELINED: deploy the baseline release first"; exit 1
  fi
  echo "Baseline release: last db push (refuses data loss), drift check, mark 0_baseline applied"
  npx prisma db push --schema "$SCHEMA" --skip-generate
  if ! npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel "$SCHEMA" --exit-code; then
    echo "DRIFT: the database still differs from 0_baseline after db push (diff above). Nothing was marked applied."
    exit 1
  fi
  npx prisma migrate resolve --schema "$SCHEMA" --applied 0_baseline
fi

npx prisma migrate deploy --schema "$SCHEMA"

-- Run by migrate.sh before `prisma migrate deploy`. Raises DB_NOT_BASELINED when the app's tables
-- exist but no migration has been applied:
--   * a database made by `prisma db push` (AWS deploy.sh and CI before the baseline release);
--   * a database where `prisma migrate deploy` ran with no migrations folder (Railway's old start
--     command): that leaves an EMPTY _prisma_migrations table, which must not count as history.
-- An empty database passes, so `migrate deploy` simply runs 0_baseline.
DO $$
DECLARE applied bigint := 0;
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
      EXECUTE 'SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'
        INTO applied;
    END IF;
    IF applied = 0 THEN
      RAISE EXCEPTION 'DB_NOT_BASELINED: tables exist but no migration history. Run: prisma migrate resolve --applied 0_baseline';
    END IF;
  END IF;
END $$;

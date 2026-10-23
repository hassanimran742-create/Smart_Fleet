import { bootRefusalLine, checkBootEnvironment } from './boot-guards';

type Env = Record<string, string | undefined>;

/**
 * The boot guards (API_CONTRACT §3.7) as a command, for the deploy pipelines: run against the env file
 * before any migration, so an env the new API would refuse stops the deploy while the database is still
 * untouched (a migrated database under a crash-looping API is the alternative).
 *
 *   docker run --rm --env-file /srv/smartfleet/.env.prod -e NODE_ENV=production smartfleet-api:<sha> \
 *     node dist/common/bootstrap/boot-preflight.js
 *
 * Pass the NODE_ENV the container will run with (compose sets it). Prints `BOOT_PREFLIGHT_OK` and returns
 * 0 when the API would boot; prints the one BOOT_REFUSED line and returns 1 otherwise.
 */
export function runBootPreflight(env: Env = process.env, out: (line: string) => void = console.log, err: (line: string) => void = console.error): number {
  const problems = checkBootEnvironment(env);
  if (problems.length > 0) {
    err(bootRefusalLine(problems));
    return 1;
  }
  out('BOOT_PREFLIGHT_OK');
  return 0;
}

if (require.main === module) {
  process.exitCode = runBootPreflight();
}

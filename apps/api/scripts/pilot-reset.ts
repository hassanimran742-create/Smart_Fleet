/**
 * `npm run pilot:reset -- [--dry-run] [--yes] [--allow-production --confirm-db <name>]`
 * (API_CONTRACT §10.3, no HTTP).
 *
 * A thin entry point: the CLI itself lives in src/modules/pilot-setup/cli/pilot-reset.ts, so it also
 * compiles into dist and runs inside the image as `node dist/modules/pilot-setup/cli/pilot-reset.js`.
 */
import { runPilotResetCli } from '../src/modules/pilot-setup/cli/pilot-reset';

void runPilotResetCli(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});

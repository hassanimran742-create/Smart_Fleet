/**
 * `npm run pilot:setup -- --file pilot/<name>.json [--test] [--dry-run] [--labels <file.csv>]`
 * (API_CONTRACT §10.3, no HTTP).
 *
 * A thin entry point: the CLI itself lives in src/modules/pilot-setup/cli/pilot-setup.ts, so it also
 * compiles into dist and runs inside the image as `node dist/modules/pilot-setup/cli/pilot-setup.js`.
 */
import { runPilotSetupCli } from '../src/modules/pilot-setup/cli/pilot-setup';

void runPilotSetupCli(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});

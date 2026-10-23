/**
 * `npm run settings:set -- --key <key> --value '<json>' --reason "<why>"` (API_CONTRACT §5.2).
 *
 * A thin entry point: the CLI itself lives in src/modules/settings/cli/set-setting.ts, so it also
 * compiles into dist and runs inside the image as `node dist/modules/settings/cli/set-setting.js`.
 */
import { runSetSettingCli } from '../src/modules/settings/cli/set-setting';

void runSetSettingCli(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});

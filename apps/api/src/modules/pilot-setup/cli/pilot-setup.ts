import 'reflect-metadata';
import { existsSync, statSync, writeFileSync } from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { deploymentName } from '../../../common/bootstrap/boot-guards';
import { installBigIntJson } from '../../../common/bootstrap/bigint-json';
import { PilotSetupCliModule } from '../pilot-cli.modules';
import { PilotRefusal } from '../refusal';
import { PILOT_SETUP_LABEL, PilotSetupService, SETUP_KINDS, type KindTally, type SetupKind, type SetupOutcome } from '../setup/pilot-setup.service';
import { checkSetupFile, parseSetupFile, readSetupJson, resolveSetupFilePath } from '../setup/setup-file';
import { defaultLabelsFileName, labelsCsv, loginLines } from '../setup/setup-output';

const USAGE = `Load the pilot set-up from a file, all or nothing (API_CONTRACT §10.3).

  npm run pilot:setup -- --file pilot/<name>.json [--test] [--dry-run] [--labels <file.csv>]
  node dist/modules/pilot-setup/cli/pilot-setup.js --file /pilot/<name>.json --labels /pilot/<labels>.csv
              (inside the image, with the host's setup folder mounted at /pilot: infrastructure/aws/README.md)

  --file      the setup file (format: docs/pilot/pilot-setup.sample.json), read from the current
              directory or the repository root
  --test      a test server: the shops, their logins, the drivers' logins and the vans become test rows
              (pilot:reset deletes them), and opening balances are allowed. Refused on live.
  --dry-run   run every check and show what would be created or changed; write nothing
  --labels    where to write the labels CSV of the cylinders it registers
              (default: ./pilot-labels-<UTC time>.csv; never overwrites a file)

Re-runs are safe: every entry is matched by its natural key and nothing is duplicated. Each login the
run creates gets a password, printed once at the end and nowhere else.

Exit codes: 0 done (or a dry run that passed), 1 refused or failed (nothing written), 2 bad arguments,
3 done but the labels file could not be saved (the labels are printed instead).`;

/** The exit code of a run that committed but couldn't save its labels file (API_CONTRACT §10.5). */
export const EXIT_LABELS_NOT_SAVED = 3;

export interface PilotSetupArgs {
  file: string;
  test: boolean;
  dryRun: boolean;
  labels?: string;
}

/** Parses `--file`, `--test`, `--dry-run` and `--labels` (also `--file=…`); throws a message for the usage text. */
export function parsePilotSetupArgs(argv: readonly string[]): PilotSetupArgs {
  const values = new Map<string, string>();
  let test = false;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--test') {
      test = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    const match = /^--(file|labels)(?:=(.*))?$/s.exec(arg);
    if (!match) throw new Error(`Unknown argument: ${arg}`);
    const value = match[2] ?? argv[++i];
    if (value === undefined || value.trim() === '' || value.startsWith('--')) throw new Error(`--${match[1]} needs a value`);
    values.set(match[1], value.trim());
  }
  const file = values.get('file');
  if (!file) throw new Error('--file is required');
  return { file, test, dryRun, labels: values.get('labels') };
}

/** Where the run reads and writes, and what it prints to; the process's own by default. */
export interface PilotCliIo {
  out?: (line: string) => void;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

const KIND_NAMES: Record<SetupKind, string> = {
  city: 'city',
  zones: 'zones',
  officeUsers: 'office users',
  cylinderTypes: 'cylinder types',
  distributors: 'shops',
  prices: 'prices',
  drivers: 'drivers',
  vans: 'vans',
  stations: 'stations',
  settings: 'settings',
  cylinders: 'cylinders',
  customers: 'customers',
  openingBalances: 'opening balances',
};

const LIST_MAX = 12;

function names(list: readonly string[]): string {
  const shown = list.slice(0, LIST_MAX).join(', ');
  return list.length > LIST_MAX ? `${shown}, … ${list.length - LIST_MAX} more` : shown;
}

/** AG-C0001 … AG-C0035 as one range per shop: "AG-C0001–AG-C0035". */
export function cylinderRanges(codes: readonly string[]): string {
  const parsed = codes
    .map((code) => /^(.*-C)(\d+)$/.exec(code))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ prefix: match[1], no: Number(match[2]), width: match[2].length }));
  const out: string[] = [];
  let start = parsed[0];
  let prev = parsed[0];
  const flush = () => {
    if (!start || !prev) return;
    const at = (part: typeof start) => `${part.prefix}${String(part.no).padStart(part.width, '0')}`;
    out.push(start.no === prev.no ? at(start) : `${at(start)}–${at(prev)}`);
  };
  for (const part of parsed.slice(1)) {
    if (part.prefix === prev.prefix && part.no === prev.no + 1) {
      prev = part;
      continue;
    }
    flush();
    start = part;
    prev = part;
  }
  flush();
  return names(out);
}

function tallyLine(kind: SetupKind, tally: KindTally, dryRun: boolean): string | null {
  const parts: string[] = [];
  if (tally.created.length) {
    const verb = kind === 'cylinders' ? (dryRun ? 'to register' : 'registered') : dryRun ? 'to create' : 'created';
    const list = kind === 'cylinders' ? cylinderRanges(tally.created) : names(tally.created);
    parts.push(`${tally.created.length} ${verb} (${list})`);
  }
  if (tally.changed.length) parts.push(`${tally.changed.length} ${dryRun ? 'to change' : 'changed'} (${names(tally.changed)})`);
  if (tally.unchanged) {
    parts.push(kind === 'cylinders' ? `${tally.unchanged} of the file's sizes already at their count` : `${tally.unchanged} already as in the file`);
  }
  return parts.length ? `  ${KIND_NAMES[kind].padEnd(17)}${parts.join('; ')}` : null;
}

function summaryLines(outcome: SetupOutcome, dryRun: boolean): string[] {
  const lines = SETUP_KINDS.map((kind) => tallyLine(kind, outcome.tally[kind], dryRun)).filter((line): line is string => line !== null);
  return [...lines, ...outcome.notes.map((note) => `  Note: ${note}`)];
}

/**
 * `npm run pilot:setup -- --file pilot/<name>.json [--test] [--dry-run]` (API_CONTRACT §10.3). Resolves to
 * the exit code: 0 done (or a dry run that passed), 1 refused or failed (nothing written), 2 bad arguments,
 * 3 done but the labels file could not be saved (review23 robustness-jobs-08).
 */
export async function runPilotSetupCli(argv: readonly string[], io: PilotCliIo = {}): Promise<number> {
  const out = io.out ?? ((line: string) => console.log(line));
  const env = io.env ?? process.env;
  const cwd = io.cwd ?? process.cwd();

  let args: PilotSetupArgs;
  try {
    args = parsePilotSetupArgs(argv);
  } catch (error) {
    out(`${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  if (args.test && deploymentName(env) === 'production') {
    out('Refused: --test can\'t run on the live server (APP_ENV, or NODE_ENV without APP_ENV, is production). Test rows and opening balances never go on live. Nothing was written.');
    return 1;
  }

  const filePath = resolveSetupFilePath(args.file, cwd);
  if (!filePath) {
    out(
      `Refused: can't find ${args.file} (looked in ${cwd} and the repository root). Nothing was written.` +
        (path.isAbsolute(args.file) ? '' : ' Inside the image, mount the folder that holds it and give its full path (--file /pilot/<name>.json).'),
    );
    return 1;
  }
  const read = readSetupJson(filePath);
  if (!read.ok) {
    out(`Refused: ${read.reason}. Nothing was written.`);
    return 1;
  }
  const parsed = parseSetupFile(read.json);
  if (!parsed.ok) return refuse(out, parsed.refusal);
  const checked = checkSetupFile(parsed.file, read.json, { test: args.test });
  if (checked instanceof PilotRefusal) return refuse(out, checked);

  let labelsPath: string | null = null;
  if (!args.dryRun && parsed.file.stock.length > 0) {
    labelsPath = path.resolve(cwd, args.labels ?? defaultLabelsFileName());
    const dir = path.dirname(labelsPath);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      out(`Refused: the labels folder ${dir} doesn't exist. Nothing was written.`);
      return 1;
    }
    if (existsSync(labelsPath)) {
      out(`Refused: ${labelsPath} already exists; a labels file is never overwritten. Nothing was written.`);
      return 1;
    }
  }

  installBigIntJson();
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;
  try {
    app = await NestFactory.createApplicationContext(PilotSetupCliModule, { logger: ['error', 'warn'], abortOnError: false });
  } catch (error) {
    out(`Could not start: ${(error as Error)?.message ?? String(error)}`);
    return 1;
  }
  const fileName = (path.relative(cwd, filePath) || path.basename(filePath)).split(path.sep).join('/');
  try {
    const setup = app.get(PilotSetupService);
    const zoneProblem = await setup.precheckZones(parsed.file, read.json);
    if (zoneProblem) return refuse(out, zoneProblem);
    const outcome = await setup.apply(checked, read.json, { test: args.test, dryRun: args.dryRun, fileName });
    const mode = args.test ? ' (--test)' : '';
    if (args.dryRun) {
      out(`Dry run of ${fileName}${mode}: every check passed and nothing was written. A run would:`);
      for (const line of summaryLines(outcome, true)) out(line);
      return 0;
    }
    out(`Pilot setup from ${fileName}${mode}: done, in one transaction.`);
    for (const line of summaryLines(outcome, false)) out(line);
    let code = 0;
    if (outcome.labels.length > 0 && labelsPath) {
      try {
        writeFileSync(labelsPath, labelsCsv(outcome.labels), { encoding: 'utf8', flag: 'wx' });
        out(`Labels: ${outcome.labels.length} cylinders written to ${labelsPath}.`);
      } catch (error) {
        // Committed: not 1 ("nothing written"). The labels are printed, and GET /cylinders lists them too.
        code = EXIT_LABELS_NOT_SAVED;
        out(`The cylinders are registered, but the labels file could not be written (${(error as Error).message}). The labels:`);
        for (const line of labelsCsv(outcome.labels).trimEnd().split('\r\n')) out(line);
      }
    } else {
      out('Labels: no new cylinders, so no labels file.');
    }
    out(`Audit row pilot.setup written (actor SYSTEM ${PILOT_SETUP_LABEL}).`);
    out('');
    for (const line of loginLines(outcome.logins)) out(line);
    return code;
  } catch (error) {
    if (error instanceof PilotRefusal) return refuse(out, error);
    Logger.error((error as Error)?.stack ?? String(error), undefined, 'pilot:setup');
    out(`Refused: ${(error as Error)?.message ?? String(error)}. Nothing was written.`);
    return 1;
  } finally {
    await app.close();
  }
}

function refuse(out: (line: string) => void, refusal: PilotRefusal): number {
  for (const line of refusal.lines()) out(line);
  out('Nothing was written.');
  return 1;
}

if (require.main === module) {
  void runPilotSetupCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

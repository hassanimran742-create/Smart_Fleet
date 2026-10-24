import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { installBigIntJson } from '../../../common/bootstrap/bigint-json';
import { PilotResetCliModule } from '../pilot-cli.modules';
import { PILOT_RESET_LABEL, PilotResetService, type KeptPointer, type ResetResult } from '../reset/pilot-reset.service';
import type { PilotCliIo } from './pilot-setup';

const USAGE = `Delete the test data: every test shop, test login and test van, and what hangs off them (API_CONTRACT §10.3).

  npm run pilot:reset -- [--dry-run] [--yes] [--allow-production --confirm-db <database name>]
  node dist/modules/pilot-setup/cli/pilot-reset.js ... (inside the image)

  --dry-run           print the plan (rows per table) and delete nothing
  --yes               delete, in one transaction; without it the plan is printed and nothing is deleted
  --allow-production  on production (APP_ENV or NODE_ENV is production) the reset refuses without it
  --confirm-db        with --allow-production: the name of the database to reset, which must be this one

Office users, zones, cities, cylinder types, stations and settings are never deleted. It refuses, and
deletes nothing, when a row that stays points at test data (a live shop's order on a test van's run).`;

export const NOTHING_DELETED_RUN_WITH_YES = 'Nothing deleted. Run again with --yes to delete.';

export interface PilotResetArgs {
  yes: boolean;
  dryRun: boolean;
  allowProduction: boolean;
  confirmDb?: string;
}

/** Parses the reset's flags; throws a message for the usage text. */
export function parsePilotResetArgs(argv: readonly string[]): PilotResetArgs {
  const args: PilotResetArgs = { yes: false, dryRun: false, allowProduction: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--yes') args.yes = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--allow-production') args.allowProduction = true;
    else {
      const match = /^--confirm-db(?:=(.*))?$/s.exec(arg);
      if (!match) throw new Error(`Unknown argument: ${arg}`);
      const value = match[1] ?? argv[++i];
      if (value === undefined || value.trim() === '' || value.startsWith('--')) throw new Error('--confirm-db needs a value');
      args.confirmDb = value.trim();
    }
  }
  return args;
}

/** The stricter reading for a destructive command: production when APP_ENV or NODE_ENV says so (G10-02). */
export function isProductionForReset(env: NodeJS.ProcessEnv): boolean {
  const app = (env.APP_ENV ?? '').trim().toLowerCase();
  const node = (env.NODE_ENV ?? '').trim().toLowerCase();
  return app === 'production' || node === 'production';
}

function planLines(result: ResetResult): string[] {
  if (result.total === 0) return ['Pilot reset plan: no test data found (no test shop, test login or test van).'];
  const width = Math.max(...result.plan.map((row) => row.table.length), 5);
  return [
    'Pilot reset plan: rows to delete per table (test shops, test logins, test vans and what hangs off them).',
    ...result.plan.map((row) => `  ${row.table.padEnd(width)}  ${String(row.rows).padStart(6)}`),
    `  ${'total'.padEnd(width)}  ${String(result.total).padStart(6)}`,
  ];
}

function pointerLine(pointer: KeptPointer): string {
  const name = pointer.name ? ` (${pointer.name})` : '';
  const target = pointer.targetName ? ` (${pointer.targetName})` : '';
  return (
    `Refused: ${pointer.table} ${pointer.id}${name} stays, but points at ${pointer.targetTable} ${pointer.targetId}${target}, ` +
    `which the reset would delete (${pointer.table}.${pointer.column}). Fix or remove that row first.`
  );
}

/**
 * `npm run pilot:reset -- --yes [--dry-run]` (API_CONTRACT §10.3). Resolves to the exit code: 0 deleted (or
 * a dry run), 1 refused or not confirmed (nothing deleted), 2 bad arguments.
 */
export async function runPilotResetCli(argv: readonly string[], io: PilotCliIo = {}): Promise<number> {
  const out = io.out ?? ((line: string) => console.log(line));
  const env = io.env ?? process.env;

  let args: PilotResetArgs;
  try {
    args = parsePilotResetArgs(argv);
  } catch (error) {
    out(`${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const production = isProductionForReset(env);
  if (production && !(args.allowProduction && args.confirmDb)) {
    out('Refused: this is production (APP_ENV or NODE_ENV is production). The reset runs here only with --allow-production --confirm-db <name>, naming this database. Nothing deleted.');
    return 1;
  }

  installBigIntJson();
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;
  try {
    app = await NestFactory.createApplicationContext(PilotResetCliModule, { logger: ['error', 'warn'], abortOnError: false });
  } catch (error) {
    out(`Could not start: ${(error as Error)?.message ?? String(error)}`);
    return 1;
  }
  try {
    const reset = app.get(PilotResetService);
    if (production && (await reset.currentDatabase()) !== args.confirmDb) {
      out(`Refused: --confirm-db ${args.confirmDb} doesn't name this database. Nothing deleted.`);
      return 1;
    }
    const execute = args.yes && !args.dryRun;
    const result = await reset.run({ execute });
    for (const line of planLines(result)) out(line);
    if (result.blocked) {
      out(pointerLine(result.blocked));
      out('Nothing deleted.');
      return 1;
    }
    if (args.dryRun) {
      out('Dry run: nothing deleted.');
      return 0;
    }
    if (!args.yes) {
      out(NOTHING_DELETED_RUN_WITH_YES);
      return 1;
    }
    out(`Deleted ${result.total} rows in one transaction. Storage objects stay in the bucket.`);
    out(`Audit row pilot.reset written (actor SYSTEM ${PILOT_RESET_LABEL}).`);
    return 0;
  } catch (error) {
    Logger.error((error as Error)?.stack ?? String(error), undefined, 'pilot:reset');
    out(`Refused: ${(error as Error)?.message ?? String(error)}. Nothing deleted.`);
    return 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void runPilotResetCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

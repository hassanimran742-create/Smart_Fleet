import 'reflect-metadata';
import { readFileSync } from 'fs';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { SettingKey } from '@smartfleet/shared-types';
import { systemActor } from '../../../common/auth/actor';
import { AppError } from '../../../common/errors/app-error';
import { installBigIntJson } from '../../../common/bootstrap/bigint-json';
import configuration from '../../../config/configuration';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogModule } from '../../audit-log/audit-log.module';
import { isSettingKey } from '../registry';
import { SettingsModule } from '../settings.module';
import { SettingsService } from '../settings.service';

/** The audit label of every change made here (API_CONTRACT §5.2). */
export const SETTINGS_CLI_LABEL = 'cli:settings';

const USAGE = `Set one runtime setting, including keys the API can't edit (topup.account).

  npm run settings:set -- --key <key> (--value '<json>' | --value-file <file.json>) --reason "<why, 5-300 chars>" [--dry-run]
  node dist/modules/settings/cli/set-setting.js --key ... (inside the image)

  --key         a setting key, for example topup.account or support.phone
  --value       the new value as JSON: '{"accountTitle":"…","bankName":"…","iban":"PK…","accountNumber":"…"}', '"0300 1234567"', 'null'
  --value-file  read the JSON value from a file instead
  --reason      required; stored in the audit row (setting.update, actor SYSTEM ${SETTINGS_CLI_LABEL})
  --dry-run     validate and show the change without writing it`;

export interface SetSettingArgs {
  key: string;
  value: unknown;
  reason: string;
  dryRun: boolean;
}

/** Parses `--key`, `--value` / `--value-file`, `--reason` and `--dry-run`; throws a usage message. */
export function parseSetSettingArgs(argv: readonly string[]): SetSettingArgs {
  const flags = new Map<string, string>();
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    const match = /^--(key|value|value-file|reason)(?:=(.*))?$/s.exec(arg);
    if (!match) throw new Error(`Unknown argument: ${arg}`);
    const text = match[2] ?? argv[++i];
    if (text === undefined) throw new Error(`--${match[1]} needs a value`);
    flags.set(match[1], text);
  }
  const key = flags.get('key')?.trim();
  if (!key) throw new Error('--key is required');
  const reason = flags.get('reason')?.trim() ?? '';
  if (reason.length < 5 || reason.length > 300) throw new Error('--reason is required (5 to 300 characters)');
  const raw = flags.has('value-file') ? readFileSync(flags.get('value-file') as string, 'utf8') : flags.get('value');
  if (raw === undefined) throw new Error('--value or --value-file is required');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('The value must be JSON: quote text values, for example \'"9am-9pm"\'');
  }
  return { key, value, reason, dryRun };
}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [configuration] }), PrismaModule, AuditLogModule, SettingsModule],
})
class SettingsCliModule {}

/** Runs the CLI; resolves to the process exit code. */
export async function runSetSettingCli(argv: readonly string[], out: (line: string) => void = console.log): Promise<number> {
  let args: SetSettingArgs;
  try {
    args = parseSetSettingArgs(argv);
  } catch (error) {
    out(`${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  if (!isSettingKey(args.key)) {
    out(`Unknown setting: ${args.key}`);
    return 2;
  }
  const key: SettingKey = args.key;

  installBigIntJson();
  const app = await NestFactory.createApplicationContext(SettingsCliModule, { logger: ['error', 'warn'] });
  try {
    const settings = app.get(SettingsService);
    const next = settings.parseValue(key, args.value);
    const before = await settings.get(key);
    out(`${key}: ${JSON.stringify(before)} -> ${JSON.stringify(next)}`);
    if (args.dryRun) {
      out('Dry run: nothing was written.');
      return 0;
    }
    await settings.set(key, next, systemActor(SETTINGS_CLI_LABEL), args.reason, { allowNotEditable: true });
    out(`Saved. Audit row setting.update written (actor SYSTEM ${SETTINGS_CLI_LABEL}).`);
    return 0;
  } catch (error) {
    if (error instanceof AppError) {
      out(`${error.code}: ${error.message}`);
      return 1;
    }
    Logger.error((error as Error)?.stack ?? String(error), undefined, 'settings:set');
    return 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void runSetSettingCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

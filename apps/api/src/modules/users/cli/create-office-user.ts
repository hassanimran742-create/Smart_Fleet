import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { UserRole, UserStatus } from '@prisma/client';
import { formatPkPhone, normalizePkPhone } from '@smartfleet/shared-utils';
import { VALIDATION_MESSAGE_EN } from '@smartfleet/shared-validation';
import * as argon2 from 'argon2';
import { randomInt } from 'crypto';
import { systemActor } from '../../../common/auth/actor';
import { installBigIntJson } from '../../../common/bootstrap/bigint-json';
import { AppError } from '../../../common/errors/app-error';
import { isUniqueViolation } from '../../../common/errors/prisma-errors';
import configuration from '../../../config/configuration';
import { PrismaModule } from '../../../prisma/prisma.module';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogModule } from '../../audit-log/audit-log.module';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { SettingsModule } from '../../settings/settings.module';

/** The audit label of every office login created here (actor SYSTEM). */
export const OFFICE_USER_CLI_LABEL = 'cli:create-office';

const NAME_MAX = 80;

const USAGE = `Create one of the named office (SUPER_ADMIN) logins and print its password once (API_CONTRACT §8.5 step 8).

  npm run users:create-office -- --name "<name>" --phone <phone>
  node dist/modules/users/cli/create-office-user.js --name "<name>" --phone <phone>   (inside the image)

  --name   the person's name, 1-${NAME_MAX} characters, for example "Owner"
  --phone  their mobile number, in any usual form: 0333 1000001, +92 333 1000001

The login can sign in to the office website at once. Write the password down and give it to the
person; it is not stored anywhere readable and is never shown again. Audit row: user.create_office
(actor SYSTEM ${OFFICE_USER_CLI_LABEL}).`;

export interface CreateOfficeUserArgs {
  name: string;
  phone: string;
}

/** Parses `--name` and `--phone` (also `--name=…`); throws a message for the usage text. */
export function parseCreateOfficeUserArgs(argv: readonly string[]): CreateOfficeUserArgs {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const match = /^--(name|phone)(?:=(.*))?$/s.exec(arg);
    if (!match) throw new Error(`Unknown argument: ${arg}`);
    const text = match[2] ?? argv[++i];
    if (text === undefined) throw new Error(`--${match[1]} needs a value`);
    flags.set(match[1], text);
  }
  const name = flags.get('name')?.trim() ?? '';
  if (name.length < 1 || name.length > NAME_MAX) throw new Error(`--name is required (1 to ${NAME_MAX} characters)`);
  const phone = flags.get('phone')?.trim() ?? '';
  if (!phone) throw new Error('--phone is required');
  return { name, phone };
}

/** Letters and digits that can't be misread when written down or read aloud (no 0/O, 1/l/I). */
const PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/** A new random password, three groups of four ("Xk7m-Qp2a-W9hd"): about 69 bits. */
export function generateOfficePassword(): string {
  const group = () => Array.from({ length: 4 }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join('');
  return [group(), group(), group()].join('-');
}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [configuration] }), PrismaModule, SettingsModule, AuditLogModule],
})
class OfficeUserCliModule {}

/**
 * `npm run users:create-office -- --name "<name>" --phone <phone>`: creates an ACTIVE SUPER_ADMIN with
 * a generated password, printed once, and writes `user.create_office` in the same transaction. A
 * phone that any user already has is refused (USER_PHONE_IN_USE) and nothing is created. Resolves
 * to the exit code: 0 created, 1 refused or failed, 2 bad arguments.
 */
export async function runCreateOfficeUserCli(
  argv: readonly string[],
  out: (line: string) => void = console.log,
): Promise<number> {
  let args: CreateOfficeUserArgs;
  try {
    args = parseCreateOfficeUserArgs(argv);
  } catch (error) {
    out(`${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const phone = normalizePkPhone(args.phone);
  if (!phone) {
    out(`--phone: ${VALIDATION_MESSAGE_EN.INVALID_PHONE}`);
    return 2;
  }

  installBigIntJson();
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;
  try {
    // abortOnError false: a start-up failure is reported here, not by exiting the process.
    app = await NestFactory.createApplicationContext(OfficeUserCliModule, { logger: ['error', 'warn'], abortOnError: false });
  } catch (error) {
    out(`Could not start: ${(error as Error)?.message ?? String(error)}`);
    return 1;
  }
  try {
    const prisma = app.get(PrismaService);
    const audit = app.get(AuditLogService);
    const password = generateOfficePassword();
    const passwordHash = await argon2.hash(password);
    const user = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { phone }, select: { role: true } });
      if (existing) throw new AppError('USER_PHONE_IN_USE', { existingRole: existing.role });
      const created = await tx.user.create({
        data: { phone, name: args.name, role: UserRole.SUPER_ADMIN, status: UserStatus.ACTIVE, passwordHash },
        select: { id: true, name: true, phone: true },
      });
      await audit.record(
        {
          action: 'user.create_office',
          actor: systemActor(OFFICE_USER_CLI_LABEL),
          resourceType: 'user',
          resourceId: created.id,
          after: { name: created.name, phone: created.phone, role: UserRole.SUPER_ADMIN },
        },
        tx,
      );
      return created;
    });
    out(`Created the office login "${user.name}" (${formatPkPhone(user.phone, 'international')}), role SUPER_ADMIN.`);
    out(`Password, shown only this once: ${password}`);
    out(`Audit row user.create_office written (actor SYSTEM ${OFFICE_USER_CLI_LABEL}).`);
    return 0;
  } catch (error) {
    const refusal = isUniqueViolation(error, 'users_phone_key') ? new AppError('USER_PHONE_IN_USE') : error;
    if (refusal instanceof AppError) {
      out(`${refusal.code}: ${refusal.message}`);
      return 1;
    }
    Logger.error((error as Error)?.stack ?? String(error), undefined, 'users:create-office');
    return 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void runCreateOfficeUserCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

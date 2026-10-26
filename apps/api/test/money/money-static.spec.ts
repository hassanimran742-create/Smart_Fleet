/**
 * Static checks for the money lane: only modules/wallet writes balances and ledger rows (lane
 * acceptance, README rule 3), the nightly job's schedule, the 200 answers of top-up actions (G15-03),
 * the roles on every money route, and no company account hard-coded anywhere.
 */
import * as fs from 'fs';
import * as path from 'path';
import { HttpStatus } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { EXACT_ROLES_KEY, ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator';
import { LedgerController } from '../../src/modules/ledger/ledger.controller';
import { AdminTopupsController } from '../../src/modules/payments/admin-topups.controller';
import { PaymentsController } from '../../src/modules/payments/payments.controller';
import { ReportsController } from '../../src/modules/reports/reports.controller';
import { AdminWalletsController } from '../../src/modules/wallet/admin-wallets.controller';
import { WalletController } from '../../src/modules/wallet/wallet.controller';

const SRC = path.resolve(__dirname, '..', '..', 'src');
const WALLET_DIR = path.join(SRC, 'modules', 'wallet');
const MONEY_LANE_DIRS = ['ledger', 'payments', 'reports'].map((dir) => path.join(SRC, 'modules', dir));

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [full] : [];
  });
}

/** Writes to the wallet's two tables, as SQL or as Prisma calls. */
const MONEY_WRITES: Array<[string, RegExp]> = [
  ['balance set in SQL', /\badvance_balance_paisa\s*=/i],
  // A select (`: true`) or a filter (`: { gte: … }`) only reads; the lookahead takes the spaces itself.
  ['balance set through Prisma', /\badvanceBalancePaisa\s*:(?!\s*(true|false)\b|\s*\{\s*(gte|gt|lte|lt|equals|not)\b)/],
  ['ledger write through Prisma', /\bledgerEntry\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/],
  ['ledger write in SQL', /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?ledger_entries"?/i],
];

function moneyWrites(files: string[]): string[] {
  const found: string[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const [what, pattern] of MONEY_WRITES) {
      if (pattern.test(text)) found.push(`${path.relative(SRC, file).split(path.sep).join('/')}: ${what}`);
    }
  }
  return found;
}

describe('only modules/wallet moves money (api-money acceptance)', () => {
  it('the wallet module itself is where the balance and the ledger are written', () => {
    expect(moneyWrites(sourceFiles(WALLET_DIR)).length).toBeGreaterThan(0);
  });

  it('the ledger, payments and reports modules never write a balance or a ledger row', () => {
    expect(moneyWrites(MONEY_LANE_DIRS.flatMap(sourceFiles))).toEqual([]);
  });

  it('no module outside modules/wallet writes a balance or a ledger row', () => {
    const files = sourceFiles(SRC).filter((file) => !file.startsWith(WALLET_DIR + path.sep));
    expect(moneyWrites(files)).toEqual([]);
  });
});

describe('the nightly wallet check (API_CONTRACT §8.5)', () => {
  const cronUses = (dir: string) =>
    sourceFiles(dir).flatMap((file) =>
      [...fs.readFileSync(file, 'utf8').matchAll(/@Cron\(\s*([^,)]+?)\s*(?:,\s*(\{[^)]*\}))?\s*\)/g)].map((m) => ({
        file: path.basename(file),
        expression: m[1],
        options: m[2] ?? '',
      })),
    );

  it("FND-033 the money lane's one cron is wallet-nightly-check at 03:30, Asia/Karachi", () => {
    const uses = [WALLET_DIR, ...MONEY_LANE_DIRS].flatMap(cronUses);
    expect(uses).toEqual([
      { file: 'wallet-check.job.ts', expression: "'30 3 * * *'", options: "{ name: 'wallet-nightly-check', timeZone: 'Asia/Karachi' }" },
    ]);
  });

  it('G01-06 the office wallet page only reads: it never touches alerts', () => {
    for (const file of ['wallet-admin.service.ts', 'admin-wallets.controller.ts', 'wallet.service.ts']) {
      const text = fs.readFileSync(path.join(WALLET_DIR, file), 'utf8');
      expect({ file, alerts: /AlertsService|alerts\.raise|\.alert\./.test(text) }).toEqual({ file, alerts: false });
    }
  });
});

describe('money routes: status codes and roles', () => {
  const handlers = (controller: { prototype: object }) =>
    Object.getOwnPropertyNames(controller.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => ({ name, fn: (controller.prototype as Record<string, unknown>)[name] as object }));

  it('G15-03 approve, reject, verify and bank-proof answer 200; creates keep 201', () => {
    const code = (name: string) => Reflect.getMetadata(HTTP_CODE_METADATA, (PaymentsController.prototype as unknown as Record<string, object>)[name]);
    expect(['approve', 'reject', 'verify', 'bankProof'].map(code)).toEqual([HttpStatus.OK, HttpStatus.OK, HttpStatus.OK, HttpStatus.OK]);
    expect(['createRequest', 'legacyTopup'].map(code)).toEqual([undefined, undefined]);
  });

  it('every money route names its roles: shop routes DISTRIBUTOR exact, office routes SUPER_ADMIN exact', () => {
    const rule = (controller: { prototype: object } & object, fn: object) => ({
      exact: (Reflect.getMetadata(EXACT_ROLES_KEY, fn) ?? Reflect.getMetadata(EXACT_ROLES_KEY, controller)) as UserRole[] | undefined,
      roles: (Reflect.getMetadata(ROLES_KEY, fn) ?? Reflect.getMetadata(ROLES_KEY, controller)) as UserRole[] | undefined,
      public: Reflect.getMetadata(IS_PUBLIC_KEY, fn) === true,
    });
    const expected: Record<string, { exact?: UserRole[]; roles?: UserRole[]; public?: true }> = {
      'WalletController.summary': { exact: [UserRole.DISTRIBUTOR] },
      'WalletController.statement': { exact: [UserRole.DISTRIBUTOR] },
      'LedgerController.mine': { exact: [UserRole.DISTRIBUTOR] },
      'LedgerController.balance': { exact: [UserRole.DISTRIBUTOR] },
      'AdminWalletsController.list': { exact: [UserRole.SUPER_ADMIN] },
      'AdminWalletsController.detail': { exact: [UserRole.SUPER_ADMIN] },
      'AdminWalletsController.statement': { exact: [UserRole.SUPER_ADMIN] },
      'AdminWalletsController.correct': { exact: [UserRole.SUPER_ADMIN] },
      'AdminTopupsController.list': { exact: [UserRole.SUPER_ADMIN] },
      'PaymentsController.info': { exact: [UserRole.DISTRIBUTOR] },
      'PaymentsController.createRequest': { exact: [UserRole.DISTRIBUTOR] },
      'PaymentsController.mine': { exact: [UserRole.DISTRIBUTOR] },
      'PaymentsController.legacyTopup': { exact: [UserRole.DISTRIBUTOR] },
      'PaymentsController.webhook': { public: true },
      'PaymentsController.legacyList': { exact: [UserRole.SUPER_ADMIN] },
      'PaymentsController.byId': { roles: [UserRole.DISTRIBUTOR] },
      'PaymentsController.approve': { exact: [UserRole.SUPER_ADMIN] },
      'PaymentsController.reject': { exact: [UserRole.SUPER_ADMIN] },
      'PaymentsController.bankProof': { exact: [UserRole.DISTRIBUTOR] },
      'PaymentsController.verify': { exact: [UserRole.SUPER_ADMIN] },
    };
    const controllers = [WalletController, LedgerController, AdminWalletsController, AdminTopupsController, PaymentsController];
    const seen: string[] = [];
    for (const controller of controllers) {
      for (const { name, fn } of handlers(controller)) {
        const id = `${controller.name}.${name}`;
        seen.push(id);
        const actual = rule(controller, fn);
        const want = expected[id];
        expect({ id, exact: actual.exact, roles: want?.roles ? actual.roles : undefined, public: actual.public }).toEqual({
          id,
          exact: want?.exact,
          roles: want?.roles,
          public: want?.public ?? false,
        });
      }
    }
    expect(seen.sort()).toEqual(Object.keys(expected).sort());
    // Reports: office exact on the class.
    expect(Reflect.getMetadata(EXACT_ROLES_KEY, ReportsController)).toEqual([UserRole.SUPER_ADMIN]);
  });
});

describe('the company account comes only from settings (ADR-09)', () => {
  it('no bank account, title or IBAN is written in the API code', () => {
    for (const file of sourceFiles(SRC)) {
      const text = fs.readFileSync(file, 'utf8');
      const name = path.relative(SRC, file).split(path.sep).join('/');
      expect({ name, hardCoded: /NIONSSTECH|PK96BAHL|Bank Al Habib/i.test(text) }).toEqual({ name, hardCoded: false });
    }
  });
});

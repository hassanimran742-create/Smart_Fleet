/**
 * Acceptance (api-orders lane): the orders, trips, custody and filling-orders modules, and every other
 * module this lane owns, contain no direct write to `distributors.advance_balance_paisa` or to
 * `ledger_entries`. All money goes through WalletService (API_CONTRACT §5.1, §5.4).
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..', '..', 'src', 'modules');
const LANE_MODULES = [
  'pricing',
  'zones',
  'stores',
  'distributors',
  'clients',
  'orders',
  'trips',
  'custody',
  'dispatch',
  'filling-orders',
  'filling-stations',
  'cylinders',
  'admin-summary',
];

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

/** Writes to the balance or the ledger, in Prisma calls or raw SQL. */
const MONEY_WRITES: Array<[string, RegExp]> = [
  ['raw SQL on the balance column', /advance_balance_paisa/i],
  ['a Prisma write of the balance', /advanceBalancePaisa\s*:/],
  ['raw SQL on the ledger table', /\b(insert\s+into|update|delete\s+from)\s+ledger_entries\b/i],
  ['a Prisma ledger write', /\.ledgerEntry\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/],
];

describe('api-orders: money moves only through WalletService', () => {
  it('no module of the api-orders lane writes the balance or the ledger directly', () => {
    const offenders: string[] = [];
    for (const module of LANE_MODULES) {
      for (const file of files(path.join(SRC, module))) {
        const text = fs.readFileSync(file, 'utf8');
        for (const [what, pattern] of MONEY_WRITES) {
          if (pattern.test(text)) offenders.push(`${path.relative(SRC, file)}: ${what}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the order money calls go through OrdersFeePolicy to WalletService.debit and WalletService.reverse', () => {
    const policy = fs.readFileSync(path.join(SRC, 'orders', 'orders-fee.policy.ts'), 'utf8');
    expect(policy).toMatch(/this\.wallet\.debit\(/);
    expect(policy).toMatch(/this\.wallet\.reverse\(/);
    // Refills carry no money: the refill and station modules never import the wallet.
    for (const module of ['filling-orders', 'filling-stations']) {
      for (const file of files(path.join(SRC, module))) {
        const text = fs.readFileSync(file, 'utf8');
        expect({ file: path.basename(file), importsWallet: /from '\.\.\/wallet\//.test(text) }).toEqual({ file: path.basename(file), importsWallet: false });
      }
    }
  });
});

/**
 * The static check of EXP-014 step 4 (API_CONTRACT §5.1: expenses may call files and audit, **never
 * wallet**): starting from every file in apps/api/src/modules/expenses, it follows the relative imports
 * through the API's own source and reports any path that reaches modules/wallet. Not a test file itself.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

export const API_SRC = path.resolve(__dirname, '..', '..', 'src');
export const EXPENSES_DIR = path.join(API_SRC, 'modules', 'expenses');
const WALLET_DIR = path.join(API_SRC, 'modules', 'wallet');

function sourcesIn(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourcesIn(full);
      return /\.ts$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : [];
    });
}

function resolveRelative(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts'), base]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function importsOf(file: string): string[] {
  const info = ts.preProcessFile(fs.readFileSync(file, 'utf8'), true, true);
  return info.importedFiles.map((ref) => ref.fileName);
}

const relative = (file: string) => path.relative(API_SRC, file).split(path.sep).join('/');

/** Import chains from the expenses module into the wallet module, e.g. ["modules/expenses/x.ts → modules/wallet/wallet.service.ts"]. */
export function walletImportsUnderExpenses(): string[] {
  const hits: string[] = [];
  const seen = new Set<string>();
  const queue: Array<{ file: string; chain: string[] }> = sourcesIn(EXPENSES_DIR).map((file) => ({ file, chain: [relative(file)] }));
  while (queue.length > 0) {
    const { file, chain } = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of importsOf(file)) {
      if (/(^|\/)wallet(\/|\.module|\.service|$)/.test(specifier) && !specifier.startsWith('.')) {
        hits.push([...chain, specifier].join(' → '));
        continue;
      }
      const target = resolveRelative(file, specifier);
      if (!target) continue;
      if (target.startsWith(WALLET_DIR + path.sep)) {
        hits.push([...chain, relative(target)].join(' → '));
        continue;
      }
      if (target.startsWith(API_SRC + path.sep)) queue.push({ file: target, chain: [...chain, relative(target)] });
    }
  }
  return hits;
}

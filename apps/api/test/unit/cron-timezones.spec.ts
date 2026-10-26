/**
 * FND-033: every daily job runs on Pakistan time (ADR-21, API_CONTRACT §8.5, §9.9). A static scan of
 * every `@Cron(...)` in apps/api/src: the expression and its options.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..', '..', 'src');

interface CronUse {
  file: string;
  expression: string;
  options: string;
  name: string | null;
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [full] : [];
  });
}

/** `@Cron(<expression>, { … })` uses, read from the source text. */
function cronUses(): CronUse[] {
  const uses: CronUse[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/@Cron\(\s*([^,)]+?)\s*(?:,\s*(\{[^)]*\}))?\s*\)/g)) {
      const options = match[2] ?? '';
      uses.push({
        file: path.relative(SRC, file).split(path.sep).join('/'),
        expression: match[1].trim(),
        options,
        name: /name:\s*'([^']+)'/.exec(options)?.[1] ?? null,
      });
    }
  }
  return uses;
}

/** The jobs API_CONTRACT §8.5 and §9.9 list, with their schedule. */
const DOCUMENTED: Record<string, RegExp> = {
  'wallet-nightly-check': /'30 3 \* \* \*'/,
  'housekeeping-nightly': /^process\.env\.HOUSEKEEPING_CRON \?\? '0 3 \* \* \*'$/,
  'day-cutoff-van-check': /'0 3 \* \* \*'/,
  'confirmation-expiry': /'\*\/15 \* \* \* \*'/,
};

describe('FND-033 Every daily job runs on Pakistan time', () => {
  it('FND-033 every @Cron passes timeZone Asia/Karachi and the jobs are exactly the documented ones', () => {
    const uses = cronUses();
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) {
      expect({ file: use.file, timeZone: /timeZone:\s*'Asia\/Karachi'/.test(use.options) }).toEqual({
        file: use.file,
        timeZone: true,
      });
      expect({ file: use.file, named: use.name !== null }).toEqual({ file: use.file, named: true });
    }
    const names = uses.map((use) => use.name as string).sort();
    // Inc 1 runs the wallet check and housekeeping; Inc 2 adds the van check and the confirmation expiry.
    const expected = ['housekeeping-nightly', 'wallet-nightly-check'];
    const inc2 = ['confirmation-expiry', 'day-cutoff-van-check'].filter((name) => names.includes(name));
    expect(names).toEqual([...expected, ...inc2].sort());
    for (const use of uses) expect({ name: use.name, schedule: DOCUMENTED[use.name as string]?.test(use.expression) }).toEqual({ name: use.name, schedule: true });
  });

  it('FND-033 reads every @Cron in the API source (scanner check)', () => {
    const uses = cronUses();
    expect(uses.some((use) => use.name === 'housekeeping-nightly')).toBe(true);
    for (const use of uses) expect(use.expression.length).toBeGreaterThan(0);
  });
});

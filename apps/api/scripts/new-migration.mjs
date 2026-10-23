#!/usr/bin/env node
// Creates a Prisma migration without a database (docs/pilot/DATA_MODEL.md §2.4):
//
//   npm run db:new-migration -- <name> [--base <git ref>] [--allow-empty]
//
// 1. Writes `git show <base>:apps/api/prisma/schema.prisma` to .tmp/prev.prisma (base: HEAD).
// 2. Creates prisma/migrations/<UTC yyyymmddHHMMSS>_<name>/.
// 3. Runs `prisma migrate diff --from-schema-datamodel .tmp/prev.prisma
//    --to-schema-datamodel prisma/schema.prisma --script`.
// 4. Writes the output as migration.sql: UTF-8 without BOM, LF line endings. Prisma checksums the
//    file, and PowerShell `>` would write a BOM and CRLF.
//
// Then hand-edit the file in this order, with a `--` comment on every hand edit:
//   (1) pre-checks, (2) the generated DDL unchanged, (3) re-runnable backfills, (4) CHECK constraints.
// Never edit a migration once it has been applied anywhere; fix forward with a new one.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = join(apiDir, 'prisma', 'schema.prisma');
const migrationsDir = join(apiDir, 'prisma', 'migrations');
const tmpDir = join(apiDir, '.tmp');
const prevPath = join(tmpDir, 'prev.prisma');
const NAME_RE = /^[a-z0-9]+(_[a-z0-9]+)*$/;
const STAMPED_RE = /^\d{14}_/;

function fail(message) {
  console.error(`new-migration: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { name: undefined, base: 'HEAD', allowEmpty: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: npm run db:new-migration -- <name> [--base <git ref>] [--allow-empty]');
      process.exit(0);
    } else if (arg === '--allow-empty') {
      opts.allowEmpty = true;
    } else if (arg === '--base') {
      opts.base = argv[++i];
      if (!opts.base) fail('--base needs a git ref');
    } else if (arg.startsWith('--base=')) {
      opts.base = arg.slice('--base='.length);
    } else if (arg.startsWith('-')) {
      fail(`unknown option ${arg}`);
    } else if (opts.name === undefined) {
      opts.name = arg;
    } else {
      fail(`unexpected argument ${arg}`);
    }
  }
  if (!opts.name) fail('give a name, e.g. npm run db:new-migration -- inc1a_foundations');
  if (!NAME_RE.test(opts.name)) fail(`name "${opts.name}" must be lower-case letters, digits and single underscores`);
  return opts;
}

function utcStamp(d = new Date()) {
  return d.toISOString().replace(/[-:T]/g, '').slice(0, 14); // yyyymmddHHMMSS
}

/** Hand-edit reminders for the review checklist (DATA_MODEL §2.4). */
function reviewNotes(sql) {
  const notes = [];
  const addedValues = [...sql.matchAll(/ALTER TYPE "(\w+)" ADD VALUE '([^']+)'/g)].map((m) => `${m[1]}.${m[2]}`);
  if (addedValues.length) {
    notes.push(
      `New values of existing enums can't be used as literals in this file (55P04): ${addedValues.join(', ')}. ` +
        'Compare as ::text, or use them in the next migration.',
    );
  }
  const notNull = sql
    .split('\n')
    .filter((line) => /ADD COLUMN\s+"\w+"/.test(line) && /NOT NULL/.test(line) && !/DEFAULT/.test(line))
    .map((line) => line.trim());
  if (notNull.length) {
    notes.push(
      'NOT NULL columns without a default: split each into a nullable column plus a backfill here, ' +
        `and SET NOT NULL in the next release:\n      ${notNull.join('\n      ')}`,
    );
  }
  if (/\bDROP (COLUMN|TABLE|TYPE|INDEX)\b|\bRENAME\b/.test(sql)) {
    notes.push('Drops and renames are contract steps: ship them one release after the code stops using the old shape.');
  }
  return notes;
}

const opts = parseArgs(process.argv.slice(2));

if (!existsSync(migrationsDir)) fail(`${relative(apiDir, migrationsDir)} not found (the baseline release adds it)`);
const existing = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
const clash = existing.find((n) => n === opts.name || n.endsWith(`_${opts.name}`));
if (clash) fail(`a migration named ${opts.name} already exists: ${clash}`);

const folder = `${utcStamp()}_${opts.name}`;
const newest = existing.filter((n) => STAMPED_RE.test(n)).sort().pop();
if (newest && newest >= folder) {
  fail(`${folder} would sort before or equal to ${newest}; Prisma applies migrations in name order. Check the clock.`);
}

let prev;
try {
  // `./` makes the path relative to apps/api, wherever the repository is checked out.
  prev = execFileSync('git', ['show', `${opts.base}:./prisma/schema.prisma`], {
    cwd: apiDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (e) {
  fail(`could not read prisma/schema.prisma at ${opts.base}: ${String(e.stderr || e.message).trim()}`);
}

let sql;
try {
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(prevPath, prev, 'utf8');
  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  sql = execFileSync(
    process.execPath,
    [prismaCli, 'migrate', 'diff', '--from-schema-datamodel', prevPath, '--to-schema-datamodel', schemaPath, '--script'],
    { cwd: apiDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
  );
} catch (e) {
  fail(`prisma migrate diff failed${e.status != null ? ` (exit ${e.status})` : ''}: ${e.message}`);
} finally {
  rmSync(prevPath, { force: true });
  try {
    if (existsSync(tmpDir) && readdirSync(tmpDir).length === 0) rmdirSync(tmpDir);
  } catch {
    // leave a non-empty .tmp alone
  }
}

let text = sql.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
if (!text.endsWith('\n')) text += '\n';
if (/^-- This is an empty migration\.\s*$/.test(text.trim()) && !opts.allowEmpty) {
  fail(`schema.prisma has no change against ${opts.base}; nothing written (use --allow-empty for a data-only migration)`);
}

const dir = join(migrationsDir, folder);
mkdirSync(dir);
const file = join(dir, 'migration.sql');
writeFileSync(file, text, 'utf8');

console.log(`Created ${relative(apiDir, file).split('\\').join('/')} (diff against ${opts.base}).`);
console.log('Hand-edit it in this order, with a -- comment on every edit (DATA_MODEL §2.4):');
console.log('  (1) pre-checks that RAISE EXCEPTION \'MIGRATION_BLOCKED ...\' with the fix;');
console.log('  (2) the generated DDL, unchanged;');
console.log('  (3) backfills that are safe to re-run and safe on an empty database;');
console.log('  (4) CHECK constraints (NOT VALID on old tables whose rows might break them).');
for (const note of reviewNotes(text)) console.log(`  ! ${note}`);

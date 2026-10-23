/**
 * MIG-010: deploys and CI change the schema only through `migrate deploy`, never `db push`
 * (ADR-19, DATA_MODEL §2.1-§2.5). A static scan of the pipeline files and the migrations.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const API = path.join(REPO, 'apps', 'api');
const MIGRATIONS = path.join(API, 'prisma', 'migrations');

function read(...parts: string[]): string {
  return fs.readFileSync(path.join(REPO, ...parts), 'utf8');
}

function migrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(MIGRATIONS, entry.name, 'migration.sql'));
}

describe('MIG-010 Deploys and CI change the schema only through migrate deploy, never db push', () => {
  it('MIG-010 no db push outside the baseline branch of prisma/scripts/migrate.sh', () => {
    const pipeline = [
      ['infrastructure', 'aws', 'deploy.sh'],
      ['railway.toml'],
      ['apps', 'api', 'package.json'],
      ['apps', 'api', 'Dockerfile'],
      ...fs.readdirSync(path.join(REPO, '.github', 'workflows')).map((file) => ['.github', 'workflows', file]),
    ];
    for (const parts of pipeline) {
      expect({ file: parts.join('/'), dbPush: /db\s+push/.test(read(...parts)) }).toEqual({ file: parts.join('/'), dbPush: false });
    }
    // In migrate.sh, db push appears once: in the branch that takes over a never-baselined database.
    const migrateSh = read('apps', 'api', 'prisma', 'scripts', 'migrate.sh');
    const pushes = [...migrateSh.matchAll(/npx prisma db push/g)];
    expect(pushes).toHaveLength(1);
    const branch = migrateSh.slice(migrateSh.indexOf('DB_NOT_BASELINED*'), migrateSh.indexOf('\nfi\n'));
    expect(branch).toContain('npx prisma db push');
  });

  it('MIG-010 deploy.sh runs migrate.sh, CI runs migrate deploy and the drift check, railway.toml runs migrate.sh', () => {
    expect(read('infrastructure', 'aws', 'deploy.sh')).toMatch(/sh prisma\/scripts\/migrate\.sh/);
    const ci = fs
      .readdirSync(path.join(REPO, '.github', 'workflows'))
      .map((file) => read('.github', 'workflows', file))
      .join('\n');
    expect(ci).toMatch(/npx prisma migrate deploy/);
    expect(ci).toMatch(/npx prisma migrate diff [^\n]*--to-migrations prisma\/migrations[\s\S]*?--exit-code/);
    // The boot guards first (when the build has them), so an env the new API refuses stops the deploy
    // before the migration.
    expect(read('railway.toml')).toMatch(
      /startCommand = "if \[ -f dist\/common\/bootstrap\/boot-preflight\.js \]; then node dist\/common\/bootstrap\/boot-preflight\.js; fi && sh prisma\/scripts\/migrate\.sh && node dist\/main\.js"/,
    );
  });

  it('MIG-010 package.json has db:new-migration, db:status and db:drift, no migrate dev, and pins prisma exactly', () => {
    const pkg = JSON.parse(read('apps', 'api', 'package.json')) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(Object.values(pkg.scripts).some((script) => /migrate dev/.test(script))).toBe(false);
    expect(pkg.scripts['db:new-migration']).toBe('node scripts/new-migration.mjs');
    expect(pkg.scripts['db:status']).toBe('prisma migrate status');
    expect(pkg.scripts['db:drift']).toMatch(/prisma migrate diff .*--to-schema-datamodel prisma\/schema\.prisma --exit-code/);
    expect(pkg.scripts['prisma:deploy']).toBe('prisma migrate deploy');
    expect(pkg.dependencies['@prisma/client']).toBe('5.22.0');
    expect(pkg.devDependencies.prisma).toBe('5.22.0');
  });

  it('MIG-010 every migration.sql is UTF-8 without a BOM, with LF line endings, and .gitattributes keeps them so', () => {
    const files = migrationFiles();
    expect(files.map((file) => path.basename(path.dirname(file))).sort()).toEqual(
      expect.arrayContaining(['0_baseline', '20261021195005_inc1a_foundations']),
    );
    for (const file of files) {
      const bytes = fs.readFileSync(file);
      const name = path.relative(API, file).split(path.sep).join('/');
      expect({ name, bom: bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) }).toEqual({ name, bom: false });
      expect({ name, crlf: bytes.includes(Buffer.from('\r\n')) }).toEqual({ name, crlf: false });
      expect({ name, utf8: Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes) }).toEqual({ name, utf8: true });
    }
    expect(read('.gitattributes')).toMatch(/^apps\/api\/prisma\/migrations\/\*\*\/\*\.sql text eol=lf$/m);
    expect(read('apps', 'api', 'prisma', 'migrations', 'migration_lock.toml')).toMatch(/provider = "postgresql"/);
  });
});

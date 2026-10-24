/**
 * Regression tests for the review's deploy findings (static: the scripts can't run here).
 * - robustness-ops-01: prod deploys snapshot the database (and wait for it) before migrating; Railway
 *   runs the boot preflight before migrating.
 * - robustness-ops-02: the container is recreated from the image this deploy built (no registry
 *   default, no shared mutable tag), the commit is baked in, and the deploy waits for /health to
 *   report it.
 * - robustness-ops-03: the env file is checked against the new API's boot guards before migrating.
 * - robustness-ops-04: the templates leave CORS_ORIGINS to fill in, the guards refuse it unfilled,
 *   and the Caddyfile serves the hosts the apps call.
 * - robustness-ops-09: deploy.sh takes a branch, a tag or a SHA.
 * - robustness-ops-10: the deploy workflows gate on CI of the exact commit they deploy.
 */
import * as fs from 'fs';
import * as path from 'path';
import { runBootPreflight } from '../../src/common/bootstrap/boot-preflight';
import { checkBootEnvironment } from '../../src/common/bootstrap/boot-guards';

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
// The repository stores these files with LF; a Windows checkout with core.autocrlf=true has CRLF, which
// the multi-line patterns below would not match. Read them as git stores them.
const read = (...parts: string[]) => fs.readFileSync(path.join(REPO, ...parts), 'utf8').replace(/\r\n/g, '\n');

/** The KEY=value lines of an env template. */
function envOf(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2];
  }
  return env;
}

/** A template with every placeholder replaced by a value of the right shape (the operator's job). */
function filled(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    let next = value;
    if (/^(ENCRYPTION_KEY|BLIND_INDEX_KEY)$/.test(key)) next = '0123456789abcdef'.repeat(4);
    else if (key === 'JWT_ACCESS_SECRET') next = 'a'.repeat(64);
    else if (key === 'JWT_REFRESH_SECRET') next = 'b'.repeat(64);
    else if (key === 'CONFIRM_LINK_SECRET') next = 'c'.repeat(64);
    else if (key === 'CORS_ORIGINS') next = 'https://admin.smartfleetpk.com';
    else next = value.replace(/REPLACE_[A-Z0-9_]*/g, 'filled-in');
    out[key] = next;
  }
  return out;
}

describe('REV deploy pipeline', () => {
  const deploy = read('infrastructure', 'aws', 'deploy.sh');
  const at = (pattern: RegExp) => {
    const match = pattern.exec(deploy);
    return match ? match.index : -1;
  };

  it('REV robustness-ops-09 deploy.sh deploys a branch, a tag or a full SHA (no origin/<ref> reset)', () => {
    expect(deploy).toMatch(/git fetch --quiet origin "\$REF"\ngit checkout --quiet --force --detach FETCH_HEAD/);
    expect(deploy).not.toMatch(/origin\/\$REF/);
    expect(deploy).toMatch(/FULL_SHA=\$\(git rev-parse HEAD\)/);
  });

  it('REV robustness-ops-02 the service runs the image this deploy built, and the deploy waits for its commit', () => {
    expect(deploy).toMatch(/docker build -f apps\/api\/Dockerfile --build-arg GIT_COMMIT_SHA="\$FULL_SHA" -t "\$IMAGE" \./);
    expect(deploy).not.toMatch(/smartfleet-api:local/);
    expect(deploy).toMatch(/docker compose --env-file "\$IMAGES_FILE" -f "\$COMPOSE_FILE" up -d --no-deps --force-recreate "\$SERVICE"/);
    expect(deploy).toMatch(/docker inspect --format '\{\{\.Config\.Image\}\}' "\$CONTAINER"/);
    expect(deploy).toMatch(/\/api\/v1\/health"/);
    expect(deploy).toMatch(/"\\"version\\":\\"\$FULL_SHA\\""/);
    const runtime = read('apps', 'api', 'Dockerfile').split('AS runtime')[1];
    expect(runtime).toMatch(/ARG GIT_COMMIT_SHA/);
    expect(runtime).toMatch(/ENV GIT_COMMIT_SHA=\$GIT_COMMIT_SHA/);
    const compose = read('infrastructure', 'aws', 'docker-compose.aws.yml');
    expect(compose).not.toMatch(/public\.ecr\.aws|:latest/);
    expect(compose).toMatch(/image: \$\{IMAGE_PROD:-smartfleet-api:not-deployed\}\n\s+pull_policy: never/);
    expect(compose).toMatch(/image: \$\{IMAGE_STAGING:-smartfleet-api:not-deployed\}\n\s+pull_policy: never/);
  });

  it('REV robustness-ops-03 and -01 the boot preflight, then the prod snapshot, run before the migration', () => {
    const preflight = at(/node dist\/common\/bootstrap\/boot-preflight\.js/);
    const snapshot = at(/aws rds create-db-snapshot/);
    const waited = at(/aws rds wait db-snapshot-available/);
    const migrate = at(/sh prisma\/scripts\/migrate\.sh/);
    const restart = at(/up -d --no-deps --force-recreate/);
    expect([preflight, snapshot, waited, migrate, restart].every((index) => index > 0)).toBe(true);
    expect(preflight < snapshot && snapshot < waited && waited < migrate && migrate < restart).toBe(true);
    // The preflight runs with the NODE_ENV compose gives the container.
    expect(deploy).toMatch(/-e NODE_ENV="\$RUN_AS" "\$IMAGE" node dist\/common\/bootstrap\/boot-preflight\.js/);
    expect(deploy).toMatch(/prod\)\s+SERVICE=api-prod;.*RUN_AS=production;/);
    expect(deploy).toMatch(/staging\)\s+SERVICE=api-staging;.*RUN_AS=staging;/);
    // No snapshot configured, no prod deploy.
    expect(deploy).toMatch(/if \[ -z "\$\{RDS_INSTANCE_ID:-\}" \]; then[\s\S]*?exit 1/);
    expect(read('railway.toml')).toMatch(
      /startCommand = "if \[ -f dist\/common\/bootstrap\/boot-preflight\.js \]; then node dist\/common\/bootstrap\/boot-preflight\.js; fi && sh prisma\/scripts\/migrate\.sh && node dist\/main\.js"/,
    );
  });

  it('REV robustness-ops-03 a build from before Inc 1 (the baseline release, a rollback to it) skips the preflight it doesn\'t have', () => {
    // The probe guards the preflight; without the script there is nothing to check, so the deploy goes on.
    expect(deploy).toMatch(
      /if docker run --rm --entrypoint test "\$IMAGE" -f dist\/common\/bootstrap\/boot-preflight\.js; then\n.*\n\s+docker run --rm --env-file "\$ENV_FILE" -e NODE_ENV="\$RUN_AS" "\$IMAGE" node dist\/common\/bootstrap\/boot-preflight\.js\nelse\n/,
    );
  });

  it('REV robustness-ops-02 a host compose file that gives the service another image stops the deploy before the migration', () => {
    const check = at(/COMPOSE_IMAGE=\$\(env "\$IMAGE_VAR=\$IMAGE" docker compose -f "\$COMPOSE_FILE" config --images "\$SERVICE" \|\| true\)/);
    const refused = at(/if \[ "\$COMPOSE_IMAGE" != "\$IMAGE" \]; then\n.*REFUSED.*\n\s+exit 1/);
    const migrate = at(/sh prisma\/scripts\/migrate\.sh/);
    expect([check, refused, migrate].every((index) => index > 0)).toBe(true);
    expect(check < refused && refused < migrate).toBe(true);
  });

  it('REV robustness-ops-03 the preflight answers like the API would at boot', () => {
    const lines: string[] = [];
    const bad = runBootPreflight({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://x' }, (l) => lines.push(`out ${l}`), (l) => lines.push(`err ${l}`));
    expect(bad).toBe(1);
    expect(lines[0]).toMatch(/^err BOOT_REFUSED: .*BULLMQ_PREFIX is not set.*CORS_ORIGINS is not set/);
    const env = filled(envOf(read('infrastructure', 'aws', '.env.prod.example')));
    lines.length = 0;
    expect(runBootPreflight(env, (l) => lines.push(l), (l) => lines.push(l))).toBe(0);
    expect(lines).toEqual(['BOOT_PREFLIGHT_OK']);
  });

  it('REV robustness-ops-04 the templates leave the website origin to fill in, and an unfilled one is refused', () => {
    for (const [file, nodeEnv] of [
      ['.env.prod.example', 'production'],
      ['.env.staging.example', 'staging'],
    ] as const) {
      const template = envOf(read('infrastructure', 'aws', file));
      expect({ file, cors: template.CORS_ORIGINS }).toEqual({ file, cors: 'REPLACE_WEBSITE_ORIGIN' });
      const asIs = checkBootEnvironment({ ...filled(template), CORS_ORIGINS: template.CORS_ORIGINS, NODE_ENV: nodeEnv });
      expect(asIs).toEqual([
        'CORS_ORIGINS must list website origins like https://admin.example.com (scheme and host only)',
        'template placeholders are still in CORS_ORIGINS',
      ]);
      expect(checkBootEnvironment({ ...filled(template), NODE_ENV: nodeEnv })).toEqual([]);
    }
    // A path or a wrong scheme is not an origin either; a trailing slash is forgiven.
    const good = filled(envOf(read('infrastructure', 'aws', '.env.prod.example')));
    expect(checkBootEnvironment({ ...good, CORS_ORIGINS: 'https://admin.smartfleetpk.com/login' })).toHaveLength(1);
    expect(checkBootEnvironment({ ...good, CORS_ORIGINS: 'admin.smartfleetpk.com' })).toHaveLength(1);
    expect(checkBootEnvironment({ ...good, CORS_ORIGINS: 'https://admin.smartfleetpk.com/, https://staging-admin.smartfleetpk.com' })).toEqual([]);
    const caddy = read('infrastructure', 'aws', 'Caddyfile');
    expect(caddy).toMatch(/^api\.smartfleetpk\.com \{/m);
    expect(caddy).toMatch(/^staging\.smartfleetpk\.com \{/m);
    expect(caddy).not.toMatch(/^[a-z.-]*smart-fleet\.com \{/m);
  });

  it('REV robustness-ops-10 the deploy workflows gate on CI of the exact commit they deploy', () => {
    const staging = read('.github', 'workflows', 'deploy-staging.yml');
    expect(staging).toMatch(/ref: \$\{\{ needs\.resolve\.outputs\.sha \}\}\n\s+check-name: 'API — typecheck, lint, test'/);
    expect(staging).toMatch(/needs: \[resolve, wait-for-ci\]/);
    expect(staging).toMatch(/deploy\.sh staging '\$SHA'/);
    expect(staging).toMatch(/-f context=deploy\/staging/);
    const prod = read('.github', 'workflows', 'promote-prod.yml');
    expect(prod).toMatch(/grep -Eq '\^\[0-9a-f\]\{40\}\$'/);
    expect(prod).toMatch(/ref: \$\{\{ inputs\.sha \}\}\n\s+check-name: 'API — typecheck, lint, test'/);
    expect(prod).toMatch(/select\(\.context == "deploy\/staging"\)/);
    expect(prod).toMatch(/deploy\.sh prod '\$SHA'/);
    // Inputs reach the shell as environment variables only (and the check action's `ref`), never pasted into a script.
    const inputLines = prod.split('\n').filter((line) => line.includes('${{ inputs.'));
    expect(inputLines.length).toBeGreaterThan(0);
    for (const line of inputLines) expect(line).toMatch(/^\s+(CONFIRM|SHA|ref): \$\{\{ inputs\.(confirm|sha) \}\}$/);
    expect(read('.github', 'workflows', 'ci.yml')).toMatch(/push:\n\s+branches: \['\*\*'\]/);
  });
});

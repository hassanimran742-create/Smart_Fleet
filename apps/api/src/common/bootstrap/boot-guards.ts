import { APP_ENVIRONMENTS } from '@smartfleet/shared-types';

type Env = Record<string, string | undefined>;

const JWT_MIN_LENGTH = 32;
const LINK_SECRET_MIN_LENGTH = 32;
/** CNIC encryption and its blind index each need a 256-bit key written as 64 hex characters. */
const HEX_KEY_256 = /^[0-9a-f]{64}$/i;
const CNIC_KEYS = ['ENCRYPTION_KEY', 'BLIND_INDEX_KEY'] as const;

/** Short names that may stand in for an environment's name in BULLMQ_PREFIX ("sf-prod"). */
const ENV_ALIASES: Readonly<Record<string, readonly string[]>> = {
  production: ['production', 'prod'],
  staging: ['staging', 'stage', 'stg'],
  training: ['training', 'train'],
  development: ['development', 'dev'],
  test: ['test'],
};

/** A placeholder of the env templates (infrastructure/aws/.env.*.example) that was never filled in. */
const PLACEHOLDER = /REPLACE_[A-Z0-9_]*/;
/** A browser origin as CORS compares it: scheme, host and an optional port; no path, no wildcard. */
const BROWSER_ORIGIN = /^https?:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;

/** Refused when the environment is production (API_CONTRACT §3.7). A flag set to false or 0 is harmless. */
const REFUSED_FLAGS_IN_PRODUCTION = ['AUTH_EXPOSE_OTP', 'ALLOW_DEMO_SEED'];
const REFUSED_LISTS_IN_PRODUCTION = ['TEST_PHONES'];

function isSet(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

/**
 * The deployment's name: `APP_ENV` when set, else derived from `NODE_ENV`. Staging and training
 * servers usually run with NODE_ENV=production, so APP_ENV is what tells them apart.
 */
export function deploymentName(env: Env): string {
  if (isSet(env.APP_ENV)) return env.APP_ENV.trim().toLowerCase();
  const node = (env.NODE_ENV ?? '').trim().toLowerCase();
  if (node === 'production' || node === 'staging' || node === 'test') return node;
  return 'development';
}

/** The boot guards apply when NODE_ENV is production or staging. */
export function bootGuardsApply(env: Env): boolean {
  const node = (env.NODE_ENV ?? '').trim().toLowerCase();
  return node === 'production' || node === 'staging';
}

function checkJwtSecrets(env: Env, problems: string[]): void {
  const access = env.JWT_ACCESS_SECRET ?? '';
  const refresh = env.JWT_REFRESH_SECRET ?? '';
  for (const [name, value] of [
    ['JWT_ACCESS_SECRET', access],
    ['JWT_REFRESH_SECRET', refresh],
  ] as const) {
    if (!isSet(value)) problems.push(`${name} is not set`);
    else if (value.startsWith('change_me')) problems.push(`${name} is a default value`);
    else if (value.length < JWT_MIN_LENGTH) problems.push(`${name} must be at least ${JWT_MIN_LENGTH} characters`);
  }
  if (isSet(access) && access === refresh) problems.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ');
}

function checkRequired(env: Env, name: string, problems: string[]): void {
  if (!isSet(env.BULLMQ_PREFIX)) {
    problems.push('BULLMQ_PREFIX is not set');
  } else {
    const prefix = env.BULLMQ_PREFIX.toLowerCase();
    const aliases = ENV_ALIASES[name] ?? [name];
    if (!aliases.some((alias) => prefix.includes(alias))) {
      problems.push(`BULLMQ_PREFIX must contain the environment name (${aliases.join(' or ')})`);
    }
  }
  if (!isSet(env.DATABASE_URL)) problems.push('DATABASE_URL is not set');
  if (!isSet(env.REDIS_URL) && !isSet(env.REDIS_HOST)) problems.push('REDIS_URL or REDIS_HOST must be set');
  if (!isSet(env.S3_BUCKET)) problems.push('S3_BUCKET is not set');
  if (!isSet(env.S3_ACCESS_KEY) || env.S3_ACCESS_KEY === 'minio') problems.push('S3_ACCESS_KEY is not set or is the MinIO default');
  if (!isSet(env.S3_SECRET_KEY) || env.S3_SECRET_KEY === 'minio123') problems.push('S3_SECRET_KEY is not set or is the MinIO default');

  const origins = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (origins.length === 0) problems.push('CORS_ORIGINS is not set');
  else if (origins.includes('*')) problems.push("CORS_ORIGINS must list the allowed origins, not '*'");
  // A wrong entry passes everything else and then the browser blocks the website without a word.
  else if (!origins.every((origin) => BROWSER_ORIGIN.test(origin))) {
    problems.push('CORS_ORIGINS must list website origins like https://admin.example.com (scheme and host only)');
  }

  // CNICs are stored encrypted with a blind index (API_CONTRACT §3.7, §7.3 rule 4).
  for (const key of CNIC_KEYS) {
    const value = env[key];
    if (!isSet(value)) problems.push(`${key} is not set`);
    else if (!HEX_KEY_256.test(value.trim())) problems.push(`${key} must be 64 hex characters`);
  }
}

/** The confirmation-link settings arrive with Inc 2: checked when present, required from then. */
function checkLinkSettings(env: Env, problems: string[]): void {
  if (isSet(env.PUBLIC_LINK_BASE_URL) && !/^https:\/\/[^\s/]+/i.test(env.PUBLIC_LINK_BASE_URL)) {
    problems.push('PUBLIC_LINK_BASE_URL must be an https URL');
  }
  if (isSet(env.CONFIRM_LINK_SECRET) && env.CONFIRM_LINK_SECRET.length < LINK_SECRET_MIN_LENGTH) {
    problems.push(`CONFIRM_LINK_SECRET must be at least ${LINK_SECRET_MIN_LENGTH} characters`);
  }
}

function isOn(value: string | undefined): boolean {
  return isSet(value) && !['false', '0', 'no', 'off'].includes(value.trim().toLowerCase());
}

function checkProductionOnly(env: Env, problems: string[]): void {
  for (const name of REFUSED_FLAGS_IN_PRODUCTION) {
    if (isOn(env[name])) problems.push(`${name} is not allowed in production`);
  }
  for (const name of REFUSED_LISTS_IN_PRODUCTION) {
    if (isSet(env[name])) problems.push(`${name} is not allowed in production`);
  }
  const seeds = Object.keys(env).filter((key) => key.startsWith('SEED_') && isSet(env[key]));
  if (seeds.length > 0) problems.push(`SEED_* variables are not allowed in production (${seeds.sort().join(', ')})`);
  if ((env.PAYMENTS_WEBHOOK_ENABLED ?? '').trim().toLowerCase() === 'true') {
    problems.push('PAYMENTS_WEBHOOK_ENABLED=true is not allowed in production');
  }
}

/**
 * The boot guards of API_CONTRACT §3.7. main.ts runs them before NestFactory.create and refuses to
 * start, with one line, when any problem is returned. They apply when NODE_ENV is production or
 * staging; the "refused" variables are checked when the deployment is production.
 */
export function checkBootEnvironment(env: Env = process.env): string[] {
  const problems: string[] = [];
  if (isSet(env.APP_ENV) && !(APP_ENVIRONMENTS as readonly string[]).includes(env.APP_ENV.trim().toLowerCase())) {
    problems.push(`APP_ENV must be one of ${APP_ENVIRONMENTS.join(', ')}`);
  }
  if (!bootGuardsApply(env)) return problems;

  const name = deploymentName(env);
  checkJwtSecrets(env, problems);
  checkRequired(env, name, problems);
  checkLinkSettings(env, problems);
  if (name === 'production') checkProductionOnly(env, problems);
  checkPlaceholders(env, problems);
  return problems;
}

/** Template placeholders left in the env file (`REPLACE_…`): the variable names only, never the values. */
function checkPlaceholders(env: Env, problems: string[]): void {
  const left = Object.keys(env)
    .filter((key) => isSet(env[key]) && PLACEHOLDER.test(env[key] as string))
    .sort();
  if (left.length > 0) problems.push(`template placeholders are still in ${left.join(', ')}`);
}

/** The single line printed when the API refuses to boot. */
export function bootRefusalLine(problems: readonly string[]): string {
  return `BOOT_REFUSED: ${problems.join('; ')}`;
}

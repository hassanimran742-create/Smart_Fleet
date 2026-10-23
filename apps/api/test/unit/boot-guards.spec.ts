import { bootRefusalLine, checkBootEnvironment, deploymentName } from '../../src/common/bootstrap/boot-guards';

/** A production environment that passes every guard. */
const GOOD_PRODUCTION = {
  NODE_ENV: 'production',
  APP_ENV: 'production',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
  DATABASE_URL: 'postgresql://app:secret@db.internal:5432/smartfleet',
  REDIS_URL: 'rediss://default:secret@redis.internal:6379',
  BULLMQ_PREFIX: 'sf-production',
  S3_BUCKET: 'smart-fleet-prod',
  S3_ACCESS_KEY: 'AKIAEXAMPLE',
  S3_SECRET_KEY: 'example-secret',
  CORS_ORIGINS: 'https://office.smartfleet.pk',
  ENCRYPTION_KEY: '0123456789abcdef'.repeat(4),
  BLIND_INDEX_KEY: 'FEDCBA9876543210'.repeat(4),
};

describe('boot guards (API_CONTRACT §3.7)', () => {
  it('pass a well-configured production environment', () => {
    expect(checkBootEnvironment(GOOD_PRODUCTION)).toEqual([]);
  });

  it('SEC-019 refuses production or staging with default secrets or test switches, one problem per bad value', () => {
    const one = (overrides: Record<string, string | undefined>, env: Record<string, string | undefined> = GOOD_PRODUCTION) =>
      checkBootEnvironment({ ...env, ...overrides });
    // Step 1: one bad value at a time, each refused with a reason naming the variable.
    expect(one({ JWT_ACCESS_SECRET: 'change_me_access_secret_but_long_enough' })).toEqual([
      'JWT_ACCESS_SECRET is a default value',
    ]);
    expect(one({ JWT_ACCESS_SECRET: 'x'.repeat(31) })).toEqual(['JWT_ACCESS_SECRET must be at least 32 characters']);
    expect(one({ JWT_REFRESH_SECRET: GOOD_PRODUCTION.JWT_ACCESS_SECRET })).toEqual([
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ',
    ]);
    expect(one({ DATABASE_URL: undefined })).toEqual(['DATABASE_URL is not set']);
    expect(one({ REDIS_URL: undefined, REDIS_HOST: undefined })).toEqual(['REDIS_URL or REDIS_HOST must be set']);
    expect(one({ BULLMQ_PREFIX: 'smartfleet' })).toEqual([
      'BULLMQ_PREFIX must contain the environment name (production or prod)',
    ]);
    expect(one({ S3_ACCESS_KEY: 'minio', S3_SECRET_KEY: 'minio123' })).toEqual([
      'S3_ACCESS_KEY is not set or is the MinIO default',
      'S3_SECRET_KEY is not set or is the MinIO default',
    ]);
    expect(one({ CORS_ORIGINS: '*' })).toEqual(["CORS_ORIGINS must list the allowed origins, not '*'"]);
    expect(one({ ENCRYPTION_KEY: undefined })).toEqual(['ENCRYPTION_KEY is not set']);
    expect(one({ ENCRYPTION_KEY: 'a'.repeat(63) })).toEqual(['ENCRYPTION_KEY must be 64 hex characters']);
    expect(one({ ENCRYPTION_KEY: 'g'.repeat(64) })).toEqual(['ENCRYPTION_KEY must be 64 hex characters']);
    expect(one({ BLIND_INDEX_KEY: undefined })).toEqual(['BLIND_INDEX_KEY is not set']);
    // Step 2: test switches are refused in production.
    expect(one({ AUTH_EXPOSE_OTP: 'true' })).toEqual(['AUTH_EXPOSE_OTP is not allowed in production']);
    expect(one({ TEST_PHONES: '+923001234567' })).toEqual(['TEST_PHONES is not allowed in production']);
    expect(one({ ALLOW_DEMO_SEED: 'true' })).toEqual(['ALLOW_DEMO_SEED is not allowed in production']);
    expect(one({ SEED_ADMIN_PASSWORD: 'x' })).toEqual(['SEED_* variables are not allowed in production (SEED_ADMIN_PASSWORD)']);
    expect(one({ PAYMENTS_WEBHOOK_ENABLED: 'true' })).toEqual(['PAYMENTS_WEBHOOK_ENABLED=true is not allowed in production']);
    // Step 3: staging is guarded too.
    const staging = { ...GOOD_PRODUCTION, NODE_ENV: 'staging', APP_ENV: 'staging', BULLMQ_PREFIX: 'sf-staging' };
    expect(checkBootEnvironment(staging)).toEqual([]);
    expect(one({ JWT_ACCESS_SECRET: 'change_me_access_secret_but_long_enough' }, staging)).toEqual([
      'JWT_ACCESS_SECRET is a default value',
    ]);
    expect(one({ BLIND_INDEX_KEY: 'abc' }, staging)).toEqual(['BLIND_INDEX_KEY must be 64 hex characters']);
    // Step 4: development starts with the defaults; the valid production env starts.
    expect(checkBootEnvironment({ NODE_ENV: 'development' })).toEqual([]);
    expect(checkBootEnvironment(GOOD_PRODUCTION)).toEqual([]);
    // Step 5: aliases. Staging with 'sf-stg' starts; production with APP_ENV=training needs its own name.
    expect(checkBootEnvironment({ ...staging, BULLMQ_PREFIX: 'sf-stg' })).toEqual([]);
    expect(one({ APP_ENV: 'training', BULLMQ_PREFIX: 'sf-prod' })).toEqual([
      'BULLMQ_PREFIX must contain the environment name (training or train)',
    ]);
    expect(one({ APP_ENV: 'training', BULLMQ_PREFIX: 'sf-train' })).toEqual([]);
    // Every refusal prints as one line.
    expect(bootRefusalLine(one({ ENCRYPTION_KEY: undefined }))).toBe('BOOT_REFUSED: ENCRYPTION_KEY is not set');
  });

  it('do not apply in development or test', () => {
    expect(checkBootEnvironment({ NODE_ENV: 'development' })).toEqual([]);
    expect(checkBootEnvironment({ NODE_ENV: 'test', JWT_ACCESS_SECRET: 'change_me_access' })).toEqual([]);
    expect(checkBootEnvironment({})).toEqual([]);
  });

  it('refuse default, short or equal JWT secrets', () => {
    expect(
      checkBootEnvironment({ ...GOOD_PRODUCTION, JWT_ACCESS_SECRET: 'change_me_access', JWT_REFRESH_SECRET: 'change_me_refresh' }),
    ).toEqual(['JWT_ACCESS_SECRET is a default value', 'JWT_REFRESH_SECRET is a default value']);
    expect(checkBootEnvironment({ ...GOOD_PRODUCTION, JWT_ACCESS_SECRET: 'short' })).toEqual([
      'JWT_ACCESS_SECRET must be at least 32 characters',
    ]);
    expect(checkBootEnvironment({ ...GOOD_PRODUCTION, JWT_REFRESH_SECRET: GOOD_PRODUCTION.JWT_ACCESS_SECRET })).toEqual([
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ',
    ]);
    const { JWT_ACCESS_SECRET: _a, ...noAccess } = GOOD_PRODUCTION;
    expect(checkBootEnvironment(noAccess)).toEqual(['JWT_ACCESS_SECRET is not set']);
  });

  it("refuse CORS_ORIGINS '*' or missing", () => {
    expect(checkBootEnvironment({ ...GOOD_PRODUCTION, CORS_ORIGINS: '*' })).toEqual([
      "CORS_ORIGINS must list the allowed origins, not '*'",
    ]);
    expect(checkBootEnvironment({ ...GOOD_PRODUCTION, CORS_ORIGINS: ' , ' })).toEqual(['CORS_ORIGINS is not set']);
  });

  it('need BULLMQ_PREFIX with the environment name', () => {
    const { BULLMQ_PREFIX: _p, ...noPrefix } = GOOD_PRODUCTION;
    expect(checkBootEnvironment(noPrefix)).toEqual(['BULLMQ_PREFIX is not set']);
    expect(checkBootEnvironment({ ...GOOD_PRODUCTION, BULLMQ_PREFIX: 'sf' })).toEqual([
      'BULLMQ_PREFIX must contain the environment name (production or prod)',
    ]);
    expect(checkBootEnvironment({ ...GOOD_PRODUCTION, BULLMQ_PREFIX: 'SF-PROD' })).toEqual([]);
    // Staging runs with NODE_ENV=production; APP_ENV names it.
    expect(checkBootEnvironment({ ...GOOD_PRODUCTION, APP_ENV: 'staging', BULLMQ_PREFIX: 'sf-production' })).toEqual([
      'BULLMQ_PREFIX must contain the environment name (staging or stage or stg)',
    ]);
  });

  it('need the database, Redis and non-default object storage', () => {
    const problems = checkBootEnvironment({
      ...GOOD_PRODUCTION,
      DATABASE_URL: '',
      REDIS_URL: undefined,
      S3_ACCESS_KEY: 'minio',
      S3_SECRET_KEY: 'minio123',
      S3_BUCKET: undefined,
    });
    expect(problems).toEqual([
      'DATABASE_URL is not set',
      'REDIS_URL or REDIS_HOST must be set',
      'S3_BUCKET is not set',
      'S3_ACCESS_KEY is not set or is the MinIO default',
      'S3_SECRET_KEY is not set or is the MinIO default',
    ]);
    expect(checkBootEnvironment({ ...GOOD_PRODUCTION, REDIS_URL: undefined, REDIS_HOST: 'redis' })).toEqual([]);
  });

  it('refuse test switches in production only', () => {
    const risky = {
      AUTH_EXPOSE_OTP: 'true',
      TEST_PHONES: '+923001234567',
      ALLOW_DEMO_SEED: '1',
      SEED_ADMIN_PHONE: '+923000000000',
      PAYMENTS_WEBHOOK_ENABLED: 'true',
    };
    expect(checkBootEnvironment({ ...GOOD_PRODUCTION, ...risky })).toEqual([
      'AUTH_EXPOSE_OTP is not allowed in production',
      'ALLOW_DEMO_SEED is not allowed in production',
      'TEST_PHONES is not allowed in production',
      'SEED_* variables are not allowed in production (SEED_ADMIN_PHONE)',
      'PAYMENTS_WEBHOOK_ENABLED=true is not allowed in production',
    ]);
    expect(checkBootEnvironment({ ...GOOD_PRODUCTION, AUTH_EXPOSE_OTP: 'false' })).toEqual([]);
    expect(
      checkBootEnvironment({ ...GOOD_PRODUCTION, ...risky, APP_ENV: 'staging', BULLMQ_PREFIX: 'sf-staging' }),
    ).toEqual([]);
  });

  it('check the Inc 2 link settings when they are set', () => {
    expect(
      checkBootEnvironment({ ...GOOD_PRODUCTION, PUBLIC_LINK_BASE_URL: 'http://c.smartfleet.pk', CONFIRM_LINK_SECRET: 'short' }),
    ).toEqual(['PUBLIC_LINK_BASE_URL must be an https URL', 'CONFIRM_LINK_SECRET must be at least 32 characters']);
  });

  it('refuse an unknown APP_ENV', () => {
    expect(checkBootEnvironment({ NODE_ENV: 'development', APP_ENV: 'prod' })).toEqual([
      'APP_ENV must be one of development, test, staging, training, production',
    ]);
  });

  it('print one line', () => {
    const line = bootRefusalLine(checkBootEnvironment({ NODE_ENV: 'production' }));
    expect(line.startsWith('BOOT_REFUSED: ')).toBe(true);
    expect(line).not.toContain('\n');
    expect(line).toContain('JWT_ACCESS_SECRET is not set');
    expect(line).toContain('CORS_ORIGINS is not set');
    expect(line).toContain('BULLMQ_PREFIX is not set');
    expect(line).toContain('ENCRYPTION_KEY is not set');
    expect(line).toContain('BLIND_INDEX_KEY is not set');
  });

  it('name the deployment from APP_ENV, else NODE_ENV', () => {
    expect(deploymentName({ NODE_ENV: 'production', APP_ENV: 'Training' })).toBe('training');
    expect(deploymentName({ NODE_ENV: 'production' })).toBe('production');
    expect(deploymentName({})).toBe('development');
  });
});

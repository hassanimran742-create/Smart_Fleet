import { APP_ENVIRONMENTS, type AppEnvironment } from '@smartfleet/shared-types';

/** CORS_ORIGINS: a comma-separated list of origins ("https://office.example.pk,https://..."). */
export function parseCorsOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin.length > 0);
}

/**
 * The build that runs (`GET /health` `version`, the log lines): the commit baked into the image
 * (deploy.sh `--build-arg GIT_COMMIT_SHA`), else the one Railway deployed, else the package version,
 * else "dev". deploy.sh waits until `/health` reports the commit it built.
 */
export function deployedVersion(env: Record<string, string | undefined> = process.env): string {
  return env.GIT_COMMIT_SHA || env.RAILWAY_GIT_COMMIT_SHA || env.npm_package_version || 'dev';
}

/**
 * APP_ENV (deploy-level, API_CONTRACT §6): development, test, staging, training or production. It
 * drives `GET /app/config` `environment` and the training banner. Without it, NODE_ENV decides.
 */
export function appEnvironment(env: Record<string, string | undefined> = process.env): AppEnvironment {
  const raw = (env.APP_ENV ?? '').trim().toLowerCase();
  if ((APP_ENVIRONMENTS as readonly string[]).includes(raw)) return raw as AppEnvironment;
  const node = (env.NODE_ENV ?? '').trim().toLowerCase();
  if (node === 'production' || node === 'staging' || node === 'test') return node;
  return 'development';
}

export default () => ({
  api: {
    port: Number(process.env.API_PORT ?? process.env.PORT ?? 3000),
  },
  app: {
    environment: appEnvironment(),
    /** Where an out-of-date phone gets the new app (`GET /app/config` `links.updateUrl`). */
    updateUrl: process.env.APP_UPDATE_URL || null,
  },
  cors: {
    origins: parseCorsOrigins(process.env.CORS_ORIGINS),
  },
  db: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    // Either REDIS_URL (rediss://user:pass@host:port) or REDIS_HOST/PORT.
    url: process.env.REDIS_URL,
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    /** Namespaces our own Redis keys (rate limits). Staging and production share one Redis today. */
    keyPrefix: process.env.BULLMQ_PREFIX || 'bull',
  },
  bullmq: {
    // BullMQ's own default is 'bull'; the boot guards require an environment-specific prefix in
    // production and staging (API_CONTRACT §3.7).
    prefix: process.env.BULLMQ_PREFIX || 'bull',
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'change_me_access',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'change_me_refresh',
    // Access tokens last 12 hours (a full work day) and refresh tokens 30 days (API_CONTRACT §7.1).
    // The website's 30-minute idle sign-out runs in the browser only; on the server a session ends
    // only by expiry, a token-version bump or a locked role.
    accessTtl: Number(process.env.JWT_ACCESS_TTL ?? 12 * 60 * 60),
    refreshTtl: Number(process.env.JWT_REFRESH_TTL ?? 30 * 24 * 60 * 60),
  },
  encryption: {
    key: process.env.ENCRYPTION_KEY ?? '',
    keyOld: process.env.ENCRYPTION_KEY_OLD ?? '',
    blindIndexKey: process.env.BLIND_INDEX_KEY ?? '',
  },
  sms: {
    provider: process.env.SMS_PROVIDER ?? 'mock',
    from: process.env.SMS_FROM ?? 'SmartFleet',
    apiKey: process.env.SMS_API_KEY ?? '',
    eocean: {
      username: process.env.EOCEAN_USERNAME ?? '',
      password: process.env.EOCEAN_PASSWORD ?? '',
      // `|| undefined`, not `?? ''`: an empty value must let the provider's own default URL apply.
      baseUrl: process.env.EOCEAN_BASE_URL || undefined,
    },
  },
  routing: {
    provider: process.env.ROUTING_PROVIDER ?? 'google',
    googleKey: process.env.GOOGLE_MAPS_API_KEY ?? '',
    osrmUrl: process.env.OSRM_BASE_URL ?? 'http://localhost:5000',
  },
  s3: {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    accessKey: process.env.S3_ACCESS_KEY,
    secretKey: process.env.S3_SECRET_KEY,
    bucket: process.env.S3_BUCKET,
  },
  payments: {
    jazzcash: {
      merchantId: process.env.JAZZCASH_MERCHANT_ID ?? '',
      password: process.env.JAZZCASH_PASSWORD ?? '',
      integritySalt: process.env.JAZZCASH_INTEGRITY_SALT ?? '',
      returnUrl: process.env.JAZZCASH_RETURN_URL ?? '',
    },
    easypaisa: {
      storeId: process.env.EASYPAISA_STORE_ID ?? '',
      hashKey: process.env.EASYPAISA_HASH_KEY ?? '',
      returnUrl: process.env.EASYPAISA_RETURN_URL ?? '',
    },
  },
  push: {
    expoAccessToken: process.env.EXPO_ACCESS_TOKEN ?? '',
  },
  observability: {
    sentryDsn: process.env.SENTRY_DSN ?? '',
    betterStackToken: process.env.BETTER_STACK_TOKEN ?? '',
    betterStackHost: process.env.BETTER_STACK_HOST ?? '',
  },
});

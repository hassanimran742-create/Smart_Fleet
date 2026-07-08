export default () => ({
  api: {
    port: Number(process.env.API_PORT ?? process.env.PORT ?? 3000),
  },
  db: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    // Either REDIS_URL (rediss://user:pass@host:port) or REDIS_HOST/PORT.
    url: process.env.REDIS_URL,
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'change_me_access',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'change_me_refresh',
    // 12 hours — generous enough to cover a full work day. The
    // admin web also enforces a 10-minute idle timeout on top, so
    // unattended sessions still close.
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
      baseUrl: process.env.EOCEAN_BASE_URL ?? '',
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
  featureFlags: {
    posthogKey: process.env.POSTHOG_API_KEY ?? '',
    posthogHost: process.env.POSTHOG_HOST ?? 'https://app.posthog.com',
  },
  observability: {
    sentryDsn: process.env.SENTRY_DSN ?? '',
    betterStackToken: process.env.BETTER_STACK_TOKEN ?? '',
    betterStackHost: process.env.BETTER_STACK_HOST ?? '',
  },
});

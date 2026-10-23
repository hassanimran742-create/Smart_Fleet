// API test harness. DB suites: name them *.e2e-spec.ts, wrap them in describeDb(...), and run them
// with `npm run test:e2e` (DATABASE_URL set). `npm test` runs the unit tests only.
// The whole API for HTTP cases: `createTestApp()` from './app' (imported directly: it loads AppModule).
export * from './auth';
export * from './db';
export * from './describe-db';
export * from './factories';
export * from './standard-data';
export * from './waiting';

import 'reflect-metadata';

// Shared by `npm test` (unit) and `npm run test:e2e` (DB). Test-only defaults, applied only when a
// variable is unset, so CI and local runs can still set their own.
// The token helpers (test/helpers/auth.ts) and the API under test read the same JWT secret.
process.env.JWT_ACCESS_SECRET ??= 'test_only_access_secret_not_for_any_deployment_01';
process.env.JWT_REFRESH_SECRET ??= 'test_only_refresh_secret_not_for_any_deployment_1';
// Queues created by tests never share Redis keys with a developer's API.
process.env.BULLMQ_PREFIX ??= 'sf-test';
// [Inc 2] The customer's link (CUSTOMER_PAGE §2, §5): every suite signs and builds links the same way
// (test/helpers/customer-links.ts and test/inc2/confirm/support.ts read the same values).
process.env.CONFIRM_LINK_SECRET ??= 'test_only_confirm_link_secret_not_for_any_deployment';
process.env.PUBLIC_LINK_BASE_URL ??= 'https://smartfleetpk.com';

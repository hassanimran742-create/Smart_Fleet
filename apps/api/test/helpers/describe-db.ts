import { hasTestDb } from './db';

/**
 * `describe` when DATABASE_URL is set, `describe.skip` otherwise: DB suites skip cleanly when no
 * database is configured.
 *
 *   describeDb('orders: place and cancel', () => { ... });
 */
export const describeDb: jest.Describe = hasTestDb ? describe : describe.skip;

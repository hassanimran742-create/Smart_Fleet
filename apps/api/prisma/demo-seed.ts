/**
 * Retired with the inc1a migration (docs/pilot/DATA_MODEL.md §2.5).
 *
 * The old demo seed wrote wallet balances directly and ledger rows without idempotency keys, so it
 * broke the wallet invariants from inc1a on: the ledger sum must equal the balance, and every
 * ledger row has an exactly-once key. It refuses to run. Its replacement is the pilot setup script
 * of Inc 3 (API_CONTRACT §10.3). `npm run seed` still creates the base accounts.
 *
 * The previous version is in git history (commit af889bf).
 */
console.error('seed:demo refuses to run: it was replaced by the pilot setup script (Inc 3).');
console.error('Use `npm run seed` for the base accounts.');
process.exit(1);

export {};

// API test harness. DB suites: name them *.e2e-spec.ts, wrap them in describeDb(...), and run them
// with `npm run test:e2e` (DATABASE_URL set). `npm test` runs the unit tests only.
// The whole API for HTTP cases: `createTestApp()` from './app' (imported directly: it loads AppModule).
//
// What each module gives (Increment 1, then the Increment 2 additions):
// - auth: signed tokens per role (authHeader, tokenFor.<role>).
// - db: the test database (getTestPrisma, resetDb, walletMismatches); describe-db: describeDb.
// - factories: people, zones, stores, distributors with their one store, drivers with vans, customers,
//   cylinder types, unnumbered cylinders, delivery prices.
// - standard-data: the TEST_CASES.md standard data (SA1, DA, DR1, C1, the zones, sizes and prices).
// - waiting: itAfter(lanes, ...) for tests that wait on another lane.
// - [Inc 2] runs: orders (createOrder), trips with their store pickup and delivery stops (createTrip,
//   addDeliveryStop, setStopStatus), labelled cylinders (registerCylinders), loaded vans (loadVan),
//   hand-overs and take-backs on a visit (handOver, takeBack), cylinders held by a customer or left on a
//   van (placeWithCustomer, placeOnVanFromEarlierRun), FAULTY/LOST fixtures (setCylinderState), and
//   readers (cylinderHolder, stopCylinders). Moves are written as ScanService writes them.
// - [Inc 2] scan-calls: scanCalls(app) for the driver, store and office scan routes (tripScan, storeScan,
//   unlabelledReturns, finishStop, finishTrip, trip, stop, driverHome, storeIncoming, storeStock,
//   cylinderHistory, manualDelivery, failOrder, legacyScan, bulkRegister).
// - [Inc 2] customer-links: link tokens as the service derives them (confirmationToken, tokenFromUrl),
//   confirmation rows with a known token (createConfirmation), and customerLinks(app) for the public page
//   (open, answer) and the confirmation and case routes (view, share, newLink, cases, myCases, resolveCase).
// - [Inc 3] refills: stations (createStation), refill requests numbered AG-R001… (createRefill, optionally
//   assigned), the scan steps as the refill scans write them (pickUpForRefill, fillForRefill,
//   receiveForRefill, advanceRefill, cancelRefill), and readers (refillLines, refillCountsOf, refillEvents,
//   onOpenRefillLine).
// - [Inc 3] day-end: the standard labelled stock AG-C0001…AG-C0035 and BG-C0001…BG-C0003
//   (registerStandardCylinders), Karachi wall-clock instants (karachiTime), stored sheet files
//   (createStoredFile), day rows and lines (createDayClose, addDayCloseLines, dayCloseOf, dayCloseLines), and
//   the sheet itself with exceljs (buildDaySheet, daySheetAbout, readDaySheet, fillDaySheet).
// - [Inc 3] inc3-calls: refillCalls(app) and dayEndCalls(app) for the refill and day-end routes (the sheet
//   download comes back as a Buffer).
// - migrations (imported directly, like app): scratch databases and the releases migrate.sh runs.
export * from './auth';
export * from './db';
export * from './describe-db';
export * from './factories';
export * from './standard-data';
export * from './waiting';
export * from './runs';
export * from './scan-calls';
export * from './customer-links';
export * from './refills';
export * from './day-end';
export * from './inc3-calls';

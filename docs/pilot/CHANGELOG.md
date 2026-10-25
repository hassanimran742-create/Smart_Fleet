# Inc 2/3 follow-ups, 2026-10-25

The items the review23 check left are done and checked together. The money model is unchanged: nothing here moves money; only Inc 1's delivery cost, taken when the order is placed, and its refund before the start do. One migration is added, `20261025113630_users_app_seen` (three nullable `users` columns), and no new error code or setting.

## Load-proof tests
- DAY-025 (three day-end uploads at once) keeps its bounds for an unloaded machine, 1 second for the longest wait of `GET /health/live` and 10 seconds for the three answers, and multiplies both by a baseline it takes in the same run: how much slower than on an unloaded machine zlib inflates the workbook's 17 MB of sheet XML, measured before and after the uploads (`machineSlowdown`, the median of five, the slower of the two). Another job keeping the cores busy no longer fails it (the review23 check saw 1,347 ms against the fixed bound), and what it proves stands: with the shape check taken out, exceljs reading the three files kept `/health/live` waiting 3,036 ms on this machine and 10,269 ms beside eight busy processes, far past the scaled bound, with the heap up 261–269 MB. With the check in, the same eight processes made it wait 864 ms. (TEST_CASES DAY-025)
- The fresh-database suites (`test/inc3/db`, `test/inc2/db` and `test/migrations` `fresh-db`) get an explicit 10-minute jest timeout per test and hook: every step starts the Prisma CLI in a new process, and the hand-written steps took 49.5 s against jest's 30-second default while another job kept every core busy (13 s on a quiet machine). What they prove is unchanged.

## App version per user (switch-over step 10)
- Every signed-in call of a shop or a driver from their own app records its `X-App-Variant` and `X-App-Version` (or "0.1.0" for the installed 0.1.0 JS, which sends no header), also when the update gate refuses it: `users.app_variant`, `app_version`, `app_seen_at`, written by AppSeenService from the gate, when the app changes and otherwise at most every 10 minutes per user. A failed write never fails the call, and `updated_at` is left alone. (API_CONTRACT §1.2, §6; DATA_MODEL §5.6; FND-045)
- The office's `GET /drivers` and `GET /distributors` (and their single reads) carry `app: { status, version, seenAt }`, with `AppStatus` UP_TO_DATE, NEEDS_UPDATE (below `app.minVersion` of that app) or NOT_SEEN; the driver's and the shop's own reads don't. (API_CONTRACT §1.4, §7.2, §7.3; OFF-020)
- The website's Distributors and Drivers lists show it as a chip in the Status cell: "App: up to date" (green), "App: needs update" (amber, the warning sign) or "App: not opened yet" (grey), with the version and the time of the call on hover; none for a suspended or archived account. (UX_ADMIN §2.4, §2.11, §3.8; UX_PRINCIPLES §4.2; OFF-021)
- The switch-over's step 10 now raises `app.minVersion` to 0.1.1 as soon as the update is published, so a phone still on the 0.1.0 JS is told to restart, and one look at those two pages replaces opening Help on every phone: go on when every pilot row reads "App: up to date". (API_CONTRACT §6, §8.5 step 10; OFF-023)
- The pilot setup CLI's module provides AppSeenService too, since DistributorsService and DriversService build their office views with it; `npm run pilot:setup` makes no app call and records nothing. (SET-003 to SET-008)
- The migration is made with the repo's new-migration flow against HEAD (the Inc 3 schema, now also `test/helpers/fixtures/schema.inc3.prisma`, which the `inc3` test release uses): no pre-check, no backfill, two CHECKs (`users_app_seen_chk`, `users_app_version_chk`), both validated. The Inc 3 release cases compare with that snapshot, and today's API runs on their databases once the current release is applied. (DATA_MODEL §5.6; MIG-020)

## Website and driver app
- The Alerts page reads a `VAN_NOT_EMPTY` alert from its `context`: "LEA-101 still has cylinders on it (1)" with the van's count now, and "Reason: Store closed" when the driver gave one, never the words of its first raise. (UX_ADMIN §3.7, §3.8; API_CONTRACT §9.12; OFF-022)
- The driver's Today shows one line under the van while refills are assigned, "2 refills · 7 cylinders", with the cylinder icon and no button, so they are seen at once when trips push their rows below the fold; 2 fixed words, the theme's tokens only. (UX_MOBILE §7.2 R2; DRV-060; DRV-045 step 7)
- `apps/admin-web/package.json` declares the jest it runs: `jest` 29.7.0, `ts-jest` 29.4.11 and `@types/jest` 29.5.14, the versions already installed. One `npm install --no-audit --no-fund` added those three lines to the lock and nothing else: no version, and no installed package, changed.

## Test catalogue
- TEST_CASES.md and .csv are regenerated, now 604 cases: 7 new ones (`zz_finish_add.json`, the next free numbers: FND-045, OFF-020 to OFF-023, DRV-060, MIG-020; every published ID stays pinned, final.v5.json) and the texts of DAY-025 and DRV-045 (resolution_fixes.json). (TEST_CASES "Summary")

## Verification
- `npx turbo run typecheck --force`: 9 of 9. `npm test -w @smartfleet/api`: 81 suites and 1,149 tests passed (6 skipped: the smoke suite, which needs a running server). `npm test -w @smartfleet/admin-web`: 5 of 5, now on the jest the package declares.
- All DB suites, one at a time, on a fresh `sf_finish_test`: 168 of 168 suites and 701 of 701 tests passed in 62 minutes, and the nightly wallet check is clean (WAL-020). Another job kept about seven of the eight cores busy the whole time. DAY-025 measured a slowdown of ×4.12 (the sheet inflated in 103 and 97 ms): `/health/live` waited at most 2,534 ms against a budget of 4,120 (the old fixed bound was 1,000), the three refusals came in 3.6 s and the heap rose 3 MB. The fresh-database suites passed in 73, 16 and 18 s (the Inc 3 hand-written steps 11 s).
- Offline exports of the shop and the driver app (`APP_VARIANT`, `EXPO_OFFLINE=1`): 1,260 modules each, exit 0, the driver bundle carrying the refill line. The website's vite build: exit 0.
- Website preview (the compiled API on its own port and database, the pilot setup, the real routes): the Distributors and Drivers pages at 1366×768 and 1024×768 show "App: needs update" for a shop still on the 0.1.0 JS, "App: up to date" for a driver on 0.1.1 (hover "0.1.1 · 25 Oct, 6:36 pm") and "App: not opened yet" for the others, with no sideways scroll and no console problem; the Alerts page reads "LEA-101 still has cylinders on it (1)" and "Reason: Store closed" for an alert whose stored title says (2). The shots found one thing, fixed: at 1024 px the Drivers list's narrower Van column split "LEA-101" across two lines; the plate now stays on one.
- Test catalogue: build, test map and validate clean, 604 cases. Automated cases with a passing test: Inc 1 256 of 256, Inc 2 138 of 138, Inc 3 62 of 62.
- Nothing ran on a real phone. The over-the-air switch-over (API_CONTRACT §8.5 step 10, OFF-023) waits for the pilot phones.

# Inc 2/3 review fixes, 2026-10-25

The 31 findings the Inc 2/3 review (review23) confirmed are fixed by four lanes (server runs, server hardening, phone app, office website) and put together here. The money model is unchanged: no Inc 2/3 path moves money; only Inc 1's delivery cost, taken when the order is placed, and its refund before the start do. The lead's decisions: a van change waits for the runs on it and is never moved (holder-scans-01, security-01); the day-end upload is checked for the sheet's shape before exceljs reads it, read one file at a time, and rate-limited (money-data-01, security-02, robustness-jobs-01); the over-the-air JS names its own release, so `app.minVersion` can retire the 0.1.0 JS, which is told "Close the app and open it again to update." where only the Inc 2/3 apps can go on (contract-compat-01, -02, -04). Every refusal comes from the shared catalogue: two codes are new, `DRIVER_HAS_OPEN_RUN` and `APP_RESTART_TO_UPDATE` (API_CONTRACT §2.3).

## The findings
- holder-scans-01: a van change waits for the runs on it: 409 `DRIVER_HAS_OPEN_RUN` "Finish or reassign Kashif's trip on LEA-101 first." while a trip with an open stop or an assigned refill is on either van, or is the driver's own; nothing is moved; the assignments lock the driver row. (API_CONTRACT §2.3, §7.6, §7.11, §9.5; HLD-020)
- holder-scans-02: two open runs on one van don't block each other: another run's loads still out for delivery aren't a run's leftovers, and the driver app's next step reads the trip's own `van.cylinders`. (§9.3, §9.12, §9.13; UX_MOBILE §5; HLD-021)
- holder-scans-03: a move that keeps the holder (a refill fill, a day-end SET_STATE or MARK_LOST fix) no longer changes the responsible driver. (§9.2; HLD-022)
- holder-scans-04: COMPLETE follows "Finish trip": a refill cylinder on the van no longer hides it, and the app's Unload and next step read `van.cylinders`. (§9.12, §9.13; UX_MOBILE §5, §7.2; DRV-058)
- holder-scans-05: a cylinder a day-end fix marked lost on a van stays on its record (Lost on My van) but no longer keeps the van loaded; found and taken back it counts again. (§9.3, §9.4, §9.9, §10.5; HLD-023)
- holder-scans-07: a sheet sent again after a reopen keeps the applied fixes' links, and an extra number already registered is added once. (§10.2; DATA_MODEL §5.5; DAY-023)
- holder-scans-08: the history's "since" is the time of the last move that changed the holder. (§9.4; HLD-024)
- money-data-01: a day-end sheet with ranges past row 20,000 (a dropdown dragged down whole columns, merges, names) is refused with 422 `DAY_SHEET_UNREADABLE` before exceljs reads it, so the API keeps answering. (§10.2 check 3, §10.5; DAY-024)
- security-01: the van change can no longer put one driver's loads on another driver's van (the same fix as holder-scans-01). (§9.5; SEC-037)
- security-02: day-end files are read one at a time per API instance (two may wait 15 s; then 503 `SERVICE_UNAVAILABLE` with `Retry-After: 10`, and the shop app offers "Try again"), within cell and row budgets, and a shop login may send 20 uploads in 10 minutes. (§3.6, §10.5; UX_MOBILE §8.3; SEC-038)
- security-03: the old driver can't read a visit reassigned to another driver (404). (§9.3; DRV-055)
- security-04: link tokens are hidden from the Caddy log and `redactPath` in every form the page accepts (capitals, separators, `/C/`). (CUSTOMER_PAGE §5; CNF-048; CNF-029)
- security-05: new-link texts are capped at 3 per order and 20 per shop an hour (429 with `Retry-After`); a repeat or a link without a text is never limited. (§3.6, §9.7; MSG-023)
- contract-compat-01: the installed 0.1.0 JS gets 426 `APP_RESTART_TO_UPDATE` on its Finish when only the Inc 2/3 apps can empty the van, and on `POST /filling-orders` (`@NewAppOnly`); the switch-over checklist gets step 10. (§6, §7.11, §8.5, Appendix A; FND-044)
- contract-compat-02: the over-the-air JS sends its own release (0.1.1) as `X-App-Version`, the phone's gate and Help read the same value, and a header-less call is told to restart; `app.minVersion = 0.1.1` retires the 0.1.0 JS alone. (§1.2, §6, §9.1; UX_MOBILE §3.1, §3.6, §7.0; FND-042)
- contract-compat-04: a 0.1.0 "All delivered" that keeps the visit open issues the customer's link only at the visit's close, so the page shows the take-back list. (CUSTOMER_PAGE §1; §9.12; CNF-049)
- contract-compat-06: the office Refills tabs are server lists (`GET /filling-orders?tab=…`, counts and a cursor, "Load more"), so an old refill waiting for a driver stays in Needs a driver. (§1.3, §7.11; UX_ADMIN §4.1, §4.5; REF-032)
- robustness-jobs-01: three uploads at once of a huge workbook are refused at once and the API stays up (the shape check and the read gate). (§10.5; DAY-025)
- robustness-jobs-02: text with half an emoji (a lone surrogate) is refused as `INVALID_VALUE` or cleaned to U+FFFD, never a 500. (§2.2; CUSTOMER_PAGE §4; FND-043)
- robustness-jobs-03: the 03:00 van check and "Finish trip" leave out a cylinder marked lost on the van (the same rule as holder-scans-05). (§9.9; HLD-025)
- robustness-jobs-05: the bare refill lists (`/mine`, `/driver/mine`, the office's without a tab) keep every open refill, plus the newest 200 closed ones. (§1.3; REF-033)
- robustness-jobs-06: a refreshed `VAN_NOT_EMPTY` rewrites its title and body with the van's count now and keeps the driver's reason from the van's latest finished trip. (§9.9, §9.12; DRV-056)
- robustness-jobs-07: two wallet checks at once raise one alert per broken wallet (a per-distributor advisory lock around the check and the raise). (§8.5; DATA_MODEL §3.6; WAL-026)
- robustness-jobs-08: the pilot setup exits 3 when the run committed but the labels file couldn't be saved (the labels are printed), and the server procedure is documented. (§10.3, §10.5; infrastructure/aws/README.md; SET-013)
- robustness-jobs-09: broken bodies and unreadable paths on the customer link get the page, never JSON; the page's bodies have their own 8 KB, 20-field limit. (CUSTOMER_PAGE §5; CNF-050)
- ux-01: the shop app's Home and Day-end open the day that waits for the shop (sent back or reopened first, then an earlier day not sent), also after the 3 am cut-off; this covers robustness-jobs-04. (UX_MOBILE §8.3; DAY-026; DAY-020)
- ux-02: the driver's Today lists his open refills, and the menu's Refills row shows their count. (UX_MOBILE §3.6, §7.2; DRV-059; DRV-045)
- ux-03: in take back the result strip sits right under the state tap, with a shorter camera, so it shows on a 360×640 phone. (UX_MOBILE §2.2, §7.1; DRV-057; DRV-031)
- ux-04: "Bring back unfilled" sits under the title, away from "Type number", and "Back to filling" undoes it. (UX_MOBILE §8.2; REF-034; REF-025)
- ux-07: "Download again" says "Your filled sheet can't be sent after this.". (UX_MOBILE §8.3; DAY-027; DAY-019)
- ux-11: a phone number never splits across two lines, in the apps (a no-break space) or on the customer page (a no-wrap span). (UX_PRINCIPLES §5.1; CUSTOMER_PAGE §6; UXQ-034)

## Refuted findings
- holder-scans-06 (the swap rule is per visit), holder-scans-09 ("with another customer" is the documented copy) and contract-compat-03 (picked-up refill empties are "coming back", G08-09): no change; their review tests now pin the documented behaviour instead of failing by design.
- contract-compat-05 (the same as security-01), robustness-jobs-04 (merged into ux-01), contract-compat-07, ux-05, ux-06, ux-08, ux-09 and ux-10: documented behaviour or owner decisions; nothing changed.
- The verifiers' premise tests (`test/review23/verify-holder-money`) now check the fixed behaviour.

## Tests
- Each fixed finding has regression tests named "REV23 <finding id> …": e2e suites under `apps/api/test/review23` (rev23-runs-fixes, rev23-runs-dayend, old-apps-inc23 and the security and robustness suites), `test/inc3/refills/refill-lists`, `test/inc2/scan/driver-views`; unit tests `test/unit/redact`, `rev23-lone-surrogate`, `rev23-call-row`, `app-version`, `error-filter`, `money/wallet-service` and the phone's `test/unit/ui/mobile-rev23-*` (app version, day-end, driver, phone, trip); the website's `apps/admin-web/src/features/refills/__tests__/board.spec.ts` (`npm test -w @smartfleet/admin-web`).
- The suites that play the Inc 2/3 apps send their headers where the 0.1.0 JS is now refused (`test/helpers/app-headers.ts`: `POST /filling-orders`); the 0.1.0 replays expect the restart answer. FND-010 pins `APP_RESTART_TO_UPDATE`. The customer page's 18 approved snapshots are re-approved for the no-wrap span only.

## Test catalogue
- TEST_CASES.md and .csv are regenerated, now 597 cases: one regression case per fixed finding (31, `zz_review23_add.json`, the next free numbers; every published ID stays pinned, final.v4.json), and the case texts the fixes changed (resolution_fixes.json): FND-010, FND-011, ORD-016, HLD-018, CNF-029, DRV-031, DRV-045, DRV-053, DAY-019, DAY-020, REF-025, REF-028, UXQ-002 and RHS-001. (TEST_CASES "Summary")

## Verification
- `npx turbo run typecheck --force`: 9 of 9. `npm test -w @smartfleet/api`: 77 suites and 1,132 tests passed (6 skipped: the smoke suite, which needs a running server), 63 of them REV23 tests. `npm test -w @smartfleet/admin-web`: 5 of 5.
- All DB suites (Inc 1, 2 and 3, the Inc 1 review's and `test/review23`) on a fresh `sf_fix23check_test`: 164 of 166 suites and 693 of 695 tests passed, and the nightly wallet check is clean (WAL-020). The other two ran out of time while another job on the machine kept every core busy: DAY-025's three uploads at once were all refused 422 in 2.3 s with the heap up 2 MB, but `/health/live` waited 1,347 ms against the test's 1-second bound; fresh-db's hand-written steps took 49.5 s against jest's 30 s (13 s in the earlier runs). Run again on their own, with the heavy-upload suite, on a fresh `sf_fix23check_rerun_test`: 3 suites and 9 tests passed and the wallet check clean. DAY-025's slowest `/health/live` was 965 ms there and 936 ms in one more run alone, both while the other job ran again; the review23 suites alone on a quiet machine had it at 266 ms. The 1-second bound is sensitive to a machine that is busy with something else.
- Exit scenarios, each on its own fresh database and port: Inc 1 23 of 23 with the nightly check clean, Inc 2 29 of 29 with the jobs and the SQL checks clean, Inc 3 58 of 58. Their phones send the Inc 2/3 apps' headers (0.1.1). The Inc 1 scenario's Unload now goes through `POST /store/scans`, because the 0.1.0 SCAN_IN is refused (403).
- Offline exports of the shop and the driver app (`APP_VARIANT`, `EXPO_OFFLINE=1`): 1,260 modules each, exit 0, the bundle carrying release 0.1.1. The website's vite build: exit 0.
- Phone preview (the real apps on react-native-web against the compiled API, 360×640 and font 1.3): 34 shots of the fixed screens, among them the shop's Home and Day-end on a sent-back day, "Download again" with its line, Help with "App version 0.1.1", the order's call row, the driver's Today with a refill and the menu's Refills count, take back at 640 px, "Bring back unfilled" and "Back to filling", and a second run on a loaded van ending with "Finish trip". Website: 28 shots of Vans and Refills at 1366×768 and 1024×768. The customer page's call row at 320 px, and at 320 and 360 px with the text 30% larger: the number stays on one line.
- Test catalogue: build, test map and validate clean. Automated cases with a passing test: Inc 1 256 of 256, Inc 2 134 of 134, Inc 3 60 of 60.
- Nothing ran on a real phone. The over-the-air switch-over (API_CONTRACT §8.5 step 10) waits for the pilot phones.

# Inc 2/3 screens, 2026-10-25

The Increment 2 and 3 screens of the driver app, the shop app and the office website are built on the merged Inc 2/3 server, to the rulebook (UX_PRINCIPLES), by three lanes, and put together at the UI gate. The money model is unchanged: no scan, receive, refill, day-end, customer answer, problem or new screen moves money; only Inc 1's delivery cost, deducted when the order is placed, and its refund on a cancel before delivery has started do. The one-holder rule holds on every screen: a cylinder goes onto a van only from the store (no IN, no OUT). The phone apps update over the air onto the 0.1.0 APK and add no native module: `expo-file-system`, which the day-end sheet uses, is declared in apps/mobile at `~17.0.1`, the version expo 51.0.39 already puts in the APK. Each line below gives what was built or settled and where the docs now say it.

## Driver app (driver lane)
- R2–R10 and the Inc 3 refill run are built on the §9 and §10 routes: Today, Trip, Load, the visit in four phases (on the way, deliver, take back, done) with the No label sheet and Could not deliver, Unload, Refills, the refill run (pick up, fill, unload), My van and Help. The routes are Home, Trip, Load, Visit, Unload, Refills, RefillRun, Van and Help. (UX_MOBILE §7.2, §8.2 "As built", Appendix A; DRV-009, DRV-017, DRV-025, DRV-031, DRV-034, DRV-036, DRV-045, DRV-046, REF-025, RHS-017)
- The Inc 1 stop-gaps are gone from the code: the legacy `POST /custody/scan`, the "scanned" tally, the early "Only 0 of 3 scanned. Continue?" and "All delivered?" sheets, Unload as a SCAN_IN scan, the refill steppers and Today built from `GET /trips/mine`. UX_MOBILE §5 now reads "Inc 1 build only". (UX_MOBILE §5)
- One ScanPanel for the driver's steps, the refill run and the shop's Receive. Its read loop is plain logic in `ui/scan/scanReducer.ts` (DRV-035): a label held in front of the camera is ignored, a "Not saved" label read again is resent with its first scan id, and reads that come during a request wait their turn. Strips name the cylinder ("AG-C0042 · 11.8 kg loaded"). The amber "Not saved: N" row has one Retry, the leave sheet says "2 scans not saved", "Type number" uses the number pad, and the camera stops at the step's count. (UX_MOBILE §7.1 "As built")
- Unload is passive: the groups list the van's cylinders by number and tick each one the shop scans in, checking every 5 seconds. "Finish trip" before the van is empty shows the catalogue's line ("The store must scan in 5 more from your van."). (UX_MOBILE §7.2 R3, R7; DRV-042)
- Today's rows name the customers and the cylinders ("Deliver to Sana", "3 cylinders · load at Ahmed Gas Store"); My van lists the numbers on the van. (UX_MOBILE §7.2 R2, R9; DRV-045, DRV-049)
- Push (R8) is best effort. On the 0.1.0 APK the phone gets no token and Today keeps its 30-second poll; signing out first removes the token, never blocking the sign-out. (UX_MOBILE §7.0, §7.2 R8; DRV-048)

## Shop app (shop lane)
- Home's rows: the red customer problems row, "Receive from driver" with "3 coming back" (with one van it opens that van's scan), and "Day-end sheet". Each shows only while its feature is on. (UX_MOBILE §7.3 "As built")
- Receive from driver (the list and the scan), the customer answer card with Send link and "Make a new link?" (its main button is the screen's footer), the delivered and taken-back lines by cylinder number, Customer problems and Edit customer. The order rows show the answer chip under the stage chip. (UX_MOBILE §7.3 S13–S15b; CUSTOMER_PAGE §10; STR-010, STR-011, STR-013, CNF-044, CAS-012, MSG-015 to MSG-020)
- Refills open a refill detail: one big count, the six-step timeline with "Driver assigned · 9:40 am", the driver with Call, and the red-outline "Cancel refill" before pickup. Day-end shows the date, its chip and three steps; Check and send lists the differences with their fix chips, the row errors, and the confirm "Send day-end for Sun 25 Oct?". (UX_MOBILE §8.1, §8.3 "As built"; REF-026, REF-027, DAY-019, DAY-020, RHS-018)
- The day-end sheet without a new native module. Until the 0.2.0 APK brings expo-sharing and expo-document-picker, the sheet is saved into a folder the shop picks once and picked from it for the upload ("Pick your sheet": only .xlsx files, today's first, then "Other folder"). Android's folder screen opens at Documents, because Android 11 and later refuse the Download folder. `dayend/sheetFiles.ts` is the only file to swap later. (UX_MOBILE §7.0, §8.3)

## Office website (office lane)
- Customer problems (`/problems`) with Mark as sorted. The order drawer gets the Customer answer section, with Copy customer link, and the cylinder lines: "Loaded 3 of 5", Delivered and Taken back by number. The Orders board shows the answer chip and "Loading · 3 of 5 loaded". (UX_ADMIN §3.8; CAS-010, CAS-011, CNF-043, MSG-021)
- "Mark delivered…" v2 names each cylinder in a 640 px dialog. Find cylinder has its page and a search box under the product name in the sidebar. The Activity log has sentences for the Inc 2 rows. (UX_ADMIN §3.8; HLD-007, RHS-019, STR-012)
- Settings gets the sections Customer messages and Scans. (UX_ADMIN §3.8; CNF-045)
- Refills are rebuilt with tabs, stage chips with counts, a drawer and Assign driver; they replace the legacy screen, whose "Mark complete" the Inc 3 server refuses with 410. Day-end has its list and its review: approve, send back, reopen, and "Load new version" after a newer upload. Today gets the refill and day-end cards. (UX_ADMIN §4.5; REF-028, DAY-021, DAY-022)
- The sidebar's Work group adds Customer problems and Day-end, each with its own badge. Day-end hides while day-end is off. The Today badge is unchanged, and in the 200 px sidebar a long label wraps to two lines so its badge stays in sight. The kit adds the `answer`, `dayEnd` and `refillProgress` chips, "Part-filled", FAULTY as "Damaged" everywhere, and `Modal size="lg"`. The Vans page shows the plate words for `VEHICLE_HAS_CYLINDERS`. (UX_ADMIN §1.3, §3.7, §3.8, §4.5; HLD-018)

## Server reads the screens asked for (gate)
- Each read is additive, so the 0.1.0 apps and the older website ignore it, and none writes or moves money (API_CONTRACT §9.13, §10.5):
  - `GET /trips/:tripId` `van.cylinders`;
  - `TripSummary.customerNames` and `.cylinders`;
  - `GET /inventory/my-vehicle` `cylinders`;
  - `OrderDto.load` and `.visit`;
  - the cylinder history's `toState`, `station` and `dayEnd`;
  - the refill's `assignedAt`;
  - `DayEndUploadResult.checked`;
  - the order's number `no` in the audit diffs of `case.resolve`, `confirmation.answer` and `confirmation.new_link` (never the customer's note or phone).
- `GET /store/incoming` lists only what is coming back. Cylinders out for delivery (loaded for an order still to be delivered, while loading or on the way) aren't listed. `counts.received` counts this return only, never an earlier run or refill of the same van that day. The store can still receive any cylinder from any van. (API_CONTRACT §9.4, §9.12, §9.13; UX_MOBILE §7.3)

## Gate fixes from the shots
- Shop Home read "3 coming back" for a van still out for delivery, and a second run read "1 of 3 received": fixed by the incoming change above.
- ScanPanel: once the count is reached, an open typed field folds back to "Type number", so a finished step shows its tick and not an empty field. (UX_MOBILE §7.1)
- The leave sheet with one scan reads "1 scan not saved" / "Leave now and it's lost." (`scan.unsaved.body_plural` keeps "they're" for two or more). (UX_MOBILE §7.1)
- Visit done: "1 empty · 1 part-filled · 0 full" shows only when something was taken back. (UX_MOBILE §7.2 R5)
- Check and send: a cylinder marked Missing reads "You: Missing" with no state, and counts as a Place difference only. The website's day-end review reads the same row "In a different place", not "Place and state differ". (UX_MOBILE §8.3; UX_ADMIN §4.5)
- Website at 1024 px: in the 200 px sidebar the ellipsis hid the Customer problems badge; labels now wrap to two lines. (UX_ADMIN §3.8)

## Tests
- REV mobile-ux-05 reads TodayScreen.tsx and TripScreen.tsx. DRV-035's 12 tests run under the API's jest, which also roots `apps/mobile/src/ui/scan`. REV web-ux-04 covers the two new badges.
- The new e2e suites `test/inc2/gate/order-load-and-visit`, `test/inc2/gate/store-incoming` and `test/inc3/gate/refill-and-history-reads` cover the reads above. driver-views covers Today's names and counts, `van.cylinders` and My van's `cylinders`. CNF-039 expects the diff `{ response, no }`.
- The phone preview harness (scratchpad) runs the Inc 2/3 screens of both apps on a seeded API, starting with `npm run pilot:setup -- --test`. It captures them at 360×640, the main ones again at font 1.3, and the website's new pages at 1366×768 and 1024×768.

## Test catalogue
- TEST_CASES.md and .csv are regenerated with the gate's case updates: 566 cases. (TEST_CASES "Summary")
  - Retired by the Inc 2/3 build, their numbers left unused: DRV-006 (the Inc 1 step screens with the "scanned" tally and the "All delivered?" sheets), DRV-051 (Unload as a scan), DRV-052 (the refill steppers) and DRV-054 (the early "Done loading" sheet). DRV-017, DRV-031, DRV-042 and REF-025 walk the built screens. The IDs published at the merge are now pinned too, so DRV-053 keeps its number.
  - Updated to the built screens: DRV-042 (Unload lists the cylinders by number and ticks each one), DRV-046 (each step's footer names the next), RHS-009 step 5 ("Type number" after "All 6 loaded"), STR-012 (the history with each state; the Find cylinder box), CNF-034 and CNF-044 (the answer chip under the stage chip), MSG-017 (WhatsApp first in Send link), DAY-019 and DAY-020 (the folder: "Sheet saved in Documents", "Pick your sheet", "Other folder", only .xlsx files), UXQ-007 and UXQ-028 (the Inc 2/3 driver screens).
  - Notes: DRV-048 needs the 0.2.0 APK for a push token; REF-027 and RHS-019 name the gate suite that proves their server part; DRV-035 is automated.
- Automated cases with a passing test: Inc 1 255 of 255, Inc 2 121 of 121 (DRV-035 included), Inc 3 43 of 43. REF-027, REF-029 and RHS-019 stay manual cases that also have an automated proof.

## Verification
- `npx turbo run typecheck`: 9 of 9. `npm test -w @smartfleet/api`: 67 suites and 1,062 tests passed (6 skipped, as before), with the UXQ static rules, REV mobile-ux-05 on the new driver screens and DRV-035's 12 tests. The day-end ZIP-bomb unit test gets its own 30-second limit: deflating about 80 MB passed jest's 5-second default when the DB suites ran beside it.
- All DB suites (Inc 1, 2 and 3) on a fresh `sf_uigate_test`: 133 suites and 622 tests passed, and the nightly wallet check is clean (WAL-020).
- Offline exports of the shop and the driver app (`APP_VARIANT`, `EXPO_OFFLINE=1`): 1,256 modules each, exit 0. The website's vite build: exit 0.
- Phone preview: the real apps on react-native-web against the compiled API, seeded by `npm run pilot:setup -- --test` and the real routes. It took 115 shots at 360×640 and 119 at font 1.3, every section passing. Website: 78 shots at 1366×768 and 1024×768, with no sideways scroll and no console problems. Each new screen was checked against UX_PRINCIPLES §10 as the driver, the shop and the office would use it, and the fixes above came from that check.
- Nothing ran on a real phone. The camera, Android's folder screen, push, and the WhatsApp and text message hand-offs wait for the device walk (UXQ-007, UXQ-028, DAY-019, MSG-017, DRV-048).

# Merge of the Increment 2 and 3 server into the simple-UX build, 2026-10-24

The Increment 2 and 3 server (the two sections below) is merged into the simple-UX build of Increment 1 on `pilot/happy-path`. The merge changed no behaviour, no screen and no money rule: the delivery cost is deducted when the order is placed and returned only on a cancel before delivery has started, and no scan, refill, day-end, confirmation or case moves money. Each line below says what the merge settled.

## Docs and code
- Both sides are kept everywhere. They overlapped only in this file (every section kept, newest first), CUSTOMER_PAGE §6 (the simple design's paragraph, then the "As built" one), API_CONTRACT (the simple-UX words in §2.3, §9.7 and §9.8 beside the server's §3.7, §9.12, §10 and the rest), the error catalogue (ASSIGN_DRIVER_NOT_AVAILABLE says "trips"; the day-end row error is typed) and two tests. The catalogue in shared-types still matches API_CONTRACT §2.3 exactly (FND-008). (API_CONTRACT §2.3; CUSTOMER_PAGE §6)
- The apps are still the simple-UX Inc 1 screens, and the server now gives some Inc 1 calls their Inc 2 and Inc 3 answers until the Inc 2 and Inc 3 screens replace them: the driver's Unload (`SCAN_IN`) gets 403 `SCAN_USE_STORE_RECEIVE`, the driver's refill count steps 410 `REFILL_USE_SCANS`, the office's "Mark delivered…" without the named cylinders 400, and the legacy Refills "Mark complete" 410 `REFILL_AUTO_COMPLETES`. (API_CONTRACT §9.10, §9.12, §10.1, Appendix A)

## Test catalogue
- TEST_CASES.md and .csv are regenerated with the gates' case notes: 570 cases. (TEST_CASES "Summary")
  - Retired at Inc 2, their numbers left unused: FEE-030 (a wallet below zero can't exist after inc1b; WAL-023 and MIG-014 cover the rest) and ORD-018 (a shop without a store can't exist after inc1b; MIG-014).
  - ASG-009, ASG-010, ASG-012, ORD-014, ORD-015 and ORD-019 now read as their Inc 2 forms, and REF-008 as its Inc 3 form.
  - HLD-002 step 3 (the shop gets PERMISSION_DENIED, the office FEATURE_DISABLED); DAY-006, DAY-012, DAY-017, SET-011 and SET-012 as the Inc 3 gate listed; FND-001 and DAY-018 with this build's defaults (scanFlow, typedCylinderNumber and dayEnd on).
  - The fixture notes of CNF-014, CNF-018 to CNF-021, CNF-028, CNF-039, MIG-006 and MIG-015, the unit coverage of CNF-025 and MSG-002, and DRV-035 waiting for the driver app's test runner. REF-029 stays a manual drill and names its automated proof.
- Automated cases with a passing test: Inc 1 255 of 255, Inc 2 120 of 121 (DRV-035 has no test yet), Inc 3 43 of 43.

# Increment 3 server, 2026-10-24

The Increment 3 server is built: the inc3 migration, refills on QR scans that the store's receives complete, the system-made day-end sheet with its checked upload, the office's approve, send-back and reopen, and the pilot setup and reset CLIs. Each line below gives what building it settled and where the docs now say it; "code only" means the docs already said so. The money model is unchanged: the delivery cost is deducted when the order is placed and returned only on a cancel before delivery has started. No refill, receive, day-end upload, approval, setup or reset moves money; the only money the setup writes is an opening balance, once, through WalletService and only with `--test`.

## Migrations
- `20261024021613_inc3_refills_dayend` is diffed from a snapshot of the Inc 2 schema and hand-edited as §5.4 says: refill numbers, request keys and pickup and cancel times, one line per picked cylinder, the refill link on cylinder events, `is_test` on users, distributors and vans, the day and day-line tables, and the new enum values. Proven on a fresh database (no drift), on Inc 2-shaped data through `migrate.sh`, with the pre-check blocking, and with resolve-then-redeploy. (DATA_MODEL §5.5)
- The pre-check blocks while any refill is past PENDING and not finished, names at most 20 with "and N more", and gives the fix and the resolve command. Refill numbers are backfilled per shop by `(created_at, id)`, continuing after the higher of the highest number and the counter. (DATA_MODEL §5.5)
- The approval's fix (G09-03) is not a column: `deriveDayCloseFix` in shared-utils derives it from the stored values, so a blank cell means the app's value and Missing means LOST. Every new foreign key is RESTRICT. (DATA_MODEL §5.5; API_CONTRACT §10.2)

## Contracts and settings
- The Inc 3 contracts of API_CONTRACT §10 are in shared-types, shared-validation and shared-utils: the refill scan, advance and line types, the day-end DTOs and the sheet layout, the request schemas, the pilot setup file schema, the day-end sheet rules and the refill counts from lines. Every Inc 3 error code was already in the catalogue. (code only)
- The day-end row-error English is the shorter text of the screen spec, as in shared-types `DAY_END_ROW_ERROR_EN` (final.json DAY-006 and DAY-007 already expect it); `REASON_REQUIRED` keeps its 3-character rule. The shorter `REFILL_COUNT_REACHED` text was not applied, because REF-016 and REF-030 keep "All picked up: 2 of 2." (API_CONTRACT §10.2, §10.5; UX_MOBILE §8.3)
- `RELEASE_INCREMENT` is 3 and `dayEnd.enabled` defaults to `RELEASE_INCREMENT >= 3`, so day-end is on in this build; FND-001 expects `features.dayEnd` true, and DAY-018 switches it off with a PATCH first. (API_CONTRACT §6, §10.5)
- `custody/custody-moves.ts` is the custody extension point for the Inc 3 lanes: the scan service's own move write (with the refill link and the reason rule) and the one rule for "on an open refill line". (API_CONTRACT §10.5)
- `GET /admin/summary` adds the Inc 3 Today cards: `refills: { needsDriver, oldestNeedsDriverAt }` (PENDING refills) and `dayEnd: { toApprove, oldest }` (SUBMITTED days, left out while `dayEnd.enabled` is off). Both stay optional in `AdminSummaryDto`. (API_CONTRACT §10.5)

## Refills on scans
- Refills run on scans: pickup, fill, "Leave store" and "Leave station" (`POST /filling-orders/:id/scans` and `/advance`), numbered AG-R001 from the shop's own counter, with idempotent creates (a retry gets the first refill; the same key with other details is `IDEMPOTENCY_CONFLICT`). (API_CONTRACT §10.1, §10.5)
- The last store receive completes a refill in the same transaction, filled or not: SYSTEM `refill.complete` (`scan:store-receive`), no money. A filled cylinder comes back FULL. (API_CONTRACT §10.1, §10.5)
- The owner can cancel only before the first pickup; cancel and pickup lock the same row, so exactly one wins. (code only: API_CONTRACT §10.1)
- The Inc 1 count steps answer 410 `REFILL_USE_SCANS` and the office's complete 410 `REFILL_AUTO_COMPLETES`, after their ownership checks; `POST /reconciliations` answers 410 `RECONCILIATION_RETIRED`. Nothing changes and no money moves. (API_CONTRACT §10.1, §10.4, §10.5, Appendix A)
- Refill cylinders don't block a delivery trip's "Finish trip" or the 03:00 van check, but do block a van change; `GET /store/incoming` shows them as `came: REFILL` with the refill, and the cylinder history names the refill of each refill move. (API_CONTRACT §9.4, §9.9, §10.5)
- The refill `allowedActions` are listed: ASSIGN (office), CANCEL (owner), PICKUP, LEAVE_STORE, FILL and LEAVE_STATION (the assigned driver); COMPLETE and the Inc 1 step names are gone. (API_CONTRACT §1.6)
- One exception to "custody may call none": the store's receive of a refill cylinder calls `filling-orders/refill-receive.ts`, so the refill rows are still written only by their module. (API_CONTRACT §5.1, §10.5)

## Day-end
- Day-end is built: the system-made sheet with one row per cylinder (and a very hidden "About"), the checked upload with its preview of every difference, the submit, and the office's approve (every listed fix in one transaction, skipping cylinders moved since the sheet), send-back and reopen. No money, and no scan is ever refused. (code only: API_CONTRACT §10.2; DATA_MODEL §5.3, §5.4)
- No job creates OPEN days: the first sheet download does, so two downloads at once make one row (G09-10). (API_CONTRACT §10.5)
- The summary's counts, the clock, the upload refusals the contract didn't name (no file, another field, encrypted, ZIP64 or 2,000-entry archives), the row rules, the lines, the approval's skip, the DTO fields and the sheet file's headers are written down as built. (API_CONTRACT §10.5)
- An approved "In my store" fix of a cylinder still on an open refill line brings it back for its refill, as the store's receive would: the line is RETURNED and the last one completes the refill (SYSTEM `day-end:approve`). A state or Missing fix keeps the holder, so the line stays open until the store receives the cylinder. (API_CONTRACT §10.5)
- `FilesService.storeGenerated` and `discardObject` store and clean up the day-end workbooks with the files module's private client, so the shop is the uploader of both files and the office opens them through `GET /files/:id/url`. (API_CONTRACT §10.5)
- The Today card counts the days waiting for approval (`AdminSummaryDto.dayEnd`). (API_CONTRACT §10.5)

## Pilot setup and reset
- `npm run pilot:setup` checks the whole file first, then writes it all or nothing in one transaction through the services, with their rules and audit rows; it writes a labels CSV (`--labels`), prints 12-character one-time passwords once at the end, and follows the `--test` rules. `docs/pilot/pilot-setup.sample.json` is the documented example; `pilot/test.json` and `pilot/rehearsal.json` (without Sana and Usman; ops fills in the team's real test phones) are in the repo. (API_CONTRACT §10.3, §10.5)
- `npm run pilot:reset` plans the deletion from its map of the data model, refuses when a kept row points at test data, deletes only with `--yes`, guards production with `--allow-production --confirm-db`, and writes one `pilot.reset` row. (API_CONTRACT §10.3, §10.5)
- The npm scripts `pilot:setup` and `pilot:reset` run the CLIs, which also compile into the image (`node dist/modules/pilot-setup/cli/…`); `pilot-labels-*.csv` is git-ignored. `seed:demo` stays, refusing to run. (code only: API_CONTRACT §10.3)

## Test cases for the catalogue (final.json is the source; TEST_CASES.md is regenerated from it)
- Every automated Inc 3 case has a test named by its id: REF-013 to REF-024, REF-030 and REF-031 in `apps/api/test/inc3/refills/` (refill-requests, refill-scans, refill-receive, refill-delivery and refill-retired `.e2e-spec.ts`, plus refill-mapper.spec.ts) and `test/inc3/db/`; DAY-001 to DAY-018 in `test/inc3/dayend/` (day-end.e2e-spec.ts: DAY-001 to 006, 008 and 016 to 018; day-end-approve.e2e-spec.ts: DAY-007 and 009 to 015); SET-003 to SET-012 in `test/inc3/setup/` (pilot-setup, pilot-reset and tenant-leak `.e2e-spec.ts`); FEE-028 in `test/inc3/gate/refill-dayend.e2e-spec.ts`. To update in final.json: these `testFile` paths, and "Not automated yet." on each.
- To update in the case texts: DAY-006 step 3 (with no upload the version is 0, which the schema refuses with 400; the test sends version 1 and gets `DAY_SHEET_NOT_UPLOADED`); DAY-012 (the approval may win the race, and then the load is refused with `SCAN_NOT_FULL`); DAY-017 (at 02:30 the 22nd isn't a business date yet; after the cut-off moves to 00:00 the 02:30 receive counts for the 22nd); SET-012 step 3 (the order body needs a place, `deliveryLocation` in South); SET-011 step 5 (the "copy" of live is a scratch database whose name contains "test").
- REF-029, the migration refusing an in-flight refill, also has an automated proof in `test/inc3/db/inc3-precheck.e2e-spec.ts`.
- The Inc 1 REF-008 runs its Inc 3 form (the count steps and complete answer 410, nothing changes, no money); the Inc 2 assertions that pinned the Inc 2 build (dayEnd off, the Inc 2 schema) now state Inc 2 facts as "Inc 2 or later" and compare the Inc 2 release with its own schema.

# Increment 2 server, 2026-10-23

The Increment 2 server is built: the inc1b and inc2 migrations, scans with the one-holder rule (load at the shop's store, hand over, take back, could not deliver, the store's receive), the office's manual delivery naming the cylinders, runs that finish with an empty van, and the customer's confirmation link with its cases and message log. Each line below gives what building it settled and where the docs now say it; "code only" means the docs already said so. The money model is unchanged: the delivery cost is deducted when the order is placed, it is returned only on a cancel before delivery has started, and no delivery, take-back, receive, customer answer, case or job moves money.

## Migrations
- inc1b and inc2 ship in the same deploy, the first of Increment 2. Finish every run in progress with the Increment 1 apps first; if the inc2 pre-check still blocks, inc1b is already committed and the Increment 1 code runs fine on it. (DATA_MODEL §3.5; API_CONTRACT §8.5 step 9)
- The inc1b pre-checks name at most 20 rows with their fix, and the re-derive step is written so the `SET NOT NULL`s can't fail and can run again: `legacy:<id>` ledger keys, expense types with the archived `LEGACY_<CAT>` fallback, order and request numbers continuing from the higher of the highest number and the counter, and the next free D-code. (DATA_MODEL §3.5)
- `stop_cylinders_return_state_chk` also requires `return_state IS NOT NULL` for a taken-back row, since a CHECK passes when its expression is NULL. (DATA_MODEL §4.4)
- The inc2 pre-check names the runs in progress. `DeliveryConfirmation` has its `order` relation, and the Cylinder-to-events relation is named `CylinderEvents` beside `CylinderLastEvent` (no DDL change). (DATA_MODEL §4.3, §4.4)
- `npm run db:new-migration` takes `--base-file <schema.prisma>`, for a migration on top of one not yet committed (inc2 was diffed from the inc1b schema that way). (DATA_MODEL §2.4)

## Scans, visits and runs
- The shapes §9.3 left open are fixed: `TripSummary`, `VanCounts`, `StoreStockDto`, `ScanResult.stop` null for store scans, and `GET /trips/:tripId` as `TripDetailDto` with stop titles, progress, the van and the trip's buttons. (API_CONTRACT §9.12)
- A typed scan while typing is off answers 403 `FEATURE_DISABLED` without `details.progress`; the catalogue keeps `progress` on scan and refill codes only. (API_CONTRACT §9.12)
- The first LOAD marks the store stop arrived; unlabelled returns take any known size; a short take-back's reason is kept on the stop; finishing a visit the office already closed is 409 `ORDER_INVALID_TRANSITION`. (API_CONTRACT §9.12)
- The installed 0.1.0 driver app can still finish an order that expects returns: the Delivered tap needs the hand-overs, leaves a short visit open for the empties, and the legacy depart records the shortfall with `oldApp: true`. (API_CONTRACT §9.12, Appendix A)
- After a forgotten IN, the office's manual delivery may hand a cylinder straight from the store; "Done loading" counts it as handed over on the trip, so the run can still close. (API_CONTRACT §9.3, §9.12)
- `PATCH /drivers/:id/vehicle` is refused with 409 `VEHICLE_HAS_CYLINDERS` while either van holds a cylinder, before anything is written; giving the same van again stays `X-Already-Applied`. (API_CONTRACT §9.5, §9.12)
- `GET /inventory/my-vehicle` is counted from cylinders and adds the part-filled counts. (API_CONTRACT §9.12, Appendix A)

## Store and office
- `POST /store/scans` and `GET /store/incoming` count "received today" by business day, name the van's run and driver, and list only vans with something left; store receives carry no trip, so a hand-back never blocks a driver change. (API_CONTRACT §9.12)
- Manual delivery v2 names one problem per cylinder in a fixed order, counts a cylinder the driver already scanned on the visit as named, and audits each move; the audit diffs of the Inc 2 actions are written down. (API_CONTRACT §9.12, Appendix B)
- `PATCH /clients/:id` is built for the owning shop: name, phone and notes, one `client.update` row per change, `confirmationNeedsNewLink` only when the phone changed while a link is pending. (API_CONTRACT §9.4, §9.12; TEST_CASES CUS-013)
- `GET /admin/summary` adds `problems: { open, oldestOpenAt }`. (code only: API_CONTRACT §7.13)
- `VAN_NOT_EMPTY` is raised on the van (resourceType `Vehicle`), one OPEN or ACKNOWLEDGED alert per van through the alerts module's dedupe, and the 03:00 van check writes no audit row. (API_CONTRACT §9.9, §9.12)

## Customer confirmation, cases and messages
- Every order answer to the shop and the office carries `confirmation` (null when there is none); a driver's never does. (API_CONTRACT §9.7, §9.12)
- `ConfirmationService` is named and placed as built, takes the stop when issuing, and adds `sendIssued`, `summariesFor`, `hasPendingForClient` and `expireDue`; the link-token rules live in one file the boot guards also use. (API_CONTRACT §5.9)
- The link page sits outside `/api/v1` with a two-entry prefix exclusion, so the app-wide request id and log reach it. (CUSTOMER_PAGE §5)
- The page's files, its three additions to the copy and layout, the answer's lock and the case's dedupe are written as built. (CUSTOMER_PAGE §6, §7)
- The message log keeps the link's host in `bodyRedacted`, names the live provider even when test mode skips, and sets `sent_at` only on SENT; retention has no job yet. (CUSTOMER_PAGE §8, §12)
- An expired pending link reads EXPIRED before the job stores it; the case resolve, the share replay and the view's customer fields are written as built. (API_CONTRACT §9.12)

## Deploy
- From Inc 2 the boot guards require `PUBLIC_LINK_BASE_URL` (https) and `CONFIRM_LINK_SECRET` (32 or more characters) and check `MESSAGING_PROVIDER`; the env templates and the deployment notes carry all three. (API_CONTRACT §3.7; docs/deployment.md)
- The Caddyfile redacts link tokens in the access log and leaves the link page's own headers alone; a commented block is ready for a short link domain. (CUSTOMER_PAGE §5)

## Test cases for the catalogue (final.json is the source; TEST_CASES.md is regenerated from it)
- Retired at Inc 2, with their Inc 2 forms where they exist: ORD-018 (a shop without a store can't exist after inc1b; MIG-014 covers it), the EXP-012 test of a row with only a category (covered by the inc1b re-derive), the WAL-016 negative-balance test, and FEE-030 with REV money-data-02 N1 and N1b (FEE-030 is money-data-03 N2; inc1b refuses balances below zero, so their legacy wallet can't exist; the website's reading of such an answer stays covered by the money-data-02 unit test), the Inc 1 forms of ASG-009, ASG-010, ORD-014, ORD-015 and ORD-019 (their "(Inc 2)" forms run), and REV contract-compat-02's hand-over without a load (refused now; ASG-012 (Inc 2) covers the driver change).
- REV robustness-ops-01's first test runs on an inc1a-level scratch database. MIG-006's API step (cancelling the old open orders) runs after the copy has gone through the Inc 2 release, since from Inc 2 the API runs only on the current release.
- The case texts with the shortened English (DRV-012, DRV-021, DRV-027, DRV-029, DRV-032, HLD-002, HLD-003, HLD-012) and the customer page's copy (CNF, CAS, MSG) already match final.json. To update: HLD-002 step 3 expects 403 `FEATURE_DISABLED` for both callers, but §3.4's order of checks gives the shop (never a role of `POST /transfers`) 403 `PERMISSION_DENIED`; only the office gets `FEATURE_DISABLED`, as the test asserts.
- Fixture notes for the case texts: CNF-014 and CNF-018 post more often than the per-link limit of CNF-026 allows, so their tests clear the limiter or set it aside; an "expired" link in CNF-019, CNF-020 and CNF-021 moves `delivered_at` with `expires_at`, and CNF-019's link D is expired by the job before C is moved; CNF-039 step 4 fails the update with a temporary trigger; CNF-028 checks Sentry through `initSentry`'s `beforeSend` and `beforeBreadcrumb`.
- CNF-025 (token rules) and MSG-002 (the mock never logs text or link) also have unit coverage in test/inc2/db/inc2-contracts.spec.ts. DRV-035 (the driver app's scan reducer) waits on the driver app's test runner.

# Simple UX pass, 2026-10-23

Every Increment 1 screen of the shop app, the driver app and the office website was rebuilt to one rulebook, UX_PRINCIPLES.md, and the Inc 2 and Inc 3 screens are designed to it before they are built. The theme is unchanged: no token, colour or font changed. The money model is unchanged: the delivery cost is deducted when the order is placed, it is returned only on a cancel before delivery has started, refills carry no money, and customer confirmation is a record only. Where the four UX specs and the lead's decisions of 2026-10-23 differ, the lead's decisions win; the lines below say where.

## Rulebook and doc map
- UX_PRINCIPLES.md is the rulebook: the 16 rules, which control to use, status words and colours, one word for each thing, banned words, word budgets, phone and website layout, driver mode and the "Definition of simple" checklist. It carries the lead's decisions: one connection message on every surface ("No connection · Try again"; the website's banner "No connection."; never "No internet", because the same message shows when the server is down), the labelled 200 px sidebar at 1024–1279 px with no icon rail, and settled point G07-23 kept (Yes green, Partly and Other amber with the warning icon, No red, Pending the amber clock). (UX_PRINCIPLES §2–§10)
- README lists UX_PRINCIPLES.md in the doc table. It ranks above UX_MOBILE, UX_ADMIN and CUSTOMER_PAGE on look, feel, layout and copy, and below them on behaviour, money and safety. (README)

## Shared texts and API
- Error texts, each 12 fixed words or fewer: FEATURE_DISABLED "This isn't available yet."; CLIENT_PHONE_INVALID "Enter a number like 300 1234567."; ORDER_CANCEL_TERMS_CHANGED, TOPUP_BANK_REFERENCE_USED and TOPUP_AMOUNT_MISMATCH shortened; the 8 driver scan texts; ASSIGN_DRIVER_NOT_AVAILABLE says "trips", not "jobs"; CASE_ALREADY_RESOLVED "This problem was already sorted by {{by}}."; REFILL_COUNT_REACHED "All picked up: {{requested}} of {{requested}}." (it reads right for 1, settled point G16-04); DAY_SHEET_OUTDATED "This is an old copy. Download a new sheet and use that."; NETWORK_OFFLINE "No connection. Try again.". A unit test holds every error text to the budget and keeps out "pilot", "case" and "No internet" (UXQ-026). (API_CONTRACT §2.3; UX_PRINCIPLES §5.3, §6)
- `formatClock` in shared-utils writes setting times as people say them ("9 pm", "9:30 pm", "12 am"): the shop app's top-up checking hours and the website's Settings times ("New day starts at", the checking hours). (UX_MOBILE S3; UX_ADMIN §2.8)
- `AdminWalletRow.lowBalance`: GET /admin/wallets flags each wallet by the shop's rule (strictly below `wallet.lowBalancePaisa`; Rs 0 turns the warning off), and the Wallets list shows a red "Low" chip from it. (API_CONTRACT §7.8; UX_ADMIN §2.6; WAL-004, WAL-008)
- GET /zones/city/:cityId is documented as `ZoneListRow` with `polygon` and `centroid`, so the website's maps draw the zone outlines. The API's answer is unchanged. (API_CONTRACT §7.2; CUS-011)

## Phone UI kit
- Phone UI kit for the simple-UX redesign: PickerSheet, ChoiceChips (moved), AddMore, Fab, CountBar, ActionLine; Button dangerOutline; ConfirmSheet pinned buttons with Why?/Pick a reason.; AmountChips Other amount; PhoneField +92 fixed; Timeline stopped; one No connection banner with Try again; Saved {{time}}; status tones; office contact and last sign-in number kept on the phone; sign-in and gate copy. (UX_MOBILE §2.1, §2.2, §3.4, §3.6, S1; UXQ-013, UXQ-015, UXQ-022, FND-011)

## Shop app (Inc 1)
- Every shop screen was rebuilt: Home with one wallet card ("Add money", a "Low balance" chip, "Saved {{time}}"), "Get started" for a new shop and four tiles (My orders, Customers, History, Refills); Add money in 3 steps with amount chips, "Pay Rs X" with a copy icon and "Name on the account" with a helper per channel; History; a new Customers screen (search, Recent, a call button on each row, "+ Add customer"); Add customer with House and street on step 1 and one cost line under the map; New order that moves on with a tap, one summary card and a one-line refund rule; My orders and order detail with one facts card, "Call driver" as the footer and the cancel inside the content; the cancel sheet "Cancel · get Rs X back" or "Cancel without refund"; Profile and Help; Refills split into a list and New refill. (UX_MOBILE §4 S1–S12b; WAL-002, WAL-003, WAL-022, TOP-009 to TOP-012, FND-004, CUS-007 to CUS-009, CUS-014, ORD-003 to ORD-007, FEE-007, FEE-008, FEE-017, FEE-025, PRC-015, REF-009, UXQ-001, UXQ-004, UXQ-006, UXQ-010, UXQ-012, UXQ-014, UXQ-024, UXQ-025, UXQ-027)
- The lead's decisions in the shop app: History rows show the kind as the title ("Delivery cost", "Top-up", "Refund", "Office correction", "Opening balance", "Older entry"), the number and customer on the grey line and the amount on the right, with no "Balance after", and the filters are All · Top-ups · Delivery costs (UX_MOBILE S7; WAL-006, WAL-025); New order counts start at 0, with a "Same as last time" chip (UX_MOBILE S9; ORD-022); "Other" is no longer a way to pay, and "Tell us again" reopens Tell us you paid, prefilled (UX_MOBILE S5, S6).
- Key names that differ from the shop spec: `topup.howToPay.app.transfer`, `topup.tellUs.payerNameHelp.EASYPAISA_APP` / `.BANK_APP` and `wallet.history.subjectLine`. New keys: `wallet.history.topupTitle`, `.lineWithReason`, `customers.cost.perCylinder`, `refill.request.submitNoSize`, `home.tiles.ordersA11y`, `home.getStarted.done` and `home.profile.rowA11y`. Deleted: `customers.address.none` and `orders.new.noCustomers`. New routes Customers, NewAddress, Refills and NewRefill; PickAddress and RequestFilling are retired. (UX_MOBILE S2, S4, S5, S7, S8, S12, S12b, Appendix A)

## Driver app (Inc 1)
- Words: "Trip" everywhere, never "job"; "Unload", never "Hand back"; "Not delivered" and "Cancelled" replace "Skipped". (UX_MOBILE §0, §3.4; DRV-046, DRV-048)
- Today: the business date as the title, the current trip first, "Done today" and one "Start trip" or "Continue trip" button. (UX_MOBILE §5; DRV-045)
- The step screens hold the camera, and the scan screen is gone. The Inc 1 tally counts the cylinders the server confirmed ("0 of 3 scanned", "All 3 scanned") and never blocks: an early "Done loading" or "All delivered" asks "Only {{done}} of {{total}} scanned. Continue?" with "Keep scanning". A new Unload step counts the van down to "Nothing on the van.". (UX_MOBILE §5; UX_PRINCIPLES §9.2; DRV-006, DRV-051, DRV-054)
- "Call {{name}}" on the way to the customer and at the door; leftover reasons are picked by tap when finishing a trip. (UX_MOBILE §5)
- Refills: a list and one refill with steppers, no money. Help has the profile merged in (name, mobile and van; no licence number). (UX_MOBILE §5; DRV-052, DRV-053)
- The 8 driver error texts and the shared phone kit pieces (one connection banner, the action line above a button, Saved {{time}}) apply to every driver screen. (API_CONTRACT §2.3; DRV-012, DRV-021, DRV-025, DRV-027, DRV-029, DRV-032, DRV-036, DRV-042, HLD-003, HLD-012, UXQ-002, UXQ-007, UXQ-028)

## Office website (Inc 1)
- Shell and components: a labelled sidebar (232 px from 1280 px, 200 px at 1024–1279 px; no icon rail, no breadcrumbs), Work, Money and a Setup toggle, one account row, no top bar from 1024 px, the Today badge kept (top-ups to check + orders needing a driver), toasts at the top centre for 6 seconds; the new kit pieces FilterChips, ToggleChip, DateChips, AddMore and SearchSelect, and drawers with at most 4 footer buttons and no Cancel. (UX_ADMIN §1.3, §1.4, §1.5, §1.9; UXQ-003, UXQ-008, UXQ-017, UXQ-020, UXQ-029, OFF-003, OFF-012, SEC-030)
- Today: cards with a count and one button (top-ups, orders, one Prices card, one Distributors card), "All caught up." when nothing waits, and 5 "Today so far" tiles. (UX_ADMIN §2.1; OFF-003, RHS-019)
- Top-ups: the page is "Top-ups"; the review drawer has two columns ("From Ahmed Gas" and "In the company bank app"), date chips with no default, a main button that points at what is missing, and reject reasons in two columns. (UX_ADMIN §2.2; TOP-010, TOP-014, TOP-017, TOP-018, TOP-022, TOP-023, TOP-024, TOP-029, RHS-003)
- Wallets: the red "Low" chip, one balance card with "History adds up" or a banner, "Record correction…" disabled only when the history doesn't add up ("Fix the history first."), and the correction in two steps in one dialog. The website keeps "Balance after" for the office. (UX_ADMIN §2.6; WAL-009, WAL-015, WAL-023, SET-002)
- Delivery prices: distributor chips, one line for a missing price, one "Per cylinder" column, and an example that shows only once a base is typed. (UX_ADMIN §2.3; PRC-016, PRC-019)
- Distributors: list columns with a price chip, a suggested code, a map with the zone outlines, the waiting checklist, and Suspend with 4 points and "Why?". (UX_ADMIN §2.4; OFF-007, OFF-017)
- Orders: the tab "Cancelled or not delivered", the drawer's cost rows and outcome line, and footer buttons with no More menu: Cancel order…, Mark delivered… (with "No money moves."), Could not deliver… and Assign or Change driver. Office notes stay required on cancel and could-not-deliver. (UX_ADMIN §2.5; ORD-008, ORD-013, FEE-018, ASG-011, RHS-007, RHS-010, UXQ-005)
- Expenses: date chips, type chips, AddMore, remove with reason cards, and the fuel card only when logs exist. (UX_ADMIN §2.7; EXP-015, EXP-016, EXP-017)
- Settings: Money · Orders and delivery · Features · Support · Company account · Tech team, no "Default" lines, "Not saved" on an edited row, and a feature turned on only in the save review. (UX_ADMIN §2.8; OFF-009, SEC-021)
- Activity log: What chips, a Who list and date chips on business days, rows grouped by day, and rows that open their record. (UX_ADMIN §2.9; OFF-011)
- Sign-in: "+92" fixed, a wrong password empties the password box, "Try again in m:ss" after too many tries, and a second line for the wrong-app error. (UX_ADMIN §2.10; OFF-001)
- Legacy screens (Refills, Live map, Drivers, Vans, Zones, Refill stations, Cylinders & labels, Alerts, My profile): a light pass with the list first, add in a drawer, labelled actions and no raw codes, in a new `legacy` namespace. (UX_ADMIN §2.11; REF-010, OFF-012)
- Shared error text on the website: the sign-in, top-up and assign errors use the shortened catalogue texts above. (API_CONTRACT §2.3; TOP-017, TOP-018, ASG-003, OFF-016)

## Customer page and the Inc 2 and Inc 3 designs
- The customer link page: the test strip "Test only · not a real delivery", inline SVG icons on the answer buttons, the call row, "Answer by …", "Please tap one answer below." and the closed page "This link is closed". The office and shop status lines use "·" ("Not sent · text messages are off", "Text didn't send · the number looks wrong") and the toast "Link copied". The answer tones keep settled point G07-23. (CUSTOMER_PAGE §4–§10; DECISIONS ADR-15; CNF-007, CNF-047, MSG-021, UXQ-031)
- Inc 2 and Inc 3 screens are designed to the rulebook before they are built: the full ScanPanel and the driver steps R2–R10, Receive from driver, Customer problems and Edit customer in the shop app, Refills and Day-end on both apps, and on the website the order drawer additions, Customer problems, "Mark delivered…" naming each cylinder, Find cylinder, the Inc 2 settings ("Answers that open a problem", "How long the link works", "Team phones"), Refills and Day-end approvals (tabs To approve · Open · Approved). (UX_MOBILE §7, §8; UX_ADMIN §3, §4; CNF-045, UXQ-032, UXQ-033)

## Test catalogue
- TEST_CASES.md: 178 cases now quote the new screens and texts, and 15 new cases were added (CUS-014, ORD-022, DRV-051 to DRV-054, UXQ-025 to UXQ-033, with UXQ-027 to UXQ-033 walking the "Definition of simple" checklist on each surface). 20 settled spec points quote the current words. Every earlier ID is kept: the catalogue as published before this pass pins them, next to v1. A case whose note names a describe block ("Its tests are the describe …") lists the files that hold it. The catalogue has 572 cases. (TEST_CASES "How to run the automated tests", "Spec questions and how they were settled")

## Superseded review-fix lines
- web-ux-02: the docked sidebar is one viewport high (there is no rail any more); web-ux-07: the price example no longer asks for a base, it shows once a base is typed; mobile-ux-04: the wallet filters are three chips in one grid (All · Top-ups · Delivery costs); mobile-ux-05: the History rows decision closes its open wallet-row question.

# Review fixes, 2026-10-23

The Increment 1 review reported 47 findings. The verifier confirmed 43 and refuted 4 as documented behaviour (money-data-08, robustness-ops-12, robustness-ops-13, mobile-ux-01), which are unchanged. Each line below gives how one confirmed finding was fixed and where the docs now say it; "code only" means the docs already said so. The money model is unchanged: the delivery cost is deducted when the order is placed, it is returned only on a cancel before delivery has started, and refills carry no money.

- money-data-01: A driver change after the driver reached the customer keeps the order started: the first arrival at any of its delivery stops counts, on any trip, so nothing is refunded and "Could not deliver" stays available. (API_CONTRACT §5.5; DECISIONS ADR-07)
- money-data-02: On the office website, a wallet below zero whose history matches reads "below zero" with "Record correction" kept on, since a correction is the documented fix. Only a real history mismatch (`differencePaisa` isn't "0") disables it, and `integrity.ok` keeps its nightly-check meaning. (UX_ADMIN §2.6; TEST_CASES G01-06, WAL-009)
- money-data-03: `WALLET_INSUFFICIENT_BALANCE` states the real balance (below zero for a legacy wallet) and the real shortfall, as the quote does. (API_CONTRACT §2.3)
- money-data-04: A delivery price is read with its per-size amounts in one SQL statement, so a quote or an order never mixes the base of one version with the amounts of another. (code only: API_CONTRACT §4; DECISIONS ADR-08)
- money-data-05: Two copies of one top-up request (the same Idempotency-Key) use one AG-T number: the twin is answered under the distributor's lock before a number is taken. (code only: DECISIONS ADR-22)
- money-data-06: Parallel load scans keep the store's inventory lots right: each lot count changes in one guarded statement, never by read-modify-write. (code only: API_CONTRACT §4)
- money-data-07: The wallet history's date presets count from the business date (03:00 cut-off), because the statement reads `from`/`to` as business days; Expenses keep calendar dates. (UX_ADMIN §2.6; API_CONTRACT §7.8; DECISIONS ADR-21)
- security-01: `GET /orders/:id/tracking` gives the shop `driverLocation` only while its order is on the way; otherwise it is null, with the same shape. (API_CONTRACT §7.6, Appendix A)
- security-02: An open office socket on `/drivers` is dropped when its access token expires, at once when a change through the API ends its user's session, and within 60 seconds otherwise; a driver's socket is re-checked, expiry included, on every message. The office website then refreshes its token and reconnects. (API_CONTRACT §7.14, §8.6; TEST_CASES SEC-015)
- security-03: No token is issued to or accepted from a DISTRIBUTOR or DRIVER without its shop or driver row (sign-in 403 `AUTH_ACCOUNT_NOT_ACTIVE`, refresh and every request 401 `AUTH_SESSION_REVOKED`), every scoped route answers 403 `PERMISSION_DENIED` before any read, and the office can't give such a login a password or make it ACTIVE. (API_CONTRACT §3.2, §3.3, §7.1, §7.2, §8.5)
- security-04: An early `online:set` is dropped when the driver's session ended meanwhile, and a driver whose user isn't ACTIVE can't go online. (API_CONTRACT §7.14)
- contract-compat-01: While a module is off, a GET of one record answers 403 `FEATURE_DISABLED` with `X-Feature-Disabled` and lists keep `[]`; next suggestions leave out transfers; open transfers are closed before inc1a and counted at go-live. (API_CONTRACT §3.4, §7.7, §8.5; TEST_CASES SEC-020)
- contract-compat-02: A hand-back (SCAN_IN) of an earlier run's empties no longer blocks a driver change or keeps an idle trip open; REASSIGN is offered exactly when assign-driver accepts it, so not once a cylinder was handed to or taken from the customer. (API_CONTRACT §1.6, §7.6; DATA_MODEL §3.6 cancel step 5; UX_ADMIN §2.5)
- contract-compat-03: A cursor carries the tag of the list and tab that made it, and every other list refuses it with 400 on `cursor`. (API_CONTRACT §1.3)
- contract-compat-04: shared-types has `SafeUserDto`/`MeDto` and `TripViewDto`/`TripStopDto` for `GET /users/me` and `/trips/*`, and both apps type those routes with them. (API_CONTRACT §7, §7.7)
- robustness-ops-01: Rolling back past a migration is a forward fix or a restore of the pre-deploy snapshot, which deploy.sh now takes on prod and waits for before migrating. (DATA_MODEL §1, §2.5, §2.6; API_CONTRACT §8.5)
- robustness-ops-02: deploy.sh runs exactly the image it built (`smartfleet-api:<sha>`, per service) and waits until `GET /health` reports that commit as `version`. (DATA_MODEL §2.5; API_CONTRACT §7.2, §8.5)
- robustness-ops-03: The env file is checked against the boot guards (the boot preflight) before any migration, on AWS and on Railway, and the switch-over updates both env files first. (API_CONTRACT §3.7, §8.5; DATA_MODEL §2.5)
- robustness-ops-04: `CORS_ORIGINS` must be real website origins; the templates carry `REPLACE_` placeholders, which the boot guards refuse; the Caddyfile serves the smartfleetpk.com hosts; the API logs its CORS origins at boot. (API_CONTRACT §3.7, §8.5)
- robustness-ops-05: A deploy's shutdown lets in-flight requests finish: the database and Redis clients close only after the HTTP server has drained, and compose gives each API service 30 seconds to stop. (code only)
- robustness-ops-06: A value Postgres can't store or compare (a NUL character, a date outside the years 1–9999) answers 400 `VALIDATION_FAILED` instead of 500. (API_CONTRACT §1.3, §2.2)
- robustness-ops-07: A body the parser refuses (too large, aborted, an unknown charset or encoding) answers 400 `VALIDATION_FAILED`, logged at debug and never sent to Sentry. (API_CONTRACT §2.2)
- robustness-ops-08: Placing an order waits at most 1.5 seconds for the auto-dispatch enqueue, so Redis being down never holds up the answer. (API_CONTRACT §7.6)
- robustness-ops-09: deploy.sh takes a branch, a tag or a full commit SHA, and promote-prod takes only a full SHA. (DATA_MODEL §2.5, §2.6; API_CONTRACT §8.5)
- robustness-ops-10: CI runs on every branch; deploy-staging deploys the SHA whose CI passed, and promote-prod requires that SHA's green CI and successful staging deploy. (DATA_MODEL §2.5; API_CONTRACT §8.5)
- robustness-ops-11: The staging smoke suite checks `POST /auth/otp/send` (403 `AUTH_OTP_DISABLED`), `GET /app/config`, the deployed version and a CORS preflight from the website origin. (API_CONTRACT §8.5)
- robustness-ops-14: While Redis is down, each BullMQ queue and worker logs one warning a minute through the Nest logger, never a stack dump per reconnect. (API_CONTRACT §3.6)
- robustness-ops-15: Logs are JSON lines through pino with `LOG_LEVEL` and redaction, and every request writes one line with its requestId. (API_CONTRACT §2.2)
- web-ux-01: The Settings page shows its side menu with the panel beside it at 1024 px and wider, and the Section select only below 1024 px. (code only: UX_ADMIN §2.8)
- web-ux-02: The docked sidebar or rail is one viewport high: its list scrolls inside it and My profile and Sign out stay in view on long pages. (code only: UX_ADMIN §1.3)
- web-ux-03: The page never scrolls sideways at 768 px: the prices grid hides Status (priority 2), and a table's visually hidden header can't widen the page. (code only: UX_ADMIN §1.3, §2.3)
- web-ux-04: The tab title's "(n)" is the Today badge: top-ups to check + orders needing a driver (+ open problems from Inc 2). Missing prices and distributors waiting to start are Today cards only. (UX_ADMIN §1.3)
- web-ux-05: Toned table rows keep their sticky first column when the table scrolls sideways. (code only: UX_ADMIN §1.3, §1.5)
- web-ux-06: The menu button shows only below 1024 px. (code only: UX_ADMIN §1.3)
- web-ux-07: The price drawer's live example waits for a base per order: "Type the base per order to see an example." (UX_ADMIN §2.3)
- mobile-ux-02: "Back to home" on the top-up status screen goes straight to Home; a New order left under it closes without asking, and its draft is dropped. (UX_MOBILE S6)
- mobile-ux-03: The cancel and "Could not deliver" sheets fit above the Android keyboard and scroll, so the note and the confirm button stay reachable. (code only: UX_MOBILE §2.2 #19, §6)
- mobile-ux-04: The wallet history filters sit in two rows of two, so all four show on a 360 dp phone. (UX_MOBILE S7)
- mobile-ux-05: The driver's trip and stop rows put the step chip under the text, so the customer's name keeps the row's width; the wallet rows wait for an owner decision. (UX_MOBILE §2.2 #13, §5)
- mobile-ux-06: A background refresh that fails or recovers no longer rebuilds the screen: an open sheet keeps its reason, note and spinner, and a stepper keeps its count. (code only: UX_MOBILE §2.2 #16)
- mobile-ux-07: The password Show/Hide button is a full 48 / 56 dp target. (code only: UX_MOBILE S1, §2.1)
- mobile-ux-08: "Save customer" and "Save address" are enabled once the pin is priced, and "Send for checking" once the amount is valid; an empty house or payer name shows its message on press. (UX_MOBILE S5, S8)
- mobile-ux-09: My orders' "Active (n)" counts the polled rows once the active list is fully loaded. (code only: UX_MOBILE S10)

# Spec changes, 2026-10-22 (reconciliation after the test-case review)

Writing the 513 test cases (TEST_CASES.md) turned up 158 gaps and contradictions in these docs. Each line below gives how one was settled and where the docs now say it. The money model is unchanged: the delivery cost is deducted when the order is placed, it is returned only on a cancel before delivery has started, refills carry no money, and customer confirmation is a record only.

## Defaults the owner may change
- G04-02: The refund rule (`orders.deliveryStartedAt`) is read when a cancel is decided and isn't stored on the order, so a settings change applies at once to orders already placed that haven't started. (API_CONTRACT §5.5; UX_ADMIN §2.8; DECISIONS ADR-07)
- G04-03: Only a cost this platform deducted at placement can be refunded; an order the old code charged before the switch-over refunds nothing on a cancel. (API_CONTRACT §5.4, §5.5, §8.1; DATA_MODEL §3.4, §3.6; DECISIONS ADR-07)
- G05-04: Once anything was loaded on the order's trip it can't change driver, even after the store scans it back in; the message no longer suggests a scan-in. (API_CONTRACT §2.3, §7.6; DECISIONS ADR-12)
- G05-08: Typed scans are refused (403 `FEATURE_DISABLED`) while `custody.typedEntry.enabled` is off; a typed cylinder number may be 42, 0042, C0042 or AG-C0042 in any letter case, within the run's distributor. (API_CONTRACT §1.1, §6, §9.2; DATA_MODEL §4.2)
- G06-01: Unlabelled and other-brand returns count as taken back but never get a holder; their PUT replaces the stop's whole list, and a count of 0 keeps no row. (API_CONTRACT §9.3; DATA_MODEL §4.3, §4.4; DECISIONS ADR-13)
- G06-02: The responsible driver is the driver of the latest move onto a van since the cylinder last entered a store; there is none while it is in a store. (API_CONTRACT §9.2, §9.4; DATA_MODEL §4.2; UX_ADMIN §3.2, §3.5; DECISIONS ADR-13)
- G06-05: Returns always go into the cylinder owner's one store, received by the owner; "the driver chooses the store" needs no choice while each distributor has one store. (API_CONTRACT §9.2; DECISIONS ADR-13; README)
- G07-07: Switching `confirmation.enabled` off answers the confirmation routes 403 and known links 410 "This link is no longer active", deletes nothing, and switching it on never back-fills. (API_CONTRACT §9.7, §9.9; CUSTOMER_PAGE §10; DECISIONS ADR-15)
- G08-07: A refill completes when every picked cylinder is back in the store, filled or not; both apps show how many were filled. (API_CONTRACT §10.1; UX_ADMIN §4.1; DECISIONS ADR-16; README)
- G08-08: A refill pickup makes the refill's driver the responsible driver; a fill doesn't change that, and the store's receive scan ends it. (API_CONTRACT §9.2, §10.1; DECISIONS ADR-13)
- G09-03: Day-end approval applies every fix the sheet can name (move into the store, state change, Missing, a new cylinder); "On driver's van" or "With customer" changes nothing and is checked by hand. (API_CONTRACT §10.2; DATA_MODEL §5.1, §5.4; UX_ADMIN §4.3; DECISIONS ADR-17)
- G11-13: The seeded logins are suspended or archived at the switch-over, and `prisma/seed.ts` refuses to run on production. (API_CONTRACT §8.5; DATA_MODEL §2.5; DECISIONS ADR-02)
- G11-15: Code (OTP) sign-in isn't built in the pilot: `auth.otpLogin.enabled` is reserved and both OTP routes always answer 403 `AUTH_OTP_DISABLED`. (API_CONTRACT §6, §7.1; DECISIONS ADR-03)
- G16-02: Cylinder numbers are written AG-C0042 (C for cylinder) and read by one `parseCylinderNo`; orders stay AG-0142, top-ups AG-T031, refills AG-R007. Question for the owner: labels will show numbers like AG-C0042, so a cylinder can never be mistaken for an order like AG-0142, and drivers can still type just 42. Is that fine before we print the labels? (API_CONTRACT §1.1, §9.2, §10.2; DATA_MODEL §4.2, §4.4; UX_ADMIN §3.4; CUSTOMER_PAGE §13; DECISIONS ADR-22; README)

## Other changes
- G01-01: A wallet correction requires an Idempotency-Key (400 without it); the same key and body replays 200 with `Idempotent-Replay`, any difference is 409 `IDEMPOTENCY_CONFLICT`. (API_CONTRACT §4, §7.8; DATA_MODEL §3.6, §7)
- G01-02: Corrections are never limited by the wallet cap; a related top-up or order must be the same distributor's (else 404 `NOT_FOUND`) and is stored on the ledger row for tracing. (API_CONTRACT §5.4, §7.8, §7.9; DATA_MODEL §3.6; UX_ADMIN §2.8; DECISIONS ADR-10)
- G01-03: The office can approve, reject and correct whatever the distributor's status; the distributor's own top-up request needs ACTIVE (403 `DISTRIBUTOR_NOT_ACTIVE`). (API_CONTRACT §5.4, §7.8, §7.9; UX_ADMIN §2.4; UX_MOBILE S5)
- G01-04: Every adjustment with reason `OPENING_BALANCE` shows as "Opening balance", office corrections with that reason included. (API_CONTRACT §1.4; UX_ADMIN §2.6; DECISIONS ADR-10)
- G01-05: `differencePaisa` is balance minus ledger sum, signed; the nightly check keeps one unresolved alert per distributor and never resolves an alert or fixes data. (API_CONTRACT §7.8, §8.5; DATA_MODEL §3.6)
- G01-06: The wallet page only reads; during a mismatch the website shows the banner and disables "Record correction", while the server still accepts corrections. (API_CONTRACT §7.8; UX_ADMIN §2.6)
- G01-07: The low-balance warning shows only when the balance is strictly below the threshold; Rs 0 turns it off. (API_CONTRACT §7; UX_ADMIN §2.8; UX_MOBILE S2)
- G01-08: Money copy never names the refund rule; refund words come from the order's cancel terms. (UX_ADMIN §2.5, §2.6; UX_MOBILE S11)
- G01-09: Statement rows carry the customer's name for orders and, in the office view only, the top-up's bank reference. (API_CONTRACT §7, §7.8; UX_MOBILE S7; UX_ADMIN §2.6)
- G01-10: The statement `kind` filter takes one kind or a comma-separated list; the shop's "Delivery costs" chip shows returned costs beside their costs. (API_CONTRACT §5.4, §7.8; UX_MOBILE S7; UX_ADMIN §2.6)
- G02-01: With no company account set, top-up info, top-up requests and the legacy top-up all answer 503 `TOPUP_ACCOUNT_NOT_CONFIGURED`; the request rules run in a fixed order. (API_CONTRACT §7.9; UX_MOBILE S5)
- G02-02: The bank time may be up to 5 minutes ahead of the server clock; the reference is at most 100 characters with a 3–40 character key; top-up search also matches the AG-T number and part of the reference. (API_CONTRACT §7.9; UX_ADMIN §2.2)
- G02-03: Reject answers 200 with the payment; a repeat answers 200 `X-Already-Applied`, unchanged; rejecting an approved request or approving a rejected one is 409 `TOPUP_NOT_PENDING`. (API_CONTRACT §7.9; UX_ADMIN §2.2)
- G02-04: The legacy verify with approve false rejects with reason OTHER and the note "Call the office for the reason." (API_CONTRACT §7.9)
- G03-01: Every bad delivery price amount is `PRICE_INVALID`; a body whose field problems share one code answers with that code. (API_CONTRACT §1.1, §2.2, §7.5)
- G03-02: Each delivery price amount is Rs 0 to Rs 100,000 inclusive, and the message says so. (API_CONTRACT §2.3, §7.5; UX_ADMIN §2.3)
- G03-03: A location quote is serviceable exactly when it has no block code. (API_CONTRACT §7.5)
- G03-04: Price PUT and DELETE answer 200 with the zone's grid row; an unchanged PUT writes nothing, and a DELETE with no price answers `X-Already-Applied`. (API_CONTRACT §7.5)
- G03-05: Adding a customer checks the phone again under a distributor-row lock, so two adds of one number give one 201 and one 409, even before inc1b. (API_CONTRACT §7.4, §9.4; DATA_MODEL §3.6)
- G03-06: The office must pass `?distributorId=` to `GET /clients` (else 400); a distributor always gets its own customers. (API_CONTRACT §7.4)
- G03-07: Adding a customer or an address writes no audit row, by design. (API_CONTRACT §7.4, Appendix B)
- G03-08: Addresses are add-only in the pilot; lists and quotes check the pin live against active zones, and archiving a zone takes it out of every lookup at once. (API_CONTRACT §7.2, §7.4, §9.4; DATA_MODEL §3.2; UX_MOBILE S9, S15b)
- G03-09: `pricing_rules` is frozen: kept and writable through the office's legacy routes, never read by quotes, orders or fees, and dropped after the pilot. (API_CONTRACT §5.1, §7.2; DATA_MODEL §3.7, §9)
- G03-10: The zone routes get fixed bodies and answers, idempotent archive and reactivate, and `zone.*` audit rows. (API_CONTRACT §7.2, Appendix B; UX_ADMIN §2.9)
- G04-01: The shop's cancel note is optional except for Other (3–300 characters); the office always needs a 5–300 character note; could-not-deliver splits the same way. (API_CONTRACT §1.5, §7.6; UX_ADMIN §2.5; UX_MOBILE S11)
- G04-04: An order line may carry 1–100 full cylinders; `orders.maxCylindersPerOrder` is the only cap on the order total. (API_CONTRACT §7.5, §7.6; UX_MOBILE S9)
- G04-05: An order's `allowedActions` follow one table by caller and status, and are empty for finished orders. (API_CONTRACT §1.6)
- G04-06: The shop and office order tabs have fixed status sets and sort orders, shared by the summary and home figures. (API_CONTRACT §7.3, §7.6)
- G04-07: Every order transition locks the order row first; a repeat of the same action answers as the first did, and the loser of a race gets a fixed 409. (API_CONTRACT §4, §7.6; DATA_MODEL §3.6)
- G04-08: The order quote runs the create rules 1–4, so a shop without a store gets 409 `DISTRIBUTOR_NO_STORE` there too; the origin is always the home store. (API_CONTRACT §5.6, §7.5)
- G05-01: Starting a trip never changes its orders; they become IN_TRANSIT when the store stop departs. (API_CONTRACT §1.4, §7.7, §8.1, §8.3, §9.8; UX_ADMIN §3.1)
- G05-02: The office may abort a trip only before anything happened on it; its orders go back to Needs a driver, with no money and one `trip.abort` audit row. (API_CONTRACT §7.7, §8.1, §8.3, §9.8; UX_ADMIN §2.9)
- G05-03: Assigning the same driver again changes nothing and answers 200 `X-Already-Applied`. (API_CONTRACT §7.6)
- G05-05: A scan of a move already recorded answers 200 ALREADY_RECORDED and writes nothing (`X-Already-Applied` for a new scan ID, `Idempotent-Replay` for the same one). (API_CONTRACT §7.7, §9.3, §10.1)
- G05-06: Every scan runs its checks in one fixed order, and rows are locked orders first, then the trip, then the cylinder. (API_CONTRACT §7.7, §9.2, §9.10; DATA_MODEL §4.5)
- G05-07: A scan whose action doesn't fit the stop answers 403 `SCAN_EVENT_NOT_ALLOWED`. (API_CONTRACT §2.3, §9.2)
- G05-09: Finishing with cylinders left on the van needs the setting and a 5–300 character reason; `VAN_NOT_EMPTY` is one unresolved alert per van. (API_CONTRACT §9.3, §9.9; DATA_MODEL §4.2; UX_ADMIN §3.7)
- G05-10: Every scan body refuses `toCustodyType` and `toCustodyId` (400) and drops other unknown fields. (API_CONTRACT §5.9, §7.7, §9.3, §9.4, §10.1)
- G05-11: Repeated stop finishes, trip finishes, trip status changes, arrives and departs answer 200 `X-Already-Applied`. (API_CONTRACT §7.7, §9.3)
- G05-12: Bulk registration has a fixed body, always starts cylinders in the home store and is audited from Inc 1; a driver on another run still qualifies for assignment. (API_CONTRACT §7.2, §7.6, §9.2, §9.5, Appendix B; DECISIONS ADR-12)
- G06-03: A cylinder left on the van from an earlier run can't be handed over (`SCAN_NOT_ON_YOUR_VAN`) or loaded again until the store receives it. (API_CONTRACT §9.2, §9.3; DECISIONS ADR-13)
- G06-04: Load progress counts the cylinders loaded on this trip that haven't gone back into a store; "Done loading" needs at least what the orders need, so spares never block it. (API_CONTRACT §9.3)
- G06-06: The office cylinder history has a plain sentence for every event the pilot writes, and refill events name the refill. (API_CONTRACT §9.4; UX_ADMIN §3.5)
- G06-07: No pilot route marks a cylinder damaged or lost before the day-end fixes; such cylinders can be taken back and received, not loaded or handed over. (API_CONTRACT §9.2)
- G06-08: Manual delivery v2 checks every named cylinder and refuses the whole request on any problem; taken-back cylinders go onto the trip's van, with one audit row per cylinder. (API_CONTRACT §2.3, §9.2, §9.5, Appendix B; UX_ADMIN §3.4)
- G06-09: Manual delivery works only from ASSIGNED or IN_TRANSIT; a repeat answers `X-Already-Applied`, an order the driver delivered gets 409 `ORDER_INVALID_TRANSITION`. (API_CONTRACT §7.6)
- G07-01: API_CONTRACT wins on routes, statuses and codes, CUSTOMER_PAGE on page content; the same answer posted again gets 303 "Thank you", a different second answer 409. (README; API_CONTRACT §9.11; CUSTOMER_PAGE §13)
- G07-02: A case closes only through `POST /alerts/:id/resolve` with a 5–300 character note; the legacy acknowledge and resolve routes answer 404 for cases. (API_CONTRACT §9.6; DATA_MODEL §4.2; UX_ADMIN §3.3)
- G07-03: A customer's audit row never stores the IP or user agent. (API_CONTRACT §5.3, Appendix B; DATA_MODEL §4.5)
- G07-04: Confirmation status CANCELLED is reserved; nothing writes it in the pilot. (API_CONTRACT §9.8; DATA_MODEL §4.1)
- G07-05: Test mode is checked before the provider, so under the pilot defaults every SMS row ends SKIPPED `NOT_A_TEST_PHONE`. (no change; CUSTOMER_PAGE §1, §8)
- G07-06: The office manual delivery v2 also issues the customer confirmation, in its own transaction. (API_CONTRACT §9.5; DATA_MODEL §4.5)
- G07-08: "Make a new link" takes an Idempotency-Key, refuses a closed link (409 `CONFIRM_CLOSED`) and refreshes the customer's phone. (API_CONTRACT §5.9, §9.7; DATA_MODEL §4.3)
- G07-09: Share uses the request's Idempotency-Key and is limited to 20 shares per order per hour. (API_CONTRACT §9.7; DATA_MODEL §4.3; CUSTOMER_PAGE §10)
- G07-10: There is no messaging webhook in the pilot; its path answers 404 like any unknown path. (API_CONTRACT §9.7)
- G07-11: The public link's codes render HTML pages, never JSON; new code `CONFIRM_LINK_INACTIVE` (410). (API_CONTRACT §2.3)
- G07-12: The shop card and the office drawer use one set of link-status words. (UX_ADMIN §3.2)
- G07-13: The link's reach comes from the newest message row; a send gets 15 seconds before it counts as failed. (no change; CUSTOMER_PAGE §8, §10)
- G07-14: The share-way words and the shop's customer-problems line are fixed. (no change; CUSTOMER_PAGE §10; UX_MOBILE §7.3)
- G07-15: Each message row records the link version it carried, and the status words read only the current version. (DATA_MODEL §4.3)
- G07-16: Date examples use real 2026 weekdays and match `formatPkDateTime`. (UX_ADMIN §4.3)
- G07-17: A link's expiry is fixed when it is issued; the expired page states the link's own lifetime. (no change; CUSTOMER_PAGE §2, §6)
- G07-18: Ops sets `support.phone` before switching confirmation on; without it the not-found page leaves the help sentence out. (API_CONTRACT §9.1)
- G07-19: The customer's comment is cleaned in a fixed order, and the answer must be one of the four values. (no change; CUSTOMER_PAGE §4)
- G07-20: The case opens in the answer's own transaction; if opening it fails, the answer isn't saved and can be sent again. (DATA_MODEL §4.5)
- G07-21: The Problems page lists open cases as pages of `CaseDto`; `GET /alerts/mine` returns the shop's open cases. (API_CONTRACT §9.4, §9.6; UX_ADMIN §3.3)
- G07-22: Activity gets sentences for answers, new links and closed cases; the admin summary adds the open problems from Inc 2. (API_CONTRACT §7.13; UX_ADMIN §2.9, §3.3)
- G07-23: "Partly received" is a warning chip everywhere. (UX_ADMIN §3.1)
- G07-24: The shop name in an SMS is cleaned to plain characters, at most 20. (no change; CUSTOMER_PAGE §9)
- G07-25: The public link's rate limits run in a fixed order and fail open when Redis is down. (no change; CUSTOMER_PAGE §5, §6)
- G07-26: The second-step pages follow the state order, other paths get the 404 page, and the gas safety note is on every page. (no change; CUSTOMER_PAGE §4–§6)
- G08-01: The Inc 1 refill create ignores the Idempotency-Key; from Inc 3 it is stored and a retry is replayed. (API_CONTRACT §4, §7.11, §10.1; DATA_MODEL §7)
- G08-02: A refill count of 0, below 0 or a fraction is `REFILL_INVALID_COUNT`; the rules run in a fixed order, with no stock check. (API_CONTRACT §7.11)
- G08-03: Refill assign and complete have fixed checks and repeats; `refill.create`, `refill.assign` and `refill.complete` are audited from Inc 1. (API_CONTRACT §2.3, §7.11, Appendix B; UX_ADMIN §2.9; DECISIONS ADR-16)
- G08-04: One derived refill stage from Inc 1, which each app maps to its own words. (API_CONTRACT §1.4; UX_ADMIN §2.11, §4.1; UX_MOBILE S12b)
- G08-05: Refill pickup and fill checks run in a fixed order; "already on another refill" is checked before "in the store". (API_CONTRACT §10.1)
- G08-06: "Leave store" needs a picked cylinder and "Leave station" a fill, else 409 `REFILL_WRONG_STEP`. (API_CONTRACT §10.1; UX_MOBILE §8.2)
- G08-09: Refill cylinders don't block a delivery trip's finish but do block a van change; a refill pickup never stamps `load_started_at`. (API_CONTRACT §5.5, §9.4, §9.5; DATA_MODEL §3.6)
- G08-10: Stations keep sending a price of "0" to every caller, with no version check. (API_CONTRACT §10.1)
- G09-01: A day-end upload with rows that can't be read is refused whole (422 `DAY_SHEET_ROW_ERRORS`) and stores nothing. (API_CONTRACT §10.2; UX_MOBILE §8.3)
- G09-02: A submitted day can't be downloaded or uploaded again; submit needs an upload from the newest sheet (new code `DAY_SHEET_NOT_UPLOADED`). (API_CONTRACT §2.3, §10.2)
- G09-04: Sheet numbers are read like typed numbers; another shop's number refuses the upload; an extra number is registered with the next short number. (API_CONTRACT §10.2; DATA_MODEL §5.3)
- G09-05: "Why different" is free text of at least 3 characters on a differing row; there is no reason list. (API_CONTRACT §10.2; DATA_MODEL §5.3)
- G09-06: The sheet carries its identity in a hidden "About" sheet, and only the newest sheet can be uploaded (new code `DAY_SHEET_OUTDATED`). (API_CONTRACT §2.1, §2.3, §10.2; DATA_MODEL §5.3)
- G09-07: A day-end upload is at most 2 MiB and must be a real workbook. (API_CONTRACT §10.2)
- G09-08: The day lock refuses only day-end routes, never a scan; approve, send-back and reopen have fixed repeat answers. (API_CONTRACT §10.2; DATA_MODEL §5.3, §5.4; DECISIONS ADR-17)
- G09-09: `dayEnd.enabled` and `confirmation.enabled` are setting switches that answer every method 403 while off. (API_CONTRACT §3.4)
- G09-10: No job creates day rows; the first sheet download does. (API_CONTRACT §10.2; DATA_MODEL §5.3)
- G09-11: The office downloads both day-end sheets through `GET /files/:id/url`. (API_CONTRACT §10.2; UX_ADMIN §4.3)
- G09-12: One derived day-end stage, with fixed office words and tabs. (API_CONTRACT §1.4; UX_ADMIN §4.3)
- G09-13: The day carries the office's send-back or reopen note, with the new `sent_back_at` and `reopened_at` columns. (API_CONTRACT §10.2; DATA_MODEL §5.3)
- G10-01: Pilot setup checks the whole file, then writes it in one transaction; it may add customers, and opening balances only with `--test`. (API_CONTRACT §10.3, Appendix B)
- G10-02: The pilot reset deletes the test data and its audit rows, never office users, and refuses when a kept row points at a deleted one. (API_CONTRACT §10.3; DATA_MODEL §5.2)
- G10-03: Rehearsal top-ups are approved against a printed stand-in bank list, each line once. (no change; README)
- G10-04: The standard test data fixes every sign-in phone, the customers' phones and the station "Lahore Filling Station". (API_CONTRACT §10.3)
- G11-01: Every ownership miss answers 404 with the resource's own not-found code, the same as for an unknown id. (API_CONTRACT §3.2, §7.2, §7.4, §9.4)
- G11-02: Checks run sign-in, then role (403), then ownership (404), then the route's rules; a driver not on the order's trip gets 404. (API_CONTRACT §3.2, §7.6, §7.7, §8.6, §9.4)
- G11-03: A sign-in from the wrong app is refused with 403 `AUTH_WRONG_APP`, shown under the sign-in form. (API_CONTRACT §7.1; UX_ADMIN §2.10)
- G11-04: Sign-in checks run in a fixed order, the password before the account status, and every attempt counts toward the limits. (API_CONTRACT §3.6, §7.1)
- G11-05: Bad or expired tokens are `AUTH_TOKEN_INVALID`, revoked sessions `AUTH_SESSION_REVOKED`, bad refresh tokens `AUTH_REFRESH_INVALID`, on the socket too. (API_CONTRACT §3.3, §7.1, §7.14)
- G11-06: Suspending a distributor signs it out and blocks sign-in; a distributor's two status columns always change together. (API_CONTRACT §3.3, §7.2, §7.3; DATA_MODEL §3.2)
- G11-07: "Reactivate" uses `PATCH /distributors/:id/approve` with a required reason. (API_CONTRACT §7.3, Appendix B; UX_ADMIN §2.9)
- G11-08: The office sets a typed app password for distributor and driver logins only. (API_CONTRACT §7.2)
- G11-09: Driver create, edit, archive and reactivate get fixed bodies, codes and audit rows. (API_CONTRACT §7.2, §7.3, Appendix B; UX_ADMIN §2.9)
- G11-10: `PATCH /users/me` changes only name and email; a body naming phone, CNIC or business name is refused whole. (API_CONTRACT §7.2)
- G11-11: A CNIC is reduced to its 13 digits before it is encrypted and indexed, and production needs both keys. (API_CONTRACT §3.7, §7.3)
- G11-12: Office views carry a masked CNIC with the last four digits; nothing else does. (API_CONTRACT §3.5, §7.3)
- G11-14: `auth.lockedRoles` can never hold SUPER_ADMIN or a repeated role, and it isn't on the Settings page. (API_CONTRACT §6; UX_ADMIN §2.8)
- G11-16: A status or role change on a super admin locks every active super admin first, so two can't suspend each other. (API_CONTRACT §7.2)
- G11-17: Access tokens last 12 hours and refresh tokens 30 days; the website's idle sign-out runs in the browser only. (API_CONTRACT §7.1; UX_ADMIN §2.10)
- G11-18: Registering a push token moves it to the caller; deleting removes only the caller's own. (API_CONTRACT §7.2)
- G12-01: A settings change saved on the website applies to the very next request; the apps may show it up to 5 minutes later. (API_CONTRACT §5.2; UX_ADMIN §2.8)
- G12-02: The environment strips follow `APP_ENV`; `training` is true only on a training server. (API_CONTRACT §6)
- G12-03: Business-date SQL reads `day.timezone` and `day.cutoffLocalTime`, never literals; change them only between business days. (API_CONTRACT §1.1, §6, shared code list; DATA_MODEL §5.4; UX_ADMIN §4.4; DECISIONS ADR-21)
- G12-04: Every cron passes the Asia/Karachi time zone, and housekeeping runs at 03:00 Karachi time. (API_CONTRACT §8.5, §9.9; DECISIONS ADR-21)
- G12-05: Every run of the nightly wallet check writes one `wallet.check` audit row, shown in Activity. (API_CONTRACT §8.5, Appendix B; DATA_MODEL §3.6; UX_ADMIN §2.9; DECISIONS ADR-23; README)
- G13-01: Expense dates and fuel-log months are Asia/Karachi calendar dates, with no 03:00 cut-off. (API_CONTRACT §1.1, §7.12; DATA_MODEL §5.4; DECISIONS ADR-21)
- G13-02: An archived expense type keeps its name taken; the office restores the type instead. (API_CONTRACT §7.12; DATA_MODEL §3.4)
- G13-03: `features.fuelRefills` gates only the drivers' own fuel-log routes; the office always sees older logs. (API_CONTRACT §7.2, §7.12; UX_ADMIN §2.8; DECISIONS ADR-04)
- G14-01: Every figure of the admin summary is defined; missing prices list active distributors only. (API_CONTRACT §7.13)
- G14-02: "Last top-up" is the last approval time, and "approved today" uses the business day of the approval. (API_CONTRACT §7.8, §7.9)
- G14-03: The legacy reports page opens only by its address, `/reports`. (API_CONTRACT §7.13; UX_ADMIN §2.11; DECISIONS ADR-04)
- G15-01: Customer and distributor creates store their Idempotency-Key, so a retry is replayed. (API_CONTRACT §4, §7.3, §7.4; DATA_MODEL §3.2, §7)
- G15-02: The Idempotency-Key must be a UUID; it is looked up first and compared on fixed fields per route. (API_CONTRACT §1.2, §4)
- G15-03: 5 MB is 5,242,880 bytes and upload checks run in a fixed order; a create answers 201, every other success 200. (API_CONTRACT §1.2, §7.10; DATA_MODEL §3.3)
- G15-04: The catalogue lists the details keys of every error code, copied from errors.ts. (API_CONTRACT §2.1, §2.3)
- G15-05: 503 `SERVICE_UNAVAILABLE` means a dependency is down; a deadlock is 409 and a malformed id 404. (API_CONTRACT §2.2)
- G15-06: A signed amount carries a leading "-" for money out; request amounts are never negative. (API_CONTRACT §1.1)
- G15-07: `?limit` must be 1–100 and is never clamped; an unknown cursor is 400. (API_CONTRACT §1.3)
- G15-08: The app-update gate falls back to the signed-in role and never gates the health routes. (API_CONTRACT §6)
- G15-09: The health routes never show error text; `/health` answers 503 while the database is down. (API_CONTRACT §7.2)
- G16-01: Signed money is written with the sign right before "Rs": "−Rs 330", "+Rs 5,000". (API_CONTRACT §1.1)
- G16-03: `formatNo` has four kinds and prints numbers past 9999 in full. (API_CONTRACT §1.1; DECISIONS ADR-22)
- G16-04: Every counted string has a singular and a plural form; counted error messages are reworded to read right for any count. (API_CONTRACT §2.3; UX_ADMIN §2.8, §3.7, §4.3)
- G16-05: The driver app shows the one catalogue text for a van that isn't empty: "The store still needs to scan in the cylinders on your van ({{count}} left)." (API_CONTRACT §2.3)
- G16-06: The correction reason SYSTEM_ERROR reads "System error" in both apps. (no change; UX_MOBILE §3.4; UX_ADMIN §2.6)
- G16-07: `formatPkPhone` is the one phone formatter, with a new "compact" style for SMS text. (API_CONTRACT shared code list)
- G16-08: The phone forms `normalizePkPhone` accepts are written down; the inc1a SQL flags the forms it can't fix. (API_CONTRACT §1.1; DATA_MODEL §3.4)
- G16-09: Times like "Today, 4:12 pm" use the calendar day, not the business day. (no change; UX_MOBILE §3.3)
- G17-01: Each opening entry is the balance minus the ledger sum (never 0), as the built migration does. (DATA_MODEL §3.4; DECISIONS ADR-11)
- G17-02: DATA_MODEL lists 20 numbered post-migration invariants for the MIG tests and the pre-deploy check. (DATA_MODEL §2.4, §3.5, §3.8)
- G17-03: inc1a deactivates the retired `DISTRIBUTOR_CREDIT_OVER` alert rules (backfill 12). (API_CONTRACT §7.2; DATA_MODEL §3.4, §3.7)
- G17-04: `BULLMQ_PREFIX` contains the deployment's name, and every Redis key the API writes starts with it. (API_CONTRACT §3.6, §3.7; DATA_MODEL §2.6)
- G17-05: The pilot has backup targets and a restore drill before the switch-over and each production migration. (API_CONTRACT §8.5; DATA_MODEL §2.6)

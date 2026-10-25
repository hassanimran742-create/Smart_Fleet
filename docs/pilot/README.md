# Smart Fleet pilot blueprint

The design for the **happy-path pilot** of Smart Fleet, a Pakistan LPG-cylinder delivery platform. It is written against branch `pilot/happy-path` at commit `af889bf` (the same code as `origin/claude/general-session-3CQVX`). Every `path:line` reference is relative to the repo root and was read on that commit.

Status: **Increments 1, 2 and 3 built, server and screens, reviewed and fixed; the device walk and the over-the-air switch-over wait for the pilot phones.** On 2026-10-22 these docs were reconciled with the test cases in [TEST_CASES.md](TEST_CASES.md) (513 when the gaps were found) and with the code. On 2026-10-23 the Increment 1 review's fixes were applied, and the simple-UX pass rebuilt every Inc 1 screen of the three apps to [UX_PRINCIPLES.md](UX_PRINCIPLES.md) and redesigned the Inc 2 and Inc 3 screens to it. On 2026-10-24 the Increment 2 and 3 server was merged into that build (API_CONTRACT §9.12 and §10.5 say what was built). On 2026-10-25 the Inc 2 and Inc 3 screens were built and checked, the Inc 2/3 review's findings were fixed, and the follow-ups made the switch-over's phone check one look at the office website (API_CONTRACT §8.5 step 10); TEST_CASES.md now has 604 cases. [CHANGELOG.md](CHANGELOG.md) lists every change.

This blueprint applies the **client clarification of 2026-10-21**. It replaces every earlier hold, charge-on-delivery and refund design:

- The platform manages **only delivery-related money**. No gas or cylinder pricing, no refill money, and no refunds except the cancel rule below.
- The **delivery cost is deducted from the distributor's wallet when the order is placed**. The balance must cover it.
- It is **returned only when the order is cancelled before delivery has started**, by the distributor or the super admin. After that there is no refund, whatever happens at the door.
- **Expenses** (petrol, maintenance and so on) are recorded by the super admin, who manages the expense types.
- **Customer confirmation is a record only.** It never moves money.

## Who is who

| Owner's word | Code | What they do |
|---|---|---|
| Distributor, shop-keeper, store (one user) | `UserRole.DISTRIBUTOR` + `Distributor` + its one `Store` | Holds the wallet, adds customers, places and cancels orders, scans in what drivers bring back (Inc 2), uploads the day-end sheet (Inc 3). The shop app (`APP_VARIANT=distributor`). |
| Super admin, "the office" | `UserRole.SUPER_ADMIN` (two named logins) | Approves top-ups, sets delivery prices, assigns drivers, records expenses, fixes mistakes. The website `apps/admin-web`. |
| Driver | `UserRole.DRIVER` + `Driver` + a `Vehicle` | Loads at the distributor's store, delivers, takes cylinders back. The driver app (`APP_VARIANT=driver`). |
| Customer | `Client` | No app. Confirms a delivery on a one-time web link (Inc 2, optional). |

Driver words map to scan codes like this (the code names read backwards from the driver's side):

| Driver says | Event code | Holder change |
|---|---|---|
| Load (IN at the store) | `SCAN_OUT` | store → van |
| Deliver (OUT to the customer) | `DELIVERED` | van → customer |
| Take back (IN from the customer) | `PICKED_UP_EMPTY` | customer → van |
| Unload (the store scans IN; the shop app says Receive) | `SCAN_IN` | van → the owner's one store |

## The three increments

### Increment 1: Foundations, money and expenses
- **Safety baseline:** webhook switched off (410), approve-once top-ups, atomic balances, a delivered guard, role and ownership checks, no password or CNIC leaks, the legacy scan route locked down, socket auth, customer login off, boot guards, an audit log, a migrations baseline.
- **One store per distributor.** Every trip starts at it.
- **Delivery price per distributor per zone:** a base per order plus optional per-size amounts (default 0). A missing price blocks adding the customer and placing the order, with a clear message.
- **The cost is quoted** when a customer is added and when an order is reviewed. It is **deducted when the order is placed**, and **returned only on a cancel before delivery has started** (setting `orders.deliveryStartedAt`, default the first load scan).
- **Wallet card** (balance plus money being checked) and a wallet history.
- **A super-admin wallet correction**, with a reason, for genuine mistakes.
- **Upgraded manual top-up:** payer name, plus an optional transaction ID and screenshot. The super admin approves by typing the bank reference, which can be used only once.
- **Expenses:** types the super admin manages (seeded with Petrol, Maintenance, Repairs, Tyres, Toll/Parking and Other), with van, driver and receipt photo. Filters, totals by type and month, and the drivers' fuel logs shown alongside.
- **Driver assignment:** automatic assignment off by a setting. Manual assignment creates the trip, which begins at the distributor's store.
- **Refills:** keep working, with no money. Do-it-yourself refills are retired.
- **Design systems** for the shop and driver apps and for the website, with every string behind an i18n key and stable error codes.

Exit: the Inc 1 contract tests pass (API_CONTRACT.md §8.6). A full day runs on the test server: top-up, approve, add customer, order (cost deducted), assign, deliver, and cancel before and after loading (refund and no refund). The nightly wallet check is clean: its `wallet.check` row in Activity shows that every wallet matches.

### Increment 2: Driver flow and confirmation
- **Driver runs on scans:** Load at the distributor's store; Deliver from that van only; Take back, with Empty, Part-filled or Full as separate lists. A cylinder given on a visit can't be taken back on the same visit.
- **The store scans IN** the labelled cylinders the driver brings back. Unlabelled returns are counted by size and state at the door: they count as taken back, but they never get a holder, so the store doesn't scan them and they never block Finish trip.
- **Holder rules:** one holder at all times; no IN, no OUT. The responsible driver is whoever last scanned the cylinder IN onto a van; once the store scans it in, no driver is. A forgotten IN blocks the OUT, and the super admin records a logged manual delivery naming the cylinders.
- **Could not deliver** moves no money.
- **Customer confirmation** is built last and can be deferred. It is switched off by default (`confirmation.enabled`). It records Yes, Partly, No or Other. "No" and "Other" open a case for the super admin.
- **Messaging** goes through a provider interface: mock now, with a share-link fallback from the shop app.

Exit: a full run on real phones, every holder change by scan, no money moved after placement except an approved correction.

### Increment 3: Refills and day-end
- **Refills on QR scans.** At most 30 cylinders and one size per request. The driver scans pickup and fill. The store's receive scan brings each cylinder back, and the refill completes when all are received, filled or not (the screens show how many were filled). Only the owner can cancel, and only before pickup.
- **Refill money:** none. `refill.deliveryCost` is reserved and off.
- **Day-end Excel:** a system-made sheet with one row per cylinder. The distributor uploads it and previews the differences; the super admin approves all of them or sends the sheet back; the day locks (its sheet and summary freeze; scans carry on).
- **Pilot setup and reset** CLI.

Exit: the rehearsal day passes its go / no-go rules. The test server's company account is a dummy, so the rehearsal lead brings a printed stand-in bank list (bank reference, amount, time per payment); the office approves a top-up only against a line and ticks it, each line once. Rule 1 holds when every approved top-up matches exactly one ticked line and every ticked line one top-up. Live approvals use only the real company bank app.

## How to use these docs

| Doc | It is the single source for |
|---|---|
| [DECISIONS.md](DECISIONS.md) | Owner decisions, the defaults that are settings, what was superseded |
| [DATA_MODEL.md](DATA_MODEL.md) | Every **table, column, enum, constraint and migration**, and the SQL write patterns |
| [API_CONTRACT.md](API_CONTRACT.md) | Every **route, payload, state machine, error code, settings key and service interface** |
| [UX_PRINCIPLES.md](UX_PRINCIPLES.md) | The simplicity rulebook for every screen of the four surfaces: look, feel, layout, choice of control, copy, word budgets and screen states, and the "Definition of simple" checklist. It ranks **above** UX_MOBILE, UX_ADMIN and CUSTOMER_PAGE on those, and below them on behaviour, money and safety |
| [UX_MOBILE.md](UX_MOBILE.md) | Shop and driver app screens, states, copy keys, mobile design tokens and components |
| [UX_ADMIN.md](UX_ADMIN.md) | Super-admin website screens, states, copy, web design tokens and components |
| [CUSTOMER_PAGE.md](CUSTOMER_PAGE.md) | The public confirmation link page, the SMS text and messaging (Inc 2, optional) |
| [CHANGELOG.md](CHANGELOG.md) | The record of spec changes, one line per gap id, with the defaults the owner may still change |

Rules when the docs and the code disagree:
1. **Precedence:** DECISIONS beats DATA_MODEL for names, which beats API_CONTRACT, which beats the UX docs. Between CUSTOMER_PAGE and API_CONTRACT, API_CONTRACT wins on routes, status codes and error codes, and CUSTOMER_PAGE wins on page content, copy and layout. On look, feel, layout, controls, copy and screen states, UX_PRINCIPLES beats UX_MOBILE, UX_ADMIN and CUSTOMER_PAGE; it never changes a behaviour, money or safety rule. Fix the lower doc in the same pull request.
2. **Shared code is the contract.** Error codes, enums, settings keys and DTO types live in `packages/shared-types`. Request schemas live in `packages/shared-validation`, and formatters in `packages/shared-utils`. Apps never redefine them.
3. **Every money or state change is atomic and idempotent** (API_CONTRACT §4). No pull request moves money outside `WalletService`.
4. **Every user-facing string** goes through an i18n key. The server returns `{ code, message, details }`, and apps translate `errors.<CODE>`.
5. **Database changes ship only as Prisma migrations** made with `prisma migrate diff` (DATA_MODEL §2). Never use `db push` after the baseline release.

## Conventions used everywhere
- **Money** is integer paisa: `BigInt` in the database, a digit string in JSON (money out carries a leading `-`, `"-48000"`), and shown as "Rs 3,450" or "−Rs 480" by `formatRs()`.
- **Time** is ISO-8601 UTC on the wire. The business day is Asia/Karachi with a 03:00 cut-off (settings `day.timezone` and `day.cutoffLocalTime`). Expense dates are plain Asia/Karachi calendar dates, with no cut-off.
- **Human numbers** come from `Distributor.code`: order `AG-0142`, top-up `AG-T031`, refill `AG-R007`, cylinder `AG-C0042`, C for cylinder, typed as `42`, `0042`, `C0042` or `AG-C0042` (`formatNo()` and `parseCylinderNo()` in shared-utils).
- **Plain words on screen.** No enum values, UUIDs or words like `PAID_VIA_LEDGER`.

## Increment 1 build order
One **foundation** lane comes first: schema and migrations, shared contracts, settings, the audit log, files, common API plumbing and both design systems. Then eight **parallel** lanes with disjoint file ownership:

| Lane | Owns |
|---|---|
| api-money | Wallet, ledger, top-ups and payments, admin wallet, reports |
| api-orders | Pricing, zones, stores, distributors, clients, orders, trips, legacy scans, dispatch, refills, admin summary |
| api-security | Auth, users, drivers and socket, switched-off modules, alerts |
| expenses | API module plus website page |
| mobile-distributor | Shop app |
| mobile-driver | Driver app stop-gaps |
| admin-web-money | Top-ups, wallets, prices, settings, activity |
| admin-web-ops | Today, orders, distributors, login, legacy screens |

The lane breakdown, with tasks and acceptance checks, is in the workflow output. It follows API_CONTRACT §5 (module ownership).

## Planning inputs this blueprint supersedes
- **The five design specs** (data-model, api-contract, ux-mobile, ux-admin, ux-public). Their hold, charge, release and refund parts are removed.
- **The tested migrations in the design scratchpad** (`dm_handoff/`). These encode the old hold model. Reuse `0_baseline`, `migration_lock.toml` and `scripts/assert-baselined.sql` as they are, and regenerate `inc1a`/`inc1b` from DATA_MODEL.md.
- **Gap register items now closed or superseded.** Build tickets must not bring these back:
  - superseded: MON-03 (now: deduct at placement), MON-11, REF-02, REF-04, REF-05, REF-07, CUS-04, CUS-07;
  - narrowed: MON-07 (now a correction for mistakes only).

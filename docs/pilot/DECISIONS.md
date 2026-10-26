# Decisions (ADR list)

Each entry has a **status**:
- **Decided**: the owner or client said so.
- **Default**: our choice while the owner hasn't decided. Most defaults are runtime settings, so they can change without code; the others are code rules the owner can still veto (CHANGELOG.md lists the latest ones under "Defaults the owner may change").
- **Design**: an engineering rule that follows from the decisions.

Setting keys are defined once in API_CONTRACT §6. Sources: the owner decisions of 2026-10-19 to 2026-10-21 and the client clarification of 2026-10-21. The reconciliation of 2026-10-22, after the test-case review, is listed gap by gap in [CHANGELOG.md](CHANGELOG.md).

---

## Actors and scope

### ADR-01 · Distributor = shop-keeper = store · Decided
- The code's `Distributor` is the tenant. It holds the wallet, customers, orders and cylinders.
- There is **exactly one store per distributor**: `Distributor.homeStoreId` becomes unique and required (DATA_MODEL §3).
- Every trip and every refill starts at that store. The client's body can't choose another one (today orders.service.ts:233-244 falls back to the oldest store in the system).
- One run carries one distributor's orders. Mixed runs wait for distributor #2.

### ADR-02 · The office is SUPER_ADMIN only · Decided (pilot)
- Two named super-admin logins: the owner and one operations person.
- ADMIN, DISPATCHER, STORE_KEEPER and CLIENT logins are refused while their role is in `auth.lockedRoles`. This includes the seeded "LPG Branch Admin".
- The other seeded logins (the seeded SUPER_ADMIN "LPG Super Admin", "Test Distributor" and "Test Driver") never sign in on live: they are suspended at the switch-over (API_CONTRACT §8.5), and `prisma/seed.ts` refuses to run on production. Default.
- Routes that only the actor may use (a driver's scans, a distributor's cancel) use **exact roles**, with no super-admin bypass. Today roles.guard.ts:26 lets SUPER_ADMIN through everywhere.
- **Ownership failures return 404.**
- Building a staff screen is not in the pilot.

### ADR-03 · Customer login and the customer app are off · Decided
- `auth.otpLogin.enabled=false` and `features.clientApp=false`.
- OTP never creates users (today auth.service.ts:87-96 does).
- The switch is reserved: it can't be changed over the API, and code sign-in isn't built in the pilot. If it is built later, codes sign in only existing DISTRIBUTOR and DRIVER accounts (API_CONTRACT §7.1). Default.
- Customers use only the confirmation link (Inc 2, ADR-15).

### ADR-04 · Modules not used by the pilot are switched off · Decided
- `features.transfers`, `features.accessories` and `features.support` are `false`: writes get 403 `FEATURE_DISABLED`, and lists return `[]`.
- Driver fuel logging is `features.fuelRefills=false` by default (ADR-14). The switch gates only the drivers' own fuel-log routes; the office still reads older logs (API_CONTRACT §7.2).
- Store-to-store transfers are a second scan path outside the holder rules, so they stay off.
- Revenue reports are hidden on the website: out of the navigation, the legacy page reachable only by its address. Their API stays, office only, and is fixed to read the ledger (API_CONTRACT §7.13).

---

## Money

### ADR-05 · Only delivery money is managed · Decided (client, 2026-10-21)
- The platform does not price gas or cylinders. It does not charge for refills and does not keep refunds.
- Money in: manual top-ups. Money out: the delivery cost of an order.
- Gas payments and money for leftover gas happen outside the app.
- Expenses are recorded, but they **never touch distributor wallets** (ADR-14).

### ADR-06 · One balance, deducted when the order is placed · Decided
- A wallet is one number: `distributors.advance_balance_paisa` (`balancePaisa` in the API). There are **no holds** and no available/held split.
- **Placing an order** works in one transaction:
  1. Quote the cost.
  2. Deduct it with a guarded update (`balance >= cost`), writing ledger row `DEBIT_ORDER`.
  3. Create the order.

  If the balance is short, the order is refused with 409 `WALLET_INSUFFICIENT_BALANCE`, saying how much more is needed.
- A cost of zero writes no ledger row.
- The balance can never go negative. This is guarded by the update and by a database CHECK (inc1b).
- The ledger is append-only, and its sum equals the balance. A nightly check alerts on any mismatch.

### ADR-07 · Refund only on a cancel before delivery has started · Decided
- A cancel by the **owning distributor or the super admin** returns the full delivery cost, but **only if delivery has not started**.
  - The return is ledger row `CREDIT_ORDER_REVERSAL`, with key `order:<id>:reversal`. It is unique, so it can't happen twice. It is audit-logged.
- Only a cost this platform deducted at placement can come back. An order the old code charged before the switch-over refunds nothing on a cancel (API_CONTRACT §5.5). Default.
- Cancelling **after** the start is still allowed, until the first hand-over, but returns nothing.
- Nothing at the door moves money: delivered, partly taken, refused, or could not deliver.
- **Delivery started** is setting `orders.deliveryStartedAt`. The default is `FIRST_LOAD_SCAN`, meaning delivery has started when any of these is true:
  - the driver's first load scan on the order's trip at the distributor's store;
  - the store stop departed;
  - the order's delivery stop was reached;
  - the order is DELIVERED or FAILED.

  The other values are `DRIVER_ASSIGNED` and `LEFT_STORE`. API_CONTRACT §5.5 has the one function that decides it. The rule is read when a cancel is decided and isn't stored on the order: changing the setting applies at once to every order that hasn't started yet, including orders already placed. Default.
- `FAILED` is allowed only after the start. Before the start, the order must be cancelled instead (`ORDER_NOT_STARTED_USE_CANCEL`).

### ADR-08 · Delivery price per distributor per zone: one flat cost per order · Decided
- The customer's zone, found from their address pin, picks the distributor's price.
- **The delivery cost is ONE flat amount per order**, set per distributor per zone, whatever cylinders the order holds. The owner (2026-10-26): "We are managing deliveries not cylinder pricing. Only delivery costs."
  - There are no per-size amounts anywhere: not on the server, not in the data, not on any screen. This replaces the earlier "base per order plus an amount per cylinder size" (2026-10-21).
  - X1 (2 × 11.8 kg + 1 × 45.4 kg for Sana in North) costs Rs 250, like any other order there.
- **No price row for this distributor in this zone → blocked** with `PRICING_PRICE_NOT_SET`: when adding the customer's address, at quote time, and when placing the order. A pin outside every active zone is blocked with `PRICING_ZONE_NOT_COVERED`.
- There is one current price row per distributor and zone, edited in place with a before/after audit row.
- Each order **stores its own copy of the cost**. A price change never touches orders already placed.
- The cost is quoted when a customer is added and when an order is reviewed, deducted when the order is placed, and refunded only on a cancel before delivery has started (ADR-06, ADR-07).
- Pricing goes through a `DeliveryFeeStrategy` interface. `DISTRIBUTOR_ZONE` is the pilot strategy, and "zones crossed" can be added later without changing the orders table.

### ADR-09 · Manual bank top-ups, approved once against the bank app · Decided
- The distributor pays the company account by Easypaisa or a bank app, then tells the app the amount and payer name. The transaction ID and screenshot are optional.
- The super admin approves only after seeing the payment in the company bank app, by typing its **bank reference, amount and time**. A normalised reference can be used **once ever** (unique key).
- Approving twice credits once.
- The payment webhook returns 410. Easypaisa comes later through the same credit path.
- Limits are `topup.minPaisa` (Rs 500) and `topup.maxPaisa` (Rs 50,000). Default.
- **If the bank amount differs from the request**, setting `topup.onAmountMismatch` decides. The default `CREDIT_BANK_AMOUNT` credits the bank amount after a warning and a confirmation, and the distributor sees "Rs 4,500 added (you told us Rs 5,000)". The alternative is `REJECT`. Default.
- The company account details are setting `topup.account`, which can't be edited over the API. It is set by a logged CLI on the owner's written request. The NIONSSTECH fallback in bank-manual.provider.ts:14-16 is removed.
- A second approver for large top-ups is **not built** for the pilot. Its key is reserved (`topup.secondApproval`, off). Default.

### ADR-10 · Wallet correction for genuine mistakes only · Decided
- **Super admin only:** add or take an amount, with a reason code (`WRONG_TOPUP_APPROVAL`, `SYSTEM_ERROR`, `BANK_REVERSAL`, `OPENING_BALANCE` or `OTHER`) and a note.
- It may link to the payment or order it fixes, of the same distributor, for tracing only.
- It can't take the balance below zero. The wallet cap (`wallet.maxBalancePaisa`) limits top-ups only, never a correction, and the office can correct a wallet whatever the distributor's status. It is audit-logged.
- Distributors see the row in their history but have no correction screen. It is never a refund or dispute path.
- A correction with reason `OPENING_BALANCE` (fixing an opening entry, or money held before joining) shows in the history as "Opening balance", like the migration's opening entry (ADR-11).

### ADR-11 · Opening balances · Design
- Migration inc1a writes one `ADJUSTMENT` row with reason `OPENING_BALANCE` for each distributor whose cached balance differs from its ledger sum (no history, or only part of it). Its amount is the difference, balance − ledger sum, so it is negative when the old history adds up to more; afterwards the ledger sum equals the balance. A distributor whose history already adds up gets no row.
- Ops checks each such row against the bank before the pilot.
- The pilot setup file can write an opening balance only on a test server (`--test`). On live, balances come only from top-ups and office corrections (API_CONTRACT §10.3).

---

## Delivery flow

### ADR-12 · Manual assignment from the distributor's store · Decided
- `dispatch.autoAssign.enabled=false`: the automatic dispatcher does nothing.
- Assigning a driver needs the driver to be ACTIVE and AVAILABLE (not on leave or off duty) and to have a van; a driver already on another run still qualifies. It creates a trip with a store stop at the distributor's store, then the delivery stop.
- **Reassigning closes the old trip and its stop** (today orders.service.ts:246-295 never does). It is refused once anything has been loaded on the order's trip, even if the store later scans it back in (`ASSIGN_ORDER_LOADED`). Default.

### ADR-13 · Cylinder holder rules · Decided (built in Inc 2)
- **One holder at all times:** the store, the van or the customer. It changes only by a QR scan or a typed cylinder number (which is logged), or by a logged office action: the manual delivery below, or an approved day-end fix (ADR-17).
- **No IN, no OUT:** only cylinders loaded at this distributor's store onto this trip's van, on this run, can be handed over. A cylinder left on the van from an earlier run must go back through the store's receive scan before it can be loaded again.
- What is **given** and what is **taken back** are two separate lists. A cylinder given on a visit can't be taken back on the same visit. Taken-back cylinders are recorded as Empty, Part-filled or Full, as the driver taps. A taken-back Full cylinder never goes straight to another customer.
- **The store scans IN** what comes back (shop app). The driver has no unload scan. Returns always go into the cylinder owner's one store, and only the owner can receive them. "The driver chooses the store" needs no choice while each distributor has one store (ADR-01). Default.
- **The responsible driver** is whoever last scanned the cylinder IN onto a van (at the store, from a customer, or for a refill). Once the store scans it IN, no driver is responsible. Default.
- **A forgotten IN** keeps the OUT blocked. The super admin records a logged manual delivery naming the cylinders (`custody.forgottenInPolicy`, only this value is built).
- **Unlabelled or other-brand returns** are counted by size and state at the door. They count toward what was taken back, but they never get a holder: the store doesn't scan them in and they never block the end of a run. Default.
- No filling-station holder: during a refill, cylinders stay on the van.
- Two scans at the same moment are a rare edge case, handled by a row lock.
- **Walk-in counter swaps** are not built (`walkIn.counterSwap.enabled=false`, reserved). Default.

### ADR-14 · Expenses · Decided
- **Super admin only.** Expense **types** are a table the super admin can add to, rename and archive.
  - Seeded: Petrol, Maintenance, Repairs, Tyres, Toll/Parking, Other.
  - Petrol and Other can't be archived.
  - Old fixed categories are migrated to archived types, so old rows keep their meaning.
- An expense has a date, an amount, a type, and optionally a van, a driver, a note and a receipt photo.
- Removing an expense is a logged void with a reason, never a hard delete.
- The list has filters (dates, type, van, driver) and totals by type and by month.
- **The drivers' fuel logs are shown alongside Petrol, not merged into it.** A toggle, off by default, adds them to the totals, to avoid counting the same bill twice.
  - Default: driver fuel logging stays off for the pilot (`features.fuelRefills=false`) and the super admin enters petrol as expenses.
- Expenses never touch wallets: `ExpensesModule` may not import `WalletService`.

### ADR-15 · Customer confirmation is a record only, and optional · Decided (record-only); keep in pilot · Default
- Built in Inc 2 as an independent slice, last, behind `confirmation.enabled`. **The default is false** until the owner confirms it stays in the pilot. Switching it off stops new links, and links already sent show "This link is closed" while it stays off; nothing is deleted, and an unexpired link works again once it is back on. Switching it on never back-fills older deliveries. Default.
- **The link** is one-time and opens a no-login page with the answers: All received, Partly received, Not received, Other problem. The first answer wins. The answer never changes money.
- Answers listed in `confirmation.caseOnAnswers` (default `NO` and `OTHER`) open **one case** for the super admin, who closes it with a note.
- The link is shared from the **shop app or the office**, never from the driver app (the owner: the customer confirms "not on the driver's phone"). Messages go through a provider interface: mock now, a real SMS company later, WhatsApp only after Meta agrees.
- The link expires 72 hours after delivery (`confirmation.linkTtlHours`).

### ADR-16 · Refills · Decided (QR tracking, no money)
- Refills are the platform's own service. **Do-it-yourself refills are retired** from Inc 1 (410).
- **One size per request, at most 30 cylinders** (`refill.maxCylinders`).
- **Only the assigned driver** moves a refill through its steps (the office assigns the driver, and in Inc 1 marks a returned refill complete). **Only the owning distributor** cancels it, and only before pickup. The office has no cancel.
- **Inc 3:** the driver scans pickup and fill. The store's receive scan brings each cylinder back. The refill completes when every picked cylinder is received, even if the station didn't fill them all (Default), and a cylinder becomes Full only when it is back in the store after a fill scan. The screens show how many were filled.
- **No refill money.** The station price is ignored and returned as 0 to every caller; new apps don't read it. `refill.deliveryCost` is reserved and off. If the owner turns it on, it reuses the order debit and reversal with the refill as the subject.

### ADR-17 · Day-end Excel · Decided (Inc 3)
- The system makes the sheet, with one row per cylinder. The distributor uploads it, and the preview changes nothing.
- The super admin **approves all fixes or sends the sheet back**. Approval locks the day. "All fixes" means every change the sheet can name: a move into the store, a state change, a "Missing" (lost) mark, or a new cylinder from the extra list. "On driver's van" or "With customer" that the app doesn't agree with changes nothing (the sheet names no van or customer); the office checks it by hand. Default.
- The lock freezes that day's sheet and summary. It never refuses a scan or anything outside day-end; later moves show on the next sheet (API_CONTRACT §10.2).
- Day-end never moves money.

---

## Platform

### ADR-18 · English now, Urdu-ready · Decided
- Every user-facing string goes through an i18n key, with typed keys so a missing key fails `tsc`.
- The server returns a stable `code`, plain English `message` and `details`. Apps translate `errors.<CODE>`, with English from `packages/shared-types` (`ERROR_MESSAGE_EN`).
- Stored records hold codes, not words: alert types plus context, reason codes, and expense type codes for seeded types.

### ADR-19 · Prisma migrations made without a database · Decided
- Use `prisma migrate diff`: a baseline (`0_baseline`), then expand/contract (inc1a now, inc1b one release later). Hand edits add pre-checks, backfills and CHECK constraints.
- `prisma/scripts/migrate.sh` is the only path to any database. `db push` is used once more, in the baseline release, and never again. See DATA_MODEL §2.

### ADR-20 · Provider interfaces · Design
- **Payments:** `PaymentProvider` (manual bank now, Easypaisa later).
- **Messaging:** `MessagingProvider` (mock now, SMS company next, WhatsApp later).
- **Pricing:** `DeliveryFeeStrategy` (distributor-zone now, zones crossed later).
- Nothing outside the provider knows which one is live.

### ADR-21 · Business day · Default
- Asia/Karachi with a 03:00 cut-off (`day.timezone`, `day.cutoffLocalTime`). Business dates in SQL read both settings, never literals (DATA_MODEL §5.4). Change them only between business days, with no day-end OPEN or SUBMITTED: stored dates never move, but "today" counts and reports regroup.
- The business day is for operational "today" figures and day-end. Expense dates and fuel-log months are plain Asia/Karachi calendar dates, with no cut-off (API_CONTRACT §1.1).
- Every cron passes `timeZone: 'Asia/Karachi'`. Today the housekeeping job (housekeeping.service.ts:16) runs on UTC; it moves to '0 3 * * *' Karachi time. Job times are fixed in code and don't follow the day settings.

### ADR-22 · Human numbers · Design
- `Distributor.code` matches `^[A-Z][A-Z0-9]{1,5}$`. The super admin sets it, for example AG, and it **can't change after the first order**. Old rows are back-filled D01, D02 and so on.
- One `formatNo(code, kind, n)` in shared-utils formats every number. Kinds ORDER, TOPUP, REFILL and CYLINDER are zero-padded to 4, 3, 3 and 4 digits and printed in full when longer (AG-10000, AG-T1000):

  | Kind | Example |
  |---|---|
  | Order | AG-0142 |
  | Top-up | AG-T031 |
  | Refill | AG-R007 |
  | Cylinder (printed on labels; typed as 42, 0042, C0042 or AG-C0042, any letter case) | AG-C0042 |

- Cylinder numbers carry a C, so they never read like an order number. Default: the owner can change the form before labels are printed.
- Numbers come from counter columns on `distributors`, allocated inside the creating transaction.

### ADR-23 · Keep it small · Design
- No big new dependencies. Allowed:
  - `exceljs` (Inc 3);
  - `i18next` and `react-i18next` in the website (already in the monorepo);
  - `@expo/vector-icons` (already in the app binary).
- No job-run table (the nightly wallet check records each run as one `wallet.check` audit row), no message queue for confirmations, no Storybook, no server-driven settings renderer.
- One API instance in the pilot, with plain `@Cron` jobs.

---

## Defaults the owner can change (settings)

| What | Key | Default |
|---|---|---|
| When delivery counts as started (refund cut-off) | `orders.deliveryStartedAt` | `FIRST_LOAD_SCAN` |
| Automatic driver assignment | `dispatch.autoAssign.enabled` | off |
| Top-up minimum / maximum | `topup.minPaisa` / `topup.maxPaisa` | Rs 500 / Rs 50,000 |
| Bank amount differs from request | `topup.onAmountMismatch` | credit the bank amount |
| Pending top-ups per distributor | `topup.maxPendingPerDistributor` | 3 |
| Wallet balance cap (limits top-ups; corrections ignore it) | `wallet.maxBalancePaisa` | none |
| Low-balance warning (when the balance is below it) | `wallet.lowBalancePaisa` | Rs 1,000 |
| Max full cylinders per order | `orders.maxCylindersPerOrder` | 30 |
| Max cylinders per refill | `refill.maxCylinders` | 30 |
| Refill delivery cost | `refill.deliveryCost` | off (reserved) |
| Second approver for large top-ups | `topup.secondApproval` | off (reserved, not built) |
| Customer confirmation | `confirmation.enabled` | off (Inc 2) |
| Answers that open a case | `confirmation.caseOnAnswers` | Not received, Other |
| Confirmation link lifetime | `confirmation.linkTtlHours` | 72 |
| Forgotten IN | `custody.forgottenInPolicy` | block the OUT; office manual delivery |
| Typed cylinder numbers | `custody.typedEntry.enabled` | on (logged) |
| Finish a run with cylinders left on the van | `trip.allowFinishWithLeftovers` | off |
| Walk-in counter swaps | `walkIn.counterSwap.enabled` | off (not built) |
| Business day | `day.timezone`, `day.cutoffLocalTime` | Asia/Karachi, 03:00 |
| Switched-off modules | `features.*` | off |

## Superseded (do not build)
- **Holds:** wallet holds, the available/held split, "On hold" anywhere in the UI.
- **Charges:** charge on delivery, charge on the customer's Yes, the 03:00 no-reply charge, partial or pro-rata charges.
- **Refunds:** refund on No, fee decisions on cases, dispute-driven money corrections.
- **Refill money:** refill fee holds and charges, per-size station prices.
- **Top-up extras:** the second-approval flow, the "not in bank yet" marker, a bank-payments list.
- **Older schema ideas:** `DistributorCounter`, price versions, `job_runs`, the confirmation link table and the encrypted token copy.
- **Gap register:**
  - superseded: MON-03, MON-11, REF-02, REF-04, REF-05, REF-07, CUS-04, CUS-07;
  - narrowed: MON-07 (now the correction tool of ADR-10).

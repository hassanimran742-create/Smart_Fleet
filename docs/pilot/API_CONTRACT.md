# API contract

This doc owns **every route, payload, state machine, error code, settings key and internal service interface**.
- Table and column names come from DATA_MODEL.md.
- Paths are under `/api/v1` (apps/api/src/main.ts:31) unless marked otherwise.
- Each item is tagged **[Inc 1]**, **[Inc 2]** or **[Inc 3]**.

Shared code is the contract:
- `packages/shared-types`: error codes, enums, DTOs, settings keys.
- `packages/shared-validation`: zod request schemas, used by the API, mobile and web.
- `packages/shared-utils`: `formatRs`, `formatNo`, `parseCylinderNo` (§1.1), `deriveOrderStage`, `deriveRefillStage` and `deriveDayEndStage` (§1.4), `normalizePkPhone`, `formatPkPhone` (styles `local` "0300 1234567", `international` "+92 300 1234567", `compact` "03001234567"), `formatWhen`, and the business-date helpers `businessDate(at, { timezone, cutoffLocalTime })` and `businessDayRange(date, { timezone, cutoffLocalTime })` (start inclusive, end exclusive).

Every change is additive unless marked **BREAKING**. BREAKING is used only where the old behaviour is the bug.

---

## 1. Wire conventions

### 1.1 Money, time, numbers
- **Money is integer paisa.**
  - Responses send it as a JSON **string of digits**. `BigInt.prototype.toJSON` is kept (main.ts:13-15), and old apps already call `Number(x)`.
  - Requests accept an integer or a digit string. Field names end in `Paisa`.
  - A signed amount (statement and ledger rows) carries a leading ASCII `-` for money out and no sign otherwise: `"-48000"`, `"500000"`, `"0"`. Request amounts are never negative (400 `VALIDATION_FAILED`, `INVALID_AMOUNT` or `AMOUNT_TOO_SMALL`).
  - Top-ups, corrections and expenses must be whole rupees (`% 100 === 0`, else `AMOUNT_NOT_WHOLE_RUPEES`). Delivery prices must be whole rupees too, but every bad price amount is `PRICE_INVALID` (§7.5).
- **English money** is printed by `formatRs(paisa)` in packages/shared-utils/src/money.ts: "Rs 3,450", "Rs 3,450.50", "−Rs 330" (U+2212) and, with `sign: 'always'`, "+Rs 5,000"; the sign sits right before "Rs" with no space, and zero is never signed. The old `formatPkr` ("Rs. 3,450.00") stays only until no caller is left.
- **Time** is ISO-8601 UTC.
  - The business day is Asia/Karachi with a 03:00 cut-off (`day.timezone`, `day.cutoffLocalTime`). Business dates in SQL follow both settings (DATA_MODEL §5.4). Change them only between business days, with no day-end OPEN or SUBMITTED (an ops rule; the API doesn't refuse it): stored dates never move, while "today" counts and reports regroup at once.
  - `businessDate` is `YYYY-MM-DD`. Expense dates are plain calendar dates `YYYY-MM-DD` in Asia/Karachi, with no 03:00 cut-off; so are fuel-log months.
- **Human numbers:** `formatNo(code, kind, n)`, with kind `ORDER`, `TOPUP`, `REFILL` or `CYLINDER` and `n` a whole number ≥ 0 (else RangeError), gives the following. The number is zero-padded (4 digits for orders and cylinders, 3 for top-ups and refills) and printed in full when longer (`AG-10000`, `AG-T1000`, `AG-C10000`); with no code only the part after the dash is returned.

  | Kind | Example |
  |---|---|
  | Order | `AG-0142` |
  | Top-up | `AG-T031` |
  | Refill | `AG-R007` |
  | Cylinder | `AG-C0042` (C for cylinder); typed as `42`, `0042`, `C0042` or `AG-C0042`, any letter case (`parseCylinderNo`, below) |

  DTOs carry `shortCode`.

  **Typed cylinder numbers** are read by `parseCylinderNo(text, distributorCode?)` in shared-utils. It accepts `42`, `0042`, `C0042` or `AG-C0042`, in any letter case, with spaces ignored and Arabic-Indic or Urdu digits allowed (1–6 digits, value at least 1). A written code must be the distributor in context: the run's for a driver scan, the caller's for the shop (store scans, cylinder history), the order's for the office's manual delivery. Without a distributor in context (the office's Find cylinder and cylinder history), only the full `AG-C0042` form or the QR value resolves. Anything else, including an order-style `AG-0042` or another distributor's code, is unknown: `SCAN_CYLINDER_UNKNOWN` for a scan, 404 `NOT_FOUND` for a lookup.
- **Phones** are stored and sent as E.164 `+923XXXXXXXXX`. `normalizePkPhone` accepts a Pakistani mobile written as `0300 1234567`, `300 1234567`, `+92 300 1234567`, `92 300 1234567` or `0092 300 1234567`, with spaces, dashes, dots or brackets, in ASCII, Arabic-Indic or Urdu digits, and drops a stray `0` after the country code (`+92 0300 1234567`). Landlines, other countries, letters and wrong lengths give null. `formatPkPhone` prints them: `local` "0300 1234567" (the apps and the customer page), `international` "+92 300 1234567" (the website), `compact` "03001234567" (SMS text).

### 1.2 Headers
- **Sent by new builds:**
  - `X-App-Variant: driver|distributor|admin-web`
  - `X-App-Version: x.y.z`
  - `X-Request-Id: <uuid>`
  - `Idempotency-Key: <uuid v4>` on every create and money action (§4.2 and the routes that name it say how it is used; any other route ignores it)
  - `Accept-Language: en`
- **Returned:**
  - always: `X-Request-Id`;
  - when relevant: `Idempotent-Replay: true`, `X-Already-Applied: true`, `X-Feature-Disabled: <name>`.

  These are exposed through CORS.
- **Status codes:** a POST that creates the record it returns answers **201** (a replay of it 200 with `Idempotent-Replay`; `POST /files/upload` answers 201 also when it returns an existing identical picture). Every other success answers **200**, including actions sent as POST (sign-in, refresh, change-password, quote, approve, reject, cancel, fail, assign, manual delivery, share, new link, void, archive, restore, resolve, finish, day-end upload and submit, push-token register). The public form `POST /c/:token` answers 303 (CUSTOMER_PAGE §4). No route answers 204.

### 1.3 Lists
- **New list endpoints** return `{ items, nextCursor }`, with `?limit` (a whole number 1–100, default 30) and `&cursor`. The cursor is opaque: base64url of `(list tag, sortKey, id)`. The tag names the list that made it: its path (lower case, without the query) and its `tab`. Each tab is its own list (the board's needs-driver tab sorts oldest first, the others newest first); other filters are not part of it. A limit outside 1–100 or not a whole number gives 400 `VALIDATION_FAILED` on `limit` (`TOO_LARGE` `{max: 100}`, `TOO_SMALL` `{min: 1}`, `INVALID_TYPE` or `NOT_INTEGER`); nothing is clamped. A cursor this list or tab didn't make, a malformed one, or one holding a date outside the years 1–9999 gives 400 `VALIDATION_FAILED` on `cursor` (code `INVALID_VALUE`). A cursor issued before the tag existed gets this 400 once after the deploy. The bare-array lists below ignore both.
- **Existing list endpoints** called by installed apps keep returning **bare arrays**:
  - `GET /orders` (no `tab`)
  - `GET /ledger/me`
  - `GET /payments/mine`
  - `GET /filling-orders/mine`
  - `GET /filling-orders/driver/mine`
  - `GET /trips/mine`
  - `GET /clients`

### 1.4 Words the server derives (apps only map them to i18n keys)
Enum values are API values only. Apps show `enum.<Enum>.<VALUE>` or the keys named in the UX docs, and never show raw values such as `PAID_VIA_LEDGER`.

**`OrderStage`**, computed by `deriveOrderStage(order)` in shared-utils:

| Stage | When |
|---|---|
| `CANCELLED` | status CANCELLED |
| `NOT_DELIVERED` | status FAILED |
| `DELIVERED` | status DELIVERED |
| `ON_THE_WAY` | status IN_TRANSIT, or `onTheWayAt` set |
| `LOADING` | status ASSIGNED and `loadStartedAt` set |
| `DRIVER_ASSIGNED` | status ASSIGNED |
| `NEEDS_DRIVER` | status PENDING or CONFIRMED |

LOADING lasts from the first load scan until the store stop departs ("Done loading" in Inc 2); starting a trip never makes an order ON_THE_WAY. The customer's confirmation answer (Inc 2) is a separate field, never a stage.

**`RefillStage`**, computed by `deriveRefillStage(refill)` in shared-utils and sent as `stage` on every refill DTO from Inc 1, with `counts: { requested, picked, filled, received }`. Inc 1 takes the counts from `requestedCount`, `pickedUpEmptyCount` and `filledCount` (missing = 0), with received = picked once the status is RETURNED or COMPLETED; Inc 3 counts the lines. The first match wins:

| Stage | When |
|---|---|
| `CANCELLED` | status CANCELLED, or legacy FAILED |
| `DONE` | status COMPLETED |
| `BACK_AT_STORE` | Inc 1: status RETURNED; Inc 3: received ≥ 1 |
| `COMING_BACK` | status FILLED |
| `AT_STATION` | status AT_STATION |
| `PICKED_UP` | status EMPTIES_PICKED |
| `PICKING_UP` | status ASSIGNED and picked ≥ 1 |
| `DRIVER_ASSIGNED` | status ASSIGNED |
| `NEEDS_DRIVER` | status PENDING |

The shop app (UX_MOBILE §8.1) and the website (UX_ADMIN §4.1) map these values to their own words.

**`OrderFeeStatus`** (`fee.status`): `NONE`, `DEDUCTED`, `REVERSED`.

**`DayEndStage`** [Inc 3], computed by `deriveDayEndStage(day)` in shared-utils and sent as `stage` on every day-end DTO, first match wins:

| Stage | When |
|---|---|
| `APPROVED` | status APPROVED |
| `WAITING_FOR_APPROVAL` | status SUBMITTED |
| `SENT_BACK` | status OPEN, with a send-back or reopen (`sent_back_at`, `reopened_at`) and no upload since the later one |
| `READY` | status OPEN, and the latest upload is newer than the newest sheet (`uploaded_at > sheet_snapshot_at`) |
| `NOT_STARTED` | otherwise, or no day row |

**`PaymentDto.stage`:**

| Stage | Status |
|---|---|
| `BEING_CHECKED` | PENDING |
| `ADDED` | SUCCESS |
| `NOT_ADDED` | REJECTED, or legacy FAILED |

**`StatementKind`**, mapped from the ledger:

| Kind | Ledger row |
|---|---|
| `TOPUP_ADDED` | `CREDIT_TOPUP` |
| `DELIVERY_COST` | `DEBIT_ORDER` |
| `DELIVERY_COST_RETURNED` | `CREDIT_ORDER_REVERSAL` |
| `OPENING_BALANCE` | `ADJUSTMENT` with reason `OPENING_BALANCE`: the migration's opening entry, the test setup's opening balance, or an office correction with that reason |
| `CORRECTION` | `ADJUSTMENT` with any other reason |
| `LEGACY` | `ADJUSTMENT` with no reason (old rows, including old refill debits) |
| `REFILL_DELIVERY_COST` | `DEBIT_REFILL` (reserved; never written while `refill.deliveryCost` is off) |

### 1.5 Reason code lists (one list each; text columns, TypeScript unions in shared-types)
| Union | Values |
|---|---|
| `OrderCancelReason` | `CUSTOMER_CANCELLED`, `WRONG_ORDER`, `DUPLICATE`, `OUT_OF_STOCK`, `OTHER` |
| `DeliveryFailureReason` | `CUSTOMER_NOT_HOME`, `CUSTOMER_REFUSED`, `WRONG_ADDRESS`, `NOT_REACHABLE`, `VAN_PROBLEM`, `OTHER` |
| `TopupRejectReason` | `NOT_IN_BANK`, `AMOUNT_DIFFERENT`, `NAME_DIFFERENT`, `DUPLICATE`, `OTHER` |
| `CorrectionReason` | `WRONG_TOPUP_APPROVAL`, `SYSTEM_ERROR`, `BANK_REVERSAL`, `OPENING_BALANCE`, `OTHER` |
| `TakeBackShortReason` [Inc 2] | `CUSTOMER_KEPT`, `CUSTOMER_HAD_NONE`, `OTHER` |

`OTHER` always needs a note of 3–300 characters. When the office cancels an order or marks it could not deliver, a note of 5–300 characters is always required, whatever the code (an office `OTHER` included).

### 1.6 `allowedActions`
Order, trip, stop, payment, refill, day-close and case DTOs carry `allowedActions: string[]`. The server decides which buttons the caller may press, so apps never duplicate rules and each screen shows one primary action.

For orders:

| Action | Caller | Offered when |
|---|---|---|
| `CANCEL` | owning distributor, office | `cancel.allowed`: status PENDING, CONFIRMED, ASSIGNED or IN_TRANSIT, and no hand-over started |
| `ASSIGN` | office | status PENDING or CONFIRMED |
| `REASSIGN` | office | status ASSIGNED, `loadStartedAt` null, and no cylinder event on its trip other than a hand-back at the store (SCAN_IN): exactly when assign-driver accepts it (§7.6 rule 4), so a hand-over or an empty taken back hides it |
| `MARK_FAILED` | office, the trip's driver | status ASSIGNED or IN_TRANSIT, delivery started under the current `orders.deliveryStartedAt`, and no hand-over started |
| `MANUAL_DELIVERY` | office | status ASSIGNED or IN_TRANSIT |
| `TRACK` | owning distributor, office | stage ON_THE_WAY |

The actions are listed in this order and are `[]` for DELIVERED, CANCELLED and FAILED orders. They are computed per request, so a settings change shows at once.

---

## 2. Errors

### 2.1 Envelope
This replaces common/filters/http-exception.filter.ts.
```json
{ "statusCode": 409, "code": "WALLET_INSUFFICIENT_BALANCE",
  "message": "Not enough balance. This needs Rs 330 and you have Rs 120. Add money to continue.",
  "details": { "requiredPaisa": "33000", "balancePaisa": "12000", "shortByPaisa": "21000" },
  "error": "WALLET_INSUFFICIENT_BALANCE", "requestId": "…", "path": "/api/v1/orders", "timestamp": "…" }
```
- **`code`** is a stable UPPER_SNAKE value from `ErrorCode` in **packages/shared-types/src/errors.ts**. That file exports:
  - `ErrorCode` (a string union),
  - `ERROR_HTTP: Record<ErrorCode, number>`,
  - `ERROR_MESSAGE_EN: Record<ErrorCode, string>` (i18next templates using `{{param}}`),
  - `ClientErrorCode = 'NETWORK_OFFLINE' | 'NETWORK_TIMEOUT' | 'UNKNOWN'` (apps only).
- **`message`** is always one plain-English string: never an array, a stack trace or internal text.
- **`error`** repeats `code` for old clients.
- **`path`** has `/c/<token>` redacted [Inc 2].
- **Template parameters** come from `details`; §2.3 lists the keys of each code. A key ending in `Paisa` is formatted with `formatRs` and loses its suffix: `requiredPaisa` becomes `{{required}}`. A key named `date` or ending in `Date` whose value is a `YYYY-MM-DD` date is shown with `formatIsoDay` ("Tue 20 Oct") under the same name. Other keys are used as they are.
- **Apps** translate `errors.<CODE>` with `details`. The English resource **is** `ERROR_MESSAGE_EN`, so there is one English source. Apps fall back to `message`.
- **Login errors never contain "OTP" or "one-time code"**: the installed PhoneScreen.tsx:52-55 jumps to the OTP flow when they do.

### 2.2 Mapping
- **Services** throw `new AppError(code, details?)` (common/errors/app-error.ts). The global filter maps everything else:
  - zod or class-validator errors become 400 `VALIDATION_FAILED`, with `details.fields: [{ path, code, message }]`;
  - when every field problem carries the same promoted code (`AMOUNT_NOT_WHOLE_RUPEES`, `PRICE_INVALID`, `DISTRIBUTOR_CODE_INVALID`, `ORDER_LINES_INVALID`, `SCAN_EVENT_NOT_ALLOWED`, `TOPUP_BANK_REFERENCE_REQUIRED`, `REFILL_INVALID_COUNT`, and from Inc 2 `SCAN_RETURN_STATE_REQUIRED`), the answer is that code, with its own HTTP status and the same `details.fields` (shared-validation `primaryErrorCode`); a mix stays 400 `VALIDATION_FAILED`, each field with its own code;
  - Prisma `P2002` becomes the constraint's code from DATA_MODEL §7, or else 409 `CONFLICT_DUPLICATE`;
  - Prisma `P2025` becomes 404 `NOT_FOUND`;
  - a database that can't be reached or times out (Prisma `P1001`, `P1002`, `P1008`, `P1017`, `P2024`, `P2028`, a client initialisation error, SQLSTATE `57014`), object storage refusing an upload, or any upstream 503 becomes 503 `SERVICE_UNAVAILABLE` (retryable: the apps retry GETs, and the user repeats a mutation with the same Idempotency-Key);
  - a deadlock or serialization failure (`P2034`, SQLSTATE `40001`, `40P01`) becomes 409 `CONFLICT_STALE_STATE`, and a malformed id (`P2023`, SQLSTATE `22P02`) 404 like an unknown record;
  - Redis being down never fails a request (§3.6);
  - CHECK violation `23514` on `distributors_balance_chk` becomes `WALLET_INSUFFICIENT_BALANCE`;
  - a value the database can't store or compare becomes 400 `VALIDATION_FAILED` with `details.fields: []`, logged as a warning and not sent to Sentry. This covers SQLSTATE class 22 from raw SQL (`P2010`) or the model API (a NUL character 22021, an untranslatable character 22P05, a date out of range 22008, a number out of range 22003, text too long 22001; `22P02` stays 404 as above), Prisma `P2000` and `P2033`, and Prisma's "Could not convert argument value". The shared schemas refuse these first: text and search fields refuse a NUL character (`INVALID_VALUE`), and an ISO instant must fall in the years 1–9999 (`INVALID_DATETIME`);
  - a body the JSON or form parser refuses before Nest runs (over the 100 KB limit, a connection dropped mid-body, an unknown charset or content encoding) becomes 400 `VALIDATION_FAILED` with `details.fields: []`, logged at debug and never sent to Sentry (an aborted request gets no answer anyway);
  - anything else becomes 500 `INTERNAL_ERROR`. The raw error goes only to the logs and Sentry, with the requestId. Today http-exception.filter.ts:24-27 returns the raw `Error.message`.
- **New routes validate bodies** with the shared zod schemas through a parameter pipe: `@Body(new ZodBody(schema)) body: T` (nestjs-zod 3 is already a dependency). The global class-validator pipe (main.ts:23-29) ignores non-class types, so the two don't clash.
- **Logs.** Every line goes out as JSON through pino (readable lines in local development). `LOG_LEVEL` applies (default info; debug in local development). Passwords, codes, token hashes and CNICs are redacted, and `BETTER_STACK_TOKEN` also ships the lines to Better Stack. Every line written inside a request carries its `requestId`.
  Every request also writes one line when it ends: `<METHOD> <route pattern> <status> <ms>ms requestId=<id> userId=<id>`, plus "(client went away)" when the connection closed first. It holds the route pattern, never the path's ids, the query string or the body; an unmatched path is logged without its query, with a `/c/` token redacted. So the requestId an error screen shows as its Reference always finds the request.

### 2.3 Catalogue
These codes are the whole list. Adding a code means adding its HTTP status, its English message and an `errors.<CODE>` key in both apps, and a unit test enforces that. Each code has one English string, so a counted `{{param}}` is worded to read right for 1 and for many (the catalogue has no plural forms).

**Details keys.** `ErrorDetailsMap` (types) and `ERROR_DETAIL_KEYS` (runtime) in errors.ts are the source, and a compile-time check fails when an English template uses a `{{param}}` that isn't one of its code's keys once `Paisa` is dropped. Any code may also carry `currentStatus` (§4.3), and scan refusals carry `progress` (§9.3). A code not listed carries no other details. A key added anywhere in this contract is added to errors.ts in the same pull request.

| Code | `details` |
|---|---|
| VALIDATION_FAILED | `fields: [{ path, code, message, params? }]` |
| NOT_FOUND | `field?` (the missing reference, for example `vehicleId`) |
| RATE_LIMITED | `minutes`: whole minutes until the window resets, rounded up, at least 1 (plus a `Retry-After` header in seconds) |
| INTERNAL_ERROR | `reason?` (never a raw error) |
| AUTH_WRONG_APP | `role`, `app` |
| USER_PHONE_IN_USE | `existingRole?` |
| DISTRIBUTOR_CODE_IN_USE | `code` (the code asked for) |
| CLIENT_PHONE_EXISTS | `clientId`, `name` |
| PRICING_PRICE_NOT_SET | `zoneId`, `zoneName` |
| PRICING_QUOTE_CHANGED | `totalPaisa`, `quote` |
| ORDER_TOO_MANY_CYLINDERS | `max` (`orders.maxCylindersPerOrder`) |
| ORDER_INVALID_TRANSITION | `from`, `to` |
| ORDER_CANCEL_TERMS_CHANGED | `refundPaisa` |
| ASSIGN_DRIVER_NOT_AVAILABLE, ASSIGN_DRIVER_NO_VEHICLE | `driver` (the driver's name) |
| ASSIGN_ORDER_LOADED | `plateNo` |
| DELIVERY_SCANS_INCOMPLETE | `missing: [{ sizeLabel, needed, given }]` |
| TAKE_BACK_SHORT | `expected`, `taken` |
| MANUAL_DELIVERY_CYLINDERS_MISMATCH | `problems: [{ code, reason, holderType? }]`, `sizes: [{ cylinderTypeId, sizeLabel, needed, named }]`; reason is WRONG_OWNER, NOT_FULL, BLOCKED, WRONG_SIZE, NOT_AVAILABLE, NOT_WITH_THIS_CUSTOMER or LISTED_TWICE (§9.5) |
| TRIP_VAN_NOT_EMPTY | `count`, `cylinders`, `leftoversAllowed` (§9.3) |
| LOAD_INCOMPLETE | `total`, `done`, `lines` |
| VEHICLE_HAS_CYLINDERS | `count` |
| SCAN_CYLINDER_UNKNOWN | `code?` (the code that wasn't found, from a manual delivery) |
| SCAN_NOT_AT_STORE | `store` (the store's name) |
| SCAN_SIZE_NOT_IN_ORDER | `sizeLabel` |
| SCAN_COUNT_REACHED | `needed`, `sizeLabel` |
| CASE_ALREADY_RESOLVED | `by` (the name of whoever closed it) |
| TOPUP_AMOUNT_TOO_SMALL, TOPUP_AMOUNT_TOO_LARGE | `minPaisa`, `maxPaisa` |
| TOPUP_WOULD_EXCEED_CAP | `capPaisa`, `maxNowPaisa` |
| TOPUP_TOO_MANY_PENDING | `count` (requests being checked now) |
| TOPUP_NOT_PENDING | `status`, `reviewedBy`, `reviewedAt` |
| TOPUP_BANK_REFERENCE_USED | `paymentShortCode`, `distributorName`, `approvedAt` |
| WALLET_INSUFFICIENT_BALANCE | `requiredPaisa`, `balancePaisa` (the real, signed balance; below zero only for a legacy wallet before inc1b), `shortByPaisa` (`requiredPaisa` − `balancePaisa`, the same as the quote's `wallet.shortByPaisa`) |
| WALLET_ADJUST_EXCEEDS_BALANCE | `balancePaisa` |
| FILE_TOO_LARGE | `maxMb` |
| EXPENSE_TYPE_NAME_TAKEN, EXPENSE_TYPE_ARCHIVED, EXPENSE_TYPE_LOCKED | `name` (the type's name) |
| REFILL_TOO_MANY | `max` |
| REFILL_CYLINDER_WRONG_SIZE | `sizeLabel` |
| REFILL_COUNT_REACHED | `requested` |
| DAY_SHEET_WRONG_DATE | `sheetDate`, `date` |
| DAY_SHEET_ROW_ERRORS | `rows: [{ sheet, row, code, message }]`, `total` (§10.2) |

**General**
| Code | HTTP | English (`ERROR_MESSAGE_EN`) |
|---|---|---|
| VALIDATION_FAILED | 400 | Some details need fixing. |
| AMOUNT_NOT_WHOLE_RUPEES | 400 | Enter whole rupees, with no paisa. |
| NOT_FOUND | 404 | We couldn't find this. It may have been removed. |
| PERMISSION_DENIED | 403 | Your account can't do this. |
| FEATURE_DISABLED | 403 | This isn't available yet. |
| RATE_LIMITED | 429 | Too many tries. Please wait {{minutes}} min and try again. |
| APP_UPDATE_REQUIRED | 426 | Please update the app to continue. |
| CONFLICT_STALE_STATE | 409 | This changed while you were looking. Refresh and try again. |
| CONFLICT_DUPLICATE | 409 | This already exists. |
| IDEMPOTENCY_CONFLICT | 409 | This was already sent with different details. Start again. |
| INTERNAL_ERROR | 500 | Something went wrong on our side. Please try again. |
| SERVICE_UNAVAILABLE | 503 | The service is busy. Please try again in a minute. |

**Client-only (`ClientErrorCode`)**
| Code | English |
|---|---|
| NETWORK_OFFLINE | No connection. Try again. |
| NETWORK_TIMEOUT | This is taking too long. Check your signal and try again. |
| UNKNOWN | Something went wrong. Please try again. |

**Auth and users**
| Code | HTTP | English |
|---|---|---|
| AUTH_INVALID_CREDENTIALS | 401 | Wrong phone number or password. |
| AUTH_ACCOUNT_NOT_ACTIVE | 403 | This account isn't active. Call the office. |
| AUTH_ROLE_LOCKED | 403 | This account can't sign in. Call the office. |
| AUTH_WRONG_APP | 403 | This account is for the {{app}}. |
| AUTH_OTP_DISABLED | 403 | Sign in with your password. |
| AUTH_SESSION_REVOKED | 401 | Please sign in again. |
| AUTH_TOKEN_INVALID | 401 | Please sign in again. |
| AUTH_REFRESH_INVALID | 401 | Please sign in again. |
| USER_PHONE_IN_USE | 409 | This phone number is already used by another account. |
| USER_CNIC_IN_USE | 409 | This CNIC is already registered. |
| USER_FIELD_OFFICE_ONLY | 403 | Ask the office to change this. |
| USER_ROLE_CHANGE_NOT_ALLOWED | 403 | This role change isn't allowed. |
| USER_SELF_CHANGE_NOT_ALLOWED | 403 | You can't change your own account this way. |
| USER_LAST_SUPER_ADMIN | 409 | At least one active super admin must remain. |

For `AUTH_WRONG_APP`, `details` is `{ role, app }`. `app` is one of "Smart Fleet shop app", "Smart Fleet Driver app" or "Smart Fleet Office website".

**Distributors, stores, zones, customers**
| Code | HTTP | English |
|---|---|---|
| DISTRIBUTOR_NOT_ACTIVE | 403 | This shop account isn't active. Call the office. |
| DISTRIBUTOR_NO_STORE | 409 | This shop has no store set up yet. Call the office. |
| DISTRIBUTOR_CODE_IN_USE | 409 | Another shop already uses the code {{code}}. |
| DISTRIBUTOR_CODE_INVALID | 400 | Use 2 to 6 capital letters or digits, starting with a letter. |
| DISTRIBUTOR_CODE_LOCKED | 409 | The shop code can't change after the first order. |
| STORE_OUTSIDE_ZONES | 422 | This spot is outside every active zone. Move the pin. |
| STORE_IN_USE | 409 | This store belongs to a shop and can't be removed. |
| ZONE_INVALID_SHAPE | 400 | This zone shape isn't valid. |
| ZONE_ARCHIVED | 409 | This zone is archived. |
| CLIENT_NOT_FOUND | 404 | We couldn't find this customer. |
| CLIENT_ADDRESS_NOT_FOUND | 404 | We couldn't find this address. |
| CLIENT_PHONE_INVALID | 400 | Enter a number like 300 1234567. |
| CLIENT_PHONE_EXISTS | 409 | {{name}} already has this number. Pick them from the list. |

**Pricing**
| Code | HTTP | English |
|---|---|---|
| PRICING_ZONE_NOT_COVERED | 422 | This location is outside our delivery area. |
| PRICING_PRICE_NOT_SET | 422 | No delivery price is set for {{zoneName}} yet. Ask the office to set it. |
| PRICING_QUOTE_CHANGED | 409 | The delivery cost is now {{total}}. Check it and place the order again. |
| PRICE_INVALID | 400 | Enter whole rupees, from Rs 0 to Rs 100,000. |

**Orders, trips, assignment**
| Code | HTTP | English |
|---|---|---|
| ORDER_LINES_INVALID | 400 | Add at least one full cylinder, one line per size. |
| ORDER_TOO_MANY_CYLINDERS | 400 | Too many cylinders. An order can have at most {{max}}. |
| ORDER_INVALID_TRANSITION | 409 | This order can't move to that step now. Refresh and try again. |
| ORDER_NOT_CANCELLABLE | 409 | This order is already finished. |
| ORDER_HANDOVER_STARTED | 409 | Cylinders were already handed over. Call the office. |
| ORDER_CANCEL_TERMS_CHANGED | 409 | Delivery has just started. The refund is now {{refund}}. |
| ORDER_NOT_STARTED_USE_CANCEL | 409 | Delivery hasn't started. Cancel the order instead. |
| ORDER_NOT_ON_YOUR_TRIP | 403 | This order isn't on your trip. |
| ORDER_USE_MANUAL_DELIVERY | 400 | Use "Mark delivered by office" for this. |
| ORDER_NOT_ASSIGNABLE | 409 | This order can't get a driver now. |
| ASSIGN_DRIVER_NOT_AVAILABLE | 409 | {{driver}} can't take jobs right now. |
| ASSIGN_DRIVER_NO_VEHICLE | 409 | {{driver}} has no van. Give them a van first. |
| ASSIGN_ORDER_LOADED | 409 | Cylinders are already loaded on {{plateNo}}, so this order can't change driver. |
| DISPATCH_AUTO_OFF | 403 | Automatic assignment is switched off. |
| TRIP_INVALID_TRANSITION | 409 | This trip can't move to that step now. |
| TRIP_ORDERS_OPEN | 409 | Finish or close every order on this trip first. |
| DELIVERY_SCANS_INCOMPLETE [Inc 2] | 409 | Scan every cylinder before you finish the visit. |
| TAKE_BACK_SHORT [Inc 2] | 409 | The customer gave back {{taken}} of {{expected}}. Say why to finish. |
| MANUAL_DELIVERY_CYLINDERS_MISMATCH [Inc 2] | 409 | The cylinders don't match the order. |
| TRIP_STOPS_OPEN [Inc 2] | 409 | Finish every stop first. |
| TRIP_VAN_NOT_EMPTY [Inc 2] | 409 | The store must scan in {{count}} more from your van. |
| LOAD_INCOMPLETE [Inc 2] | 409 | Load every cylinder first: {{done}} of {{total}} loaded so far. |
| VEHICLE_HAS_CYLINDERS [Inc 2] | 409 | This van still has cylinders on it ({{count}}). Unload at the store first. |

**Scans** (Inc 1 legacy route; Inc 2 scan service)
| Code | HTTP | English |
|---|---|---|
| SCAN_CYLINDER_UNKNOWN | 404 | We don't know this cylinder. Check the label. |
| SCAN_EVENT_NOT_ALLOWED | 403 | This scan isn't allowed. |
| SCAN_USE_STORE_RECEIVE [Inc 2] | 403 | Ask the store to scan it in. |
| SCAN_TRIP_CLOSED | 409 | This trip is closed. |
| SCAN_STOP_CLOSED [Inc 2] | 409 | This step is already done. |
| SCAN_NOT_AT_STORE | 409 | This cylinder isn't in {{store}}'s stock. Load only from this store. |
| SCAN_WRONG_OWNER | 409 | This cylinder belongs to another shop. |
| SCAN_NOT_FULL | 409 | This cylinder isn't full. Load only full cylinders. |
| SCAN_CYLINDER_BLOCKED | 409 | Marked damaged or lost. Put it aside. Call office. |
| SCAN_NOT_ON_YOUR_VAN | 409 | Not loaded on your van. Don't deliver it. Call office. |
| SCAN_TAKEN_BACK_NOT_UNLOADED [Inc 2] | 409 | Taken back from a customer. Unload it at the store first. |
| SCAN_SIZE_NOT_IN_ORDER [Inc 2] | 409 | This is {{sizeLabel}}. This order doesn't need it. |
| SCAN_COUNT_REACHED [Inc 2] | 409 | You already have all {{needed}} × {{sizeLabel}}. |
| SCAN_LOAD_NOT_NEEDED [Inc 2] | 409 | This size isn't needed on this trip any more. |
| SCAN_NOT_WITH_THIS_CUSTOMER | 409 | Our records don't show this cylinder with this customer. |
| SCAN_GIVEN_THIS_VISIT | 409 | You just delivered this one. You can't take it back now. |
| SCAN_RETURN_STATE_REQUIRED [Inc 2] | 400 | Choose Empty, Part-filled or Full first. |
| SCAN_NOT_ON_A_VAN [Inc 2] | 409 | This cylinder isn't on a van. |
| SCAN_ID_REUSED [Inc 2] | 409 | This scan was already used for something else. Scan again. |

`SCAN_EVENT_NOT_ALLOWED` also answers an Inc 2 scan whose action doesn't fit the stop (a LOAD away from the STORE_PICKUP stop, a HANDOVER or TAKE_BACK away from a DELIVERY stop) and an unlabelled-returns PUT on the STORE_PICKUP stop (§9.2 step 3).

**Customer confirmation and cases** [Inc 2]
| Code | HTTP | English |
|---|---|---|
| CONFIRM_LINK_INVALID | 404 | This link isn't valid. |
| CONFIRM_LINK_EXPIRED | 410 | This link has expired. |
| CONFIRM_LINK_INACTIVE | 410 | This link is no longer active. |
| CONFIRM_ALREADY_ANSWERED | 409 | This delivery was already answered. |
| CONFIRM_NOTE_REQUIRED | 400 | Please write a few words. |
| CONFIRM_NOT_READY | 409 | This order isn't delivered yet. |
| CONFIRM_CLOSED | 409 | The customer can no longer answer for this order. |
| CASE_ALREADY_RESOLVED | 409 | This problem was already sorted by {{by}}. |

`CONFIRM_LINK_INVALID`, `CONFIRM_LINK_INACTIVE`, `CONFIRM_LINK_EXPIRED`, `CONFIRM_ALREADY_ANSWERED` and `CONFIRM_NOTE_REQUIRED` are raised only by the public link page: `PublicPageExceptionFilter` renders each as its HTML page with the code's status, never JSON (CUSTOMER_PAGE §5). The JSON routes use `CONFIRM_NOT_READY` and `CONFIRM_CLOSED`.

**Top-ups and wallet**
| Code | HTTP | English |
|---|---|---|
| TOPUP_AMOUNT_TOO_SMALL | 400 | The minimum top-up is {{min}}. |
| TOPUP_AMOUNT_TOO_LARGE | 400 | The maximum top-up is {{max}}. |
| TOPUP_WOULD_EXCEED_CAP | 409 | Your balance can't go above {{cap}}. You can add up to {{maxNow}} now. |
| TOPUP_TOO_MANY_PENDING | 409 | Top-ups being checked: {{count}}. Wait for them before sending another. |
| TOPUP_NOT_PENDING | 409 | This request was already handled. |
| TOPUP_BANK_REFERENCE_REQUIRED | 400 | Type the bank reference from the company bank app. |
| TOPUP_BANK_REFERENCE_USED | 409 | Already used for {{paymentShortCode}} ({{distributorName}}). Check it, or reject as a duplicate. |
| TOPUP_BANK_TIME_IN_FUTURE | 400 | The bank time can't be in the future. |
| TOPUP_AMOUNT_MISMATCH | 409 | Amounts must match. Reject and ask for a new request. |
| TOPUP_ACCOUNT_NOT_CONFIGURED | 503 | Top-ups aren't open yet. Call the office. |
| PAYMENT_WEBHOOK_DISABLED | 410 | Online payments are switched off. |
| WALLET_INSUFFICIENT_BALANCE | 409 | Not enough balance. This needs {{required}} and you have {{balance}}. Add money to continue. |
| WALLET_ADJUST_EXCEEDS_BALANCE | 409 | The balance is only {{balance}}. You can't take more than that. |

**Files**
| Code | HTTP | English |
|---|---|---|
| FILE_TYPE_NOT_ALLOWED | 415 | Use a JPG, PNG or WebP picture. |
| FILE_TOO_LARGE | 413 | This file is too big. The limit is {{maxMb}} MB. |
| FILE_NOT_FOUND | 404 | We couldn't find this file. Upload it again. |

**Expenses**
| Code | HTTP | English |
|---|---|---|
| EXPENSE_TYPE_NAME_TAKEN | 409 | There's already a type called {{name}}. |
| EXPENSE_TYPE_ARCHIVED | 409 | {{name}} is archived. Pick another type or restore it. |
| EXPENSE_TYPE_LOCKED | 409 | {{name}} can't be archived. |
| EXPENSE_DATE_IN_FUTURE | 400 | The date can't be in the future. |
| EXPENSE_ALREADY_VOIDED | 409 | This expense was already removed. |

**Refills**
| Code | HTTP | English |
|---|---|---|
| REFILL_DIY_RETIRED | 410 | Do-it-yourself refills are no longer used. Request a refill instead. |
| REFILL_TOO_MANY | 400 | Too many cylinders. A refill can have at most {{max}}. |
| REFILL_NOT_CANCELLABLE | 409 | This refill can't be cancelled after pickup. |
| REFILL_INVALID_COUNT | 400 | Check the number of cylinders. |
| REFILL_STATION_INACTIVE | 409 | This station isn't taking refills. |
| REFILL_WRONG_STEP | 409 | This refill isn't at that step. |
| REFILL_CYLINDER_WRONG_SIZE [Inc 3] | 409 | This refill is for {{sizeLabel}} only. |
| REFILL_CYLINDER_NOT_EMPTY [Inc 3] | 409 | Only empty or part-filled cylinders go for refill. |
| REFILL_CYLINDER_ON_OTHER_REFILL [Inc 3] | 409 | This cylinder is already on another refill. |
| REFILL_COUNT_REACHED [Inc 3] | 409 | All picked up: {{requested}} of {{requested}}. |
| REFILL_CYLINDER_NOT_ON_THIS_REFILL [Inc 3] | 409 | This cylinder wasn't picked up for this refill. |
| REFILL_USE_SCANS [Inc 3] | 410 | Update the app to continue. |
| REFILL_AUTO_COMPLETES [Inc 3] | 410 | Refills now finish by themselves when the store scans them in. |

**Day-end** [Inc 3]
| Code | HTTP | English |
|---|---|---|
| DAY_NOT_FOUND | 404 | We couldn't find this day. |
| DAY_LOCKED | 409 | This day is closed. Ask the office to reopen it. |
| DAY_SHEET_UNREADABLE | 422 | This file isn't the day-end sheet. Download today's sheet and try again. |
| DAY_SHEET_WRONG_DISTRIBUTOR | 422 | This sheet belongs to another shop. |
| DAY_SHEET_WRONG_DATE | 422 | This sheet is for {{sheetDate}}. Upload the sheet for {{date}}. |
| DAY_SHEET_OUTDATED | 422 | This is an old copy. Download a new sheet and use that. |
| DAY_SHEET_ROW_ERRORS | 422 | Some rows couldn't be read. Fix them and upload again. |
| DAY_ALREADY_SUBMITTED | 409 | This day was already sent for approval. |
| DAY_NOT_SUBMITTED | 409 | This day hasn't been sent for approval. |
| DAY_SHEET_NOT_UPLOADED | 409 | Upload the filled sheet first. |
| DAY_VERSION_CHANGED | 409 | A newer sheet was uploaded. Load the new version. |

**Settings and legacy**
| Code | HTTP | English |
|---|---|---|
| SETTING_UNKNOWN | 404 | Unknown setting. |
| SETTING_INVALID_VALUE | 400 | This value isn't allowed here. |
| SETTING_NOT_EDITABLE | 403 | This setting can't be changed here. |
| RECONCILIATION_RETIRED [Inc 3] | 410 | The day-end sheet replaces this form. |

---

## 3. Who may call what

### 3.1 Roles
- **The office is SUPER_ADMIN.** ADMIN, DISPATCHER, STORE_KEEPER and CLIENT are refused at login, at refresh and on every request while they are in `auth.lockedRoles`.
  - This closes the ADMIN self-promotion hole without editing every `@Roles(ADMIN, …)`, because roles.guard.ts:26 already lets SUPER_ADMIN through.
- **`@ExactRoles(UserRole.X)`** (new decorator, same guard) turns off the SUPER_ADMIN bypass. It is used for actions only the actor may take:
  - distributor routes (place order, top-up request, add customer, wallet);
  - driver routes (scans, delivered, location).

  Routes the office may also use (cancel, fail) use plain `@Roles(DISTRIBUTOR or DRIVER)`, so SUPER_ADMIN passes, plus an ownership policy.
- **Office overrides** are separate endpoints that need a reason and write the audit row in the same transaction.

### 3.2 Ownership policies (common/auth/policies.ts)
Each policy answers **404** when the record isn't the caller's, so its existence doesn't leak. The code is the resource's own not-found code where §2.3 has one, else `NOT_FOUND`: customers `CLIENT_NOT_FOUND` (a path id, `/clients/:id/addresses`, `PATCH /clients/:id` or a body `clientId`), addresses `CLIENT_ADDRESS_NOT_FOUND`, files `FILE_NOT_FOUND`, day-end days `DAY_NOT_FOUND` [Inc 3]. Status, code and message are identical for a record that doesn't exist, another owner's record and an id that isn't a UUID.

| Policy | Who passes |
|---|---|
| `canSeeOrder` | the office, the owning distributor, the driver of the order's trip |
| `canActOnTrip` | the trip's driver |
| `canSeePayment` | the office, the owning distributor |
| `canSeeRefill` | the office, the owning distributor, the assigned driver |
| `canSeeClient` | the office (read), the owning distributor |
| `canSeeCylinder` | the office, the owning distributor |

Distributor-scoped queries always filter by `auth.distributorId` from the token, never from the body, and driver-scoped ones by `auth.driverId`. No token is issued to, or accepted from, a DISTRIBUTOR or DRIVER user without its `distributors` or `drivers` row (§3.3, §7.1), so a scoped query never runs without the caller's id. Every scoped route and service also reads them through `ownDistributorId(actor)` or `ownDriverId(actor)` (common/auth/own-driver-id.ts): a DISTRIBUTOR or DRIVER caller without the id gets 403 `PERMISSION_DENIED` before anything is read, because `where: {distributorId: undefined}` would drop the filter.

**Order of checks** on every route; the first failure answers: authentication (401) → the roles guard (403 `PERMISSION_DENIED`, before any record is read) → the ownership policy (404, above) → the route's own rules. A role a route never allows always gets 403; a role it allows gets 404 for someone else's record. The one exception is §9.7: the confirmation routes answer a DRIVER 404.

### 3.3 Sessions
- A request to a protected route with no token, or a malformed, forged or expired access token, gets 401 `AUTH_TOKEN_INVALID`.
- `JwtStrategy.validate` (jwt.strategy.ts:16-23) adds a check cached for 60 seconds: the user is ACTIVE, the role isn't locked, and the `tv` claim equals `users.token_version`. Otherwise the request gets 401 `AUTH_SESSION_REVOKED`. A DISTRIBUTOR token without `distributorId` or a DRIVER token without `driverId` gets the same 401 on every route and on the `/drivers` socket. Only a legacy user with no `distributors` or `drivers` row could hold one (§3.2), and login and refresh issue no tokens for such a user (§7.1), so the apps sign out instead of looping.
- Suspend, archive, role change, a phone change, password change and password reset bump `token_version`. Suspending a distributor and archiving a driver also set the user SUSPENDED, so a new sign-in gets 403 `AUTH_ACCOUNT_NOT_ACTIVE`.

### 3.4 Feature switches
`@Feature('<name>')` guards the switched-off modules (`features.*` settings):
- writes, and GETs of one record (a route with an `:id`, such as `GET /transfers/:id` and `/transfers/:id/progress`), get 403 `FEATURE_DISABLED` with `X-Feature-Disabled: <name>`. This runs after the role check: a role the route never allows still gets 403 `PERMISSION_DENIED`;
- GET lists return `[]` with `X-Feature-Disabled: <name>`, including lists keyed by another path parameter (`GET /accessories/stock/store/:storeId`).

A screen that opens one record never gets an array. The installed driver TransferDetailScreen read `t.lines.length` from `[]` and crashed; with the 403 it stays on Loading.

The installed driver HomeScreen.tsx:34-38 polls `/transfers/mine` every 30 seconds and keeps working.

**Setting switches.** `@SettingSwitch('<setting>', '<name>')` guards a module behind a boolean setting outside `features.*`. It runs right after sign-in, before role and ownership checks. While the setting is false, **every** method, reads included, gets 403 `FEATURE_DISABLED` with `X-Feature-Disabled: <name>`, never `[]` (no installed app calls these routes). The names match `PublicAppConfig.features`:
- `confirmation.enabled` → `confirmations`: `GET /orders/:id/confirmation`, `…/share` and `…/new-link` [Inc 2]. The public `/c/` page has its own 410 page (CUSTOMER_PAGE §4).
- `dayEnd.enabled` → `dayEnd`: every `/day-end` and `/admin/day-end` route [Inc 3].

### 3.5 Secrets never leave
- **`SecretStripInterceptor`** (global) removes these keys deeply from every response: `passwordHash`, `cnic`, `cnicEncrypted`, `cnicIndex`, `codeHash`, `tokenHash`.
- **Services also use explicit `select`s** for user relations. Examples today: orders.service.ts:82 includes the driver's full user row; distributors.service.ts:10,16 includes the distributor's.
- **The auth service** reads `passwordHash` explicitly.
- **Masked CNIC:** office views of a distributor or a driver carry `cnicMasked`, the last four digits only, written "*****-****567-1" (null when no CNIC is stored). No other response carries it, and the CNIC itself never leaves the server.

### 3.6 Rate limits
A small `RateLimitGuard` on ioredis (fixed windows, `@RateLimit(key, limit, seconds)`). It **lets requests through if Redis is down**. While Redis is unreachable, the limiter and each BullMQ queue and worker log one warning a minute through the Nest logger (`Rate limits are not enforced while Redis is unavailable: …`, `queue dispatch: …`), never a stack dump per reconnect. Counters are Redis keys `<BULLMQ_PREFIX>:rl:<rule>:<first 32 hex of sha256(identity)>:<window start>`, so staging and production never share them and no phone number or IP is stored in clear.

| Route | Limit |
|---|---|
| `POST /auth/login` | 5 per 10 minutes per phone; 30 per 10 minutes per IP |
| `POST /auth/refresh` | 30 per minute per IP |
| `POST /files/upload` | 30 per hour per user |
| Public `/c/:token` [Inc 2] | see CUSTOMER_PAGE §5 |

Every request counts, whatever its result; a successful sign-in doesn't reset the per-phone count. The per-phone count uses the normalised phone; a phone that isn't a Pakistani mobile counts only toward the per-IP limit.

### 3.7 Boot guards (main.ts, before `NestFactory.create`; exit 1 with a one-line reason)
These apply when `NODE_ENV` is `production` or `staging`:
- **JWT secrets:** `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must be at least 32 characters, must differ, and must not start with `change_me`. The defaults are in configuration.ts:15-16 and jwt.strategy.ts:12.
- **Required:**
  - `DATABASE_URL`;
  - `REDIS_URL` or `REDIS_HOST`;
  - `BULLMQ_PREFIX`, which must contain the deployment's name (`APP_ENV` when set, else `NODE_ENV`) or its alias (`production`/`prod`, `staging`/`stage`/`stg`, `training`/`train`, `development`/`dev`, `test`), for example `sf-prod` and `sf-staging`. Every Redis key the API writes starts with it (BullMQ queues and the §3.6 counters);
  - `S3_BUCKET`, `S3_ACCESS_KEY` and `S3_SECRET_KEY`, not the minio defaults (files.service.ts:31-34);
  - `CORS_ORIGINS`: a comma-separated list of website origins, each a scheme and host with an optional port (`https://admin.smartfleetpk.com`; a trailing slash is ignored), never `*`, a path or a bare host;
  - `ENCRYPTION_KEY` and `BLIND_INDEX_KEY`, each 64 hex characters (CNIC encryption and its blind index);
  - from Inc 2: `PUBLIC_LINK_BASE_URL` (https) and `CONFIRM_LINK_SECRET` (at least 32 characters).
- **Template placeholders:** a variable whose value still holds `REPLACE_…` (the placeholders of infrastructure/aws/.env.*.example) is refused, naming the variables, never their values.
- **Refused in production:** `AUTH_EXPOSE_OTP`, `TEST_PHONES`, `ALLOW_DEMO_SEED` and any `SEED_*` variable. `PAYMENTS_WEBHOOK_ENABLED=true` is refused too.
- **CORS:** `NestFactory.create(AppModule, { cors: true })` (main.ts:20) becomes `enableCors({ origin: CORS_ORIGINS, exposedHeaders: ['X-Request-Id','Idempotent-Replay','X-Already-Applied','X-Feature-Disabled'] })`. The socket gateway's `cors: true` (drivers.gateway.ts:14) uses the same list.
- **BullMQ:** `BullModule.forRootAsync` (app.module.ts:56-70) gets `prefix: BULLMQ_PREFIX`. Staging and prod share one Redis today.
- **Config fix:** configuration.ts:35 `EOCEAN_BASE_URL ?? ''` becomes `|| undefined`, so the provider's fallback URL can apply.
- **Preflight:** `node dist/common/bootstrap/boot-preflight.js` runs the same guards without starting the API. It prints `BOOT_PREFLIGHT_OK` and exits 0, or prints the `BOOT_REFUSED: …` line and exits 1. deploy.sh runs it in the new image, with the env file and the container's `NODE_ENV`, before any migration, and Railway's start command runs it before `migrate.sh` (DATA_MODEL §2.5). At boot the API logs the origins it allows (`CORS origins: …`).

---

## 4. Atomic and idempotent patterns (required for every money or state change)
1. **State guard.**
   - Every transition is `UPDATE … WHERE id = $1 AND status IN (<from>)` (Prisma `updateMany`), and the count must be 1.
   - It runs in the same `$transaction` as the money, custody and audit writes.
   - Rows that drive a decision are locked first with `SELECT … FOR UPDATE`.
2. **Create idempotency.**
   - The `Idempotency-Key` header is stored as `client_request_id`. It is unique per distributor on orders, payments, customers (`clients`) and, from Inc 3, refills; it is unique on expenses and distributors.
   - A retry returns the original resource with 200 and `Idempotent-Replay: true`.
   - The key must be a UUID; it is compared lower-cased, and anything else gives 400 `VALIDATION_FAILED` with `details.fields[0]` `{ path: "Idempotency-Key", code: "INVALID_ID" }`. It is stored only when the create commits, so a refused request (for example 409 `WALLET_INSUFFICIENT_BALANCE`) leaves it free to send again.
   - The key is looked up right after authentication and body validation, before the route's other rules: a retry gets the first resource even if the request would now be refused (balance spent, price changed).
   - The same key with different key fields returns 409 `IDEMPOTENCY_CONFLICT`. Fields are compared after the same normalisation as when saving (trimmed text, normalised phone, paisa by value, lines as a set); null and absent are equal; other fields are not compared. `POST /orders`: `clientId`, the delivery point (the address's pin or `deliveryLocation`, to 6 decimals) and `lines` `{cylinderTypeId, fullCount, expectedReturnCount}`. `POST /payments/topup-requests`: `amountPaisa`, `payerName`, `payerChannel`. `POST /filling-orders` [Inc 3]: `fillingStationId`, `cylinderTypeId`, `requestedCount`. `POST /expenses`: `expenseDate`, `amountPaisa`, `typeId`, `vehicleId`, `driverId`. `POST /clients`: `name`, `phone`. `POST /distributors`: `phone`, `businessName`.
   - A missing key (old builds) is allowed; the state guards still block double effects. Exception: `POST /admin/distributors/:id/wallet/corrections` has no old callers and requires the key; without it, 400 `VALIDATION_FAILED` with `details.fields: [{ path: 'Idempotency-Key', code: 'REQUIRED' }]` and nothing is written.
   - Money actions on existing resources use deterministic keys instead:
     - approve: `topup:<paymentId>`
     - order debit: `order:<id>:debit`
     - order reversal: `order:<id>:reversal`
     - correction: `adjust:<Idempotency-Key>`. A correction sent again with its key is answered like a create retry: 200 with `Idempotent-Replay: true` and the original entry, or 409 `IDEMPOTENCY_CONFLICT` when the distributor, direction, amountPaisa, reasonCode, note, relatedPaymentId or relatedOrderId differs (§7.8).
3. **Repeating a finished action** (a double tap on Deliver, Approve or Cancel):
   - returns 200 with the resource and `X-Already-Applied: true` when the record is already in the target state from the same kind of action;
   - otherwise returns 409 with the specific code and `details.currentStatus`.
   - "The same kind of action" means the same route's action, whoever calls it: two cancels (distributor or office, `/cancel` or `PATCH status CANCELLED`) or two fails (`/fail` or `PATCH status FAILED`) are the same kind; the driver's Delivered tap (Inc 2: the visit finish) and the office's manual delivery are not. A repeated cancel answers with what the first cancel returned.
   - Every order transition (cancel, fail, the Delivered tap, manual delivery, the first-load stamp) locks the order row first (`SELECT … FOR UPDATE`), so of two racing actions the second always sees the first's result.
4. **Balances** change only inside `WalletService`, by single-statement guarded updates (DATA_MODEL §3.6). Database CHECKs are the last line of defence.
5. **Side effects after commit.** Push and SMS run after the transaction commits, and failures are logged and visible (the Inc 2 message log). Never call a provider inside a money transaction.

---

## 5. Modules and service interfaces

### 5.1 Ownership (only the owning module writes these tables)
| Module (apps/api/src/modules) | Owns | May call |
|---|---|---|
| settings (new, @Global) | app_settings | audit |
| audit-log (@Global) | audit_logs | none |
| files | stored_files | none |
| wallet (new) | `distributors.advance_balance_paisa`, ledger_entries | audit |
| ledger | none (a compatibility façade over wallet) | wallet |
| payments | payments | wallet, files, settings, audit |
| pricing | distributor_zone_prices, distributor_zone_price_sizes (pricing_rules frozen: kept, and writable by the office through the legacy routes, but never read by quotes, orders or fees) | zones, settings |
| zones, stores | zones, stores | none |
| distributors | distributors (except the balance), its store row | stores, zones, wallet (read), audit, auth (`SessionCheckService.forget`) |
| clients | clients, client_addresses | pricing, zones |
| orders (with `OrdersFeePolicy`) | orders, order_lines | pricing, wallet, trips, alerts, audit |
| trips | trips, trip_stops | none |
| custody (becomes ScanService in Inc 2) | cylinders (custody and state), cylinder_events, stop_cylinders (Inc 2) | none |
| filling-orders, filling-stations | filling_orders, filling_stations (Inc 3: filling_order_cylinders) | custody |
| expenses | expense_types, expenses | files, audit. **Never wallet.** |
| admin-summary (new) | none (read-only) | none |
| alerts | alerts | none |
| confirmations, messaging [Inc 2] | delivery_confirmations, outbound_messages | alerts, audit |
| day-end [Inc 3] | day_closes, day_close_lines | custody, files |

Rules:
- Money moves only through `WalletService`.
- Holder and state change only through the custody module.
- Fee rules live only in `OrdersFeePolicy`.
- Every office override writes its audit row in the same transaction.
- A change that bumps `tv` (a suspension, an archive, a phone change) calls `SessionCheckService.forget(userId)`, exported by `AuthModule`, so the session ends on the next request instead of when the 60-second session cache expires (§3.3).

**Code to delete:**
- ledger.service.ts:22-40 (`debitForOrder`)
- payments.service.ts:143-164 (`creditLedger`)
- the refill debit at filling-orders.service.ts:214-230
- the unused PostHog `FeatureFlagsModule` (zero callers; the settings registry replaces it)

### 5.2 SettingsService (modules/settings)
`registry.ts` has one entry per key: a zod schema, the default, `public` (exposed by `/app/config`), `editable` (changeable over the API) and the increment.
```ts
get<K extends SettingKey>(key: K): Promise<SettingValue<K>>;                 // 30 s in-process cache; set() clears it on commit
set<K extends SettingKey>(key: K, value: SettingValue<K>, actor: Actor, reason: string): Promise<void>; // validates, refuses editable:false, audits setting.update {key, from, to}
publicConfig(): Promise<PublicAppConfig>;
```
- `set()` clears this process's cache when its transaction commits. With the pilot's one API instance (ADR-23), a change made with `PATCH /settings/:key` applies to the very next request; a change made by `scripts/set-setting.ts` (another process) reaches the API within 30 seconds. Apps cache `GET /app/config` for 5 minutes (UX_MOBILE §3.6), so a phone may show an older value that long, but the server's checks always use the current one.
- Secrets and deploy-level values stay in env (config/configuration.ts).
- `scripts/set-setting.ts` (CLI) sets keys that can't be edited over the API, such as `topup.account`. It writes with actor `SYSTEM` and label `cli:settings`, plus a required `--reason`.

### 5.3 AuditLogService (audit-log.service.ts:8-18 exists; 0 callers today)
```ts
type Actor = { kind: 'USER'; userId: string; role: UserRole; distributorId?: string; driverId?: string }
           | { kind: 'SYSTEM'; label: string }          // job:wallet-check, cli:settings, migration:inc1a
           | { kind: 'CUSTOMER'; label: string };       // link:AG-0142 (Inc 2)
record(e: { action: AuditAction; actor: Actor; resourceType: string; resourceId?: string; distributorId?: string;
            reason?: string; before?: unknown; after?: unknown }, tx?: Prisma.TransactionClient): Promise<void>;
list(f: { resourceType?; resourceId?; action?; actorUserId?; distributorId?; from?; to?; cursor?; limit? }): Promise<Page<AuditLogDto>>;
```
The IP, user agent and requestId come from an AsyncLocalStorage `RequestContext`, set by a middleware, except that a `CUSTOMER` actor's row always stores the IP and user agent as NULL (its requestId is kept; CUSTOMER_PAGE §12). The action names are in Appendix B.

### 5.4 WalletService (modules/wallet). The only writer of money.
```ts
type FeeSubject = { type: 'ORDER'; orderId: string } | { type: 'REFILL'; fillingOrderId: string }; // REFILL reserved (refill.deliveryCost)
interface WalletService {
  summary(distributorId: string): Promise<WalletSummary>;
  debit(tx, p: { distributorId; subject: FeeSubject; amountPaisa: bigint; actor: Actor }): Promise<LedgerEntry | null>;
    // amount 0 → null, no row. Guarded update balance >= amount AND status ACTIVE; else WALLET_INSUFFICIENT_BALANCE {requiredPaisa,balancePaisa,shortByPaisa} / DISTRIBUTOR_NOT_ACTIVE.
    // ORDER → DEBIT_ORDER, key order:<id>:debit.
  reverse(tx, p: { subject: FeeSubject; actor: Actor; reason: string }): Promise<LedgerEntry | null>;
    // returns the debit (the ledger row keyed order:<id>:debit) in full, once (key order:<id>:reversal); null if there is no such row, as for every legacy order. Called only by OrdersFeePolicy.cancel.
  creditTopup(tx, p: { distributorId; paymentId; amountPaisa: bigint; actor }): Promise<LedgerEntry>;   // key topup:<paymentId>; no distributor status check
  correct(tx, p: { distributorId; direction: 'ADD' | 'TAKE'; amountPaisa: bigint; reasonCode: CorrectionReason; note: string;
                   relatedPaymentId?: string; relatedOrderId?: string; requestKey: string; actor }): Promise<LedgerEntry>;
    // TAKE needs balance >= amount, else WALLET_ADJUST_EXCEEDS_BALANCE. No cap and no distributor status check.
    // relatedPaymentId / relatedOrderId must be this distributor's (NOT_FOUND {field}); stored as payment_id / order_id. Key adjust:<requestKey>.
  statement(distributorId: string, q: { kind?: StatementKind[]; from?; to?; cursor?; limit? }, view: 'DISTRIBUTOR' | 'OFFICE'): Promise<Page<StatementItem>>;
  verify(distributorId?: string): Promise<WalletCheck[]>;   // { distributorId, balancePaisa, ledgerSumPaisa, ok }
}
```
Invariant: `advance_balance_paisa >= 0`, and it equals the sum of the distributor's ledger rows.

### 5.5 OrdersFeePolicy (modules/orders/orders-fee.policy.ts): the only place fee rules live
```ts
onCreated(tx, order, quote, actor): Promise<void>;                 // WalletService.debit(ORDER, quote.totalPaisa)
isDeliveryStarted(order: OrderForPolicy, rule: DeliveryStartedRule): boolean;
cancelTerms(order, rule): { allowed: boolean; refundPaisa: bigint; noRefundReason: 'DELIVERY_STARTED' | null };
cancel(tx, order, p: { actor; reasonCode; note?; confirmRefundPaisa?: bigint }): Promise<{ refunded: boolean; refundPaisa: bigint }>;
```
`OrderForPolicy` holds `status`, the fee status and `fee_strategy`, `assignedAt`, `loadStartedAt`, the current trip's STORE_PICKUP `departedAt`, the first `arrivedAt` of this order's DELIVERY stops on any trip it was on, and `handoverStarted`. A reassignment cancels the old stop but keeps its `arrivedAt`, so a driver change after the driver reached the customer never makes the order refundable again (ADR-07: "the order's delivery stop was reached"). `handoverStarted` is a DELIVERED cylinder event (Inc 1) or a GIVEN stop cylinder (Inc 2) for this order.

`isDeliveryStarted(order, rule)`:

| Rule (`orders.deliveryStartedAt`) | Started when any of these is true |
|---|---|
| `FIRST_LOAD_SCAN` (default) | `loadStartedAt`, store stop `departedAt`, delivery stop `arrivedAt`, status DELIVERED or FAILED |
| `DRIVER_ASSIGNED` | `assignedAt`, plus everything in `FIRST_LOAD_SCAN` |
| `LEFT_STORE` | store stop `departedAt`, delivery stop `arrivedAt`, status DELIVERED or FAILED |

A trip start or IN_TRANSIT on its own never counts. Only a LOAD (an event with `trip_id` at the trip's STORE_PICKUP stop) stamps `loadStartedAt`; a refill pickup (Inc 3: SCAN_OUT with `filling_order_id`) never touches an order. The rule value used is saved in the `order.cancel` audit row. The rule is read from settings each time the terms are computed (GET, cancel) and isn't stored on the order, so a change applies at once to every open order that hasn't started, including orders placed before it.

`cancelTerms`:
- `allowed` = the status is not terminal and the hand-over has not started;
- `refundPaisa` = the fee when the fee status is DEDUCTED, `fee_strategy` isn't `LEGACY_ZONE_PAIR` (the cost was deducted at placement by this platform) and delivery has not started; otherwise 0.
- `noRefundReason` = `DELIVERY_STARTED` when such an order has started; otherwise null. A legacy order (charged by the old code) or a zero-cost order gets 0 with `noRefundReason: null`.

Delivered, failed, customer answers and day-end **never** call the policy for money.

### 5.6 PricingService and DeliveryFeeStrategy (modules/pricing)
```ts
interface DeliveryFeeStrategy {
  readonly key: FeeStrategy;                                   // 'DISTRIBUTOR_ZONE' (pilot); 'ZONES_CROSSED' later
  quote(ctx: { distributorId: string; originStore: { id: string; zoneId: string; lat: number; lng: number };
               zone: { id: string; name: string }; destination: { lat: number; lng: number };
               lines: { cylinderTypeId: string; fullCount: number }[] }, tx?): Promise<DeliveryQuote>;
}
quoteLocation(distributorId, point): Promise<LocationQuote>;          // never throws for coverage: blockCode instead
quoteOrder(distributorId, point, lines, tx?): Promise<DeliveryQuote>; // throws PRICING_ZONE_NOT_COVERED / PRICING_PRICE_NOT_SET
```
- **DISTRIBUTOR_ZONE:** `total = price.basePaisa + Σ(perCylinder(size) × fullCount)`. A missing size row counts as 0. The base is charged **once per order** (today pricing.service.ts:77 adds it once per line). `originStore` is always the distributor's home store, never the body's (409 `DISTRIBUTOR_NO_STORE` when there is none, which only a legacy distributor can have before inc1b). `quoteLocation` and `GET /pricing/quote` don't need it, because the price depends only on the customer's zone.
- **Zone lookup (ZonesService.findContainingPoint)** follows DATA_MODEL §6.6: active zones only, `ST_Covers`, ordered by area, then created_at, then id.
- The strategy is picked by setting `pricing.deliveryStrategy`. It can't be edited until a second strategy exists.

### 5.7 PaymentProvider and TopupService (modules/payments)
This replaces payment-provider.interface.ts:1-22.
```ts
interface PaymentProvider { readonly name: 'BANK_MANUAL' | 'EASYPAISA' | 'JAZZCASH'; readonly kind: 'MANUAL_REVIEW' | 'GATEWAY';
  enabled(): Promise<boolean>;
  instructions?(ctx: { distributorId: string; amountPaisa?: bigint }): Promise<PaymentInstructions>;   // MANUAL_REVIEW
  initiate?(p: { paymentId; amountPaisa; distributorId }): Promise<{ redirectUrl?; formFields? }>;     // GATEWAY, later
  verifyCallback?(req: { headers; rawBody: Buffer; query }): Promise<{ paymentId; providerTxnId; amountPaisa; outcome: 'PAID' | 'FAILED' | 'PENDING' }>;
  inquire?(p: { paymentId; providerTxnId }): Promise<{ outcome; amountPaisa }>;                      // always called before a gateway credit
}
TopupService: info(distributorId) · createRequest(actor, body, idemKey) · approve(actor, id, body) · reject(actor, id, body)
```
- `BankManualProvider` reads `topup.account`. Delete the hard-coded bank defaults (bank-manual.provider.ts:14-16).
- Easypaisa and JazzCash stay registered with `enabled() = false`.

### 5.8 FilesService (modules/files)
```ts
upload(file, p: { purpose: StoredFilePurpose; actor }): Promise<{ fileId; key; url; mimeType; size }>;  // url signed 1 h
signedUrl(fileId, actor): Promise<string>;                                                          // owner or office
assertUsable(fileId, p: { purpose; uploadedByUserId }): Promise<StoredFile>;                        // FILE_NOT_FOUND otherwise
```

### 5.9 Inc 2 interfaces (summary; the details are in §9 and CUSTOMER_PAGE.md)
- **ScanService.apply(cmd)** handles LOAD, HANDOVER, TAKE_BACK, STORE_RECEIVE, OFFICE_MANUAL_DELIVERY and REGISTER. Inc 3 adds REFILL_PICKUP and REFILL_FILL.
  - The destination is always derived on the server. Every scan body refuses `toCustodyType` and `toCustodyId` with 400 `VALIDATION_FAILED` (field code NOT_ALLOWED); other unknown fields are dropped. Today custody.service.ts:63-75 accepts them.
- **MessagingProvider.send(m)** returns SENT, SKIPPED or FAILED. `MessagingService.record(...)` writes `outbound_messages`.
- **ConfirmationsService:** `issueForDeliveredOrder(tx, …)`, `view(orderId, actor)`, `share(orderId, via, idempotencyKey, actor)`, `newLink(orderId, { send, idempotencyKey }, actor)`, `record(token, answer, comment)`. **It never calls the wallet.**

---

## 6. Settings registry (`apps/api/src/modules/settings/registry.ts`, mirrored as `SettingKey` in shared-types)
- Storage: `app_settings` (key + scope `global`).
- Changes: `PATCH /settings/:key { value, reason }`, audited as `setting.update`.
- **Pub** means exposed by `GET /app/config`. **Edit** means changeable over the API.

| Key | Type | Default | Pub | Edit | Inc |
|---|---|---|---|---|---|
| `dispatch.autoAssign.enabled` | bool | false | yes | yes | 1 |
| `auth.otpLogin.enabled` | bool (reserved: code sign-in isn't built in the pilot, §7.1) | false | no | **no** (reserved, not built) | 1 |
| `auth.lockedRoles` | distinct UserRole values, never SUPER_ADMIN (else 400 `SETTING_INVALID_VALUE`); locking DISTRIBUTOR or DRIVER is an emergency stop | [ADMIN, DISPATCHER, STORE_KEEPER, CLIENT] | no | yes | 1 |
| `features.transfers` / `.fuelRefills` / `.accessories` / `.support` / `.clientApp` | bool | false | yes | yes | 1 |
| `app.minVersion.driver` / `app.minVersion.distributor` | semver | "0.0.0" | yes | yes | 1 |
| `orders.deliveryStartedAt` | FIRST_LOAD_SCAN, DRIVER_ASSIGNED or LEFT_STORE | FIRST_LOAD_SCAN | yes | yes | 1 |
| `orders.maxCylindersPerOrder` | int 1–100 | 30 | yes | yes | 1 |
| `pricing.deliveryStrategy` | DISTRIBUTOR_ZONE | DISTRIBUTOR_ZONE | no | no | 1 |
| `wallet.maxBalancePaisa` | int or null | null (no cap) | yes | yes | 1 |
| `wallet.lowBalancePaisa` | int | 100000 | yes | yes | 1 |
| `topup.minPaisa` / `topup.maxPaisa` | int | 50000 / 5000000 | yes | yes | 1 |
| `topup.quickAmountsPaisa` | int[] | [200000, 500000, 1000000] | yes | yes | 1 |
| `topup.maxPendingPerDistributor` | int | 3 | no | yes | 1 |
| `topup.onAmountMismatch` | CREDIT_BANK_AMOUNT or REJECT | CREDIT_BANK_AMOUNT | no | yes | 1 |
| `topup.checkingHours` | {from, to} "HH:mm" | {from: "09:00", to: "21:00"} | yes | yes | 1 |
| `topup.account` | {accountTitle, bankName, iban, accountNumber} or null | null | no (distributors read it from `GET /payments/topup-info`, never from the anonymous `/app/config`) | **no** (CLI) | 1 |
| `topup.secondApproval` | {enabled, thresholdPaisa} | {false, 2000000} | no | **no** (reserved, not built) | 1 |
| `refill.maxCylinders` | int 1–30 | 30 | yes | yes | 1 |
| `refill.deliveryCost` | {enabled, basePaisa, perCylinderPaisa} | {false, 0, 0} | no | **no** (reserved) | 1 |
| `support.phone` / `support.whatsApp` / `support.hours` | string or null | null / null / "9am–9pm" | yes | yes | 1 |
| `day.timezone` / `day.cutoffLocalTime` | IANA zone name that `Intl` accepts (≤ 64 characters) / local time "HH:mm", 00:00–23:59 | "Asia/Karachi" / "03:00" | yes | yes | 1 |
| `confirmation.enabled` | bool | false | yes | yes | 2 |
| `confirmation.linkTtlHours` | int 24–168 | 72 | no | yes | 2 |
| `confirmation.caseOnAnswers` | ConfirmationResponse[] | [NO, OTHER] | no | yes | 2 |
| `messaging.testMode` | bool | true | no | yes | 2 |
| `messaging.allowlist` | E.164[] | [] | no | yes | 2 |
| `custody.typedEntry.enabled` | bool | true | yes | yes | 2 |
| `custody.forgottenInPolicy` | BLOCK_OUT_MANUAL_DELIVERY | BLOCK_OUT_MANUAL_DELIVERY | no | no (only value built) | 2 |
| `trip.allowFinishWithLeftovers` | bool | false | no | yes | 2 |
| `walkIn.counterSwap.enabled` | bool | false | no | no (not built) | 2 |
| `dayEnd.enabled` | bool | false (true when Inc 3 ships) | yes | yes | 3 |

`custody.typedEntry.enabled = false` refuses TYPED driver, store and refill scans with 403 `FEATURE_DISABLED` (§9.2 step 4) and makes `features.typedCylinderNumber` false. QR scans, the office's manual delivery and Find cylinder are not affected.

Deploy-level env, not settings:
- `APP_ENV` (`development`, `test`, `staging`, `training`, `production`) is `PublicAppConfig.environment`. `training` (here and in `GET /payments/topup-info`) is true only for `training`. The apps' environment strips follow `environment`, not `training` (UX_MOBILE §2.2, UX_ADMIN §2.10).
- `MESSAGING_PROVIDER` (`mock` or `eocean`).
- `PUBLIC_LINK_BASE_URL`, `CONFIRM_LINK_SECRET`.

`GET /app/config` [Inc 1] is **public**, so the update gate can run before sign-in:
```ts
PublicAppConfig = { environment; training: boolean; minVersion: { driver; distributor };
  support: { phone; whatsApp; hours };
  features: { autoAssign; transfers; fuelRefills; accessories; support; clientApp; refills: true;
              scanFlow: boolean /* true from the Inc 2 release */; confirmations; dayEnd; typedCylinderNumber; languageSwitch: false };
  topup: { minPaisa; maxPaisa; quickAmountsPaisa; checkingHours }; wallet: { lowBalancePaisa; capPaisa };
  orders: { maxCylindersPerOrder; deliveryStartedAt }; refill: { maxCylinders }; day: { timezone; cutoffLocalTime };
  links: { updateUrl: string | null } }
```
- **426 gate:** a global interceptor compares the app's version with `app.minVersion.<variant>` and returns 426 `APP_UPDATE_REQUIRED` when it is lower. The variant is `X-App-Variant` when it is `driver` or `distributor`; with no (or an unknown) header, the signed-in role decides (DRIVER → driver, DISTRIBUTOR → distributor). `admin-web`, other roles and anonymous calls without the header are never gated. A missing or unreadable `X-App-Version` counts as "0.1.0". Versions compare as three numbers (0.10.0 > 0.9.3); a `-pre` or `+build` suffix is ignored. `GET /app/config`, `GET /health` and `GET /health/live` are exempt.
- Raise the minimum only after the new APK is on every phone. Both apps are side-loaded, and `runtimeVersion` follows `appVersion` (apps/mobile/app.config.ts:25).

---

## 7. Increment 1 endpoints [Inc 1]

Shared response shapes, in shared-types (`Paisa` = digit string):
```ts
OrderDto = { id; orderNo; shortCode: 'AG-0142'; status: OrderStatus; stage: OrderStage;
  client: { id; name; phone }; lines: { id; cylinderTypeId; sizeLabel: '11.8 kg'; fullCount; expectedReturnCount }[];
  deliveryAddressLabel; destination: { lat; lng }; destZone: { id; name };
  fee: { totalPaisa; status: OrderFeeStatus; breakdown: { basePaisa; lines: { cylinderTypeId; sizeLabel; count; perCylinderPaisa; subtotalPaisa }[] } | null };
  cancel: { allowed: boolean; refundPaisa: Paisa; noRefundReason: 'DELIVERY_STARTED' | null };
  originStore: { id; name; address } | null;
  trip: { id; status; driver: { id; name; phone }; vehicle: { plateNo } } | null;
  createdAt; assignedAt; loadStartedAt; onTheWayAt; deliveredAt; deliveryMethod; cancelledAt; cancelReasonCode; failedAt; failureReasonCode; failureNote;
  deliveryFeePaisa; paymentStatus;                    // legacy mirror for installed apps
  allowedActions: ('CANCEL'|'ASSIGN'|'REASSIGN'|'MARK_FAILED'|'MANUAL_DELIVERY'|'TRACK')[];
  distributor?: { id; businessName; code } }          // office only
WalletSummary = { balancePaisa; pendingTopupPaisa; pendingTopupCount; lowBalance: boolean /* balancePaisa < wallet.lowBalancePaisa: strictly below; 0 never warns */; capPaisa: Paisa | null }
StatementItem = { id; at; kind: StatementKind; amountPaisa /* signed */; balanceAfterPaisa;
  subject: { type: 'ORDER' | 'TOPUP' | 'REFILL'; id; shortCode; clientName: string | null /* ORDER: the customer's name; else null */;
             bankReference?: string | null /* TOPUP, office view only: as the office typed it */ } | null; reasonCode: string | null;
  note?: string; by?: { name } }                      // note and by: office view only
PaymentDto = { id; requestNo; shortCode: 'AG-T031'; amountPaisa; creditedPaisa: Paisa | null; status: PaymentStatus;
  stage: 'BEING_CHECKED' | 'ADDED' | 'NOT_ADDED'; payerName; payerChannel; transactionId; proofUrl /* signed 1 h */;
  createdAt; reviewedAt; rejectReasonCode; rejectNote; allowedActions: ('APPROVE'|'REJECT')[];
  distributor?: { id; businessName; code }; bankReference?; bankAmountPaisa?; bankReceivedAt?; reviewedBy?: { id; name } } // ? = office only
```

Also in shared-types:
- `SafeUserDto` (alias `MeDto`): what `GET /users/me`, `PATCH /users/me`, `GET /users` and `GET /users/:id` send. That is explicit fields, `hasPassword`, ISO dates, and `distributorProfile` / `driverProfile` (null for other roles).
- `TripViewDto` with `TripStopDto`, `TripOrderDto` and `TripOrderLineDto`: what `GET /trips/mine` and `GET /trips/:id` send (§7.7). Stop `location` is `{ lat, lng }`; the legacy `coordinates` array is still sent for installed apps, and new code doesn't read it.

The apps type these routes with them and never redefine them (README rule 2).

### 7.1 App and auth
- **`GET /app/config`** (public): `PublicAppConfig` (§6).
- **`POST /auth/login`** (public) `{ phone, password }` returns `{ accessToken, refreshToken, expiresIn, role }` (unchanged). `expiresIn` is the access token's lifetime in seconds: env `JWT_ACCESS_TTL`, default 43200 (12 hours). A refresh token lasts `JWT_REFRESH_TTL`, default 2592000 (30 days), and is replaced on every refresh. On the server a session ends only by expiry, a `tv` bump (§3.3) or a locked role.
  - The phone is normalised with `normalizePkPhone`.
  - Checks, in this order; the first that fails answers: (1) 429 `RATE_LIMITED` (§3.6); (2) 400 `VALIDATION_FAILED` (phone 1–32 characters, password 1–128); (3) 401 `AUTH_INVALID_CREDENTIALS`: the phone isn't a Pakistani mobile, no user has it, the user has no password, or the password is wrong (with no user a dummy hash is still verified, so timing reveals nothing); (4) 403 `AUTH_ROLE_LOCKED`: the role is in `auth.lockedRoles`; (5) 403 `AUTH_ACCOUNT_NOT_ACTIVE`: the user is PENDING or SUSPENDED, or is a DISTRIBUTOR or DRIVER without its `distributors` or `drivers` row (legacy data that no query could be scoped to, §3.2); (6) 403 `AUTH_WRONG_APP` `{role, app}` (the app check below). So nothing about an account shows without its password, and a locked role wins over a wrong app.
  - Tokens carry the claims `sub`, `role`, `distributorId`, `driverId` and `tv`. A DISTRIBUTOR token always carries `distributorId`, and a DRIVER token `driverId`.
  - **App check:** each role has one app: DISTRIBUTOR → `distributor`, DRIVER → `driver`, every other role → `admin-web` (the website's own gate then admits only SUPER_ADMIN). A sign-in whose `X-App-Variant` names another app gets 403 `AUTH_WRONG_APP` `{role, app}` (`app` from `APP_DISPLAY_NAME`) and no tokens. With no `X-App-Variant`, or a value other than these three, there is no app check: installed 0.1.0 apps send none. The apps and the website show the refusal under the sign-in form; their wrong-app pages are only a fallback for a saved session.
- **`POST /auth/refresh`** `{ refreshToken }` rotates the token, with reuse detection unchanged (auth.service.ts:177-211). A malformed, forged, expired, unknown or already-used refresh token gives 401 `AUTH_REFRESH_INVALID` (a reused one also revokes every live refresh token of that user). A valid one whose user isn't ACTIVE, whose role is locked, whose `tv` differs from `users.token_version`, or who is a DISTRIBUTOR or DRIVER without its `distributors` or `drivers` row gives 401 `AUTH_SESSION_REVOKED`, and that token is revoked. The apps treat any 401 from refresh as signed out.
- **`POST /auth/change-password`** `{ currentPassword, newPassword (≥ 8) }` bumps `tv` and returns new tokens. A wrong `currentPassword` gives 400 `VALIDATION_FAILED` (field `currentPassword`, code `INVALID_VALUE`), never a 401, because the apps sign out on a 401.
- **`POST /auth/otp/send` and `/auth/otp/verify`** always return 403 `AUTH_OTP_DISABLED` in the pilot: no code is sent and no user is ever created (today auth.service.ts:87-96 does). Code sign-in isn't built; `auth.otpLogin.enabled` is reserved. If it is built later, codes sign in only existing DISTRIBUTOR and DRIVER accounts: send answers 200 `{ ok: true }` for any well-formed phone and texts a code only when such a user exists, and verify applies the sign-in checks (3)–(6) above.

### 7.2 Safety table for existing routes
"Office" = SUPER_ADMIN; "exact" = no super-admin bypass. Every ownership miss returns 404 with the code §3.2 names.

| Route | Inc 1 rule | Today |
|---|---|---|
| `GET /auth/me`, `GET /users/me` | secrets stripped | users.service.ts:11-15 strips only the hash |
| `PATCH /users/me` | Any signed-in role. `name` (1–80) and `email` (blank or null clears it; an email used by another account gives 409 `CONFLICT_DUPLICATE`) only. A body that contains `phone`, `cnic` or `businessName` at all, even unchanged, is refused whole with 403 `USER_FIELD_OFFICE_ONLY` and nothing changes; other unknown keys are ignored. 200 with the safe profile. A driver's name can also change through `PATCH /drivers/:id/profile`. | any field |
| `GET /users`, `GET /users/:id` | office | ADMIN, DISPATCHER |
| `PATCH /users/:id/status`, `/role` | office; `{ value, reason }`. Not self; can't set SUPER_ADMIN; can't remove the last active SUPER_ADMIN (when the target is a SUPER_ADMIN, the transaction first locks every ACTIVE SUPER_ADMIN row with `SELECT … FOR UPDATE`, ordered by id, and re-reads the caller from the database: a caller no longer ACTIVE gets 401 `AUTH_SESSION_REVOKED`, then a change that would leave none gives 409 `USER_LAST_SUPER_ADMIN`; two super admins suspending each other at once end with one 200 and one 401); the role must match the profile, and a DISTRIBUTOR or DRIVER user without its `distributors` or `drivers` row can't be made ACTIVE (403 `PERMISSION_DENIED`). Bumps `tv`. Audited. For a DISTRIBUTOR user, `distributors.status` changes with `users.status` in the same transaction. | ADMIN could promote itself (users.controller.ts:36-46) |
| `POST /users/:id/password` | office. Body `{ password (8–128, not trimmed) }`, typed by the super admin. Targets: DISTRIBUTOR and DRIVER users that have their `distributors` or `drivers` row, whatever their status; the caller's own account gives 403 `USER_SELF_CHANGE_NOT_ALLOWED` (use `POST /auth/change-password`), any other target (another super admin, a CLIENT, a staff role, a DISTRIBUTOR or DRIVER without its row) 403 `PERMISSION_DENIED`, an unknown id 404 `NOT_FOUND`. Hashes it, bumps the target's `tv` (its sessions end within 60 seconds) and answers 200 `{ ok: true }`. Audit `user.password_reset`, never with the password or its hash. | |
| `GET /drivers` | office, safe fields: `DriverOfficeDto`, with `cnicMasked` and the last position the app reported, `currentLocation: { lat, lng } \| null` and `currentLocationUpdatedAt` (the office map and the live-tracking dialog) | |
| `GET /drivers/:id` | office, or the driver reading themselves | no roles (drivers.controller.ts:16-19) |
| `POST /drivers` | office. Body `{ name (1–80), phone, licenceNo (1–40), email?, cnic?, profilePictureUrl? (≤ 500) }`. The phone is normalised (else 400 `VALIDATION_FAILED`, field `phone`, code `INVALID_PHONE`) and must not belong to any user (409 `USER_PHONE_IN_USE` `{existingRole}`; never an upsert); a licence number already used gives 409 `CONFLICT_DUPLICATE`; the CNIC as in §7.3 rule 4. Creates an ACTIVE DRIVER user with no password (the office sets one with `POST /users/:id/password`) and an AVAILABLE driver. 201 with the office driver view. Audit `driver.create`. | |
| `PATCH /drivers/:id/location`, `/online` | DRIVER exact; `:id` must be the token's `driverId` | any driver id |
| `PATCH /drivers/:id/profile` | office: `{ name?, email?, cnic?, licenceNo?, profilePictureUrl? }` (absent leaves a field unchanged; null clears email, cnic or the photo; a blank `cnic` leaves the CNIC unchanged, because forms pre-filled from a response, which never carries the CNIC, send ""; setting or clearing a CNIC also empties the legacy plain `users.cnic`). A driver on themselves: `name` and `profilePictureUrl` only; any other field gives 403 `USER_FIELD_OFFICE_ONLY` and nothing changes; another driver's id gives 404 `NOT_FOUND`. 200 with the driver. Audit `driver.update` `{name, before, after}`. | any field |
| `PATCH /drivers/:id/vehicle`, `/availability`; `DELETE /drivers/:id`; `PATCH /drivers/:id/reactivate` | office. `DELETE /drivers/:id` `{ reason (5–300) }` archives: `users.status` SUSPENDED, the van released, `isOnline` false, `tv` bumped; sign-in then gives 403 `AUTH_ACCOUNT_NOT_ACTIVE` and assignment `ASSIGN_DRIVER_NOT_AVAILABLE`. `PATCH /drivers/:id/reactivate` `{ reason (5–300) }` sets `users.status` ACTIVE; the van isn't given back. Both answer 200, a repeat 200 with `X-Already-Applied`. Audits `driver.archive*` and `driver.reactivate*`; vehicle and availability changes are audited `driver.update` | |
| `/vehicles/*` | office; `currentDriver.user` stripped | |
| `GET /zones/city/:cityId`, `GET /zones/locate` | office, DISTRIBUTOR. The lookup is deterministic; the office may pass `?includeArchived=true`. `GET /zones/city/:cityId` answers `ZoneListRow[]` in name order, the legacy snake_case shape `{ id, city_id, name, centroid, polygon, is_active }`: `polygon` is the zone outline as a GeoJSON MultiPolygon and `centroid` a GeoJSON Point (`[lng, lat]` positions), so the website maps draw each outline and fit to the zones. | any user |
| `POST`, `PATCH`, `DELETE /zones`, `PATCH /zones/:id/reactivate` | office. `POST /zones` `{ cityId, name (2–60), polygonGeoJson: MultiPolygon }` → 201 `{ id }`; `PATCH /zones/:id` `{ name?, polygonGeoJson? }` → 200 `{ ok: true }` (`isActive` is ignored); `DELETE` (archive) and `reactivate` → 200 `{ ok: true }`, a repeat 200 with `X-Already-Applied`. A non-empty valid MultiPolygon (`ST_IsValid`, area > 0) is required, else `ZONE_INVALID_SHAPE`; an unknown `cityId` is 404 `NOT_FOUND` `{field: 'cityId'}`. Overlaps aren't checked here (the lookup rule decides; the setup file refuses them). Each change is audited in the same transaction: `zone.create`, `zone.update`, `zone.archive`, `zone.reactivate`, with `{ name, isActive, areaKm2 }` before and after. Archiving takes the zone out of every lookup at once: pins inside it are quoted as the next active zone covering them, else `PRICING_ZONE_NOT_COVERED` (saved addresses there show `OUTSIDE`, and adding customers there is refused). The distributors' price rows for it are kept (left out of coverage; `PUT` gives `ZONE_ARCHIVED`; `DELETE` still works) and apply again on reactivation. A store inside it is untouched: trips still start there, and its zone is recomputed only when the store is edited. Placed orders keep their cost and destination zone. | |
| `GET /stores` | office | any user |
| `POST`, `PATCH /stores` | office. `zoneId` comes from the location, else 422 `STORE_OUTSIDE_ZONES`. | picked by hand |
| `DELETE /stores/:id` | office; a distributor's store gives 409 `STORE_IN_USE` | |
| `GET /cities`, `GET /cylinder-types` | signed in | |
| `POST /cities`, `POST /cylinder-types` | office | |
| `GET /cylinders/by-qr/:qr` | office, the owning distributor | any user |
| `GET /cylinders` | office | |
| `POST /cylinders/bulk-register` | office. Body `{ distributorId, cylinderTypeId, quantity (1–500) \| serials (1–500 distinct values, 3–128 characters each; serial and QR value), state?: 'FULL' \| 'EMPTY' (default FULL), initialCustodyType?: 'STORE', initialCustodyId? }`, with exactly one of `quantity` or `serials`. The first holder is always the distributor's home store: a van (`initialCustodyType`) or another store (`initialCustodyId`) gives 400 `VALIDATION_FAILED` (field code NOT_ALLOWED) and nothing is created. `quantity` codes are generated `<typeCode>-<8 hex>`, as today. 201 with the created cylinders. Errors: 404 `NOT_FOUND` `{field}` (unknown distributor or size), 409 `DISTRIBUTOR_NO_STORE`, 409 `CONFLICT_DUPLICATE` for a serial already used (nothing is created). Audit `cylinders.bulk_register` `{cylinderTypeId, count, state}`. | any holder (cylinders.service.ts:76-88) |
| `GET /custody/cylinders/:id/history` | office, the owning distributor (a DRIVER gets 403 `PERMISSION_DENIED`, §3.2) | any user |
| `/inventory/*` | unchanged roles | |
| `/transfers/*`, `/accessories/*`, `/support/*`, `/client-portal/*` | switched off (§3.4) | transfers are a second scan path; support is open to all |
| `/fuel-refills/*` | `features.fuelRefills` (off) gates only the driver's own routes: `POST /fuel-refills` gives 403 `FEATURE_DISABLED` and `GET /fuel-refills/mine` gives `[]`, both with `X-Feature-Disabled: fuelRefills`. Switched on, they work as today for DRIVER (exact), with today's body `{ vehicleId, litres, costPaisa, odometerKm, fuelStation?, notes? }` and the driver taken from the token (a body `driverId` is ignored). `GET /fuel-refills`, `/vehicle/:id` and `/driver/:id` are office only, with safe selects, and answer whatever the switch. The pilot driver app has no fuel-log screen. | no roles (fuel-refills.controller.ts:26-29, :37-40); `driver.user` included (:57, :77) |
| `GET /pricing/city/:cityId`, `POST /pricing/rules` | office; legacy and frozen: both keep today's shapes and still read and write `pricing_rules`, but no quote, order or fee reads that table; no screen calls them; the table is dropped after the pilot | GET open to all |
| `POST /dispatch/manual` | 403 `DISPATCH_AUTO_OFF` while off. The processor does nothing; `OrdersService.create` stops enqueueing (orders.service.ts:73). | |
| `POST /payments/webhook/:provider` | 410 `PAYMENT_WEBHOOK_DISABLED`. It never changes a payment. | forgeable credit |
| `/filling-stations` | GET signed in; writes office. `pricePerCylinderPaisa` is returned as 0 and ignored on write. | |
| `POST /reconciliations` | DRIVER; unchanged (retired in Inc 3) | |
| `/returns/*` | unchanged roles | |
| `/alerts`, `/alert-rules` | office exact (Inc 2 adds `GET /alerts/mine` for distributors, §9.6). Creating a `DISTRIBUTOR_CREDIT_OVER` rule, or setting one active, gives `VALIDATION_FAILED`, because balances can't go negative; existing ones are deactivated by inc1a (DATA_MODEL §3.4 backfill 12), and the evaluator never runs that kind. | |
| `POST /push-tokens` | signed in. `{ token (1–200), platform? }` upserts by token; a token held by another user moves to the caller (one phone, one signed-in user). 200 `{ ok: true }`. | |
| `DELETE /push-tokens` | signed in. `{ token }` deletes the row only when it is the caller's; always 200 `{ removed }` (0 or 1), so someone else's or an unknown token is left alone and nothing is revealed. | deletes anyone's |
| `GET /health`, `GET /health/live` | public, exempt from the 426 gate. `/health/live`: 200 `{ status: "ok" }` while the process runs (deploy health checks use it). `/health`: `SELECT 1` with a 2-second timeout; 200 `{ status: "ok", environment, version, uptimeSeconds, checks: { database: { ok: true, latencyMs } } }`, or 503 with the same shape, `status: "degraded"` and `database.ok: false`. `version` is the deployed commit: `GIT_COMMIT_SHA` (deploy.sh bakes it into the image), else `RAILWAY_GIT_COMMIT_SHA`, else the package version, else `dev`. deploy.sh and promote-prod wait until it reports the commit they deployed. No error text, connection detail or NODE_ENV ever appears; this 503 body is not the §2.1 envelope. | returns the raw database error text and NODE_ENV |

### 7.3 Distributors and their one store (office unless noted)
- **`POST /distributors`** (Idempotency-Key)
  - Body: `{ phone, name, businessName, code?, cnic?, email?, store: { name, address, lat, lng } }`.
  - Rules:
    1. The phone is normalised (else 400 `VALIDATION_FAILED`, field `phone`, code `INVALID_PHONE`) and must not belong to any user (409 `USER_PHONE_IN_USE` `{existingRole}`). Today distributors.service.ts:53-64 silently changes a role by upsert.
    2. `code` must match `^[A-Z][A-Z0-9]{1,5}$` (`DISTRIBUTOR_CODE_INVALID`) and be unique (`DISTRIBUTOR_CODE_IN_USE`). The default is the business initials, plus a digit if taken.
    3. An active zone must cover the store point (`STORE_OUTSIDE_ZONES`); `zoneId` is derived from it.
    4. The CNIC is first reduced to its 13 digits (spaces and dashes removed; anything else gives 400 `VALIDATION_FAILED` on `cnic`, code `INVALID_CNIC`). It is stored encrypted (`ENCRYPTION_KEY`) plus a blind index, HMAC-SHA256 of the 13 digits with `BLIND_INDEX_KEY`, and is unique across users (409 `USER_CNIC_IN_USE`), so "35202-7654321-3" and "3520276543213" are the same CNIC. The duplicate check runs on the server, not in the browser. The legacy plain `users.cnic` column is never written.
    5. One transaction creates the user (PENDING, DISTRIBUTOR), the store (raw INSERT) and the distributor (`homeStoreId`, `code`; counters default to 1). Audit `distributor.create`.
  - Response 201: `DistributorDto`. A retry with the same Idempotency-Key (stored as `distributors.client_request_id`) answers 200 with `Idempotent-Replay: true` and the first distributor, before rule 1 runs (§4.2).
- **`GET /distributors`** and **`GET /distributors/:id`**:
  ```ts
  DistributorDto = { id; userId /* the sign-in user, for POST /users/:id/password */; code; businessName; status; contact: { name; phone; email };
    store: { id; name; address; lat; lng; zone: { id; name } };
    wallet: { balancePaisa }; prices: { priced; total }; appPasswordSet: boolean;
    readiness: { storeSet; pricesComplete; appPasswordSet }; codeLocked: boolean; cnicMasked: string | null /* office only */ }
  ```
- **`PATCH /distributors/:id`** `{ businessName?, name?, email?, phone? }`. A phone change is normalised (`INVALID_PHONE` as in rule 1) and unique, and bumps `tv`. Audited with before and after.
- **`PATCH /distributors/:id/store`** `{ name?, address?, lat?, lng? }`. The zone is recomputed (`STORE_OUTSIDE_ZONES`). Audited.
- **`PATCH /distributors/:id/code`** `{ code }`. Allowed only before the distributor's first order (`DISTRIBUTOR_CODE_LOCKED`).
- **`PATCH /distributors/:id/approve`** activates from PENDING (body optional) or reactivates from SUSPENDED (body `{ reason (5–300) }` required, else 400 `VALIDATION_FAILED` on `reason`). `distributors.status` and `users.status` become ACTIVE in one transaction, with the audit row `distributor.activate` (diff `{ from }`, plus the reason). It answers 200 with `DistributorDto`, or 200 with `X-Already-Applied` and no audit row when the distributor is already ACTIVE. The website's "Activate distributor" and "Reactivate…" both use it.
- **`PATCH /distributors/:id/suspend`** `{ reason (5–300) }` sets `distributors.status` and `users.status` to SUSPENDED and bumps the user's `tv` in one transaction, with the audit row `distributor.suspend`: the shop is signed out within 60 seconds (401 `AUTH_SESSION_REVOKED`) and a new sign-in gets 403 `AUTH_ACCOUNT_NOT_ACTIVE`. Orders already placed continue and the balance is unchanged; `DISTRIBUTOR_NOT_ACTIVE` still guards placing orders, top-up requests and refills. A repeat answers 200 with `X-Already-Applied` and writes no audit row. A distributor's two status columns always change together, whichever route changes them.
- **`GET /distributors/me`** (DISTRIBUTOR exact): own `DistributorDto` without readiness or `cnicMasked`.
- **`GET /distributor/home`** (DISTRIBUTOR exact): one round trip for the home screen. `orders.active` = the size of the `active` tab (§7.6); `onTheWay` = orders at stage ON_THE_WAY; `deliveredToday` = DELIVERED with `deliveredAt` in the current business day.
  ```
  { distributor: { businessName, code, status, storeSet }, wallet: WalletSummary,
    orders: { active, onTheWay, deliveredToday } }
  ```

### 7.4 Customers (DISTRIBUTOR exact; the office reads with `?distributorId=`)
- **`POST /clients`** (Idempotency-Key). **BREAKING:** the phone must be valid and is stored normalised.
  - Body: `{ name (1–80), phone, address?: { label (1–60), lat, lng }, area?, notes? (≤ 200) }`. The legacy fields `creditLimitRs`, `priority` and `city` are ignored.
  - Rules:
    1. `normalizePkPhone`, else 400 `CLIENT_PHONE_INVALID`.
    2. Unique within the distributor (409 `CLIENT_PHONE_EXISTS` `{clientId, name}`). Checked here and again inside the create transaction after locking the distributor row (`SELECT id FROM distributors WHERE id = $d FOR UPDATE`), so two adds of one number at the same moment give one 201 and one 409, even before inc1b. From inc1b the unique index `clients_distributor_id_phone_key` is the safety net, mapped to the same 409 with the existing customer's id and name.
    3. With an address: `PricingService.quoteLocation`. A non-null `blockCode` gives 422 with that code: `PRICING_ZONE_NOT_COVERED`, or `PRICING_PRICE_NOT_SET` `{zoneId, zoneName}`.
    4. The client and address are created in one transaction. `client_addresses.zone_id` is set. No audit row (Appendix B). The Idempotency-Key is stored as `clients.client_request_id`; a retry with it is answered before rule 1: 200 with `Idempotent-Replay: true`, the first customer, its first address and today's price for it (§4.2).
  - Response 201:
    ```
    { client: { id, name, phone, area, notes },
      address: { id, label, lat, lng, zone: { id, name } } | null, price: PriceView | null }
    ```
- **`GET /clients`** returns a bare array, as today. A distributor gets its own customers; any `distributorId` it sends is ignored. The office must pass `?distributorId=`: without it, 400 `VALIDATION_FAILED` (`distributorId`, `REQUIRED`); an id that names no distributor gives `[]`. Each row gains `addresses: [{ id, label, lat, lng, zone: { id, name } | null, priceStatus: 'SET' | 'NOT_SET' | 'OUTSIDE' }]`. `zone` and `priceStatus` come from a live check of the pin (active zones only, the §5.6 rule, then this distributor's price there), not from the stored `zone_id`: an address in an archived zone shows the zone now covering it, or `zone: null` with `OUTSIDE`.
- **`GET /clients/:id/addresses`** and **`POST /clients/:id/addresses`** `{ label, lat, lng }`: own client only, else 404 `CLIENT_NOT_FOUND` (today there is no check). POST runs the same coverage check and returns `{ id, label, lat, lng, zone, price, ok: true }`. GET returns the same live `zone` and `priceStatus` as `GET /clients`. Addresses are add-only in the pilot: there is no edit or delete route. To change where a customer gets deliveries, add an address and pick it on the order; old addresses stay listed.

### 7.5 Delivery prices and quotes
```ts
PriceView     = { zone: { id; name }; basePaisa; sizes: { cylinderTypeId; sizeLabel; perCylinderPaisa }[]; updatedAt }  // all active sizes; missing = "0"
LocationQuote = { serviceable: boolean; zone: { id; name } | null; price: PriceView | null;
                  blockCode: null | 'PRICING_ZONE_NOT_COVERED' | 'PRICING_PRICE_NOT_SET' }
                // serviceable === (blockCode === null). PRICING_PRICE_NOT_SET: { serviceable: false, zone, price: null }. PRICING_ZONE_NOT_COVERED: { serviceable: false, zone: null, price: null }.
DeliveryQuote = { strategy: FeeStrategy; zone: { id; name }; basePaisa;
                  lines: { cylinderTypeId; sizeLabel; count; perCylinderPaisa; subtotalPaisa }[]; totalPaisa }
```
- **`GET /pricing/prices/:distributorId`** (office) returns the grid:
  ```
  { distributor: { id, businessName, code, store: { id, name, zone: { id, name } } },
    sizes: [{ cylinderTypeId, code, label }],
    zones: [{ zone: { id, name, cityName, isActive },
              price: null | { basePaisa, sizes: [{ cylinderTypeId, perCylinderPaisa }], updatedAt, updatedBy: { id, name } | null } }],
    coverage: { priced, total } }
  ```
  `total` counts active zones.
- **`PUT /pricing/prices/:distributorId/:zoneId`** (office): `{ basePaisa, sizes?: [{ cylinderTypeId, perCylinderPaisa }], note? }`.
  - Every amount is whole rupees from Rs 0 to Rs 100,000 inclusive. Any bad amount (negative, paisa, not a whole number, not a number, above Rs 100,000) is `PRICE_INVALID` (400 `PRICE_INVALID` when nothing else in the body is wrong, else `VALIDATION_FAILED` with that field coded `PRICE_INVALID`, §2.2), never `AMOUNT_NOT_WHOLE_RUPEES`; a missing `basePaisa` is `VALIDATION_FAILED` (`REQUIRED`). Sizes are optional; a missing size is 0. The zone must be active (`ZONE_ARCHIVED`).
  - One transaction: upsert the row and replace its size rows. Audit `price.set` with before and after.
  - New orders use it immediately. Placed orders keep their copy.
  - Response 200 (a first save or an edit): the zone's row as in the grid, `{ zone: { id, name, cityName, isActive }, price: { basePaisa, sizes: [{ cylinderTypeId, perCylinderPaisa }] (every active size; missing "0"), updatedAt, updatedBy: { id, name } } }`. A PUT whose base, per-size amounts (missing = 0) and note equal the stored price changes nothing and writes no `price.set` row; it still answers 200 with the row. An unknown distributor or zone: 404 `NOT_FOUND`; a size that isn't an active cylinder type: 404 `NOT_FOUND` `{field: 'sizes'}`.
- **`DELETE /pricing/prices/:distributorId/:zoneId`** (office): `{ reason (5–300) }`. Removes the price, which blocks that zone again. Audit `price.remove`, with the old price as before. Response 200: the same row as PUT with `price: null`. With no price set: 200 with `X-Already-Applied: true` and no audit row. It also works on an archived zone.
- **`GET /pricing/quote?lat&lng`** (DISTRIBUTOR exact; the office adds `&distributorId`): **200 always**, returning `LocationQuote`. It feeds the live pin panel.
- **`POST /orders/quote`** (DISTRIBUTOR exact)
  - Body: the same as create.
  - Response: `{ quote: DeliveryQuote, wallet: { balancePaisa, enough, shortByPaisa } }`.
  - Rules: the body schema and rules 1–4 of `POST /orders` (400 `ORDER_LINES_INVALID` / `ORDER_TOO_MANY_CYLINDERS` / `VALIDATION_FAILED`, 403 `DISTRIBUTOR_NOT_ACTIVE`, 409 `DISTRIBUTOR_NO_STORE`, 404 `CLIENT_NOT_FOUND` / `CLIENT_ADDRESS_NOT_FOUND`, 422 pricing codes). It writes nothing and ignores `quotedTotalPaisa`.

### 7.6 Orders
- **`POST /orders`** (DISTRIBUTOR exact, Idempotency-Key). The office can't place orders for a distributor in the pilot.
  - Body:
    ```
    { clientId, addressId? | deliveryLocation?: { lat, lng }, deliveryLabel (1–255),
      lines: [{ cylinderTypeId, fullCount 1–100, expectedReturnCount 0–100 }] (1–6 lines, unique types),
      quotedTotalPaisa?, scheduledWindowStart?, scheduledWindowEnd?, note? (≤ 200) }
    ```
    The installed body (PlaceOrderScreen.tsx:131-140) is still valid. The body schema runs first: no lines, more than 6 lines, a repeated size or a `fullCount` below 1 give 400 `ORDER_LINES_INVALID` (or `VALIDATION_FAILED` when other fields are wrong too, §2.2); a count above 100 or not a whole number gives `VALIDATION_FAILED`.
  - Rules, in order:
    1. Distributor ACTIVE (`DISTRIBUTOR_NOT_ACTIVE`) with a store (`DISTRIBUTOR_NO_STORE`).
    2. The client and address are the caller's (`CLIENT_NOT_FOUND`, `CLIENT_ADDRESS_NOT_FOUND`).
    3. The total `fullCount` is at or below `orders.maxCylindersPerOrder` (400 `ORDER_TOO_MANY_CYLINDERS` `{max}`). This is the only cylinder cap, a single line included; at least one full cylinder is already guaranteed by the body schema.
    4. Quote (422 pricing codes).
    5. If `quotedTotalPaisa` was sent and differs from the quote: 409 `PRICING_QUOTE_CHANGED` `{totalPaisa, quote}`.
    6. One transaction, as in DATA_MODEL §3.6:
       - number the order;
       - raw INSERT with the fee copy and `origin_store_id = home store`;
       - insert the lines;
       - `OrdersFeePolicy.onCreated`, which deducts the cost: 409 `WALLET_INSUFFICIENT_BALANCE` `{requiredPaisa, balancePaisa, shortByPaisa}`, and nothing is created;
       - audit `order.create`.
    7. Enqueue auto-dispatch only if `dispatch.autoAssign.enabled`, after the commit. The answer waits at most 1.5 seconds for the enqueue (BullMQ waits for Redis to come back instead of failing). Past that, or on an error, the order is answered without it, and the office assigns it by hand (§2.2: Redis being down never fails a request).
  - Response 201: `OrderDto` (200 plus `Idempotent-Replay` on a retry).
- **`GET /orders`** (DISTRIBUTOR exact)
  - Without `tab`: a bare array of the newest 100 `OrderDto`.
  - With `?tab=active|done&cursor`: `{ items, nextCursor }`. `active` = PENDING, CONFIRMED, ASSIGNED or IN_TRANSIT; `done` = DELIVERED, CANCELLED or FAILED, from any date. Both are newest first by `createdAt`, then id.
- **`GET /orders/:id`** (`canSeeOrder`): `OrderDto`. The driver appears as `{ id, name, phone }` only; today orders.service.ts:82 leaks the password hash and CNIC.
- **`GET /orders/:id/tracking`** (owning distributor or office): the shape at orders.service.ts:92-124 is unchanged. Today it is open to anyone. The owning distributor gets `driverLocation` only while the order is at stage ON_THE_WAY on a PLANNED or IN_PROGRESS trip (the TRACK rule, §1.6). Otherwise it is `null`, so a delivered, cancelled, failed or reassigned order never shows where its driver is now. The office always gets it (it sees every driver on `GET /drivers`). Accepted for the pilot: while its order is on the way, the shop also sees the driver when he is serving another distributor's trip at the same time (assign-driver rule 2 lets a busy driver take another run).
- **`GET /orders/board`** (office): `?tab=needs-driver|in-progress|done-today|cancelled-failed|all&q&distributorId&cursor`.
  - Returns `{ counts: { needsDriver, inProgress, doneToday, cancelledFailed }, items: OrderDto[], nextCursor }`.
  - `needs-driver` = PENDING or CONFIRMED, oldest first. `in-progress` = ASSIGNED or IN_TRANSIT, any day. `done-today` = DELIVERED with `deliveredAt` in the current business day. `cancelled-failed` = CANCELLED or FAILED with `cancelledAt` or `failedAt` in the current business day or the 6 before it. `all` = every order. Every tab but `needs-driver` is newest first by `createdAt`, then id. `counts` are the sizes of the four tabs, with `distributorId` applied and `q` ignored. `GET /admin/summary` and `GET /distributor/home` use the same sets.
- **`GET /orders/all`** (office): legacy array, kept for one release.
- **`POST /orders/:id/cancel`** (the owning DISTRIBUTOR, exact, or the office; Idempotency-Key)
  - Body: `{ reasonCode: OrderCancelReason, note?, confirmRefundPaisa? }`.
    - `note`: from the owning distributor, optional except for OTHER, 3–300 characters when sent; from the office, always required, 5–300 characters.
    - `confirmRefundPaisa` is the refund the user saw.
  - Allowed while the status is PENDING, CONFIRMED, ASSIGNED or IN_TRANSIT **and** no hand-over has started. Checked under the order lock (step 1 below), in order: already CANCELLED → 200 with `X-Already-Applied` and `{ order, refundedPaisa }` as the first cancel returned (the fee when the fee status is REVERSED, else "0"); DELIVERED or FAILED → 409 `ORDER_NOT_CANCELLABLE` `{currentStatus}`; a hand-over started → 409 `ORDER_HANDOVER_STARTED`; then steps 2–7.
  - One transaction, as in DATA_MODEL §3.6:
    1. Lock the order.
    2. Compute `cancelTerms`.
    3. If `confirmRefundPaisa` was sent and differs from `refundPaisa`: 409 `ORDER_CANCEL_TERMS_CHANGED` `{refundPaisa}`, so the UI asks again.
    4. Guarded update to CANCELLED.
    5. If `refundPaisa > 0`: `WalletService.reverse`, and the fee status becomes REVERSED.
    6. The stop becomes CANCELLED. The trip is ABORTED if it has no other open order and no cylinder event other than a hand-back (SCAN_IN), as in assign-driver rule 4.
    7. Audit `order.cancel` `{refunded, refundPaisa, startedRule}`.
  - A repeat (any caller, `/cancel` or `PATCH status CANCELLED`) is answered as above, never with a second reversal.
  - Response: `{ order: OrderDto, refundedPaisa }`.
- **`POST /orders/:id/fail`** (the trip's DRIVER, exact, or the office; another driver gets 404 `NOT_FOUND`, a DISTRIBUTOR 403 `PERMISSION_DENIED`)
  - Body: `{ reasonCode: DeliveryFailureReason, note?, lat?, lng? }`. `note`: from the trip's driver, required for OTHER (3–300 characters); from the office, always required (5–300 characters).
  - After the role and ownership checks, under the order lock, in order: already FAILED → 200 with `X-Already-Applied` and the order; DELIVERED or CANCELLED → 409 `ORDER_INVALID_TRANSITION` `{from, to: 'FAILED', currentStatus}`; a hand-over started → 409 `ORDER_HANDOVER_STARTED`; PENDING or CONFIRMED (no driver has it), or delivery not **started** → 409 `ORDER_NOT_STARTED_USE_CANCEL`; otherwise ASSIGNED or IN_TRANSIT becomes FAILED.
  - Effects: FAILED, `failed_at` and the reason; the stop becomes FAILED. **No money.** Audit `order.fail`.
- **`PATCH /orders/:id/status`** (legacy; used by the installed driver app and the admin web). Body `{ status, reason?, reasonCode? }`. There are now from-state rules; today ROLE_ALLOWED_TARGETS at orders.controller.ts:11-16 has none.

  | Caller | Change | Rules |
  |---|---|---|
  | DRIVER (exact) | ASSIGNED to IN_TRANSIT | own trip; sets `onTheWayAt` |
  | DRIVER (exact) | ASSIGNED or IN_TRANSIT to **DELIVERED** | The order must be on a trip whose `driverId` is the caller (otherwise 404 `NOT_FOUND` from `canSeeOrder`), and the trip PLANNED or IN_PROGRESS (a PLANNED trip is auto-started). The transaction locks the order and runs `UPDATE … SET status = 'DELIVERED', delivered_at = now(), delivered_by_user_id, delivery_method = 'DRIVER_TAP' WHERE delivered_at IS NULL AND status IN ('ASSIGNED','IN_TRANSIT')`. **No money.** A repeat of the tap (already DELIVERED by `DRIVER_TAP`) returns 200 `X-Already-Applied`; an order delivered another way (the office's manual delivery) gives 409 `ORDER_INVALID_TRANSITION` `{from: 'DELIVERED', to: 'DELIVERED', currentStatus: 'DELIVERED'}`. |
  | DRIVER, office | to FAILED | as `/fail` |
  | Office | to CANCELLED | as `/cancel` |
  | Office | PENDING to CONFIRMED | allowed but never offered in the UI |
  | Office | to DELIVERED | 400 `ORDER_USE_MANUAL_DELIVERY` |
  | DRIVER (own trip) or office | anything else | 409 `ORDER_INVALID_TRANSITION` `{from, to}` |

  The route allows DRIVER and the office only (`@Roles(DRIVER)`): any other role gets 403 `PERMISSION_DENIED` before the order is read, and a driver not on the order's trip gets 404 `NOT_FOUND`.

- **`POST /orders/:id/assign-driver`** (office): `{ driverId, reason? }`. A legacy `originStoreId` is ignored.
  - Rules:
    1. Lock the order row (`SELECT … FOR UPDATE`). The status is PENDING, CONFIRMED or ASSIGNED (`ORDER_NOT_ASSIGNABLE`). If it is already ASSIGNED on a PLANNED or IN_PROGRESS trip of this same driver, stop here: nothing changes, and the answer is 200 with `X-Already-Applied` and `{ tripId, driverId, originStoreId }`, with no audit row. An `Idempotency-Key`, if sent, is not read.
    2. The driver's user is ACTIVE and `drivers.availability` is AVAILABLE, not ON_LEAVE or OFF_DUTY (`ASSIGN_DRIVER_NOT_AVAILABLE` `{driver}`), and a van is set (`ASSIGN_DRIVER_NO_VEHICLE` `{driver}`). Being on another PLANNED or IN_PROGRESS trip, or offline, never blocks: Inc 1 makes a new trip, and Inc 2 follows the append rule (§9.5).
    3. The origin is `distributor.homeStoreId` (`DISTRIBUTOR_NO_STORE`).
    4. If the order already has a trip with `loadStartedAt`, or with any cylinder event other than a hand-back at the store (SCAN_IN), meaning a load scan or a cylinder given to or taken from a customer (in Inc 1 a DELIVERED scan needs no load on the trip): 409 `ASSIGN_ORDER_LOADED` `{plateNo}`, even after the store has scanned the cylinders back in (ADR-12). A SCAN_IN of empties left on the van from an earlier run loads nothing and doesn't block. Otherwise its stop becomes CANCELLED, and the old trip is ABORTED if it has no other open order.
    5. Create the trip: STORE_PICKUP seq 0 at the home store (`store_id` set), then DELIVERY seq 1. The order becomes ASSIGNED with `assigned_at = now()`. Audit `order.assign` or `order.reassign`.
  - Response: `{ tripId, driverId, originStoreId, reassignedFromTripId? }`.
- **`POST /orders/:id/manual-delivery`** (office, the forgotten-IN path): `{ reason (10–300) }`.
  - Lock the order row. ASSIGNED or IN_TRANSIT becomes DELIVERED, with `delivery_method = 'MANUAL'` and `manual_delivery_reason`, and the order's DELIVERY stop becomes DONE. **No money.** Audit `order.manual_delivery`.
  - A repeat after this office delivery (DELIVERED by MANUAL) returns 200 with `X-Already-Applied` and the order, writing nothing. Any other status (PENDING, CONFIRMED, CANCELLED, FAILED, or DELIVERED by the driver) gives 409 `ORDER_INVALID_TRANSITION` `{from, to: 'DELIVERED', currentStatus}`. Inc 2's v2 uses the same rule.
  - Inc 2 adds the named cylinders (§9.5).

### 7.7 Trips and the legacy scan route
- **`GET /trips/mine`** and **`GET /trips/next-suggestions`** (DRIVER exact): unchanged shapes. While `features.transfers` is off, next-suggestions lists no TRANSFER rows (§3.4). A transfer left open from before the switch-over is never offered, because the installed app can't open one while the module is off.
- **`GET /trips/:id`** (the trip's driver or the office): the existing shape plus `stops[].status` and `allowedActions` (shared-types `TripViewDto` / `TripStopDto`, §7). Today trips.controller.ts:14-48 has no roles at all.
- **`PATCH /trips/:id/status`** `{ status, reason? }`:
  - the driver (exact, own trip): PLANNED to IN_PROGRESS, setting `startedAt`. Starting a trip never changes its orders: they stay ASSIGNED until the STORE_PICKUP stop departs (§8.1);
  - the driver: IN_PROGRESS to COMPLETED, only if every order on it is DELIVERED, CANCELLED or FAILED (409 `TRIP_ORDERS_OPEN`);
  - the office: to ABORTED with a `reason` (5–300 characters, else 400 `VALIDATION_FAILED`), only while nothing has happened on the trip: no cylinder event with its `trip_id`, no stop with `arrivedAt` or `departedAt`, and every order on it ASSIGNED with `loadStartedAt` null (or CANCELLED). Otherwise 409 `TRIP_INVALID_TRANSITION` `{currentStatus}`. One transaction locks the trip's orders, then the trip; it sets the trip ABORTED and every open stop CANCELLED, and sends each ASSIGNED order back to PENDING with `trip_id` and `assigned_at` cleared (stage NEEDS_DRIVER). **No money.** Audit `trip.abort*` `{orderIds}`;
  - a repeat of the status the trip already has, by a caller who may make that change (the driver: IN_PROGRESS or COMPLETED; the office: ABORTED), returns 200 with `X-Already-Applied` and changes nothing;
  - anything else: 409 `TRIP_INVALID_TRANSITION` `{currentStatus}`.
- **`PATCH /trips/stops/:stopId/arrive`** and **`/depart`** (DRIVER exact, own trip). Timestamps are set only if null, so a repeat changes nothing and returns 200 with `X-Already-Applied`.
  - The first arrive auto-starts a PLANNED trip (the trip only; its orders don't change).
  - Arrive sets the stop to ARRIVED. Depart sets it to DONE with `completedAt`.
  - Departing the STORE_PICKUP stop sets the trip's ASSIGNED orders to IN_TRANSIT with `onTheWayAt`.
- **`POST /custody/scan`** (DRIVER exact; the installed ScanScreen.tsx:58 and DeliverySteps flow)
  - Body: `{ qrCode (3–128, trimmed), eventType: 'SCAN_OUT'|'DELIVERED'|'PICKED_UP_EMPTY'|'SCAN_IN', tripId (required), orderId (required for DELIVERED and PICKED_UP_EMPTY), lat?, lng? }`.
    - `toCustodyType` and `toCustodyId` are rejected by validation: 400 `VALIDATION_FAILED`, field code NOT_ALLOWED (custody.service.ts:63-75 accepts them today). Other unknown fields are dropped.
    - Any other `eventType` gives 403 `SCAN_EVENT_NOT_ALLOWED`. `RETURNED_TO_DISTRIBUTOR` is how EMPTY was laundered into FULL.
  - Checks, in the §9.2 order (there are no stops and no `scanId`):
    - the body (400; another `eventType` 403 `SCAN_EVENT_NOT_ALLOWED`);
    - the trip is the caller's (404) and PLANNED or IN_PROGRESS (409 `SCAN_TRIP_CLOSED`); a SCAN_OUT first locks the trip's orders `FOR UPDATE`, as a LOAD does;
    - when `orderId` is sent, the order is on that trip (403 `ORDER_NOT_ON_YOUR_TRIP`, the same answer for any id that isn't on it);
    - the QR value is known (404 `SCAN_CYLINDER_UNKNOWN`);
    - the cylinder row is locked `FOR UPDATE`;
    - owner (409 `SCAN_WRONG_OWNER`): the trip's distributor for SCAN_OUT and SCAN_IN, the order's for DELIVERED and PICKED_UP_EMPTY;
    - the same move again (below);
    - FAULTY or LOST gives 409 `SCAN_CYLINDER_BLOCKED` for SCAN_OUT and DELIVERED; PICKED_UP_EMPTY and SCAN_IN move it and keep its state;
    - then the rules of its row below. The vehicle is always **`trip.vehicleId`**, not `driver.currentVehicleId` (custody.service.ts:184-194).

  | eventType | Cylinder must be | Effect / error |
  |---|---|---|
  | SCAN_OUT | in STORE = `trip.originStoreId`, owned by the trip's distributor, FULL | goes to VEHICLE. **Locks the trip's orders and stamps `load_started_at`** (DATA_MODEL §3.6). Errors: `SCAN_NOT_AT_STORE`, `SCAN_WRONG_OWNER`, `SCAN_NOT_FULL`. |
  | DELIVERED | on VEHICLE = the trip's van; owned by the order's distributor; FULL | goes to CLIENT; `SCAN_NOT_ON_YOUR_VAN`, `SCAN_NOT_FULL` |
  | PICKED_UP_EMPTY | with CLIENT = `order.clientId`; not delivered on this order | goes to VEHICLE; `SCAN_NOT_WITH_THIS_CUSTOMER`, `SCAN_GIVEN_THIS_VISIT` |
  | SCAN_IN | on the trip's van | goes to STORE = `trip.originStoreId` |

  - A recorded move returns 201 with the existing body `{ event, cylinderId, newState, toType, toId }` (the installed ScanScreen.tsx reads `newState` and `toType`).
  - A repeat of the same move (the cylinder's last event is the same event type on the same trip and the same order, and the cylinder is still at that event's destination) writes nothing and returns 200 with `X-Already-Applied: true` and the same body plus `alreadyRecorded: true`.

### 7.8 Wallet
- **`GET /wallet`** (DISTRIBUTOR exact): `WalletSummary`.
- **`GET /wallet/statement?kind&from&to&cursor&limit`** (DISTRIBUTOR exact): `Page<StatementItem>`, from the ledger only. `kind` is one `StatementKind` or a comma-separated list of distinct ones (`kind=DELIVERY_COST,DELIVERY_COST_RETURNED`); an unknown or repeated value is 400 `VALIDATION_FAILED` on `kind`. `from` and `to` take a business date (`YYYY-MM-DD`: the whole business day, so `to` runs to the start of the next one, exclusive) or an ISO instant (inclusive). Ledger rows of one distributor have strictly increasing `created_at` (each at least 1 ms after the previous), so the statement's order is the order the balance moved in. The office statement (`/admin/distributors/:id/wallet/statement`) takes the same. Correction notes and top-up bank references are not shown to distributors; `reasonCode` and the order's customer name are.
- **`GET /ledger/balance`** (compatibility, DISTRIBUTOR exact): `{ balancePaisa, pendingTopupPaisa }`.
- **`GET /ledger/me`** (compatibility): an array of the newest 100 ledger rows. Today ADMIN read every ledger through an undefined filter.
- **`GET /admin/wallets`** (office): `AdminWalletRow[]` = `[{ distributorId, businessName, code, balancePaisa, lowBalance, checkingPaisa, checkingCount, lastTopupAt }]`. `lowBalance` is the same flag as `WalletSummary.lowBalance`: `balancePaisa` < `wallet.lowBalancePaisa`, strictly below, so Rs 0 never warns (the Wallets list's "Low" chip, UX_ADMIN §2.6). `lastTopupAt` = when the latest approved top-up was approved (`completed_at` of its newest SUCCESS payment), null if none; requests being checked or rejected don't count.
- **`GET /admin/distributors/:id/wallet`** (office): `WalletSummary & { integrity: { ok, ledgerSumPaisa, differencePaisa, checkedAt } }`. `differencePaisa` = `balancePaisa` − `ledgerSumPaisa`, signed: "12000" when the balance is Rs 120 above its history, "-12000" when below, "0" when `ok`. It is computed live and only reads: it never raises, changes or resolves an alert (only the nightly job raises `WALLET_CHECK_MISMATCH`, §8.5). The server doesn't refuse corrections during a mismatch; the website disables "Record correction" while `integrity.ok` is false (UX_ADMIN §2.6).
- **`GET /admin/distributors/:id/wallet/statement`** (office): `Page<StatementItem>` with `note` and `by`.
- **`POST /admin/distributors/:id/wallet/corrections`** (office, Idempotency-Key)
  - Body: `{ direction: 'ADD' | 'TAKE', amountPaisa (> 0, whole rupees, ≤ Rs 100,000), reasonCode: CorrectionReason, note (10–300), relatedPaymentId?, relatedOrderId? }`.
  - Response 201: `{ entry: StatementItem, wallet: WalletSummary }`.
  - Idempotency-Key required (§4.2). The same key and body again: 200 with `Idempotent-Replay: true` and `{ entry: <the original entry>, wallet: <the wallet now> }`, with no new ledger or audit row. The same key with any other difference: 409 `IDEMPOTENCY_CONFLICT`, nothing written.
  - Rules, in order: the body (400); the Idempotency-Key (§4.2); the related payment or order, when sent, belongs to this distributor, in any status (else 404 `NOT_FOUND` `{field: 'relatedPaymentId' | 'relatedOrderId'}`); TAKE needs balance ≥ amount (409 `WALLET_ADJUST_EXCEEDS_BALANCE` `{balancePaisa}`). `wallet.maxBalancePaisa` doesn't apply: corrections are never capped. The related ids are stored on the ledger row (`payment_id`, `order_id`) for tracing only, and the entry's `subject` is the related order, else the related top-up, else null. A refused correction writes nothing.
  - Errors: `VALIDATION_FAILED`, `IDEMPOTENCY_CONFLICT`, `NOT_FOUND` `{field}`, `WALLET_ADJUST_EXCEEDS_BALANCE` `{balancePaisa}`.
  - Audit `wallet.correction`.
  - Allowed whatever the distributor's status (waiting to start, active or suspended).

### 7.9 Top-ups (manual bank, pilot step 1)
- **`GET /payments/topup-info`** (DISTRIBUTOR exact)
  - Returns:
    ```
    { account: { accountTitle, bankName, iban, accountNumber },
      limits: { minPaisa, maxPaisa, maxNowPaisa | null }, quickAmountsPaisa,
      payerChannels: ['EASYPAISA_APP', 'BANK_APP', 'OTHER'], checkingHours: { from, to },
      support: { phone, hours }, pending: { count, totalPaisa }, training: boolean }
    ```
  - If `topup.account` is not set: 503 `TOPUP_ACCOUNT_NOT_CONFIGURED`.
- **`POST /payments/topup-requests`** (DISTRIBUTOR exact, Idempotency-Key): the "tell us you paid" step.
  - Body: `{ amountPaisa, payerName (2–60), payerChannel, transactionId? (≤ 40, [A-Za-z0-9-]), proofFileId? }`.
  - Rules:
    1. `topup.account` is set, else 503 `TOPUP_ACCOUNT_NOT_CONFIGURED`.
    2. The distributor is ACTIVE, else 403 `DISTRIBUTOR_NOT_ACTIVE` (a distributor waiting to start or suspended can't send requests).
    3. Whole rupees, within the minimum and maximum (`TOPUP_AMOUNT_TOO_SMALL` / `_TOO_LARGE` `{minPaisa, maxPaisa}`).
    4. With a cap: balance + pending + amount ≤ cap, else `TOPUP_WOULD_EXCEED_CAP` `{capPaisa, maxNowPaisa}`. The cap limits top-ups only; office corrections ignore it (§7.8).
    5. Pending requests below `topup.maxPendingPerDistributor` (`TOPUP_TOO_MANY_PENDING` `{count}`).
    6. `proofFileId` is the caller's own TOPUP_PROOF upload (`FILE_NOT_FOUND`).
    7. Insert with `provider = 'BANK_MANUAL'`, `provider_txn_id = NULL`, the next `request_no`, status PENDING. Audit `topup.request`.

    The body schema and the Idempotency-Key lookup (§4.2) run before rule 1. A refused request writes nothing.
  - Response 201: `PaymentDto`.
- **`GET /payments/mine`** (bare array) and **`GET /payments/:id`** (`canSeePayment`): `PaymentDto`.
- **`GET /admin/topups?tab=to-check|approved|rejected|all&q&cursor`** (office)
  - Returns `{ counts: { toCheck, approved, rejected }, approvedToday: { count, totalPaisa }, items: PaymentDto[], nextCursor }`. `approvedToday` = requests approved (`completed_at`) in the current business day (Asia/Karachi, 03:00 cut-off), with the credited amounts summed; `GET /admin/summary` uses the same.
  - To-check is sorted oldest first; the others newest first.
  - `q` (1–100 characters) matches, case-insensitively, part of the distributor's business name, the payer name or the transaction ID; the request's short code exactly, in any letter case (`AG-T031`); or, when it normalises to 3 or more characters, part of the normalised bank reference (`ft 7781` finds `FT-7781-4402`).
- **`POST /payments/:id/approve`** (office, Idempotency-Key)
  - Body: `{ bankReference, bankAmountPaisa, bankTime }`, all required.
  - Rules:
    1. Lock the payment. It must be PENDING (409 `TOPUP_NOT_PENDING` `{status, reviewedBy, reviewedAt}`, a REJECTED request included), or 200 `X-Already-Applied` when it is SUCCESS with the same reference. It must be BANK_MANUAL.
    2. The reference as typed is trimmed and at most 100 characters; its normalised key (upper-case, only A–Z and 0–9) must be 3–40 characters, else `TOPUP_BANK_REFERENCE_REQUIRED`. `bank_reference` keeps the trimmed text, `bank_reference_key` the key.
    3. `bankTime` may be at most 5 minutes after the server clock, to allow for clock differences; later is `TOPUP_BANK_TIME_IN_FUTURE`. There is no lower bound (the drawer only warns when it is more than 24 hours before the request).
    4. The bank amount must be whole rupees and within the limits.
    5. If the bank amount differs from the request:
       - `topup.onAmountMismatch = CREDIT_BANK_AMOUNT` credits the bank amount, and the response says `amountDiffered: true`;
       - `REJECT` gives 409 `TOPUP_AMOUNT_MISMATCH`.
    6. The cap is checked against the credited amount (`TOPUP_WOULD_EXCEED_CAP`).
    7. One transaction, as in DATA_MODEL §3.6: guarded update, `WalletService.creditTopup`, audit `topup.approve`. A reused reference gives 409 `TOPUP_BANK_REFERENCE_USED` `{paymentShortCode, distributorName, approvedAt}`.
  - Response: `{ payment: PaymentDto, wallet: WalletSummary, amountDiffered: boolean }`.
  - The distributor's status doesn't matter for approve or reject: a request sent before a suspension (or while waiting to start) can still be approved, because the money is in the bank, or rejected.
- **`POST /payments/:id/reject`** (office): `{ reasonCode: TopupRejectReason, note? }`. `note` is required for OTHER. A guarded update from PENDING to REJECTED. Audit `topup.reject`. Response 200 `{ payment: PaymentDto }`. A repeat on a REJECTED request: 200 with `X-Already-Applied: true`, the request unchanged (the first reason and note stay) and no new audit row. On an approved request: 409 `TOPUP_NOT_PENDING` `{status, reviewedBy, reviewedAt}`.
- **Legacy routes**, kept for installed apps:
  - **`POST /payments/topup`** (DISTRIBUTOR exact): BANK_MANUAL only, with rules 1–5 of `POST /payments/topup-requests` (503 `TOPUP_ACCOUNT_NOT_CONFIGURED` first). The payer name is null and `provider_txn_id` is NULL. The response is still `{ paymentId, formFields: { instructions } }`, with the instructions taken from `topup.account`.
  - **`POST /payments/:id/bank-proof`** (DISTRIBUTOR exact): own payment, PENDING, and `proofUrl` must resolve to an `uploads/` key the caller uploaded (a `stored_files` lookup).
  - **`POST /payments/:id/verify`** (office): `approve` must be a strict boolean. `false` rejects a PENDING request with reason OTHER and the note "Call the office for the reason." (audit `topup.reject` with the reason "Rejected through the legacy verify route"), answering like `POST /payments/:id/reject`; `true` gives 400 `TOPUP_BANK_REFERENCE_REQUIRED`. DISPATCHER no longer gets in.
- **`GET /payments?status=`**: legacy array, office only, kept for one release.

### 7.10 Files
- **`POST /files/upload`** (DISTRIBUTOR, DRIVER, office; multipart `file`, field `purpose`)
  - The default purpose follows the role: DISTRIBUTOR gets TOPUP_PROOF; others get OTHER. EXPENSE_RECEIPT is office only (anyone else: 403 `PERMISSION_DENIED`); `DAY_END_SHEET` and `DAY_END_UPLOAD` are never accepted here (400 `VALIDATION_FAILED` on `purpose`, code `INVALID_CHOICE`).
  - JPEG, PNG or WebP, checked by magic bytes, at most 5 MB = 5,242,880 bytes (one byte more: 413 `FILE_TOO_LARGE` `{maxMb: 5}`); anything else, an empty file included, gives 415 `FILE_TYPE_NOT_ALLOWED`. Checks run in this order: authentication (401), roles (403), rate limit (429), size while the file streams in (413), the `purpose` value (400), file missing (400 `VALIDATION_FAILED` on `file`), the purpose rule (403 or 400), type (415).
  - Inserts `stored_files`. The same uploader uploading the same sha256 for the same purpose gets the existing row (no new object). A storage failure gives 503 `SERVICE_UNAVAILABLE`. The key is `uploads/<UTC yyyy-mm-dd>/<uuid>.<ext>`.
  - Response 201: `{ fileId, key, url /* signed 1 h */, mimeType, size }`, also when the existing row is returned. `url` is kept for the installed TopupScreen.tsx:55-70.
  - The bucket stays private: remove the public-read policy at files.service.ts:47-63.
- **`GET /files/:id/url`**: the uploader or the office gets 200 `{ url }` (1 hour); anyone else, an unknown id or an id that isn't a UUID gets 404 `FILE_NOT_FOUND`, with the same body.

### 7.11 Refills (Inc 1 changes; scans arrive in Inc 3)
- **`POST /filling-orders`** (DISTRIBUTOR exact). Inc 1 doesn't read the `Idempotency-Key`: the column for it arrives in inc3 (§10.1), so a doubled request makes two PENDING refills, and the owner can cancel either.
  - Body: `{ fillingStationId, cylinderTypeId, requestedCount }`.
  - Rules:
    - The distributor is ACTIVE, else 403 `DISTRIBUTOR_NOT_ACTIVE` (as `POST /orders` rule 1; §7.3).
    - `serviceType: 'DIY'` gives 410 `REFILL_DIY_RETIRED`.
    - `requestedCount` is a whole number of at least 1, checked with the body (0, negative or a fraction: 400 `REFILL_INVALID_COUNT`; missing or not a number: 400 `VALIDATION_FAILED`), and at most `refill.maxCylinders` (400 `REFILL_TOO_MANY` `{max}`). There is no stock check at request time; from Inc 3 the pickup scans decide what goes.
    - The station exists (404 `NOT_FOUND` `{field: 'fillingStationId'}`) and is active (409 `REFILL_STATION_INACTIVE`).
    - `pickupStoreId` is the home store; the body value is ignored.
    - The rules run in the order listed, after the body schema. One transaction inserts the refill and its audit row `refill.create`.
  - **No balance check and no money.** `price_per_cylinder_paisa` and `total_cost_paisa` are written as 0.
- **`GET /filling-orders/mine`** (DISTRIBUTOR exact), **`/driver/mine`** (DRIVER exact), **`GET /filling-orders`** (office), **`GET /filling-orders/:id`** (`canSeeRefill`). Safe user selects throughout. Every refill DTO carries `stage` (`RefillStage`) and `counts` (§1.4).
- **`PATCH /filling-orders/:id/assign`** (office) `{ driverId }`, checked in this order: 404 `NOT_FOUND` for an unknown refill or driver (`details.field` 'driverId'); status PENDING, or 200 `X-Already-Applied` when it is already ASSIGNED to this driver, else 409 `REFILL_WRONG_STEP` `{currentStatus}`; the driver's user ACTIVE and availability AVAILABLE (409 `ASSIGN_DRIVER_NOT_AVAILABLE` `{driver}`); a van (409 `ASSIGN_DRIVER_NO_VEHICLE` `{driver}`), saved as the refill's assigned van. Audit `refill.assign`.
- **`PATCH /filling-orders/:id/picked-empties`**, **`/at-station`**, **`/filled`**, **`/returned`** (DRIVER exact, the assigned driver only, else 404)
  - Counts must satisfy `1 ≤ emptyCount ≤ requestedCount` and `0 ≤ filledCount ≤ pickedUpEmptyCount` (`REFILL_INVALID_COUNT`).
- **`PATCH /filling-orders/:id/complete`** (office): RETURNED to COMPLETED. **No ledger row.** A repeat returns 200 with `X-Already-Applied`; any other status gives 409 `REFILL_WRONG_STEP` `{currentStatus}`. Audit `refill.complete` (actor the office user).
- **`PATCH /filling-orders/:id/cancel`** (the owning DISTRIBUTOR, exact): `{ reason }`, only while PENDING or ASSIGNED (`REFILL_NOT_CANCELLABLE`). **The office has no cancel.** Audit `refill.cancel`.

### 7.12 Expenses (office exact, zod-validated, audited)
```ts
ExpenseTypeDto = { id; code: string | null; name; isSystem; archived: boolean; sortOrder; expenseCount }
ExpenseDto = { id; expenseDate: 'YYYY-MM-DD'; amountPaisa; type: { id; code; name }; vehicle: { id; plateNo } | null;
  driver: { id; name } | null; description; receiptFileId: string | null; receiptUrl: string | null /* signed 1 h */;
  recordedBy: { id; name }; createdAt; voidedAt: string | null; voidReason: string | null; voidedBy: { id; name } | null;
  allowedActions: ('EDIT'|'VOID')[] }
ExpenseSummary = { from; to; totalPaisa; count;
  byType: { typeId; code; name; totalPaisa; count }[];
  byMonth: { month: 'YYYY-MM'; totalPaisa; byType: { typeId; totalPaisa }[] }[];
  fuelLogs: { totalPaisa; count; byMonth: { month; totalPaisa; count }[] } }
```

**Types**
- `GET /expense-types?includeArchived=true`: `ExpenseTypeDto[]`, sorted by `sortOrder`, then name.
- `POST /expense-types` `{ name (2–40) }`: `nameKey` is unique across active and archived types, the archived `LEGACY_*` types included (`EXPENSE_TYPE_NAME_TAKEN` `{name}`, the existing type's name as stored). To use an archived type's name, restore it (its old expenses come back with it) or rename it first. `code` is null. Audit `expense_type.create`.
- `PATCH /expense-types/:id` `{ name }`: renaming is allowed for every type, with the same name uniqueness (`EXPENSE_TYPE_NAME_TAKEN`), and the `code` never changes. Audit `expense_type.rename`.
- `POST /expense-types/:id/archive`: a system type (`PETROL`, `OTHER`) gives `EXPENSE_TYPE_LOCKED` `{name}`. Audit.
- `POST /expense-types/:id/restore`: audited.

**Expenses**
- `GET /expenses?from&to&typeId&vehicleId&driverId&includeVoided&cursor&limit`: `Page<ExpenseDto>`.
  - Dates are inclusive `YYYY-MM-DD`; the default is the current calendar month in Asia/Karachi.
  - Sorted by `expenseDate` then `createdAt`, newest first.
- `GET /expenses/summary?from&to`: `ExpenseSummary`.
  - Computed in SQL, excluding voided rows.
  - Months come from `expense_date`. Fuel logs come from `fuel_refills.cost_paisa` (every row in the range, whatever `features.fuelRefills` says), grouped by the Asia/Karachi calendar date of `refill_at` (no 03:00 cut-off, like expense dates). **No HTTP route reads fuel logs from here.**
  - Old summary at expenses.service.ts:23-44: loads every row and groups only by category.
- `POST /expenses` (Idempotency-Key): `{ expenseDate, amountPaisa, typeId, vehicleId?, driverId?, description (1–200, UI label "Note"), receiptFileId? }`.
  - The amount is above 0, whole rupees and at most Rs 1,000,000.
  - The date is at most today's calendar date in Asia/Karachi (`localDate(now)` in shared-utils), with no 03:00 cut-off: at 01:00 on 22 Oct, 22 Oct is allowed and 23 Oct gives `EXPENSE_DATE_IN_FUTURE`. `PATCH /expenses/:id` applies the same rule.
  - The type is active (`EXPENSE_TYPE_ARCHIVED`).
  - The van and driver exist (`NOT_FOUND` with `details.field`).
  - `receiptFileId` is an `EXPENSE_RECEIPT` file uploaded by a super admin (`FILE_NOT_FOUND`).
  - Audit `expense.create`. Old body at expenses.controller.ts:33-41: `body: any`.
- `PATCH /expenses/:id`: the same fields, all optional. A voided expense gives `EXPENSE_ALREADY_VOIDED`. Changing to an archived type is refused; keeping the current one is fine. Audit `expense.update` with before and after. Old update at expenses.service.ts:70-82: spreads the raw body.
- `POST /expenses/:id/void` `{ reason (5–200) }`: sets `voided_*`. A repeat returns 200 `X-Already-Applied`. Audit `expense.void`.
- `DELETE /expenses/:id` is **removed**. Old delete at expenses.service.ts:84-86: a hard delete. The web, which ships with the API, uses void instead.
- The fuel-log detail tab uses the existing **`GET /reports/fuel-consumption?since`** (office; reports.service.ts:160-235 returns safe fields only).
- **Rule:** `ExpensesModule` never imports `WalletModule`. A test asserts that expense writes leave `distributors` and `ledger_entries` unchanged.

### 7.13 Settings, audit, admin summary, reports
- **`GET /settings`** (office): `[{ key, value, default, type, options?, min?, max?, editable, public, updatedAt, updatedBy }]`.
- **`PATCH /settings/:key`** (office): `{ value, reason (5–300) }`.
  - Errors: `SETTING_UNKNOWN`, `SETTING_INVALID_VALUE`, `SETTING_NOT_EDITABLE`.
  - Returns the updated row.
- **`GET /audit-logs?resourceType&resourceId&action&actorUserId&distributorId&from&to&cursor`** (office)
  - Returns `Page<{ id, at, actor: { kind, userId?, name?, label? }, action, resourceType, resourceId, distributorId, reason, diff }>`.
  - `resourceType` matches in any letter case: the writers differ (`Payment`, `order`, the migration's `Distributor`), and a record's page asks with one spelling. `action` matches one action exactly.
  - Today it is capped at 200 (audit-log.service.ts:20-26).
- **`GET /admin/summary`** (office): the Today page and the navigation badges.
  ```
  { topups: { toCheck, oldestWaitingAt, approvedToday: { count, totalPaisa } },
    orders: { needsDriver, oldestNeedsDriverAt, inProgress, placedToday, deliveredToday, costTakenTodayPaisa },
    prices: { missing: [{ distributorId, distributorName, zones }] },
    distributors: { waitingToStart: [{ id, name }] },
    drivers: { onDuty, total } }
  ```
  `costTakenTodayPaisa` is Σ`DEBIT_ORDER` − Σ`CREDIT_ORDER_REVERSAL` for today's business day. `topups.toCheck` = PENDING requests, `oldestWaitingAt` the oldest one's `createdAt`, `approvedToday` as in `GET /admin/topups` (§7.9). `orders.needsDriver` = PENDING or CONFIRMED (`oldestNeedsDriverAt` the oldest `createdAt`); `inProgress` = ASSIGNED or IN_TRANSIT (the board's tabs, §7.6); `placedToday` = orders created in the business day, whatever their status now (later cancels included); `deliveredToday` = DELIVERED with `deliveredAt` in the business day. `prices.missing` = one row per ACTIVE distributor with at least one active zone without its price, sorted by name; `zones` is how many such zones (a count). Distributors waiting to start or suspended are left out (one waiting to start is in `distributors.waitingToStart`). From Inc 2 the body adds `problems: { open, oldestOpenAt }`: the open CUSTOMER_PROBLEM cases and the oldest one's `createdAt` (0 and null when none is open). It feeds the Problems badge, the Today badge and the Customer problems card.
- **Reports** (`/reports/*`, office): kept, but hidden on the website: the legacy page is in no menu and opens only at its address, `/reports` (UX_ADMIN §1.2).
  - `ordersByZone` revenue comes from ledger rows (Σ`DEBIT_ORDER` − Σ`CREDIT_ORDER_REVERSAL`) of the zone's orders created since `since`. Today reports.service.ts:8-18 sums `delivery_fee_paisa` across all orders.
  - `driverPerformance` uses `deliveredAt` (reports.service.ts:251); `driverUtilization` counts distinct trips.
  - `since` and `until` take an ISO instant or a `YYYY-MM-DD` date; anything else is 400 `VALIDATION_FAILED`. The reports read only safe user fields.

### 7.14 Socket `/drivers` (drivers.gateway.ts)
- **On connect:** verify the JWT from `handshake.auth.token`, which installed clients already send (useLiveLocation.ts:35-38, useDriversSocket.ts:24-27). Apply the same status, `tv` and locked-role checks. On failure, emit `error {code}` and disconnect: `AUTH_TOKEN_INVALID` (no, bad or expired token), `AUTH_SESSION_REVOKED` (the §3.3 check) or `PERMISSION_DENIED` (any role but DRIVER and SUPER_ADMIN).
- **Rooms:** a DRIVER joins `driver:<id>`. The office joins `office` and receives `drivers:snapshot`. Any other role is disconnected.
- **`location:update` and `online:set`:** DRIVER only. The `driverId` comes from the token; the payload value is ignored. At most one update per 5 seconds: a `location:update` inside the window is dropped with the ack `{ ok: false, code: 'RATE_LIMITED' }`; an early `online:set` is kept and applied when the window ends, so the last state is never lost, unless the driver's session ended meanwhile (an archive, a suspension): then it is dropped. A driver whose user isn't ACTIVE, or who is on leave or off duty, can't go online: the ack is `{ ok: false, code: 'ASSIGN_DRIVER_NOT_AVAILABLE' }` and nothing changes.
- **Refusals and revoked sessions:** a refused socket gets `connect`, then `error {code}`, then a server disconnect. Browser origins outside `CORS_ORIGINS` are refused; native apps send no `Origin`.
  - A driver's socket is checked again, session and token expiry, on every message it sends, and is dropped when the check fails.
  - An office socket hears every driver, so it is also dropped:
    - when its access token expires;
    - at once when a change made through this API ends its user's session (a suspension, a role change, a password reset, a distributor suspend or a driver archive);
    - otherwise by a check every 30 seconds, so a change made elsewhere ends it within 60 seconds (§3.3).
  - A change through the API re-checks the user's sockets rather than closing them, so a socket opened with the new tokens of one's own password change stays.
  - Before the disconnect the socket gets `error {code}`: `AUTH_TOKEN_INVALID` (expired) or `AUTH_SESSION_REVOKED`. The website then refreshes its session and reconnects with the new token.
- **Broadcasts** go to `office` only. Today `server.emit` sends to everyone (drivers.gateway.ts:51, :58).
- **The office website:** when its socket gets `error {code}` with `AUTH_TOKEN_INVALID` or `AUTH_SESSION_REVOKED` (refused at the handshake or dropped later), it refreshes the session at once (the same single refresh as after a 401) and reconnects with the new token. A refused refresh signs the office user out; an unreachable one is retried after 2, 5, 15 and 30 s; at most 3 fresh tokens are tried in a row while the socket carries no data. `PERMISSION_DENIED` is final (useDriversSocket.ts, driversSocketSession.ts).

---

## 8. Increment 1 state machines, jobs and tests [Inc 1]

### 8.1 Order (Inc 1)
| From | To | Trigger | Who | Money |
|---|---|---|---|---|
| none | PENDING | `POST /orders` | owning distributor | **deduct cost** (DEBIT_ORDER), unless it is 0 |
| PENDING, CONFIRMED | ASSIGNED | assign-driver | office | none |
| ASSIGNED | ASSIGNED | reassign (nothing loaded) | office | none |
| ASSIGNED | PENDING | the office aborts the trip before anything happened on it (§7.7); `trip_id` and `assigned_at` are cleared | office | none |
| ASSIGNED | IN_TRANSIT | the trip's STORE_PICKUP stop departs, or the driver's `PATCH status` IN_TRANSIT (own trip); a trip start alone never moves an order | driver | none |
| ASSIGNED, IN_TRANSIT | DELIVERED | `PATCH status` (own trip) | trip driver | none |
| ASSIGNED, IN_TRANSIT | DELIVERED | manual-delivery + reason | office | none |
| PENDING, CONFIRMED, ASSIGNED, IN_TRANSIT (no hand-over) | CANCELLED | cancel | owning distributor, office | **cost returned only if delivery not started** (CREDIT_ORDER_REVERSAL) |
| ASSIGNED, IN_TRANSIT (started, no hand-over) | FAILED | fail + reason | trip driver, office | none |

- DELIVERED, CANCELLED and FAILED are terminal.
- `fee_status` goes NONE or DEDUCTED at creation, then DEDUCTED → REVERSED (once, on a cancel before the start). There are no other fee changes.
- Orders that existed before the switch-over keep `NONE` (or `DEDUCTED` with `fee_strategy LEGACY_ZONE_PAIR` if the old code charged them) and never move money: a cancel refunds them nothing (§5.5).

### 8.2 Top-up (Payment.status)
| From | To | Trigger | Who |
|---|---|---|---|
| none | PENDING | `topup-requests`, or legacy `topup` | distributor |
| PENDING | SUCCESS | approve (reference unused, rules in §7.9) | office; credits once |
| PENDING | REJECTED | reject + reasonCode | office |

A distributor's "Try again" creates a new request, prefilled. `REFUNDED` is unused.

### 8.3 Trip and stop (Inc 1)
- **Trip:**
  - PLANNED → IN_PROGRESS: the driver starts it, or the first arrive, or the first load scan. This sets only the trip's status and `startedAt`; its orders become IN_TRANSIT when the store stop departs (§8.1).
  - IN_PROGRESS → COMPLETED: the driver, once all orders are terminal.
  - PLANNED or IN_PROGRESS → ABORTED: the office with a reason, only before anything happened on the trip, which sends its orders back to Needs a driver (§7.7); or the system when the trip's last open order is cancelled or reassigned (no `trip.abort` row: the `order.cancel` or `order.reassign` row covers it).
- **Stop:**
  - PENDING → ARRIVED (arrive) → DONE (depart).
  - Any open stop → CANCELLED (its order is cancelled or reassigned) or FAILED (its order failed).

### 8.4 Refill (Inc 1, no money)
- PENDING → ASSIGNED (office).
- ASSIGNED → EMPTIES_PICKED → AT_STATION → FILLED → RETURNED (the assigned driver).
- RETURNED → COMPLETED (office; no money).
- PENDING or ASSIGNED → CANCELLED (owning distributor only).

### 8.5 Jobs and switch-over
| Job | Schedule | What |
|---|---|---|
| wallet-nightly-check | `@Cron('30 3 * * *', { timeZone: 'Asia/Karachi' })` | For each distributor, the ledger sum must equal the balance and the balance must be at least 0. Any break raises `WALLET_CHECK_MISMATCH` (CRITICAL, resource the distributor, context `{balancePaisa, ledgerSumPaisa, differencePaisa}` with differencePaisa = balance − ledger sum, signed). At most one unresolved (OPEN or ACKNOWLEDGED) alert per distributor: while one exists the job raises nothing new and leaves it as it is. It never fixes data and never resolves an alert; the super admin resolves it on the Alerts screen once engineering has repaired the data, and a mismatch still there the next night raises a new one. Every run, clean or not, then writes one audit row `wallet.check` (actor SYSTEM `job:wallet-check`, resourceType `job`, `{checked, mismatches, distributorIds}`), so a clean run is visible in Activity. |
| housekeeping (exists) | `@Cron(HOUSEKEEPING_CRON ?? '0 3 * * *', { timeZone: 'Asia/Karachi' })`: 03:00 Karachi; the env may change the expression, never the zone | unchanged: purges expired OTP codes and old refresh tokens |
| dispatch processor (exists) | on queue | no-op while `dispatch.autoAssign.enabled = false` |

Every `@Cron` passes `{ timeZone: 'Asia/Karachi' }` literally, even where it changes nothing. Job times are fixed in code and don't follow `day.timezone` or `day.cutoffLocalTime`.

**Switch-over checklist** (staging first, then prod):
1. The owner confirms what is live (AWS or Railway) and whether it holds real data. Run the restore drill of DATA_MODEL §2.6 on the test server and record its times. Take a snapshot. On AWS, bring the host up to date before any deploy:
   - copy `infrastructure/aws/docker-compose.aws.yml` and `Caddyfile` to `/srv/smartfleet/`. The host's copies are hand-edited: deploy.sh refuses a compose file that doesn't take the service's image from `IMAGE_PROD` / `IMAGE_STAGING`, and Caddy must serve `api.smartfleetpk.com` and `staging.smartfleetpk.com`;
   - write `/srv/smartfleet/deploy.env` with `RDS_INSTANCE_ID=<the prod RDS instance>` (and `AWS_REGION` when it isn't ap-southeast-1);
   - give the instance role `rds:CreateDBSnapshot` and `rds:DescribeDBSnapshots` on that instance;
   - in GitHub, set the variable `STAGING_WEBSITE_ORIGIN` (the staging website's origin) for the smoke suite.

   From now on deploys go by commit: deploy-staging deploys the full SHA it resolves, and promote-prod takes only a full 40-character SHA that passed CI and was deployed to staging (DATA_MODEL §2.5).
2. Deploy the baseline release (DATA_MODEL §2.3).
3. Finish or cancel every open order, refill and transfer, while the old API still allows it (once inc1a runs with `features.transfers` off, transfer writes get 403 `FEATURE_DISABLED`); a transfer can also be closed by SQL. Open orders left in place would deliver with no cost (`fee_status NONE`). Then run these checks; before step 4 each must return no rows:
   - `SELECT id FROM transfers WHERE status IN ('REQUESTED','IN_TRANSIT') AND driver_id IS NOT NULL;`
   - `SELECT u.id, u.phone, u.role FROM users u WHERE (u.role = 'DISTRIBUTOR' AND NOT EXISTS (SELECT 1 FROM distributors d WHERE d.user_id = u.id)) OR (u.role = 'DRIVER' AND NOT EXISTS (SELECT 1 FROM drivers r WHERE r.user_id = u.id));`

   A row the second query finds is a legacy sign-in whose role has no profile row. It gets no tokens after the switch-over (§7.1), so sort each one out by hand first: suspend it, with a reason.
4. Before deploying, update `/srv/smartfleet/.env.staging` and `.env.prod` (on Railway, the service variables) from the new templates (infrastructure/aws/.env.*.example):
   - `APP_ENV`;
   - `BULLMQ_PREFIX` (`sf-staging`, `sf-prod`);
   - `CORS_ORIGINS`, which replaces the unused `ALLOWED_ORIGINS`: the website origin copied from the address bar, `https://admin.smartfleetpk.com` on prod;
   - 64-hex `ENCRYPTION_KEY` and `BLIND_INDEX_KEY` (`openssl rand -hex 32`, different per environment).

   No `REPLACE_` value may remain. deploy.sh checks the file against the boot guards before it migrates and stops on the `BOOT_REFUSED` line, with the database untouched.

   Then deploy inc1a with the Inc 1 API and website together; on prod, deploy.sh takes an RDS snapshot and waits for it before migrating.

   Check that `GET /api/v1/health` reports the deployed SHA as `version`, and that a CORS preflight from the website origin is allowed: `curl -si -X OPTIONS https://<api host>/api/v1/auth/login -H 'Origin: <website origin>' -H 'Access-Control-Request-Method: POST'` must answer with `Access-Control-Allow-Origin: <website origin>`. The staging smoke suite checks both.

   Publish the mobile JS over the air. A rollback from here is a forward fix or a restore of that snapshot, never just the previous image (DATA_MODEL §2.6).
5. Set `topup.account` and `support.phone` with the settings CLI.
6. Ops checks each `OPENING_BALANCE` row against the bank.
7. Create missing stores. Set the delivery price for each distributor in each pilot zone. Activate the distributors.
8. Create the two named super admins with the CLI `npm run users:create-office`. The seeded ADMIN stays refused by `auth.lockedRoles`. Signed in as one of them, suspend the seeded SUPER_ADMIN "LPG Super Admin" (+923000000000) with `PATCH /users/:id/status`; on live also suspend "Test Distributor" (+923001111111, `PATCH /distributors/:id/suspend`) and archive "Test Driver" (+923002222222, `DELETE /drivers/:id`), each with a reason. On the test server those two may stay as test logins.
9. In the next release: inc1b.

### 8.6 Contract tests that gate Inc 1 (CI PostGIS and Redis services)
**Top-ups**
- Approving the same top-up twice, including in parallel, credits once.
- A reused bank reference gives 409.
- The webhook gives 410 and leaves the payment unchanged.
- A bank amount different from the request: `CREDIT_BANK_AMOUNT` credits the bank amount, and `REJECT` gives 409.

**Orders and the wallet**
- Two parallel orders can't spend more than the balance, and the balance never goes negative.
- Placing an order deducts exactly once. A retry with the same Idempotency-Key returns the first order, with one ledger row.
- A missing price gives 422 at add-address, quote and order. Sizes with no amount make the cost equal to the base.
- Cancels:
  - a cancel before the start reverses once (a double cancel still writes one reversal row);
  - a cancel after the first load scan reverses nothing;
  - a cancel racing a load scan gives either a refund and no load, or a load and no refund, never both;
  - `confirmRefundPaisa` mismatch gives 409.
- FAILED before the start gives 409. DELIVERED, FAILED, refill complete and expense writes never create ledger rows.
- Delivered is recorded once. A driver not on the order's trip gets 404 `NOT_FOUND`; a distributor calling a driver route gets 403 `PERMISSION_DENIED`. Reassigning closes the old trip and stop. Assignment uses the home store.

**Access**
- CLIENT and ADMIN logins are refused, and the OTP endpoints give 403. A suspended user's token is refused within 60 seconds.
- A socket without a token is disconnected, and an open office socket is dropped when its token expires or its session ends. A driver can't move another driver's location. A DISTRIBUTOR can't call `/custody/scan`.
- No response anywhere contains `passwordHash`, `cnic`, `cnicEncrypted`, `cnicIndex`, `codeHash` or `tokenHash`. A test crawls the GET routes with seeded data.

**Shared rules**
- Every `ErrorCode` has an HTTP status, English text, and an `errors.<CODE>` key in both apps.
- The nightly check is clean after all of the above.

---

## 9. Increment 2: driver flow, store receive, cases, confirmation [Inc 2]

### 9.1 What changes
- The migration (DATA_MODEL §4) and the settings marked Inc 2 in §6.
- `GET /app/config` reports `features.scanFlow = true`.
- Raise `app.minVersion.*` once the 0.2.0 APK is on every phone.
- Set `support.phone` before switching `confirmation.enabled` on: the link's not-found page shows it.

### 9.2 Holder rules (ScanService). Every move is one scan; every cylinder has one holder.
**Common steps, in order:**
0. Body: 400 `VALIDATION_FAILED`; a TAKE_BACK without `returnState` gives 400 `SCAN_RETURN_STATE_REQUIRED`. `toCustodyType` and `toCustodyId` are refused (field code NOT_ALLOWED); other unknown fields are dropped.
1. Context and ownership (404): the trip is the caller's and `stopId` is one of its stops (driver); DISTRIBUTOR exact (store); the refill's assigned driver (refill).
2. A resend with the same `scanId` by the same actor returns the recorded scan: 200, result ALREADY_RECORDED, `Idempotent-Replay: true`, even if a rule below would now refuse it. The same `scanId` with another cylinder or action gives 409 `SCAN_ID_REUSED`.
3. Driver scans: a LOAD first locks the trip's orders `FOR UPDATE` (the rows a cancel or a reassign locks; locks are always taken orders first, then the trip, then the cylinder). The trip must be PLANNED or IN_PROGRESS (409 `SCAN_TRIP_CLOSED`), the stop PENDING or ARRIVED (409 `SCAN_STOP_CLOSED` `{currentStatus}`), and the action must fit the stop: LOAD only at the STORE_PICKUP stop, HANDOVER and TAKE_BACK only at a DELIVERY stop (403 `SCAN_EVENT_NOT_ALLOWED`). Refill scans: the phase must fit the refill's status (409 `REFILL_WRONG_STEP` `{currentStatus}`, §10.1).
4. `entryMethod = TYPED` while `custody.typedEntry.enabled` is false: 403 `FEATURE_DISABLED`, before any lookup.
5. Resolve the code. QR is an exact `qr_code` match, whoever owns it. TYPED is a cylinder number in a §1.1 form (`42`, `0042`, `C0042` or `AG-C0042`, any letter case; `parseCylinderNo`), looked up within the run's distributor (driver, refill) or the caller's (store). A code part naming another distributor, the order-style `AG-0042`, or no match gives 404 `SCAN_CYLINDER_UNKNOWN`.
6. Lock the cylinder `FOR UPDATE`.
7. Owner: the cylinder belongs to the run's distributor (store: the caller), else 409 `SCAN_WRONG_OWNER`.
8. The same move again under a new `scanId` returns 200, result ALREADY_RECORDED, `X-Already-Applied: true`, and writes nothing: LOAD when the cylinder's last move is a LOAD on this trip and it is still on the trip's van; HANDOVER when it has a GIVEN row on this stop; TAKE_BACK when it has a TAKEN_BACK row on this stop (the first `returnState` stays); STORE_RECEIVE when it is already in the caller's store; refill PICKUP when it has an open line on this refill; refill FILL when its line already has `filled_at`.
9. FAULTY or LOST: 409 `SCAN_CYLINDER_BLOCKED` for LOAD, HANDOVER and refill PICKUP. TAKE_BACK and STORE_RECEIVE go ahead and never change a FAULTY or LOST state.
10. The action's own rules, in the order its row below lists them.
11. Write the event: actor, trip, stop, order, source, states and lat/lng. Update the cylinder and `last_event_id`. A typed entry writes `source = TYPED` plus audit `custody.typed_entry`; refusals and repeats write neither.

**The responsible driver** is the driver of the trip or refill of the latest event that moved the cylinder **onto** a van (LOAD, TAKE_BACK, refill PICKUP, or an office manual take-back onto the trip's van) since the cylinder last entered a store. While the cylinder is in a store there is none: the store's scan IN ends it. There is also none when no such event exists (registered and never loaded, or handed straight from the store by an office manual delivery).

| Action (event code) | Who | From → To | Rules and errors |
|---|---|---|---|
| LOAD (SCAN_OUT) | the trip's driver, at its STORE_PICKUP stop | STORE (the home store) → VEHICLE (`trip.vehicleId`) | In the home store (`SCAN_NOT_AT_STORE` `{store}`). FULL (`SCAN_NOT_FULL`). The size is still needed: loaded below needed for its size, with loaded and needed as in §9.3 (`SCAN_LOAD_NOT_NEEDED`). Auto-starts the trip; its orders don't change (§8.1). **The first LOAD stamps `load_started_at` on every open order of the trip** under the step 3 row locks; cancelled orders aren't counted, and `load_started_at` is never cleared. |
| HANDOVER (DELIVERED) | the trip's driver, at the order's DELIVERY stop (the first scan sets `arrivedAt`) | VEHICLE → CLIENT (`order.clientId`) | If its last move onto `trip.vehicleId` was a TAKE_BACK (scanned or office): `SCAN_TAKEN_BACK_NOT_UNLOADED` (it must go to the store first). Otherwise it must be on `trip.vehicleId` with a LOAD on this trip as its last move onto the van (`SCAN_NOT_ON_YOUR_VAN`: no IN, no OUT; this also refuses a cylinder left from an earlier run or picked up for a refill). FULL (`SCAN_NOT_FULL`). Size in the order (`SCAN_SIZE_NOT_IN_ORDER`). Given below fullCount (`SCAN_COUNT_REACHED`). The state **stays FULL**; today custody.service.ts:35 sets EMPTY. Writes a `stop_cylinders` GIVEN row. |
| TAKE_BACK (PICKED_UP_EMPTY) | the trip's driver, at a DELIVERY stop | CLIENT → VEHICLE (`trip.vehicleId`) | With this customer, `order.clientId` (`SCAN_NOT_WITH_THIS_CUSTOMER`). Not given on this visit (`SCAN_GIVEN_THIS_VISIT`). The state becomes `returnState`; FAULTY and LOST stay as they are. Writes a TAKEN_BACK row with the tapped `returnState`. (`returnState` itself is checked with the body, step 0.) |
| STORE_RECEIVE (SCAN_IN) | DISTRIBUTOR (shop app) | VEHICLE (any van) → STORE (the caller's home store) | On a van (`SCAN_NOT_ON_A_VAN`). The state is unchanged, FAULTY and LOST included. Returns always go into the owner's one store, the caller's; no body field can name a store (ADR-13). In Inc 3, a cylinder on an open refill line completes that line (§10.1). |
| OFFICE_MANUAL_DELIVERY (DELIVERED, MANUAL) | office | VEHICLE (the trip's van) or STORE (home store) → CLIENT | A reason is required. The sizes and counts must equal the order lines exactly. Optional taken-back cylinders go CLIENT → the trip's van (PICKED_UP_EMPTY, MANUAL). Full rules in §9.5. |
| REGISTER (REGISTERED) | office (bulk-register) | none → STORE (home store) | Allocates `short_no`. Starts FULL or EMPTY (`state`, default FULL). The body can't choose the holder (§7.2). |

No pilot route marks a cylinder FAULTY or LOST before the Inc 3 day-end fixes; tests set these states in fixtures. Only an approved day-end fix changes them.

### 9.3 Driver endpoints (DRIVER exact, own trip; another driver's trip gives 404, any other role 403, §3.2)
```ts
StopProgress = { type: 'STORE_PICKUP'; lines: { cylinderTypeId; sizeLabel; needed; done }[]; doneCount; neededCount; complete: boolean }
             | { type: 'DELIVERY'; give: { lines: { cylinderTypeId; sizeLabel; needed; done }[]; doneCount; neededCount; complete };
                 takeBack: { expected; count; byState: { EMPTY; PART_FILLED; FULL }; items: { code; shortNo; sizeLabel; state }[];
                             unlabelled: { cylinderTypeId; sizeLabel; state; count }[] }; canFinish: boolean; blockers: { code; details }[] }
ScanResult = { result: 'RECORDED' | 'ALREADY_RECORDED'; scan: { scanId; action; at };
  cylinder: { id; code; shortNo; shortCode; size: { id; label }; state; holder: { type; label } }; stop: { id; type; progress: StopProgress } }
```
For STORE_PICKUP, per size: `needed` is the Σ `fullCount` of the trip's orders that aren't CANCELLED or FAILED, and `done` (loaded) counts the cylinders whose latest LOAD is on this trip and that haven't gone back into a store since (on the van, or handed over on this trip). LOAD events are not counted, so a cylinder the store has taken back off no longer counts. `neededCount` = Σ `needed`, `doneCount` = Σ min(`done`, `needed`), and `complete` is `done ≥ needed` for every size. For DELIVERY, `takeBack.expected` is the order's Σ `expectedReturnCount`, `takeBack.count` = `items.length` + Σ `unlabelled.count`, `byState` counts both, and `items[].state` is the tapped `returnState`. Unlabelled returns have no holder: they never appear on the van, in `GET /store/incoming`, in `TRIP_VAN_NOT_EMPTY` or on the day-end sheet.

Scan errors carry `details.progress`, so the screen still shows "3 of 5" after a refusal. The checks run in the order of §9.2 (steps 0 to 11).

- **`GET /driver/home`** returns, in one request:
  ```
  { businessDate, onDuty, vehicle: { id, plateNo } | null, van: { full, empty, partFilled },
    activeTrip: TripSummary | null, nextTrips: TripSummary[], doneToday: number }
  ```
- **`GET /trips/:tripId`** returns the existing shape plus `stops[]: { id, seq, type, status, title, address, location, progress }`, `van` and `allowedActions`.
- **`GET /trips/:tripId/stops/:stopId`** returns `{ stop, order: OrderDto | null, progress }`.
- **`POST /trips/:tripId/scans`**: `{ scanId, stopId, action: 'LOAD' | 'HANDOVER' | 'TAKE_BACK', code, entryMethod: 'QR' | 'TYPED', returnState?, lat?, lng? }`. `toCustodyType` and `toCustodyId` are refused (400); other unknown fields are dropped. Returns 201 with result RECORDED for a new move. A resend with the same `scanId` returns 200 with result ALREADY_RECORDED and `Idempotent-Replay: true`; the same move again with a new `scanId` (§9.2 step 8) returns 200 with result ALREADY_RECORDED and `X-Already-Applied: true`. Neither writes anything; `scan` is the recorded scan `{ scanId, action, at }`, and `cylinder` and `progress` are as they are now.
- **`PUT /trips/:tripId/stops/:stopId/unlabelled-returns`**: `{ items: [{ cylinderTypeId, state: 'EMPTY' | 'PART_FILLED' | 'FULL', count }] }`, at most 20 items, `count` 0–30, one item per size and state (400 `VALIDATION_FAILED`, DUPLICATE_ITEM). It replaces the stop's whole list, so it is idempotent: a count of 0, or a size and state left out, means none, and no row is kept. Only at an open DELIVERY stop of the caller's open trip (403 `SCAN_EVENT_NOT_ALLOWED` at the STORE_PICKUP stop; 409 `SCAN_STOP_CLOSED` once the stop is finished; 409 `SCAN_TRIP_CLOSED`). An unknown size gives 404 `NOT_FOUND` `{field}`. The first PUT at a PENDING stop sets `arrivedAt`, like a first scan. Returns 200 `{ progress }`. Unlabelled returns count as taken back but never get a holder (ADR-13).
- **`POST /trips/:tripId/stops/:stopId/finish`**
  - **STORE_PICKUP** ("Done loading"): what is loaded per size (`done`) must be at least what the trip's orders need (`needed`, as above), else 409 `LOAD_INCOMPLETE` `{total: neededCount, done: doneCount, lines}`. Spares left by an order cancelled after loading don't block it. Sets `departedAt`, and the trip's ASSIGNED orders become IN_TRANSIT with `onTheWayAt`.
  - **DELIVERY** ("Finish visit"): body `{ takeBackShort?: { reasonCode: TakeBackShortReason, note? } }`.
    - What is given per size must equal fullCount (409 `DELIVERY_SCANS_INCOMPLETE` `{missing: [{sizeLabel, needed, given}]}`).
    - Taken back (`takeBack.count`: labelled plus unlabelled) below expected, without `takeBackShort`, gives 409 `TAKE_BACK_SHORT` `{expected, taken}`.
    - Effects, in one transaction:
      - the order becomes DELIVERED (`delivery_method = 'SCANNED'`);
      - the stop becomes DONE;
      - if `confirmation.enabled`, the confirmation and message rows are created.

      **No money.**
  - Response: `{ order: OrderDto | null, nextStopId }` (`order` is null for the STORE_PICKUP stop). **The driver never receives the confirmation link.**
  - A repeat on a stop already DONE returns 200 with `X-Already-Applied` and the same body, whatever the new body. A CANCELLED or FAILED stop gives 409 `SCAN_STOP_CLOSED` `{currentStatus}`.
- **`POST /orders/:id/fail`**: as §7.6. The loaded cylinders stay on the van until the store receives them.
- **`POST /trips/:tripId/finish`** ("Finish trip"): `{ leftoverReason? }`.
  - Every stop must be DONE, FAILED or CANCELLED (409 `TRIP_STOPS_OPEN`).
  - The van must be empty: 409 `TRIP_VAN_NOT_EMPTY` `{count, cylinders: [{shortCode, sizeLabel, state, came: 'TAKEN_BACK' | 'NOT_DELIVERED' | 'SPARE'}], leftoversAllowed}`. SPARE is a cylinder loaded for an order cancelled after loading, or one left on the van from an earlier run. Cylinders on an open refill line don't count (Inc 3, §10.1).
  - `leftoverReason` is 5–300 characters after trimming (else 400 `VALIDATION_FAILED`). With `trip.allowFinishWithLeftovers` off, a van that isn't empty is refused whatever the body (`leftoversAllowed: false`). With it on, a finish without `leftoverReason` is refused with `leftoversAllowed: true`, so the app asks for one; with it, the trip becomes COMPLETED with `leftover_reason`, the cylinders stay on the van until the store receives them, and a `VAN_NOT_EMPTY` alert is raised or updated (one per van, §9.9). A reason sent with an empty van is ignored.
  - The legacy `PATCH /trips/:id/status COMPLETED` maps here, with its `reason` used as `leftoverReason`.
  - A repeat on a COMPLETED trip returns 200 with `X-Already-Applied`; an ABORTED trip gives 409 `TRIP_INVALID_TRANSITION` `{currentStatus: 'ABORTED'}`.

### 9.4 Store endpoints (DISTRIBUTOR exact; shop app)
- **`POST /store/scans`**: `{ scanId, code, entryMethod }`. The action is RECEIVE. `toCustodyType` and `toCustodyId` are refused (400); other unknown fields are dropped, so the body can never choose a store.
  - Returns a `ScanResult` plus `fromVan: { plateNo, driver: { id, name } }` and `receivedToday: { count, bySize }`.
- **`GET /store/incoming`** returns:
  ```
  { vans: [{ vehicle: { id, plateNo }, driver: { id, name, phone }, trip: { id, status } | null,
             cylinders: [{ shortCode, sizeLabel, state, came /* TAKEN_BACK | NOT_DELIVERED | SPARE | REFILL (Inc 3) */,
                           from: { clientName, orderShortCode } | null, refill: { shortCode } | null }],
             counts: { total, received, bySize } }] }
  ```
  It covers the caller's cylinders on any van.
- **`GET /store/stock`**: what is in the store, by size and state, counted from cylinders (not `inventory_lots`).
- **`GET /cylinders/:code/history`** (DISTRIBUTOR or office; a DRIVER gets 403 `PERMISSION_DENIED`; another distributor's cylinder gives 404 `NOT_FOUND` through `canSeeCylinder`) returns:
  ```
  { cylinder, holder: { type, label, since, responsible: { userId, name, role: 'DRIVER' } | null /* the §9.2 rule */ },
    events: [{ at, action /* the CylinderEventType */, from, to /* holder labels */, actor: { name, role }, order: { shortCode } | null,
               refill: { shortCode } | null, source, returnState, reason }] }
  ```
  `:code` is a QR value or a cylinder number. The owning distributor may type `42`, `0042`, `C0042` or `AG-C0042`; the office needs the QR value or the full `AG-C0042` (§1.1). No match: 404 `NOT_FOUND`.
- **`PATCH /clients/:id`** (own; another distributor's customer, or an unknown id, gives 404 `CLIENT_NOT_FOUND`): `{ name?, phone?, notes? }`. The addresses can't be changed here (add-only, §7.4). The phone is normalised and unique (checked under the same distributor-row lock as `POST /clients`). If the phone changed while a confirmation is pending, the response includes `confirmationNeedsNewLink: true`.
- **`GET /alerts/mine`**: the caller's open `CUSTOMER_PROBLEM` cases as `{ items: CaseDto[], nextCursor }` (§9.6).

### 9.5 Office endpoints
- **`POST /orders/:id/manual-delivery` (v2)**: `{ reason (10–300), cylinders: [{ code }] (1–100), takenBack?: [{ code, returnState: 'EMPTY' | 'PART_FILLED' | 'FULL' }] (0–100) }`. A `code` is a QR value or a cylinder number of the order's distributor in a §1.1 form.
  - Checks, in order: the body (400); the status as in §7.6 (ASSIGNED or IN_TRANSIT; a repeat of this office delivery returns 200 `X-Already-Applied`); every code resolves (404 `SCAN_CYLINDER_UNKNOWN` `{code}`); lock the cylinders in id order; then everything must fit, else 409 `MANUAL_DELIVERY_CYLINDERS_MISMATCH` `{problems: [{code, reason, holderType?}], sizes: [{cylinderTypeId, sizeLabel, needed, named}]}` and nothing moves.
  - Delivered cylinders: owned by the order's distributor (WRONG_OWNER), FULL (NOT_FULL), not FAULTY or LOST (BLOCKED), of a size in the order (WRONG_SIZE), and either in the home store or on the order's trip van with a LOAD on that trip as its last move onto the van (NOT_AVAILABLE, with `holderType` VEHICLE or CLIENT). The counts per size must equal the order lines (`sizes`).
  - Taken-back cylinders: owned by the order's distributor (WRONG_OWNER) and with `order.clientId` (NOT_WITH_THIS_CUSTOMER). A code may appear only once across both lists (LISTED_TWICE).
  - Effects, in one transaction: each delivered cylinder moves to the customer (DELIVERED, source MANUAL, the reason; a GIVEN stop row). Each taken-back cylinder moves CLIENT → the order's trip van (PICKED_UP_EMPTY, source MANUAL, `trip_id` set, state = `returnState` with FAULTY and LOST kept; a TAKEN_BACK stop row), and the store receives it with the normal scan. The order's DELIVERY stop becomes DONE and the order DELIVERED (`MANUAL`). **No money.**
  - Audit: one `order.manual_delivery*` row (the reason and both code lists), plus one `custody.manual_event*` row per cylinder moved (resourceType `cylinder`, `{eventId, from, to, orderId}`).
  - If `confirmation.enabled`, the same transaction issues the customer confirmation and its SMS row, as the DELIVERY finish does (snapshot: the named cylinders as delivered, `takenBack` as taken back); the SMS is sent after commit (CUSTOMER_PAGE §1).
- **`POST /orders/:id/assign-driver` (v2)**: the order is appended to the driver's PLANNED trip from the same store **only if that trip has no load scan**. Otherwise a new trip is created. Each run carries one distributor's orders. The response adds `appendedToExistingTrip`.
- **`PATCH /drivers/:id/vehicle`**: 409 `VEHICLE_HAS_CYLINDERS` `{count}` while the van holds any cylinder, refill cylinders included.
- **`POST /cylinders/bulk-register`**: the §7.2 body and rules. It also writes one REGISTERED event per cylinder (source REGISTRATION, actor the office user, into the home store), allocates `shortNo` from `next_cylinder_no` in the same transaction, and returns 201 `[{ id, code, shortNo, shortCode, sizeLabel }]` for printing labels (`shortCode` like `AG-C0036`).

### 9.6 Cases (customer problems)
- **One alert type:** `CUSTOMER_PROBLEM`, with `context { orderId, orderShortCode, distributorId, answer, comment }` and `alerts.distributor_id`. Titles and bodies are rendered in apps from i18n keys; the stored English is only a fallback.
- `CaseDto = { id; status: 'OPEN' | 'RESOLVED'; order: { id; shortCode }; answer: ConfirmationResponse; comment: string | null; customerName; distributor: { id; businessName }; openedAt; resolvedAt: string | null; resolvedBy: { id; name } | null; resolutionNote: string | null; allowedActions: ('RESOLVE')[] }`.
- **`GET /alerts?type=CUSTOMER_PROBLEM&status=OPEN|RESOLVED&cursor`** (office): `{ items: CaseDto[], nextCursor }`. `status` defaults to OPEN; OPEN lists oldest first, RESOLVED newest resolved first. Any other `type`, or none, keeps the legacy array, which leaves CUSTOMER_PROBLEM alerts out.
- **`GET /alerts/mine`** (DISTRIBUTOR exact, the one non-office `/alerts` route): `{ items: CaseDto[], nextCursor }`, the caller's OPEN cases, oldest first, with `allowedActions: []`.
- **`POST /alerts/:id/resolve`** (office): `{ note }`, trimmed, 5–300 characters (else 400 `VALIDATION_FAILED`, field `note`). An id that isn't a CUSTOMER_PROBLEM alert: 404 `NOT_FOUND`.
  - One transaction: lock the alert; guarded update from OPEN to RESOLVED setting `resolved_at`, `resolved_by_user_id` and `resolution_note`; audit `case.resolve` (resourceType `Alert`, the note as reason). Returns 200 with the `CaseDto`.
  - Already RESOLVED by the caller: 200 with `X-Already-Applied` and the case unchanged (the first note stays). Resolved by someone else: 409 `CASE_ALREADY_RESOLVED` `{ by: <their name>, currentStatus: 'RESOLVED' }`.
  - The legacy `PATCH /alerts/:id/acknowledge` and `PATCH /alerts/:id/resolve` answer 404 `NOT_FOUND` for a CUSTOMER_PROBLEM alert: a case closes only here, with a note. **No money action exists.**

### 9.7 Confirmation (routes, statuses and codes here; page content and copy in CUSTOMER_PAGE.md)
- **`confirmation.enabled`** (setting switch `confirmations`, §3.4) decides whether a delivery issues a confirmation. While it is false: the three routes below answer 403 `FEATURE_DISABLED` for every caller; a known, well-formed link answers 410 "This link is no longer active" (`CONFIRM_LINK_INACTIVE`) and records nothing (a bad or unknown token stays 404); nothing is deleted, and the expiry job keeps running. Switching it on never back-fills: an order delivered while it was off has `confirmation: null`.
- **Common checks** for the three routes, in order: the switch (403); a DRIVER or another distributor 404; not DELIVERED 409 `CONFIRM_NOT_READY`; no confirmation row 404 `NOT_FOUND`.
- **`GET /orders/:id/confirmation`** (owning distributor, office): `ConfirmationView` (CUSTOMER_PAGE §10).
- **`POST /orders/:id/confirmation/share`** (owning distributor, office; Idempotency-Key): `{ via: 'WHATSAPP' | 'SMS' | 'SHARE_SHEET' | 'COPY' }`. Returns `{ url, message, whatsappUrl, smsUrl, expiresAt }` with `Cache-Control: no-store`, re-deriving the current token (no rotation), and writes one share row with key `share:<orderId>:<Idempotency-Key>` (a new UUID when none is sent). After the common checks: a repeat with the key 200 with `Idempotent-Replay: true` and the same body, writing nothing (409 `IDEMPOTENCY_CONFLICT` if `via` differs); answered, expired or cancelled 409 `CONFIRM_CLOSED`; 20 share rows for the order in the last 60 minutes 429 `RATE_LIMITED` `{ minutes }` (until the oldest of them is an hour old, rounded up). A replay is never limited.
- **`POST /orders/:id/confirmation/new-link`** (owning distributor, office; Idempotency-Key): `{ send?: 'SMS' }`. After the common checks: the key of the last rotation 200 with `Idempotent-Replay: true` and the current view, nothing done (the body isn't compared); not PENDING or `now ≥ expiresAt` 409 `CONFIRM_CLOSED`; `send: 'SMS'` with an invalid current customer phone 400 `CLIENT_PHONE_INVALID`, before any change. Then one transaction: lock the row and re-check PENDING; `tokenVersion + 1` and a new `token_hash` (the old link stops working); `phone_e164` refreshed from the customer's current phone; `last_new_link_key` = the key (NULL without one, so every keyless call rotates); audit `confirmation.new_link`; with `send: 'SMS'`, a QUEUED row `confirm:<orderId>:v<n>:sms`, sent after commit. `expiresAt` never changes. Returns `ConfirmationView`.
- **Public, outside `/api/v1`:**
  - `GET` and `HEAD /c/:token`;
  - `GET /c/:token/partly`, `/not-received`, `/other` (second-step pages);
  - `POST /c/:token` (form post, 303). Pages and statuses: CUSTOMER_PAGE §4–§6.
- **No messaging webhook** in the pilot: no provider sends delivery reports, so `POST /webhooks/messaging/:provider` isn't registered and answers like any unknown path (404 `NOT_FOUND`). It comes with a provider that sends reports, behind that provider's own signature check.

### 9.8 State machines (Inc 2 changes)
| From | To | Trigger | Who | Money |
|---|---|---|---|---|
| ASSIGNED | IN_TRANSIT | STORE_PICKUP finish | driver | none |
| ASSIGNED, IN_TRANSIT | DELIVERED | DELIVERY finish, with scans matching | trip driver | none |
| ASSIGNED, IN_TRANSIT | DELIVERED | manual delivery naming the cylinders | office | none |
| ASSIGNED, IN_TRANSIT (started, nothing handed over) | FAILED | `/fail` | driver, office | none |
| PENDING … IN_TRANSIT (no hand-over) | CANCELLED | cancel | distributor, office | reversal only if not started (unchanged) |

- **Stop:**
  - PENDING → ARRIVED (the first scan or arrive) → DONE (finish).
  - PENDING or ARRIVED → CANCELLED or FAILED (the UI shows "Skipped").
- **Trip:**
  - PLANNED → IN_PROGRESS: the first scan, arrive or start. Its orders don't change; they become IN_TRANSIT at the STORE_PICKUP finish.
  - IN_PROGRESS → COMPLETED: finish, with every stop closed and the van empty (or, while `trip.allowFinishWithLeftovers` is on, a leftover reason, §9.3).
  - ABORTED: the office, only before anything happened on the trip (§7.7); or the system, as in §8.3.
- **Confirmation:**
  - PENDING → ANSWERED: POST, first answer wins.
  - PENDING → EXPIRED: job.
  - PENDING → CANCELLED: reserved. No pilot route writes it, because a DELIVERED order can't be cancelled or reversed; its 410 page and the "Not needed" pill exist only so a reserved value renders.
  - **Never money.**
- **Cancelled after loading:** the cylinders loaded for that order stay on the van as spare. The store must receive them before the run can finish.

### 9.9 Jobs (Inc 2)
| Job | Schedule | What |
|---|---|---|
| confirmation-expiry | `@Cron('*/15 * * * *', { timeZone: 'Asia/Karachi' })` | PENDING past `expires_at` becomes EXPIRED, whether `confirmation.enabled` is on or off. No money. |
| day-cutoff-van-check | `@Cron('0 3 * * *', { timeZone: 'Asia/Karachi' })` | For every van holding at least one cylinder that isn't on an open refill line (Inc 3), whatever its trips, raise `VAN_NOT_EMPTY` (WARNING). One unresolved alert per van: while an OPEN or ACKNOWLEDGED `VAN_NOT_EMPTY` alert exists for that van, a new raise (this job, or a finish with leftovers) only updates its context `{vehicleId, plateNo, count, tripId, leftoverReason}`. It stays until the office resolves it. No money. |

Message sends happen right after commit (CUSTOMER_PAGE §8). There is no queue and no sweeper.

### 9.10 Legacy routes in Inc 2
- **`POST /custody/scan`** delegates to ScanService:
  - SCAN_OUT becomes LOAD at the trip's STORE_PICKUP stop (so after "Done loading" it gives 409 `SCAN_STOP_CLOSED`);
  - DELIVERED becomes HANDOVER at the order's DELIVERY stop on that trip;
  - PICKED_UP_EMPTY becomes TAKE_BACK with `returnState = EMPTY` at the order's DELIVERY stop on that trip. With no `scanId`, a legacy repeat is found only by the same-move test (§9.2 step 8);
  - SCAN_IN gives 403 `SCAN_USE_STORE_RECEIVE`.
- **`PATCH /orders/:id/status DELIVERED`** (driver) behaves like the DELIVERY finish, so it needs matching scans.
- **`PATCH /trips/stops/:id/arrive`** and **`/depart`** are kept; depart maps to finish.

### 9.11 Contract tests that gate Inc 2
**Holder rules**
- Loading at another store gives 409.
- A hand-over of a cylinder not on the van gives 409.
- A cylinder given on a visit can't be taken back on it.
- A taken-back Full cylinder can't be handed over again.
- A replayed scan records once.
- Two parallel hand-overs can't exceed the count.

**Stops and runs**
- A stop can't finish with scans short.
- A run can't finish with the van not empty.
- The first LOAD stamps `load_started_at`, so a cancel after it returns nothing.

**Confirmation and cases**
- The link's GET never answers. The same answer posted again gets 303 to "Thank you", and a different second answer gets 409 "You already answered" (`CONFIRM_ALREADY_ANSWERED`); neither records anything.
- No answer, job or case ever writes a ledger row.
- A NO or OTHER answer opens exactly one case.
- A driver can't read the link.
- Test mode never sends outside the allowlist.

---

## 10. Increment 3: refills on scans, day-end, pilot setup [Inc 3]

### 10.1 Refills on QR scans (no money)
- **`POST /filling-orders`**: as §7.11, plus `refill_no` and `client_request_id`. A retry with the same `Idempotency-Key` returns the first refill (200, `Idempotent-Replay: true`); the same key with a different `fillingStationId`, `cylinderTypeId` or `requestedCount` gives 409 `IDEMPOTENCY_CONFLICT`.
- **`POST /filling-orders/:id/scans`** (the assigned DRIVER, exact): `{ scanId, phase: 'PICKUP' | 'FILL', code, entryMethod, lat?, lng? }`. `toCustodyType` and `toCustodyId` are refused (400), as in §9.3. Returns a `ScanResult` plus `refill: { status, picked, filled, received, requested }`. Resends and repeats answer as in §9.3: a PICKUP of a cylinder that already has an open line on this refill, or a FILL of a line that already has `filled_at`, returns 200 ALREADY_RECORDED with `X-Already-Applied` and never raises the counts.

  | Phase | Allowed in | Cylinder must be | Effect | Errors |
  |---|---|---|---|---|
  | PICKUP | ASSIGNED | After the §9.2 common steps (owner = the refill's distributor, `SCAN_WRONG_OWNER`; FAULTY or LOST, `SCAN_CYLINDER_BLOCKED`), in this order: not on another open refill, meaning a PICKED_UP or FILLED line of another refill that isn't COMPLETED or CANCELLED (a RETURNED line never blocks); in the pickup store, the home store; the refill's size; EMPTY or PART_FILLED; picked lines below requested | Line PICKED_UP. STORE → VEHICLE (the assigned van). Event SCAN_OUT with `filling_order_id` and no `trip_id`. The refill's driver becomes the responsible driver (§9.2); a FILL doesn't change it. | Status not ASSIGNED: `REFILL_WRONG_STEP` (§9.2 step 3). Then, in rule order: `REFILL_CYLINDER_ON_OTHER_REFILL`, `SCAN_NOT_AT_STORE`, `REFILL_CYLINDER_WRONG_SIZE`, `REFILL_CYLINDER_NOT_EMPTY`, `REFILL_COUNT_REACHED` `{requested}` |
  | FILL | EMPTIES_PICKED or AT_STATION (the first FILL sets AT_STATION) | After the common steps: a line of this refill that already has `filled_at` is the same move again (200 ALREADY_RECORDED, `X-Already-Applied`; `filled` doesn't change); otherwise a PICKED_UP line of this refill, with the cylinder still on the van | `filled_at`. Event FILLED (VEHICLE → VEHICLE). The state is unchanged until received. | Status not EMPTIES_PICKED or AT_STATION: `REFILL_WRONG_STEP`. No such line: `REFILL_CYLINDER_NOT_ON_THIS_REFILL` |

- **The return is the store's receive scan** (`POST /store/scans`):
  - VEHICLE → STORE, and the line becomes RETURNED;
  - the state becomes FULL if the line has `filled_at`, otherwise it is unchanged;
  - **when every picked line is RETURNED, the refill becomes COMPLETED** in the same transaction, with no money (audit `refill.complete`, actor SYSTEM).
- **`POST /filling-orders/:id/advance`** (the assigned driver): `{ to: 'EMPTIES_PICKED' | 'FILLED' }`.
  - EMPTIES_PICKED is "Leave store": status ASSIGNED with at least one picked line.
  - FILLED is "Leave station": status AT_STATION (at least one fill).
  - Otherwise 409 `REFILL_WRONG_STEP` `{currentStatus}`. Asking for the status the refill already has returns 200 with `X-Already-Applied`.
- **Cancel:** the owner, only in PENDING or ASSIGNED with zero picked lines (`REFILL_NOT_CANCELLABLE`). There is no office cancel and no `/fail`: a refill stays open until its cylinders are received, and anything that never returns shows up at day-end.
- **Retired** routes:
  - PATCH `picked-empties`, `at-station`, `filled` and `returned` give 410 `REFILL_USE_SCANS`;
  - PATCH `complete` gives 410 `REFILL_AUTO_COMPLETES`;
  - `GET /filling-stations` keeps sending `pricePerCylinderPaisa: "0"` to every caller (there is no version check), and writes ignore it. New apps don't read it. It goes with the post-pilot contract (DATA_MODEL §9).
- **Refill v2:**
  - PENDING → ASSIGNED (office).
  - ASSIGNED → EMPTIES_PICKED: "Leave store", with at least one pickup.
  - EMPTIES_PICKED → AT_STATION: the first fill.
  - AT_STATION → FILLED: "Leave station".
  - ASSIGNED, EMPTIES_PICKED, AT_STATION or FILLED → COMPLETED: the store receive that leaves no picked line un-received, whether or not every cylinder was filled. Unfilled cylinders keep their state. A refill with no picked line never completes; the owner cancels it.
  - PENDING or ASSIGNED with no pickup → CANCELLED (owner only).
  - RETURNED is no longer used.

### 10.2 Day-end (system-made sheet, one row per cylinder)
While `dayEnd.enabled` is false, every route below answers 403 `FEATURE_DISABLED` with `X-Feature-Disabled: dayEnd` (a setting switch, §3.4). Day-end never moves money and never refuses a scan.

**The day row.** `day_closes` has one row per distributor and business date. It is created OPEN by the first sheet download for that date (two downloads at once still make one row, DATA_MODEL §7); no job creates rows, and a read never does. `:date` must be a real `YYYY-MM-DD` no later than the current business date, else 404 `DAY_NOT_FOUND`; an unknown office `:id` is 404 `DAY_NOT_FOUND`. A date with no row reads as status OPEN, stage `NOT_STARTED`, `lastUpload: null`. Every day-end DTO carries `stage` (`DayEndStage`, §1.4).

**Distributor routes** (DISTRIBUTOR exact, own days). Download and upload act only on an OPEN day or a date with no row: a SUBMITTED day answers 409 `DAY_ALREADY_SUBMITTED`, an APPROVED day 409 `DAY_LOCKED`.
- **`GET /day-end`**: `Page<{ businessDate, status, stage, submittedAt, approvedAt, differences }>`, the caller's days that have a row, newest first.
- **`GET /day-end/:date`** returns:
  ```
  { businessDate, status, stage, cutoffAt,
    summary: { inStore: { total, bySize }, onVans, withCustomers, deliveredToday, takenBackToday, receivedToday },
    lastUpload: { uploadedAt, version, differences } | null,
    officeNote: { kind: 'SENT_BACK' | 'REOPENED'; text; at } | null,
    allowedActions: ('DOWNLOAD' | 'UPLOAD' | 'SUBMIT')[] }
  ```
  - `summary` is live, except on an APPROVED day, which reads the totals frozen at approval.
  - `officeNote` is set while `stage` is `SENT_BACK`: the later of the send-back reason (`sent_back_at`) and the reopen reason (`reopened_at`).
  - `allowedActions`: DOWNLOAD while OPEN or with no row; UPLOAD while OPEN with a sheet made; SUBMIT when `stage` is READY.
- **`GET /day-end/:date/sheet.xlsx`** (exceljs) makes a new sheet. It is stored as a `DAY_END_SHEET` file (its id is chosen first, so the sheet can carry it), and the day's `sheet_file_id` and `sheet_snapshot_at` (the sheet time) point at it. **Only the newest sheet can be uploaded.** It changes no holder data and no uploaded lines.
  - Sheet "Cylinders" has one row per cylinder of the distributor, including LOST and FAULTY, as at the sheet time. Its columns:
    - Cylinder number (printed `AG-C0042`; the upload reads any §1.1 form)
    - Size
    - App says: where ("In my store", "On driver's van · <plate>", "With customer · <customer name>", or "Missing" for a LOST cylinder)
    - App says: state (Full / Empty / Part-filled / Damaged; empty for a LOST cylinder)
    - Your count: where (In my store / On driver's van / With customer / Missing)
    - Your count: state (Full / Empty / Part-filled / Damaged)
    - Why different
  - Sheet "Extra cylinders" is for numbers found that aren't on the list (number, size, state).
  - Hidden sheet "About" (exceljs state `veryHidden`; column A the key, column B the value): `format` = `smart-fleet-day-end/1`, `distributorId`, `distributorCode`, `businessDate`, `sheetFileId`. No HMAC: the sheet is the shop's own count, and the office approves every fix.
- **`POST /day-end/:date/upload`** (multipart field `file`) checks, in order, and stores nothing unless every check passes:
  1. The size is at most 2 MiB (2,097,152 bytes), else 413 `FILE_TOO_LARGE` `{ maxMb: 2 }`.
  2. The day: 404 `DAY_NOT_FOUND`; 409 `DAY_ALREADY_SUBMITTED`; 409 `DAY_LOCKED`.
  3. The file starts with the ZIP signature `PK\x03\x04`, opens as a workbook (at most 20 MB unzipped and 20,000 rows on any sheet) and has an "About" sheet with that `format`; else 422 `DAY_SHEET_UNREADABLE` (never `FILE_TYPE_NOT_ALLOWED`, whose words are about pictures).
  4. `distributorId` is the caller's, else 422 `DAY_SHEET_WRONG_DISTRIBUTOR`. The answer holds nothing of the other shop.
  5. `businessDate` is `:date`, else 422 `DAY_SHEET_WRONG_DATE` `{ sheetDate, date }`.
  6. `sheetFileId` is the day's newest sheet, else 422 `DAY_SHEET_OUTDATED`.
  7. The "Cylinders" and "Extra cylinders" sheets exist with their headers unchanged, else 422 `DAY_SHEET_UNREADABLE`.
  8. Every row reads (the row rules below), else 422 `DAY_SHEET_ROW_ERRORS` `{ rows: [{ sheet: 'CYLINDERS' | 'EXTRA', row, code, message }], total }`: `row` is the Excel row number (the header is row 1), each row gets the code of the first rule it breaks, at most 100 rows are listed in sheet and row order, and `total` counts them all.

  Then one transaction: store the file (`DAY_END_UPLOAD`, `upload_file_id`), replace the day's lines (one per cylinder of the distributor, plus one per extra row), and set `upload_version + 1`, `uploaded_at` and `uploaded_by_user_id`. **It changes nothing in the holder data.** It answers 200 `{ version, differences: [{ id, diff, fix, shortCode, sizeLabel, app: { place, state, plateNo, customerName }, sheet: { place, state }, note, movedSinceSheet }], summary }`. `movedSinceSheet` is true when the cylinder's last event is newer than the sheet time. A refused upload leaves the version, the lines and the stage as they were.
- **Row rules.**
  - Numbers on both sheets read like a typed number (`parseCylinderNo`: "42", "0042", "C0042" or "AG-C0042", any letter case) and are stored in the normal form `AG-C0042`. A number with another shop's code is `OTHER_SHOP_NUMBER`, decided from the code alone: other shops' cylinders are never looked up. The "Your count" words match case-insensitively after trimming (’ reads as ', and the hyphen in Part-filled is optional). A blank "Your count" cell means the same as the app; a cylinder row deleted from the sheet matches.
  - Cylinders sheet, checked in this order: the number must be a cylinder number at all (`NUMBER_INVALID`), carry no other shop's code (`OTHER_SHOP_NUMBER`), be one of the caller's cylinders (`NOT_ON_LIST`) and be listed once (`DUPLICATE_NUMBER`); then the "Your count" words (`PLACE_UNKNOWN`, `STATE_UNKNOWN`); then the reason. A differing row needs "Why different" of at least 3 characters after cleaning (line breaks and tabs become spaces, other control characters are removed, spaces collapse, trimmed), cut to 200 (`REASON_REQUIRED`); there is no reason-code list. A LOST cylinder reported In my store needs a state (`STATE_UNKNOWN`). A reason on a matching row is ignored.
  - Extra cylinders sheet, checked in this order: a number that isn't a cylinder number is `NUMBER_INVALID`, one with another shop's code `OTHER_SHOP_NUMBER`, one that is one of the caller's cylinders `ON_LIST`, one listed twice `DUPLICATE_NUMBER`; then a row needs a size from the list (`SIZE_UNKNOWN`) and a state (`STATE_UNKNOWN`). It becomes an `UNKNOWN_CYLINDER` line with fix `REGISTER`.
  - Codes and English (shared-types `DAY_END_ROW_ERROR_EN`; shop key `dayEnd.rowError.<code>`): `PLACE_UNKNOWN` "Your count: where must be In my store, On driver's van, With customer or Missing."; `STATE_UNKNOWN` "Your count: state must be Full, Empty, Part-filled or Damaged."; `REASON_REQUIRED` "Say why this row is different (at least 3 characters)."; `NOT_ON_LIST` "This number isn't one of your cylinders. Put new numbers on the Extra cylinders sheet."; `DUPLICATE_NUMBER` "This cylinder number is on the sheet more than once."; `NUMBER_INVALID` "This isn't a cylinder number."; `OTHER_SHOP_NUMBER` "This number is another shop's label. Call the office."; `ON_LIST` "This cylinder is already on the Cylinders sheet. Fill in its row there."; `SIZE_UNKNOWN` "Choose a size from the list, like 11.8 kg."
- **Differences and fixes.** For comparing, the app's place is NOT_FOUND ("Missing") for a LOST cylinder, else its holder (STORE, VAN or CUSTOMER). `diff` is `MATCH`, `PLACE_DIFFERS`, `STATE_DIFFERS`, `PLACE_AND_STATE_DIFFER` or `UNKNOWN_CYLINDER`. Each differing line's `fix` (`DayCloseFix`) follows from its stored values:
  - `MARK_LOST`: the sheet says Missing. State LOST, holder unchanged.
  - `MOVE_TO_STORE`: the sheet says In my store and the app has it on a van, with a customer or LOST. Holder: the home store; state: the sheet's state if given.
  - `NOTE_ONLY`: the sheet says On driver's van or With customer and the app has it elsewhere. The sheet names no van or customer, so nothing changes; the office checks it by hand.
  - `SET_STATE`: the same place and another state (Full FULL, Empty EMPTY, Part-filled PART_FILLED, Damaged FAULTY).
  - `REGISTER`: an extra number. On approval it becomes a new cylinder in the home store with the row's size and state and the **next** short number, not the sheet's; its label must be printed.
- **`POST /day-end/:date/submit`** `{ version, note? (at most 300) }`. Checks in order: the date (404 `DAY_NOT_FOUND`); APPROVED 409 `DAY_LOCKED`; SUBMITTED with this version 200 with `X-Already-Applied` (nothing written), with another version 409 `DAY_ALREADY_SUBMITTED`; `stage` not READY (no upload from the newest sheet since the last send-back or reopen) 409 `DAY_SHEET_NOT_UPLOADED`; `version` ≠ `upload_version` 409 `DAY_VERSION_CHANGED`. Then one transaction: SUBMITTED with `submitted_at`; alert `DAY_END_SUBMITTED` (resource the day, deduplicated; approve and send-back resolve it); audit `day.submit` with the note as reason. Returns the day.

**Office routes** (office exact):
- **`GET /admin/day-end?status&cursor`**: `Page<{ id, businessDate, distributor: { id, businessName }, status, stage, version, differences, uploadedAt, uploadedBy }>`. The website's tabs are `status`: To approve SUBMITTED, Open OPEN, Locked APPROVED.
- **`GET /admin/day-end/:id`**: the day with `stage`, `version`, `summary`, `fixesToApply` (differing lines whose fix isn't `NOTE_ONLY` and whose cylinder hasn't moved since the sheet), the lines with `diff ≠ MATCH` (as in the upload answer, plus `lastScanAt`), and `files: { sheetFileId, uploadFileId }`. The website's two download links open `GET /files/:id/url` (§7.10); a link is hidden while its id is null.
- **`POST /admin/day-end/:id/approve`** `{ version }`. Checks in order: 404 `DAY_NOT_FOUND`; OPEN 409 `DAY_NOT_SUBMITTED`; APPROVED with this version 200 with `X-Already-Applied`, with another version 409 `DAY_LOCKED`; `version` ≠ `upload_version` 409 `DAY_VERSION_CHANGED`. Then one transaction (DATA_MODEL §5.4): lock the day; apply every line's fix except `NOTE_ONLY`, skipping a line whose cylinder moved since the sheet (`skipped_moved_at`); write one ADJUSTED event (source `DAY_END_FIX`, the line's reason, actor the approver) or REGISTERED event per applied line; set APPROVED with `approved_at`, `approved_by_user_id`, `locked_at` and the frozen `totals`; audit `day.approve`. **No money.** Returns `{ day, registered: [{ id, code, shortNo, shortCode, sizeLabel }] }`, so the new labels can be printed. Allowed before the day's cut-off too.
- **`POST /admin/day-end/:id/send-back`** `{ reason (5–300) }`: SUBMITTED → OPEN with `sent_back_reason` and `sent_back_at`; audit `day.send_back`. A repeat right after it (OPEN, no upload since): 200 with `X-Already-Applied`, the first reason kept. Any other OPEN day 409 `DAY_NOT_SUBMITTED`; APPROVED 409 `DAY_LOCKED`.
- **`POST /admin/day-end/:id/reopen`** `{ reason (5–300) }`, rare: APPROVED → OPEN with `reopen_reason` and `reopened_at`, `locked_at` cleared; applied fixes stay; audit `day.reopen`. A repeat right after it: 200 with `X-Already-Applied`. Any other state 409 `CONFLICT_STALE_STATE` `{ currentStatus }`.

**The lock** freezes the day's lines and summary. `DAY_LOCKED` comes only from the day-end routes above; scans, orders, top-ups, corrections and expenses never check it. A move after the sheet, even one before the cut-off on a day already approved, shows on the next sheet.

DayClose:
- none → OPEN (the first sheet download);
- OPEN → SUBMITTED (distributor);
- SUBMITTED → APPROVED (office, locks the day) or back to OPEN (send-back);
- APPROVED → OPEN (reopen).

### 10.3 Pilot setup and reset CLI (no HTTP)
**`npm run pilot:setup -- --file pilot/<name>.json [--test] [--dry-run]`.** The file is zod-validated and contains:
- the city;
- zones as GeoJSON (each must pass `ST_IsValid` with area > 0; active zones may not overlap: two zones overlap when their interiors share more than 1 m², `ST_Area(ST_Intersection(a, b)::geography) > 1`; a shared border or point is fine, because border points resolve by the area rule, DATA_MODEL §6.6);
- the two office users (name, phone), created as SUPER_ADMIN and never test rows;
- distributors (code, phone, store);
- delivery prices;
- cylinder types;
- drivers and vans;
- stations;
- settings (`topup.account`, support phone, limits, messaging allowlist);
- labelled starting stock: a count per distributor and size;
- customers (optional): distributor code, name, phone, address pin and label, notes. The normal customer rules apply: a Pakistani mobile, unique per distributor, and a pin in an active zone where that distributor has a price;
- opening balances (optional, only with `--test`): distributor code, amount in paisa and a note.

Behaviour:
- **All or nothing.** It checks the whole file first (shapes; overlaps among the file's zones and with active zones already stored; store and customer pins against the zones; codes, phones, prices, settings and stock), then writes everything in **one database transaction** through the services, so their rules and audit rows apply. A refused run writes nothing and exits 1, naming the first bad entry (its JSON path) with its error code and English text. `--dry-run` runs the checks, prints what would be created or changed, writes nothing and exits 0 (1 when a check fails).
- **Re-runs** upsert by natural key (city and zone names, phones, distributor codes, distributor and zone for prices, size for cylinder types, plate numbers, station names, distributor and phone for customers) and never create duplicates. Stock is topped up to the file's count per distributor and size, never removed.
- **Opening balances** are written once per distributor as a correction ADD with reason `OPENING_BALANCE` (shown as "Opening balance"), actor SYSTEM `cli:pilot-setup` and request key `pilot-setup:opening:<distributorId>`; a re-run never changes a balance. A file with opening balances and no `--test` is refused. On live, balances come only from top-ups and office corrections (ADR-11).
- **Passwords:** each login the run creates gets a random 12-character password, printed once at the end of a successful run (name, role, phone, password) to the terminal only: never logged, stored in clear or written to a file. A re-run creates no password and never resets one.
- **`--test`** marks the distributors, their users, the drivers' users and the vans `is_test`. Office users are never test rows.
- It writes a labels CSV for the cylinders it registers, and one `pilot.setup` audit row (actor SYSTEM `cli:pilot-setup`; diff: counts created and changed per kind).

**`npm run pilot:reset -- --yes [--dry-run]`:**
- It plans the deletion of every `is_test` distributor, user and van and what hangs off them: the rows they own (by `distributor_id`, `driver_id`, `user_id` or `vehicle_id`) and the rows under those (order lines, trips and stops, payments, ledger rows, customers and addresses, cylinders and their events, stop rows, refills, confirmations and messages, day-end rows, alerts, stored-file rows, push tokens, expenses on a test van or driver). It also deletes the `audit_logs` rows whose actor, `distributor_id` or `resource_id` is a deleted row: the one exception to the append-only log. Actor columns that point at office users don't keep a row.
- It refuses (exit 1, nothing deleted) when a row it would keep points at a row it would delete, for example a non-test distributor's order on a test van's trip, naming the first such row (table, id and short number).
- `--dry-run` prints the plan (rows per table) and exits 0. Without `--yes` it prints the plan, deletes nothing and exits 1 with "Nothing deleted. Run again with --yes to delete."
- With `--yes` it deletes in foreign-key order in one transaction, then writes one `pilot.reset` audit row (actor SYSTEM `cli:pilot-reset`; diff: rows deleted per table). Storage objects stay in the bucket.
- On production (`APP_ENV` or `NODE_ENV` is `production`) it refuses unless `--allow-production --confirm-db <name>` names the current database (`current_database()`).

**Data files.** The repo keeps `pilot/test.json`, the machine copy of the standard test data in TEST_CASES.md: the people with their sign-in phones, both shops, the zones and prices, the cylinder types, the 35 cylinders, the drivers and vans, "Lahore Filling Station", the dummy company account, the customers Sana, Usman and Hina, and Ahmed Gas's Rs 5,000 opening balance. `pilot/rehearsal.json` is the same without Sana and Usman (the shop adds them during the rehearsal), with the team's real test phones. `demo-seed.ts` is retired.

### 10.4 Retirements and tests
- `POST /reconciliations` gives 410 `RECONCILIATION_RETIRED`.
- **Tests:**
  - A refill can't pick more than requested or more than 30, and can't fill an unpicked cylinder.
  - The last receive completes the refill, and a refill never writes a ledger row.
  - The owner can't cancel after pickup.
  - An upload changes nothing, and a refused upload stores nothing. Approval applies exactly the listed fixes (never `NOTE_ONLY`) and skips moved cylinders. A locked day refuses day-end changes (`DAY_LOCKED`) but never a scan.
  - The two-distributor leak test, built with the setup script, passes before distributor #2 joins.

---

## Appendix A. Compatibility for the installed APKs (0.1.0)
| Route the installed app calls (file) | Inc 1 | Inc 2 | Inc 3 |
|---|---|---|---|
| `POST /auth/login` (PhoneScreen.tsx:41) | same shape; locked roles refused with no OTP wording | same | same |
| `POST /auth/otp/*` (PhoneScreen.tsx:59, OtpScreen.tsx:21) | 403 `AUTH_OTP_DISABLED` | same | same |
| `GET`/`PATCH /users/me` (SideMenu.tsx:146, ProfileScreen.tsx:36) | secrets stripped; phone edit refused | same | same |
| `GET /ledger/balance` (HomeScreen.tsx:18) | `{ balancePaisa, pendingTopupPaisa }` | same | same |
| `GET /ledger/me` (LedgerScreen.tsx:8) | array | same | same |
| `GET`/`POST /orders` (PlaceOrderScreen.tsx:131) | old body works; the cost is deducted at placement; coded errors | same | same |
| `GET /orders/:id/tracking` (TrackOrderScreen.tsx:18) | ownership check; `driverLocation` is null unless the order is on the way (the old screen then shows no driver marker) | same | same |
| `GET`/`POST /clients`, `/clients/:id/addresses` (AddClientScreen.tsx:93,104) | works; the address step can be blocked by a missing price | same | same |
| `POST /payments/topup`, `/payments/:id/bank-proof`, `GET /payments/mine` (TopupScreen.tsx:40,60) | works; the payer name is empty | same | same |
| `POST /files/upload` (upload.ts:65) | returns `url` (signed) | same | same |
| `GET`/`POST /filling-orders`, `/mine` (RequestFillingScreen.tsx:41,75) | DIY refused (410); price 0; no balance check | same | the scan flow is required (update app) |
| `GET /trips/mine`, `/trips/:id`, `/next-suggestions` | guarded | plus progress | same |
| `PATCH /trips/:id/status`, `/trips/stops/:id/arrive\|depart` | guarded | COMPLETED needs an empty van | same |
| `PATCH /orders/:id/status DELIVERED` (DeliveryStepsScreen.tsx:66) | own trip only; recorded once; no money | needs matching scans | same |
| `POST /custody/scan` (ScanScreen.tsx:58) | locked down; tripId required | delegates; SCAN_IN refused | same |
| `GET /inventory/my-vehicle` (VehicleLoad.tsx:34) | lots | counted from cylinders | same |
| `GET /filling-orders/driver/mine`, `PATCH /filling-orders/:id/<step>` (FillingOrdersScreen.tsx:24,35) | assigned driver only | same | 410 `REFILL_USE_SCANS` |
| `GET /transfers/mine` (driver HomeScreen.tsx:36) | `[]` plus `X-Feature-Disabled` | same | same |
| socket `/drivers` (useLiveLocation.ts:35) | already sends `auth.token`, so it works | same | same |
| `/client-portal/*` | off | off | off |

## Appendix B. Audit actions (written in the same transaction; * = reason required)
- **Users and accounts:** `user.status_change*`, `user.role_change*`, `user.password_reset`, `user.create_office`.
- **Distributors and drivers:** `distributor.create`, `distributor.update`, `distributor.store_update`, `distributor.code_change`, `distributor.activate` (reason required when reactivating from SUSPENDED), `distributor.suspend*`, `driver.create`, `driver.update`, `driver.archive*`, `driver.reactivate*`.
- **Settings, zones and prices:** `setting.update*`, `zone.create`, `zone.update`, `zone.archive`, `zone.reactivate`, `price.set`, `price.remove*`.
- **Money:** `topup.request`, `topup.approve`, `topup.reject*`, `wallet.correction*`, `wallet.opening_entry` (migration, SYSTEM), `wallet.check` (the nightly job, SYSTEM, every run).
- **Orders, trips and refills:** `order.create`, `order.assign`, `order.reassign`, `order.cancel*` (with `refunded`, `refundPaisa`, `startedRule`), `order.fail*`, `order.manual_delivery*`, `trip.abort*` (`{orderIds}`, §7.7), `refill.create`, `refill.assign`, `refill.cancel*`, `refill.complete` (the office's "Mark complete" in Inc 1; SYSTEM on the last receive in Inc 3).
- **Expenses:** `expense.create`, `expense.update`, `expense.void*`, `expense_type.create`, `expense_type.rename`, `expense_type.archive`, `expense_type.restore`.
- **Customers:** `client.phone_needs_fix` (migration), `client.update` [Inc 2]. Adding a customer or an address writes no audit row: it is the distributor's own data, and the rows carry `created_at` and `distributor_id`.
- **Cylinders:** `cylinders.bulk_register` (from Inc 1, §7.2).
- **Inc 2:** `custody.typed_entry`, `custody.manual_event*` (one per cylinder an office manual delivery moves), `confirmation.answer` (CUSTOMER; resourceType `Order`, no IP or user agent), `confirmation.new_link` (resourceType `Order`), `case.resolve*` (resourceType `Alert`, the note as reason).
- **Inc 3:** `day.submit`, `day.approve`, `day.send_back*`, `day.reopen*`, `pilot.setup` (SYSTEM `cli:pilot-setup`), `pilot.reset` (SYSTEM `cli:pilot-reset`).

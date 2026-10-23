# Admin web UX (super admin, "the office")

- **Users:** the two named SUPER_ADMIN logins (the owner and one operations person), on a laptop and sometimes a tablet.
- **Stack:** `apps/admin-web` (React 18, Vite, TanStack Query, Zustand).
- **Routes and payloads** come from API_CONTRACT.md. This doc owns screens, states, copy and the web design system.

**Rules on every screen**
- At most one primary action.
- Plain words. Never `PENDING`, `PAID_VIA_LEDGER`, `SCAN_OUT` or a UUID.
- Money as "Rs 3,450". A confirm step before an irreversible money action.
- Loading, empty, error and success states. A failure always shows with a retry.
- WCAG AA contrast. Laptop first, still usable on a tablet.
- **No "on hold" anywhere:** the cost is taken when the order is placed (DECISIONS ADR-06).

---

## 0. Audit: what the code does today (pilot/happy-path)
| # | Finding | Evidence | Fix here |
|---|---|---|---|
| A1 | Navigation is a Zustand variable with no URLs. A refresh lands on Dashboard, and `@tanstack/react-router` is installed but never imported. | store/route.ts:31-35; App.tsx:37-59; package.json:18 | TanStack Router (§1.2) |
| A2 | A flat 19-item sidebar titled "LPG Management". Only Alerts has a badge. | components/Sidebar.tsx:13-33,47,51 | Grouped navigation with badges (§1.3) |
| A3 | No design system: 432 inline style objects and 20 tokens. The Modal has no focus trap, Esc key or aria. | styles.css:1-25; components/Modal.tsx:11-39 | `src/ui` (§1.4–1.5) |
| A4 | 22 `alert`/`confirm`/`prompt` calls. The cancel reason comes from `prompt()`, and an empty reason fails silently. | PaymentsScreen.tsx:46,103,111; CurrentOrdersScreen.tsx:62-66,159-166 | ConfirmDialog with a reason, plus Toast |
| A5 | Raw enums in 14 places, 18 UUID slices used as IDs, and a driver column showing a UUID | CurrentOrdersScreen.tsx:132-136; PaymentsScreen.tsx:95 | StatusChip and short numbers |
| A6 | Money shown four ways, with float maths | PaymentsScreen.tsx:26; DistributorsScreen.tsx:260; PreviousOrdersScreen.tsx:72,82 | One `formatRs` |
| A7 | Chip contrast fails AA (warning 1.93:1, success 2.77:1); input borders measure 1.27:1 | styles.css:13-17,140-150,240-244 | New tone tokens (§1.4) |
| A8 | No loading or error states: `data ?? []` makes a failed call look empty; many mutations have no `onError` | PaymentsScreen.tsx:49; DistributorsScreen.tsx:100-107 | The screen-state contract (§1.9) |
| A9 | One-click top-up approval with no bank reference; DISPATCHER can approve | PaymentsScreen.tsx:97-115; payments.controller.ts:51-59 | Review drawer (§2.2) |
| A10 | Pricing is a 13-line placeholder | PricingScreen.tsx:1-13 | Delivery price grid (§2.3) |
| A11 | Assign still offers Auto-dispatch, and the store picker defaults to the oldest store in the system | CurrentOrdersScreen.tsx:83-96,153-156,210-216; orders.service.ts:233-244 | Starts at the distributor's store (§2.5) |
| A12 | The unrouted DeliveryOrdersScreen can still set DELIVERED | DeliveryOrdersScreen.tsx:59-66 | Delete it |
| A13 | The distributor form copies another distributor's phone, CNIC and email from a name suggestion; the store is optional and made elsewhere | DistributorsScreen.tsx:38-40,161-183,234 | One "Add distributor" drawer with its store |
| A14 | The dashboard counts in the browser from a 200-row list, with developer copy ("Run npm run seed:demo") | DashboardScreen.tsx:17-33,83 | `GET /admin/summary` |
| A15 | Login: a prefilled phone, wrong OTP copy, any role allowed, no token refresh, and the idle alert says 10 minutes while the timer is 30 | LoginScreen.tsx:6,107-109; api/client.ts:19-27; useIdleLogout.ts:25 | §2.10 |
| A16 | No i18n | none | i18next keys (§1.6) |
| A17 | 40 emoji icons; lucide-react installed but unused | DriversScreen.tsx; package.json:21 | lucide icons with text |
| A18 | Expenses: a hard-coded enum list, float maths, "Rs.", only the top 3 categories shown, delete by emoji plus `window.confirm` | ExpensesScreen.tsx:6,66,136,142,210-211 | Expenses page (§2.7) |

---

## 1. Foundations (built by the foundation lane; every later screen reuses them)

### 1.1 Folder layout and migration
```
apps/admin-web/src/
  main.tsx            QueryClient + I18nextProvider + RouterProvider + ToastProvider + ConfirmProvider
  app/router.tsx      TanStack Router tree, code-based (no codegen); every Inc 1 route is registered by the foundation
  app/AppShell.tsx    NavSidebar + TopBar + EnvBadge + <Outlet/>
  app/nav.ts          [{ group, id, to, icon, labelKey, module?, badgeKey? }]
  app/RequireStaff.tsx  role gate
  ui/                 tokens.css, base.css and the components in §1.5
  i18n/               index.ts, types.d.ts, format.ts, en/<namespace>.ts
  api/                client.ts, errors.ts, keys.ts, useApiMutation.ts
  features/<area>/    Page + Drawer + Dialogs + api.ts (query hooks) + status.ts
  legacy/             old screens, mounted unchanged inside the new shell
```
- **The foundation** creates the shell, the router with all routes, `ui/`, `i18n/`, `api/`, and a stub page for each feature, so the lanes never edit shared files.
- **Feature ownership:**

  | Lane | Folders |
  |---|---|
  | admin-web-money | `features/{topups, wallets, prices, settings, activity}` |
  | admin-web-ops | `features/{today, orders, distributors, auth}` and `legacy/**` |
  | expenses | `features/expenses` |

  Each lane owns its `i18n/en/<namespace>.ts` files.
- **Old screens** move with `git mv` into `legacy/` and are mounted unchanged. Inc 1 deletes screens/DeliveryOrdersScreen.tsx and screens/PricingScreen.tsx.
- `components/Modal.tsx` keeps exporting `Modal` and `confirmDialog` as shims over the new components until no legacy screen imports them.
- No Storybook.

### 1.2 Routing (TanStack Router 1.170.x, already installed)
Drawers are child routes: a link opens the exact record, a refresh keeps it open, and Back closes it. Tabs and filters are search params checked with `validateSearch`.

| Route | Screen | Inc |
|---|---|---|
| `/` → `/today` | Today | 1 |
| `/orders?tab=&q=&distributor=` and `/orders/$orderId` | Orders board and order drawer | 1 (+2) |
| `/topups?tab=&q=` and `/topups/$paymentId` | Top-up requests and review drawer | 1 |
| `/wallets` and `/wallets/$distributorId` | Wallets list and wallet page | 1 |
| `/prices/$distributorId` and `/prices/$distributorId/$zoneId` | Delivery prices and price drawer (`/prices` redirects to the first distributor) | 1 |
| `/distributors`, `/distributors/new`, `/distributors/$id` | Distributors | 1 |
| `/expenses?tab=expenses\|fuel-logs&from&to&type&van&driver` and `/expenses/types` | Expenses and types drawer | 1 |
| `/settings`, `/activity` | Settings, Activity log | 1 |
| `/refills`, `/stations` | Legacy refill screens (minimal edits) | 1 → rebuilt in 3 |
| `/drivers`, `/vans`, `/zones`, `/cylinders`, `/live`, `/alerts`, `/profile` | Legacy screens inside the shell | 1 |
| `/reports` | Legacy reports screen: not in the navigation, reachable only by its address | 1 |
| `/problems` | Customer problems (cases) | 2 |
| `/cylinders/find/$number` (`AG-C0042` or the QR value) | Cylinder drawer | 2 |
| `/day-end`, `/day-end/$dayEndId` | Day-end approvals | 3 |

A switched-off module's route shows EmptyState "{{module}} is switched off" with the action "Open settings". Any unknown path shows the not-found page: "We couldn't find this page" / "The link may be old or mistyped." with "Go to Today".

### 1.3 Shell and navigation
**Groups** (lucide icons, with i18n labels):
- **Today** (badge: top-ups to check + orders needing a driver, plus open customer problems from Inc 2)
- **Work:** Orders (badge: orders needing a driver), Top-ups (badge: to check), Refills, Problems (Inc 2; badge: open customer problems), Day-end (Inc 3), Live map
- **Money:** Wallets, Delivery prices, **Expenses**
- **Setup:** Distributors, Drivers, Vans, Zones, Refill stations, Cylinders & labels
- **System:** Alerts, Settings, Activity log
- **Footer:** name, My profile, Sign out

**Removed from navigation:**
- Stores (each store lives under its distributor)
- Inventory roll plan (transfers)
- Fuel & km (folded into Expenses as a tab)
- Reports (the API stays; the legacy page is reachable only by its address, `/reports`)
- Accessories
- The Pricing placeholder

**Top bar and title**
- The top bar is 56 px. An environment strip sits above it on test and training servers. Breadcrumbs on the left; "Find cylinder" (Inc 2) and the user menu on the right.
- The browser tab title carries the waiting count, the same number as the Today badge (top-ups to check + orders needing a driver, plus open customer problems from Inc 2; missing prices and distributors waiting to start are Today cards only, so the count reaches 0 when nothing waits): "(5) Top-up requests · Smart Fleet Office".
- The product name is **"Smart Fleet Office"** (index.html:7, Sidebar.tsx:51).

**Layout by width**
| Width | Navigation | Content | Drawers | Tables |
|---|---|---|---|---|
| ≥1280 | Sidebar 232 px | Padding 24/32, max width 1360 | Side panel 480 px (wide 640) | All columns |
| 1024–1279 | 64 px icon rail with tooltips | Padding 20/24 | Side panel | Hide priority-3 columns |
| 768–1023 | Menu button opens a 280 px overlay | Padding 16 | Full-screen sheet | Hide priority 2 and 3 (they are always in the drawer); a sticky first column |
| <768 | As tablet | Single column | Full screen | The page itself never scrolls sideways |

**Touch sizes:** on `(pointer: coarse)`, controls are 48 px and rows 56 px. On a fine pointer, controls are 40 px and rows 48 px.

### 1.4 Tokens (`src/ui/tokens.css`; replaces styles.css:1-25)
```css
:root{
 --bg:#f5f6f8; --surface:#fff; --surface-2:#f9fafb; --overlay:rgba(15,18,27,.40);
 --border:#e3e5e9;            /* decorative dividers only */
 --border-input:#8c939d;      /* inputs/checkboxes: 3.1:1 on white */
 --text:#1f2328; --text-muted:#5f6670;                 /* muted 5.8:1 on white, 5.4:1 on --bg */
 --primary:#0b5fd6; --primary-hover:#0a4fb3; --primary-soft:#e6efff; --focus:#0b5fd6; /* white on primary 5.8:1 */
 --danger-solid:#c42727;                               /* white text 5.7:1 */
 --neutral-fg:#4a4f57; --neutral-bg:#eef0f3;           /* 7.2:1 */
 --info-fg:#0b4fb3;    --info-bg:#e6efff;              /* 6.5:1 */
 --success-fg:#0b6b47; --success-bg:#e3f5ec;           /* 5.8:1 */
 --warning-fg:#8a4b00; --warning-bg:#fff4d6;           /* 6.2:1 */
 --danger-fg:#a61b1b;  --danger-bg:#fde8e8;            /* 6.4:1 */
 --nav-bg:#171a20; --nav-text:#c9cdd4; --nav-muted:#9aa1ab; --nav-active:#0b5fd6; /* 10.9:1 / 6.7:1 */
 --font:"Inter","Segoe UI",system-ui,-apple-system,Roboto,sans-serif;
 --fs-12:12px; --fs-13:13px; --fs-14:14px; --fs-16:16px; --fs-20:20px; --fs-28:28px; --lh:1.5;
 --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:20px; --sp-6:24px; --sp-8:32px; --sp-10:40px;
 --r-sm:6px; --r-md:10px; --r-lg:14px; --r-pill:999px;
 --shadow-1:0 1px 2px rgba(15,23,42,.06); --shadow-2:0 4px 12px rgba(15,23,42,.10); --shadow-3:0 16px 40px rgba(15,23,42,.18);
 --control-h:40px; --row-h:48px; --nav-w:232px; --rail-w:64px; --topbar-h:56px; --drawer-w:480px; --drawer-w-wide:640px;
 --z-nav:10; --z-sticky:20; --z-drawer:40; --z-modal:50; --z-toast:60; --dur-fast:120ms; --dur:200ms;
}
@media (pointer:coarse){:root{--control-h:48px;--row-h:56px}}
@media (prefers-reduced-motion:reduce){:root{--dur-fast:0ms;--dur:0ms}}
```
- Table headers are sentence case at 12.5 px semibold muted; today they are uppercase (styles.css:178-185).
- Money uses `font-variant-numeric: tabular-nums`.
- Only CSS logical properties (`margin-inline-start`, `text-align:start`), so right-to-left Urdu later is just a `dir` switch.
- The page title (h1) is 20 px; section titles are 16 px.

### 1.5 Components (`src/ui`)
**Actions and headers**
- **Button** `{variant:'primary'|'secondary'|'ghost'|'danger'|'ghost-danger', size:'md'|'lg', loading?, disabled?, disabledReason?, icon?}`
  - Keeps its width while loading. `disabledReason` shows as a tooltip and through `aria-describedby`.
  - At most one primary per screen.
  - **IconButton** requires a `label`.
- **PageHeader** `{title, subtitle?, meta?, primaryAction?, secondaryActions?, updatedAt?, onRefresh?}`. Polled pages show "Updated 12 s ago ⟳".
- **Tabs** `{items:[{id,label,count?}], value, onChange}`, synced to `?tab=`.
- **FilterBar:** search (300 ms debounce; the `/` key focuses it), selects, and date presets (Today, Last 7 days, This month, Custom).

**Data**
- **Table** `Table<T>` `{caption, columns:[{id, header, cell(row), align?, priority?:1|2|3, width?, sticky?}], rows, rowKey, onRowClick?, rowTone?(row), state:'loading'|'error'|'ready', empty, error, footer}`
  - A semantic `<table>` with a hidden caption. The whole row is focusable, and Enter opens it.
  - Loading shows 5 skeleton rows.
  - `rowTone` adds a 4 px border on the start edge, always paired with a text chip.
  - The footer has "Load more" (cursor pages).
- **StatusChip** `{kind, value}`: a 24 px pill with an icon and the label from `status:<kind>.<VALUE>`. An unknown value shows "Unknown" and logs once.
- **MoneyText** `{paisa, signed?, tone?:'auto'|'none', size?}`. `null` shows "—"; `auto` colours the sign.
- **FeeChip** `{amountPaisa, status}`:

  | Status | Chip |
  |---|---|
  | `DEDUCTED` | "Rs 330 paid" (neutral, wallet icon) |
  | `REVERSED` | "Rs 330 returned" (success) |
  | `NONE` | "No fee" |

  It never says "on hold".

**Forms**
- **MoneyInput** `{valuePaisa, onChange, min?, max?, allowZero?}`
  - "Rs" prefix, `inputMode=numeric`, digits and commas only. A dot gives "Whole rupees only".
  - Adds separators on blur and returns a paisa string.
- **Field** `{label, hint?, error?, optional?}`; **TextInput**; **Textarea** (with a counter); **Select** (native); **Switch** (shows "On"/"Off"); **RadioCards** (large cards; arrow keys move).
- **DateInput**, **DateTimeInput** (+05:00); **PhoneInput** (normalises with `normalizePkPhone` and shows `formatPkPhone(phone, 'international')`, "+92 300 1234567", the form the website uses for every phone).
- **useZodForm(schema, initial)**, about 60 lines, no form library:
  - validates on blur and on submit; zod messages are i18n keys;
  - `setServerError(apiError)` places `details.fields` errors under the right field.

  Schemas come from `packages/shared-validation`.

**Overlays and feedback**
- **Drawer** `{title, subtitle?, chip?, width:'md'|'lg', dirty?, footer, onClose}`
  - A dialog that traps and restores focus. Esc closes it, asking "Discard changes?" when dirty.
  - A sticky footer: destructive actions at the start; secondary and the one primary at the end.
  - Open record drawers re-poll every 10 seconds. If someone else changed the record, an InlineAlert appears and the form locks.
- **Modal** (440/560 px; a bottom sheet under 768 px). **ConfirmDialog / useConfirm()**:
  ```
  confirm({title, facts?, body?, tone, confirmLabel, cancelLabel='Go back', reason?:{label, required, minLength, options?}, action?}) → Promise<{ok, reason?}>
  ```
  - The default focus is "Go back". The confirm label is a verb plus the amount or object.
  - With `action`, the dialog stays open with a spinner and shows errors inline.
  - It replaces every `window.confirm` and `window.prompt`.
- **Toast / useToast()**: success (5 seconds) or error (stays until closed). Toasts confirm finished actions; form errors stay inline.
- **EmptyState**, **ErrorState** `{error, onRetry}` (with a copyable "Reference: 7f3a2c", the request ID), **StaleBanner** (after 2 failed refreshes), **InlineAlert**, **Skeleton**, **Spinner**.
- **KeyValueList**, **Timeline**, **ActivityList** `{resourceType, resourceId}` (sentences from §2.9), **WaitTime** `{since, warnAfterMin}`, **EnvBadge**, **CopyButton** (falls back to a selectable input).

### 1.6 i18n and formatting
- **Libraries:** i18next 23 and react-i18next 14, as the mobile app uses. Add them to `apps/admin-web/package.json`; they are already in the monorepo's node_modules.
- **Namespaces**
  - foundation: `common`, `nav`, `status`, `errors` (= `ERROR_MESSAGE_EN`), `validation`;
  - lanes: `today`, `orders`, `distributors`, `auth`, `topups`, `wallets`, `prices`, `settings`, `activity`, `expenses`;
  - Inc 2: `problems`, `cylinders`. Inc 3: `refills`, `dayend`.
- **Types:** `i18n/types.d.ts` declares `CustomTypeOptions.resources`, so a missing key fails `tsc`.
- **Plurals:** i18next 23 keys `<key>_one` and `<key>_other`, with the count passed as `count`. Every string that shows a count has both. Error texts come from `ERROR_MESSAGE_EN`, worded to read right for any count.
- **No literal strings** in JSX, toasts, confirm calls or zod schemas.
- **Pseudo-locale:** a dev-only `?lng=en-XA` wraps strings in ⟦…⟧ and makes them 30% longer.
- **Formatting** (`format.ts`, always `timeZone:'Asia/Karachi'`):

  | Function | Output |
  |---|---|
  | `formatRs` | "Rs 3,450", or signed "+Rs 5,000" / "−Rs 330" (no space after the sign; zero never signed) |
  | `formatDateTime` | "21 Oct, 4:12 pm" |
  | `formatTime` | "4:12 pm" |
  | `formatDay` | "Wed 21 Oct" |
  | `formatWait` | "12 min", "1 h 20 min" |
  | `formatCount` | "3 of 5 loaded" |

### 1.7 API client, errors, freshness
- **Client:** keep the axios instance (api/client.ts:8-17). Add `X-Request-Id`, `X-App-Variant: admin-web` and a 20-second timeout.
  - On a 401: one `POST /auth/refresh` (single-flight), then replay the request. If that fails: "Your session ended. Sign in again."
- **Errors:** `toApiError(e)` and `messageFor(err)`, which tries `t('errors:'+code, params)`, then the server message, then `errors:UNKNOWN`.
- **`useApiMutation({mutationFn, idempotent:true})`** creates one `Idempotency-Key` when the dialog opens, reuses it on retry, and drops it on success or close. A retried approval can never add money twice.
  - Mutations never retry by themselves. GET requests retry twice.
- **Polling:** summary 20 s; top-ups 20 s; orders 15 s; open drawers 10 s.
  - Polling pauses in a background tab. Queue pages refetch on focus; main.tsx:9 turns this off globally, so override it per page.
  - Use `placeholderData: keepPreviousData`, so tables never flash empty.

### 1.8 Accessibility
- **Focus:** a visible 2 px focus ring. Dialogs trap and restore focus.
- **Tables and controls:** semantic tables with captions. Chips pair an icon with text. Every icon button has a label.
- **Live regions:** toasts use live regions.
- **Keyboard:** Enter opens a row, Esc closes, `/` searches.
- **Sizes and motion:** targets are 40 px (48 px on touch). Reduced motion is respected. Nothing relies on colour alone.

### 1.9 Screen-state contract (every screen)
| State | Pattern |
|---|---|
| First load | A skeleton in the final layout |
| Refreshing | Keep the data and show "Updated …". After 2 failures, show StaleBanner |
| Empty | Say what will appear and when. No developer text |
| Error | ErrorState with the cause, "Try again" and the reference |
| Submitting | A button spinner; values kept; a double submit is impossible |
| Failed submit | An inline error at the field (`details.fields`) or at the top. "Try again" reuses the same key |
| Success | The dialog closes, a toast states the result, the list updates, focus returns to the row |

---

## 2. Increment 1 screens

### 2.1 Today (`/today`; admin-web-ops; replaces DashboardScreen)
- **Header:** "Today · Wed 21 Oct" and "Updated 8 s ago". The data comes from `GET /admin/summary`, which also feeds the navigation badges.
- **"Needs you" cards.** Only cards with something waiting show, most urgent first, each with one button.

  | Card | Line 1 | Line 2 | Button |
  |---|---|---|---|
  | Top-ups to check | "{{count}} top-up to check" / "{{count}} top-ups to check" | "Oldest waiting 45 min" (warning at 60 min or more) | "Check top-ups" |
  | Orders needing a driver | "{{count}} order needs a driver" / "{{count}} orders need a driver" | "Oldest placed 12 min ago" | "Assign drivers" |
  | Missing prices | "{{distributor}}: {{count}} zone has no delivery price" / "{{distributor}}: {{count}} zones have no delivery price" | "Customers there can't be added and orders are blocked." | "Set prices" |
  | Distributor not started | "Noor LPG hasn't started yet" | "Finish the checklist and activate." | "Open" |
  | Customer problems (Inc 2) | "{{count}} customer problem" / "{{count}} customer problems" | "Oldest reported {{wait}} ago" | "Open problems" |

  One Missing prices card per row of `prices.missing` (active distributors only); a distributor waiting to start shows only the "Distributor not started" card.

- **All clear:** "All caught up" / "New top-ups and orders show up here by themselves." (from Inc 2: "New top-ups, orders and customer problems show up here by themselves.")
- **"Today so far" row:**
  - Orders placed 14 · Delivered 9
  - **Delivery costs taken Rs 2,970** (`costTakenTodayPaisa`: deductions minus returns)
  - Top-ups approved Rs 12,000
  - Drivers on duty 2 of 2

### 2.2 Top-up requests (`/topups`, drawer `/topups/$paymentId`; admin-web-money; evolves PaymentsScreen)
- **Header:** "Top-up requests"; subtitle "Approve only after you see the money in the company bank app."; meta "Approved today: {{amount}} · {{count}} top-up — compare with the bank app" / other "… {{count}} top-ups …".
- **Tabs:** To check (n) · Approved · Rejected · All. **Search:** "Name, transaction ID, bank reference or AG-T number". The data is `GET /admin/topups`.
- **"To check" table** (oldest first):

  | Column | Content | Priority |
  |---|---|---|
  | Waiting | WaitTime, warning at 60 minutes | 1 |
  | Distributor | name | 1 |
  | Amount | MoneyText, right-aligned | 1 |
  | Paid from | "Ali Raza · Easypaisa" | 2 |
  | Transaction ID | mono, or "—" | 3 |
  | Screenshot | 32 px thumbnail, or "None" | 3 |
  | Action | "Review" | 1 |

- **Approved tab:** Approved · Distributor · Credited · Bank reference · Bank time · By · Asked (shown only when it differs).
- **Rejected tab:** Rejected · Distributor · Amount asked · Reason · By.

**Review drawer**
- **Header:** "Ali Gas asks for Rs 5,000" with the chip "To check"; "AG-T031 · sent 4:12 pm · waiting 12 min".
- **"What Ali Gas told us":** amount, paid from, transaction ID (copy), and a screenshot that opens ProofViewer.
- **"Find the payment in the company bank app, then type what it shows":**
  - A muted line: "Company account: {{accountTitle}} · {{bankName}} · ending {{last4}}" (from `topup.account`).
  - **Bank reference** (mono, required): "As shown in the bank app. Spaces and dashes don't matter. Each reference can be used once."
  - **Amount in the bank** (MoneyInput, required, not prefilled).
  - **Time in the bank** (DateTimeInput, required; at most 5 minutes ahead of now).
  - **If the amounts differ:**
    - with `topup.onAmountMismatch = CREDIT_BANK_AMOUNT`, a warning: "The bank shows Rs 4,500 but Ali Gas asked for Rs 5,000. Only Rs 4,500 will be added." The primary follows the bank amount.
    - with `REJECT`, a danger alert: "Amounts must match. Reject and ask for a new request." The primary is disabled.
  - A bank time more than 24 hours before the request: "This payment is from Mon 19 Oct, more than a day before the request. Make sure it's the right one."
- **Rule box:** "Approve only from a payment you saw in the company bank app. Never from a screenshot or a WhatsApp message. A bank reference that has already been used is refused."
- **Activity list.**
- **Footer:** "Reject…" (ghost-danger) and the primary "Add Rs 5,000 to Ali Gas wallet", disabled with "Type the bank details first".
- **Approve:**
  1. A ConfirmDialog: "Add Rs 5,000 to Ali Gas wallet?", with the facts (reference, bank amount, bank time, and "Asked for Rs 5,500" if different) and the body "This can't be undone here. If it's a mistake, record a wallet correction." Confirm "Yes, add Rs 5,000".
  2. `POST /payments/:id/approve` with the key.
  3. The toast "Rs 5,000 added to Ali Gas wallet. Balance now: Rs 8,450."
- **Reject** (Modal):
  - Title "Reject Ali Gas's request for Rs 5,000?"
  - RadioCards: Money not found in the bank · Amount doesn't match · Payer name doesn't match · Duplicate request · Other.
  - A note (required for Other; "Ali Gas sees this in the app"), and a preview of what the distributor will see.
  - Confirm "Reject request".
- **ProofViewer:** the image fits the window, and a click zooms to 2×. If the signed link fails, refetch once; then "Can't load the screenshot. Close and open the request again."
- **Errors**
  - At the field: `TOPUP_BANK_REFERENCE_USED` (reference), `TOPUP_AMOUNT_TOO_SMALL`/`_TOO_LARGE` (amount), `TOPUP_BANK_TIME_IN_FUTURE` (time).
  - At the top: `TOPUP_NOT_PENDING` (refetch; "Sana approved this at 4:21 pm", or "Sana rejected this at 4:21 pm" when `details.status` is REJECTED), `TOPUP_WOULD_EXCEED_CAP`, `TOPUP_AMOUNT_MISMATCH`, network errors ("Couldn't reach the server. Your entries are kept — try again.").
- **Empty:** "No top-ups to check" / "New requests from distributors show up here. This list refreshes every 20 seconds."
- **Not built:** second approval and "Not in bank yet" (DECISIONS ADR-09).

### 2.3 Delivery prices (`/prices/$distributorId`, drawer `/prices/$distributorId/$zoneId`; admin-web-money; replaces PricingScreen)
- **Header:** "Delivery prices"; subtitle "What each distributor pays per order, by the customer's zone: a base per order, plus an optional amount per cylinder size."
- **Distributor switcher:** a segmented control for 4 or fewer distributors, otherwise a Select. Each option shows its coverage ("10/10", or the warning "8/10").
- **Missing-price alert:** one: "{{count}} of {{total}} zones has no price for {{distributor}}. Customers in that zone can't be added, and orders there are blocked."; other: "{{count}} of {{total}} zones have no price for {{distributor}}. Customers in those zones can't be added, and orders there are blocked." It has a "Show only missing" toggle.
- **Grid** (`GET /pricing/prices/:distributorId`):

  | Column | Content | Priority |
  |---|---|---|
  | Zone | name, with the city muted; sticky | 1 |
  | Base per order | MoneyText | 1 |
  | One column per active size | "11.8 kg" over "per cylinder"; 0 shows as "—" | 1 |
  | Status | "Set" (success) or "Not set" (warning) | 2 |
  | Last changed | "21 Oct by Sana" | 3 |
  | Action | "Edit", or "Set price" | 1 |

  Archived zones are hidden behind "Show archived zones".
- **Price drawer**
  - "Ali Gas · Zone G-9".
  - **Base per order** (MoneyInput, required, Rs 0 to Rs 100,000).
  - **Per cylinder (optional)**: one MoneyInput per size (at most Rs 100,000), where blank means Rs 0.
  - A live example: "An order of 2 × 11.8 kg costs Rs 250 + 2 × Rs 40 = Rs 330". Zero parts are hidden, so a flat price reads "Rs 250". Until the base per order is a valid amount it reads "Type the base per order to see an example.": Rs 0 is a real price, so a blank base never reads as "costs Rs 0".
  - A note: "New prices apply to orders placed from now on. Orders already placed keep their cost."
  - Primary "Save price" (`PUT`). Toast "Price saved for Zone G-9. New orders use it now."
  - Secondary "Remove price…" (a ConfirmDialog with a reason): "Customers in G-9 will be blocked until a new price is set."
- **Errors:** `PRICE_INVALID` (field), `ZONE_ARCHIVED`, `CONFLICT_STALE_STATE` ("Reload").
- **Empty:** "No zones yet" / "Zones are loaded by the setup script. Ask engineering to load the agreed zone shapes."

### 2.4 Distributors and their one store (`/distributors`; admin-web-ops; evolves DistributorsScreen and StoresScreen)
- **List:** header "Distributors" with the primary "Add distributor".

  | Column | Content | Priority |
  |---|---|---|
  | Distributor | business name, with the contact muted | 1 |
  | Code | AG | 2 |
  | Phone | | 1 |
  | Store | name, with the zone muted | 1 |
  | Status | "Waiting to start", "Active" or "Suspended" | 1 |
  | Balance | MoneyText | 2 |
  | Prices | "10 of 10", or the warning "8 of 10" | 2 |

  Keep "Show suspended".
- **Add drawer** (`/distributors/new`, 640 px)
  - **Business:** business name; contact name; phone (PhoneInput); **shop code** (2–6 capital letters or digits, starting with a letter: "Used in order numbers like AG-0142. It can't change after the first order."); CNIC (optional; 13 digits, dashes optional; after saving it shows only as "*****-****567-1", read-only, and can't be changed in the pilot); email (optional).
  - **Store:** "Drivers load here. Each distributor has exactly one store."
    - Name (default "{{business}} store") and address.
    - A 280 px Leaflet map (as ZonesScreen uses): click to drop the pin, with "Jump to area" (`/cities`, `/cities/:id/areas`).
    - The zone is read-only, from `GET /zones/locate`: "Zone: G-9 (from the pin)". Outside every zone: "This spot is outside every active zone. Move the pin or ask engineering to load the zone."
  - Primary "Create distributor". Toast "Ali Gas created. Next: set delivery prices, then activate."
  - **Removed:** the name suggestions that copy another person's data, and the duplicate checks in the browser. The server returns `USER_PHONE_IN_USE`, `USER_CNIC_IN_USE` and `DISTRIBUTOR_CODE_IN_USE`.
- **Distributor page** (`/distributors/$id`)
  - **Header:** the name, code and status chip.
    - Primary (while waiting to start): "Activate distributor", disabled until the readiness checklist passes.
    - More:
      - Suspend… or Reactivate… (a ConfirmDialog "Reactivate {{name}}? They can sign in and place orders again." with a required reason of 5–300 characters; `PATCH /distributors/:id/approve`);
      - Set app password (reuses PasswordResetButton with an icon): a dialog "Set app password for {{name}}" with one password field (at least 8 characters, Show/Hide) and the helper "Tell {{name}} this password by phone or in person. It isn't shown again."; confirm "Set password"; toast "App password set for {{name}}. They must sign in again with it.";
      - Change code (only before the first order).
  - **Readiness card:** ✓ Store set (G-9) · ✓/✗ Delivery prices 8 of 10 ("Set prices") · ✓/✗ App password set · "Balance Rs 0 — they can top up after activation."
  - **Cards:** Contact (Edit) · Store (map thumbnail, address and zone; "Edit store") · Wallet ("Balance Rs 3,450"; "Open wallet") · Delivery prices ("10 of 10") · Recent orders (5, "See all") · Activity.
  - **Edit store:** if the zone changes, "The store moves from zone G-9 to G-10. New trips start from the new place."
  - **Activate:** ConfirmDialog "Activate Ali Gas? They can place orders and top up from now on."
  - **Suspend** (danger, a reason of 5–300 characters required; `PATCH /distributors/:id/suspend`): "They are signed out of the shop app and can't sign in until you reactivate them, so they can't place new orders or refills or send top-up requests. Orders already out continue. Their balance stays as it is, and you can still approve or reject top-ups they already sent."

### 2.5 Orders board (`/orders`, drawer `/orders/$orderId`; admin-web-ops; evolves CurrentOrders, PreviousOrders and the OrdersScreen tabs)
- **Header:** "Orders"; subtitle "Orders come from the distributor app. Assign a driver to each new order."
- **Tabs** (`GET /orders/board`): Needs a driver · In progress · Done today · Cancelled & failed · All.
- **Search:** "Order number, customer or phone". A Distributor filter shows only when there is more than one.
- **Table:**

  | Column | Content | Priority |
  |---|---|---|
  | Order | AG-0142 | 1 |
  | Stage | StatusChip | 1 |
  | Customer | name, with the area muted | 1 |
  | Cylinders | "2 × 11.8 kg" | 2 |
  | Delivery cost | FeeChip | 1 |
  | Driver | "Imran · LEA-1234", or the button "Assign driver" | 1 |
  | Distributor | hidden with only one | 3 |
  | Placed | "12 min ago" | 2 |

- **Stages** (`status:order.*`):

  | Stage | Words | Tone |
  |---|---|---|
  | NEEDS_DRIVER | Needs a driver | warning |
  | DRIVER_ASSIGNED | Driver assigned | info |
  | LOADING | Loading | info |
  | ON_THE_WAY | On the way | info |
  | DELIVERED | Delivered | success |
  | NOT_DELIVERED | Could not deliver | danger |
  | CANCELLED | Cancelled | neutral |

- **Order drawer**
  - "Order AG-0142" with the stage; "Ali Gas · placed 10:12 am".
  - Primary "Assign driver" (NEEDS_DRIVER). Secondary "Change driver" (DRIVER_ASSIGNED, hidden once loading or once a cylinder was handed to or taken from the customer: it follows `allowedActions` REASSIGN).
  - More: "Cancel order…" · "Could not deliver…" (only once started) · "Mark delivered by office…".
  - Sections:
    - customer (name, `tel:` link, address, zone);
    - cylinders;
    - **Delivery cost:** the FeeChip plus "Base Rs 250 + 2 × Rs 40 (11.8 kg) = Rs 330 · taken from the wallet when the order was placed"; when `cancel.noRefundReason` is `DELIVERY_STARTED`, a second line "Cancelling now returns nothing: delivery has started.";
    - driver and van: "Starts at Ali Gas store · G-9 Markaz";
    - a Timeline: "Placed · Rs 330 taken from wallet", "Driver assigned (by Sana)", "Loading started", "Delivered" (or "Cancelled · Rs 330 returned" / "Cancelled · no refund");
    - Activity.
- **Assign driver dialog** (560 px; replaces CurrentOrdersScreen.tsx:179-228)
  - "Assign a driver to AG-0142" with the summary line.
  - A read-only "Starts at: Ali Gas store · G-9 Markaz", and **no store picker**. With no store: a danger alert and a disabled primary.
  - RadioCards of drivers: name · van · "On duty"/"Offline" · "On another run". 'On another run' is information only: the card can still be chosen. Disabled cards keep a reason ("No van — give one in Vans", "On leave until 24 Oct", "Account suspended").
  - Reassign variant: "Change driver for AG-0142", with "Imran's stop will be cancelled. Only the new driver can deliver this order."
  - Primary "Assign to Imran". Toast "AG-0142 assigned to Imran. He sees it in his app now." An X-Already-Applied answer (a double submit) shows the same toast; nothing is created twice.
  - Errors: `ORDER_NOT_ASSIGNABLE`, `ASSIGN_DRIVER_NO_VEHICLE`, `ASSIGN_DRIVER_NOT_AVAILABLE`, `DISTRIBUTOR_NO_STORE`, `ASSIGN_ORDER_LOADED`.
- **Cancel order** (ConfirmDialog with a reason list and a required note of 5–300 characters; it sends `confirmRefundPaisa`). Three variants, from `order.cancel`:

  | When | Body | Confirm |
  |---|---|---|
  | `refundPaisa > 0` (before the start) | "Rs 330 goes back to Ali Gas's wallet." | "Cancel and return Rs 330" |
  | `noRefundReason = DELIVERY_STARTED` (after the start; danger) | "Delivery has started. Cancelling now returns nothing." | "Cancel without refund" |
  | `refundPaisa` 0 and no `noRefundReason` (no cost, or an order the old system charged before the switch-over) | "Nothing goes back to the wallet for this order." | "Cancel order" |

  - `ORDER_CANCEL_TERMS_CHANGED` re-renders the dialog with the new terms.
  - `ORDER_HANDOVER_STARTED` shows "Cylinders were already handed over. Use 'Could not deliver' or mark it delivered."
- **Could not deliver** (only after the start; a reason and a note of 5–300 characters): "No money moves; the Rs 330 was taken when the order was placed. The driver must bring the cylinders back to the store." Confirm "Mark could not deliver". Before the start the action is hidden; the cancel tooltip explains why.
- **Mark delivered by office** (a reason of at least 10 characters): "Use this only when the driver can't mark it in the app. It's logged with your name. No money moves." Inc 2 adds the cylinder numbers. Errors: `ORDER_INVALID_TRANSITION` refetches the drawer, which then shows the order's real stage (for example Delivered by the driver). An X-Already-Applied answer shows the same toast.
- **Removed:** Auto-dispatch (CurrentOrdersScreen.tsx:83-96, 112, 153-156), the "Confirm" button, the store picker, the UUID driver column, and DeliveryOrdersScreen.

### 2.6 Wallets (`/wallets`, `/wallets/$distributorId`; admin-web-money)
- **List** (`GET /admin/wallets`): "Wallets" / "Each distributor's prepaid balance for delivery costs."

  | Column | Priority |
  |---|---|
  | Distributor | 1 |
  | Balance | 1 |
  | Being checked (pending top-ups) | 2 |
  | Last top-up (when the last one was approved) | 3 |

- **Wallet page**
  - "Ali Gas · Wallet", with the secondary actions "Record correction" and "Download statement".
  - **One Balance card** (large), plus the muted line "Rs 5,000 in top-ups being checked (not added yet)".
  - **Integrity line**, from `integrity` and the balance:
    - OK: "History matches the balance (checked just now)" (success);
    - mismatch (`differencePaisa` isn't "0"): a danger banner "The history doesn't match the balance by Rs 120. Tell engineering, and don't record corrections until it's fixed." (the amount is the absolute `differencePaisa`). While it shows, "Record correction" is disabled with the reason "Fix the history mismatch first." The page only reads; the nightly check raises the alert.
    - below zero (`ok` false, `differencePaisa` "0", balance below Rs 0: an old unguarded debit whose history adds up): a warning banner "The balance is below zero. Record a correction to bring it to Rs 0 or more." "Record correction" stays on, because a super-admin correction is the documented fix (DATA_MODEL §3.5 inc1b pre-check). `ok` stays false for the nightly check (API_CONTRACT §8.5). Any other `ok: false` reads as a mismatch.
  - **History** (`/admin/distributors/:id/wallet/statement`)
    - Filters: date (This month by default; Today, Last 7 days, This month and Last month count from the business date, 03:00 cut-off, because the statement reads `from`/`to` as business days, API_CONTRACT §7.8, ADR-21) and type (All · Top-ups `TOPUP_ADDED` · Delivery costs `DELIVERY_COST` · Returned delivery costs `DELIVERY_COST_RETURNED` · Corrections `CORRECTION,OPENING_BALANCE`; older entries show under All only).
    - Columns: When · What happened · Change (signed) · Balance after · By (priority 3).

    | Entry | "What happened" |
    |---|---|
    | Top-up | "Top-up · AG-T031 · ref 77814402" (the reference is `subject.bankReference`, as typed) |
    | Delivery cost | "Delivery cost · AG-0142" |
    | Cost returned | "Delivery cost returned · AG-0142 (cancelled before delivery started)" |
    | Correction | "Correction: Top-up approved by mistake — {{note}}" |
    | Opening entry | "Opening balance"; when an office user recorded it as a correction: "Opening balance — {{note}}" |
    | Old adjustment | "Older entry (before the pilot)" |

  - **Download statement:** a CSV built in the browser for the chosen range: Date, Time, What happened, Reference, Change (Rs), Balance after (Rs), By. Named `ali-gas-wallet-2026-10.csv`. At most 2,000 rows ("Pick a shorter date range"). A print stylesheet is included.
- **Correction dialog** (560 px)
  - "Record a correction for Ali Gas".
  - Direction (RadioCards, no default): "Add money to the wallet" / "Take money from the wallet".
  - Amount: more than 0, at most Rs 100,000.
  - Reason (Select), with the shop app's words (UX_MOBILE §3.4 `wallet.correction.*`): Top-up approved by mistake · System error · Bank reversed a top-up · Opening balance · Other. The history's "Correction: {{reason}} — {{note}}" uses the same words.
  - Related top-up or order (optional, "AG-T031 or AG-0142"; looked up among this distributor's own top-ups and orders; a number that isn't theirs shows "Ali Gas has no top-up or order AG-T031." under the field, which is also where the server's `NOT_FOUND {field}` goes).
  - Note (required, at least 10 characters): "Why? Saved in the history and the activity log."
  - A preview: "Balance: Rs 3,450 → Rs 3,780". Taking too much: "Ali Gas has only Rs 3,450. You can't take more than that."
  - Confirm "Add Rs 330 to Ali Gas wallet as a correction?" with "Add Rs 330" or "Take Rs 330". Toast "Correction saved. Ali Gas balance: Rs 3,780."
  - This is for mistakes only. There is no link from customer problems.

### 2.7 Expenses (`/expenses`; the expenses lane; rebuilds ExpensesScreen in `features/expenses`)
- **Header:** "Expenses"; subtitle "Running costs of vans and drivers. These never touch distributor wallets."; primary "Add expense"; secondary "Manage types".
- **Tabs:** Expenses · Driver fuel logs (read-only).
- **Filter bar:** This month (default) / Last month / Custom; Type; Van; Driver; "Show removed".
- **Totals** (`GET /expenses/summary`)
  - One card per type with its total and count. Archived types show only if they have rows in the range.
  - A muted card beside them: "Petrol · driver fuel logs {{amount}} ({{count}} log)" / other "… ({{count}} logs)".
  - A switch "Include driver fuel logs in totals", **off by default** to avoid counting a bill twice. On, it adds the fuel-log total to the grand total, labelled.
  - A month × type table below the cards for ranges longer than one month.
- **Table** (`GET /expenses`, Load more): Date · Type · Amount · Van · Driver · Note · Receipt (thumbnail) · By. Removed rows are struck through with the chip "Removed".
- **Add / edit drawer**
  - Date (DateInput, not after today's date in Pakistan; expenses have no 03:00 cut-off), Amount (MoneyInput), Type (Select of active types), Van (optional), Driver (optional).
  - **Note** (required, at most 200 characters; sent as `description`).
  - Receipt photo (optional: upload with purpose `EXPENSE_RECEIPT`, thumbnail, "Remove").
  - Primary "Save expense". Toast "Expense saved".
  - Errors: `EXPENSE_DATE_IN_FUTURE`, `EXPENSE_TYPE_ARCHIVED`, `AMOUNT_NOT_WHOLE_RUPEES`, `FILE_*`.
- **Remove expense…** (ConfirmDialog, danger, reason of at least 5 characters): "The expense stays in the activity log and is left out of totals." It is a void (`POST /expenses/:id/void`); `EXPENSE_ALREADY_VOIDED` refetches.
- **Manage types** drawer (`/expenses/types`)
  - A list with name, count and status, plus "Add type" (name, 2–40 characters).
  - Row actions: Rename, Archive or Restore. Petrol and Other show the lock "Can't be archived".
  - Errors: `EXPENSE_TYPE_NAME_TAKEN`, `EXPENSE_TYPE_LOCKED`. When the taken name belongs to an archived type in the list (same name ignoring case and spaces), the error reads "There's already an archived type called {{name}}. Restore it instead." with a Restore button on that row.
- **Driver fuel logs tab:** reuses `GET /reports/fuel-consumption` (FuelReportScreen.tsx:21). A per-van table (litres, cost, km, km/litre) with the logs inside; read-only. It and the fuel-log card show whichever way the Driver fuel logs switch is set (§2.8).
- **States**
  - Loading: skeleton cards and table.
  - Empty: "No expenses in this period" with "Add expense".
  - Error: ErrorState.
- **Removed:** legacy ExpensesScreen.tsx and FuelReportScreen.tsx, and the Fuel & km navigation item.
- **i18n namespace** `expenses`. Seeded type names are shown from their stored `name`.

### 2.8 Settings (`/settings`; admin-web-money): a fixed form, with no server-driven renderer
- **Layout:** a local menu at 1024 px and up (a Select below that). Each row has a label, a description, the control, and "Changed 21 Oct by Sana" or "Default".
- **Not on this page:** `auth.lockedRoles` (engineering changes it over the API with a reason; the change shows in Activity) and the reserved `auth.otpLogin.enabled`.

**Money**
| Key | Control | Description |
|---|---|---|
| `topup.minPaisa` / `topup.maxPaisa` | MoneyInput | "Smallest and largest single top-up." |
| `topup.onAmountMismatch` | RadioCards | "Bank amount differs from the request: add the bank amount (after a warning) / refuse, so the distributor makes a new request." |
| `topup.maxPendingPerDistributor` | number | none |
| `wallet.maxBalancePaisa` | MoneyInput; empty means no limit | "Highest balance top-ups may bring a wallet to. Office corrections aren't limited by it." |
| `wallet.lowBalancePaisa` | MoneyInput | "When the balance is below this (not equal to it), distributors see a low-balance warning. Rs 0 turns the warning off." |

**Orders and delivery**
| Key | Control | Description |
|---|---|---|
| `orders.deliveryStartedAt` | RadioCards: First load scan at the store (default) / Driver assigned / Van leaves the store | "After this point, cancelling an order returns nothing. A change applies at once to every order that hasn't started yet, including orders already placed." |
| `dispatch.autoAssign.enabled` | Switch | "When off, every new order waits for you to assign a driver. Keep off for the pilot." |
| `orders.maxCylindersPerOrder` | number | none |
| `refill.maxCylinders` | number | none |

**Refills**
- `refill.deliveryCost`: read-only "Off · waiting for the owner's decision".

**Modules**
- One Switch each: Store-to-store transfers · Driver fuel logs · Accessories · Support tickets · Customer app sign-in ("Customers confirm by link instead"). Driver fuel logs reads "Not used in the pilot: the driver app has no fuel-log screen. On, it only opens the drivers' own fuel-log routes; older logs always show in Expenses."
- A module that is off hides its navigation and routes, and the server refuses it. Driver fuel logs is the exception: it has no office screen to hide, and the Expenses fuel-log tab stays (§2.7).

**Company account** (read-only)
- Account name, bank, IBAN (with Copy).
- "Shown to distributors in the app. Changed only on the owner's written request; engineering makes the change and it's logged."

**Support**
- `support.phone`, `support.whatsApp`, `support.hours`, `topup.checkingHours`.

**App versions**
- `app.minVersion.driver`, `app.minVersion.distributor`: "Phones below this version must update. Raise only after the new app is on every phone."

**Saving**
- Unsaved changes show a sticky bar: one "{{count}} change not saved · Discard · Review and save" / other "{{count}} changes not saved · Discard · Review and save".
- A ConfirmDialog lists each change ("Top-up maximum: Rs 50,000 → Rs 75,000") and needs a reason.
- Then one `PATCH /settings/:key` per change, and the toast "Settings saved. The server uses them now; the apps show them within 5 minutes."
- Turning a module on gets its own confirm.
- Errors: `SETTING_INVALID_VALUE` (field), `SETTING_NOT_EDITABLE`.

### 2.9 Activity log (`/activity`; admin-web-money), plus a per-record ActivityList
- **Filters:** What (Money · Orders · Expenses · Settings · People), Who, Date.
- **Table:** When · Who · What happened · Why. Data from `GET /audit-logs`.

| Action | Sentence |
|---|---|
| `topup.approve` | "Approved top-up {{no}}: {{amount}} for {{distributor}} (bank ref {{ref}})" |
| `topup.reject` | "Rejected top-up {{no}} ({{reason}})" |
| `wallet.correction` | "{{direction}} {{amount}} for {{distributor}}: {{reason}}" |
| `wallet.check` | "Nightly wallet check: {{checked}} wallets checked, all match", or "Nightly wallet check: {{mismatches}} of {{checked}} wallets don't match their history" (actor shown as "System") |
| `price.set` / `price.remove` | "Set {{distributor}}'s price in {{zone}}: base {{base}}…" / "Removed {{distributor}}'s price in {{zone}}" |
| `zone.create` / `.update` / `.archive` / `.reactivate` | "Added zone {{zone}}" / "Changed zone {{zone}}" / "Archived zone {{zone}}" / "Reactivated zone {{zone}}" |
| `order.assign` / `order.reassign` | "Assigned {{no}} to {{driver}}" / "Moved {{no}} from {{from}} to {{to}}" |
| `order.cancel` | "Cancelled {{no}} · {{refund}} returned", or "Cancelled {{no}} · no refund" |
| `order.fail` / `order.manual_delivery` | "Marked {{no}} as could not deliver" / "Recorded delivery of {{no}} by office" |
| `trip.abort` | "Stopped {{driver}}'s trip: {{count}} orders need a driver again" (one order: "Stopped {{driver}}'s trip: 1 order needs a driver again") |
| `refill.create` / `refill.assign` | "{{distributor}} asked for a refill: {{count}} × {{size}}" / "Assigned {{distributor}}'s refill ({{count}} × {{size}}) to {{driver}}" |
| `refill.complete` / `refill.cancel` | "Marked {{distributor}}'s refill ({{count}} × {{size}}) complete" (System, Inc 3: "Refill {{no}} done: every cylinder is back") / "{{distributor}} cancelled a refill ({{count}} × {{size}})" |
| `expense.create` / `.update` / `.void` | "Added {{type}} expense {{amount}}" / "Edited …" / "Removed …" |
| `expense_type.*` | "Added, renamed, archived or restored expense type {{name}}" |
| `setting.update` | "Changed {{setting}} from {{from}} to {{to}}" |
| `driver.create` / `.update` / `.archive` / `.reactivate` | "Added driver {{name}}" / "Edited driver {{name}}" / "Archived driver {{name}}" / "Reactivated driver {{name}}" |
| `distributor.activate` | "Activated {{distributor}}", or "Reactivated {{distributor}}" when it was suspended |
| `distributor.*`, `user.*` | one sentence each |
| `confirmation.answer` | "Customer answered “{{answer}}” for {{no}}" |
| `confirmation.new_link` | "Made a new customer link for {{no}}" |
| `case.resolve` | "Marked the problem on {{no}} as sorted" |

An unknown action shows its code in words. System actors show as "System" and customer actors as "Customer" (the link label is never shown).

### 2.10 Login, session, role gate, environment (admin-web-ops)
- **Login:** no prefilled phone (LoginScreen.tsx:6), and a PhoneInput. Title "Smart Fleet · Office"; footer "Drivers and distributors use the Smart Fleet app."
  - Errors, all inline under the form and with no session started: `AUTH_INVALID_CREDENTIALS`, `AUTH_ACCOUNT_NOT_ACTIVE`, `AUTH_ROLE_LOCKED`, `AUTH_WRONG_APP` ("This account is for the Smart Fleet shop app." or "This account is for the Smart Fleet Driver app."), `RATE_LIMITED`. No message contains "OTP".
- **Role gate:** only SUPER_ADMIN. The server already refuses other roles at sign-in (`AUTH_WRONG_APP` or `AUTH_ROLE_LOCKED`), so this is a fallback: a saved session of any other role sees a full page: "This website is for office staff. Drivers and distributors use the Smart Fleet app." with Sign out.
- **Session:** silent refresh (§1.7). The idle sign-out stays at 30 minutes, with a toast at 28: "You'll be signed out in 2 minutes. Keep working to stay signed in." The sign-in page then says "You were signed out after 30 minutes without activity." This replaces the "10 minutes" alert at useIdleLogout.ts:25. The idle sign-out runs in the browser only: it deletes the tokens and returns to sign-in. The server ends a session only by token expiry (12-hour access, 30-day refresh) or a `tv` bump (API_CONTRACT §7.1).
- **EnvBadge** (`VITE_APP_ENV`):
  - test: "Test server — not real money" (info);
  - training: "Training — dummy bank details, no real money" (warning);
  - live: nothing.

  Non-live environments also prefix the tab title with "[TEST]".

### 2.11 Legacy cleanup (admin-web-ops)
- **Delete:** DeliveryOrdersScreen.tsx and PricingScreen.tsx.
- **Hide behind the module switches:** TransfersScreen (`features.transfers`), InventoryScreen's accessory tabs and the `accessories` route (App.tsx:48) (`features.accessories`). ReportsScreen has no switch: it is out of the navigation and opens only at `/reports`.
- **Refills** (`legacy/FillingOrdersScreen.tsx`), kept for Inc 1:
  - remove the admin "Place a filling order" form (:83-114), the cost column, and the cancel button (:61-64, :142-144);
  - "Complete + debit" becomes "Mark complete" with no money;
  - raw statuses become chips with the §4.1 stage words, without the counts (from the DTO's `stage`).
- **Refill stations** (`legacy/FillingStationsScreen.tsx`): hide the price field (:130, :178-179).
- **Kept inside the shell, as they are:** Drivers, Vans, Zones, Cylinders & labels, Live map, Alerts, Profile.
  - When one is touched, swap native dialogs for ConfirmDialog, emoji for lucide icons with text, and raw enums for StatusChip.

### 2.12 Inc 1 is done when
- **No system words:** no raw enum, UUID, "Rs." or "on hold" is visible on any Inc 1 screen. Check with the pseudo-locale and by reading the rendered text.
- **Top-up approval**
  - Approval is impossible without the reference, amount and time.
  - A used reference is refused at the field.
  - A double click, or a retry after a network drop, adds money once.
  - When two admins have the same request open, the second sees "already approved".
- **Delivery prices:** every active zone shows Set or Not set for each distributor. A missing price is flagged in text on Prices, Today and Distributors. Optional per-size amounts are hidden when 0.
- **Distributors:** a distributor can't be created without a store, and the store's zone comes from the pin.
- **Orders**
  - The assign dialog has no store picker and no Auto-dispatch.
  - Cancel shows the refund, or "no refund" with the reason, before confirming. "Could not deliver" is offered only after the start.
- **Wallets:** a wallet shows its balance and full history (no 200-row cap). A correction needs a reason and can't take more than the balance.
- **Expenses**
  - An expense can be added, edited and removed with a reason, and types can be added, renamed, archived and restored.
  - Totals by type and month match the list.
  - Fuel logs show beside Petrol and are excluded from totals by default.
- **Settings:** every change needs a reason and shows in Activity.
- **States:** every screen shows a skeleton, empty, error-with-retry and success. With the network off, failures are visible.
- **Layout:** works at 1024×768 and 768×1024, with no page-level sideways scrolling.
- **Build:** `tsc` fails on a missing i18n key. `npm run typecheck -w @smartfleet/admin-web` passes.

---

## 3. Increment 2

### 3.1 Orders board additions
- `LOADING` shows "Loading · 3 of 5 loaded". ON_THE_WAY starts when the driver taps "Done loading" (in Inc 1, when the van leaves the store stop).
- When `confirmation.enabled`, delivered rows get an **answer chip**:

  | Answer | Chip |
  |---|---|
  | Yes | "Customer: all received" (success) |
  | Partly | "Customer: partly received" (warning) |
  | No | "Customer: not received" (danger) |
  | Other | "Customer sent a note" (warning) |
  | Pending | "Waiting for customer" (neutral) |
  | Expired | "No answer" (neutral) |

- The answer is never a stage, and nothing on the board changes money after placement.

### 3.2 Order drawer additions
- "Loaded at store: 2 of 2 · 10:42 by Imran".
- "Handed over": one row per cylinder (number, size, time).
- "Taken back": Empty / Part-filled / Full lists, with "Unlabelled: 1 × 11.8 kg" and "Expected back: 2".
- "Responsible driver: Imran (last scanned it onto a van)" (`cylinders.responsible`); in a store, or when there is none: "Responsible driver: none" (`cylinders.responsibleNone`).
- **Customer answer** (only when enabled): the chip, time and comment, plus the link status in the CUSTOMER_PAGE §8 words ("Not sent" · "Not sent — text messages are off" · "Sending text…" · "Text sent 10:58" · "Text didn't send — the number looks wrong" · "Shared 11:00 by Ops (copied)"; once closed "Answered 11:20" or "Expired").
  - "Copy customer link" (`POST /orders/:id/confirmation/share {via:'COPY'}`) copies it, with the toast "Link copied. Send it to the customer by WhatsApp or SMS." If the clipboard is blocked, the link shows in a selectable field.

### 3.3 Customer problems (`/problems`; cases)
- **Table** (`GET /alerts?type=CUSTOMER_PROBLEM&status=OPEN`, open cases, oldest first): Order · Answer · Customer's note · Customer · Since · Distributor (priority 3).
- **Empty:** "No customer problems" / "When a customer reports a problem on their delivery link, it shows up here."
- **Action:** "Mark as sorted", with a note of 5–300 characters (`POST /alerts/:id/resolve`). It is the only action: **no money, no charge or return choice, no correction link.** Toast "Problem on {{no}} marked as sorted."
- `CASE_ALREADY_RESOLVED` shows "This case was already closed by {{by}}." and refetches; a repeat of your own close (`X-Already-Applied`) counts as success. Could-not-deliver is a stage, not a case.

### 3.4 Manual delivery naming cylinders (the forgotten-IN rule)
- **Where:** in the drawer, More → "Record manual delivery…", while Driver assigned, Loading or On the way. A 640 px modal.
- **Info:** "Use this when the driver can't scan at the door, for example a cylinder that wasn't scanned IN at the store. It's logged as an office exception with your name."
- **Cylinders handed over:** a mono input "Type or scan the cylinder number, then press Enter" (a USB scanner works as a keyboard).
  - Each number (any API_CONTRACT §1.1 form of this order's distributor, such as 42, C0042 or AG-C0042, or a scanned label) becomes a chip: "AG-C0042 · 11.8 kg ✓", or an error chip such as "AG-C0099 — with another customer". A typed short number is written out in full with the order's distributor code (`formatNo`). The chip is checked with `GET /cylinders/:code/history` as it is entered, and again from `details.problems` after a refusal: "— another shop's cylinder" (WRONG_OWNER), "— not full" (NOT_FULL), "— marked damaged or lost" (BLOCKED), "— this order doesn't need {{size}}" (WRONG_SIZE), "— with another customer" or "— on a van, not loaded for this order's trip" (NOT_AVAILABLE, by `holderType` CLIENT or VEHICLE), "— not with this customer" (NOT_WITH_THIS_CUSTOMER) and "— listed twice" (LISTED_TWICE). An unknown number shows "— we don't know this number".
  - Progress: "2 of 2 entered (11.8 kg)".
- **Taken back (optional):** the same input, with Empty / Part-filled / Full on each. They go onto the driver's van, and the shop scans them in as usual.
- **Reason:** Not scanned IN at the store · Driver's phone not working · Other.
- **Confirm** "Record delivery". Toast "Delivery recorded for AG-0142. Cylinders moved to the customer." **No money moves.**
- **Errors:** `MANUAL_DELIVERY_CYLINDERS_MISMATCH`, `SCAN_CYLINDER_UNKNOWN`, `ORDER_INVALID_TRANSITION`.

### 3.5 Find cylinder (`/cylinders/find/$number`)
- Number, size, owner and state, plus the holder now ("With customer Bilal (AG-0142) since 10:58") and the responsible driver, in the words of the order drawer (§3.2).
- History in plain words (`GET /cylinders/:code/history`):

  | Event | Shown as (`cylinders.history.*`) |
  |---|---|
  | REGISTERED | "Added to {{store}} as a new cylinder ({{state}})" |
  | SCAN_OUT on a trip | "Loaded onto van {{plate}} at {{store}}" ("Loaded onto van LEA-1234 at Ali Gas store") |
  | SCAN_OUT for a refill | "Picked up for refill {{refill}} onto van {{plate}}" |
  | DELIVERED | "Handed to {{customer}} ({{order}})" ("Handed to Bilal (AG-0142)") |
  | PICKED_UP_EMPTY | "Taken back from {{customer}} · {{state}}" ("Taken back from Bilal · empty") |
  | FILLED | "Filled at {{station}} for refill {{refill}}" |
  | SCAN_IN | "Scanned into {{store}}" |
  | SCAN_IN that closes a refill line | "Back from refill {{refill}} into {{store}}", plus " · now full" when it was filled |
  | ADJUSTED | "Fixed at day-end {{date}} (approved by {{name}})" |
  | RETURNED_TO_DISTRIBUTOR, TRANSFER, MARK_FAULTY, MARK_LOST | "Older record (before the pilot)" |

  Source TYPED adds " · number typed in"; source MANUAL adds " · recorded by the office: {{reason}}"; a REGISTERED event from day-end adds " · from the day-end sheet". {{state}} is full, empty, part-filled, damaged or lost. Each line also shows who and when.

### 3.6 Settings added in Inc 2 (Customer messages, Scans)
- `confirmation.enabled`: Switch, "Ask customers to confirm deliveries by link. A record only; it never changes money."
- `confirmation.caseOnAnswers`: checkboxes Not received · Other · Partly.
- `confirmation.linkTtlHours`: number.
- `messaging.testMode`: "Send real texts only to the team phones", plus `messaging.allowlist` as a phone list.
- `custody.typedEntry.enabled`; `trip.allowFinishWithLeftovers`.
- `custody.forgottenInPolicy`: read-only, "Block the hand-over; the office records a manual delivery naming the cylinders."

### 3.7 Other Inc 2 changes
- **Vans:** on `VEHICLE_HAS_CYLINDERS` show one "{{plateNo}} still has {{count}} cylinder on it. Unload at the store before changing the driver." / other "{{plateNo}} still has {{count}} cylinders on it. Unload at the store before changing the driver."
- **Alerts:** a `VAN_NOT_EMPTY` alert reads "{{plate}} still has cylinders on it ({{count}})", plus "Reason: {{reason}}" when the driver gave one. Resolve it once the shop has scanned them in.
- **Live map:** copy only ("No signal for 5 min").

---

## 4. Increment 3

### 4.1 Refill requests (`/refills`, drawer `/refills/$id`; rebuilt; no money)
- **Tabs:** Needs a driver · In progress · Done · Cancelled (Needs a driver = NEEDS_DRIVER; In progress = DRIVER_ASSIGNED to BACK_AT_STORE; Done = DONE; Cancelled = CANCELLED).
- **Table:** Refill (AG-R007) · Stage with progress · Distributor · Station · Cylinders ("30 × 11.8 kg") · Driver (or "Assign driver") · Requested.
- **Stages** (`RefillStage`, API_CONTRACT §1.4):

  | Stage | Words |
  |---|---|
  | NEEDS_DRIVER | Needs a driver |
  | DRIVER_ASSIGNED | Driver assigned |
  | PICKING_UP | Picking up empties · {{picked}} of {{requested}} |
  | PICKED_UP | Empties picked up · {{picked}} of {{requested}} |
  | AT_STATION | At the station |
  | COMING_BACK | Filled · {{filled}} of {{picked}} |
  | BACK_AT_STORE | Back at store · {{received}} of {{picked}} scanned in |
  | DONE | Done; "Done · {{filled}} of {{picked}} filled" when fewer were filled than picked |
  | CANCELLED | Cancelled |

- **Drawer:** a stepper with counts and the scan list. The primary "Assign driver" reuses the orders dialog.
- There is no office cancel or fail ("Only Ali Gas can cancel, before pickup") and no fee lines.

### 4.2 Refill stations (`/stations`)
Name, address, location and active. **No prices** (DECISIONS ADR-16).

### 4.3 Day-end approvals (`/day-end`, `/day-end/$dayEndId`)
- **List**
  - Tabs: To approve · Open · Locked.
  - Columns: Day · Distributor · Status · Differences · Sheet ("Uploaded 8:40 am by Ali Raza") · Review.
  - Status words from `stage` (API_CONTRACT §1.4): NOT_STARTED "Waiting for sheet" · READY "Sheet uploaded, not sent" · SENT_BACK "Sent back" · WAITING_FOR_APPROVAL "Ready to approve" · APPROVED "Approved · locked". Tabs by status: To approve = SUBMITTED; Open = OPEN; Locked = APPROVED. A day the shop never downloaded a sheet for has no row and isn't listed.
- **Review page**
  - "Ali Gas · Wed 21 Oct", "Sheet version 2 · uploaded 8:40 am".
  - Primary one "Approve {{count}} fix and lock the day" / other "Approve {{count}} fixes and lock the day" (`POST /admin/day-end/:id/approve {version}`). Secondary "Send back…" (a reason of 5–300 characters is required).
  - Links: "Download the uploaded sheet" (`files.uploadFileId`) and "Download the app's sheet" (`files.sheetFileId`, the sheet the upload was filled from), each through `GET /files/:id/url`; a link is hidden while its id is null.
  - Stats: In store · On vans · With customers · Differences.
  - Info: "Nothing changes until you approve. Each fix is saved with its reason, who asked and who approved."
- **Differences table:** Cylinder · App says · Sheet says · Last scan · Fix · Note.

  | Diff | Words |
  |---|---|
  | PLACE_DIFFERS | In a different place |
  | STATE_DIFFERS | State differs |
  | PLACE_AND_STATE_DIFFER | Place and state differ |
  | UNKNOWN_CYLINDER | Number not in the app → "Add to Ali Gas store as a new cylinder" |

  A row that moved after the sheet shows "Will be skipped: moved since the sheet".
  The Fix column: MOVE_TO_STORE "Move to {{store}}" (plus " and set to {{state}}" when the sheet gives a state) · SET_STATE "Set to {{state}}" · MARK_LOST "Mark as lost" · REGISTER "Add to {{store}} as a new cylinder" · NOTE_ONLY "Not changed: check it by hand". "App says" adds " · {{plate}}" or " · {{customer}}". The approve button's count is `fixesToApply`.
- **Approve** (ConfirmDialog): one "Approve {{count}} fix and lock {{day}}? Later changes need a reopen." / other "Approve {{count}} fixes and lock {{day}}? Later changes need a reopen." `DAY_VERSION_CHANGED`: "Ali Gas uploaded a new version at 8:52 am." with "Load the new version".
- **Locked view:** read-only. "Reopen…" needs a reason (5–300 characters). After an approval that registered cylinders: "{{count}} new cylinder added. Print its label from Cylinders & labels." / "{{count}} new cylinders added. Print their labels from Cylinders & labels."

### 4.4 Settings and Today in Inc 3
- **Settings:** `dayEnd.enabled`; `day.cutoffLocalTime` (a Select of whole hours from 00:00 to 06:00), described as "When a new business day starts. Change it only between days, when no day-end is waiting."
- **Today:** cards "Day-end ready to approve" and "Refills need a driver".

---

## 5. Web effort and cut list
| Part | Days |
|---|---|
| Foundations: tokens, about 20 components, router and shell, i18n and formatting, API client | 5–7 |
| Inc 1: Today 1 · Top-ups 2.5 · Prices 2 · Distributors 2.5–3 · Orders and dialogs 3–4 · Wallets and correction 2 · **Expenses 3–4** · Settings 1.5 · Activity 0.5 · Login and cleanup 1–1.5 | 19–22 |
| Inc 2: board stages and drawer scans 2–3 · problems (record only) 1 · manual delivery 1–1.5 · cylinder drawer 1 · settings 0.5 | 5.5–7 |
| Inc 3: refills (no money) 1.5–2 · stations 0.5 · day-end 3–4 · Today 0.5 | 5.5–7 |

**Cut list if the budget is tight:**
- the Activity page (keep the per-record lists);
- the CSV statement (keep print);
- "Remove price";
- the month × type table (keep the type cards);
- the pseudo-locale.

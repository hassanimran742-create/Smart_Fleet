# Admin web UX (super admin, "the office")

- **Users:** the two named SUPER_ADMIN logins (the owner and one operations person), on a laptop and sometimes a tablet.
- **Stack:** `apps/admin-web` (React 18, Vite, TanStack Query, Zustand).
- **Routes and payloads** come from API_CONTRACT.md. This doc owns screens, states, copy and the web design system.
- **UX_PRINCIPLES.md** (the rulebook) wins on look, layout, choice of control, copy and screen states; this doc wins on behaviour, money and safety. The simple-UX pass of 2026-10-23 applied it to every Inc 1 screen (§1.3–§2), and §3–§4 are designed to it.

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
| `/topups?tab=&q=` and `/topups/$paymentId` | Top-ups and the review drawer | 1 |
| `/wallets` and `/wallets/$distributorId` | Wallets list and wallet page | 1 |
| `/prices/$distributorId` and `/prices/$distributorId/$zoneId` | Delivery prices and price drawer (`/prices` redirects to the first distributor) | 1 |
| `/distributors`, `/distributors/new`, `/distributors/$id` | Distributors | 1 |
| `/expenses?tab=expenses\|fuel-logs&from&to&type&van&driver` and `/expenses/types` | Expenses and types drawer | 1 |
| `/settings?section=`, `/activity` | Settings (sections `money`, `orders`, `modules` shown as Features, `support`, `account`, `versions` shown as Tech team; `?section=refills` opens Orders and delivery) and the Activity log | 1 |
| `/refills`, `/stations` | Refills and Refill stations: the legacy screens with the 2026-10-23 light pass (§2.11) | 1 → rebuilt in 3 |
| `/drivers`, `/vans`, `/zones`, `/cylinders`, `/live`, `/alerts`, `/profile` | Legacy screens inside the shell | 1 |
| `/reports` | Legacy reports screen: not in the navigation, reachable only by its address | 1 |
| `/problems` | Customer problems (cases) | 2 |
| `/cylinders/find/$number` (`AG-C0042` or the QR value) | Cylinder drawer | 2 |
| `/day-end`, `/day-end/$dayEndId` | Day-end approvals | 3 |

A switched-off module's route shows EmptyState "{{module}} is switched off" / "Turn it on in Settings." with the action "Open settings" (`/settings?section=modules`). Any unknown path shows the not-found page, with no page header: "We couldn't find this page" / "The link may be old or mistyped." with "Go to Today". After signing in, the website returns to the address that was open.

### 1.3 Shell and navigation
Rebuilt to UX_PRINCIPLES on 2026-10-23 (the website spec §1.1, with the lead's DECIDED answers). **The labels always show:** the sidebar is 232 px from 1280 px and the same labelled sidebar at 200 px from 1024 to 1279 px. The 64 px icon rail and its hover tooltips are retired.

**Groups** (lucide icons, with i18n labels):
- **Today** (badge: top-ups to check + orders needing a driver, plus open customer problems from Inc 2). The lead **kept** this badge on 2026-10-23 (people know unread badges from WhatsApp); it is the same number as the browser tab's "(n)".
- **Work:** Orders (badge: orders needing a driver), Top-ups (badge: to check), Refills, Alerts (badge: new); then Customer problems (Inc 2, MessageSquareWarning, badge: open problems) and Day-end (Inc 3, FileSpreadsheet, badge).
- **Money:** Wallets, Delivery prices, **Expenses**.
- **Setup** (the website never says "shop" in its own labels; "Shops and fleet" was dropped): Distributors, Drivers, Vans, Cylinders & labels, Refill stations, Zones, Live map, plus a feature's item while its switch is on. Its heading is a toggle (`aria-expanded`): open by default on windows at least 860 px tall and closed below that, the person's choice remembered in `localStorage`, and always open on a page inside it. With Setup closed, the whole menu fits a 768 px laptop screen with no scrolling.
- **Pinned** above the account row: Settings, Activity log.
- **Footer:** one account row (an icon, the name and a chevron; a fixed-width skeleton while the name loads) that opens My profile and Sign out.

The System group is gone, and so are the top-right user menu and the footer block "Owner / Super admin / My profile / Sign out". The nav list scrolls inside the sidebar (UXQ-017), with a 24 px fade made from `--nav-bg` at its bottom edge while more is below. A menu link reopens the last tab and filters used (`sessionStorage`), except that the queue pages (Top-ups, Orders) open on their work tab whenever it has items.

**Removed from navigation:**
- Stores (each store lives under its distributor)
- Inventory roll plan (transfers)
- Fuel & km (folded into Expenses as a tab)
- Reports (the API stays; the legacy page is reachable only by its address, `/reports`)
- Accessories
- The Pricing placeholder

**Top bar and title**
- From 1024 px there is **no top bar and no breadcrumb**; a sub-page shows a back link in its page header ("← Wallets", "← Distributors", from the route's parent). Below 1024 px the 56 px top bar holds the menu button, the page title and the account menu. Find cylinder (Inc 2) is a search box at the top of the sidebar.
- The environment strip uses the build setting, else the server's environment remembered from an earlier visit. It keeps its 32 px while loading, so the page doesn't jump, and it stays when the server is down (§2.10).
- The browser tab title carries the waiting count, the same number as the Today badge (top-ups to check + orders needing a driver, plus open customer problems from Inc 2; missing prices and distributors waiting to start are Today cards only, so the count reaches 0 when nothing waits): "(5) Top-ups · Smart Fleet Office".
- The product name is **"Smart Fleet Office"** (index.html:7, Sidebar.tsx:51).

**Layout by width**
| Width | Navigation | Content | Drawers | Tables |
|---|---|---|---|---|
| ≥1280 | Sidebar 232 px with labels | Padding 24/32, max width 1360 | Side panel 480 px (wide 640) | All columns |
| 1024–1279 | Sidebar 200 px with labels (no icon rail, no tooltips) | Padding 20/24 | Side panel | Hide priority-3 columns |
| 768–1023 | The menu button in the 56 px top bar opens a 280 px overlay | Padding 16 | Full-screen sheet | Hide priority 2 and 3 (they are always in the drawer); a sticky first column |
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
The rulebook's new pieces (FilterChips, DateChips, AddMore, SearchSelect) and the fixes below were built on 2026-10-23; every fix keeps the component's look, and `tokens.css` is unchanged.

**Actions and headers**
- **Button** `{variant:'primary'|'secondary'|'ghost'|'danger'|'ghost-danger', size:'md'|'lg', loading?, disabled?, disabledReason?, reasonVisible?, icon?}`
  - Keeps its width while loading. `disabledReason` shows as a tooltip and through `aria-describedby`; with `reasonVisible` it also shows as muted text beside the button.
  - **A form's main button stays enabled and points at what is missing:** pressed with a gap, each empty field shows its one-line error ("Type the business name.") and the first one gets the focus. It is disabled only when nothing on the screen can fix it (a history that doesn't add up, a setting that refuses a different amount, an unfinished checklist, a save in progress), and then shows its reason (`reasonVisible`).
  - A label is a verb and its thing, 3 words at most, with the amount after "·"; a button that opens a dialog ends with "…".
  - At most one primary per screen.
  - **IconButton** requires a `label`.
- **PageHeader** `{title, subtitle?, meta?, back?, primaryAction?, secondaryActions?, updatedAt?, onRefresh?}`: the title, chip, freshness and actions share one row. A sub-page shows the back link (`back`, or the route's `staticData.parent`). "Updated 12 s ago ⟳" shows only when the page passes `updatedAt`: Today, Top-ups and Orders (and Inc 2's Customer problems).
- **Tabs** `{items:[{id,label,count?}], value, onChange, countPending?}`, synced to `?tab=`.
- **FilterBar:** search (300 ms debounce; the `/` key focuses it), chips, and date presets as chips (Today, Last 7 days, This month, Last month, Custom; `DateRangeFilter`).
- **FilterChips** (NEW): a single-select (`radiogroup`) or multi-toggle chip group for 2–6 options, with a tick on the picked chip and an optional count or tone meta; it wraps, never scrolls sideways. **ToggleChip** is the one-chip "Show …" toggle ("Show suspended", "Show removed", "Show archived"), never a Switch printed "Off".
- **DateChips** (NEW): Today · Yesterday · Pick date (the browser calendar), with min and max. The expense date defaults to Today; the top-up bank date has no default.
- **AddMore** (NEW): the "+ Add …" ghost button that shows optional fields in place and stays open, and a `toggle` variant with a chevron for "Activity (n)".
- **SearchSelect** (NEW): a combobox (a search box over a listbox): ↑ ↓ Enter Esc, the first 8 shown before typing, "No matches", single or multiple picks, and a clear row. For 7+ options that change, or more than 15: the distributor filter (more than 6), the store area finder, the correction's linked record, Activity "Who" (more than 15), and the driver search in the assign dialog (more than 6).

**Data**
- **Table** `Table<T>` `{caption, columns:[{id, header, cell(row), align?, priority?:1|2|3, width?, sticky?}], rows, rowKey, onRowClick?, canOpenRow?, chevron?, groupBy?, highlightKey?, rowTone?(row), state:'loading'|'error'|'ready', empty, error, footer}`
  - A semantic `<table>` with a hidden caption. The whole row is focusable, and Enter opens it.
  - A row that opens a drawer or page ends with a muted chevron (`chevron`, boolean or per row), unless it has an action button.
  - `groupBy` adds day header rows ("Today", "Thu 22 Oct") to event lists, whose When column then shows only the time.
  - `highlightKey` with `flashRow(scope, id)` / `useFlashedRow` / `useHighlight` gives a changed row the 2-second `--primary-soft` tint (static; none under reduced motion).
  - No header row when the table is empty or failing: the EmptyState or ErrorState fills the card.
  - Loading shows 5 skeleton rows. `rowTone` adds a 4 px border on the start edge, always paired with a text chip. The footer has "Load more" (cursor pages).
  - Order and top-up numbers (AG-0004, AG-T003) are in the normal font, semibold, with tabular figures (`.sf-record-no`). The code font stays for the bank reference and the transaction ID.
- **StatusChip** `{kind, value}`: a 24 px pill with an icon and the label from `status:<kind>.<VALUE>`. The tones and words follow UX_PRINCIPLES §4. `STATUS_ICONS` gives the blue chips the action's icon (UserRoundCheck for driver assigned, Store for loading and back at store, Truck for on the way and coming back, Cylinder at the station), and amber states that aren't waiting their own icon (Wrench, CalendarOff, TriangleAlert): the clock means waiting only. An unknown value shows "Unknown" and logs once.
- **MoneyText** `{paisa, signed?, tone?:'auto'|'none', size?}`. `null` shows "—"; `auto` colours the sign.
- **FeeChip** `{amountPaisa, status}`:

  | Status | Chip |
  |---|---|
  | `DEDUCTED` | "Rs 330 paid" (neutral, wallet icon) |
  | `REVERSED` | "Rs 330 returned" (success) |
  | `NONE` | "No delivery cost" |

  It never says "on hold".

**Forms**
- **MoneyInput** `{valuePaisa, onChange, min?, max?, allowZero?}`
  - "Rs" prefix, `inputMode=numeric`, digits and commas only. A typed decimal ("275.50") stays visible with "Whole rupees only" until it is fixed; the box is never emptied on blur.
  - Adds separators on blur and returns a paisa string.
- **Field** `{label, hint?, error?, optional?}`; **TextInput**; **Textarea** (its counter shows from 80% of the limit); **Select** (native); **Switch** (shows "On"/"Off"); **RadioCards** (large cards; arrow keys move; often 2 columns).
- **DateInput**; **DateTimeInput**: DateChips plus a `type="time"` box (step 60), rendering its own "Date" and "Time" fields. It still returns one ISO instant at +05:00 and keeps its `max`.
- **PhoneInput**: "+92" fixed before the box, the placeholder "300 1234567"; a typed 0, +92 or 0092 is dropped as it is typed; the value is still E.164 (`normalizePkPhone`). Read-only text shows `formatPkPhone(phone, 'international')`, "+92 300 1234567", the form the website uses for every phone.
- **useZodForm(schema, initial)**, about 60 lines, no form library:
  - validates on blur and on submit; zod messages are i18n keys; a required field's error says what to type (website keys per field; the shared `REQUIRED` stays for the phone apps);
  - `setServerError(apiError)` places `details.fields` errors under the right field.

  Schemas come from `packages/shared-validation`.
- Helpers only where one prevents a costly mistake, one line of 8 words or fewer. Placeholders never look like a saved value: examples start with "For example".

**Overlays and feedback**
- **Drawer** `{title, subtitle?, chip?, width:'md'|'lg', dirty?, footer, onClose}`
  - A dialog that traps and restores focus. Esc closes it, asking "Discard changes?" when dirty. The first focus is the first form field, else the drawer itself.
  - A sticky footer: the destructive action at the start (`ghost-danger`, its label ending in "…"), then the others, and the one primary at the end. **At most 4 buttons**, wrapping to a second row rather than scrolling; "More" only from 5, and never with one item (a dev warning above 4). **No Cancel button:** × and Esc close the drawer.
  - Activity is collapsed: "Activity (n)", or "Activity (10+)" while older entries are still to load.
  - The title uses the record's name from the row while loading ("Order AG-0004"), never a bare "Order".
  - Open record drawers re-poll every 10 seconds. If someone else changed the record, an InlineAlert appears and the form locks.
- **Modal** (440/560 px; a bottom sheet under 768 px). **ConfirmDialog / useConfirm()**:
  ```
  confirm({title, facts?, points?, body?, tone, confirmLabel, cancelLabel='Go back', reason?:{label='Why?', required, minLength, options?, optionColumns?, noteFor?}, action?}) → Promise<{ok, reason?}>
  ```
  - The facts come first (`KeyValueList`, or `points`, a short bulleted list), then a body of 12 words or fewer, then any reason. The default focus is "Go back". The confirm label is a verb plus the amount or object.
  - Reason cards can sit in 2 columns (`optionColumns`); `noteFor` opens the note only for the listed options (Other). Pressed with no reason, "Pick a reason." shows under the cards.
  - With `action`, the dialog stays open with a spinner and shows errors inline. **Never a dialog on top of a dialog:** a confirmation is step 2 of the same dialog (the wallet correction).
  - It replaces every `window.confirm` and `window.prompt`.
- **Toast / useToast()**: at the **top centre**, moved clear of an open drawer; success stays 6 seconds, pauses on hover or focus, and × closes it; an error toast stays until closed. Toasts confirm finished actions in 6 words or fewer; form errors stay inline.
- **EmptyState**: an icon, one line of 8 words or fewer, and at most one button. **ErrorState** `{error, onRetry, title}`: the page's own title ("Couldn't load the orders"), the cause and Try again; "Reference: 7f3a2c" (the request ID) as text plus a copy icon **only when the server answered**, never for no connection or a timeout. **StaleBanner** (§1.9): "No connection." from the first failed refresh while the browser is offline, or "Not updated since {{time}}." after 2 failed refreshes, each with Try again. **InlineAlert** (with a `neutral` tone and an `icon`), **Skeleton**, **Spinner**.
- **KeyValueList** (`stacked`: the label above the value, for narrow columns; `compact`), **Timeline**, **ActivityList** `{resourceType, resourceId}` (sentences from §2.9; collapsed by default), **WaitTime** `{since, warnAfterMin}`, **EnvBadge**, **CopyButton** (falls back to a selectable input; `iconOnly`).
- Shared by the ops pages: **MoreMenu** has `dividerBefore` (a divider before an item, such as Suspend…) and `size: 'sm'` (table rows); **StoreMapPicker** draws the zone outlines with their names (from `GET /zones/city/:cityId`, which sends each zone's `polygon` and `centroid` as GeoJSON, typed `ZoneListRow`), fits the map to the zones, shows the other stores as grey dots, and offers "Find area" (a SearchSelect over every city's areas) and "Pin at map centre".

### 1.6 i18n and formatting
- **Libraries:** i18next 23 and react-i18next 14, as the mobile app uses. Add them to `apps/admin-web/package.json`; they are already in the monorepo's node_modules.
- **Namespaces**
  - foundation: `common`, `nav`, `status`, `errors` (= `ERROR_MESSAGE_EN`), `validation`;
  - lanes: `today`, `orders`, `distributors`, `auth`, `topups`, `wallets`, `prices`, `settings`, `activity`, `expenses`, and `legacy` (the light pass, §2.11);
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
| First load | A skeleton in the final layout. The env strip, nav badges, tab counts and the account name keep fixed-size space, so nothing jumps |
| Refreshing | Keep the data. "Updated …" only on Today, Top-ups and Orders. While offline, the banner "No connection." at the first failed refresh; after 2 failed refreshes with the network on, "Not updated since {{time}}."; both with Try again. While it shows, an "All caught up." line reads "Nothing waiting at {{time}}." |
| Empty | An icon, one line of 8 words or fewer, at most one button. No developer text and no "This list refreshes every 20 seconds." Empty because of filters: one line and [Clear filters]; a search with no result: "No … match “q”", "Only {{tab}} was searched." and [Clear search] |
| Error | ErrorState with the page's own title, the cause and "Try again"; the reference only when the server answered. A page that had data keeps it and shows the banner instead: no page looks empty because of an error |
| Submitting | A button spinner; values kept; a double submit is impossible |
| Failed submit | An inline error at the field (`details.fields`) or at the top. "Try again" reuses the same key |
| Success | The dialog closes, a toast at the top centre states the result (6 seconds, paused on hover), the list updates, the changed row is tinted for 2 seconds, and focus returns to the row |

---

## 2. Increment 1 screens
Rebuilt to UX_PRINCIPLES on 2026-10-23 (the website spec W01–W49, with the lead's DECIDED answers). Behaviour, routes, API calls, idempotency keys, `allowedActions`, permissions and the money rules are unchanged, and every note the server requires stays required.

### 2.1 Today (`/today`; admin-web-ops; replaces DashboardScreen)
- **Header:** "Today · Fri 23 Oct" with "Updated just now ⟳" at the end of the row. The data comes from `GET /admin/summary` (every 20 seconds), which also feeds the navigation badges.
- **"Needs you" cards** in one row (4 columns from 1280 px, 2 at 1024–1279, 1 below 768). Only cards with a count above 0 show, in this order: Top-ups, Orders, (Inc 2) Customer problems, (Inc 3) Refills, (Inc 3) Day-end, Prices, Distributors. Each card uses the existing surface, with no coloured start edge, and holds its page's menu icon, the count in `--fs-28` bold, a 1–4-word label, one muted detail line, and one **secondary** button across its foot; the whole card is a link. The page has no primary.

  | Card | Count + label | Detail line | Button → where |
  |---|---|---|---|
  | Top-ups | "{{count}} top-up to check" / "top-ups to check" | "Oldest {{wait}}"; from 60 min it turns warning, with TriangleAlert | Check top-ups → `/topups?tab=to-check` |
  | Orders | "{{count}} order needs a driver" / "orders need a driver" | "Oldest {{wait}}" | Assign drivers → `/orders?tab=needs-driver` |
  | Customer problems (Inc 2) | "{{count}} customer problem(s)" | "Oldest {{wait}}" | Check problems → `/problems` |
  | Refills (Inc 3) | "{{count}} refill needs a driver" / "refills need a driver" | "Oldest {{wait}}" | Assign drivers → `/refills?tab=needs-driver` |
  | Day-end (Inc 3) | "{{count}} day-end to approve" / "day-ends to approve" | "Ahmed Gas · Thu 22 Oct" for one; "Oldest Thu 22 Oct" for more | Review day-end → `/day-end?tab=to-approve` |
  | Prices | "{{count}} zone has no price" / "zones have no price" (the sum of `prices.missing[].zones`, active distributors only) | up to 3 "Name n" items joined by " · ", then "+n more" ("Ahmed Gas 1 · Bilal Gas 2") | Set prices → `/prices/{the distributor with the most missing zones}?missing=true` |
  | Distributors | "{{count}} distributor to activate" | up to 2 names, then "+1 more" | Finish setup → that distributor, or `/distributors` for more |

  One Prices card replaces the old card per distributor; a distributor waiting to start shows only in the Distributors card.
- **All clear** (no cards): one line with a green CircleCheck, "All caught up." While stale: "Nothing waiting at {{time}}.".
- **"Today so far":** 5 small tiles: Orders placed · Delivered · **Delivery costs** (`costTakenTodayPaisa`: deductions minus returns) · Top-ups approved (with a muted "{{n}} top-ups") · Drivers on duty "{{n}} of {{total}}" (a link to `/drivers`).
- **States:** 4 skeleton cards and 5 skeleton tiles; a first-load error "Couldn't load today's figures" with Try again; offline or stale, the banner with the last figures kept.

### 2.2 Top-ups (`/topups`, drawer `/topups/$paymentId`; admin-web-money; evolves PaymentsScreen)
- **Header:** "Top-ups"; subtitle "Approve only after you see the money in the company bank app."; meta "Approved today: {{amount}} · {{count}} top-up(s)"; "Updated just now ⟳".
- **Tabs:** To check (n) · Approved · Rejected · All. **Search:** "Name, transaction ID or bank reference" (the top-up number and the amount still match). The data is `GET /admin/topups`. The menu link opens To check whenever it has items.
- **Tables** (a chevron on rows that open; to-check rows end with a Review button):

  | Tab | Columns |
  |---|---|
  | To check (oldest first) | Waiting (WaitTime, warning from 60 min) · Distributor · Amount (end) · Paid from "Ahmed Raza · Easypaisa" (P2) · Transaction ID (code font, P2) · [Review] |
  | Approved | Approved · Distributor · Added (a muted "Asked Rs 10,000" line when the amounts differed) · Bank reference · By (P3) · chevron |
  | Rejected | Rejected · Distributor · Amount · Reason · By (P3) · chevron |
  | All | Sent · Distributor · Amount · Status · [Review] on to-check rows, else a chevron |

  The Screenshot column is gone (the drawer shows the picture).
- **Empty:** one line per tab: "No top-ups to check" (CircleCheck), "No approved top-ups yet", "No rejected top-ups", "No top-ups yet". A search with no result: "No top-ups match “q”", "Only To check was searched.", [Clear search].

**Review drawer** (`lg`, 640 px; two columns from about 600 px of drawer width, else one, the left part first)
- **Header:** "{{distributor}} · {{amount}}" with the chip "To check"; "AG-T031 · sent 4:12 pm · waiting 12 min".
- **Left, "From Ahmed Gas"** (KeyValueList, stacked): Amount (20 px bold), Paid from, Paid with, Transaction ID (code font, with a copy icon), Screenshot (a thumbnail that opens ProofViewer, or "—").
- **Right, "In the company bank app":** the line "Never copy from the screenshot or WhatsApp."; the account line "{{accountTitle}} · {{bankName}} · ending {{last4}}" (or "The company account isn't set. Ask the tech team."); then the four fields in the bank app's order:
  - **Bank reference** (code font, required, the first focus): "Each reference can be used once.";
  - **Amount** (MoneyInput, required, **not prefilled**: the office types what the bank shows);
  - **Date**: DateChips Today · Yesterday · Pick date, **no default** (one deliberate tap);
  - **Time** (`type="time"`, no default). Date and time give one ISO instant at +05:00, at most 5 minutes ahead.
- **The check line** across both columns, once the amount is typed: "Amounts match" (CircleCheck); with `topup.onAmountMismatch = CREDIT_BANK_AMOUNT` a warning "The bank shows Rs 9,500, not Rs 10,000. Only Rs 9,500 will be added." (the main button follows the bank amount); with `REJECT` a danger line "Amounts must match. Reject and ask for a new request." (the catalogue's `TOPUP_AMOUNT_MISMATCH` words), and the main button is disabled with the visible reason "Amounts must match". A bank date more than a day before the request: "Paid Wed 21 Oct, over a day before the request. Is it the right one?" (approving stays possible).
- **Activity (n)**, collapsed. The 30-word rule box is gone: its three rules sit where they apply.
- **Footer:** "Reject…" (ghost-danger) at the start; the primary "Add Rs 5,000 to Ali Gas wallet" at the end, **enabled**. Pressed with a gap, each empty field says what to type ("Type the bank reference from the company bank app.", "Type the amount the bank shows.", "Pick the date.", "Type the time.") and the first gets the focus; nothing is added.
- **Approve:**
  1. A ConfirmDialog "Add Rs 5,000 to Ali Gas wallet?" with the facts Bank reference · Bank amount · Bank time, and "Asked for Rs 5,500 · different" when the amounts differ; the body "This can't be undone. A mistake needs a wallet correction."; [Go back] (focused) · [Yes, add Rs 5,000].
  2. `POST /payments/:id/approve` with the drawer's key.
  3. The toast "Rs 5,000 added to Ali Gas wallet. Balance now: Rs 8,450."; the drawer closes and the row leaves To check.
- **Reject** (Modal): "Reject Ali Gas's request for Rs 5,000?"; RadioCards in 2 columns: Money not found in the bank · Amount doesn't match · Name on the account doesn't match · Duplicate request · Other. Only once a reason is picked: "Note to Ali Gas" (Optional; required for Other, 3+ characters) and the preview "Ali Gas will see:" with the shop app's sentence (for a name mismatch "The name on the account doesn't match our bank.", word for word UX_MOBILE S6) plus "The office wrote: “…”". [Go back] · [Reject request] (danger, enabled; "Pick a reason." when pressed with none). Toast "Rejected. Ali Gas sees the reason."
- **Approved or rejected (read-only):** the chip Approved (green) or Rejected (red); Added · Asked for (when different) · Bank reference · Bank time · "Approved by Owner · 23 Oct, 10:20 am", or Reason · Note · "Rejected by …". An approved top-up has "Open wallet".
- **ProofViewer:** the image fits the window, and a click zooms to 2× ("Click to zoom"). If the signed link fails, refetch once; then "Can't load the screenshot. Close and open the request again."
- **Errors**
  - At the field: `TOPUP_BANK_REFERENCE_USED` "Already used for AG-T031 (Ali Gas). Check it, or reject as a duplicate." (reference), "A top-up must be from Rs 500 to Rs 50,000." (amount), `TOPUP_BANK_TIME_IN_FUTURE` (time).
  - In the notice area: `TOPUP_NOT_PENDING` (refetch; "Sana approved this at 4:21 pm" or "Sana rejected this at 4:21 pm"), `TOPUP_WOULD_EXCEED_CAP`, `TOPUP_AMOUNT_MISMATCH`, no connection ("Couldn't reach the server. Your entries are kept — try again."). The approve button stays pressable while the settings fail to load: the server applies the same rules.
- **Not built:** second approval and "Not in bank yet" (DECISIONS ADR-09).

### 2.3 Delivery prices (`/prices/$distributorId`, drawer `/prices/$distributorId/$zoneId`; admin-web-money; replaces PricingScreen)
- **Header:** "Delivery prices"; subtitle "What a distributor pays per order, by customer zone." No freshness line.
- **Distributor picker:** FilterChips for up to 6 distributors (a search box above them for more), each with a red "1 missing" or a green tick and "All set". The choice stays in the URL.
- **Alert** when any zone is missing, one line: "1 zone has no price. Customers there are blocked." / "{{count}} zones have no price. Customers there are blocked."
- **Filters:** [All zones] [Missing (n)] (the "Missing (0)" chip still shows, so a `?missing=true` link can be un-picked) and the toggle chip [Show archived] when archived zones exist. Today's "Set prices" opens this page with Missing picked.
- **Grid** (`GET /pricing/prices/:distributorId`, 5 columns):

  | Column | Content | Priority |
  |---|---|---|
  | Zone | name, with the city muted; sticky | 1 |
  | Base per order | MoneyText | 1 |
  | Per cylinder | only the sizes with an amount, "11.8 kg Rs 40 · 45.4 kg Rs 150", or "—" | 1 |
  | Status | "Set" (green) or "Not set" (red) | 2 |
  | Action | a secondary small button "Set price" or "Edit"; an archived zone with a price shows "View" | 1 |

  Archived zones are hidden behind "Show archived".
- **Price drawer** (`md`)
  - "Ali Gas · Zone G-9" with the chip Set or Not set; the subtitle "Lahore · changed 23 Oct by Owner" ("Lahore" alone when never set).
  - "Copy from…" (a Select, when this distributor has other priced zones): "North · Rs 250 + per cylinder", "South · Rs 400". It fills the boxes; nothing is saved until "Save price".
  - **Base per order** (MoneyInput, required, Rs 0 to Rs 100,000; the first focus). A blank base pressed: "Type the base per order.".
  - AddMore **"+ Add per-cylinder amounts"** (already open when any size has an amount): a 2×2 grid of MoneyInputs labelled by size, at most Rs 100,000 each, "Blank means Rs 0."
  - **Example**, only once the base is a valid amount: "2 × 11.8 kg: Rs 250 + 2 × Rs 40 = Rs 330" (11.8 kg when it has an amount, else the first size that has one), or "Every order: Rs 250" for a flat price. Rs 0 is a real price, and a blank base never reads as "costs Rs 0".
  - The note "New orders use this price. Placed orders don't change."
  - An archived zone: "This zone is archived. Its price is kept but not used." and the form is read-only.
  - Footer: "Remove price…" (ghost-danger, only when set) and the primary "Save price" (`PUT`). Toast "Price saved for Zone G-9."; the row is tinted and the chip turns "All set" when complete. A typed "250.5" stays with "Whole rupees only".
  - **Remove price…** (ConfirmDialog with a reason): "Remove the price for Zone South?" / "Customers in South will be blocked until a new price is set." with "Why?" (5–300). Toast "Price removed for Zone South." (6 words at most: the dialog already says customers are blocked).
- **Errors:** `PRICE_INVALID` (field), `ZONE_ARCHIVED`, `CONFLICT_STALE_STATE` ("This price changed while you were looking." with "Reload").
- **Empty:** "No zones yet. Ask the tech team."; Missing picked with nothing missing: "Every zone has a price." with [Show all zones].

### 2.4 Distributors and their one store (`/distributors`; admin-web-ops; evolves DistributorsScreen and StoresScreen)
- **List:** header "Distributors" with the primary "Add distributor"; no subtitle, no freshness line. A search box "Name, phone or code" (it searches the loaded list) and the toggle chip "Show suspended" (only when one exists). Waiting-to-start rows sort first, then by name.

  | Column | Content | Priority |
  |---|---|---|
  | Distributor | business name in bold, the contact muted only when it differs | 1 |
  | Phone | | 1 |
  | Status | "Waiting to start", "Active" or "Suspended" | 1 |
  | Balance | MoneyText | 2 |
  | Prices | a red "1 not set" or a green "All set" chip ("No store yet" in red) | 2 |
  | (chevron) | | |

  Empty: "No distributors yet." with [Add distributor]. A search with no result: "No distributors match “q”" with [Clear search].
- **Add drawer** (`/distributors/new`, 640 px; no Cancel)
  - **Business** (two columns, the paired fields level): Business name; Contact name; Mobile number (PhoneInput, "They sign in to the app with it."); **Distributor code** (2–6 capital letters or digits, starting with a letter), **suggested from the business name** as it is typed ("Noor Gas" → "NG"; a digit 2–9 is added when the code is taken) until the person edits it, with the hint "Starts order numbers (AG-0142). Fixed after the first order."; AddMore "+ Add CNIC or email": CNIC ("13 digits. Can't be changed after saving."; afterwards it shows only masked, read-only) and Email.
  - **Store:** Store name (default "{{business}} store") and Store address. "Store location": "Click the map where the store is.", **"Find area"** (a SearchSelect "Area or city" over every city's areas, `/cities` and `/cities/:id/areas`), the 280 px map **fitted to the active zones** with their outlines and names (stroke `--primary`, fill `--primary-soft`; from the zone polygons), the other stores as grey dots, and "Pin at map centre".
  - The zone line under the map, from `GET /zones/locate`: "Zone: North"; outside every zone (danger) "Outside every zone. Move the pin into a shaded zone."; "Finding the zone…"; locate failed "Couldn't check the zone. It's checked again when you save."
  - Primary "Create distributor", **enabled**: pressed with a gap, each required field says what to type ("Type the business name.", "Type the contact name.", "Type the mobile number.", "Type a code, like AG.", "Type the store name.", "Type the store address."; the phone "Enter a number like 300 1234567."), the drawer scrolls to the first, and a pin outside every zone scrolls the map's red line into view. Toast "Noor Gas created. Next: set delivery prices."; the new row is tinted at the top of the list.
  - **Removed:** the name suggestions that copied another person's data, the duplicate checks in the browser, the city-then-area dropdown pair, the Islamabad starting point and "ask engineering". The server returns `USER_PHONE_IN_USE`, `USER_CNIC_IN_USE`, `DISTRIBUTOR_CODE_IN_USE` and `STORE_OUTSIDE_ZONES` at their fields.
- **Distributor page** (`/distributors/$id`; the back link "← Distributors"; the subtitle "Code NL · +92 300 5556667")
  - **Waiting to start:** the actions "More" (Change code, and Set app password once one is set; a divider; Suspend…) and the primary **"Activate distributor"**, disabled until the checklist passes, with the visible reason "Finish the checklist first". The **checklist card** "Before Noor LPG can start": "Store · Zone East" ✓ (or "Store not set" ✗ [Set up store]); "Delivery prices · 0 of 3 set" ✗ [Set prices] (Prices with Missing picked); "App password · not set" ✗ [Set password] (then "App password · set" ✓). Then the Contact and Store cards side by side, and Activity (n). The Wallet, Delivery prices and Recent orders cards are hidden while waiting.
  - **Active or suspended:** the secondary **"Set app password"** (KeyRound) as a visible header button, and "More" (Change code before the first order; a divider; Suspend… (danger) or Reactivate…; the focus starts on the first item, never on Suspend…). Four cards of equal height: Contact (Edit), Store (Edit store; a map tile at street zoom with the zone outline), Wallet ("Balance" big, "Open wallet"), Delivery prices ("2 of 3 zones set" with the "1 not set" or "All set" chip; "Set prices"). Then Recent orders (Order · Customer · Status · Placed, 5 rows, "See all") and Activity (n).
  - **Edit contact:** Business name, Contact name, Mobile number ("A new number signs them out of the app."), Email (Optional); the CNIC isn't editable. [Go back] · [Save] (no change closes without a request).
  - **Edit store:** Store name, address and the location picker; under the map "Zone: North", and when the pin moves zone, the warning "Moves from zone North to South. New trips start here." [Go back] · [Save store].
  - **Set app password:** "Set app password for {{name}}": "New password" with Show/Hide, a ghost **"Make one for me"** (10 easy-to-read characters from `crypto.getRandomValues`, no 0/O/o/1/l/I; it turns Show on) and a Copy button; "At least 8 characters."; "Tell {{name}} by phone. It isn't shown again."; [Set password]. Toast "App password set for {{name}}." The server still checks 8+ characters, and the password never appears in Activity.
  - **Change code** (only before the first order): "Change the code for {{name}}", "New code", the same hint as the add drawer.
  - **Activate:** "Activate Noor LPG?" / "They can place orders and top up from now on." Toast "Noor LPG is active."; the page switches to the active layout.
  - **Suspend** (danger; `PATCH /distributors/:id/suspend`): "Suspend Ahmed Gas?" with 4 points: "Signed out until you reactivate them" · "No new orders, refills or top-ups" · "Orders already out continue" · "Balance stays. You can still check their sent top-ups."; "Why?" required (5–300). Toast "Ahmed Gas is suspended."
  - **Reactivate** (`PATCH /distributors/:id/approve`): "Reactivate Ahmed Gas?" / "They can sign in and place orders again." with "Why?" (5–300). Toast "Ahmed Gas is active again."

### 2.5 Orders board (`/orders`, drawer `/orders/$orderId`; admin-web-ops; evolves CurrentOrders, PreviousOrders and the OrdersScreen tabs)
- **Header:** "Orders" with "Updated just now ⟳"; no subtitle.
- **Tabs** (`GET /orders/board`): Needs a driver · In progress · Done today · **Cancelled or not delivered** · All. The menu link opens Needs a driver whenever it has orders.
- **Filters:** search "Order number, customer or phone". With more than one distributor: FilterChips [All] [Ahmed Gas] [Bilal Gas] for up to 5, else a SearchSelect "All distributors".
- **Table** (6 columns; 5 on Needs a driver):

  | Column | Content | Priority |
  |---|---|---|
  | Order | AG-0142 (semibold, normal font) with a muted line by tab: "Placed 29 min ago", "Delivered 10:42 am", "Cancelled 9:50 am" or "Not delivered 10:30 am"; sticky | 1 |
  | Customer | the name, then a muted "North", or "North · Ahmed Gas" while every distributor is listed (the line breaks only after the "·") | 1 |
  | Cylinders | "1 × 6 kg, 2 × 11.8 kg" | 2 |
  | Status | the StatusChip with its stage icon, plus a muted reason on a cancelled or not-delivered order; **hidden on Needs a driver** | 1 |
  | Delivery cost | FeeChip | 3 |
  | Driver | "Kashif · LEA-101", or the secondary small button "Assign driver" | 1 |

- **Stages** (`status:order.*`):

  | Stage | Words | Tone |
  |---|---|---|
  | NEEDS_DRIVER | Needs a driver | warning |
  | DRIVER_ASSIGNED | Driver assigned | info (UserRoundCheck) |
  | LOADING | Loading | info (Store) |
  | ON_THE_WAY | On the way | info (Truck) |
  | DELIVERED | Delivered | success |
  | NOT_DELIVERED | Not delivered | danger |
  | CANCELLED | Cancelled | neutral |

- **Empty:** one line per tab ("No orders need a driver" with UserRoundCheck; "None in the last 7 days" on Cancelled or not delivered). A search with no result: "No orders match “q”", "Only {{tab}} was searched." and [Clear search].
- **Order drawer**
  - "Order AG-0142" with the stage chip; the subtitle follows the stage: "Ali Gas · placed 10:12 am", "… · delivered 10:42 am", "… · cancelled 9:50 am", "… · not delivered 10:30 am". While loading, the title uses the number from the board.
  - **The outcome line** first in the body, only when it applies: warning "Cancelling now returns nothing: delivery has started." (loading or on the way); neutral "Rs 400 returned to the wallet · Customer cancelled" or "No refund: delivery had started · Customer cancelled"; danger "Customer not home · The driver brings the cylinders back to the store."
  - Sections: **Customer** (the name, the phone as a `tel:` link, the address, "Zone North" muted); **Cylinders** ("2 × 11.8 kg" with "Take back 2" or "Nothing to take back"); **Delivery cost** (the FeeChip and the breakdown rows "Base · Rs 250", "6 kg · 1 × Rs 30", "11.8 kg · 2 × Rs 40"; an older order "No breakdown for this older order."; a free one "No delivery cost for this order."); **Driver** ("Kashif · LEA-101" with the phone link and a muted "Starts at Ahmed Gas Store"; or "No driver yet."); the **Timeline** ("Placed · Rs 330 taken from wallet", "Driver assigned (by Sana)", "Loading started", "Delivered", or "Cancelled · Rs 330 returned" / "Cancelled · no refund" / "Not delivered", with the reason under it). Then Activity (n), collapsed.
  - **Footer, from `allowedActions` only, with no More:** "Cancel order…" (ghost-danger) at the start when CANCEL; at the end, in this order, "Mark delivered…" (ghost) when MANUAL_DELIVERY, "Could not deliver…" (secondary) when MARK_FAILED, "Change driver" (secondary) when REASSIGN, and the primary "Assign driver" when ASSIGN. At most 4 buttons ever show (ASSIGN and REASSIGN never come together; TRACK isn't a button), so the drawer never needs More. "Change driver" is hidden once loading or once a cylinder was handed to or taken from the customer.
  - **After an action:** an assign or a driver change closes the drawer (the next order is on the list) with its toast, and the row moves tab. A cancel, not delivered or mark delivered keeps the drawer open on the new state, with its outcome line and toast.
- **Assign driver dialog** (560 px; replaces CurrentOrdersScreen.tsx:179-228)
  - "Assign a driver to AG-0142" (or "Change driver for AG-0142"); the muted lines "Sana · 1 × 6 kg, 2 × 11.8 kg · North" and "Starts at: Ahmed Gas Store · {{address}}". **No store picker.** With no store: a danger alert and a disabled primary with its reason.
  - A search box "Find a driver" from 7 drivers. Driver RadioCards, sorted free drivers on duty → on duty on a trip → offline → can't take it: the name, "Van LEB-202" (or "Van LEB-202 · on a trip"), and **one** chip, "On duty" or "Offline". A driver on another trip can still be chosen. Disabled cards keep a reason ("No van — give one in Vans", "On leave until 24 Oct", "Account suspended"; the current driver in the change variant: "Has this order now").
  - Change variant: "Imran's stop will be cancelled. Only the new driver can deliver this order."
  - An offline pick adds the line "Imran is offline. He sees it when he opens the app."
  - Primary "Assign to Imran" ("Assign driver" with no pick; pressed then: "Pick a driver."). Toast "AG-0142 assigned to Imran". An X-Already-Applied answer (a double submit) shows the same toast; nothing is created twice.
  - Errors: `ORDER_NOT_ASSIGNABLE`, `ASSIGN_DRIVER_NO_VEHICLE`, `ASSIGN_DRIVER_NOT_AVAILABLE`, `DISTRIBUTOR_NO_STORE`, `ASSIGN_ORDER_LOADED`.
- **Cancel order…** (Modal; RadioCards in 2 columns and a required note of 5–300 characters with the placeholder "Who asked, and why?"; it sends `confirmRefundPaisa`). Three variants, from `order.cancel`, shown as the money line:

  | When | Money line | Confirm |
  |---|---|---|
  | `refundPaisa > 0` (before the start) | success "Rs 330 goes back to Ali Gas's wallet." | "Cancel and return Rs 330" |
  | `noRefundReason = DELIVERY_STARTED` (after the start; danger) | "Delivery has started. Cancelling now returns nothing." | "Cancel without refund" |
  | `refundPaisa` 0 and no `noRefundReason` (no cost, or an order the old system charged before the switch-over) | neutral "Nothing goes back to the wallet for this order." | "Cancel order" |

  - Pressed with a gap: "Pick a reason first." / "Write a note of at least 5 characters." The note stays required (settled point G04-01; the lead kept it).
  - `ORDER_CANCEL_TERMS_CHANGED` re-renders the dialog with the new terms and its notice, the catalogue text "Delivery has just started. The refund is now Rs 0." (the shop app says the same).
  - `ORDER_HANDOVER_STARTED`: "The driver has started delivering. Use 'Could not deliver…' or 'Mark delivered…'."
  - Toasts: "AG-0142 cancelled · Rs 330 returned", "AG-0142 cancelled · no refund", "AG-0142 cancelled".
- **Could not deliver…** (only after the start; Modal): "Mark AG-0008 not delivered?" with two facts, "No refund: Rs 400 stays paid." (left out when the order has no cost) and "The driver brings the cylinders back to the store."; RadioCards in 2 columns (6; "Other" was "Other reason"); a required note (5–300) with the placeholder "What happened?"; [Mark not delivered]. Toast "AG-0008 marked not delivered." No money moves. Before the start the action is hidden.
- **Mark delivered…** (the footer button; Modal): "Mark AG-0008 delivered?" / "Only when the driver can't do it in the app. No money moves." with one box "Who confirmed the delivery?" (required, 10–300; "Write a reason of at least 10 characters."). [Mark delivered]. Toast "AG-0008 marked delivered by the office." It is logged with the office user's name in Activity. Inc 2 replaces the dialog with the one that names each cylinder (§3.4), behind the same button and title. Errors: `ORDER_INVALID_TRANSITION` refetches the drawer, which then shows the order's real stage. An X-Already-Applied answer shows the same toast.
- **Removed:** Auto-dispatch, the "Confirm" button, the store picker, the UUID driver column, DeliveryOrdersScreen, the board's subtitle, the More menu holding one item, and the cost formula sentence.

### 2.6 Wallets (`/wallets`, `/wallets/$distributorId`; admin-web-money)
- **List** (`GET /admin/wallets`): "Wallets" / "Prepaid balances for delivery costs." No freshness line. A name search "Distributor name" shows only with more than 10 distributors.

  | Column | Content | Priority |
  |---|---|---|
  | Distributor | the name | 1 |
  | Balance | MoneyText, with a small red **"Low"** chip from `AdminWalletRow.lowBalance` (the lead, 2026-10-23: strictly below `wallet.lowBalancePaisa`, the same rule as the shop's flag; Rs 0 never warns) | 1 |
  | To check | "Rs 4,500 · 2 top-ups", a link to the top-ups waiting (`/topups?tab=to-check&q={name}`) | 2 |
  | Last top-up | when the last one was approved, or "—" | 3 |
  | (chevron) | | |

  Empty: "No distributors yet." with [Add distributor].
- **Wallet page**
  - The back link "← Wallets"; the title "Ali Gas wallet"; the actions ghost "Download statement" and secondary **"Record correction…"**. The actions show once the wallet and the list (which gives the name and code) have loaded; if the list fails, a warning with Try again.
  - **One balance card**, one row: "Balance" in `--fs-28` bold; when above 0, the link "Rs 5,000 in top-ups to check"; at the end, the green chip **"History adds up"**.
  - **Integrity**, from `integrity` and the balance:
    - mismatch (`differencePaisa` isn't "0"): the chip gives way to a danger banner "History is Rs 120 off. Tell the tech team before any correction." (the absolute `differencePaisa`), and "Record correction…" is disabled with the visible reason "Fix the history first." The page only reads; the nightly check raises the alert.
    - below zero (`ok` false, `differencePaisa` "0", the balance below Rs 0: an old unguarded debit whose history adds up): a warning banner "Balance is below zero. Record a correction to bring it to Rs 0." "Record correction…" stays on, because a super-admin correction is the documented fix (DATA_MODEL §3.5 inc1b pre-check). `ok` stays false for the nightly check (API_CONTRACT §8.5). Any other `ok: false` reads as a mismatch.
  - **History** (`/admin/distributors/:id/wallet/statement`), two chip rows:
    - **Dates:** Today · Last 7 days · This month (the default) · Last month · Custom, counted from the business date (03:00 cut-off), because the statement reads `from`/`to` as business days (API_CONTRACT §7.8, ADR-21).
    - **Type:** All · Top-ups `TOPUP_ADDED` · Delivery costs `DELIVERY_COST` · Returned costs `DELIVERY_COST_RETURNED` · Corrections `CORRECTION,OPENING_BALANCE`; older entries show under All only.
    - The table is grouped by day: When (time) · What happened · Change (signed, coloured) · Balance after · By (priority 3). Rows with an order or a top-up open its drawer and show a chevron.

    | Entry | "What happened" |
    |---|---|
    | Top-up | "Top-up · AG-T031 · ref 77814402" (the reference is `subject.bankReference`, as typed) |
    | Delivery cost | "Delivery cost · AG-0142 · Usman" (`subject.clientName`; without it "Delivery cost · AG-0142") |
    | Cost returned | "Delivery cost returned · AG-0142 (cancelled before delivery started)" |
    | Correction | "Correction: Top-up approved by mistake — {{note}}" |
    | Opening entry | "Opening balance"; when an office user recorded it as a correction: "Opening balance — {{note}}" |
    | Old adjustment | "Older entry" |

    - Empty: "No money in or out yet." only when the wallet has no history at all (a one-row read with no dates); otherwise "Nothing in these dates." (with [Clear filters] when filters are set).
  - **Download statement:** a CSV built in the browser for the chosen range: Date, Time, What happened, Reference, Change (Rs), Balance after (Rs), By. Named `ali-gas-wallet-2026-10.csv`. At most 2,000 rows ("Pick a shorter date range."). A print stylesheet is included.
  - After a correction, the balance card and the new row are tinted for 2 seconds.
- **Correction dialog** (560 px, **two steps in one dialog**; one Idempotency-Key per dialog)
  - **Step 1:** "Record a correction for Ali Gas" and "For mistakes only."
    - Direction: RadioCards in 2 columns, no default: "Add money" / "Take money".
    - Amount: more than 0; the hint follows the direction: "Up to Rs 100,000." or, taking, "Up to Rs 2,330, the balance.". Taking too much: "Ali Gas has only Rs 3,450. You can't take more than that." and Continue doesn't move on.
    - The preview "Balance: Rs 3,450 → Rs 3,780" once the direction and amount are valid.
    - Reason: RadioCards in 2 columns, in the office's words: Top-up approved by mistake · System error · Bank reversed a top-up · Opening balance · Other. The shop app shows its own words for two of them, "Top-up added by mistake" and "Mistake fixed", and no label for Other (UX_MOBILE §3.4); this split replaces settled point G16-06's one label set. The history's "Correction: {{reason}} — {{note}}" uses the office's words.
    - Note (required, at least 10 characters; the lead kept it), placeholder "What went wrong?"; empty or short: "Write what went wrong, at least 10 characters."
    - AddMore **"+ Link a top-up or order"** opens "Top-up or order", a SearchSelect of this distributor's latest top-ups (up to 10) then latest orders (up to 10), "AG-T031 · Rs 5,000 · Approved", "AG-0142 · Sana · 21 Oct"; typing filters them, and a full number that isn't listed is looked up among this distributor's own records. Another distributor's number shows "Ali Gas has no top-up or order BG-0001." under the field, which is also where the server's `NOT_FOUND {field}` goes.
    - [Go back] · [Continue], enabled: pressed with a gap, "Pick add or take.", "Type the amount.", "Pick a reason." and the note line.
  - **Step 2** (the confirmation, in the same dialog): "Add Rs 330 to Ali Gas wallet as a correction?" (or "Take Rs 100 from …"), the facts Reason · Note · Related · Balance after; [Back] (focused, keeping everything) · [Add Rs 330] or [Take Rs 100] (danger).
  - Toast "Correction saved. Ali Gas balance: Rs 3,780."
  - This is for mistakes only. There is no link from customer problems.

### 2.7 Expenses (`/expenses`; the expenses lane and admin-web-ops; rebuilds ExpensesScreen in `features/expenses`)
- **Header:** "Expenses"; secondary "Expense types"; primary "Add expense". No subtitle, no freshness line.
- **Tabs:** Expenses · Driver fuel logs (read-only).
- **Filters:** date chips This month (default) · Last month · Custom (From and To); Type (a Select "All types"); Van and Driver (Selects, a SearchSelect above 6); the toggle chip "Show removed". With a list filter on: "Totals count all expenses in these dates."
- **Totals** (`GET /expenses/summary`): Total first ("Rs 19,450 · 5 expenses"), then one card per type **with expenses in these dates** (no Rs 0 cards; archived types only with rows). **Only when driver fuel logs exist in the dates:** the muted card "Petrol · driver fuel logs Rs 2,500 (2 logs)" and the toggle chip **"Add driver fuel logs"** beside Total, off by default, with "Off, so bills aren't counted twice." under it; on, the total includes them, labelled. The month × type table shows for ranges longer than one month.
- **Table** (`GET /expenses`, Load more): Date · Type · Amount · Van and driver ("LEA-101 · Kashif", or "—") · Note (a paperclip when there is a receipt, "Has a receipt") · chevron. Removed rows are struck through with the chip "Removed". There is no By column (it is in the drawer).
- **Add / edit drawer**
  - Date: DateChips **Today** (the default) · Yesterday · Pick date (not after today's date in Pakistan; expenses have no 03:00 cut-off).
  - Type: FilterChips with up to 6 active types, else a Select; the last type used is picked first (remembered per browser).
  - Amount (MoneyInput; the first focus). Note (required, at most 200 characters, placeholder "What was it for?", sent as `description`; the counter from 160).
  - AddMore **"+ Add van, driver or receipt"** (already open in edit when any is set): Van, Driver, and the receipt photo ("Attach a photo"; upload purpose `EXPENSE_RECEIPT`; a thumbnail with Replace and Remove).
  - Footer: "Remove expense…" (ghost-danger, edit only) and the primary "Save expense". Pressed with a gap: "Pick a type.", "Type the amount.", "Say what it was for." Toast "Petrol Rs 2,500 saved"; the new row is tinted and the totals update.
  - Errors: `EXPENSE_DATE_IN_FUTURE`, `EXPENSE_TYPE_ARCHIVED`, `AMOUNT_NOT_WHOLE_RUPEES`, `FILE_*`.
- **Remove expense…** (ConfirmDialog, danger): "Remove this expense?" with the facts Date · Type · Amount and "It's left out of totals. The activity log keeps it."; reason RadioCards in 2 columns **Entered twice · Wrong amount · Wrong type · Other**: the picked card's words are sent as the reason (5–200 characters, as the API requires); Other opens "Why?", required. It is a void (`POST /expenses/:id/void`); `EXPENSE_ALREADY_VOIDED` refetches. Toast "Expense removed".
- **Expense types** drawer (`/expenses/types`): rows with the name in bold, a muted "2 expenses", and ghost small "Rename" and "Archive" (Petrol and Other show the lock "Can't be archived"); archived types under "Archived" with "Restore". At the end AddMore "+ Add type" opens the name box (2–40 characters) with "Save type" and a ghost "Cancel". No "In use" chips. Errors: `EXPENSE_TYPE_NAME_TAKEN`, `EXPENSE_TYPE_LOCKED`; a name taken by an archived type reads "There's already an archived type called {{name}}. Restore it instead." with Restore on that row. Toast "{{name}} archived".
- **Driver fuel logs tab:** date chips and Van; with logs, the per-van table (litres, cost, km, km/litre) with the logs inside, read-only (`GET /reports/fuel-consumption`); with none, "No fuel logs in these dates.", or "Drivers can't log fuel yet." while the Driver fuel logs feature is off (§2.8).
- **States:** skeleton cards and table; one ErrorState for the page, "Couldn't load the expenses"; empty "No expenses in this period" with "Add expense"; filtered empty "Nothing matches these filters." with [Clear filters].
- **Removed:** legacy ExpensesScreen.tsx and FuelReportScreen.tsx, the Fuel & km navigation item, Rs 0 cards and the "Include … in totals" switch.
- **i18n namespace** `expenses`. Seeded type names are shown from their stored `name`.

### 2.8 Settings (`/settings`; admin-web-money): a fixed form, with no server-driven renderer
- **Layout:** "Settings" / "Each change needs a reason and shows in the activity log." A section menu at 1024 px and up (a Select below that): **Money · Orders and delivery · Features · Support · Company account · Tech team** (URL values `money`, `orders`, `modules`, `support`, `account`, `versions`; `?section=refills` opens Orders and delivery). Each row has a label (5 words or fewer), a description only where needed (12 words or fewer), and the control, with a unit after a number box. A meta line shows **only when the setting was changed**: "Changed 23 Oct by Owner". An edited, unsaved row shows "Not saved" with a 3 px primary edge. **No "Default" lines.** Read-only rows carry a lock.
- **Not on this page:** `auth.lockedRoles` (the tech team changes it over the API with a reason; the change shows in Activity) and the reserved `auth.otpLogin.enabled`.

| Section | Label | Control | Description |
|---|---|---|---|
| Money | Top-up minimum / Top-up maximum (`topup.minPaisa` / `maxPaisa`) | MoneyInput | — |
| | If the bank amount differs (`topup.onAmountMismatch`) | RadioCards: "Add the bank amount (after a warning)" / "Refuse, so the distributor makes a new request" | — |
| | Top-ups waiting per distributor (`topup.maxPendingPerDistributor`) | number + "top-ups" | "A distributor can't send more until these are checked." |
| | Wallet balance limit (`wallet.maxBalancePaisa`) | [No limit] / [Set a limit], then MoneyInput | "Top-ups can't raise a wallet above this. Corrections can." |
| | Low-balance warning (`wallet.lowBalancePaisa`) | MoneyInput (Rs 0 allowed) | "Distributors are warned below this. Rs 0 turns it off." |
| Orders and delivery | When delivery counts as started (`orders.deliveryStartedAt`) | RadioCards: First load scan at the store (default) / Driver assigned / Van leaves the store | "After this, cancelling returns nothing. Changes apply to unstarted orders too." |
| | Automatic driver assignment (`dispatch.autoAssign.enabled`) | Switch | "Keep off: the office assigns every order by hand." |
| | Max cylinders per order / Max cylinders per refill | number + "cylinders" | — |
| | Refill delivery cost (`refill.deliveryCost`) | read-only "Off · waiting for the owner's decision" | — |
| Features | Store-to-store transfers · Accessories · Support tickets | Switch | — |
| | Driver fuel logs | Switch | "The driver app has no fuel screen yet." On, it only opens the drivers' own fuel-log routes; older logs always show in Expenses |
| | Customer app sign-in | Switch | "Customers confirm by link instead." |
| Support | Office phone (`support.phone`) / Office WhatsApp | PhoneInput (+92 fixed; empty allowed; "Enter a number like 300 1234567.") | "The apps call this for “Call office”. Empty hides it." / "The apps open this in WhatsApp." |
| | Office hours (`support.hours`) | TextInput, placeholder "For example 9am–9pm" | "Shown next to the office phone." |
| | Top-up checking hours (`topup.checkingHours`) | From / To time boxes | "Distributors see these hours in the app." |
| Company account | Account name · Bank · IBAN [Copy IBAN] | read-only | "Only the tech team changes this, on the owner's request." |
| Tech team | Lowest driver app version · Lowest distributor app version | version box, placeholder "For example 1.2.0" | "Older apps must update. Change only when the tech team asks." |

- A feature that is off hides its navigation and routes, and the server refuses it. Driver fuel logs is the exception: it has no office screen to hide, and the Expenses fuel-log tab stays (§2.7).
- Empty required fields say what to type: "Type the amount.", "Type the limit.", "Type a number.".
- **Saving**
  - Unsaved changes show a sticky bar, always laid out and hidden while idle: "{{count}} change(s) not saved · Discard · Review and save". The page never jumps: the scroll position is kept after a save.
  - The save review lists each change ("Top-up maximum: Rs 50,000 → Rs 75,000"; an empty value reads "Not set"; phones as "+92 300 1234567"; hours through `formatClock` as "9 am–9 pm") and needs "Why?" (5–300). **Turning a feature on is confirmed in the save review, with its own warning line** "Store-to-store transfers opens in the apps within 5 minutes."; there is no separate dialog, and turning one off needs no warning (rule 7 still asks first).
  - Then one `PATCH /settings/:key` per change, and the toast "Settings saved. Apps update within 5 minutes."; rows read "Changed 23 Oct by Owner".
  - Errors: `SETTING_INVALID_VALUE` (field), `SETTING_NOT_EDITABLE`.

### 2.9 Activity log (`/activity`; admin-web-money), plus a per-record ActivityList
- **Header:** "Activity log" / "Who changed what, and why."
- **Filters:** **What** chips Everything · Money · Orders · Expenses · Settings · People; **Who** a Select "Anyone", grouped Office / Distributors / Drivers (a search box above 15 people); **Date** chips Any date · Today · Last 7 days · This month · Last month · Custom, counted on business days from `appConfig.day` (`presetRangeFrom(choice, historyToday(appConfig.day))`, the lead's decision). The labels stay for screen readers.
- **Table**, grouped by day: When (the time) · Who · What happened · Why (an empty cell instead of "—"). Data from `GET /audit-logs`. Order, top-up and distributor rows open their record (chevron); `wallet.*` rows open the wallet page; other rows don't open. "Look further back" pages on.
- **Empty:** "Nothing has been recorded yet"; filtered: "Nothing matches these filters" with [Clear filters].

| Action | Sentence |
|---|---|
| `topup.approve` | "Approved top-up {{no}}: {{amount}} for {{distributor}} (bank ref {{ref}})" |
| `topup.reject` | "Rejected top-up {{no}} ({{reason}})", the reason in the office words ("Name on the account doesn't match") |
| `wallet.correction` | "{{direction}} {{amount}} for {{distributor}}: {{reason}}" |
| `wallet.check` | "Nightly wallet check: {{checked}} wallets checked, all match", or "Nightly wallet check: {{mismatches}} of {{checked}} wallets don't match their history" (actor shown as "System") |
| `price.set` / `price.remove` | "Set {{distributor}}'s price in {{zone}}: base {{base}}…" / "Removed {{distributor}}'s price in {{zone}}" |
| `zone.create` / `.update` / `.archive` / `.reactivate` | "Added zone {{zone}}" / "Changed zone {{zone}}" / "Archived zone {{zone}}" / "Reactivated zone {{zone}}" |
| `order.assign` / `order.reassign` | "Assigned {{no}} to {{driver}}" / "Moved {{no}} from {{from}} to {{to}}" |
| `order.cancel` | "Cancelled {{no}} · {{refund}} returned", or "Cancelled {{no}} · no refund" |
| `order.fail` / `order.manual_delivery` | "Marked {{no}} not delivered" (a fail reason Other reads "Other") / "Recorded delivery of {{no}} by office" |
| `trip.abort` | "Stopped {{driver}}'s trip: {{count}} orders need a driver again" (one order: "Stopped {{driver}}'s trip: 1 order needs a driver again") |
| `refill.create` / `refill.assign` | "{{distributor}} asked for a refill: {{count}} × {{size}}" / "Assigned {{distributor}}'s refill ({{count}} × {{size}}) to {{driver}}" |
| `refill.complete` / `refill.cancel` | "Marked {{distributor}}'s refill ({{count}} × {{size}}) complete" (System, Inc 3: "Refill {{no}} done: every cylinder is back") / "{{distributor}} cancelled a refill ({{count}} × {{size}})" |
| `expense.create` / `.update` / `.void` | "Added {{type}} expense {{amount}}" / "Edited …" / "Removed …" |
| `expense_type.*` | "Added, renamed, archived or restored expense type {{name}}" |
| `setting.update` | "Changed {{setting}} from {{from}} to {{to}}", with the setting labels of §2.8 and §3.6 (the Inc 2–3 labels use the forward rules' words: "New day starts at", "How long the link works", "Test mode", "Team phones", "Not scanned at the store", "Finish with cylinders left", "Day-end sheet") |
| `driver.create` / `.update` / `.archive` / `.reactivate` | "Added driver {{name}}" / "Edited driver {{name}}" / "Archived driver {{name}}" / "Reactivated driver {{name}}" |
| `distributor.activate` | "Activated {{distributor}}", or "Reactivated {{distributor}}" when it was suspended |
| `distributor.code_change` | "Changed {{distributor}}'s distributor code from {{from}} to {{to}}" |
| `user.password_reset` | "New app password for {{name}} (distributor)" / "(driver)" |
| `distributor.*`, `user.*` | one sentence each |
| `pilot.setup` / `pilot.reset` (Inc 3) | "Loaded the starting data" / "Reset the test data" |
| `confirmation.answer` | "Customer answered “{{answer}}” for {{no}}" |
| `confirmation.new_link` | "Made a new customer link for {{no}}" |
| `case.resolve` | "Marked the problem on {{no}} as sorted" |

An unknown action shows its code in words. System actors show as "System" and customer actors as "Customer" (the link label is never shown).

### 2.10 Login, session, role gate, environment (admin-web-ops)
- **Login:** one centred card: the Cylinder mark in the brand tile; the title "Smart Fleet · Office" (no subtitle); **Mobile number** (PhoneInput, "+92" fixed, the placeholder "300 1234567", the first focus; no prefilled phone); **Password** with Show; the error line; **Sign in** (`lg`); the muted line "Forgot your password? Ask the tech team." Under the card: "Drivers and distributors use the Smart Fleet app."
  - An empty submit: "Type your mobile number." / "Type your password." under each field, the focus on the first.
  - Errors, all inline under the form and with no session started: `AUTH_INVALID_CREDENTIALS` ("Wrong phone number or password."), `AUTH_ACCOUNT_NOT_ACTIVE`, `AUTH_ROLE_LOCKED`, `AUTH_WRONG_APP` ("This account is for the Smart Fleet shop app." or "…Driver app.", plus a second line "Use the Smart Fleet app on your phone."). These clear the password box and focus it; the number stays as typed. `RATE_LIMITED`: the button becomes "Try again in 9:59", disabled, counting down from `details.minutes`, then back to "Sign in". No message contains "OTP".
  - After signing in, the website returns to the address that was open (for example `/topups/…`), not to Today.
- **Role gate:** only SUPER_ADMIN. The server already refuses other roles at sign-in (`AUTH_WRONG_APP` or `AUTH_ROLE_LOCKED`), so this is a fallback: a saved session of any other role sees a full page with the Smartphone icon, "This website is for office staff" / "Drivers and distributors use the Smart Fleet app on their phone." and [Sign out].
- **Session:** silent refresh (§1.7). The idle sign-out stays at 30 minutes, with a toast at 28: "You'll be signed out in 2 minutes. Keep working to stay signed in." (a warning that prevents lost work, so its 11 words stay). The sign-in page then says "You were signed out after 30 minutes without activity." The idle sign-out runs in the browser only: it deletes the tokens and returns to sign-in. The server ends a session only by token expiry (12-hour access, 30-day refresh) or a `tv` bump (API_CONTRACT §7.1).
- **EnvBadge** (`VITE_APP_ENV`, else the server's environment remembered from an earlier visit; it keeps its 32 px while loading and stays when the server is down):
  - test: "Test server — not real money" (info);
  - training: "Training — dummy bank details, no real money" (warning);
  - live: nothing.

  Non-live environments also prefix the tab title with "[TEST]".
- **Not found** (any unknown address): no page header; EmptyState with SearchX "We couldn't find this page" / "The link may be old or mistyped." / [Go to Today]. **A switched-off module** (`/transfers`, `/accessories` while off): "Store-to-store transfers is switched off" / "Turn it on in Settings." / [Open settings] (`/settings?section=modules`).

### 2.11 Legacy cleanup (admin-web-ops)
- **Delete:** DeliveryOrdersScreen.tsx and PricingScreen.tsx.
- **Hide behind the module switches:** TransfersScreen (`features.transfers`), InventoryScreen's accessory tabs and the `accessories` route (App.tsx:48) (`features.accessories`). ReportsScreen has no switch: it is out of the navigation and opens only at `/reports`.
- **Refills** (`legacy/FillingOrdersScreen.tsx`), kept for Inc 1: no admin "Place a filling order" form, no cost column and no cancel button; "Complete + debit" became "Mark complete" with no money; the stage chips use the UX_PRINCIPLES §4.2 words, without the counts.
- **Refill stations** (`legacy/FillingStationsScreen.tsx`): no price field (ADR-16).
- **The light pass of 2026-10-23 (W41–W49)**: list first, add in a drawer, labelled actions, no raw codes. Changed strings live in a new `legacy` namespace (`i18n/en/legacy.ts`); until `i18n/index.ts` registers it, `legacy/i18n.ts` adds it at runtime (`useLegacyT()`).
  - **Refills:** the title "Refills", the subtitle "Refills carry no money.", FilterChips Active · Done · All, the refill stage words ("Back at store", "Needs a driver"), empty "No refills yet.".
  - **Live map:** opens fitted to the active zones with their outlines; "Orders on the road" beside the map from 1280 px and above it at 1024 px; "No driver positions right now." only when none are reported; "No position" on a row without one.
  - **Drivers:** the list first; "Add driver" opens a drawer (Name · Mobile number (+92) · Driving licence number · "+ Add photo, email or CNIC"); one status chip per driver (Account suspended → On leave → On duty / Offline); row actions "Edit", "Password" and a small "More" (Track live · Mark on leave / Mark available · Archive… / Reactivate…). Its app password uses the distributors' dialog ("Make one for me").
  - **Vans:** tabs "Vans · Give vans to drivers"; "Add van" in a drawer (Plate number · Capacity "cylinders of 11.8 kg", with "45.4 kg takes 4 places. 15 kg takes 2." · City · Home zone); no raw size codes, "slots" or "fungible"; the capacity check behind "+ Check what fits" in Edit; each change acts at once with a toast "LEA-101 given to Kashif"; the toggle chip "Show retired".
  - **Zones:** the zone list (name · city · status, "Show archived"); "Add zone" in a drawer (City · Zone name · "Areas in this zone" (SearchSelect) · "Advanced" → "Size around each area (km)").
  - **Refill stations:** the list first (Name · Address · Area · Active · "Edit" · "Archive…"); "Add station" in a drawer with the map picker ("Click the map where the station is.", "Find area"; coordinates behind "Type coordinates").
  - **Cylinders & labels:** opens on "In stores"; sub-tabs "In stores · On vans · Add stock"; sizes as "15 kg"; "All stores"; QR label steps "1 Distributor · 2 What to print · 3 Print", "Add to print list", "Add {{n}} cylinders" (disabled with "Pick a distributor first", then "Add a batch first"), "Up to 500 per batch".
  - **Alerts:** "No open alerts."; the tab "Rules" and "Check now"; chips Open (red), Seen (amber), Sorted (green).
  - **My profile:** two cards, one form each; one "Show passwords" toggle beside "Change password"; "The tech team changes this number."; "Forgot it? Ask the tech team."; Email "Optional".
  - New toasts, each 6 words or fewer: "{{name}} added.", "{{name}} saved.", "{{name}} archived.", "{{name}} is on leave.", "{{plate}} retired.", "Zone {{name}} added.", "Profile saved.", "Password changed.", "Rules checked.".

### 2.12 Inc 1 is done when
- **Simple:** every screen passes the rulebook's Definition of simple at its word budgets (UX_PRINCIPLES §10; TEST_CASES UXQ-029).
- **No system words:** no raw enum, UUID, "Rs.", "on hold", "pilot", "engineering" or "Shops" is visible on any Inc 1 screen. Check with the pseudo-locale and by reading the rendered text.
- **Top-up approval**
  - Approval is impossible without the reference, amount and time; the main button stays pressable and points at what is missing.
  - A used reference is refused at the field.
  - A double click, or a retry after a network drop, adds money once.
  - When two admins have the same request open, the second sees "already approved".
- **Delivery prices:** every active zone shows Set or Not set (red) for each distributor. A missing price is flagged in text on Prices, Today and Distributors. Optional per-size amounts are hidden when 0.
- **Distributors:** a distributor can't be created without a store, and the store's zone comes from the pin.
- **Orders**
  - The assign dialog has no store picker and no Auto-dispatch.
  - Cancel shows the refund, or "no refund" with the reason, before confirming. "Could not deliver…" is offered only after the start. The office's cancel and could-not-deliver notes stay required.
- **Wallets:** a wallet shows its balance and full history (no 200-row cap). A correction needs a reason and a 10-character note, and can't take more than the balance. A low wallet shows "Low" on the list.
- **Expenses**
  - An expense can be added, edited and removed with a reason, and types can be added, renamed, archived and restored.
  - Totals by type and month match the list.
  - Fuel logs show beside Petrol and are excluded from totals by default.
- **Settings:** every change needs a reason and shows in Activity.
- **States:** every screen shows a skeleton, empty, error-with-retry and success (a toast at the top centre). With the network off, "No connection." shows and failures are visible.
- **Layout:** works at 1024×768 (the sidebar shows its labels at 200 px) and 768×1024, with no page-level sideways scrolling.
- **Build:** `tsc` fails on a missing i18n key. `npm run typecheck -w @smartfleet/admin-web` passes.

---

## 3. Increment 2
Designed to the rulebook on 2026-10-23 (the Inc 2/3 spec §3 and the website spec's forward rules), on the Inc 1 kit and patterns of §1–§2.

### 3.1 Orders board additions
- `LOADING` shows "Loading · 3 of 5 loaded". ON_THE_WAY starts when the driver taps "Done loading" (in Inc 1, when the van leaves the store stop).
- When `confirmation.enabled`, delivered rows get an **answer chip** under the status chip, never in place of it. The tones follow settled point G07-23, which the lead kept on 2026-10-23:

  | Answer | Chip |
  |---|---|
  | Yes | "Customer: all received" (success) |
  | Partly | "Customer: partly received" (warning, TriangleAlert) |
  | No | "Customer: not received" (danger) |
  | Other | "Customer sent a note" (warning, TriangleAlert) |
  | Pending | "Waiting for customer" (warning, Clock) |
  | Expired | "No answer" (neutral) |

- The answer is never a stage, and nothing on the board changes money after placement.

### 3.2 Order drawer additions
- **Cylinders, Inc 2 words:** "Loaded {{done}} of {{total}} · {{time}} · {{driver}}"; "Delivered" with one row per cylinder (number, size, time); "Taken back" grouped Empty, Part-filled and Full, with "No label · 1 × 11.8 kg" in its state's group; and "{{count}} expected".
- "Responsible driver: Imran", with the muted line "Last loaded it onto a van" (`cylinders.responsible`); in a store, or when there is none: "Responsible driver: none" (`cylinders.responsibleNone`).
- **Customer answer** (a section after Cylinders, only when enabled): the chip (§3.1) and the time, the comment in quotes, and one link-status line in the CUSTOMER_PAGE §8 words ("Not sent" · "Not sent · text messages are off" · "Sending text…" · "Text sent 10:58" · "Text didn't send · the number looks wrong" · "Shared 11:00 by Ops (copied)"; once closed "Answered 11:20" or "Expired"; the separators are "·").
  - A secondary **"Copy customer link"** (`POST /orders/:id/confirmation/share {via:'COPY'}`), when `allowedActions` has SHARE, sits **in this section, never in the footer**, so the footer keeps 4 buttons at most. The toast "Link copied". If the clipboard is blocked, the link shows in a selectable field.
- "Mark delivered…" stays the footer button; in Inc 2 it opens §3.4's dialog.

### 3.3 Customer problems (`/problems`; cases)
- **Header:** "Customer problems" (the menu item's name too) with "Updated 8 s ago ⟳"; no primary: each row carries its action. No tabs or filters: the page lists open problems only.
- **Table** (`GET /alerts?type=CUSTOMER_PROBLEM&status=OPEN`, oldest first): Waiting (`WaitTime`, warning from 60 min) · Order ("AG-0001" as a link that opens the order drawer; the distributor muted under it with more than one) · Customer (`CaseDto.customerName`; calling happens from the order drawer) · Answer (the chip) · Customer's note (in quotes, 2 lines at most, "—" when none; P2) · the secondary "Mark as sorted…".
- **Empty:** one line, "No customer problems" (CircleCheck).
- **Mark as sorted…** (Modal 440; a form, because the API needs a note): "Mark {{no}} as sorted?" with a Textarea "What did you do?" (5–300); [Go back] · [Mark as sorted] (`POST /alerts/:id/resolve`). It is the only action: **no money, no charge or return choice, no correction link.** Toast "Problem on {{no}} marked as sorted."; the row leaves and the focus moves to the next row.
- `CASE_ALREADY_RESOLVED` shows the catalogue text "This problem was already sorted by {{by}}." in the dialog, the list refetches, and the button becomes "Close"; a repeat of your own close (`X-Already-Applied`) counts as success. Could-not-deliver is a stage, not a case.
- The Today card: "{{count}} customer problem(s)", "Oldest {{wait}}", [Check problems] (§2.1); its data is `problems: { open, oldestOpenAt }` from `/admin/summary`.

### 3.4 Mark delivered by office, naming each cylinder (the forgotten-IN rule)
- **Where:** the order drawer's footer button **"Mark delivered…"**, the same button, place and title as Inc 1 (never in More; "Record manual delivery…" is dropped: one action, one name). It shows while Driver assigned, Loading or On the way. A 640 px modal.
- **Title and body:** "Mark {{no}} delivered?" / "Only when the driver can't scan. No money moves." (the Activity log records the office user's name).
- **Delivered:** progress chips per size, "11.8 kg · 1 of 2", green once complete; the label "Cylinder number", a mono input (placeholder "For example AG-C0042 or 42", autofocus, a ScanLine icon; a USB scanner works as a keyboard and sends Enter) and an "Add" button.
  - Each number (any API_CONTRACT §1.1 form of this order's distributor, such as 42, C0042 or AG-C0042, or a scanned label) becomes a chip: "AG-C0001 · 11.8 kg" with a green tick, or an error chip such as "AG-C0014 · with another customer" with a red mark, plus a remove button ("Remove AG-C0001"). A typed short number is written out in full with the order's code (`formatNo`). The chip is checked with `GET /cylinders/:code/history` as it is entered, and again from `details.problems` after a refusal: "· another shop's cylinder" (WRONG_OWNER), "· not full" (NOT_FULL), "· marked damaged or lost" (BLOCKED), "· order doesn't need {{size}}" (WRONG_SIZE), "· with another customer" or "· on a van, not for this trip" (NOT_AVAILABLE, by `holderType` CLIENT or VEHICLE), "· not with this customer" (NOT_WITH_THIS_CUSTOMER), "· listed twice" (LISTED_TWICE), "· unknown number".
- **Taken back (optional):** AddMore "+ Add taken back" opens the same input, with FilterChips "Empty · Part-filled · Full" for the next number (default Empty, kept between numbers), and chips like "AG-C0011 · Empty". They go onto the driver's van, and the shop scans them in as usual.
- **Reason:** RadioCards Not scanned at the store · Driver's phone not working · Other ("What happened?", 10–300). The picked option's English words are sent (each has at least 10 characters), or the Other note.
- **Footer:** the muted live line "Still needed: 1 × 11.8 kg, 1 × 45.4 kg" while sizes are missing; [Go back] and the primary **"Mark delivered"**, enabled: pressed with sizes missing, "Still needed" turns red and the focus moves to the number box; pressed with no reason, "Pick a reason." under the cards. Nothing is sent until every size is named and a reason is picked.
- **Toast** "{{no}} delivered · cylinders moved to the customer". **No money moves.** A repeat (`X-Already-Applied`) shows the same toast.
- **Errors:** `MANUAL_DELIVERY_CYLINDERS_MISMATCH` (the chips turn red from `details.problems`, with the alert "Some cylinders can't be used. Fix the red ones."), `SCAN_CYLINDER_UNKNOWN` (that chip "· unknown number"), `ORDER_INVALID_TRANSITION` (the dialog closes, the drawer refetches, an error toast).

### 3.5 Find cylinder (`/cylinders/find/$number`)
- **Where:** a search box at the top of the sidebar, under the product name, with the placeholder "Find cylinder" (there is no top bar from 1024 px).
- Number, size, owner and state, plus the holder now, said "with …", never "holder": "With Sana · AG-0142 · since 10:58 am", "On van LEA-101 · since 9:40 am", "In Ahmed Gas Store · since Mon 19 Oct"; and "Responsible driver: Kashif" with the muted "Last loaded it onto a van", or "Responsible driver: none".
- History in plain words (`GET /cylinders/:code/history`), with the website's four action words (Loaded · Delivered · Taken back · Unloaded):

  | Event | Shown as (`cylinders.history.*`) |
  |---|---|
  | REGISTERED | "Added to {{store}} as a new cylinder · {{state}}" |
  | SCAN_OUT on a trip | "Loaded onto van {{plate}} at {{store}}" ("Loaded onto van LEA-1234 at Ali Gas store") |
  | SCAN_OUT for a refill | "Picked up for refill {{refill}} · van {{plate}}" |
  | DELIVERED | "Delivered to {{customer}} · {{order}}" ("Delivered to Bilal · AG-0142") |
  | PICKED_UP_EMPTY | "Taken back from {{customer}} · {{state}}" ("Taken back from Bilal · Empty") |
  | FILLED | "Filled at {{station}} · refill {{refill}}" |
  | SCAN_IN | "Unloaded at {{store}}" |
  | SCAN_IN that closes a refill line | "Back from refill {{refill}} at {{store}}", plus " · now full" when it was filled |
  | ADJUSTED | "Fixed at day-end {{date}} · approved by {{name}}" |
  | RETURNED_TO_DISTRIBUTOR, TRANSFER, MARK_FAULTY, MARK_LOST | "Older entry" |

  Source TYPED adds " · number typed"; source MANUAL adds " · by the office: {{reason}}"; a REGISTERED event from day-end adds " · from the day-end sheet". {{state}} is Empty, Part-filled, Full, Damaged or Lost. Each line also shows who and when. No "Handed", "Scanned into" or "pilot".

### 3.6 Settings added in Inc 2 (Customer messages, Scans)
W38's rules apply: a label of 5 words or fewer, a description of 12 or fewer, no "Default" line.

| Section | Label | Control | Description |
|---|---|---|---|
| Customer messages | Customer confirmation (`confirmation.enabled`) | Switch | "Customers confirm by link. It never changes money." |
| | Answers that open a problem (`confirmation.caseOnAnswers`) | toggle FilterChips, several can be on: Not received · Other problem · Partly received | — |
| | How long the link works (`confirmation.linkTtlHours`) | number + "hours" (24–168) | — |
| | Test mode (`messaging.testMode`) | Switch | "Send real texts only to the team phones." |
| | Team phones (`messaging.allowlist`) | a list of PhoneInputs (+92 fixed), then AddMore "+ Add phone" | — |
| Scans | Typed cylinder numbers (`custody.typedEntry.enabled`) | Switch | "Drivers and shops can type a number when a label won't scan." |
| | Finish with cylinders left (`trip.allowFinishWithLeftovers`) | Switch | "Lets a driver finish a trip before the store scans everything." |
| | Not scanned at the store (`custody.forgottenInPolicy`) | read-only "Blocked · the office marks it delivered" (Lock icon) | — |

"Case" (banned) is "problem", "Link lifetime" is "How long the link works", and the checkboxes are toggle chips.

### 3.7 Other Inc 2 changes
- **Vans:** on `VEHICLE_HAS_CYLINDERS` show one "{{plateNo}} still has {{count}} cylinder on it. Unload at the store before changing the driver." / other "{{plateNo}} still has {{count}} cylinders on it. Unload at the store before changing the driver."
- **Alerts:** a `VAN_NOT_EMPTY` alert reads "{{plate}} still has cylinders on it ({{count}})", plus "Reason: {{reason}}" when the driver gave one (the tapped words, "Store closed" or "No one to scan", or the Other note). Resolve it once the shop has scanned them in.
- **Live map:** copy only ("No signal for 5 min").
- **The Inc 2 office screens pass the Definition of simple** (TEST_CASES UXQ-032 covers the scan screens; the website checklist UXQ-029 is repeated for the new pages).

### 3.8 As built (Inc 2/3 screens, 2026-10-25)
- **Shell:** the "Find cylinder" box sits under the product name in the sidebar (and in the sheet under 1024 px); Find cylinder's page header has its own box. The Work group adds Customer problems (badge: open problems) and Day-end (badge: days to approve; the item hides while day-end is off, through `MODULES.dayEnd`). The Today badge stays top-ups to check + orders needing a driver + open problems; days to approve aren't in it. In the 200 px sidebar (1024–1279 px) a long label wraps to two lines, so "Customer problems" keeps its badge in sight.
- **§3.1:** "Loading · 3 of 5 loaded" reads `OrderDto.load` (API_CONTRACT §9.13; `status:orderProgress`); the answer chip uses the kit's `answer` kind.
- **§3.2:** the drawer's cylinder lines come from `GET /trips/:tripId` (the load: "Loaded {{done}} of {{total}} · {{time}} · {{driver}}" while loading or on the way) and `OrderDto.visit` (API_CONTRACT §9.13): "Delivered" one row per cylinder by number; "Taken back" by number, grouped by state, with "No label · 1 × 15 kg" and "{{count}} expected". The Customer answer section and "Copy customer link" (inside the section, never in the footer) are as specified; a blocked clipboard shows the selectable box.
- **§3.4:** the dialog is the kit's 640 px `Modal size="lg"`. Two chip words are added: "· listed twice" when two spellings (a QR value and its number) name one cylinder, and "· more than the order needs" for a size named past its count; the server would refuse both.
- **§3.5:** a bare number ("42") resolves with the distributor's code only while exactly one distributor exists; otherwise the not-found page says "Type the full number, like AG-C0042.". The history reads the event's `toState` (REGISTERED "… as a new cylinder · Full"), `station` (FILLED "Filled at Lahore Filling Station · refill AG-R002") and `dayEnd` (ADJUSTED "Fixed at day-end Thu 22 Oct · approved by Owner"; a REGISTERED from the sheet adds " · from the day-end sheet").
- **§2.9 Activity:** `confirmation.answer` reads "Customer answered “Not received” for AG-0001", `confirmation.new_link` "Made a new customer link for AG-0005" and `case.resolve` "Marked the problem on AG-0001 as sorted", the number from the diff's `no` (API_CONTRACT §9.13); older rows fall back to the link label or to the words without the number.
- **§3.6:** the Customer messages and Scans sections are in Settings (`?section=messages`, `?section=scans`), with "New day starts at" under Orders and delivery and "Day-end sheet" under Features (§4.4).
- **§3.7:** the Vans page shows the plate words for `VEHICLE_HAS_CYLINDERS` (HLD-018).

---

## 4. Increment 3
Designed to the rulebook on 2026-10-23 (the Inc 2/3 spec §4.8–§4.10).

### 4.1 Refills (`/refills`, drawer `/refills/$id`; rebuilt with the Orders pattern; no money)
- **Header:** "Refills" (the legacy subtitle goes). **Tabs:** Needs a driver (n) · In progress · Done · Cancelled (Needs a driver = NEEDS_DRIVER; In progress = DRIVER_ASSIGNED to BACK_AT_STORE; Done = DONE; Cancelled = CANCELLED). **Search:** "Refill number or distributor".
- **Table:** Refill ("AG-R007" with "30 × 11.8 kg" muted under it) · Status (the chip with its count) · Distributor · Driver ("Imran · LEB-202", or [Assign driver]) · Requested (P2) · Station (P3; hidden while there is only one station).
- **Stages** (`RefillStage`, API_CONTRACT §1.4; `status:refillProgress.*` for the counts; the stage icons of §1.5):

  | Stage | Words |
  |---|---|
  | NEEDS_DRIVER | Needs a driver |
  | DRIVER_ASSIGNED | Driver assigned |
  | PICKING_UP | Picking up empties · {{picked}} of {{requested}} |
  | PICKED_UP | Empties picked up · {{picked}} of {{requested}} |
  | AT_STATION | At the station |
  | COMING_BACK | Coming back · {{filled}} of {{picked}} filled |
  | BACK_AT_STORE | Back at store · {{received}} of {{picked}} in |
  | DONE | Done; "Done · {{filled}} of {{picked}} filled" when fewer were filled than picked |
  | CANCELLED | Cancelled |

- **Drawer** (480): "Refill {{refillNo}}" with the chip; the subtitle "{{distributor}} · {{count}} × {{size}} · {{station}}"; a Timeline with counts (Requested · Driver assigned · Picked up 2 of 2 · Filled 2 of 2 · Back at store 1 of 2 · Done); a ghost "Show cylinders" that opens the scan list; the muted line "Only {{distributor}} can cancel, before pickup."; the primary "Assign driver" while it needs a driver (it reuses the orders dialog; the toast and the row move as for orders).
- There is no office cancel or fail, and no fee lines. Empty, per tab: "No refills need a driver", "No refills in progress", "No refills done yet", "No cancelled refills".
- The Today card "{{count}} refill(s) need(s) a driver", "Oldest {{wait}}", [Assign drivers].

### 4.2 Refill stations (`/stations`)
Name, address, location and active. **No prices** (DECISIONS ADR-16). The Inc 1 light pass (§2.11) already lists first and adds in a drawer.

### 4.3 Day-end approvals (`/day-end`, `/day-end/$dayEndId`)
- **List:** header "Day-end". Tabs: **To approve (n) · Open · Approved** ("Approved", the word of the status chip, replaces "Locked"). Columns: Day · Distributor · Status · Differences (right-aligned) · Uploaded ("8:40 am · Ali Raza") · "Review" on To approve rows; the whole row opens the review. Status words from `stage` (API_CONTRACT §1.4): NOT_STARTED "Waiting for sheet" · READY "Sheet uploaded" · SENT_BACK "Sent back" · WAITING_FOR_APPROVAL "To approve" · APPROVED "Approved · day closed". Tabs by status: To approve = SUBMITTED; Open = OPEN; Approved = APPROVED. A day the shop never downloaded a sheet for has no row and isn't listed. Empty: "No day-end to approve." / "No open days." / "No approved days yet.".
- **Review page**
  - The title "{{distributor}} · {{day}}" with the status chip; the meta "Version {{version}} · uploaded {{time}}".
  - The primary **"Approve and lock · {{count}} fix"** / "… fixes" (`POST /admin/day-end/:id/approve {version}`), and **"Send back…"** as a ghost-danger button at the start of the actions (the "Reject…" look of a top-up, the negative path of the same kind of decision). A locked day has no primary and the secondary "Reopen…".
  - A facts row: In store 31 · On vans 0 · With customers 4 · Differences 1.
  - One muted line "Nothing changes until you approve.", then "Download:" with the links "Uploaded sheet" (`files.uploadFileId`) and "App's sheet" (`files.sheetFileId`, the sheet the upload was filled from), each through `GET /files/:id/url`; a link is hidden while its id is null.
  - FilterChips by kind (All · Place · State · New number) when there are more than 10 rows.
- **Differences table** (6 columns at most): Cylinder ("AG-C0020 · 11.8 kg", the kind muted under it) · App says ("In store · Full", + " · LEA-101" or " · Sana") · Sheet says · Fix (a chip) · Note (P2) · Last scan (P3).

  | Diff | Words |
  |---|---|
  | PLACE_DIFFERS | In a different place |
  | STATE_DIFFERS | State differs |
  | PLACE_AND_STATE_DIFFER | Place and state differ |
  | UNKNOWN_CYLINDER | Number not in the app |

  The Fix chip: MOVE_TO_STORE "Move to {{store}}" (plus " and set to {{state}}" when the sheet gives a state) · SET_STATE "Set to {{state}}" · MARK_LOST "Mark as lost" · REGISTER "Add to {{store}} as new cylinder" · NOTE_ONLY "Check by hand"; a row that moved after the sheet: grey "Skipped · moved since sheet". The approve button's count is `fixesToApply`.
- **Dialogs**

  | Dialog | Title | Body | Field | Confirm / cancel | Toast |
  |---|---|---|---|---|---|
  | Approve | Approve and lock {{day}}? | "{{count}} fix. Later changes need a reopen." (`_other`: "fixes") | none | Approve and lock / Go back | {{day}} approved · day closed |
  | Send back | Send back to {{distributor}}? | none | What should they fix? (5–300) | Send back / Go back | Sent back to {{distributor}} |
  | Reopen | Reopen {{day}}? | {{distributor}} can upload again. Fixes made stay. | Why reopen? (5–300) | Reopen day / Go back | Day reopened |

- `DAY_VERSION_CHANGED`: a warning "Ali Gas uploaded a new version at 8:52 am." with "Load new version"; nothing is applied until the new version is loaded and approved.
- **Locked view:** read-only. After an approval that registered cylinders: "{{count}} new cylinder added. Print its label in Cylinders & labels." / "{{count}} new cylinders added. Print their labels in Cylinders & labels."

### 4.4 Settings and Today in Inc 3
- **Settings:** Features "Day-end sheet" (`dayEnd.enabled`, Switch, "Distributors send a daily cylinder sheet."); Orders and delivery "New day starts at" (`day.cutoffLocalTime`, a Select of whole hours shown "12 am" to "6 am" through `formatClock`, "Change only when no day-end is waiting.").
- **Today:** the cards "{{count}} day-end to approve" (one: "Ahmed Gas · Thu 22 Oct"; more: "Oldest Thu 22 Oct") with [Review day-end], and "{{count}} refill needs a driver" with "Oldest {{wait}}" and [Assign drivers] (§2.1). API_CONTRACT names no `/admin/summary` fields for them yet: they read the counts from the source the build picks (for example `GET /admin/day-end?status=SUBMITTED` and the refills list), and the detail line shows only when that source carries it. No new route.
- **The Inc 3 office screens pass the Definition of simple** (TEST_CASES UXQ-033 for the Inc 3 screens).

### 4.5 As built (Inc 2/3 screens, 2026-10-25)
- **§4.1:** `/refills` and its drawer `/refills/$refillId` replace the legacy FillingOrdersScreen (its "Mark complete" gets 410 from Inc 3). The Station column shows only while the listed refills use more than one station. The drawer's line "Only {{distributor}} can cancel, before pickup." shows unless the refill is cancelled. "Assign driver" reuses the orders' driver cards. Chips: the kit's `refillStage` and `refillProgress` kinds.
- **§4.3:** chips use the kit's `dayEnd` kind (READY carries the Upload icon). A row the sheet marks Missing reads "In a different place" and filters under Place only (the server's PLACE_AND_STATE_DIFFER counts its LOST state too, but a missing cylinder has no state to check), as the shop's Check and send reads "You: Missing". Approving an outdated version shows the "uploaded a new version" notice; the page keeps the version being reviewed until "Load new version". The approve toast and the locked view's "{{count}} new cylinder added…" line are as specified; the sheet links download through `GET /files/:id/url`.
- **Cylinder words:** FAULTY reads "Damaged" everywhere on the website (the day-end sheet's word), and PART_FILLED "Part-filled".

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

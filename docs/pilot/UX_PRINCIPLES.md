# UX principles: the simplicity rulebook

The short rulebook every screen must pass: the shop app, the driver app, the office website and the customer link page, in Inc 1, 2 and 3. It turns the owner's direction of 2026-10-23 (simple, effective and concise, with little text and controls that explain themselves) into rules a builder follows and a reviewer ticks (§10).

**Where it sits**

| Topic | Which doc wins |
|---|---|
| Look, feel, layout, choice of control, copy, screen states | **This rulebook**, over UX_MOBILE.md, UX_ADMIN.md and CUSTOMER_PAGE.md. Fix the lower doc's copy, the i18n key and the TEST_CASES expected text in the same change. |
| Behaviour, money, safety, routes, data | UX_MOBILE, UX_ADMIN and CUSTOMER_PAGE, and the docs above them (README rule 1). Simplify how a rule looks, never what it protects. |

**Fixed: never redesigned**
- **The theme.** The owner (2026-10-23): nothing flashy; the current theme stays and only the UI and UX improve. Keep the tokens in `apps/mobile/src/ui/tokens.ts` and `apps/admin-web/src/ui/tokens.css`, the customer page's literal tokens (CUSTOMER_PAGE §6) and the look of every existing component. No new colours, gradients, illustrations, decorative graphics, splashy animations or fonts. Status colours are the existing tones.
- **What the rules protect.** The money rules (ADR-06, ADR-07, ADR-09), the one-holder rule (ADR-13: one holder, changed only by a scan) and every confirmation in rule 7.
- **The phone binary.** The apps update over the air, so no new native modules. Sounds wait for the planned 0.2.0 APK (UX_MOBILE §7.0). No new UI library either (ADR-23): a new component is a small file built from the tokens.
- **The words.** English for the pilot, every string behind an i18n key (ADR-18). Error English changes only in `packages/shared-types/src/errors.ts` and `packages/shared-validation/src/messages.ts`, so the phone apps and the website change together.

Contents: 1 People · 2 The 16 rules · 3 Which control · 4 Status words and colours · 5 Words · 6 Word budgets · 7 Phone layout · 8 Website layout · 9 Driver mode · 10 Definition of simple

---

## 1. The four people

**Shop-keeper** (shop app, the distributor)
- Runs a small LPG shop. Busy, often interrupted, usually one hand free.
- A low or mid-range Android, 360 dp wide, sometimes on a weak signal. Uses WhatsApp, TikTok and YouTube, nothing more advanced.
- Reads simple English but wants as few words as possible.

**Driver** (driver app)
- On the road and in a hurry, often in sunlight, hands full of cylinders.
- Reads almost nothing: needs huge buttons, the place name, a count and a tick.
- Must feel and see every scan land: a buzz, a green tick, "2 of 3".

**Office** (website: the owner and one ops person, both super admins)
- A laptop at 1366×768 or 1024×768. Knows basic apps and Excel at most.
- Works through queues: top-ups to check, orders needing a driver, customer problems.
- Needs clear lists, obvious buttons and few words.

**Customer** (link page, Inc 2)
- Anyone, possibly elderly, opening a link from SMS or WhatsApp in any browser, maybe on 2G.
- No app, no account. Must see at once whose delivery it is: the shop's name.
- Must be able to answer with one tap.

---

## 2. The 16 rules

| # | Rule | DO (this app) | DON'T (this app) |
|---|---|---|---|
| 1 | **One screen, one job.** One big main button at the bottom, in thumb reach. | New order · Cylinders ends in one footer button, "Next". | Order detail's footer is the big red "Cancel order": the easiest button to hit is the one that cancels. |
| 2 | **Show, don't tell.** Icons with 1–3-word labels. A helper line only where it prevents a costly mistake, and only one short line. | Wallet card: "Balance Rs 3,450", then a clock and "Being checked Rs 5,000". | The 29-word refund paragraph on Check and place. Say "Refund only if cancelled before loading." |
| 3 | **Tap, don't type.** Chips or segments for 2–6 options, a searchable sheet for long lists, steppers for counts, amount chips, date chips, +92 fixed, the right keyboard. | "Deliver – 2 +" and "Take back – 2 +" steppers; quick amounts Rs 2,000 · Rs 5,000 · Rs 10,000. | A text box for the cylinder count. Add money opening the keyboard first (`autoFocus`) when one tap on Rs 5,000 would do. |
| 4 | **Familiar patterns.** WhatsApp-like rows, a floating + for "new", bottom sheets for choices, pull to refresh, a back arrow, at most 2–3 top tabs. | My orders row: Bilal Khan in bold, one grey line "2 × 11.8 kg · AG-0142", the time on the right, the status chip under the grey line; a floating "+ New order". | A "Select customer" dropdown; a long menu of emoji tiles (the old side menu). |
| 5 | **Status is colour + icon + 1–3 words, the same everywhere** (§4). | The amber clock "Being checked" on the wallet card, the history row and the status screen. | A waiting order grey in the shop app but amber on the website (NEEDS_DRIVER today). |
| 6 | **Money and counts big and bold.** | "Rs 4,520" in display type on the wallet card; "3 of 5 loaded" with a bar. | "Rs. 4520", "PKR 4,520.00", "8/10" for priced zones, or "Rs 0" while the balance loads. |
| 7 | **Confirm only money or no-undo actions,** with a short summary sheet and one big confirm. Everything else acts at once, with a toast. | "Cancel order AG-0142?" · "Rs 330 comes back to your wallet." · [Cancel · get Rs 330 back]. | An "Are you sure?" before Copy IBAN, "I've arrived" or Save customer. |
| 8 | **Errors in plain words, with what to do and Try again.** Never a code. A field error is one line under the field. No internet is one banner. | "No internet · Try again" at the top, while the saved list stays on screen. | "Error 409 TOPUP_TOO_MANY_PENDING"; a pop-up box after a scan; the offline strip, a red card and a "Showing saved info" line all saying the same thing at once. |
| 9 | **Empty states:** an icon, one line, the main button. | My orders, Active: "No active orders." and [New order]. | Delivery prices with no zones: "Zones are loaded by the setup script. Ask engineering to load the agreed zone shapes." |
| 10 | **Smart defaults.** Prefill what we know, remember filters, hide optional fields behind "+ Add more". | Take back starts equal to Deliver; "Paid from" and "Paid with" come from the last top-up. | Add customer showing Area and Notes open; typing the same payer name on every top-up. |
| 11 | **One question per step,** with progress, and a summary before money moves. | Add money: Amount → How to pay → Tell us you paid. New order ends on "Place order · pay Rs 330". | One long form with customer, cylinders, address and payment together. |
| 12 | **Everyday words,** one word per thing (§5), sentence case, digits for numbers. | "History", "Delivery cost", "Paid from wallet", "3 cylinders". | "Ledger", "PAID_VIA_LEDGER", "Receive (SCAN_IN)", "client", "admin", "three cylinders". |
| 13 | **Easy to reach and read.** 48 dp targets (driver 56), AA contrast that holds in sunlight, 360 dp and the largest font, one hand. | Wallet filters in two rows of two: all four fit a 360 dp phone at any font size. | Refill size chips that scroll sideways at the largest font. |
| 14 | **Instant feedback.** A spinner on the pressed button, skeletons for lists, a tick on success. | "Place order · pay Rs 330" becomes "Placing order…", ignores a second tap, then "Order placed · Rs 330 paid" with a tick. | A button that looks the same while it works, or "Rs 0" while loading (both in the app before Inc 1). |
| 15 | **Urdu-ready.** Icons carry meaning, strings stay short, layouts can flip right-to-left. | One key "{{done}} of {{total}} loaded"; `marginStart`; the truck icon on "On the way". | "Deliver " + count + " cylinders" glued from pieces; an arrow fixed to point right; words inside a picture. |
| 16 | **The website follows the same rules.** Tables of 4–6 columns, filter chips, a search box, numbers right-aligned, one primary button per page, details in a side drawer, no walls of text. | Top-up requests: tabs, a search box, Amount right-aligned, "Review" opening the drawer. | The Activity log's "What" dropdown of 6 options; the 49-word Suspend dialog. |

**Rule 7: what asks first.** Keep all of these and add no others.
- **Phone:** Place order (the review step is the summary, and its button names the amount) · Cancel order · Cancel refill · Mark all delivered (Inc 1) · Could not deliver · Finish trip, and finishing with cylinders left · a short take-back · leaving with unsaved scans · Send the day-end · Sign out (getting back in needs the password) · Leave without saving.
- **Website:** Approve or reject a top-up · Record correction · Cancel order · Could not deliver · Mark delivered by office · Activate, suspend or reactivate a distributor · Remove price · Remove expense · Save settings (with a reason) · Turn a feature on · Approve, send back or reopen a day-end.
- **Acts at once, with a toast:** save a customer, assign a driver (the dialog is the choice), save a price, copy, filters, "I've arrived", start a trip.

---

## 3. Which control to use

| You need | Phone (shop and driver) | Website | Never |
|---|---|---|---|
| **2–3 short options** | `SegmentedControl`: at most 3 on a phone, labels of 10 characters or fewer | `Tabs` for list views; `RadioCards` in forms | a dropdown |
| **4–6 short options** | **ChoiceChips** (NEW) with `columns`, so they wrap | **FilterChips** (NEW) in a `FilterBar`; `RadioCards` in forms | a dropdown; chips that scroll sideways |
| **2–6 long options** (station names, reasons) | radio rows: `ListRow` with the `radioOn` and `radioOff` icons, as `ConfirmSheet`'s reasons look | `RadioCards` | a dropdown; labels cut short to fit chips |
| **A long list** (customers, drivers, zones, stations, addresses) | **PickerSheet** (NEW): search on top, recent first, `ListRow` rows; a tap picks and closes | `Select` for up to about 15 short names; `RadioCards` when each option needs facts (driver, van, on duty); `SearchField` and `Table` beyond that | a dropdown of 200 names; a name typed with no suggestions |
| **A count** (cylinders) | `Stepper` "– 2 +", prefilled, limits from settings | a number `TextInput` with min, max and the unit after it (Settings only) | a free text box; a count below 0 |
| **Money** | `AmountChips`, plus "Other amount" opening `RupeeField` (Rs fixed, number pad, grouped as typed); show it with `MoneyText` | `MoneyInput` (Rs prefix, whole rupees); `MoneyText` | "Rs." typed by the person; paisa; a letter keyboard |
| **A date** | **DateChips** (NEW): Today · Yesterday. The binary has no native date picker, so "Pick" needs a JS calendar sheet; no Inc 1 phone screen asks for a date | preset chips (Today · Last 7 days · This month · Custom) instead of the preset `Select` in `DateRangeFilter`; `DateInput` prefilled with today | a typed "21/10/2026"; a dropdown of 4 presets |
| **A phone number** | `PhoneField`: +92 fixed, phone pad, spaced as typed ("300 1234567"), a typed leading 0 dropped | `PhoneInput` ("+92 300 1234567") | a "0300 1234567" placeholder beside the fixed +92, which reads "+92 0300…"; a letter keyboard |
| **Yes or no** | a question: `SegmentedControl` Yes · No; an instant on/off: the React Native `Switch` with its word ("On duty") | `Switch` (shows On/Off) in Settings; a chip for a list toggle ("Show suspended") | a checkbox beside a sentence; a pop-up for a change that can be undone |
| **A dangerous or no-undo action** | a cancel or anything that can lose money: a `danger` `Button` in the content, never in the footer. A no-undo step forward ("Finish trip", "Send for approval") stays the footer's main button. Both open `ConfirmSheet`: the title is the verb and the thing, the money is big, the confirm names the amount, the cancel names what stays ("Keep order") | a `ghost-danger` `Button` ("Reject…") at the start of the drawer footer, opening `useConfirm`, with the focus on "Go back" | "Are you sure? OK / Cancel"; a red main button |
| **An optional detail** | **AddMore** (NEW): a "+ Add more" row that opens the optional fields in place | **AddMore** (NEW) inside a `Drawer` | every optional field open, marked "(optional)" |
| **Words only the person knows** (a name, house and street, a note) | `Field`: the label above, the right keyboard, `autoCapitalize="words"` for names | `TextInput`; `Textarea` with its counter | a placeholder as the only label |
| **A reason** | `ConfirmSheet` `reasons` (radio rows); a note only for Other | `useConfirm` `reason.options` (`RadioCards`) | an empty "Why?" box first |
| **Search** | a `Field` at the top of the list (name, phone or area), or inside PickerSheet | `SearchField` (300 ms debounce, the "/" key) | a search that needs Enter or exact spelling |
| **Progress** | `StepHeader` for steps; **CountBar** (NEW): a big "3 of 5" with a bar | "3 of 5 loaded" after the `StatusChip` | "3/5" or "60%" |
| **"New" on a list** | **Fab** (NEW): extended "+ New order", in the bottom end corner, label always shown | the `PageHeader` `primaryAction` ("Add expense") | a bare "+"; two "new" buttons |
| **A state** | `StatusChip` (§4) | `StatusChip`; `FeeChip` | colour alone |
| **After an action** | `useToast` (3 seconds, with a tick) | `useToast` (success 5 seconds) | `Alert.alert`, `window.alert`, `window.confirm` |
| **Nothing yet, or a failure** | `EmptyState`; `ErrorBanner` with Try again; `QueryBoundary` | `EmptyState`; `ErrorState`; `InlineAlert`; `StaleBanner` | a blank screen; developer text |

**New components.** Allowed only because the control is missing. Each one is a small file built from the existing tokens and looks like the existing components.

| New | App | Built from | First users |
|---|---|---|---|
| PickerSheet | phone `ui/` | `ConfirmSheet`'s sheet (scrim, handle, 220 ms slide, Back closes it), `Field` for search, `ListRow` | Change address, refill station (more than 6), Inc 2 lists |
| ChoiceChips | phone `ui/` | `screens/distributor/shared/FilterChips.tsx`, moved into `ui/` as it is | wallet filters, refill size, day-end difference kinds |
| AddMore | phone and website `ui/` | a ghost `Button` with the `plus` icon; it stays open once opened | Add customer (Area, Notes), Tell us you paid (Transaction ID), the expense drawer (Van, Driver, Receipt) |
| Fab | phone `ui/` | the primary `Button` look (brand, radius md, 56 dp) plus `elevation.sheet` | My orders, Refills |
| CountBar | phone `ui/` | `Text` `display` and `StepHeader`'s bar, `successGraphic` when complete | ScanPanel (Inc 2), Receive from driver (S13), refill detail |
| DateChips | phone and website | ChoiceChips, or the website's FilterChips | the expense date, date presets |
| FilterChips (website) | website `ui/` | the `Tabs` and `RadioCards` tokens (`--primary-soft`, `--border-input`, `--control-h`) | Activity "What", wallet history type, expense filters, the distributor filter |

**Fixes to existing components** (their look doesn't change)
- `PhoneField`: show "300 1234567" after the fixed +92, space the number as it is typed, and drop a typed leading 0.
- `OfflineBanner`: "No internet · Try again", with a 48 dp Try again that refetches. While it shows, screens add no network error of their own.
- `QueryBoundary`: the stale strip becomes "Saved 4:12 pm · Try again", and just "Saved 4:12 pm" while the `OfflineBanner` shows.
- `DateRangeFilter`: presets as chips.
- `StatusChip` tables: the changes in §4.3.

---

## 4. Status words and colours

### 4.1 Five families, existing tones only

| Family | Means | Phone (`StatusChip` tone · `Icon`) | Website (`Chip` tone · lucide icon) |
|---|---|---|---|
| **Green · Done** | finished well | `success` · `ok` (tick) | `success` · CircleCheck |
| **Amber · Waiting** | waiting for someone | `warning` · `checking` (clock) | `warning` · Clock |
| **Blue · Moving** | under way | `brand` · the action's icon (`customer`, `store`, `truck`, `cylinder`) | `info` · CircleDot |
| **Red · Problem** | went wrong; a person must look | `danger` · `error` (!) | `danger` · CircleAlert |
| **Grey · Nothing to do** | cancelled, closed, not started, no answer, or a plain fact | `neutral` · no icon | `neutral` · Circle |

- The clock means Waiting and nothing else. Red means a person must look. Grey never marks something that needs action.
- A chip has 1–3 words from the table below. A count may follow after "·" ("Loading · 3 of 5 loaded").
- Where the table gives two words, the website uses the office's words ("To check", "Needs a driver", "Rejected") and the phone the shop's ("Being checked", "Waiting for driver", "Not added"). Nowhere else may the words differ, and the colour and the icon never do.
- An unknown value shows grey "Updating…" (phone) or "Unknown" (website) and is logged once, as today.
- The customer's answer is its own chip beside the order chip, never the order's status.

### 4.2 The words

| Thing | Value | Phone | Website | Family |
|---|---|---|---|---|
| **Order** | NEEDS_DRIVER | Waiting for driver | Needs a driver | Amber |
| | DRIVER_ASSIGNED | Driver assigned | Driver assigned | Blue · `customer` |
| | LOADING | Loading | Loading (Inc 2: "· 3 of 5 loaded") | Blue · `store` |
| | ON_THE_WAY | On the way | On the way | Blue · `truck` |
| | DELIVERED | Delivered | Delivered | Green |
| | NOT_DELIVERED | Not delivered | Not delivered | Red |
| | CANCELLED | Cancelled | Cancelled | Grey |
| **Delivery cost** | DEDUCTED | Rs 330 paid | Rs 330 paid | Grey (a fact) |
| | REVERSED | Rs 330 returned | Rs 330 returned | Green |
| | NONE | No delivery cost | No delivery cost | Grey |
| **Top-up** | BEING_CHECKED | Being checked | To check | Amber |
| | ADDED | Added | Approved | Green |
| | NOT_ADDED | Not added | Rejected | Red |
| **Trip** (website) | PLANNED | | Not started | Grey |
| | IN_PROGRESS | | On the road | Blue · `truck` |
| | COMPLETED | | Done | Green |
| | ABORTED | | Stopped | Grey |
| **Trip step** (phone `step`, website `stop`) | TO_DO · PENDING | To do | To do | Grey |
| | NEXT (phone only) | Next | | Blue · `chevron` |
| | IN_PROGRESS · ARRIVED | In progress | Arrived | Blue · the step's icon |
| | DONE | Done | Done | Green |
| | FAILED (phone today: SKIPPED) | Not delivered | Not delivered | Red |
| | CANCELLED (phone today: SKIPPED) | Cancelled | Cancelled | Grey |
| **Refill** | NEEDS_DRIVER | Waiting for driver | Needs a driver | Amber |
| | DRIVER_ASSIGNED | Driver assigned | Driver assigned | Blue · `customer` |
| | PICKING_UP | Picking up empties | Picking up empties · 3 of 5 | Blue · `store` |
| | PICKED_UP | Empties picked up | Empties picked up · 5 of 5 | Blue · `truck` |
| | AT_STATION | At the station | At the station | Blue · `cylinder` |
| | COMING_BACK | Coming back | Coming back · 5 of 5 filled | Blue · `truck` |
| | BACK_AT_STORE | Back at store | Back at store · 3 of 5 in | Blue · `store` |
| | DONE | Done | Done | Green |
| | CANCELLED | Cancelled | Cancelled | Grey |
| **Customer problem** (case, Inc 2; the Alerts page uses the same) | OPEN | Open | Open | Red |
| | ACKNOWLEDGED (Alerts only) | | Seen | Amber |
| | RESOLVED | Sorted | Sorted | Green |
| **Customer answer** (Inc 2) | YES | Customer: all received | Customer: all received | Green |
| | PARTLY | Customer: partly received | Customer: partly received | Red |
| | NO | Customer: not received | Customer: not received | Red |
| | OTHER | Customer sent a note | Customer sent a note | Red |
| | PENDING | Waiting for customer | Waiting for customer | Amber |
| | EXPIRED | No answer | No answer | Grey |
| **Day-end** (Inc 3) | NOT_STARTED | Not sent | Waiting for sheet | Grey |
| | READY | Ready to send | Sheet uploaded | Blue · `upload` |
| | WAITING_FOR_APPROVAL | Waiting for office | To approve | Amber |
| | APPROVED | Approved · day closed | Approved · day closed | Green |
| | SENT_BACK | Sent back | Sent back | Red |
| **Distributor** (website) | PENDING · ACTIVE · SUSPENDED | | Waiting to start · Active · Suspended | Amber · Green · Red |
| **Delivery price** | SET | | Set | Green |
| | NOT_SET | No price yet | Not set | Red |
| | OUTSIDE | Outside delivery area | Outside every zone | Red |

The driver's refill run names the driver's next job instead of a status ("Pick up empties", "Go to the station", "Bring them back"), as `driver.refills.stage.*` does today.

### 4.3 What changes from today

**Phone** (`apps/mobile/src/ui/statusTables.ts`, `i18n/en/stages.ts`)
- `order.NEEDS_DRIVER` and `refill.NEEDS_DRIVER`: neutral → warning.
- `step.IN_PROGRESS`: the `checking` icon → the step's icon. `step.SKIPPED` splits into "Not delivered" (danger) and "Cancelled" (neutral).
- `answer.PARTLY` and `answer.OTHER`: warning → danger. `answer.PENDING`: neutral → warning.
- `dayEnd.READY`: warning "Check the differences" → brand "Ready to send". `dayEnd.WAITING_FOR_APPROVAL`: brand → warning, "Waiting for office". `dayEnd.NOT_STARTED`: "Not sent".
- Words: `order.LOADING` "Loading", `order.NOT_DELIVERED` "Not delivered", `refill.COMING_BACK` "Coming back", `refill.BACK_AT_STORE` "Back at store". A timeline may keep the long form ("Loading at your store").

**Website** (`apps/admin-web/src/ui/statusTones.ts`, `i18n/en/status.ts`)
- `topup.NOT_ADDED` and `payment.REJECTED`: neutral → danger. `price.NOT_SET`: warning → danger. `alert.OPEN`: warning → danger. `alert.ACKNOWLEDGED`: info → warning.
- Words: `fee.NONE` "No delivery cost"; `order.NOT_DELIVERED` and `orderStatus.FAILED` "Not delivered"; `trip.PLANNED` "Not started" and `trip.COMPLETED` "Done"; `stop.PENDING` "To do" and `stop.FAILED` "Not delivered"; `refillStage.COMING_BACK` "Coming back".

Buttons keep their verbs: the driver's "Could not deliver" and the office's "Could not deliver…".

---

## 5. Words

### 5.1 Copy rules
- Sentence case everywhere, banners too ("Training · test money only"). No capitals for emphasis.
- Digits for numbers: "3 cylinders", "2 of 3". Never "three", "3/5" or "60%".
- Money only through `formatRs` and `MoneyText`: "Rs 3,450", "+Rs 5,000", "−Rs 330". Never "Rs.", "PKR", ".00" or "/-".
- Times through `formatWhen` (phone) and `format.ts` (website): "Today, 4:12 pm", "Mon 19 Oct". Numbers through `formatNo`: "AG-0142", "AG-T031".
- Phone numbers through `formatPkPhone`: "0300 1234567" as text in the apps and on the customer page, "+92 300 1234567" on the website; a phone field shows "+92" fixed, then "300 1234567".
- A button is a verb and its thing, with the amount after "·": "Place order · pay Rs 330", "Send for checking".
- Talk to the person: "you" and "your wallet" on the phone. On the website, name the distributor: "Add Rs 5,000 to Ali Gas wallet".
- Say what to do, not what broke: "Enter a number like 300 1234567", not "Invalid format".
- One idea per line. No brackets or semicolons in phone copy.
- Interpolate, never glue pieces together. Every counted string has its plural keys (`_plural` on the phone, `_one` and `_other` on the website).
- Icons come from `Icon` (phone) and lucide (website). No emoji.

### 5.2 One word for each thing

| Thing | Shop app | Driver app | Website | Customer page |
|---|---|---|---|---|
| the distributor | you, your shop | the shop's name | distributor (shared error texts may say "shop") | the shop's name |
| their one store | your store | the store's name ("Ali Gas store") | store | |
| the super admin | the office | the office | the person's name; "office" | |
| the end customer | customer | the customer's name | customer | you |
| what an order costs | delivery cost | (never shown) | delivery cost | (never shown) |
| putting money in | Add money (the button), top-up (the request) | | top-up | |
| the wallet's list | history | | history | |
| the work | order | trip, and its steps | order, trip | delivery |
| the four driver actions | Receive (Inc 2, when the driver unloads) | Load · Deliver · Take back · Unload | Loaded · Delivered · Taken back · Unloaded | Delivered to you · Taken back from you |
| a cylinder's state | Empty · Part-filled · Full | the same | the same | the same |
| a customer's complaint | customer problem | | customer problem | Other problem |
| a size | 11.8 kg | 11.8 kg | 11.8 kg | 11.8 kg cylinder |

Why "Unload": "Hand over", "Take back" and "Hand back" look alike at a glance. Load and Unload pair at the store, Deliver and Take back at the customer, and the error texts already say "Unload at the store".

### 5.3 Banned words

| Don't show | Show instead | Seen today in |
|---|---|---|
| ledger | history | `LedgerScreen.tsx` (code only) |
| reconcile, reconciliation | check | `RECONCILIATION_RETIRED` (code only) |
| idempotent, idempotency key, payload, enum, UUID, status code, HTTP, 401, 409 | (never shown) | |
| PAID_VIA_LEDGER, DEDUCTED, PENDING or any other enum value | its words from §4 ("Paid from wallet") | the old order history (UX_MOBILE M9) |
| SCAN_OUT, DELIVERED, PICKED_UP_EMPTY, SCAN_IN | Load, Deliver, Take back, Unload | the old scan screen, "Receive (SCAN_IN)" |
| Hand over | Deliver | `driver.steps.deliver.title`, `scan.step.HANDOVER.title` |
| Hand back | Unload (the shop app says Receive) | `driver.trip.handBackAt`, `scan.step.HAND_BACK.title`; also README "Driver says" and UX_MOBILE §0 |
| zone pair, zone shape | zone | `prices.empty.zonesBody` |
| client | customer | the old Add client screen |
| admin, super admin (phone apps) | the office | the old "Ask admin" |
| fee | delivery cost | `status:fee.NONE` "No fee" |
| charged, debit, deducted | paid, taken from the wallet | `orders.drawer.costLegacy` |
| credit, credited | added | `topups.table.credited` |
| on hold, held, charged later | (never: there are no holds, ADR-06) | |
| pending | waiting, being checked, to check | raw enum values |
| failed (an order or a stop) | not delivered | `orders.tabs.cancelledFailed`, `status:stop.FAILED` |
| mismatch | doesn't match | `wallets.page.mismatchReason` |
| holder, custody | "with …" ("With Bilal since 10:58") | |
| case | problem | `errors.CASE_ALREADY_RESOLVED` |
| module | feature | `settings.sections.modules`, `common.moduleOff` |
| pilot | "not available yet", or nothing | `errors.FEATURE_DISABLED`, Settings descriptions |
| engineering, setup script, settings tool | the tech team | `wallets.integrity.mismatch`, `prices.empty.zonesBody`, `topups.drawer.bank.accountMissing` |
| legacy, before the pilot, old system | older entry | `wallets.history.rows.legacy`, `orders.drawer.costLegacy` |
| AG-T number | top-up number | `topups.page.searchPlaceholder` |
| run (a delivery) | trip | `orders.assign.anotherRun` |
| payer | name on the account | `topup.reason.NAME_DIFFERENT`, `topups.reject.reasons.NAME_DIFFERENT` |
| IBFT | (drop it) Transfer | `topup.howToPay.bank1` |
| lifetime, TTL | how long the link works | `settings.labels.confirmation.linkTtlHours` |
| stage (as a heading) | status | `orders.columns.stage` |
| quote | delivery cost | (code only) |
| business day | today ("the day starts at 3 am") | `orders.empty.doneToday.body` |
| OTP, one-time code | (never: sign in with the password) | |
| Submit, OK | the action ("Send for checking") | |
| invalid, error | what to do ("Enter a number like 300 1234567") | `validation.INVALID_FORMAT` |
| Shops (on the website) | Distributors | `activity.filters.shops` |
| TRAINING, TEST SERVER (in capitals) | Training · test money only | `common.env.*` (phone) |
| 8/10, 3/5 | 8 of 10 | `prices.switcher.coverage` |

**Allowed, because the person's own bank or Easypaisa shows them:** IBAN, Transaction ID, Raast and, on the website, bank reference.
**Shown only for support:** the small "Reference: 7f3a2c" under the message in the website's `ErrorState`, and "App version 0.1.0 · update 1a2b3c4d" on Help. Never on any other screen.

---

## 6. Word budgets

**How to count:** every fixed word a person can read on the screen in its normal state (header, labels, helpers, buttons, fixed words in chips). Don't count data: names, amounts, numbers, dates, codes and sizes. The customer page's gas safety note is never counted and never cut.

| Item | At most | Fits today | Over today, and the fix |
|---|---|---|---|
| Phone screen | about 25 words; driver screens aim for 15 | Add money · Amount: 15 | New order · Check and place: about 58, the refund paragraph alone 29. Make it one line, "Refund only if cancelled before loading.", still worded by `orders.deliveryStartedAt`. |
| Button | 3 words, plus the amount after "·" | "Place order · pay Rs 330" | "Yes, cancel and get Rs 330 back" (5) → "Cancel · get Rs 330 back" |
| Helper line | 8 words, one per field | "Up to 30 per refill." | `refill.request.sizeHelp` (10) → "One size per refill." |
| Error | 12 words | "Wrong phone number or password." | `SCAN_NOT_ON_YOUR_VAN` (14) → "Not loaded on your van. Don't deliver it. Call office." |
| Status chip | 3 words | "Being checked" | "Back in your store" (4) → "Back at store" |
| Toast | 6 words | "Order placed · Rs 330 paid" | `orders.assign.toast` (9) → "AG-0142 assigned to Imran" |
| Sheet or dialog | a title of 6, a body of 12 | "Cancel order AG-0142?" · "Rs 330 comes back to your wallet." | `distributors.suspend.body` (49) → 3 or 4 short facts in a list |
| Empty state | one line of 8, plus the button | "No active orders." and [New order] | `prices.empty.zonesBody` (15, developer words) → "No zones yet. Ask the tech team." |
| Driver step | 15 words; a hint of 8 | "Load at Ali Gas store" · "3 of 5" · [Done loading] | `driver.steps.load.body` (19) → "Scan each full cylinder." |
| Website page, outside the table | about 40 words; a subtitle is one line of 12 or fewer | Top-up requests: about 35 | Delivery prices: about 48 (the subtitle 21, the missing-price alert 18) |
| Customer page, above the buttons | about 30 words | the main page: about 26 | |

---

## 7. Phone layout

### 7.1 The thumb zone
```
360 × 640 dp, held in one hand
+----------------------------------+
| <-  Order AG-0142   [call][menu] |  hard to reach: back, title, header icons only
|                                  |
|  Rs 3,450                        |  things you read: the balance, the count
|  ------------------------------  |
|  list rows · cards               |  fine: rows, cards
|                                  |
|  [ - ]  2  [ + ]    [chip][chip] |  easy: steppers, chips, segments
| +------------------------------+ |
| |   Place order · pay Rs 330   | |  easiest: the one main button, 56 dp
| +------------------------------+ |
+----------------------------------+
```
- The bottom third holds the main button and the controls used most: steppers, chips, segments.
- The top holds what is read (the title, the balance, the count) and the header's back, menu and "Call office". Never the only way forward.
- A danger action is never in the bottom bar and never next to the main button.

### 7.2 The 360 dp rules
- Content is 328 dp wide, inside 16 dp gutters. Check every screen at the largest font (scale 1.3, UXQ-006).
- `SegmentedControl`: at most 3 segments, labels of 10 characters or fewer. More options use chips.
- Chips: at most 6, wrapping to at most 2 rows (`columns`). Nothing scrolls sideways.
- Two buttons side by side only when both labels have 12 characters or fewer; otherwise stack them.
- `ListRow`: the title wraps to 2 lines; a long chip goes in `below`, not in `trailing`.
- Money and counts never wrap or shrink; the label beside them wraps instead.
- No fixed heights on anything that holds text.

### 7.3 The bottom button
- `Screen.footer` holds the one main `Button`: `size="lg"`, 56 dp, full width. It rises above the keyboard.
- At most one more button in the footer: a secondary or ghost above the main one ("Call office" on a top-up that wasn't added).
- Prefer an enabled button that points at what is missing, as Tell us you paid checks the name on press. If the button must be disabled, say why in one line above it: "Pick a customer first".
- While it works: the spinner and the loading label ("Placing order…"), the same width, a second tap ignored (the existing 600 ms guard).
- The `ErrorBanner` for the button's own failure sits in the footer, just above it, as the driver steps do.
- A list screen uses the Fab for "new" instead. No screen has both.

### 7.4 Sheets
- Use a sheet to pick from a list (PickerSheet), to give a reason or to confirm (`ConfirmSheet`), or for one small add-on (Inc 2's "No label or other brand").
- One question per sheet. The title has 6 words or fewer. It has the handle, takes at most 90% of the height, and the scrim or Back closes it unless it is busy.
- A tap on a row picks it and closes the sheet: no "Done" button.
- A confirm sheet shows the money in `MoneyText` at title size, its button names the action and the amount, it uses `danger` only for losing money or no undo, and its cancel says what stays ("Keep order").
- Never a sheet on top of a sheet. A form with more than 2 fields is a screen, not a sheet.

### 7.5 States on every screen (`QueryBoundary`)
- **Loading:** a skeleton in the final layout. Never "Rs 0" or an empty list.
- **Empty:** `EmptyState`: an icon, one line, the main button.
- **No internet:** the one `OfflineBanner`; saved data stays, stamped "Saved 4:12 pm".
- **Server error:** `ErrorBanner` with the plain message and Try again, plus "Call office" or "Add money" when that is the fix.
- **Success:** a toast with a tick, or the next screen shows the tick.

### 7.6 The customer link page (Inc 2)
- One question and three big answers, stacked: [All received] first, in green, then [Partly received] and [Not received]. "Other problem" is a link.
- The shop's name comes first, then "Did you get your delivery?".
- Typing only for "Other problem"; the notes on the other answers are optional.
- About 30 words above the buttons. The gas safety note always shows.
- 18 px text, 56 px buttons, 48 px links, the literal tokens and no JavaScript, as CUSTOMER_PAGE §6 says.
- The thank-you page: a big tick and one line.

---

## 8. Website layout

### 8.1 The page
```
1366 × 768 laptop (about 630 px of height inside Chrome)
+--------+-------------------------------------------------------+
| nav    | Top-up requests                           [primary]   |  PageHeader: title, one line, the one primary
| 232 px | Approve only after you see the money in the bank app. |
|        | [To check 3] [Approved] [Rejected] [All]              |  Tabs, with counts
|        | [search ......................]  [chip] [chip]        |  FilterBar: search and chips
|        | Waiting | Distributor | Amount   | Paid from | Action |  Table: 4-6 columns
|        | 45 min  | Ali Gas     | Rs 5,000 | Ali Raza  | Review |  money right-aligned
|        |                        +------------------------------+
|        |                        | Drawer, 480 px               |  the record opens in a side drawer
+--------+------------------------+------------------------------+
1024 × 768: the nav becomes the 64 px icon rail and priority-3 columns hide (they stay in the drawer).
```
- The header, tabs and filters together stay under about 200 px, so the first rows show without scrolling.
- A page reads top to bottom: `PageHeader` → `Tabs` (at most 5, with counts) → `FilterBar` → `Table` → a `Drawer` for one record.
- One primary per page, at the end of the header. One primary per drawer, at the end of its footer.

### 8.2 Tables
- 4–6 columns. Anything more lives in the drawer.
- Money and counts right-aligned (`align: 'end'`), in tabular figures; "—" for nothing.
- One short action at the end of the row ("Review", "Assign driver"); the whole row opens the drawer too.
- Headers in sentence case, 1–2 words: Status, Customer, Amount.

### 8.3 Filters and search
- 2–6 options: chips (FilterChips) or `Tabs`. 7 to about 15: a `Select`. More: a search box.
- Dates: preset chips (Today · Last 7 days · This month · Custom).
- A search box on any list that can pass about 10 rows, saying what it finds ("Name, phone or order number").
- The URL keeps the tab and the filters, and the menu link reopens the last ones used.

### 8.4 Drawers and dialogs
- `Drawer` at 480 px (640 px for a form with a map), with at most 5 sections, in the order a person checks them.
- Facts in a `KeyValueList`, not in sentences.
- The footer: a destructive action at the start ("Reject…") and the one primary at the end, naming the amount ("Add Rs 5,000 to Ali Gas wallet").
- `useConfirm` only for the rule 7 list. The focus starts on "Go back"; the facts come first, then a body of 12 words or fewer.

### 8.5 Text
- No walls of text. A rule the office must follow is one line at the field it affects: "Each bank reference can be used once."
- Settings: a label of 5 words or fewer and a description of 12 or fewer per row.
- A toast states the result with its numbers: "Rs 5,000 added to Ali Gas wallet".

---

## 9. Driver mode

### 9.1 Targets and reading
- 56 dp for everything. The main button is full width, rows are 72 dp, and two different actions are at least 16 dp apart.
- Each step screen has the place name as its title, one icon, the big count and one button. A hint has 8 words or fewer: "Scan each full cylinder."
- Each of the four actions keeps one icon everywhere (suggested: Load `van`, Deliver `customer`, Take back `cylinder`, Unload `store`).
- "Call office" stays in every header, as today.

### 9.2 Scan feedback (ScanPanel, UX_MOBILE §5 and §7.1)

| Result | See | Feel | Hear (once the 0.2.0 APK is installed) |
|---|---|---|---|
| Recorded | a green strip (`scanOk`) with a tick and "AG-C0042 · 11.8 kg loaded"; the count moves to "3 of 5" | one short buzz (40 ms) | a beep |
| Already scanned | a grey strip, "Already scanned" | nothing | nothing |
| Refused | a red strip (`scanError`) with the plain reason, staying until the next good scan | a double buzz | the error tone |
| Not sent | an amber row "Not saved (1)" with Retry | a stutter | |
| Step complete | the card turns green ("All 5 loaded"), the camera stops, the main button wakes up | a long buzz (200 ms) | a chime |

- Never a pop-up after a scan. The camera re-arms by itself: no "Scan again" tap.
- The count always matches the server. A step never passes without its scans (the one-holder rule): no "Skip scanning".

### 9.3 Sunlight
- Anything read at a glance is `text` (#1F2025) on `surface` (white), at 16.3:1. Never `textSecondary` for an instruction or a count.
- Scan results are solid strips with white text (`scanOk` 6.53:1, `scanError` 6.54:1), not soft chips.
- The step's state is a full-width strip or a toned `Card`, not a small chip.
- Icons are 32–48 dp for the main state, and the count uses `display` (44). No meaning in thin lines, pale tints or the `*Graphic` colours under text.
- The screen stays awake while scanning (`useKeepAwake`, already in the binary).

### 9.4 Hands full
- Everything works with one thumb: no swipe, long press or double tap is needed.
- The torch toggle is 56 dp. "Type number" is the fallback when a label can't be read (Inc 2, when switched on).
- Risky pairs stay apart: "Could not deliver" sits in the content, never beside "Finish visit".

---

## 10. Definition of simple

A reviewer answers each check Yes or No for every screen, in every state. A screen ships when all 12 are Yes; the review lists the screen and the numbers that failed.

| # | Check |
|---|---|
| 1 | **One job.** The screen's job fits in 3 words, and it has exactly one main button (the footer, the Fab or the page primary) within thumb reach. |
| 2 | **Few words.** Fixed text is within §6: a phone screen 25 (driver 15), a website page 40 outside the table, buttons 3, helpers 8, errors 12. |
| 3 | **Plain words.** No banned word, code, enum value, UUID or capitals (§5.3), and each thing uses its word from §5.2. |
| 4 | **Tap first.** Choices, counts, money, dates and phone numbers use the §3 control. The keyboard opens only for names, addresses and notes. |
| 5 | **Smart defaults.** What the app knows is filled in, filters are remembered, and optional fields wait behind "+ Add more". |
| 6 | **Status.** Every state is a `StatusChip` from §4 (colour, icon and words), the same as in the other apps. |
| 7 | **Money.** Amounts and counts are big ("Rs 4,520", "3 of 5"), and every money action names its amount on the confirm button. |
| 8 | **Asks only when it matters.** Only the rule 7 list asks first; everything else acts at once, with a toast. |
| 9 | **States.** The skeleton, the empty state (icon, line, button), the error (plain words and Try again), the no-internet banner and the success tick were all seen. |
| 10 | **Fits.** At 360 dp with the largest font (phone) or at 1024×768 (website), nothing is cut off or scrolls sideways, and every target is at least 48 dp (driver 56). |
| 11 | **Same theme.** Only existing tokens and components, or a §3 NEW one built from them. No new colour, gradient, picture, animation or font. |
| 12 | **Still safe.** The money rules, the one-holder rule and every confirmation behave exactly as the spec says; every string is an i18n key; the layout flips right-to-left. |

**Keeping this file true**
- A change to a rule here also changes, in the same pull request, the UX doc's copy table, the i18n key, the shared catalogue for an error text, and the TEST_CASES expected text.
- Each change gets a CHANGELOG.md line, like every other spec change.

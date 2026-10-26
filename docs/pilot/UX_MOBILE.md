# Mobile UX: shop app and driver app

`apps/mobile` is one Expo SDK 51 / React Native 0.74.5 codebase, built twice by `APP_VARIANT` (apps/mobile/app.config.ts:3):
- the **shop app**, for the distributor (shop-keeper, store);
- the **driver app**.

The customer app is off for the pilot. Customers use the web link (CUSTOMER_PAGE.md).

Routes, payloads and error codes come from API_CONTRACT.md. This doc owns screens, states, copy keys and the mobile design system.

## 0. Plain words
UX_PRINCIPLES.md (the rulebook) wins on look, layout, choice of control, copy and screen states; this doc wins on behaviour, money, safety, routes and data. The simple-UX pass of 2026-10-23 applied the rulebook to every Inc 1 screen below, and the Inc 2 and Inc 3 sections are designed to it.

**Shop app**
- Say "customer", never "client". Say "the office", never "admin".
- Money words: "Balance", "Being checked", "Add money", "Delivery cost", "Back to your wallet" (the cancel sheet's money label), "No refund" (a cancelled order whose cost was kept, on the list and the detail).
- **History** is the one name for the wallet's list: the Home tile and the screen title, and nowhere "Wallet".
- **Never** "On hold", "held" or "charged later": there are no holds (DECISIONS ADR-06).
- No zone names on any shop screen ("Zone North" is an office word). The shop sees "No price yet", "Outside delivery area", or nothing.

**Driver app**
- Say "trip", never "job" or "run". The four actions are **Load** (`SCAN_OUT`), **Deliver** (`DELIVERED`), **Take back** (`PICKED_UP_EMPTY`) and **Unload** (the store scans IN; the shop app says Receive). Never "Hand over" or "Hand back".

**Both apps**
- No enum value, UUID or system word ever reaches the screen.
- Money is always written "Rs 3,450".
- The office buttons read "Call office" and "WhatsApp office", and both Help screens say "Office hours {{hours}}". Sentences may still say "…call the office.".
- Connection trouble has one wording: the banner "No connection" with "Try again", and a button's own failure "Not sent. Tap again." (the lead's decision of 2026-10-23). Never "No internet": the same message shows when the server is down.

---

## 1. Audit of today's app (pilot/happy-path, read before designing)

| # | Finding | Evidence |
|---|---|---|
| M1 | Tokens are thin and small: body 14, captions 12 | theme/index.ts:4-55 |
| M2 | Contrast fails AA: warn pill 1.93:1, ok pill 2.77:1, white on the amber Deliver tile 2.15:1, success button 3.10:1, balance caption 3.82:1 | ui.tsx:36,62-63; driver/HomeScreen.tsx:76; distributor/HomeScreen.tsx:34 |
| M3 | No accessibility props anywhere; 58 hard-coded hex colours; emoji used as icons | `src/**`; SideMenu.tsx:93-123 |
| M4 | 53 `Alert.alert` calls are the only feedback; the driver scan pops a box after every scan | 17 files; driver/ScanScreen.tsx:67 |
| M5 | Money is formatted ad hoc with float maths ("Rs. 0" while loading) | TopupScreen.tsx:18; SideMenu.tsx:154,162; distributor/HomeScreen.tsx:28 |
| M6 | The sign-in screen shows raw keys "signIn" and "password" (missing i18n keys) | auth/PhoneScreen.tsx:95,110,122; i18n/index.ts:4-33 |
| M7 | On 401 the token is deleted but the session kept, so the app is stuck; `/auth/refresh` is never called | api/client.ts:7-26 |
| M8 | Routing is by JWT role only, and the build variant is never checked; ADMIN lands in the shop app | navigation/RootNavigator.tsx:35-37 |
| M9 | System words on screen: `PAID_VIA_LEDGER`, raw statuses, "Receive (SCAN_IN)" | OrderHistoryScreen.tsx:81-85; ScanScreen.tsx:16-22 |
| M10 | Driver steps pass with zero scans ("Done loading", "All delivered", empties "Done") | DeliveryStepsScreen.tsx:151,175,187 |
| M11 | The top-up creates the payment before the person has paid, has no payer name, and has a Rs 100 minimum | TopupScreen.tsx:36-52,39 |
| M12 | Add-client saves in two calls, with a loose phone check and no zone or fee | AddClientScreen.tsx:91-111,125 |
| M13 | Place-order shows no fee and promises "A driver will be assigned shortly" | PlaceOrderScreen.tsx:142 |
| M14 | Refill offers free DIY and checks the balance with floats | RequestFillingScreen.tsx:21,66-67 |
| M15 | No TRAINING banner, although `EXPO_PUBLIC_ENV` is set per build | eas.json:13,24,35 |
| M16 | One existing type error: `muted` on `Caption` | driver/FillingOrdersScreen.tsx:124 |

**What we keep**
- The stack plus side-menu shell, and the SideMenu slide animation (SideMenu.tsx:43-73), reused for ConfirmSheet.
- The zustand auth store and the i18next setup with `compatibilityJSON:'v3'` (i18n/index.ts:43).
- The Home "big tile" hub, PlaceOrder's step structure and customer search, and AddClient's map pin and Nominatim search (:13-23, :250-269).
- DeliverySteps' one-step-at-a-time design, and the TransferScanScreen scan loop (:62-108): continuous scan, same-QR ignore, best-effort GPS, vibration, inline result card.
- `pickAndUploadImage` (api/upload.ts:15-54).

**Native constraint**
- `runtimeVersion: {policy:'appVersion'}` (app.config.ts:25): **Inc 1 ships over the air** to the 0.1.0 APK using only modules already in the binary: `@expo/vector-icons` 14.1, `expo-file-system`, `expo-keep-awake`, RN `Vibration`, `Share`, `Clipboard`, `Linking`.
- The native baseline APK 0.2.0 comes at the start of Inc 2 (§7.0).

---

## 2. Design system (`apps/mobile/src/ui/`)

**Principles**
- Calm and consistent. One primary action per screen, in a sticky footer.
- Big targets: **48 dp in the shop app, 56 dp in the driver app**.
- Every screen has loading, empty, error and success states. Nothing fails silently.
- Confirm before an irreversible money action.

**Migration**
- `src/theme/index.ts` keeps its export names but points them at the tokens below:

  | Old name | New token |
  |---|---|
  | primary | brand |
  | primaryDark | brandPressed |
  | primarySoft | brandSoft |
  | ok | success |
  | okSoft | successSoft |
  | warn | warning |
  | warnSoft | warningSoft |
  | textMuted | textSecondary |
  | background | canvas |

- `src/components/ui.tsx` becomes thin wrappers over `ui/*`, accepting today's props (including `muted` on text, which fixes M16). Old screens keep compiling and get the AA colours for free.

### 2.1 Tokens (`ui/tokens.ts`). The app is light only (app.config.ts:44).

**Colours** (contrast measured)
| Token | Hex | Use | Ratio |
|---|---|---|---|
| canvas | #F4F5F9 | screen background | |
| surface | #FFFFFF | cards, sheets, inputs, header | |
| sunken | #EEF0F4 | neutral chips, skeletons | |
| border | #E3E4E8 | decorative dividers | |
| borderStrong | #8A919C | input borders, unselected chips | 3.18 on white (non-text) |
| text | #1F2025 | main text | 16.3 on white, 14.9 on canvas |
| textSecondary | #555B66 | meta, captions | 6.8 / 6.3 |
| textDisabled | #8A919C | disabled only | |
| brand | #0F6CF0 | primary buttons, focus, selected | white text 4.75 |
| brandText / brandPressed | #0A55C4 | links, brand text, pressed, wallet card | white 6.75; on brandSoft 5.89 |
| brandSoft | #E8F0FE | selected rows, info chips | |
| onBrandMuted | #D6E4FC | secondary text on the wallet card | 5.26 |
| success | #12805A | solid success | white 4.93 |
| successText / successSoft | #0E7A4F / #E7F6EF | done chips, "+Rs" | 4.81 |
| successGraphic | #1EA675 | progress bars and ticks only | 3.10 (non-text) |
| warning | #A85A00 | rare solid warning, the EnvBanner strip (training and test servers) | white 5.09 |
| warningText / warningSoft | #8A4B00 / #FFF4DE | "Being checked", warnings | 6.23 |
| warningGraphic | #F59E0B | icons only, never under white text | |
| danger | #C62828 | danger button | white 5.62 |
| dangerText / dangerSoft | #B42318 / #FDECEA | errors, refusals | 5.75 |
| neutralText / neutralSoft | #3D424B / #EEF0F4 | neutral chips | 8.85 |
| scanOk / scanError | #0B6B4A / #B3261E | scanner strip with white text | 6.53 / 6.54 |
| scrim | rgba(16,18,22,0.55) | sheet backdrop | |

**Type**
- System font (Roboto). Money and counters use `fontVariant:['tabular-nums']`.
- `maxFontSizeMultiplier` is 1.3 (1.2 for display). The minimum size is 13 sp. No ALL-CAPS labels.

| Variant | Shop app | Driver app |
|---|---|---|
| display | 34/40 bold | 44/52 bold (scan counter) |
| title | 22/28 bold | 24/30 bold |
| heading | 18/24 semibold | 20/26 semibold |
| body | 16/24 | 18/26 |
| bodyStrong | 16/24 semibold | 18/26 semibold |
| label | 14/20 semibold | 16/22 semibold |
| caption | 13/18 | 14/20 |
| button | 16/20 semibold | 18/22 bold |
| mono (IBAN, cylinder numbers) | 16/24, +0.5 tracking | 18/26 |

The variant is chosen once from `Constants.expoConfig.extra.variant`.

**Spacing, radius, sizes, elevation, motion**
- **Space:** xs 4, sm 8, md 12, lg 16, xl 24, xxl 32, xxxl 40. Screen gutter 16, card padding 16, gap between cards 12, gap between sections 24.
- **Radius:** sm 8 (chips, inputs), md 12 (buttons, cards), lg 16 (hero cards), sheet 20, pill 999.
- **Sizes**
  - Touch targets are at least 48 / 56 dp (shop / driver).
  - Button md 48, lg 56; the driver's primary button is always 56.
  - Icon button 48 / 56 with hitSlop 8. List row at least 64 / 72. Input 48 / 56.
- **Elevation:** a 1 px border plus Android elevation 1; sheets 8. No large shadows, to stay cheap on low-end GPUs.
- **Motion:** presses 150 ms, sheets 220 ms. Only spinners loop. Animation is skipped when reduce-motion is on.

**Icons:** `ui/Icon.tsx` wraps MaterialCommunityIcons (already in the binary) behind semantic names. All emoji are removed. Every glyph below is in the installed font, so a new name needs no native change.

| Semantic name | Glyph | Used for |
|---|---|---|
| wallet | wallet | the wallet card, and Home's History tile (so it isn't read as order history) |
| addMoney | cash-plus | Add money |
| order | clipboard-list-outline | My orders, New order |
| customer | account | one customer; Deliver (driver) |
| customers | account-multiple-outline | the Customers tile and its empty state (new 2026-10-23) |
| store | storefront-outline | the store; Unload (driver) |
| truck | truck-delivery | on the way; a trip; Start / Continue trip |
| van | van-utility | the van; Load (driver) |
| scan | qrcode-scan | the idle scan strip |
| cylinder | gas-cylinder | size lines, Refills, Take back |
| checking | clock-outline | waiting, and nothing else |
| history | history | the "Saved {{time}}" stamp |
| ok / check | check-circle / check | done, a ticked chip |
| error | alert-circle | refusals, blocked rows |
| warn | alert | warnings that aren't waiting (Low balance, the Partly and Other answers) |
| offline | wifi-off | the connection banner and "Nothing saved yet." |
| info | information-outline | the refund line, Already scanned |
| call | phone | Call office, Call driver, Call {{name}}, Forgot password? |
| whatsApp | whatsapp | WhatsApp office |
| map / navigate | map-marker / navigation-variant | I've arrived / Maps, Use my location |
| search | magnify | search fields (new 2026-10-23) |
| torch, keyboard | flashlight, keyboard-outline | the camera's torch, Type number |
| copy, share | content-copy, share-variant | Copy IBAN, the copy-amount icon button, Send link |
| download, upload, sheet | download, upload, file-excel-outline | day-end (Inc 3) |
| chevron | chevron-right (flips right-to-left) | rows that open, the How-to-pay path |
| menu, help, profile, signOut | menu, help-circle-outline, account-circle-outline, logout | the side menus |
| plus, minus, close | plus, minus, close | AddMore and the Fab, steppers, the Timeline's `stopped` marker |
| radioOn / radioOff | radiobox-marked / radiobox-blank | reason rows in ConfirmSheet |
| empty / partFilled / full | gauge-empty / gauge-low / gauge-full | cylinder states (Inc 2) |
| photo, receipt, lock, home | image-plus, receipt, lock-outline, home-outline | the screenshot tile, empty states, read-only rows |
| sms, link | message-text-outline, link-variant | the Inc 2 Send link sheet (added with Inc 2) |

### 2.2 Components (all exported from `ui/index.ts`)
Items 25–31 are the rulebook's new components (UX_PRINCIPLES §3), built from the tokens on 2026-10-23. The fixes to items 3–24 keep each component's look.

1. **Text** `{variant, tone, numberOfLines, align}`
   - Tones: default, secondary, brand, success, warning, danger, onBrand, onBrandMuted, disabled.
   - Sets the font-scale cap. Title and heading set `accessibilityRole='header'`.
2. **Icon** `{name, size: 16|20|24|32|48, tone, label?}`. Hidden from screen readers unless it has a `label`. 16 is for chips.
3. **Screen** `{children, scroll=true, refreshing?, onRefresh?, footer?, banner?, fab?, padded=true}`
   - Built from SafeAreaView (react-native-safe-area-context 4.10 is installed), ScrollView with RefreshControl, and KeyboardAvoidingView.
   - `footer` is a sticky white bar with a top border, holding the one primary action.
   - `fab` is the slot for item 28; lists keep `FAB_CLEARANCE` of bottom padding so the last row clears it. A screen has a footer or a Fab, never both.
   - EnvBanner and OfflineBanner render on top.
4. **Header**: `makeScreenOptions()` for native-stack.
   - White background, left-aligned 18 semibold title from i18n, 1 px bottom border.
   - `HeaderIconButton {icon, label, onPress}` at 48 dp, used for the menu, "Call office" (always shown on driver screens) and help.
   - **"Call office" never disappears:** each good `/app/config` answer keeps its `support` block (phone, WhatsApp, hours; never the bank account) in secure storage as `support.contact`, and `useOfficeContact` uses it until the server answers. "Call office", the header call button and "Forgot password?" then work offline.
5. **Button** `{label, onPress, variant: primary|secondary|danger|dangerOutline|ghost|inverse, size: md|lg, icon?, loading?, loadingLabel?, disabled?, fullWidth=true, accessibilityLabel?, accessibilityHint?}`
   - Variants: primary is white on brand; secondary is brandText with a 1.5 px brand border; danger is white on danger; **dangerOutline** is `dangerText` with a 1.5 px `danger` border on `surface` (pressed `dangerSoft`), the calm look of a cancel inside the content; ghost is brandText; inverse is brandText on white (used on the wallet card).
   - Loading keeps the width and shows a spinner plus `loadingLabel`, with `accessibilityState.busy`. Disabled is textDisabled on sunken.
   - A **double-tap guard** ignores presses while loading and for 600 ms after a press.
6. **Card** `{tone: default|brand|success|warning|danger, onPress?, padding}`. A pressable card gets a ripple and `role=button`.
7. **MoneyText** `{paisa: string|number|bigint, variant, tone, sign: none|auto|always}`
   - Formats with `formatRs`: "Rs 3,450", "+Rs 5,000" (`sign="always"`), "−Rs 250" (U+2212), with no space after the sign; zero is never signed. Tabular numbers.
   - The accessibility label comes from `money.a11y` ("{{amount}} rupees").
8. **StatusChip** `{kind: order|fee|topup|answer|refill|dayEnd|step, value, stepIcon?}`
   - Looks up tone, icon and words from the tables in §3.4, or takes `{tone, icon, label}` directly. `stepIcon` sets the IN_PROGRESS step chip's icon (`van` for Load, `customer` for Deliver, `store` for Unload; default `truck`).
   - Height 28, label 14 semibold, icon 16. Never colour alone.
   - An unknown value shows neutral "Updating…" and logs a warning.
9. **Field** `{label?, value, onChangeText, helper?, error?, optional?, prefix? ('Rs' | '+92'), leadingIcon?, keyboardType, autoCapitalize, maxLength, secure?, rightAction?, onBlur, returnKeyType, accessibilityLabel?}`
   - Label above the input. Optional fields are written "(optional)"; no asterisks. A search box has no visible label: `leadingIcon="search"`, a placeholder and an `accessibilityLabel`.
   - Focus is a 2 px brand border; error is a 2 px danger border plus an icon and the error text below.
   - The accessibility label is the label plus the error.
   - **PhoneField** (a Field with the fixed "+92"): the phone pad, the placeholder `common.phoneExample` "300 1234567", the number spaced as it is typed ("300 1234567"), a typed leading 0 dropped, and a pasted +92, 0092 or 0300 form cleaned. Read its value with `normalizePkPhone`.
10. **AmountChips** `{optionsPaisa, selectedPaisa?, onSelect, columns?, otherLabel?}`. 48 dp radio chips; the selected one is brand with a check. `columns` gives equal cells with the tick inside, so nothing moves when tapped. `otherLabel` adds a last chip ("Other amount") that reports `OTHER_AMOUNT`.
11. **SegmentedControl** `{options:[{value,label,icon?}], value, onChange}`. 48 / 56 dp, `role=radiogroup`. At most 3 segments, labels of 10 characters or fewer.
12. **Stepper** `{value, min, max, onChange, label}`. 48 / 56 dp − and + buttons, `role=adjustable`.
13. **ListRow** `{title, subtitle?, meta?, leadingIcon?, trailing?, below?, onPress?, chevron?}`. At least 64 / 72 dp; the title wraps to 2 lines at most. `below` holds chips (and a row's small action, after the chip) under the text lines and takes no width from the title. Every list uses the WhatsApp-like row: a bold title, one grey line, the time on the right (`rowTime`: "10:46 am" today, else "Yesterday" or "Mon 19 Oct"), the chip below. History is the one exception: its right side shows the amount.
14. **EmptyState** `{icon, title, body?, action?}`: one line of 8 words or fewer, plus at most one button.
15. **ErrorBanner** `{error: ApiError|string, onRetry?, extraAction?, tone}`
    - Inline, never a modal. Shows the mapped message, a 48 dp "Try again", and an optional extra action ("Call office", "Add money").
    - `role=alert` with a live region.
16. **QueryBoundary** `{query, skeleton, isEmpty?, empty, offlineAction?, children(data)}`

    | State | Shows |
    |---|---|
    | first load | skeleton |
    | error, no data, no connection | OfflineEmpty (item 31) "Nothing saved yet.", with its own Try again only while the OfflineBanner is hidden; `offlineAction` adds a button (the driver's trip and step screens pass "Call office") |
    | error, no data, server error | ErrorBanner with "Try again" |
    | error, cached data | the strip "Saved {{time}}" (`common.stale`) with the `history` icon above the data, plus "Try again" only while the OfflineBanner is hidden. The data never remounts (REV mobile-ux-06) |
    | empty | EmptyState |

    Every list and detail screen uses it. A screen with several queries shows one body state, not one card per query.
17. **Skeleton**: static `sunken` blocks, with an optional slow pulse that is off under reduce-motion.
18. **Toast**: `useToast().show({message, tone})`, hosted at the root, shown above the footer for 3 seconds, in a live region. 6 fixed words at most.
19. **ConfirmSheet** `{visible, title, body, amountPaisa?, amountLabel?, reasons?: [{code,label}], requireReason?, noteForOther?, reasonsLabel?, pickReasonLabel?, confirmLabel, confirmTone: primary|danger, cancelLabel, onConfirm(): Promise, onClose}`
    - A bottom-sheet Modal built on `SheetFrame` (scrim, handle, 220 ms slide, Back closes it unless it is busy). The same shell serves PickerSheet.
    - **The buttons are pinned** under the scroll area, with a divider only while the content scrolls, so they never scroll off. **The cancel is `secondary`** (outlined, the same size as the confirm), never a ghost link.
    - Reasons sit under `reasonsLabel`, default `common.confirm.why` "Why?". With `requireReason` the confirm **stays enabled**: pressed without a reason, the label turns into `pickReasonLabel` (default `common.confirm.pickReason` "Pick a reason.") in danger text and the rows scroll into view. The note's error shows only after a press.
    - The confirm shows loading. On error the sheet stays open with the error line (ActionLine) just above the buttons. A request that gets no answer shows the shared `NETWORK_OFFLINE` text "No connection. Try again." there, because the banner is behind the scrim.
    - Both apps use it the same way: the shop's cancel sheets, the driver's Could not deliver, All delivered, Finish trip and Sign out sheets, and the Inc 2 sheets.
20. **StepHeader** `{step, total, title}`: "Step 2 of 3" with a segmented bar.
21. **Timeline** `{items:[{key,label,time?,detail?,state: done|current|todo|problem|stopped}]}`. `stopped` is a neutral cross: a cancelled order ends with it, never with a green tick.
22. **EnvBanner**: a top strip from `appConfig.environment`, falling back to `EXPO_PUBLIC_ENV` until the config loads: training gives "Training · test money only" (`common.env.training`); development, test and staging give "Test server · test money only" (`common.env.test`); production gives none.
23. **OfflineBanner**: "No connection" (`common.offline`) with a 48 dp (driver 56 dp) "Try again" that refetches the active queries. While it shows, screens add no network error of their own, except a button's own failure line.
    - In Inc 1, shown after a network error in the last 30 seconds.
    - From the 0.2.0 APK, driven by NetInfo.
24. **ScanPanel** (`ui/scan/`, owned by the driver lane): the Inc 1 version (§5), full in Inc 2 (§7.1). Take back's camera is clamp(0.18 × window height, 112, 220) dp, so the tap, the strip, the count and the camera fit above the footer on a 360×640 phone (review23 ux-03).
    - Props `step` (LOAD | HANDOVER | TAKE_BACK | UNLOAD), `onScan`, `active` and `complete` (a 200 ms buzz when it turns true).
    - No title, hint or count inside the panel: the CountBar sits above it, and the idle strip is the hint.
    - The result strip is 56 dp with a 32 dp icon; "Checking…" and "Not sent" + Retry show inside the strip. The camera has a 4 dp frame in the result colour.
    - Camera height clamp(0.28 × window height, 160, 300) dp; a paused camera (a sheet open, the screen hidden) is a plain dark block.
    - The screen stays awake while the camera runs (a guarded require of `expo-keep-awake` 13.0.2, already in the binary; a binary without it just loses keep-awake).
    - **SizeLines** (`ui/scan/SizeLines.tsx`) takes translated lines `{key, text, complete?, secondary?}`: "2 × 11.8 kg", or "11.8 kg · 2 of 3" with a tick once that size is complete. The shop's Receive scan (Inc 2) uses it too.
25. **PickerSheet** (NEW): a sheet list on `SheetFrame`. Sections with "Recent" first, a search box shown above 8 rows, a tick on the chosen row, rows that expand in place (`keepOpen`), a row spinner, dividers and action rows. A tap picks and closes. Used by the address picker ("Deliver to"), the refill station above 6, and the Inc 2 Send link sheet (no search).
26. **ChoiceChips** (NEW): `screens/distributor/shared/FilterChips.tsx` moved into `ui/` (the old file is gone). `role=radiogroup`; with `columns` an equal grid, without it the chips wrap: nothing scrolls sideways. History uses `columns={3}`, refill sizes `columns={2}`.
27. **AddMore** (NEW): a ghost "+ Add more" row (`common.actions.addMore`) that opens optional fields in place and stays open.
28. **Fab** (NEW): the primary Button look (brand, `radius.md`, 56 dp, `plus` icon, label always shown) plus `elevation.sheet`, bottom-end 16 dp in, above the safe area, hidden while the keyboard is open. My orders "+ New order", Customers and New order step 1 "+ Add customer", Refills "+ New refill".
29. **CountBar** (NEW; one definition for both apps): a `Card` with the big count (`display`, tabular, never shrinks) and the caller's verb beside it (`heading`), an 8 dp bar (`sunken` track, `brand` fill), one polite live region read as "{{done}} of {{total}} {{verb}}". Its words are `common.count.*`; the caller passes the verb (`scan.verb.*`).

    | Mode | Shows | Used by |
    |---|---|---|
    | target | "2 of 3" + the verb, and the bar | the Inc 1 Load and Deliver steps ("scanned"), Inc 2 Load, Deliver and Unload, the shop's Receive (Inc 2), the refill run (Inc 3) |
    | complete | a success card, the `ok` icon, "All 3 scanned"; bar full in `successGraphic` | the same |
    | over (Inc 1 only) | "4 scanned · 3 needed" in warning text; bar full in `warningGraphic` | Inc 1 Load and Deliver (the legacy route doesn't cap counts) |
    | soft | the number and its label, with no bar ("0 taken back · 2 expected", or "0 taken back" when none is expected); never red, never blocks | Take back |
    | countdown | the number + "on the van"; at 0 the success "Nothing on the van." | the Inc 1 Unload |
30. **ActionLine** (NEW): a footer or sheet button's own failure, one caption line with the `error` icon, directly above the button: "Not sent. Tap again." (`common.notSent`) for no answer, or the mapped message for a refusal, with a 48 dp ghost "Call office" or "Add money" when that is the fix. No second Try again: the button is the retry. The two money buttons pass their own text, "Not sent. Tap again. It won't be sent twice." (`topup.tellUs.notSent`, `orders.new.notSent`).
31. **OfflineEmpty** (NEW): the `offline` icon and "Nothing saved yet." (`common.offlineEmpty`) when a screen has no data and no connection. Calm, never a red card; Try again only while the banner is hidden; an optional `offlineAction`.

Also in `ui/` and `hooks/`: `useNoConnection()` (true while the OfflineBanner shows; the driver's "Location paused" hides then), `isNetworkError(err)`, `useOfficeContact()` (item 4) and the sign-in number kept as `auth.lastPhone` (§3.6).

**Screen rules**
- One primary action per screen, in `Screen.footer`. A list screen's "new" is the Fab instead; no screen has both.
- The header arrow (and Android Back) is the only Back; there is no "Back" text button. A multi-step screen goes back one step (`beforeRemove` is intercepted while the step is above 1), and each step opens scrolled to the top.
- A footer button's own failure is one line just above it (ActionLine). No second Try again.
- A cancel in the content is a `dangerOutline` button, never a footer button.
- A form with input asks "Leave without saving?" / "What you typed will be lost." with Leave and Stay (ConfirmSheet on `beforeRemove`).
- Irreversible money actions use ConfirmSheet, unless the screen is itself a review that names the amount on its button ("Place order · pay Rs 250").
- `Alert.alert` is never used. There are no hex literals in screens, only tokens.

---

## 3. App foundations

### 3.1 API client v2 (rewrite of `api/client.ts`)
- **Timeouts:** 15 seconds by default, 60 for uploads.
- **Headers:** `X-App-Variant`, `X-App-Version`, `X-Request-Id`, `Accept-Language: en`. `X-App-Version` is the JS release (`api/release.ts` `JS_RELEASE_VERSION`; `APP_VERSION` is the later of it and the native version), not the APK's version, which over-the-air updates keep (review23 contract-compat-02).
- **Error normalisation** into `ApiError {status, code, message, details, requestId, retryable}`:

  | What happened | `code` |
  |---|---|
  | no response, timed out | `NETWORK_TIMEOUT` |
  | no response | `NETWORK_OFFLINE` |
  | 5xx | the server code, or `INTERNAL_ERROR` (retryable) |
  | 4xx | the server's code; `UNKNOWN` if it has none |

  The phone never shows raw server text, a stack trace or an HTTP status.
- **401**
  - A **single-flight** refresh: one shared promise calls `POST /auth/refresh` and stores the rotated refresh token, then queued requests retry once.
  - Refresh tokens rotate with reuse detection (auth.service.ts:177-211), so two parallel refreshes would log the user out. Hence single-flight.
  - If the refresh fails: `useAuthStore.clear()` and the Toast "Please sign in again".
- **Idempotency**
  - `newRequestId()` makes a UUID v4. `useIdempotencyKey(deps)` keeps one key per user intent and resets it when `deps` change.
  - Every create and money call sends `Idempotency-Key`, and retries reuse it.
  - Scans send `scanId` (Inc 2).

### 3.2 Errors (`api/errors.ts`)
- **`toUserMessage(err, t)`** returns `t('errors.'+code, params)`.
  - `params` is `details`, with every `*Paisa` value formatted by `formatRs` and the suffix dropped, and every `date` or `*Date` key holding a `YYYY-MM-DD` value formatted by `formatIsoDay` ("Tue 20 Oct") under the same name (API_CONTRACT §2.1).
  - If the code is unknown: the server `message`, then `errors.UNKNOWN`.
  - The English `errors` resource **is** `ERROR_MESSAGE_EN` from shared-types, plus the three `ClientErrorCode` texts.
- **`errorAction(code)`** picks the extra button:
  - ADD_MONEY for `WALLET_INSUFFICIENT_BALANCE`;
  - CALL_OFFICE for `*_NO_STORE`, `AUTH_ACCOUNT_NOT_ACTIVE`, `DISTRIBUTOR_NOT_ACTIVE`, `AUTH_ROLE_LOCKED`, `TOPUP_ACCOUNT_NOT_CONFIGURED`, `ORDER_HANDOVER_STARTED`, `SCAN_NOT_ON_YOUR_VAN` and `SCAN_CYLINDER_BLOCKED`;
  - SIGN_IN for `AUTH_*` 401s;
  - UPDATE_APP for `APP_UPDATE_REQUIRED`;
  - RETRY for anything retryable.

### 3.3 i18n (`src/i18n/`)
- **Resources** are TypeScript modules in `en/`, one file per namespace, merged into the default namespace.
  - The **foundation** owns `common`, `auth`, `stages`, `errors`, `money`.
  - The **shop lane** owns `home`, `wallet`, `topup`, `customers`, `orders`, `refill`.
  - The **driver lane** owns `driver`, `scan`.
  - Inc 2 adds `store` and `confirm` (shop); Inc 3 adds `dayEnd` (shop).
- **Typed keys:** `declare module 'i18next' { interface CustomTypeOptions { resources: { translation: typeof en } } }`. A missing key fails `npm run typecheck` (this fixes M6).
- **Keys** follow `area.screen.element`. Plurals use the v3 `_plural` suffix: `key` is the singular (count 1) and `key_plural` every other count, with the count passed as `count`. Every string that shows a count has both.
- **No concatenated sentences:** only interpolation, such as `"{{done}} of {{total}} loaded"`.
- **English only for the pilot.** The language switch is hidden; `i18n/persist.ts` is kept.
- **Urdu-ready:** use `marginStart/End`, never left/right. Chevrons flip with `I18nManager.isRTL`. Numbers and cylinder codes are wrapped in LTR isolates.
- **Dates:** `formatWhen(iso, now, t)` (shared-utils) gives "Today, 4:12 pm", "Yesterday, 9:05 am" or "Mon 19 Oct, 4:12 pm" in Asia/Karachi, with no Intl dependency on Hermes. Today and Yesterday are Asia/Karachi calendar days, not the 03:00 business day. A time later today still reads "Today"; any other day reads as a date, with the year added when it isn't now's year ("Sun 19 Oct 2025, 4:12 pm"). Day headings use `formatDayLabel` with the same rule. Business-day screens (day-end, "done today") use `businessDate`, never `formatWhen`.

### 3.4 Status words. The server sends stable values; the phone maps them.
The words live in `i18n/en/stages.ts` and the tones and icons in `ui/statusTables.ts`, as UX_PRINCIPLES §4 sets them (the 2026-10-23 changes are built).

**Order stage** (`stages.order.*`)
| Stage | Words | Tone / icon |
|---|---|---|
| NEEDS_DRIVER | Waiting for driver | warning / checking |
| DRIVER_ASSIGNED | Driver assigned | brand / customer |
| LOADING | Loading | brand / store |
| ON_THE_WAY | On the way | brand / truck |
| DELIVERED | Delivered | success / ok |
| NOT_DELIVERED | Not delivered | danger / error |
| CANCELLED | Cancelled | neutral / none |

**Fee** (`stages.fee.*`)
| Status | Chip |
|---|---|
| DEDUCTED | "{{fee}} paid" (neutral) |
| REVERSED | "{{fee}} returned" (success) |
| NONE | "No delivery cost" (neutral) |

- On My orders a cost chip shows only on a cancelled Done row: "Rs 250 returned", or "No refund" (neutral, `orders.list.noRefund`) when the cost was taken and kept. The order detail says the same: "No refund. Delivery had started.".
- The long forms "Paid from your wallet" / "Returned to your wallet" are no longer shown.

**Top-up stage** (`stages.topup.*`)
| Stage | Words | Tone |
|---|---|---|
| BEING_CHECKED | Being checked | warning |
| ADDED | Added | success |
| NOT_ADDED | Not added | danger |

The reason text for NOT_ADDED comes from `topup.reason.<TopupRejectReason>`.

**Statement kinds** (`wallet.kind.*`): a History row's title is the kind only (the lead, review finding mobile-ux-05).
| Kind | Words |
|---|---|
| TOPUP_ADDED | Top-up |
| DELIVERY_COST | Delivery cost |
| DELIVERY_COST_RETURNED | Refund |
| CORRECTION | Office correction |
| OPENING_BALANCE | Opening balance |
| LEGACY | Older entry |

Correction reasons (`wallet.correction.*`), the shop's words. The office keeps its own words on the website (UX_ADMIN §2.6); this split replaces settled point G16-06's one label set.
| Code | Words |
|---|---|
| WRONG_TOPUP_APPROVAL | Top-up added by mistake |
| SYSTEM_ERROR | Mistake fixed |
| BANK_REVERSAL | Bank reversed a top-up |
| OPENING_BALANCE | Opening balance |
| OTHER | (no reason line) |

**Driver step** (`stages.step.*`; `StatusChip kind="step"`)
| Value | Words | Tone / icon |
|---|---|---|
| TO_DO | To do | neutral / none |
| NEXT | Next | brand / chevron |
| IN_PROGRESS | In progress | brand / the step's icon (`stepIcon`: Load `van`, Deliver `customer`, Unload `store`; a trip on Today `truck`), never the clock |
| DONE | Done | success / ok |
| NOT_DELIVERED | Not delivered | danger / error (the order FAILED) |
| CANCELLED | Cancelled | neutral / none (the order or stop was cancelled, or the office stopped the trip) |

SKIPPED "Skipped" is gone; aborted trips are no longer listed. A stop of a COMPLETED trip that was never closed shows Done.

**Customer answer** [Inc 2] (`stages.answer.*`), settled point G07-23 as the lead kept it on 2026-10-23
| Answer | Words | Tone / icon |
|---|---|---|
| YES | Customer: all received | success / ok |
| PARTLY | Customer: partly received | warning / warn |
| NO | Customer: not received | danger / error |
| OTHER | Customer sent a note | warning / warn |
| PENDING | Waiting for customer | warning / checking (the amber clock) |
| EXPIRED | No answer | neutral / none |

It is shown as a separate chip, never as the order stage.

**Refill stage** and **day-end** words are in §8.1 and §8.3 (`stages.refill.*`, `stages.dayEnd.*`).

### 3.5 Data fetching and network
- **QueryClient:** `staleTime 30s`; queries retry twice for retryable errors (1 s, 2 s, 4 s backoff); `refetchOnReconnect`.
  - An AppState-driven `focusManager` replaces App.tsx:12-14.
  - Mutations use `retry 0`; the user retries by hand with the same idempotency key.
- **Polling:** `useFocusedInterval(ms)` polls only while the screen is focused and the app is active.
- **Keys:** central `qk.*` keys in `api/keys.ts` (Appendix C).
- **Mutations:** a loading button, then a Toast on success or an ErrorBanner with "Try again".

### 3.6 Shell
- **RootNavigator gates**, in order:
  1. `UpdateRequired`, on `APP_UPDATE_REQUIRED` (or `APP_RESTART_TO_UPDATE`, which only the 0.1.0 JS should ever get) or when `appConfig.minVersion` is above this app's version (`APP_VERSION`, the value sent as `X-App-Version`);
  2. `SignIn`, with no session;
  3. `WrongApp`, unless the variant is distributor with role DISTRIBUTOR, or driver with role DRIVER. This is a fallback for a saved session (for example one from before the update); a new sign-in on the wrong app is refused by the server with `AUTH_WRONG_APP` (S1);
  4. otherwise the stack.

  ClientStack and OtpScreen leave navigation; the files are kept.
- **`useAppConfig()`** reads `GET /app/config` (public, cached 5 minutes; S9 'Check and place' refetches it). Menus and tiles read `features.*`, so each increment switches on per server without a new build.
- **Kept on the phone** (`expo-secure-store`, already in the 0.1.0 binary; display conveniences only):
  - `support.contact`: the `support` block (phone, WhatsApp, hours) of each good `/app/config` answer. `useOfficeContact` uses it until the server answers, so "Call office", the header call button and "Forgot password?" work with no connection. The company bank account is never read from storage: a stale account is a money risk.
  - `auth.lastPhone`: the number of the last good sign-in. Sign in prefills it, in both apps; Sign out keeps it.
- **The side menu** renders items from `navigation/menus/distributorMenu.ts` and `driverMenu.ts`. Each lane owns its own file. Rows have one word or two and no subtitles; neither header shows a balance.
  - Shop: the header is the business name and phone; rows Profile · Help · Sign out.
  - Driver: the header is the name and the van plate; rows My van · Refills · Help · Sign out. Refills shows the count of open refills ("Refills, 2 open" to screen readers; review23 ux-02).
  - Sign out asks first (rule 7): "Sign out?" / "You'll need your password." / [Sign out] (danger) / [Stay signed in] (secondary).
- **Typed routes:** `DistributorStackParams` and `DriverStackParams` replace the 18 `useNavigation<any>()` calls.

### 3.7 Money in the app
- Paisa stays an integer end to end; the API sends a string. `toPaisa(x)` asserts `Number.isSafeInteger`.
- Only `formatRs` divides by 100:
  - 345000 → "Rs 3,450"
  - 345050 → "Rs 3,450.50"
  - −25000 → "−Rs 250" (and, with `sign: 'always'`, 500000 → "+Rs 5,000")
- **Rupee input** accepts digits only and shows grouping as you type. `parseRupeesInput("5,000")` returns 500000.

---

## 4. Increment 1: shop app screens
Rebuilt to UX_PRINCIPLES on 2026-10-23 (the shop spec, with the lead's DECIDED answers). Patterns on every screen:
- **States, one message per problem** (§2.2 #16, #30, #31): a skeleton in the final layout; the one OfflineBanner "No connection · Try again" with saved data stamped "Saved 4:12 pm", or "Nothing saved yet." with nothing saved; a server error as one ErrorBanner; a footer button's own failure as the ActionLine above it; inside a sheet, the error line above its pinned buttons.
- **The bottom:** one main `lg` button in the footer, or a Fab on a list screen. A main button is disabled only when a visible line says why ("Pick a size first."); otherwise it stays enabled and points at what is missing when pressed. Cancels are never in the footer.
- **Back:** the header arrow is the only Back; New order and Add customer go back one step; each step opens at the top.
- **Rows:** the WhatsApp-like row (§2.2 #13), time on the right with `rowTime`. History is the one list with the amount on the right.
- **Money and time:** `MoneyText`/`formatRs`; a delivery cost is one amount per order ("Delivery cost Rs 250", DECISIONS ADR-08), with no parts, no "=" and no zone names. Checking hours are 12-hour through `formatClock` (shared-utils): "9 am to 9 pm".
- **No zone names** anywhere in the shop app (§0).

### S1 Sign in, Wrong app, Update required (foundation; shared by both apps)
- **Layout**
  - No header. The brand tile (`truck`), `common.appName` "Smart Fleet" and the subtitle "Shop app" (the driver build: "Driver app"). No "Sign in" heading and no helper line.
  - PhoneField "Mobile number" (§2.2 #9): "+92" fixed, the placeholder "300 1234567", spaced as typed, a typed leading 0 dropped. It is **prefilled with the last signed-in number** (`auth.lastPhone`, §3.6), in both apps.
  - Field "Password", with a 48 dp Show/Hide.
  - Footer: the error line (when there is one), the primary "Sign in" ("Signing in…"), then the ghost "Forgot password?" with the `call` icon (screen readers: "Forgot password? Call the office"). It opens the dialler, and is hidden when no office number is known from the config or `support.contact`.
  - The language pills and the OTP fallback are removed.
- **States:** while signing in the fields are read-only. Errors show on the line just above "Sign in", and typing clears it: `AUTH_INVALID_CREDENTIALS` "Wrong phone number or password.", `AUTH_WRONG_APP` ("This account is for the Smart Fleet Driver app." / "…shop app."; no session starts, so the WrongApp screen doesn't open), `AUTH_ACCOUNT_NOT_ACTIVE` and `AUTH_ROLE_LOCKED` (with [Call office]), `RATE_LIMITED`, and with no answer the banner plus "Not sent. Tap again.".
- **Copy**

  | Key | Text |
  |---|---|
  | `auth.signIn.subtitle_distributor` / `_driver` | Shop app / Driver app |
  | `auth.signIn.phone` | Mobile number |
  | `auth.signIn.phonePlaceholder` | 300 1234567 |
  | `auth.signIn.phoneInvalid` | Enter a number like 300 1234567. |
  | `auth.signIn.password` / `.passwordRequired` | Password / Enter your password. |
  | `auth.signIn.show` / `auth.signIn.hide` | Show / Hide |
  | `auth.signIn.submit` / `auth.signIn.submitting` | Sign in / Signing in… |
  | `auth.signIn.forgot` / `.forgotA11y` | Forgot password? / Forgot password? Call the office |

- **WrongApp** (only the §3.6 fallback gate, for a saved session whose role doesn't fit this build): the badge, the title, one line, and one button, "Sign out".

  | Key | Text |
  |---|---|
  | `auth.wrongApp.title` | Wrong app |
  | `auth.wrongApp.driverAccount` | This account is for the Smart Fleet Driver app. |
  | `auth.wrongApp.shopAccount` | This account is for the Smart Fleet shop app. |
  | `auth.wrongApp.officeAccount` | Office accounts use the Smart Fleet website. |
  | `auth.wrongApp.otherAccount` | This account can't use this app. Call the office. |

- **UpdateRequired:** the download badge, the title and one line. With `links.updateUrl` set, the primary "Get new version" with the secondary "Call office" above it; with no link, "Call office" is the only button, as primary.

  | Key | Text |
  |---|---|
  | `common.update.title` | Update the app |
  | `common.update.body` | This version is too old. |
  | `common.update.download` | Get new version |
  | `common.actions.callOffice` | Call office |

### S2 Home (`distributor/HomeScreen.tsx`)
```
[Salam, Ahmed Gas                     menu]   <- the greeting is the header title
+ Wallet card (brand) -------------------+
| Balance                                |
| Rs 3,450              [! Low balance]  |   chip only when lowBalance
| (history) Saved 11:08 am               |   only when stale
| (clock) Being checked      Rs 5,000  > |   only when > 0
| [         Add money          ]         |
+----------------------------------------+
[Get started]                                 new shop only
(Inc 2/3 status rows: customer problems, Receive from driver, Day-end sheet)
[My orders (3)]   [Customers]
[History]         [Refills]
Active orders
  Sana / 2 × 11.8 kg · AG-0007 / 10:46 am / [Waiting for driver]
  (up to 3 rows, then "+2 more")
[            New order            ]   <- footer, lg
```
- **Data:** `GET /distributor/home` and `GET /users/me`; `GET /orders?tab=active` (the first page, shared with My orders, polled every 30 s while Home is focused and only while `orders.active` > 0); `GET /clients` only for a new shop (no active orders and none delivered today).
- **Wallet card** (`Card tone="brand"`, same look)
  - Loading shows skeleton bars, never "Rs 0". On error: "Couldn't load your balance." with an inverse "Try again".
  - **Low balance:** when `lowBalance` is true (the balance is below `wallet.lowBalancePaisa`, not equal to it; Rs 0 turns the warning off), the warning chip "Low balance" (`warn` icon) beside the amount. It replaces the old low-balance card and its second "Add money".
  - Stale data: "Saved {{time}}" with the `history` icon inside the card only, plus an inverse "Try again" while the banner is hidden.
  - "Being checked" (only above 0) opens the one top-up being checked, or History with the Top-ups filter when there are several.
  - One button, "Add money".
- **Get started** (a new shop only, while it has no customers): a card with three rows, "Add money" (a tick once money is in or being checked), "Add a customer" and "Place an order". It replaces the "Today: 0 active orders" tile and the low-balance sentence.
- **Tiles** (a 2-column grid, each at least 96 dp, no second line): "My orders" (`order`, with a brand count badge while orders are active), "Customers" (`customers`), "History" (`wallet`), "Refills" (`cylinder`).
- **Active orders:** up to 3 rows (S10's row), newest first, then "+{{count}} more" opening My orders.
- **Inc 2/3 status rows** sit above the tiles, in this order: customer problems, Receive from driver, Day-end sheet (§7.3, §8.3). In Inc 1 the problems row keeps its current look until Inc 2 builds it.
- **Store not set or account not active:** the footer becomes the line "Your store isn't set up yet." (or "Your shop account isn't active.") above a primary "Call office"; with no office number known, the line and a disabled "New order".
- **Removed:** the "History ›" link in the card, the low-balance card, the "Today" tile, the grey line on every tile, and the greeting line in the content.
- **Copy**

  | Key | Text |
  |---|---|
  | `home.greeting` | Salam, {{name}} |
  | `wallet.card.balance` / `.beingChecked` / `.addMoney` | Balance / Being checked / Add money |
  | `home.lowBalance` | Low balance |
  | `common.stale` | Saved {{time}} |
  | `home.getStarted.title` / `.addMoney` / `.addCustomer` / `.newOrder` | Get started / Add money / Add a customer / Place an order |
  | `home.getStarted.done` | Done (screen readers hear it after "Add money" once that row has its tick) |
  | `home.tiles.orders` / `.customers` / `.history` / `.refills` | My orders / Customers / History / Refills |
  | `home.tiles.ordersA11y` (`_plural`) | My orders, {{count}} active (what screen readers hear for the tile with its badge) |
  | `home.activeTitle` / `home.moreOrders` (`_plural`) | Active orders / +{{count}} more |
  | `home.newOrder` | New order |
  | `home.noStore` / `home.notActive` | Your store isn't set up yet. / Your shop account isn't active. |

- **Menu** (§3.6): Profile, Help and Sign out, with no subtitles and no balance; the header shows the business name and phone. Wallet and My orders are Home tiles.

### S3 Add money: Amount (`distributor/topup/TopupAmountScreen.tsx`)
- **Layout**
  - StepHeader "Step 1 of 3"; title "How much do you want to add?".
  - While top-ups are being checked: a quiet row with the clock, "Being checked" and the amount (Home's row).
  - AmountChips in **2 columns** from `topup.quickAmountsPaisa`, plus a last chip **"Other amount"**: with three quick amounts, a 2×2 grid. **No keyboard on open** (no `autoFocus`).
  - "Other amount" opens a RupeeField labelled "Other amount", focused, with the helper "Rs 500 to Rs 50,000" (from `GET /payments/topup-info`).
  - The caption "Money is checked 9 am to 9 pm." (`formatClock`; moved here from S4, so a person paying at 10 pm knows first).
  - Footer "Next", always enabled: with nothing chosen it shows "Pick an amount." under the chips; "Other amount" with nothing typed shows the minimum under the field; a chip over the cap shows its error under the chips.
- **Prefill:** opened from an order short of money, the larger of the minimum and the shortfall rounded up to Rs 100; from "Tell us again" (S6), the request's amount. A prefill equal to a chip selects the chip, otherwise "Other amount" with the field filled.
- **Errors:** `topup.amount.tooLow` "The minimum is {{min}}"; `topup.amount.tooHigh` "Up to {{max}} per top-up. Send two for more."
- **States:** a skeleton while the info loads (the chips can come from `config.topup` offline). `TOPUP_ACCOUNT_NOT_CONFIGURED`: an ErrorBanner ("Top-ups aren't open yet. Call the office.") with "Call office", and Next is blocked.

### S4 Add money: How to pay (`TopupHowToPayScreen.tsx`)
- **Layout**
  - StepHeader "Step 2 of 3", titled **"Pay Rs 5,000"**, with a 48 dp copy icon button beside it (screen readers "Copy amount"; toast "Copied").
  - SegmentedControl "Easypaisa" | "Bank app", prefilled from the last top-up's channel (`qk.topups.mine`), else Easypaisa. It is the channel sent on S5.
  - Account card, no labels: the account name in bold, then "Check this name before sending." (`warningText`, `warn` icon), the bank, the IBAN in mono grouped by 4, and "Copy IBAN" (toast "Copied").
  - **One path line** instead of numbered steps, with `chevron` icons that flip right-to-left: Easypaisa "Bank Transfer › {{bank}} › Paste IBAN"; Bank app "Transfer › Paste IBAN".
  - The caption "We never send account numbers on WhatsApp."
  - Footer **"I've paid"**, enabled once the account has loaded.
- **States:** a skeleton card; with nothing saved and no connection, "Nothing saved yet." (the account is never shown from storage); `TOPUP_ACCOUNT_NOT_CONFIGURED` with "Call office". On a test server the account card shows the dummy account under the EnvBanner.
- **Copy**

  | Key | Text |
  |---|---|
  | `topup.howToPay.title` | Pay {{amount}} |
  | `topup.howToPay.easypaisa` / `.bankApp` | Easypaisa / Bank app |
  | `topup.howToPay.checkName` | Check this name before sending. |
  | `topup.howToPay.copyIban` / `.copyAmount` / `.copied` | Copy IBAN / Copy amount (the icon's label) / Copied |
  | `topup.howToPay.ep.transfer` / `.ep.bank` / `.app.transfer` / `.pasteIban` | Bank Transfer / {{bank}} / Transfer / Paste IBAN |
  | `topup.howToPay.noWhatsApp` | We never send account numbers on WhatsApp. |
  | `topup.howToPay.paid` | I've paid |

### S5 Add money: Tell us you paid (`TopupTellUsScreen.tsx`)
- **Layout**
  - StepHeader "Step 3 of 3"; title "Tell us you paid".
  - The read-only line "Rs 5,000 · Easypaisa": the amount and channel carried from S3 and S4 (the header arrow goes back to change them). **"Amount sent" and "Paid with" are gone, and "Other" is no longer offered** (the lead, 2026-10-23).
  - Field **"Name on the account"**: words capitalised, at most 60 characters, prefilled from the last top-up's name (`qk.topups.mine`) or from "Tell us again". Its helper follows the channel: "As Easypaisa shows it." or "As your bank app shows it." (`topup.tellUs.payerNameHelp.EASYPAISA_APP` / `.BANK_APP`, keyed by the channel's own value).
  - The screenshot tile "Add screenshot" (`pickAndUploadImage`, quality 0.5, purpose TOPUP_PROOF): "Uploading…", then a thumbnail, "Screenshot added" and "Remove"; "Upload failed. Try again." never blocks sending. "Helps us find it faster" is its screen-reader hint.
  - AddMore "+ Add more" opens "Transaction ID" (optional; letters, digits and dashes, at most 40).
  - Footer: the error line, then "Send for checking" ("Sending…"), with the screen's idempotency key. It is enabled whenever no upload is running; an empty name is checked on press and shows "Write the name on the account." on the field.
- **API:** `POST /payments/topup-requests { amountPaisa, payerName, payerChannel, transactionId?, proofFileId? }`. The key's deps are `[amountPaisa, name, channel]`, so a retry always reuses it.
- **On success:** `replace('TopupStatus', {id})`, so Back doesn't return to the form, and the toast "Sent for checking".
- **Errors** (the footer line): no answer "Not sent. Tap again. It won't be sent twice." (`topup.tellUs.notSent`), entries kept; `TOPUP_ACCOUNT_NOT_CONFIGURED` and `DISTRIBUTOR_NOT_ACTIVE` with a ghost "Call office"; `TOPUP_TOO_MANY_PENDING`, `TOPUP_WOULD_EXCEED_CAP`, the amount limits, `FILE_NOT_FOUND`; `VALIDATION_FAILED` at the fields ("Use letters, numbers and dashes only." for the transaction ID).

### S6 Add money: Status (`TopupStatusScreen.tsx`)
- **Layout:** header "Top-up AG-T005" (the code shows once). The big amount (`creditedPaisa` once added), the `topup` chip, then by stage:
  - **Being checked:** a Timeline "Sent {{time}}" → "Being checked" ("Usually within 1 hour, 9 am to 9 pm", or "Checking starts at 9 am." outside the hours) → "Added to your balance". Footer "Back to home".
  - **Added:** a success card "Balance now" with the balance, and the caption "Added {{when}}". No timeline. When the amounts differ: "You told us Rs 5,000. Call office if this is wrong.", with a secondary "Call office" above "Back to home".
  - **Not added:** a danger card with `topup.reason.<code>` and "The office wrote: “…”". Footer: the secondary "Call office" above the primary **"Tell us again"**, which resets the stack to Amount › How to pay › Tell us you paid, all prefilled, and opens on Tell us you paid: nothing asks the person to pay again. A request paid "Other" comes back as Easypaisa.
- "Back to home" goes straight to Home. A New order left under the status screen (Add money from "Check and place") closes without "Leave without saving?" and its draft is dropped: it can't be placed until the top-up is added.
- **Polling:** every 30 seconds while being checked and focused, plus pull to refresh.
- **Reasons**

  | Key | Text |
  |---|---|
  | `topup.reason.NOT_IN_BANK` | We can't see this payment in our bank yet. |
  | `topup.reason.AMOUNT_DIFFERENT` | The amount in our bank is different. |
  | `topup.reason.NAME_DIFFERENT` | The name on the account doesn't match our bank. (word for word the website's reject preview, UX_ADMIN §2.2) |
  | `topup.reason.DUPLICATE` | This payment was already used for another top-up. |
  | `topup.reason.OTHER` | The office couldn't approve it. |

### S7 History (`distributor/WalletScreen.tsx`; replaces the unrouted `LedgerScreen.tsx`)
- **Layout**
  - Header **"History"** (the one name for the wallet's list).
  - A summary card: "Balance", and "Being checked" with the clock when above 0 (a tap switches the filter to Top-ups in place).
  - ChoiceChips with `columns={3}`: **All · Top-ups · Delivery costs**. They wrap to 2 rows at the largest font.
  - Day sections ("Today", "Yesterday", "Mon 19 Oct").
- **Rows, All and Delivery costs** (`GET /wallet/statement`; Delivery costs is `kind=DELIVERY_COST,DELIVERY_COST_RETURNED`):
  - the title is the kind only (§3.4): "Delivery cost", "Refund", "Top-up", "Office correction", "Opening balance", "Older entry";
  - the grey line is the number and customer ("AG-0142 · Sana", `wallet.history.subjectLine` "{{code}} · {{name}}"), the top-up number ("AG-T031"), or the correction reason ("Mistake fixed", "Top-up added by mistake"; nothing for Other); a correction that also points at an order or top-up shows both, with `wallet.history.lineWithReason` "{{line}} · {{reason}}";
  - on the right, the signed `MoneyText` (success colour for money in) with the time under it;
  - a chevron on rows that open their order or top-up; a row that opens nothing keeps the chevron's room, so the amounts line up.
  - **No "Balance after"** (the lead, 2026-10-23). The website wallet page keeps the full history for the office.
- **Top-ups filter** (`GET /payments/mine`, every state, because rejected requests never reach the ledger): every request in the same shape: the title "Top-up" (`wallet.history.topupTitle`), the grey line "AG-T031 · Ahmed Raza" (plus "You told us Rs 5,000" when the amounts differ), the amount (credited when added) and time on the right, and the `topup` chip below. A row opens S6. The old "Money added" and "Top-up requests" filters are merged into it.
- **Paging:** cursor, 30 per page, `onEndReached`, "Loading more…", "Couldn't load more." with Try again.
- **Empty:** "No money movements yet." with "Add money" (History has no footer or Fab, so the empty state keeps its button); Top-ups: "No top-ups yet." with "Add money".

### S8 Add customer (`distributor/AddCustomerScreen.tsx`; replaces `AddClientScreen.tsx`)
- **Step 1 of 2, "Customer details"**
  - Name (required). PhoneField **"Mobile number"** (the Sign in label; normalised on blur; `CLIENT_PHONE_INVALID` "Enter a number like 300 1234567."). **House and street** (required, at most 60; moved here from step 2).
  - AddMore "+ Add more" opens **Area** (one visible "Area" label, up to 4 ChoiceChips of the shop's most used areas from `qk.clients`, then the field) and **Notes**.
  - Footer "Next": it checks the three fields and shows each error under its field.
  - `CLIENT_PHONE_EXISTS` (from the save) comes back here with "{{name}} already has this number." and a secondary "Use {{name}}".
- **Step 2 of 2, "Delivery location"**
  - Search (`leadingIcon="search"`, placeholder "Search area or street"); results show as rows under it.
  - The 240 dp map opens on the shop's store; a tap drops the pin, which can be dragged. A secondary "Use my location" (`navigate`) sits over its bottom-end corner and asks for permission on that tap only.
  - **One line under the map**, refreshed by `GET /pricing/quote?lat&lng` (400 ms debounce):

    | State | Line |
    |---|---|
    | no pin | "Tap the map to drop the pin." |
    | checking | "Checking delivery area…" |
    | priced | the `ok` icon and "Delivery cost Rs 250": the one cost per order there, whatever the cylinders (`customers.cost.priced` "Delivery cost {{cost}}"; no caption) |
    | `PRICING_ZONE_NOT_COVERED` | "Outside our delivery area. Move the pin." |
    | `PRICING_PRICE_NOT_SET` | "No delivery price here yet." with a secondary "Call office" |
    | error | "Couldn't check this spot." with "Try again" |

    A failed "Use my location" adds one danger caption: "Allow location in phone settings, or search." or "Couldn't find you. Search or tap the map.". **No zone name.**
  - Footer "Save customer" ("Saving…"), enabled only when the pin is priced; the line under the map always says why when it isn't.
- **Save:** one atomic `POST /clients` with `address`.
- **Success:** the toast "Customer saved". Opened from New order (or "Use {{name}}"), it opens New order on step 2 for that customer; opened from Customers, it goes back there.
- City chips, priority and credit limit are removed.

### S8b Customers (`distributor/CustomersScreen.tsx`, new in Inc 1; route `Customers`)
Customers and New order step 1 share one list, `screens/distributor/shared/CustomerList.tsx`.
- **Layout**
  - Header "Customers". A search box (`search` icon, placeholder "Search name, mobile or area", screen readers "Search customers") filters the downloaded list on the phone.
  - **"Recent"**: up to 5 customers of the newest orders, from the first pages of `qk.orders.list('active')` and `('done')` (fetched when not cached; hidden if either fails, and while searching). Then **"All customers"**, A–Z.
  - **Row:** the name; the grey line "0300 1234567 · Model Town"; a trailing 48 dp call button (screen readers "Call {{name}}", a `tel:` link). Below, only when the default address can't take an order, a danger chip with the `error` icon: "No price yet", "Outside delivery area" or "No address yet". No zone chip.
  - **A row tap starts a New order for that customer**, opening on step 2 (`navigate('NewOrder', { clientId, pickedAt })`). A blocked row instead opens in place, one at a time, and scrolls to the top of the list so its fix is never under the Fab: "No delivery price here yet." or "Outside our delivery area." with [Change address] and [Call office] **stacked** ("Change address" is too long to sit side by side at 360 dp), or "No delivery address yet." with [Add address]. [Change address] opens the address PickerSheet (S9); picking an orderable address starts New order on step 2 with it. [Add address] opens New address, which then starts New order.
  - The **Fab** "+ Add customer" opens Add customer; on save it comes back here with the toast "Customer saved".
- **States:** the search box then 5 skeleton rows; empty "No customers yet." (the Fab stays); no match "No customer matches “{{query}}”."; errors as §4's patterns.

### S9 New order (`distributor/NewOrderScreen.tsx`; 3 steps)
- **Step 1 of 3, "Who is it for?"**: the CustomerList (S8b) without the call button. A tap on an orderable customer selects them and **goes straight to step 2**; there is no Next and no footer. A blocked row opens in place (S8b). The Fab "+ Add customer" opens Add customer and comes back on step 2 with the new customer. Back from step 2 shows the list with the chosen row ticked.
- **Step 2 of 3, "Cylinders to deliver"**
  - The caption "For Sana · House 14, Street 5".
  - One row per size, sorted by weight: a Stepper labelled with the size, then, while it is above 0, an indented "Take back" Stepper that follows it until changed.
  - **Every count starts at 0** (the lead, 2026-10-23: never prefill silently, so no wrong order goes out by accident). While nothing is chosen and the customer has ordered before, a one-tap chip **"Same as last time"** fills the sizes, counts and take-back of the customer's newest order in the cached first pages of Active and Done; it hides once a count is set.
  - Footer: the line "Delivery cost Rs 250" (the address's one cost per order, `orders.new.costPerOrder`; hidden at Rs 0), or "Add at least 1 cylinder." with nothing chosen (Next is then disabled), plus "Up to 30 cylinders per order." at the cap (`orders.maxCylindersPerOrder`); then "Next".
- **Step 3 of 3, "Check and place"**
  ```
  Sana · 0300 1234567
  House 14, Street 5                         [Change]
  ---------------------------------------------------
  2 × 11.8 kg · take back 2
  ---------------------------------------------------
  Delivery cost                                Rs 250    (big)
  ---------------------------------------------------
  Balance now                               Rs 5,000
  After this order                          Rs 4,750
  (i) Refund only if cancelled before loading.
  [ Place order · pay Rs 250 ]
  ```
  - **Data:** `POST /orders/quote` on entry and on every change. "Change" opens the address PickerSheet "Deliver to" (`screens/distributor/shared/AddressPickerSheet.tsx`): the saved addresses with a tick on the current one, blocked ones with their chip (opening in place, the sheet staying open), and a last row "+ New address" that opens the **New address** screen (`NewAddressScreen.tsx`, route `NewAddress`: House and street, then S8's location picker and cost line, "Save address"; toast "Address saved"). Saving from step 3 comes back to step 3 with the new address. New address and "Use {{name}}" can also start from Customers or Home: they then replace themselves with New order on step 2, so Back returns where they started.
  - **The refund line** follows `appConfig.orders.deliveryStartedAt`, read fresh (the app refetches `GET /app/config` when this step opens):

    | Key | Text |
    |---|---|
    | `orders.new.refundRule.FIRST_LOAD_SCAN` | Refund only if cancelled before loading. |
    | `orders.new.refundRule.DRIVER_ASSIGNED` | Refund only if cancelled before a driver is assigned. |
    | `orders.new.refundRule.LEFT_STORE` | Refund only if cancelled before the van leaves. |

    It is hidden when the cost is 0 or the balance is short.
  - **Footer lines** above the button, at most one: short of money "You need {{required}}. You have {{balance}}." (danger), and the button becomes "Add money", opening S3 prefilled; `PRICING_QUOTE_CHANGED` "The delivery cost is now {{total}}. Check it, then tap again." (warning), with the cost refreshed; no answer "Not sent. Tap again. It won't be sent twice." (`orders.new.notSent`).
  - A blocked address (`PRICING_PRICE_NOT_SET` / `PRICING_ZONE_NOT_COVERED`) shows the S8b line with [Change address] and [Call office] stacked. A quote that failed shows "Couldn't get the cost." with "Try again".
  - **Submit:** `POST /orders` with `Idempotency-Key` and `quotedTotalPaisa`. `WALLET_INSUFFICIENT_BALANCE` shows the short-of-money line.
  - **Success:** replace with Order detail and the toast "Order placed · {{fee}} paid".
  - **A zero cost:** "No delivery cost", the wallet lines hidden, and the button "Place order".
- **Copy**

  | Key | Text |
  |---|---|
  | `orders.new.title` / `.who` / `.cylinders` / `.review` | New order / Who is it for? / Cylinders to deliver / Check and place |
  | `orders.new.forCustomer` | For {{name}} · {{address}} |
  | `orders.new.sameAsLast` | Same as last time |
  | `orders.new.takeBack` / `.costPerOrder` / `.pickSome` | Take back / Delivery cost {{fee}} / Add at least 1 cylinder. |
  | `orders.new.noPrice` / `.outside` / `.noAddress` | No price yet / Outside delivery area / No address yet |
  | `orders.new.change` | Change |
  | `orders.new.deliveryCost` / `.costNone` / `.costError` | Delivery cost / No delivery cost / Couldn't get the cost. |
  | `orders.new.balanceNow` / `.balanceAfter` | Balance now / After this order |
  | `orders.new.notEnough` / `.priceChanged` | You need {{required}}. You have {{balance}}. / The delivery cost is now {{total}}. Check it, then tap again. |
  | `orders.new.place` / `.placeFree` / `.placing` | Place order · pay {{fee}} / Place order / Placing order… |
  | `orders.new.placed` / `.officeAssigns` | Order placed · {{fee}} paid / The office will assign a driver. |
  | `customers.address.title` / `.addNew` | Deliver to / New address |

### S10 My orders (`distributor/OrdersScreen.tsx`, `shared/OrderRow.tsx`)
- **Layout:** SegmentedControl "Active ({{n}})" | "Done".
  - Each row: the customer's name; the grey line "2 × 11.8 kg · AG-0007"; the time on the right ("10:46 am"); the stage chip below; a chevron.
  - A cost chip only on a **cancelled Done row**: "Rs 250 returned", or "No refund" when the cost was kept. Active and delivered rows have none.
  - The **Fab** "+ New order".
- **Data:** `GET /orders?tab=active|done&cursor`, every 30 seconds while focused, plus pull to refresh.
- **Empty:** Active "No active orders." (the Fab is the button); Done "No finished orders yet.".

### S11 Order detail and cancel (`distributor/OrderDetailScreen.tsx`)
The live socket is removed.
- **Layout**
  - Header "Order {{shortCode}}".
  - The stage chip. While waiting for a driver, the caption "The office will assign a driver.".
  - **Active orders:** the Timeline "Placed · {{fee}} paid" → "Driver assigned" → "Loading" → "On the way" → "Delivered", each with its time.
  - **Finished orders** show one status line instead: Delivered "Today, 11:02 am"; Cancelled "Today, 10:30 am · Customer cancelled"; Not delivered (red) "Today, 11:40 am · Customer not home" (`orders.detail.statusLine` "{{when}} · {{reason}}"). A ghost **"All steps"** opens the Timeline in place; a cancelled order's Timeline ends with the neutral `stopped` marker.
  - **One facts card:** the customer "Sana · 0300 1234567" with a 48 dp call button (screen readers "Call {{name}}") and the address (no zone); while active with a trip, the driver "Kashif · Van LEA-101"; the cylinders "Deliver 2 × 11.8 kg · take back 2"; and the cost: "Delivery cost" with the fee chip (one amount, no parts), or, for a cancelled order whose cost was kept, "No refund. Delivery had started.".
  - While ON_THE_WAY and a driver position exists: "Where the driver is", a small map (polls `/orders/:id/tracking` every 20 seconds).
  - **Cancel** (only while `cancel.allowed`): a full-width **`dangerOutline`** button at the end of the content, never in the footer: "Cancel order" while a refund is due, "Cancel · no refund" when `noRefundReason = DELIVERY_STARTED`.
  - **Footer:** "Call driver" while a driver is assigned and the order is active; otherwise no footer (the screen only shows; the header arrow leaves). From Inc 2 a delivered order's footer belongs to the customer-answer card (§7.3).
- **Cancel sheet** (ConfirmSheet, §2.2 #19), its words from `order.cancel`:

  | Case | Title | Money | Confirm |
  |---|---|---|---|
  | `refundPaisa > 0` | Cancel order {{code}}? | "Back to your wallet" with {{fee}} big | Cancel · get {{fee}} back |
  | `noRefundReason = DELIVERY_STARTED` and a cost was taken (danger) | Cancel without refund? | "Delivery has started." with "Not returned" and {{fee}} big | Cancel without refund |
  | otherwise (no cost, or an order the old system charged before the switch-over) | Cancel order {{code}}? | none | Cancel order |

  - "Why?" above the radio rows Customer cancelled · Wrong order · Duplicate order · Out of stock · Other; Other opens "What happened?" (3–300 characters). The cancel "Keep order" is secondary.
  - It sends `confirmRefundPaisa`. `ORDER_CANCEL_TERMS_CHANGED`: the sheet re-renders with the new terms and says "Delivery has just started. The refund is now {{refund}}." (the catalogue's words). `ORDER_HANDOVER_STARTED`: "Cylinders were already handed over. Call the office."
  - Toasts: "Order cancelled · {{fee}} returned", "Order cancelled · no refund" or "Order cancelled".
- **States:** a skeleton card and the title "Order"; stale "Saved {{time}}"; `NOT_FOUND` gives EmptyState "We couldn't find this order.".
- From Inc 2 (S14) the delivered order's cost reads "Delivery cost {{fee}} · paid when the order was placed", and the Delivered / Taken back card replaces the cylinders line.

### S12 Profile and Help (`distributor/ProfileScreen.tsx`, `HelpScreen.tsx`)
- **Profile** is read-only: one card of icon rows with no visible labels (the labels stay as screen-reader prefixes, `home.profile.rowA11y` "{{label}}, {{value}}", for example "Business name, Ahmed Gas"): the business name (the contact name as the grey line only when it differs), the mobile, and the store with its address (or "Not set up yet"). The caption "Only the office can change these." and the footer "Call office". The shop code, CNIC, role and IDs are not shown. `PATCH /users/me` is used only for name and email.
- **Help:** a card "Delivery cost" with the one refund line (`orders.new.refundRule.*`, following the setting); a card "Top-ups" with "Being checked until the office adds it."; "Office hours {{hours}}" when set; "App version {{version}} · update {{id}}" (the JS release, `APP_VERSION`: "App version 0.1.1" on the Inc 2/3 screens). Footer: the secondary "WhatsApp office" (only when set) above the primary "Call office". The number comes from the config or `support.contact` (§3.6); with neither, the line "The office number isn't loaded yet.". **No Sign out on Help:** it is in the menu only.
- The retired customer stack's About (`HelpContent shop={false}`) shows only the office buttons, the hours and the version.

### S12b Refills and New refill (`RefillListScreen.tsx`, route `Refills`; `NewRefillScreen.tsx`, route `NewRefill`)
Built in Inc 1 as the Inc 3 screens S16 and S17 (§8.1), so Inc 3 only adds the refill detail and the scan counts. No money anywhere (ADR-16); the do-it-yourself mode and the price lines are gone.
- **Refills:** header "Refills". Rows (the §2.2 row look; a local copy, so the Cancel stays reachable by screen readers): `cylinder`, "3 × 6 kg", the refill number as the grey line, the time on the right, the refill chip below. **Inc 1 only:** after the chip, a `dangerOutline` md "Cancel" while the refill is waiting for a driver or assigned; it opens "Cancel this refill?" / "The driver won't pick up these cylinders." with [Cancel refill] (danger) and [Keep refill] (secondary). `REFILL_NOT_CANCELLABLE` shows "This refill can't be cancelled after pickup." in the sheet and the list refreshes. The **Fab** "+ New refill" hides while the list is empty, when the empty state "No refills yet." carries "New refill". No station on the row.
- **New refill:** header "New refill". "Size": ChoiceChips with `columns={2}` (a 2×2 grid), prefilled with the last refill's size, and the helper "One size per refill.". "How many": a Stepper from 1 to `refill.maxCylinders`, "Up to 30 per refill.". "Filling station": its name as text with one station, radio rows for 2–6, a PickerSheet above 6; prefilled with the last station used, else the first active one. Footer **"Request refill · 2 × 11.8 kg"** ("Sending…"); before a size is chosen, "Request refill" (`refill.request.submitNoSize`), disabled, with "Pick a size first." (`.needSize`) above it. On success: the toast "Refill requested" and back to Refills (replace).
- **States:** one body state for sizes and stations together; blocked ("No station is taking refills. Call the office." / "No sizes to refill yet. Call the office.") with "Call office"; a failure on the footer line.
- Each row's chip is the `stages.refill.*` word (§8.1), never the raw status.

---

## 5. Increment 1: driver app (R1, rebuilt to the rulebook on 2026-10-23)
**Inc 1 build only.** From the Inc 2/3 build (2026-10-25) the driver app runs §7.2 and §8.2 on the Inc 2 and Inc 3 routes, and the Inc 1 flows below are retired in the code: the legacy `POST /custody/scan`, the "scanned" tally (`scanTally.ts`), the "Only {{done}} of {{total}} scanned. Continue?" and "All delivered?" sheets, Unload as a SCAN_IN scan, and the refill steppers. This section stays as the record of the Inc 1 build.

The driver spec's D1–D16, with the lead's DECIDED answers. Every scan is still one server call per cylinder on the legacy Inc 1 routes (`POST /custody/scan`, `PATCH /trips/stops/:id/arrive|depart`, `PATCH /orders/:id/status DELIVERED`, `POST /orders/:id/fail`, `PATCH /trips/:id/status`, `/filling-orders/:id/*`), and a holder changes only by a scan.

**Routes** (`navigation/DriverStack.tsx`): Home (Today), ActiveTrip (Trip), DeliverySteps (the Load or Deliver step, with its own camera), **Unload** `{ tripId }` (new; the Inc 1 SCAN_IN), **Refills** (list), **RefillRun** `{ refillId }` (new), VehicleInfo (My van) and Help (with the profile). The Scan, Profile and FillingRuns routes are retired. The menu is My van · Refills · Help · Sign out (§3.6).

**The frame on every driver screen**
- The header: a back arrow and a title of 3 words at most ("Step 2 of 3" on a step screen), with "Call office" at the end of every header (it works offline, §2.2 #4); Today also has the menu.
- **At most two top strips, and only one about the network:** the EnvBanner; "No connection" + Try again; and "Location paused" (on duty, the API answers, but live location hasn't got through for 30 s). "Location paused" hides while "No connection" shows, and on Today it is said in the duty row instead of a strip.
- One 56 dp footer button, with at most one line above it: its own failure (ActionLine, "Not sent. Tap again." or the catalogue text, with [Call office] when that is the fix) or why it is off.
- No data and no connection: the banner and "Nothing saved yet.", and the trip and step screens add [Call office]. Saved data stays, stamped "Saved 11:05 am".

**Today** (`driver/HomeScreen.tsx`)
- The header "Today · Thu 22 Oct" (the business date, from `day.cutoffLocalTime`), Call office and the menu.
- The duty row: "On duty" / "Off duty" with the Switch; a second line only when something is wrong ("Location blocked. Allow it in settings." / "Phone location is off. Turn it on." with "Open settings", or "Location paused").
- The van row (`components/VehicleLoad.tsx`): the plate and "3 full · 1 empty" with zeros hidden, or "No cylinders"; with no van, "No van yet.". It opens My van.
- The trips, no heading. The current trip (the one in progress, else the oldest planned) in a card with a 2 dp brand border: "Deliver to {{name}}" (or "Deliver to {{count}} customers") and "{{count}} cylinders · load at {{store}}", with the chip "Next" or "In progress". Other open trips are plain rows with the chip "To do". Aborted trips are not listed.
- "Done today: {{count}}": trips COMPLETED in today's business day, only when above 0. The phone no longer reopens finished trips.
- **Footer** (only with a current trip): **"Start trip"** (planned: `PATCH /trips/:id/status IN_PROGRESS`, then the Load step opens, with Trip under it) or **"Continue trip"** (the next open step, else the Trip screen).
- Empty: "Nothing to do." / "New trips appear by themselves." with a secondary "Call office", and no footer. It polls every 30 seconds while focused.

**Trip** (`driver/ActiveTripScreen.tsx`)
- Header "Trip". Step rows in trip order (chip below the text, chevron):
  - "Load at {{store}}" (`van`), "{{count}} cylinders";
  - one "Deliver to {{name}}" per customer (`customer`), the address, then "{{count}} cylinders · take back {{back}}";
  - "Unload at {{store}}" (`store`), "{{count}} on the van" while the trip's van list (`van.cylinders`) has any.
- Step chips (§3.4): the Load row counts every order except one cancelled before its first load scan; the Unload row is To do while a customer waits, Next while the trip's van list (`van.cylinders`) has any, and Done at 0 or once the trip is completed.
- **The footer names the next step:** "Start trip" → "Load at store" → "Deliver to {{name}}" → "Unload at store" (the trip's `van.cylinders` not empty, no open delivery) → "Finish trip" (empty), then "Back to home" once closed. Never "Next:" or "Hand back".
- A refill cylinder, another run's delivery or a cylinder marked lost on the van isn't the trip's (API_CONTRACT §9.13), so it never keeps the trip on Unload, and Unload's "Finish trip" is the filled button once the trip's list is empty (review23 holder-scans-02, holder-scans-04). Against a server without `van.cylinders` the app falls back to `van.total`, and Today's van row keeps the van's total.
- **Finish trip** (rule 7): "Finish this trip?" / "Unload at {{store}} first. You can't scan for this trip after." / [Finish trip] / [Not yet] (secondary). Success: back to Today with the toast "Trip done".
- **Leftovers** (only when the server answers `TRIP_VAN_NOT_EMPTY` with `leftoversAllowed: true`, which the Inc 1 server never does): the sheet "Finish with {{count}} on the van?" / "The office will see this. Unload them on your next trip." with "Why?" over the tap rows Store closed · No one to scan · Other ("What happened?", 5–300 characters, for Other only). The picked row's English words are sent as `reason` on `PATCH /trips/:id/status COMPLETED` (API_CONTRACT §9.3 maps it to `leftoverReason`). Without `leftoversAllowed`, the footer line shows the catalogue text "The store must scan in {{count}} more from your van.".
- A closed trip shows the card "Trip done" or "The office stopped this trip.".

**The step screens: the camera is on the step** (`DeliverySteps` with `StepFrame`; there is no separate scan screen and no "Scan to …" button)
- Every step reads, top to bottom: the header "Step {{n}} of {{N}}" (N = the load stops + the deliveries + Unload); the title (verb and place); the **CountBar**; the camera (`ScanPanel`); the result strip, whose idle text is the hint; the size lines; the rare actions last; then one footer button. A step's back arrow always goes to the Trip screen, and a finished step replaces itself with the next one (the frame remounts per phase, so a new phase starts at the top).
- **The Inc 1 count** (UX_PRINCIPLES §9.2): the legacy route sends no progress, so the CountBar shows the screen's tally of different cylinders the server confirmed on this step (recorded or already recorded), labelled "scanned" ("0 of 3 scanned", "All 3 scanned", "4 scanned · 3 needed"). It lives in memory per trip, stop and step (`scanTally`), is never saved or sent, and never blocks.
- **"Done loading" and "All delivered" stay pressable** (the Inc 1 server allows it; Inc 2 enforces it). Until the tally reaches the total they are outlined (`secondary`), then the filled primary. Pressed early, they open "Only {{done}} of {{total}} scanned. Continue?" with [Done loading] or [Yes, all delivered] and [Keep scanning]; "All delivered" adds "Only if the customer has every cylinder.". At the count, "Done loading" acts at once and "All delivered" asks "All delivered?" / "Only if the customer has every cylinder." / [Yes, all delivered] / [Not yet]. Each sheet freezes the count it opened with.
- **Load at {{store}}:** hint "Scan each full cylinder.", recorded "Loaded"; the size lines "2 × 11.8 kg"; footer "Done loading". After it: the camera stops, the success card "Loading done", and the footer becomes the next step.
- **Deliver to {{name}}, on the way** (before arriving): the address; "Maps" (screen readers "Open in maps", when the stop has a pin) and **"Call {{name}}"** (the customer's phone from the trip; side by side only when both labels have 12 characters or fewer, else stacked); what to deliver, with "Take back {{count}}"; a secondary "Could not deliver"; footer "I've arrived" (it acts at once).
- **At the customer, deliver:** "Call {{name}}" stays (above "Could not deliver"); hint "Scan each cylinder you give.", recorded "Delivered"; the size lines; a secondary "Could not deliver" last; footer "All delivered".
- **Take back:** the success strip "All delivered", the title "Take back from {{name}}", the soft CountBar "0 taken back · 2 expected" (or "0 taken back"); hint "Scan each cylinder you take back.", recorded "Taken back"; footer "Finish visit" (in Inc 1 a short take-back finishes without asking).
- **After the visit:** the success card "Visit done"; a not-delivered order the danger card "Not delivered" + "Bring the cylinders back to the store."; a cancelled one the neutral card "Cancelled" + the same line. The footer is the Trip screen's next step.
- **Could not deliver** (ConfirmSheet, rule 7): "Couldn't deliver to {{name}}?" / "Bring the cylinders back to the store." / "Why?" over Customer not home · Customer refused · Wrong address · Not reachable · Van problem · Other ("What happened?", 3–300) / [Mark not delivered] (danger, enabled; pressed with no reason it says "Pick a reason." and sends nothing) / [Go back] (secondary). It calls `POST /orders/:id/fail`; `ORDER_NOT_STARTED_USE_CANCEL` shows "This order hasn't started. Call the office." with [Call office].
- **Camera states:** not yet allowed: "To read the QR labels." + [Allow camera]; blocked: "Camera blocked. Allow it in settings." + [Open settings]; "Starting camera…" only while the permission's answer is awaited; "Camera didn't start. Go back and try again."; paused by a sheet or a hidden screen: a plain dark block. The CountBar always shows.
- **Scan strip** (§2.2 #24): checking "Checking…"; recorded the verb; "Already scanned"; refused `errors.<CODE>` with [Call office] when that is the fix; no answer "Not sent" + Retry (the same read; the count doesn't move).

**Unload at {{store}}** (route `Unload`; the Inc 1 SCAN_IN)
- The last step: header "Step {{N}} of {{N}}". The countdown CountBar: the server's van count (`GET /inventory/my-vehicle`, refetched after each scan and every 10 s) + "on the van", with "2 full · 1 empty" under it, down to the success "Nothing on the van.".
- Hint "Scan each cylinder you bring back.", recorded "Unloaded".
- Footer: "Finish trip" with no open delivery (outlined while the van has cylinders, primary at 0; it opens the Finish trip sheet here), otherwise "Back to trip".
- The van count is the whole van: with two loaded trips on one van it can't tell whose cylinders are whose (accepted for Inc 1).

**Refills** (`RefillsScreen`) and **Refill** (`RefillRunScreen`, route `RefillRun`); no money anywhere
- **Refills:** header "Refills". Open refills, oldest first: "{{count}} × {{size}} · {{shop}}" with the chip of the driver's next step (`driver.refills.stage.*`: Waiting for driver (warning) · Pick up empties · Picking up empties · Go to the station · At the station · Bring them back · Back at store (brand) · Done · Cancelled). "Done today: {{count}}" (refills COMPLETED today). No footer. Empty: "No refills now." / "New ones appear by themselves.".
- **Refill:** header "Refill"; the step as the title, then "{{count}} × {{size}} · {{shop}}"; one footer button per step (Inc 1 counts with steppers; Inc 3 puts scans on this same screen, §8.2):

  | Status | Title | Control | Footer |
  |---|---|---|---|
  | ASSIGNED | Pick up empties at {{store}} | Stepper "Empties picked up", "Up to {{count}}" | Picked up {{count}} empties |
  | EMPTIES_PICKED | Go to {{station}} | – | I've arrived |
  | AT_STATION | Fill at {{station}} | Stepper "Cylinders filled", "Out of {{count}} picked up" | Mark {{count}} filled |
  | FILLED | Bring them back to {{store}} | "Filled {{filled}} of {{count}}" | Brought back |
  | RETURNED | Back at {{store}} | "The office will finish this refill." | none |
  | COMPLETED / CANCELLED | the chip Done / Cancelled | – | Back to refills |

  A refill the driver can't see shows "We couldn't find this. It may have been removed." with "Back to refills".

**My van** (`driver/VehicleInfoScreen.tsx`): the plate (`van` icon), the big total "3" + "cylinders", and one row per size with the counts at the end and zeros hidden ("1 full · 2 empty"). "Nothing on the van." when empty; with no van, "No van yet." + [Call office]. No table header and no coloured digits; it polls every 10 s.

**Help, with the profile merged in** (`driver/HelpScreen.tsx`; `ProfileScreen.tsx` retires): the office number, "Office hours {{hours}}" and a secondary "WhatsApp office" (when set); a "you" card with Name · Mobile · Van (no licence number); "App version 0.1.1" (the JS release, · update id); footer "Call office". Offline everything comes from `support.contact` and the cached profile; "The office number isn't loaded yet." (the shop app's words) shows only when it has never loaded.

**Live location** (`hooks/useLiveLocation.ts`)
- Drop `driverId` from the emits.
- On `connect_error` with an expired session, refresh the token and reconnect.
- Show "Location paused" after 30 seconds without getting through, only while "No connection" isn't showing.

**Type error:** the old `muted` error at FillingOrdersScreen.tsx:124 went with the screen.

## 6. Increment 1 acceptance (UX bar)
- **The rulebook's Definition of simple** (UX_PRINCIPLES §10) is Yes on every screen, at its word budgets (TEST_CASES UXQ-027 shop app, UXQ-028 driver app).
- **No system words or pop-ups:** no `Alert.alert`, raw enum, "Rs.", "On hold" or float maths in any screen touched. Money always goes through MoneyText.
- **States:** every touched screen has a skeleton, an empty state, an error with retry, the "Saved …" strip and "Nothing saved yet.". At most one network strip shows at a time.
- **Targets and contrast:** touch targets of at least 48 dp (driver 56 dp), and only token colours.
- **Typecheck:** `npm run typecheck -w @smartfleet/mobile` passes with 0 errors, including a missing i18n key.
- **Large font:** layouts hold at the largest font size on a 360×640 dp phone.
- **Driver steps:** a step screen holds its own camera (there is no separate scan screen), and every step screen is within 18 words.
- **Slow network:** on a 2G-throttled emulator, actions show "Sending…" and time out at 15 seconds with the "Not sent. Tap again." line. A retry never creates a second order or top-up.
- **Low-end phone:** tested on a pilot-class 2 GB Android phone.

---

## 7. Increment 2: driver flow, store receive, confirmation
Designed to the rulebook on 2026-10-23 (the driver spec's R-SP and R2–R10, and the Inc 2/3 spec), on the Inc 1 screens of §5. What changes from Inc 1: the server's `progress` replaces the tally, the strips name the cylinder, the shop scans the unload, and the visit gets its Empty / Part-filled / Full tap.

### 7.0 Native baseline APK 0.2.0 (start of Inc 2)
- **Version:** 0.1.0 → 0.2.0, which changes the runtime (app.config.ts:19,25).
- **New native modules** (`npx expo install` for SDK 51):
  - `expo-av` (scan-ok, scan-error and step-complete sounds, each under 10 KB);
  - `@react-native-community/netinfo`;
  - `expo-document-picker` and `expo-sharing` (the day-end sheet);
  - FCM config for the driver "New trip" push (expo-notifications is already a dependency);
  - optionally `@sentry/react-native`, and the app name "Smart Fleet" replacing "LPG Management" (app.config.ts:5).
- **Rollout:** an install day for every pilot phone. Then the office raises `app.minVersion.*`.
- **Fallback:** JS detects the sound module and falls back to vibration only.
- **Until it ships** (the Inc 2/3 screens, 2026-10-25, update over the air onto 0.1.0): vibration only, no push token (registration fails quietly, R8), and the day-end sheet goes through the folder fallback of §8.3. No new native module was added.
- **Their rollout is over the air, with no new APK** (review23 contract-compat-01, contract-compat-02): publish the JS release (`api/release.ts` `JS_RELEASE_VERSION`, 0.1.1 for the Inc 2/3 screens; each over-the-air release bumps it); every pilot phone is closed and reopened (shop phones first) and shows it on Help; then the office raises `app.minVersion.*` to that release (API_CONTRACT §8.5 step 10). A phone still on the 0.1.0 JS is then told "Close the app and open it again to update.". When the 0.2.0 APK ships, the office raises the minimum again.

### 7.1 ScanPanel, full version (`ui/scan/ScanPanel.tsx`, `scanReducer.ts`, `useScanFeedback.ts`)
```ts
// As built (Inc 2/3 screens, 2026-10-25). There is no UNLOAD step: the driver's Unload is passive (the
// shop's RECEIVE is the move).
type ScanStep = 'LOAD' | 'HANDOVER' | 'TAKE_BACK' | 'RECEIVE' | 'REFILL_PICKUP' | 'REFILL_FILL';
interface ScanPanelProps {
  step: ScanStep;
  onScan(read: { scanId: string; code: string; entryMethod: 'QR' | 'TYPED'; returnState?: 'EMPTY' | 'PART_FILLED' | 'FULL'; lat?: number; lng?: number }):
    Promise<'recorded' | 'already' | { outcome: 'recorded' | 'already'; shortCode: string; sizeLabel: string; text?: string }>;
  active: boolean;
  complete?: boolean;       // long buzz; the camera stops; "Type number" stays (an open field folds back)
  returnState?: ReturnState; // take back: the state tapped when the label was read
  allowTyped?: boolean;
  children?: ReactNode;     // the details slot above "Type number" (SizeLines, the three lists)
}
// The step screen (StepFrame) owns the title, the CountBar fed from ScanResult.progress, SizeLines,
// the TAKE_BACK state tap and the footer, so the panel never holds a title, a hint or a count.
// answerFromResult(result, text?) turns a ScanResult into the strip's answer; the leave sheet is inside.
```
- **Order inside a step screen** (both apps, so the shop's Receive scan reads like the driver's steps):
  1. the CountBar (§2.2 #29);
  2. the camera;
  3. the result strip, whose idle text is the hint;
  4. "Not saved";
  5. the details: SizeLines ("11.8 kg · 2 of 3" with a tick once complete);
  6. "Type number".

  TAKE_BACK (review23 ux-03): 1. the state tap; 2. the result strip, right under it, so a wrong tap is caught at once; 3. "Not saved"; 4. the CountBar; 5. the camera; 6. the details (the three take-back lists); 7. "Type number".
- **Camera:** `CameraView` with `barcodeTypes:['qr']`, a 56 dp torch toggle, keep-awake. Height clamp(0.28 × window height, 160, 300) dp; take back's clamp(0.18 × window height, 112, 220) dp, so the tap, the strip, the count and the camera fit above the footer on a 360×640 phone (review23 ux-03); with a 4 dp frame in the result colour. It unmounts when the step is complete, the app is backgrounded or a sheet opens.
- **Read loop:**
  - trim the value;
  - ignore the same QR for 2.5 seconds;
  - allow one request in flight;
  - give every read a new `scanId`;
  - attach a best-effort GPS fix that never blocks;
  - re-arm 600 ms after a success, 1.2 seconds after a refusal.
- **Feedback**, never a pop-up (the strip is 56 dp, solid, with a 32 dp icon):

  | Outcome | What the driver gets |
  |---|---|
  | Recorded | a green strip "{{shortCode}} · {{size}} {{verb}}" (take back: "{{shortCode}} · {{state}}", so a wrong state tap is caught at once); the count moves; 40 ms vibration and a beep; the screen reader says "{{done}} of {{total}} {{verb}}" |
  | Already recorded | grey strip "Already scanned · {{shortCode}}"; no buzz |
  | Refused (4xx) | a red strip with `errors.<code>` (2 lines at most) and [Call office] when that is the fix; double vibration and the error tone; it stays until the next good scan |
  | Not sent (network) | one amber card "Not saved: {{count}}" with **one** "Retry" that resends every unsaved read, each with its own `scanId`; the counter doesn't move |
  | Step complete | the CountBar turns green ("All 5 loaded"); a 200 ms vibration and a chime; the camera stops; the footer wakes up |

- **Typed number** (when `features.typedCylinderNumber` is on): a ghost "Type number" (`keyboard`) opens an inline Field "Cylinder number" on the number pad, placeholder "e.g. 42" (it accepts 42, 0042, C0042 or AG-C0042), with a 56 dp send button named by the step's verb ("Load", "Deliver", "Take back"). It sends `entryMethod:'TYPED'`. A `SCAN_CYLINDER_UNKNOWN` refusal keeps the typed digits in the field.
- **Camera permission:** not yet asked: "To read the QR labels." with [Allow camera]; blocked: "Camera blocked. Allow it in settings." with [Open settings] and a ghost [Type number instead].
- **Leaving with unsaved scans** (rule 7): "2 scans not saved" / "Leave now and they're lost." / [Leave] (danger) / [Stay and retry]. With one scan: "1 scan not saved" / "Leave now and it's lost.".
- **Accessibility:** the camera label is "Camera. Point it at the cylinder's QR label." The CountBar is one live region.

**Scan copy** (`scan.*`)
| Key | Text |
|---|---|
| `scan.verb.LOAD` / `.HANDOVER` / `.TAKE_BACK` / `.UNLOAD` | loaded / delivered / taken back / unloaded |
| `scan.verb.RECEIVE` / `.REFILL_PICKUP` / `.REFILL_FILL` / `.REFILL_BACK` | received / picked up / filled / back (the shop's refill receive) |
| `scan.verb.SCANNED` | removed with the Inc 1 tally (Inc 2/3 build) |
| `common.count.progress` / `.progressA11y` | {{done}} of {{total}} / {{done}} of {{total}} {{verb}} (read aloud) |
| `common.count.complete` / `.over` | All {{total}} {{verb}} / {{done}} {{verb}} · {{total}} needed |
| `common.count.expected` / `.expectedA11y` | {{verb}} · {{total}} expected / {{done}} {{verb}} · {{total}} expected |
| `scan.recorded` | {{shortCode}} · {{size}} {{verb}} |
| `scan.recordedState` | {{shortCode}} · {{state}} |
| `scan.alreadyCode` / `scan.already` | Already scanned · {{shortCode}} / Already scanned |
| `scan.sizeProgress` | {{size}} · {{done}} of {{total}} |
| `scan.notSaved` / `scan.retry` | Not saved: {{count}} / Retry (`scan.retryAll` is gone) |
| `scan.typed.open` / `.instead` / `.label` / `.placeholder` | Type number / Type number instead / Cylinder number / e.g. 42 |
| `scan.state.label` | This cylinder is: |
| `scan.state.EMPTY` / `.PART_FILLED` / `.FULL` | Empty / Part-filled / Full |
| `scan.unsaved.title` / `_plural` | {{count}} scan not saved / {{count}} scans not saved |
| `scan.unsaved.body` / `_plural` | Leave now and it's lost. / Leave now and they're lost. (UI gate: one scan reads "it's") |
| `scan.unsaved.leave` / `.stay` | Leave / Stay and retry |
| `scan.step.RECEIVE.hint` | Scan each cylinder from the van. |
| `scan.already.RECEIVE` | Already in your store |
| `scan.complete.RECEIVE` / `_plural` | All {{total}} received |
| `scan.complete.REFILL_BACK` / `_plural` | All {{total}} back · Refill done |
| `scan.fromVan` | {{driver}}'s van |

**As built (Inc 2/3 screens, 2026-10-25)**
- **Files:** `ui/scan/ScanPanel.tsx`; the read loop is plain logic in `scanReducer.ts` (its test is DRV-035, `ui/scan/__tests__/scanReducer.spec.ts`, run by the API's jest); the buzz is `useScanFeedback.ts`. The driver's steps and refill run and the shop's Receive use the same panel.
- **Loop rules added to the spec's:** a label held in front of the camera is ignored however long it stays (it reads again once moved away and back); a "Not saved" label read again is resent with its first `scanId`, never as a second move; reads that come while a request is out wait their turn (at most 10) instead of being dropped; a typed number skips the re-arm and the 2.5-second rule (it is a deliberate tap); a take-back keeps the state tapped when it was read, also on a resend.
- **Strip and Not saved:** every read keeps its own `scanId`. After a no-answer the strip keeps the server's last answer, and the amber "Not saved: N" row under it has one Retry. Refusals show their catalogue text. The camera re-arms 600 ms after a success and 1.2 s after a refusal.
- **Complete:** the camera stops at the step's count; "Type number" stays (RHS-009 step 5: a 7th cylinder after "All 6 loaded" is tried with it), and an open typed field folds back to "Type number" so the step shows its tick, not an empty field.
- **Leave sheet** ("2 scans not saved", rule 7) counts the reads waiting their turn as well as the "Not saved" ones: both would be lost on leaving.
- **Strips name the cylinder:** "AG-C0042 · 11.8 kg loaded"; take back "AG-C0012 · Part-filled"; the shop's receive from another van "AG-C0011 · 11.8 kg received · Imran's van".

### 7.2 Driver screens (Inc 2)
- **R2 Today** (`driver/TodayScreen.tsx`; `GET /driver/home`): §5's Today with the server's data. The header "Today · {{businessDate}}"; the van row "3 full · 1 empty · 1 part-filled" (zeros hidden, "No cylinders" at 0); `activeTrip` is the current-trip card, `nextTrips` the rows; the current trip's action is the footer "Start trip" / "Continue trip", not a button per row; "Done today: {{count}}" from `doneToday`. The driver's open refills follow the trips, oldest first: "Refill · 1 × 6 kg · Ahmed Gas" with the driver's chip (`driver.refills.stage.*`, "Pick up empties"), from `GET /filling-orders/driver/mine` (the Refills list's query, on Today's 30 s poll). A row opens the refill; the footer stays the trip's (review23 ux-02). While refills are assigned, one line right under the van row sums them up, "2 refills · 7 cylinders" (the open refills and the cylinders they ask for in all; the cylinder icon, `bodyStrong`, no button), so the driver sees them at once even when trips push their rows below the fold of a 360×640 phone (follow-ups, 2026-10-25). Empty, only with no trip and no open refill: "Nothing to do." / "New trips and refills appear by themselves." with [Call office]; it polls every 30 seconds. No van: "No van yet." in the van row, and My van offers [Call office].
- **R3 Trip** (`TripScreen.tsx`; `GET /trips/:id`, every 15 seconds): §5's Trip.
  - Step lines from `progress`: Load "{{done}} of {{total}} loaded" once loading has begun; Deliver "{{done}} of {{total}} delivered"; Unload "{{count}} on the van".
  - The footer's one main button by progress: "Start trip", "Load at store", "Deliver to {{name}}", "Unload at store", "Finish trip". There is no "Hand back at store".
  - The driver may open any visit still to do.
  - Finish: `POST /trips/:id/finish`. With an empty van: "Finish this trip?" / "You can't scan for this trip after." (`driver.trip.finishSheet.bodyEmpty`) / [Finish trip] / [Not yet]. `TRIP_VAN_NOT_EMPTY` shows the catalogue text on the footer line, "The store must scan in {{count}} more from your van." (settled point G16-05, now in these words), never its own wording.
  - When the refusal has `details.leftoversAllowed = true`, the leftovers sheet opens instead (rule 7): "Finish with {{count}} on the van?" / "The office will see this. Unload them on your next trip." / "Why?" over the tap rows Store closed · No one to scan · Other. The picked row's English words are sent as `leftoverReason` (each has at least 5 characters, so the 5–300 rule holds); only Other opens "What happened?" (5–300). [Finish trip] / [Not yet] (secondary).
- **R4 Load** (`LoadScreen.tsx`, ScanPanel LOAD): §5's Load step with the server's progress. The CountBar "0 of 3" + "loaded", complete "All 3 loaded" (the camera stops); SizeLines "11.8 kg · 0 of 2", "45.4 kg · 0 of 1". Footer "Done loading" (`POST /trips/:id/stops/:stopId/finish`), **disabled until complete** (`LOAD_INCOMPLETE`), with the line "{{count}} more to load" above it. Last, a ghost with `call`: "Missing some? Call office". After it: the card "Loading done", and the footer "Deliver to {{name}}".
- **R5 Visit** (`VisitScreen.tsx`; replaces `DeliverySteps`): four phases on one screen, the header "Step {{step}} of {{total}}" throughout.
  - **Phase 0 · On the way** (stop PENDING): §5's on-the-way screen: Maps, **Call {{name}}**, what to deliver with "Take back {{count}}", "Could not deliver", and the footer "I've arrived" (`PATCH /trips/stops/:id/arrive`). The camera doesn't run while driving.
  - **Phase 1 · Deliver:** the CountBar "0 of 3" + "delivered"; the camera (HANDOVER), the strip and SizeLines; "Type number"; "Could not deliver" last, disabled once a cylinder is given with the line "You already gave some. Call office."; the footer "Finish visit", disabled, with "{{count}} more to deliver". **When the server says the give is complete, the screen moves to phase 2 by itself**, after the long buzz and chime.
  - **Phase 2 · Take back:** the strip "All {{count}} delivered"; the title "Take back from {{name}}"; the state tap "This cylinder is:" with a 56 dp SegmentedControl Empty | Part-filled | Full (default Empty, sticky); right under it the strip "AG-C0012 · Part-filled"; the soft CountBar "0 taken back · 3 expected"; the shorter camera (TAKE_BACK, §7.1); three lists headed "Part-filled · 2" and so on (empty lists hidden), rows "AG-C0012 · 11.8 kg" and, with no label, "No label · 2 × 11.8 kg" (tap to edit); a ghost "No label" opening the sheet below; "Type number"; the footer "Finish visit".
    - **No label sheet:** "No label or other brand"; Size (ChoiceChips, 2 columns), State (SegmentedControl), How many (Stepper 0–30, where 0 removes the row); pinned [Save] / [Go back]. It sends `PUT …/unlabelled-returns` with the stop's whole list; these count as taken back.
    - **Short take-back sheet** (rule 7): "Took back {{taken}} of {{expected}}", "Why?" over Customer kept them · Customer had none · Other (a note); [Finish visit] stays enabled ("Pick a reason." when pressed with none); [Go back]. It sends `takeBackShort`.
  - **Phase 3 · Done:** the success card "Visit done", then "Gave 3 · Took back 3" and "1 empty · 2 part-filled · 0 full" on two lines, with no brackets. The footer is the next step ("Deliver to Usman", "Unload at store", "Back to trip").
  - **No share button and no link:** the driver never sees the confirmation link.
- **R6 Could not deliver:** §5's sheet, inside Visit (`POST /orders/:id/fail`). Its button is disabled once a cylinder is given (phase 1). No money is mentioned to the driver.
- **R7 Unload** (`UnloadScreen.tsx`; the shop scans): the title "Unload at {{store}}"; the line "Give each cylinder to the shop to scan."; the CountBar "0 of 5" + "unloaded" (the shop's screen says "received"); groups Not delivered · Empty · Part-filled · Full with rows "AG-C0021 · 15 kg" (a received row gets a tick, turns secondary and moves to the end of its group). It polls every 5 seconds. The footer "Finish trip" is **always enabled**: outlined while cylinders are left, the filled primary at "All 5 unloaded"; an early tap gets the server's answer (the `TRIP_VAN_NOT_EMPTY` line, or the leftovers sheet), so the leftovers path is never hidden. Unlabelled returns aren't listed and never block (they have no holder, so the driver hands them over by hand; the shop sees their counts on the order, S14).
- **R8 New-trip push:** register through `POST /push-tokens`. The title "New trip", the body "{{customers}} · load at {{store}}" ({{customers}} is the name, or "{{count}} customers"). A tap opens Today. On Sign out the app first calls `DELETE /push-tokens { token }` (best effort; a failure never blocks signing out). The next sign-in on that phone moves the token to the new driver anyway.
- **R9 My van** (`VanScreen`): §5's My van, plus groups by state ("Full", "Empty", "Part-filled", empty groups hidden), each with one row per size, "11.8 kg · 2", and the cylinder numbers on one secondary line ("AG-C0001, AG-C0002"). No capacity bar, no percentage, no money.

**As built (Inc 2/3 screens, 2026-10-25)**
- **Routes and files** (`navigation/DriverStack.tsx`): Home (`TodayScreen.tsx` + `VanRow.tsx`), Trip (`TripScreen.tsx`, `FinishTripSheet.tsx`), Load (`LoadScreen.tsx`), Visit (`VisitScreen.tsx` + `NoLabelSheet.tsx`), Unload (`UnloadScreen.tsx`), Refills, RefillRun, Van (`VanScreen.tsx`) and Help. ActiveTrip, DeliverySteps and VehicleInfo are gone, with `scanTally.ts` and `components/VehicleLoad.tsx`; `push.ts`, `sizes.ts` and `tripApi.ts` / `tripModel.ts` are the screens' helpers.
- **R2 Today:** the header date is the server's `businessDate`. Each row reads its customers' names and its cylinder count from `GET /driver/home` (`TripSummary.customerNames`, `.cylinders`, API_CONTRACT §9.13): "Deliver to Sana", or "Deliver to 2 customers" with "3 cylinders · load at Ahmed Gas Store". The van row refreshes with Today's 30 s poll.
- **R3 Trip:** finishing goes through `POST /trips/:id/finish`. The confirm sheet "Finish this trip?" / "You can't scan for this trip after." shows only with an empty van; with cylinders on it, Unload's "Finish trip" sends at once, so the catalogue's refusal line ("The store must scan in 1 more from your van.") or the leftovers sheet shows. Success: back to Today with the toast "Trip done".
- **R4 Load and R5 Visit** close their step with `POST /trips/:id/stops/:stopId/finish`. "Done loading" leads to the card "Loading done" and the footer "Deliver to {{name}}"; a visit ends on "Visit done" with "Gave 2 · Took back 2" and "1 empty · 1 part-filled · 0 full" (the second line hides when nothing was taken back). The No label sheet sends `PUT …/unlabelled-returns` with the stop's whole list. "Call {{name}}" is on the way and at the door (DECIDED).
- **R7 Unload:** the groups (Not delivered · Empty · Part-filled · Full) list the van's cylinders by number from `GET /trips/:id` `van.cylinders` (API_CONTRACT §9.13), and a row the shop receives gets its tick. "X of Y unloaded": Y is the most cylinders seen on the van since every visit closed, kept in memory per trip; after an app restart an emptied van reads "Nothing on the van.". It polls every 5 s.
- **R8 push:** registration (`POST /push-tokens`) is best effort: it fails quietly on the 0.1.0 APK, which has no FCM set-up, and the permission is asked only once a token exists. Signing out first removes the token (`DELETE /push-tokens`, `api/session.ts` `onBeforeSignOut`, never more than 3 s, never blocking the sign-out).
- **R9 My van:** the numbers line comes from `GET /inventory/my-vehicle` `cylinders` (§9.13); sizes from `GET /cylinder-types`.
- **Words** (fixed words, normal state): Load 23, on the way 13, deliver and take back about 26 each with "Call {{name}}", Unload 18–20, refill steps 23 / 20 / 13, Today about 17 (19 with the refill line, which adds "refills" and "cylinders"), Trip about 18.

### 7.3 Shop app screens (Inc 2)
- **Home rows** (above the tiles, S2), in this order, each a row with an icon, a bold title, one grey line and a chevron:
  - **customer problems** (`features.confirmations` and open problems in `GET /alerts/mine`): the `error` icon, danger tone, "{{count}} customer problem(s)" and "The office will look into it". One problem opens its order; more open S15;
  - **Receive from driver** (`features.scanFlow`): `store`, "Receive from driver" and "{{count}} coming back" in bold brand text, or "Nothing coming back"; it polls with `store.incoming` (15 s) while Home is focused;
  - **Day-end sheet** (Inc 3, §8.3).
  A failed `/alerts/mine` or `/store/incoming` hides its row.
- **S13 Receive from driver** (`distributor/ReceiveListScreen.tsx`, `ReceiveScanScreen.tsx`; `GET /store/incoming` every 15 seconds, `POST /store/scans`)
  - **List:** header "Receive from driver". One row per van coming back: `van`, "{{driver}} · {{plate}}", "{{done}} of {{total}} received", and a "Refill" chip (brand, `cylinder`) when a cylinder came back from a refill; a fully received van shows "All received" until the next poll. With exactly one van, the list is skipped and the scan opens. Empty: "Nothing coming back right now.". Offline: the banner, the saved rows stamped "Saved {{time}}".
  - **Scan:** the header "{{driver}} · {{plate}}"; the driver's step order (§7.1): the CountBar "1 of 2" + "received", the camera (RECEIVE) with the hint "Scan each cylinder from the van.", SizeLines (only with 2 or more sizes), "Type number" when on, and the footer **"Done"** (always enabled: leaving never loses a saved scan). Recorded "✓ {{shortCode}} · {{size}} received" (plus " · {{driver}}'s van" when it came from another van); "Already in your store" (grey); refusals in red (`SCAN_NOT_ON_A_VAN`, `SCAN_WRONG_OWNER`, `SCAN_CYLINDER_UNKNOWN`); "Not saved: {{count}}" with one Retry; complete "All {{total}} received", or "All {{total}} back · Refill done" for a refill-only van. Unlabelled returns aren't on the list or scanned (they have no holder); their counts show on the order.
- **S14 Order detail additions**
  - One card replaces the cylinders line once the visit is finished: **Delivered** (`customer`), one line per size "2 × 11.8 kg", or "11.8 kg · 1 of 2" when short; **Taken back** (`cylinder`), one line per state with the numbers ("Empty · AG-C0011") and, with no label, "Empty · No label · 1 × 11.8 kg"; the caption "{{count}} expected" when the total differs from the order's take-back.
  - The cost line stays fixed: "Delivery cost {{fee}} · paid when the order was placed".
  - **The customer answer card** (only when `features.confirmations` is on and the order's `confirmation` is not null) is **record only**: see CUSTOMER_PAGE §10 for its states, its one footer button and the Send link sheet. It sits above the facts card and never shows money lines. The finished timeline stays one status line, so a delivered order stays near 25 words.
- **S15 Customer problems** (`CasesScreen.tsx`): header "Customer problems". Rows: the customer's name; the grey line "{{shortCode}} · “{{comment}}”" (or just the number); the time on the right; the answer chip below (§3.4); a chevron opening its order. No footer: the office closes problems. Empty: "No customer problems.". The order rows and detail add the answer chip next to the stage chip.
- **S15b Edit customer** (`PATCH /clients/:id`): Add customer step 1 in edit mode, header "Edit customer": Name, PhoneField "Mobile number" (+92 fixed, "300 1234567"), the note (or AddMore "+ Add note"), and a read-only address row with the caption "New address? Use New order.". Footer "Save customer"; toast "Customer saved". When the save answers `confirmationNeedsNewLink: true` (opened from the card's "Fix number"), back on the order the "Make a new link?" sheet opens at once; the card's footer stays "Make new link" until it is done. `CLIENT_PHONE_INVALID` ("Enter a number like 300 1234567.") and `CLIENT_PHONE_EXISTS` show under the field.
- **No cylinder-history screen** in the pilot: plain-word history is on the office website (UX_ADMIN §3.5). `GET /cylinders/:code/history` stays open to the owning distributor for later.

**As built (Inc 2/3 screens, 2026-10-25)**
- **Home rows:** the problems row is red ("2 customer problems" / "The office will look into it"); "Receive from driver" with "{{count}} coming back" polls every 15 s, and with one van it opens that van's scan; "Day-end sheet" naming the day that waits (§8.3). Each shows only while its feature is on. "Coming back" counts only what will come back: `GET /store/incoming` leaves out cylinders out for delivery (API_CONTRACT §9.13), so a van loading or out on its run isn't listed until something on it is coming back.
- **S13** is `screens/distributor/receive/ReceiveListScreen.tsx` and `ReceiveScanScreen.tsx` (routes ReceiveList and ReceiveScan). The list's words are `receive.*`; the scan's are the shared `scan.*` (step RECEIVE): "AG-C0011 · 11.8 kg received", the grey "Already in your store", "All 2 received", "All 3 back · Refill done". The list never jumps to a scan by itself, so Back from a scan doesn't bounce.
- **S14** (`OrderDetailScreen.tsx`, `shared/visit.ts`): Delivered per size and Taken back by number come from `OrderDto.visit` (API_CONTRACT §9.13): "Empty · AG-C0021", "Empty · No label · 1 × 15 kg", and "{{count}} expected" when the total differs. The cost line reads "Delivery cost Rs 250 · paid when the order was placed". The answer card is `screens/distributor/confirm/CustomerAnswer.tsx` (`useCustomerAnswer`: the card, the footer button and the sheets); see CUSTOMER_PAGE §10. The answer chip shows in the card on the detail, and under the stage chip on the order rows.
- **S15** (`CasesScreen.tsx`): the customer's name first, then "AG-0001 · “Only 2 came”", the time on the right, the answer chip below.
- **S15b** is its own screen, `EditCustomerScreen.tsx` (route EditCustomer), reached from the card's "Fix number"; Add customer keeps its single save button (REV mobile-ux-08). A number fixed while a link is pending makes the order ask "Make a new link?" once the shop is back on it. `CLIENT_PHONE_EXISTS` shows Add customer's words "{{name}} already has this number.".

### 7.4 Inc 2 acceptance
- A scan never pops up a box. Every outcome gives a tick or a refusal strip, with sound and vibration. "X of Y" always matches the server.
- An unsaved scan is never dropped silently: "Not saved: N" with one Retry.
- A driver goes Load → Deliver → Take back → Unload → Finish with exactly one primary button per screen, each footer naming the next step.
- "No IN, no OUT" shows `SCAN_NOT_ON_YOUR_VAN` ("Not loaded on your van. Don't deliver it. Call office."). A cylinder given on a visit can't be taken back (`SCAN_GIVEN_THIS_VISIT`, "You just delivered this one. You can't take it back now."). Taken-back cylinders show as three lists.
- The Inc 2 screens pass the Definition of simple (TEST_CASES UXQ-032).
- Checked in sunlight on a pilot phone. A 6-hour shift without being signed out.

---

## 8. Increment 3: refills and day-end
Designed to the rulebook on 2026-10-23 (the Inc 2/3 spec §4, and the driver spec's R10, word for word the same).

### 8.1 Shop app: refills (no money anywhere)
Inc 1 already ships the list and the new-refill screens (S12b) and the stage words "Coming back" and "Back at store"; Inc 3 adds the refill detail and the scan counts.
- **S16 Refills** (`RefillListScreen.tsx`): header "Refills". Rows newest first: `cylinder`, "{{count}} × {{size}}", the refill number as the grey line, the time on the right, the stage chip below with " · {{done}} of {{total}}" on PICKING_UP, COMING_BACK and BACK_AT_STORE, and a chevron opening S18. The Fab "+ New refill" hides while the list is empty; the empty state "No refills yet." carries "New refill". From Inc 3 the rows have no Cancel: it moves to S18. Offline: the saved list stamped "Saved {{time}}".
- **S17 New refill** (`NewRefillScreen.tsx`): as S12b: size ChoiceChips (2 columns, wrapping), "One size per refill.", the Stepper "How many" (1 to `refill.maxCylinders`, "Up to 30 per refill."), the station (text for one, radio rows for 2–6, a PickerSheet above 6), the last size and station prefilled, and the footer "Request refill · {{count}} × {{size}}" ("Pick a size first." before a size). `POST /filling-orders` with an Idempotency-Key; toast "Refill requested"; replace with the list. `REFILL_TOO_MANY` shows under the count; `REFILL_STATION_INACTIVE` refetches the stations.
- **S18 Refill detail** (new): header "Refill {{refillNo}}"; the stage chip, "{{count}} × {{size}}" and the station.
  - A CountBar while the refill is moving: "{{picked}} of {{requested}} picked up", then "{{filled}} of {{picked}} filled", then "{{received}} of {{picked}} back".
  - A Timeline without counts in its labels: Requested · Driver assigned · Picked up · Filled · Back at store · Done, each with its time and its count as the detail ("2 of 2"). Fewer filled reads "Done · {{filled}} of {{picked}} filled", with the detail "The rest came back unfilled.".
  - A driver card once assigned, with a secondary "Call".
  - **"Cancel refill"** as a `dangerOutline` button in the content (never the footer), only while `allowedActions` has CANCEL (before pickup). The sheet: "Cancel this refill?" / "The driver won't pick up these cylinders." / [Cancel refill] (danger) / [Keep refill] (secondary); toast "Refill cancelled"; `REFILL_NOT_CANCELLABLE` shows the catalogue text in the sheet and the screen refetches.
  - No footer. `NOT_FOUND`: "We couldn't find this refill.".
- **Returns:** S13 Receive lists a refill van with the "Refill" chip. When the last one is scanned in: "All {{total}} back · Refill done".

**Refill stages** (`stages.refill.*`, one row per `RefillStage`, API_CONTRACT §1.4):
| Stage | Words | Tone / icon |
|---|---|---|
| NEEDS_DRIVER | Waiting for driver | warning / checking |
| DRIVER_ASSIGNED | Driver assigned | brand / customer |
| PICKING_UP | Picking up empties | brand / store |
| PICKED_UP | Empties picked up | brand / truck |
| AT_STATION | At the station | brand / cylinder |
| COMING_BACK | Coming back | brand / truck |
| BACK_AT_STORE | Back at store | brand / store |
| DONE | Done | success / ok |
| CANCELLED | Cancelled | neutral / none |

WAITING_FOR_DRIVER and FILLING are renamed NEEDS_DRIVER and AT_STATION.

**As built (Inc 2/3 screens, 2026-10-25):** the list rows open `RefillDetailScreen.tsx` (route RefillDetail); a row's chip reads "{{stage}} · {{done}} of {{total}}" while the refill moves. The detail's header is "Refill AG-R004"; one big count; the six-step timeline with each step's time ("Driver assigned" from `assignedAt`, API_CONTRACT §10.5) and, once finished, its count ("2 of 2"); a finished count reads "2 of 2 picked up" in the green card (REF-027); the driver card with "Call"; the red-outline "Cancel refill" before pickup. Inc 3 moves the cancel off the list rows.

### 8.2 Driver: refill run (R10, `RefillRunScreen.tsx`; the Inc 1 screen of §5 with scans in place of the steppers)
The header "Refill" with Call office; the title is the step, with "{{count}} × {{size}} · {{shop}}" as data; then the CountBar, the camera with its hint, and one footer button. The screen opens at the step the status gives (ASSIGNED → 1; EMPTIES_PICKED or AT_STATION → 2; FILLED → 3).

| Step | Title | CountBar and hint | Footer |
|---|---|---|---|
| 1 Pick up | Pick up empties at {{store}} | ScanPanel(REFILL_PICKUP): "0 of 2" + "picked up"; "Scan each cylinder you pick up." (a full one is refused with the catalogue's words) | "Done picking up" (`advance → EMPTIES_PICKED`), off at 0 with "Scan a cylinder first." above it; "Type number" when on |
| 2 Fill | Fill at {{station}} | ScanPanel(REFILL_FILL): "0 of 2" + "filled"; "Scan each filled cylinder." | "Done filling" (`advance → FILLED`), off at 0 with the same line. While 0 are filled, a ghost **"Bring back unfilled"** (under the title, above the count, away from "Type number") moves to step 3 without a server call: the shop's receive scans still finish the refill. Step 3 then shows a ghost "Back to filling" while the server still has the refill at the station step (EMPTIES_PICKED or AT_STATION) and nothing is received. It returns to step 2, also without a server call and without a confirm (review23 ux-04) |
| 3 Unload | Unload at {{store}} | passive, as R7: "0 of 2" + "unloaded" (polls 5 s); "Give each cylinder to the shop to scan." | **none while the shop scans**; when the refill is DONE, the success card "Refill done" and the footer "Back to refills" |

- Complete: "All 2 picked up", "All 2 filled", "All 2 unloaded", with the long buzz.
- Refusals in the strip: `REFILL_CYLINDER_NOT_EMPTY`, `REFILL_CYLINDER_WRONG_SIZE`, `REFILL_CYLINDER_ON_OTHER_REFILL`, `SCAN_NOT_AT_STORE`, `REFILL_COUNT_REACHED` ("All picked up: {{requested}} of {{requested}}."), `REFILL_CYLINDER_NOT_ON_THIS_REFILL`. `REFILL_WRONG_STEP` refetches and moves to the right step. No answer: "Not saved: {{count}}" with one Retry.
- The driver's Refills list stays §5's (it opens this screen); Inc 3 deletes the Inc 1 stepper keys and the steps "Go to …", "Bring them back …" and "Back at …".
- **As built (Inc 2/3 screens, 2026-10-25):** ASSIGNED is step 1; EMPTIES_PICKED or AT_STATION step 2 (step 3 after "Bring back unfilled", which the phone remembers in memory per refill); FILLED step 3; COMPLETED the card "Refill done" with "Back to refills". Step 3 polls every 5 s; `REFILL_WRONG_STEP` reloads the refill. A wrong size is refused in the strip ("This refill is for 6 kg only."). The Refills list and Today show the run's step: a refill brought back unfilled reads "Bring them back".

### 8.3 Shop app: day-end (setting `dayEnd.enabled`, read as `appConfig.features.dayEnd`; needs the 0.2.0 APK)
- **The Home row** "Day-end sheet" (`sheet` icon) names the day that waits for the shop (`GET /day-end`, one page; `dayEndModel.dayEndTarget`; review23 ux-01): (1) the oldest day sent back or reopened, as a red row "Sat 24 Oct sent back · fix it"; (2) else the oldest earlier day still open, "Sat 24 Oct ready to send" (READY) or "Sat 24 Oct not sent yet" (a sheet made, nothing sent), in bold brand text; (3) else today's chip words ("Ready to send", "Waiting for office", "Approved · day closed"), or "Send today's count" before anything is sent. It opens S19 on that day.
- **S19 Day-end** (`dayend/DayEndScreen.tsx`)
  - Header "Day-end". A row: the business date and the status chip:

    | `stage` (API_CONTRACT §1.4) | Words (`stages.dayEnd.*`) | Tone / icon |
    |---|---|---|
    | NOT_STARTED | Not sent | neutral / none |
    | READY | Ready to send | brand / upload |
    | WAITING_FOR_APPROVAL | Waiting for office | warning / checking |
    | APPROVED | Approved · day closed | success / ok |
    | SENT_BACK | Sent back | danger / error |

  - S19 shows the day it was opened on (route param `date`; without one, the day that waits, else today) and keeps it when the 3 am cut-off passes. Check and send returns to the same day. An earlier day ends with a ghost "Today's sheet" (`sheet` icon) that opens today's day-end (review23 ux-01, robustness-jobs-04).
  - Sent back or reopened only: a danger card "Office note: “{{note}}”" (or "Office reopened this day: “{{note}}”"), then "Fix it and upload again.".
  - **Three step rows** (not tappable; the icon shows the state: a tick when done, the step's icon in brand when current, grey when to do): "Download sheet" (then a tick and a ghost "Download again" with the one line "Your filled sheet can't be sent after this." under it: only the newest sheet can be uploaded, so a new sheet makes the filled copy, and an upload made from it, unusable; review23 ux-07; no confirm, rule 7); "Fill in only what's different" with the helper "Where it is, its state, and why."; "Upload the sheet" (after an upload "{{count}} difference · {{time}}" and a ghost "Upload again").
  - **The footer follows `allowedActions` and the stage:** DOWNLOAD only: "Download sheet" (`FileSystem.downloadAsync` with the auth header, then `Sharing.shareAsync` titled "Open in your sheet app"); UPLOAD with nothing uploaded since the newest sheet: "Upload filled sheet" (DocumentPicker, xlsx; "Checking your sheet…"; then S20); READY: "Send for approval · {{count}} difference(s)" (the S20 confirm); WAITING_FOR_APPROVAL: no footer, with the line "The office is checking it."; APPROVED: no footer.
  - An upload refused for the whole file (`DAY_SHEET_UNREADABLE`, `DAY_SHEET_WRONG_DISTRIBUTOR`, `DAY_SHEET_WRONG_DATE`, `DAY_SHEET_OUTDATED` "This is an old copy. Download a new sheet and use that.", `FILE_TOO_LARGE`, `DAY_LOCKED`, `DAY_ALREADY_SUBMITTED`) shows an ErrorBanner above the footer; nothing was saved. Only the newest downloaded sheet can be uploaded. `DAY_NOT_FOUND`: "We couldn't find this day.". A busy server's 503 `SERVICE_UNAVAILABLE` ("The service is busy. Please try again in a minute.": it reads one sheet at a time) adds "Try again", which sends the same file again; a 429 `RATE_LIMITED` says how many minutes to wait and offers no button (review23 security-02).
- **S20 Check and send** (`dayend/DayEndPreviewScreen.tsx`)
  - Header "Check and send". The summary: the big "{{count}}" with "difference(s)", and the caption "{{count}} cylinders checked". ChoiceChips by kind (All · Place · State · New) when there are 2 or more kinds.
  - One card per difference: "{{shortCode}} · {{size}}"; "App: {{where}} · {{state}}"; "You: {{where}} · {{state}}" with the part that differs in bold; the note in quotes; the fix chip (`dayEnd.fix.*`: "Move to your store", "Set to {{state}}", "Mark as lost", "Add as new cylinder", "Office will check"); a grey "Will be skipped" when it moved since the sheet.
  - Footer "Send for approval · {{count}} difference(s)" (no brackets); with 0 differences, "Send for approval" and "Your count matches the app.".
  - **The confirm** (rule 7): "Send day-end for {{date}}?" / "Once the office approves, this day is closed." / [Send for approval] / [Not yet]. It calls `POST /day-end/:date/submit {version}`; success: back to S19 with "Waiting for office" and the toast "Sent to the office". `DAY_VERSION_CHANGED` shows a banner with "Upload again".
  - **Row errors** (422 `DAY_SHEET_ROW_ERRORS`; nothing was saved): a danger card with the catalogue text, the list "Row {{row}} · {{sheet}}: {{problem}}" ({{sheet}} "Cylinders" or "Extra cylinders"; {{problem}} = `dayEnd.rowError.<code>`, the shared `DAY_END_ROW_ERROR_EN` texts), "and {{count}} more row(s)", and the footer "Upload fixed sheet". The 9 row texts become the shorter ones of the Inc 2/3 spec §4.7 when Inc 3 is built, each 12 words or fewer (for example PLACE_UNKNOWN "Where: use In my store, On driver's van, With customer or Missing.").
- **As built (Inc 2/3 screens, 2026-10-25): the sheet without new native modules.** "Open in your sheet app" and the document picker need `expo-sharing` and `expo-document-picker` from the 0.2.0 APK (§7.0). Until then `dayend/sheetFiles.ts` (the only file to swap later) uses `expo-file-system` 17, already in the 0.1.0 binary as a dependency of `expo` (declared in apps/mobile at the same `~17.0.1`), loaded lazily and guarded like `expo-keep-awake`, with Android's folder access:
  - **Download:** the shop picks a folder once (Android's folder screen opens at Documents, because Android 11 and later refuse the Download folder itself; the choice is kept in secure storage). The sheet is saved there under its server file name, replacing an older copy, with the toast "Sheet saved in Documents"; the shop opens it from the sheet app.
  - **Upload:** "Upload filled sheet" opens "Pick your sheet": the .xlsx files in that folder (today's first), then "Other folder" for a sheet saved elsewhere, such as WhatsApp's folder; "No sheets in this folder." when there are none. The picked file goes through the existing multipart upload.
  - Off Android, or without the module, the buttons answer `FEATURE_DISABLED` ("This isn't available yet.").
- **S19/S20 as built:** `dayend/DayEndScreen.tsx` and `DayEndPreviewScreen.tsx`. Today is worked out on the phone (`businessDate(now, appConfig.day)`) each time the screen shows; the day shown is the route's. Check and send's caption "41 cylinders checked" is `DayEndUploadResult.checked` (API_CONTRACT §10.5); row errors list the first 20 rows, then "and N more rows" (the server sends up to 100). A cylinder marked Missing reads "You: Missing" with no state and counts as a Place difference only.

### 8.4 Inc 3 acceptance
- Every refill step is a scan with "X of Y".
- No refill screen shows money.
- The day-end loop (download → upload → check → send) works on the pilot distributor's phone with the spreadsheet app chosen at the site visit, including a file forwarded through WhatsApp.
- The Inc 3 screens pass the Definition of simple (TEST_CASES UXQ-033).

---

## Appendix A. Screen map (old → new; lane in brackets)
| Old file (apps/mobile/src/screens) | New | Inc |
|---|---|---|
| auth/PhoneScreen.tsx | auth/SignInScreen, WrongAppScreen, UpdateRequiredScreen [foundation, phone kit] | 1 |
| auth/OtpScreen.tsx, client/*, navigation/ClientStack.tsx | removed from navigation; files kept [foundation] | 1 |
| distributor/HomeScreen.tsx | Home: wallet card, Get started, tiles, active orders [mobile-distributor] | 1 |
| distributor/TopupScreen.tsx | topup/Amount, HowToPay, TellUs, Status [mobile-distributor] | 1 |
| distributor/LedgerScreen.tsx | WalletScreen, titled History [mobile-distributor] | 1 |
| distributor/AddClientScreen.tsx | AddCustomerScreen [mobile-distributor] | 1 (+edit in 2) |
| (none) | CustomersScreen, route `Customers` [mobile-distributor] | 1 |
| distributor/PlaceOrderScreen.tsx | NewOrderScreen, with shared/AddressPickerSheet and NewAddressScreen (route `NewAddress`); PickAddressScreen is retired [mobile-distributor] | 1 |
| distributor/OrderHistoryScreen.tsx | OrdersScreen [mobile-distributor] | 1 |
| distributor/TrackOrderScreen.tsx | OrderDetailScreen [mobile-distributor] | 1 (+2) |
| distributor/ProfileScreen.tsx, AboutScreen.tsx | read-only Profile, HelpScreen [mobile-distributor] | 1 |
| distributor/RequestFillingScreen.tsx | RefillListScreen (route `Refills`) and NewRefillScreen (route `NewRefill`) in Inc 1; RefillDetailScreen in Inc 3 | 1 / 3 |
| distributor/NotificationsScreen, InventoryScreen, AnalyticsScreen | hidden for the pilot | 1 |
| (none) | receive/ReceiveListScreen, receive/ReceiveScanScreen (+ `receiveModel.ts`) | 2 |
| (none) | confirm/CustomerAnswer.tsx (`useCustomerAnswer`, + `confirmModel.ts`, `newLinkStore.ts`), EditCustomerScreen (route EditCustomer), `shared/visit.ts` | 2 |
| (none) | RefillDetailScreen (route RefillDetail, + `refill/refillModel.ts`) | 3 |
| (none) | dayend/DayEndScreen, dayend/DayEndPreviewScreen (+ `SendDaySheet.tsx`, `dayEndModel.ts`, `sheetFiles.ts`, `useSheetFiles.tsx`, `useDayEndDue.ts`) | 3 |
| driver/HomeScreen.tsx | Today (1) [mobile-driver], then TodayScreen (+ VanRow.tsx) (2) | 1 / 2 |
| driver/ActiveTripScreen.tsx | Trip, with FinishTripSheet (1), then TripScreen (2) | 1 / 2 |
| driver/DeliveryStepsScreen.tsx | the Load and Deliver step screens, each with its camera (`StepFrame`, `scanTally.ts`) (1), then LoadScreen, VisitScreen and NoLabelSheet (2); `scanTally.ts` is removed | 1 / 2 |
| (none) | driver/push.ts (R8), driver/sizes.ts, ui/scan/scanReducer.ts and useScanFeedback.ts | 2 |
| driver/ScanScreen.tsx | retired: the camera is on the step screens, and UnloadScreen (route `Unload`) is the Inc 1 SCAN_IN. A one-line re-export stays only until the unmounted ClientStack stops importing it | 1 |
| (none) | UnloadScreen: the Inc 1 scan unload, then the passive R7 view in Inc 2 (Inc 2's HandBackScreen is this file) | 1 / 2 |
| driver/ProfileScreen.tsx | merged into HelpScreen | 1 |
| driver/FillingOrdersScreen.tsx | RefillsScreen (route `Refills`) + RefillRunScreen (route `RefillRun`, `refillModel.ts`): steppers in Inc 1, scans in Inc 3 | 1 / 3 |
| driver/TransferScanScreen.tsx | pattern for ScanPanel; hidden | 1 |
| driver/VehicleInfoScreen.tsx + components/VehicleLoad.tsx | My van (1); VanScreen (2), both old files removed | 1 / 2 |
| driver/FuelRefill, Transfers, TransferDetail, Notifications, Reconcile | hidden for the pilot | 1 |

**Shared shop files** (`screens/distributor/shared/`): `CustomerList.tsx` (Customers and New order step 1), `AddressPickerSheet.tsx` (on PickerSheet), `CallButton.tsx`, `queries.ts` (`useOrderPages`, `useClients`, `useCylinderTypes`: one cache shape for `qk.orders.list`, shared by Home, My orders, Recent and "Same as last time"). `shared/InfoRow.tsx` and the FilterChips re-export are removed: ChoiceChips lives in `ui/`.

## Appendix B. API calls per screen (API_CONTRACT.md)
**Inc 1**
| Screen | Calls |
|---|---|
| All screens | `GET /app/config` |
| S1 | `POST /auth/login`, `POST /auth/refresh` |
| S2 | `GET /distributor/home`, `GET /users/me`, `GET /orders?tab=active` (the first page), `GET /clients` (a new shop only) |
| S3, S4 | `GET /payments/topup-info`; S4 and S5 read `GET /payments/mine` for the channel and name prefill |
| S5 | `POST /files/upload`, `POST /payments/topup-requests` |
| S6 | `GET /payments/:id` |
| S7 | `GET /wallet/statement`, `GET /payments/mine` |
| S8 | `GET /pricing/quote`, `POST /clients`; New address `POST /clients/:id/addresses` |
| S8b | `GET /clients`, `GET /orders?tab=active` and `?tab=done` (the first pages, for Recent) |
| S9 | step 1 as S8b; `GET /cylinder-types`, `POST /orders/quote`, `POST /orders` |
| S10 | `GET /orders?tab` |
| S11 | `GET /orders/:id`, `GET /orders/:id/tracking`, `POST /orders/:id/cancel` |
| S12b | `GET /filling-stations`, `GET`/`POST /filling-orders`, `PATCH /filling-orders/:id/cancel` |
| R1 | `GET /trips/mine`, `GET /trips/:id`, `PATCH /trips/stops/:id/arrive\|depart`, `POST /custody/scan`, `PATCH /orders/:id/status`, `POST /orders/:id/fail`, `PATCH /trips/:id/status`, `GET /inventory/my-vehicle` (Today, the steps, Unload, My van), `GET /filling-orders/driver/mine`, `GET /filling-orders/:id` and its step routes |

**Inc 2**
| Screen | Calls |
|---|---|
| R2 | `GET /driver/home`, `GET /filling-orders/driver/mine` (the open refills, review23 ux-02) |
| R3–R7 | `GET /trips/:id`, `POST /trips/:id/scans`, `PUT …/unlabelled-returns`, `POST …/stops/:stopId/finish`, `POST /trips/:id/finish`, `POST /orders/:id/fail` |
| R8 | `POST /push-tokens`, `DELETE /push-tokens` (on Sign out) |
| S13 | `GET /store/incoming`, `POST /store/scans` |
| S14 | `GET /orders/:id/confirmation`, `POST …/confirmation/share`, `POST …/confirmation/new-link` |
| S15 | `GET /alerts/mine` |
| S15b | `PATCH /clients/:id` |

**Inc 3**
| Screen | Calls |
|---|---|
| S16–S18 | `/filling-orders/*` |
| R10 | `POST /filling-orders/:id/scans`, `POST /filling-orders/:id/advance` |
| S19, S20 | `GET /day-end` (Home and S19: the day that waits), `/day-end/*` |

## Appendix C. Query keys (`api/keys.ts`, foundation) and invalidation
**Keys and polling**
| Key | Note |
|---|---|
| `qk.appConfig` | cached 5 minutes; S9 'Check and place' refetches it. Each good answer also saves `support.contact` (secure storage, §3.6) |
| `qk.me` | |
| `qk.home` | |
| `qk.wallet.statement(filter)` | |
| `qk.topups.info` | |
| `qk.topups.mine` | also read by S4 (the channel prefill) and S5 (the name prefill) |
| `qk.topups.byId(id)` | polls 30 s while being checked |
| `qk.clients` | read by Home (a new shop only), Customers, New order and Add customer (the area suggestions) |
| `qk.pricing.quote(lat,lng)` | stale after 5 minutes |
| `qk.orders.list(tab)` | polls 30 s. `'active'` is also read by Home, which polls it every 30 s while focused and only while `orders.active` > 0; the first pages of `'active'` and `'done'` feed Customers and New order (Recent, and "Same as last time") |
| `qk.orders.byId(id)` | polls 20 s while on the way |
| `qk.refills.mine` | |
| `qk.stations` | |
| `qk.driver.trips` | Inc 1 only; removed in the Inc 2/3 build |
| `['driver','vanLoad']` | Inc 1: polls 10 s; read on Today, Trip, the step screens, Unload and My van; each scan refreshes it |
| `['driver','van']` | Inc 2/3: My van (`GET /inventory/my-vehicle`), polls 10 s, refreshed after a trip finishes |
| `['driver','cylinderTypes']` | Inc 2/3: the size labels, kept a day |
| `['driver','refills']` / `['driver','refills', id]` | `GET /filling-orders/driver/mine` / `GET /filling-orders/:id`, each polled every 15 s; 5 s on the refill's unload step |
| `qk.driver.home` | Inc 2: polls 30 s on Today |
| `qk.trip(id)` | polls 15 s; 5 s on Unload (`POLL_MS.tripUnload`); Today reads the current trip (its chip and footer step) and another open trip only when its summary lacks the names (an older server) |
| `qk.store.incoming` | polls 15 s |
| `qk.cases.mine` | |
| `qk.dayEnd(date)` | |
| `qk.dayEndList` | `GET /day-end`, read by Home and S19 (the day that waits); refreshed after a download, an upload or a send (review23 ux-01) |

Polling runs only while the screen is focused and the app is active. `support.contact` and `auth.lastPhone` are secure-storage items, not query keys.

**Invalidation**
- **Order placed or cancelled:** `home`, `wallet.statement`, `orders.list`; set `orders.byId` from the response.
- **Top-up sent:** `home`, `topups.mine`.
- **Each scan:** merge the ScanResult progress into `trip(id)` (Inc 2): each scan answer and each refusal's `details.progress` is laid over `qk.trip(id)` at once, after cancelling a poll in flight; in Inc 1, refresh `['driver','vanLoad']` and the screen's tally.
- **Step complete:** `trip(id)` and `driver.home`.
- **Receive scan:** `store.incoming`; when a refill completes, also `refills.mine`.

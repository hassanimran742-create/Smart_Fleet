# Mobile UX: shop app and driver app

`apps/mobile` is one Expo SDK 51 / React Native 0.74.5 codebase, built twice by `APP_VARIANT` (apps/mobile/app.config.ts:3):
- the **shop app**, for the distributor (shop-keeper, store);
- the **driver app**.

The customer app is off for the pilot. Customers use the web link (CUSTOMER_PAGE.md).

Routes, payloads and error codes come from API_CONTRACT.md. This doc owns screens, states, copy keys and the mobile design system.

## 0. Plain words
**Shop app**
- Say "customer", never "client". Say "the office", never "admin".
- Money words: "Balance", "Being checked", "Add money", "Delivery cost", "Paid from your wallet", "Returned to your wallet".
- **Never** "On hold", "held" or "charged later": there are no holds (DECISIONS ADR-06).

**Driver app**
- Say "trip". The four actions are **Load** (`SCAN_OUT`), **Deliver** (`DELIVERED`), **Take back** (`PICKED_UP_EMPTY`) and **Hand back** (the store scans IN).

**Both apps**
- No enum value, UUID or system word ever reaches the screen.
- Money is always written "Rs 3,450".

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

**Icons:** `ui/Icon.tsx` wraps MaterialCommunityIcons (already in the binary) behind semantic names. All emoji are removed.

| Semantic name | Glyph |
|---|---|
| wallet | wallet |
| addMoney | cash-plus |
| order | clipboard-list-outline |
| customer | account |
| store | storefront-outline |
| truck | truck-delivery |
| scan | qrcode-scan |
| cylinder | gas-cylinder |
| checking | clock-outline |
| ok | check-circle |
| error | alert-circle |
| warn | alert |
| call | phone |
| map | map-marker |
| navigate | navigation-variant |
| torch | flashlight |
| keyboard | keyboard-outline |
| copy | content-copy |
| share | share-variant |
| download | download |
| upload | upload |
| sheet | file-excel-outline |
| chevron | chevron-right |
| menu | menu |
| empty | gauge-empty |
| partFilled | gauge-low |
| full | gauge-full |
| receipt | receipt |

### 2.2 Components (all exported from `ui/index.ts`)
1. **Text** `{variant, tone, numberOfLines, align}`
   - Tones: default, secondary, brand, success, warning, danger, onBrand, onBrandMuted, disabled.
   - Sets the font-scale cap. Title and heading set `accessibilityRole='header'`.
2. **Icon** `{name, size: 20|24|32|48, tone, label?}`. Hidden from screen readers unless it has a `label`.
3. **Screen** `{children, scroll=true, refreshing?, onRefresh?, footer?, banner?, padded=true}`
   - Built from SafeAreaView (react-native-safe-area-context 4.10 is installed), ScrollView with RefreshControl, and KeyboardAvoidingView.
   - `footer` is a sticky white bar with a top border, holding the one primary action.
   - EnvBanner and OfflineBanner render on top.
4. **Header**: `makeScreenOptions()` for native-stack.
   - White background, left-aligned 18 semibold title from i18n, 1 px bottom border.
   - `HeaderIconButton {icon, label, onPress}` at 48 dp, used for the menu, "Call office" (always shown on driver screens) and help.
5. **Button** `{label, onPress, variant: primary|secondary|danger|ghost|inverse, size: md|lg, icon?, loading?, loadingLabel?, disabled?, fullWidth=true, accessibilityHint?}`
   - Variants: primary is white on brand; secondary is brandText with a 1.5 px brand border; danger is white on danger; ghost is brandText; inverse is brandText on white (used on the wallet card).
   - Loading keeps the width and shows a spinner plus `loadingLabel`, with `accessibilityState.busy`. Disabled is textDisabled on sunken.
   - A **double-tap guard** ignores presses while loading and for 600 ms after a press.
6. **Card** `{tone: default|brand|success|warning|danger, onPress?, padding}`. A pressable card gets a ripple and `role=button`.
7. **MoneyText** `{paisa: string|number|bigint, variant, tone, sign: none|auto|always}`
   - Formats with `formatRs`: "Rs 3,450", "+Rs 5,000" (`sign="always"`), "−Rs 330" (U+2212), with no space after the sign; zero is never signed. Tabular numbers.
   - The accessibility label comes from `money.a11y` ("{{amount}} rupees").
8. **StatusChip** `{kind: order|fee|topup|answer|refill|dayEnd|step, value}`
   - Looks up tone, icon and words from the tables in §3.4, or takes `{tone, icon, label}` directly.
   - Height 28, label 14 semibold, icon 16. Never colour alone.
   - An unknown value shows neutral "Updating…" and logs a warning.
9. **Field** `{label, value, onChangeText, helper?, error?, optional?, prefix? ('Rs' | '+92'), keyboardType, autoCapitalize, maxLength, secure?, rightAction?, onBlur, returnKeyType}`
   - Label above the input. Optional fields are written "(optional)"; no asterisks.
   - Focus is a 2 px brand border; error is a 2 px danger border plus an icon and the error text below.
   - The accessibility label is the label plus the error.
10. **AmountChips** `{optionsPaisa, selectedPaisa?, onSelect}`. 48 dp radio chips; the selected one is brand with a check.
11. **SegmentedControl** `{options:[{value,label,icon?}], value, onChange}`. 48 / 56 dp, `role=radiogroup`.
12. **Stepper** `{value, min, max, onChange, label}`. 48 / 56 dp − and + buttons, `role=adjustable`.
13. **ListRow** `{title, subtitle?, meta?, leadingIcon?, trailing?, below?, onPress?, chevron?}`. At least 64 / 72 dp; the title wraps to 2 lines at most. `below` holds chips under the text lines and takes no width from the title.
14. **EmptyState** `{icon, title, body?, action?}`.
15. **ErrorBanner** `{error: ApiError|string, onRetry?, extraAction?, tone}`
    - Inline, never a modal. Shows the mapped message, a 48 dp "Try again", and an optional extra action ("Call office", "Add money").
    - `role=alert` with a live region.
16. **QueryBoundary** `{query, skeleton, isEmpty?, empty, children(data)}`

    | State | Shows |
    |---|---|
    | first load | skeleton |
    | error, no data | ErrorBanner with "Try again" |
    | error, cached data | the strip "Showing saved info from {{time}}. Couldn't refresh." above the data |
    | empty | EmptyState |

    Every list and detail screen uses it.
17. **Skeleton**: static `sunken` blocks, with an optional slow pulse that is off under reduce-motion.
18. **Toast**: `useToast().show({message, tone})`, hosted at the root, shown above the footer for 3 seconds, in a live region.
19. **ConfirmSheet** `{visible, title, body, amountPaisa?, amountLabel?, reasons?: [{code,label}], requireReason?, noteForOther?, confirmLabel, confirmTone: primary|danger, cancelLabel, onConfirm(): Promise, onClose}`
    - A bottom-sheet Modal. The confirm button shows loading.
    - On error the sheet stays open with an ErrorBanner inside. Back closes it unless it is busy.
20. **StepHeader** `{step, total, title}`: "Step 2 of 3" with a segmented bar.
21. **Timeline** `{items:[{key,label,time?,detail?,state: done|current|todo|problem}]}`.
22. **EnvBanner**: a top strip from `appConfig.environment`, falling back to `EXPO_PUBLIC_ENV` until the config loads: training gives "TRAINING · test money only" (`common.env.training`); development, test and staging give "TEST SERVER · test money only" (`common.env.test`); production gives none.
23. **OfflineBanner**: "No internet. We'll keep trying."
    - In Inc 1, shown after a network error in the last 30 seconds.
    - From the 0.2.0 APK, driven by NetInfo.
24. **ScanPanel** (`ui/scan/`, owned by the driver lane): v1 in Inc 1 (§5), full in Inc 2 (§7.1).

**Screen rules**
- One primary action per screen, in `Screen.footer`.
- A form with input asks "Leave without saving?" (ConfirmSheet on `beforeRemove`).
- Irreversible money actions use ConfirmSheet, unless the screen is itself a review that names the amount on its button ("Place order · pay Rs 330").
- `Alert.alert` is never used. There are no hex literals in screens, only tokens.

---

## 3. App foundations

### 3.1 API client v2 (rewrite of `api/client.ts`)
- **Timeouts:** 15 seconds by default, 60 for uploads.
- **Headers:** `X-App-Variant`, `X-App-Version`, `X-Request-Id`, `Accept-Language: en`.
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
**Order stage** (`stages.order.*`)
| Stage | Words | Tone / icon |
|---|---|---|
| NEEDS_DRIVER | Waiting for driver | neutral / checking |
| DRIVER_ASSIGNED | Driver assigned | brand / customer |
| LOADING | Loading at your store | brand / store |
| ON_THE_WAY | On the way | brand / truck |
| DELIVERED | Delivered | success / ok |
| NOT_DELIVERED | Could not deliver | danger / error |
| CANCELLED | Cancelled | neutral / none |

**Fee** (`stages.fee.*`)
| Status | Chip | Long form |
|---|---|---|
| DEDUCTED | "{{fee}} paid" (neutral) | "Paid from your wallet" |
| REVERSED | "{{fee}} returned" (success) | "Returned to your wallet" |
| NONE | "No delivery cost" (neutral) | |

**Top-up stage** (`stages.topup.*`)
| Stage | Words | Tone |
|---|---|---|
| BEING_CHECKED | Being checked | warning |
| ADDED | Added | success |
| NOT_ADDED | Not added | danger |

The reason text for NOT_ADDED comes from `topup.reason.<TopupRejectReason>`.

**Statement kinds** (`wallet.kind.*`)
| Kind | Words |
|---|---|
| TOPUP_ADDED | Money added |
| DELIVERY_COST | Delivery cost |
| DELIVERY_COST_RETURNED | Delivery cost returned (order cancelled) |
| CORRECTION | Correction by the office |
| OPENING_BALANCE | Opening balance |
| LEGACY | Older entry |

Correction reasons (`wallet.correction.*`):
| Code | Words |
|---|---|
| WRONG_TOPUP_APPROVAL | Top-up approved by mistake |
| SYSTEM_ERROR | System error |
| BANK_REVERSAL | Bank reversed a top-up |
| OPENING_BALANCE | Opening balance |
| OTHER | Other |

**Driver step** (`stages.step.*`): TO_DO "To do", NEXT "Next", IN_PROGRESS "In progress", DONE "Done", SKIPPED "Skipped" (for stop status FAILED or CANCELLED).

**Customer answer** [Inc 2] (`stages.answer.*`)
| Answer | Words | Tone |
|---|---|---|
| YES | Customer: all received | success |
| PARTLY | Customer: partly received | warning |
| NO | Customer: not received | danger |
| OTHER | Customer sent a note | warning |
| PENDING | Waiting for customer | neutral |
| EXPIRED | No answer | neutral |

It is shown as a separate chip, never as the order stage.

### 3.5 Data fetching and network
- **QueryClient:** `staleTime 30s`; queries retry twice for retryable errors (1 s, 2 s, 4 s backoff); `refetchOnReconnect`.
  - An AppState-driven `focusManager` replaces App.tsx:12-14.
  - Mutations use `retry 0`; the user retries by hand with the same idempotency key.
- **Polling:** `useFocusedInterval(ms)` polls only while the screen is focused and the app is active.
- **Keys:** central `qk.*` keys in `api/keys.ts` (Appendix C).
- **Mutations:** a loading button, then a Toast on success or an ErrorBanner with "Try again".

### 3.6 Shell
- **RootNavigator gates**, in order:
  1. `UpdateRequired`, on `APP_UPDATE_REQUIRED` or when `appConfig.minVersion` is above this app's version;
  2. `SignIn`, with no session;
  3. `WrongApp`, unless the variant is distributor with role DISTRIBUTOR, or driver with role DRIVER. This is a fallback for a saved session (for example one from before the update); a new sign-in on the wrong app is refused by the server with `AUTH_WRONG_APP` (S1);
  4. otherwise the stack.

  ClientStack and OtpScreen leave navigation; the files are kept.
- **`useAppConfig()`** reads `GET /app/config` (public, cached 5 minutes; S9 'Check and place' refetches it). Menus and tiles read `features.*`, so each increment switches on per server without a new build.
- **The side menu** renders items from `navigation/menus/distributorMenu.ts` and `driverMenu.ts`. Each lane owns its own file.
- **Typed routes:** `DistributorStackParams` and `DriverStackParams` replace the 18 `useNavigation<any>()` calls.

### 3.7 Money in the app
- Paisa stays an integer end to end; the API sends a string. `toPaisa(x)` asserts `Number.isSafeInteger`.
- Only `formatRs` divides by 100:
  - 345000 → "Rs 3,450"
  - 345050 → "Rs 3,450.50"
  - −33000 → "−Rs 330" (and, with `sign: 'always'`, 500000 → "+Rs 5,000")
- **Rupee input** accepts digits only and shows grouping as you type. `parseRupeesInput("5,000")` returns 500000.

---

## 4. Increment 1: shop app screens

### S1 Sign in, Wrong app, Update required (foundation; replaces `auth/PhoneScreen.tsx`)
- **Layout**
  - EnvBanner, the app mark, `common.appName` "Smart Fleet".
  - Field "Mobile number", with prefix +92 and the phone pad. It is normalised on blur with `normalizePkPhone` and shown with `formatPkPhone(phone)` (local style, "0300 1234567"), the form both apps use for every phone.
  - Field "Password", with a 48 dp Show/Hide.
  - Footer primary "Sign in". Ghost button "Forgot password? Call the office" (a `tel:` link to the support phone).
  - The language pills and the OTP fallback are removed (PhoneScreen.tsx:51-63, 75-78).
- **States:** submitting "Signing in…"; inline errors `AUTH_INVALID_CREDENTIALS`, `AUTH_ACCOUNT_NOT_ACTIVE`, `AUTH_ROLE_LOCKED`, `AUTH_WRONG_APP`, `RATE_LIMITED`, `NETWORK_*`. `AUTH_WRONG_APP` shows `errors.AUTH_WRONG_APP` ("This account is for the Smart Fleet Driver app.") under the form: the server refuses the sign-in, so no session starts and the WrongApp screen doesn't open.
- **Copy**

  | Key | Text |
  |---|---|
  | `auth.signIn.title` | Sign in |
  | `auth.signIn.subtitle_distributor` | For shops using Smart Fleet |
  | `auth.signIn.subtitle_driver` | For Smart Fleet drivers |
  | `auth.signIn.phone` | Mobile number |
  | `auth.signIn.phoneHelper` | The number the office registered for you |
  | `auth.signIn.password` | Password |
  | `auth.signIn.show` / `auth.signIn.hide` | Show / Hide |
  | `auth.signIn.submit` / `auth.signIn.submitting` | Sign in / Signing in… |
  | `auth.signIn.forgot` | Forgot password? Call the office |

- **WrongApp** (only the §3.6 fallback gate, for a saved session whose role doesn't fit this build): one button, "Sign out".

  | Key | Text |
  |---|---|
  | `auth.wrongApp.title` | Wrong app for this account |
  | `auth.wrongApp.shopAccount` | This is the driver app. Your account is a shop account. Please use the Smart Fleet shop app. |
  | `auth.wrongApp.driverAccount` | This is the shop app. Your account is a driver account. Please use the Smart Fleet Driver app. |
  | `auth.wrongApp.officeAccount` | Office accounts use the Smart Fleet website. |

- **UpdateRequired**: button "Call the office".

  | Key | Text |
  |---|---|
  | `common.update.title` | Please update the app |
  | `common.update.body` | This version is too old to use. Ask the office for the new version. |

### S2 Home with the wallet card (extends `distributor/HomeScreen.tsx`)
Matches agreed sample screen 1.
```
[Smart Fleet                         menu]
Salam, Ali Gas
+ Wallet (brandText background) --------+
| Balance                               |
| Rs 3,450                      display |
| (clock) Being checked      Rs 5,000   |   only when > 0
| [Add money]                History >  |
+---------------------------------------+
(low-balance card when lowBalance)
Today: 3 active orders >
My orders >                 Refill cylinders >
Receive from driver > (Inc 2)   Day-end sheet > (Inc 3)
[            New order            ]   <- footer, lg
```
- **Data:** `GET /distributor/home` (wallet, order counts, store status) and `GET /users/me`.
- **Wallet card**
  - Loading shows skeleton bars, never "Rs 0" (fixes M5).
  - On error: `wallet.card.loadError` "Couldn't load your balance." with an inverse "Try again".
  - Stale data shows "Updated {{time}}".
  - The "Being checked" row shows only when it is above 0. It opens the latest top-up status (S6), or the Top-ups filter of S7 when there is more than one.
- **Low balance** (`lowBalance` from the server: true when the balance is below `wallet.lowBalancePaisa`, not equal to it): a warning card `home.lowBalance` "Your balance is low. New orders need enough money for the delivery cost." with "Add money".
- **Store not set:** the footer is disabled, with the note "Your store isn't set up yet. Call the office." (`DISTRIBUTOR_NO_STORE`).
- **Copy**

  | Key | Text |
  |---|---|
  | `home.greeting` | Salam, {{name}} |
  | `wallet.card.balance` | Balance |
  | `wallet.card.beingChecked` | Being checked |
  | `wallet.card.addMoney` | Add money |
  | `wallet.card.history` | History |
  | `home.newOrder` | New order |
  | `home.today` / `_plural` | {{count}} active order / {{count}} active orders |
  | `home.tiles.orders` | My orders |
  | `home.tiles.refills` | Refill cylinders |

- **Removed:** sign-out on Home (it moves to the menu) and the emoji tiles.
- **Menu:** a header with the business name and phone. 56 dp rows: Wallet, My orders, Profile, Help, and Sign out (danger, ConfirmSheet "Sign out of Smart Fleet?"). Notifications, the language switch and About are removed.

### S3 Add money: Amount (new `distributor/topup/TopupAmountScreen.tsx`; agreed screen 2)
- **Layout**
  - StepHeader "Step 1 of 3"; title "How much do you want to add?"
  - A Field with the "Rs" prefix and autofocus.
  - AmountChips from `topup.quickAmountsPaisa`.
  - Helper "Minimum {{min}} · Maximum {{max}}" (from `GET /payments/topup-info`).
  - Footer "Next", disabled until the amount is valid.
- **Prefill:** opened from an order blocked by `WALLET_INSUFFICIENT_BALANCE`, the amount is the larger of the minimum and `shortBy` rounded up to Rs 100.
- **Inline errors:** `topup.amount.tooLow` "The minimum is {{min}}"; `topup.amount.tooHigh` "The maximum is {{max}} per top-up. Make two top-ups for more."
- **Info banner** when `pending.count > 0`: "You have {{amount}} being checked. You can still add more."
- **States:** a skeleton while the info loads. On `TOPUP_ACCOUNT_NOT_CONFIGURED`, an ErrorBanner, and Next stays blocked.

### S4 Add money: How to pay (new `TopupHowToPayScreen.tsx`; agreed screen 3)
- **Layout**
  - StepHeader "Step 2 of 3"; title "How to pay".
  - SegmentedControl "Easypaisa" | "Bank app".
  - An account card from `topup-info.account`: account name in bold, bank, IBAN in mono grouped by 4 with "Copy IBAN" (RN Clipboard, Toast "Copied"), and the amount with "Copy amount".
  - Numbered steps for the chosen channel, a warning callout, and the hours line.
  - Footer "I have paid".
- **Test servers:** the account card shows whatever `topup.account` holds there (a dummy account set by the CLI), under the EnvBanner. Nothing else changes.
- **Copy**

  | Key | Text |
  |---|---|
  | `topup.howToPay.title` | How to pay |
  | `topup.howToPay.easypaisa` / `.bankApp` | Easypaisa / Bank app |
  | `topup.howToPay.accountName` | Account name |
  | `topup.howToPay.bank` | Bank |
  | `topup.howToPay.iban` | IBAN |
  | `topup.howToPay.amount` | Amount |
  | `topup.howToPay.copyIban` / `.copyAmount` / `.copied` | Copy IBAN / Copy amount / Copied |
  | `topup.howToPay.ep1` | Open Easypaisa and tap Bank Transfer |
  | `topup.howToPay.ep2` | Choose the bank and paste the IBAN |
  | `topup.howToPay.ep3` | Enter {{amount}}. Any purpose is fine |
  | `topup.howToPay.ep4` | Send it, then take a screenshot |
  | `topup.howToPay.bank1` | Open your bank app and choose Transfer (Raast or IBFT) |
  | `topup.howToPay.bank2` | Paste the IBAN |
  | `topup.howToPay.bank3` | Enter {{amount}} |
  | `topup.howToPay.bank4` | Send it, then take a screenshot |
  | `topup.howToPay.warning` | The account name must be {{accountName}}. We never send account numbers on WhatsApp. |
  | `topup.howToPay.hours` | Money is checked {{from}}–{{to}}. Send before {{to}} to use it today. |
  | `topup.howToPay.paid` | I have paid |

### S5 Add money: Tell us you paid (new `TopupTellUsScreen.tsx`; agreed screen 4)
- **Layout**
  - StepHeader "Step 3 of 3"; title "Tell us you paid".
  - Fields:
    - "Amount sent": prefilled, editable, Rs prefix.
    - "Paid from (name on the account)": required, words capitalised, at most 60 characters.
    - "Paid with": SegmentedControl, prefilled.
    - "Transaction ID": optional.
  - A screenshot tile "Add screenshot" (`pickAndUploadImage`, quality 0.5, purpose TOPUP_PROOF). It shows a thumbnail with "Remove", and a spinner while uploading. A failed upload says "Upload failed. Try again." and doesn't block sending.
  - Footer "Send for checking", loading label "Sending…", with the screen's idempotency key. It is enabled once the amount is valid; an empty payer name is checked on press and shows its error on the field.
- **API:** `POST /payments/topup-requests { amountPaisa, payerName, payerChannel, transactionId?, proofFileId? }`.
- **On success:** `replace('TopupStatus', {id})`, so Back doesn't return to the form, and the Toast "Sent for checking".
- **Errors:** `TOPUP_ACCOUNT_NOT_CONFIGURED` and `DISTRIBUTOR_NOT_ACTIVE` (ErrorBanner with "Call office"), `TOPUP_AMOUNT_TOO_SMALL`/`_TOO_LARGE`, `TOPUP_WOULD_EXCEED_CAP`, `TOPUP_TOO_MANY_PENDING`, `VALIDATION_FAILED` (field errors), `FILE_NOT_FOUND`. A network failure shows `topup.tellUs.notSent` "Not sent. Check your internet and tap Send again. You won't be added twice."
- **Copy**

  | Key | Text |
  |---|---|
  | `topup.tellUs.title` | Tell us you paid |
  | `topup.tellUs.amount` | Amount sent |
  | `topup.tellUs.payerName` | Paid from (name on the account) |
  | `topup.tellUs.payerNameHelp` | The name your bank or Easypaisa shows for you |
  | `topup.tellUs.channel` | Paid with |
  | `topup.tellUs.txnId` / `.txnIdHelp` | Transaction ID / If you have it |
  | `topup.tellUs.screenshot` / `.screenshotHelp` | Add screenshot / Helps us find it faster |
  | `topup.tellUs.submit` / `.sending` | Send for checking / Sending… |

### S6 Add money: Status (new `TopupStatusScreen.tsx`; agreed screen 5)
- **Layout:** the title is the amount. A Timeline: "Sent {{time}}" → "Being checked" ("Usually within 1 hour, {{from}}–{{to}}") → "Added to your balance". Footer "Back to home", which goes straight to Home. A New order left under the status screen (Add money from "Check and place") closes without "Leave without saving?" and its draft is dropped: it can't be placed until the top-up is added.
- **BEING_CHECKED:** the second step is current. Outside the checking hours: "Checking starts at {{from}}."
- **ADDED:** "{{amount}} added. Balance now: {{balance}}".
  - If `creditedPaisa` ≠ `amountPaisa`: `topup.status.addedDifferent` "{{credited}} added (you told us {{amount}}). Call the office if this is wrong."
- **NOT_ADDED:** a danger card with `topup.reason.<code>` and the office note.
  - Actions: secondary "Call office", and primary "Try again", which starts a new top-up prefilled with the amount and name.
- **Polling:** every 30 seconds while BEING_CHECKED and focused, plus pull to refresh.
- **Reasons**

  | Key | Text |
  |---|---|
  | `topup.reason.NOT_IN_BANK` | We can't see this payment in our bank yet. |
  | `topup.reason.AMOUNT_DIFFERENT` | The amount in our bank is different. |
  | `topup.reason.NAME_DIFFERENT` | The payer name doesn't match our bank. |
  | `topup.reason.DUPLICATE` | This payment was already used for another top-up. |
  | `topup.reason.OTHER` | The office couldn't approve it. |

### S7 Wallet history (new `distributor/WalletScreen.tsx`; replaces the unrouted `LedgerScreen.tsx`)
- **Layout**
  - A compact summary: Balance, and Being checked (if above 0).
  - Filter chips: All · Money added (`kind=TOPUP_ADDED`) · Delivery costs (`kind=DELIVERY_COST,DELIVERY_COST_RETURNED`, so a returned cost shows beside its cost) · Top-up requests. They sit in two rows of two, so all four show on a 360 dp phone and nothing scrolls sideways (§6).
  - Pending top-ups are pinned at the top.
  - A FlatList with day sections ("Today", "Yesterday", "Mon 19 Oct").
- **Rows** (`GET /wallet/statement`)
  - Title from `wallet.kind.*` plus `subject.shortCode`, and `subject.clientName` for orders (" · AG-0142 · Ahmed Khan", " · AG-T031").
  - Subtitle: the time. Caption: "Balance after {{balance}}".
  - Trailing: MoneyText with `sign="always"`, success colour for money in.
  - A DELIVERY_COST or DELIVERY_COST_RETURNED row opens the order. A CORRECTION row shows its reason label.
- **"Top-up requests" filter:** lists `GET /payments/mine` in every state, because rejected requests never reach the ledger. A row opens S6.
- **Paging:** cursor, 30 per page, `onEndReached`.
- **Empty:** `wallet.empty` "No money movements yet." with "Add money".

### S8 Add customer, with zone and delivery cost (new `distributor/AddCustomerScreen.tsx`; replaces `AddClientScreen.tsx`)
- **Step 1 of 2, "Customer details"**
  - Name (required). Mobile (required; normalised on blur, inline `CLIENT_PHONE_INVALID`). Area (optional). Notes (optional).
  - City chips, priority and credit limit are removed (AddClientScreen.tsx:25-32, 175-181).
- **Step 2 of 2, "Delivery location"**
  - Search, or "Use my location". The location permission is asked on that tap only; today it is asked on mount (:65-76).
  - The map: tap to drop the pin. Field "House / street" (required).
  - **A cost panel** refreshed by `GET /pricing/quote?lat&lng` (400 ms debounce, 200 always):

    | State | Panel |
    |---|---|
    | checking | "Checking delivery area…" |
    | priced | success card "Zone {{zone}} · Delivery cost {{base}} per order", plus one line "+ {{amount}} per {{size}} cylinder" for each **non-zero** size. When every size is 0 it shows just the base line. |
    | `PRICING_ZONE_NOT_COVERED` | danger card "This location is outside our delivery area. Move the pin or call the office." |
    | `PRICING_PRICE_NOT_SET` | danger card "No delivery price is set for zone {{zoneName}} yet. You can't add this customer until the office sets it.", with "Call office" |
    | error | ErrorBanner with retry |

  - Footer "Save customer", enabled only when priced. An empty "House / street" is checked on press: the field shows "Write the house or street."
- **Save:** one atomic `POST /clients` with `address`.
  - `CLIENT_PHONE_EXISTS` goes back to step 1 with "{{name}} already has this number." and the action "Use {{name}}".
- **Success:** the Toast "Customer saved". Opened from New order, it returns there with the customer selected.

### S9 New order (new `distributor/NewOrderScreen.tsx`; replaces `PlaceOrderScreen.tsx`; 3 steps)
- **Step 1 of 3, "Who is it for?"**
  - Search (name, phone, area). Rows show name, phone and area, plus a zone chip.
  - An address with `priceStatus NOT_SET` shows a danger chip "No price yet". Selecting it shows the PRICE_NOT_SET card, and Next stays disabled. An address with `priceStatus OUTSIDE` shows a danger chip "Outside delivery area"; selecting it shows the `PRICING_ZONE_NOT_COVERED` card ("This location is outside our delivery area. Move the pin or call the office.") and Next stays disabled. The zone chip shows the live `zone`, and none when it is null.
  - Secondary "Add new customer" opens S8. Footer "Next".
- **Step 2 of 3, "Cylinders"**
  - One Stepper row per size: "Deliver {{count}}" and "Take back", which defaults to the same count.
  - A live line "Delivery cost about {{fee}}" from the customer's price, hidden while 0.
  - Footer "Next" once at least one cylinder is chosen. The total is capped at `orders.maxCylindersPerOrder`.
- **Step 3 of 3, "Check and place"**
  ```
  Customer       Ahmed Khan · 0300 1234567
  Deliver to     House 14, Street 5 (Zone F-7)        [Change address]
  Cylinders      2 × 11.8 kg · take back 2
  Delivery cost  Rs 250 per order + 2 × Rs 40 (11.8 kg) = Rs 330       (zero lines hidden; flat: "Rs 250")
  Your wallet    Balance now Rs 3,450 · After this order Rs 3,120
  (i) Rs 330 is taken from your wallet now. If you cancel before the driver starts loading,
      you get it back. After loading starts, it isn't returned, even if the customer refuses.
  [ Place order · pay Rs 330 ]
  ```
  - **Data:** `POST /orders/quote` on entry and on every change. "Change address" opens PickAddress (saved addresses or a new pin, with the same cost panel as S8).
  - **The refund sentence** follows `appConfig.orders.deliveryStartedAt`, read fresh: the app refetches `GET /app/config` when this step opens (not the 5-minute copy):

    | Key | Text |
    |---|---|
    | `orders.new.refundRule.FIRST_LOAD_SCAN` | the text above |
    | `orders.new.refundRule.DRIVER_ASSIGNED` | "…If you cancel before a driver is assigned, you get it back. After that, it isn't returned, even if the customer refuses." |
    | `orders.new.refundRule.LEFT_STORE` | "…If you cancel before the van leaves your store, you get it back…" |

  - **Not enough money:** a danger card "You need {{required}} but have {{balance}}. Add money to place this order." The footer becomes "Add money", opening S3 prefilled.
  - **Submit:** `POST /orders` with `Idempotency-Key` and `quotedTotalPaisa`.
    - `PRICING_QUOTE_CHANGED`: a warning banner "The delivery cost changed to {{total}}. Check it and tap Place order again.", and the breakdown refreshes.
    - `WALLET_INSUFFICIENT_BALANCE` shows the not-enough card.
  - **Success:** replace with OrderDetail and the Toast "Order placed · {{fee}} paid". The old "A driver will be assigned shortly" becomes "The office will assign a driver."
  - **A zero cost:** the button is "Place order" and the wallet lines are hidden.
- **Copy**

  | Key | Text |
  |---|---|
  | `orders.new.title` | New order |
  | `orders.new.who` | Who is it for? |
  | `orders.new.addCustomer` | Add new customer |
  | `orders.new.noPrice` | No price yet |
  | `orders.new.outside` | Outside delivery area |
  | `orders.new.cylinders` | Cylinders |
  | `orders.new.deliver` / `.takeBack` | Deliver / Take back |
  | `orders.new.costAbout` | Delivery cost about {{fee}} |
  | `orders.new.review` | Check and place |
  | `orders.new.balanceNow` / `.balanceAfter` | Balance now / After this order |
  | `orders.new.place` | Place order · pay {{fee}} |
  | `orders.new.placeFree` | Place order |
  | `orders.new.placed` | Order placed · {{fee}} paid |
  | `orders.new.officeAssigns` | The office will assign a driver. |

### S10 My orders (new `distributor/OrdersScreen.tsx`; replaces `OrderHistoryScreen.tsx`)
- **Layout:** SegmentedControl "Active ({{n}})" | "Done".
  - Each ListRow has the customer name as title and "{{shortCode}} · {{items}} · {{when}}" as subtitle ("2 × 11.8 kg").
  - Trailing: StatusChip(stage). A second line carries the fee chip ("Rs 330 paid" or "Rs 330 returned").
- **Data:** `GET /orders?tab=active|done&cursor`, every 30 seconds while focused, plus pull to refresh.
- **Empty:** Active "No active orders." with "New order"; Done "No finished orders yet."

### S11 Order detail and cancel (new `distributor/OrderDetailScreen.tsx`; replaces `TrackOrderScreen.tsx`)
The live socket is removed.
- **Layout**
  - Header "Order {{shortCode}}".
  - Timeline: "Placed · {{fee}} paid" → "Driver assigned" → "Loading at your store" → "On the way" → "Delivered", each with its time. A cancelled order ends with "Cancelled · {{fee}} returned" or "Cancelled · no refund".
  - Cost card: "Delivery cost {{fee}}" plus the fee chip, with the breakdown.
  - Items: "Deliver 2 × 11.8 kg · take back 2".
  - Once assigned, a driver card with name, van plate and "Call driver".
  - While ON_THE_WAY, a small map of the driver's last position (polls `/orders/:id/tracking` every 20 seconds).
- **Cancel** (danger button, shown while `cancel.allowed`). A ConfirmSheet whose text comes from `order.cancel`:

  | Case | Title | Body | Confirm |
  |---|---|---|---|
  | `refundPaisa > 0` | Cancel order {{code}}? | {{fee}} comes back to your wallet. | Yes, cancel and get {{fee}} back |
  | `noRefundReason = DELIVERY_STARTED` (danger) | Cancel without refund? | Delivery has started. If you cancel now, the {{fee}} is not returned. | Cancel without refund |
  | `refundPaisa` 0 and no `noRefundReason` (no cost, or an order the old system charged before the switch-over) | Cancel order {{code}}? | | Yes, cancel order |

  - Reasons: Customer cancelled · Wrong order · Duplicate order · Out of stock at the store · Other (needs a note of at least 3 characters).
  - It sends `confirmRefundPaisa`.
    - `ORDER_CANCEL_TERMS_CHANGED`: the sheet re-renders with the new terms and says "Delivery has just started. The refund is now {{refund}}."
    - `ORDER_HANDOVER_STARTED`: "Cylinders were already handed over. Call the office."
  - Toasts: "Order cancelled · {{fee}} returned" or "Order cancelled · no refund".
- **States:** skeleton; ErrorBanner; `NOT_FOUND` gives EmptyState "We couldn't find this order."

### S12 Profile and Help (extends `distributor/ProfileScreen.tsx`; `HelpScreen.tsx` replaces `AboutScreen.tsx`)
- **Profile** is read-only: name, business name, shop code, mobile, store name and address, with "To change these, call the office."
  - CNIC, role and IDs are removed (ProfileScreen.tsx:52-56, 68-70). `PATCH /users/me` is used only for name and email.
- **Help:**
  - "Call the office" (`support.phone`; replaces the fake number at AboutScreen.tsx:29-33), and "WhatsApp the office" if set.
  - Short "How top-ups work" and "When you get the delivery cost back" texts, the latter following the rule.
  - "App version {{version}} · update {{id}}", and Sign out.

### S12b Refill request, minimal Inc 1 change (`distributor/RequestFillingScreen.tsx`)
- Remove the DIY mode (:21, :122-153), the price lines and the float balance check (:63-67).
- One request per size, with the Stepper capped at `refill.maxCylinders`. Keep the request list; each row shows its stage chip from the DTO's `stage` (`stages.refill.*`, the §8.1 words), never the raw status.
- Cancel only while the request is waiting for a driver or assigned, through a ConfirmSheet "Cancel this refill?" (`REFILL_NOT_CANCELLABLE`).
- The full rebuild is in Inc 3 (§8).

---

## 5. Increment 1: driver app stop-gaps (R1)
- **`driver/HomeScreen.tsx`**
  - Remove the free scan tiles (:65-80), Nearby orders (:101-152) and Transfer tasks (:154-172).
  - Trip rows use StatusChip (`stages.step`), under the text (ListRow `below`), so the customer's name keeps the row's width on a 360 dp phone; the trip screen's step rows do the same.
  - The empty state reads "No jobs yet. The office will assign your next job."
- **ScanPanel v1 core** (`ui/scan/ScanPanel.tsx`) replaces `ScanScreen.tsx`
  - The camera loop with the same-QR ignore copied from TransferScanScreen.tsx:64-67, an inline result strip, vibration, error copy by code, QR only.
  - DeliverySteps opens it with a fixed `eventType` plus `tripId` and `orderId`. The free event picker (ScanScreen.tsx:16-22) is deleted.
- **`DeliveryStepsScreen.tsx`**
  - Buttons are disabled while sending. Errors show as an ErrorBanner by code (fixes the missing `onError`, :57-68).
  - "All delivered" opens a ConfirmSheet: "Mark all delivered? Only do this after you have handed over every cylinder."
  - An `X-Already-Applied` reply shows "Already marked delivered".
  - **"Could not deliver"** (secondary) opens a ConfirmSheet with the `DeliveryFailureReason` list and calls `POST /orders/:id/fail`. `ORDER_NOT_STARTED_USE_CANCEL` shows "This order hasn't started. Call the office."
- **`ActiveTripScreen.tsx`:** StatusChip and error banners.
- **Copy:** "Ask admin" becomes "Call the office" (VehicleLoad.tsx:51, VehicleInfoScreen.tsx:25, FillingOrdersScreen.tsx:49,158).
- **Driver profile** is read-only; CNIC is removed (driver/ProfileScreen.tsx:51).
- **Menu:** Fuel refill, Notifications and the language switch are removed.
- **Live location** (`hooks/useLiveLocation.ts`)
  - Drop `driverId` from the emits (:42, 52-56).
  - On `connect_error` with an expired session, refresh the token and reconnect.
  - Show "Location paused, no connection" after 30 seconds disconnected.
- **Fix** the existing type error at FillingOrdersScreen.tsx:124 (or rely on the foundation's `muted` wrapper).

## 6. Increment 1 acceptance (UX bar)
- **No system words or pop-ups:** no `Alert.alert`, raw enum, "Rs.", "On hold" or float maths in any screen touched. Money always goes through MoneyText.
- **States:** every touched screen has a skeleton, an empty state, an error with retry, and a stale strip.
- **Targets and contrast:** touch targets of at least 48 dp (driver 56 dp), and only token colours.
- **Typecheck:** `npm run typecheck -w @smartfleet/mobile` passes with 0 errors, including a missing i18n key.
- **Large font:** layouts hold at the largest font size on a 360×640 dp phone.
- **Slow network:** on a 2G-throttled emulator, actions show "Sending…" and time out at 15 seconds with a retry. A retry never creates a second order or top-up.
- **Low-end phone:** tested on a pilot-class 2 GB Android phone.

---

## 7. Increment 2: driver flow, store receive, confirmation

### 7.0 Native baseline APK 0.2.0 (start of Inc 2)
- **Version:** 0.1.0 → 0.2.0, which changes the runtime (app.config.ts:19,25).
- **New native modules** (`npx expo install` for SDK 51):
  - `expo-av` (scan-ok, scan-error and step-complete sounds, each under 10 KB);
  - `@react-native-community/netinfo`;
  - `expo-document-picker` and `expo-sharing` (the day-end sheet);
  - FCM config for the driver "new job" push (expo-notifications is already a dependency);
  - optionally `@sentry/react-native`, and the app name "Smart Fleet" replacing "LPG Management" (app.config.ts:5).
- **Rollout:** an install day for every pilot phone. Then the office raises `app.minVersion.*`.
- **Fallback:** JS detects the sound module and falls back to vibration only.

### 7.1 ScanPanel, full version (`ui/scan/ScanPanel.tsx`, `scanReducer.ts`, `useScanFeedback.ts`)
```ts
type ScanStep = 'LOAD' | 'HANDOVER' | 'TAKE_BACK' | 'RECEIVE' | 'REFILL_PICKUP' | 'REFILL_FILL';
interface ScanPanelProps {
  step: ScanStep; title: string;
  progress: { done: number; total: number | null; rows: { key: string; label: string; done: number; total: number | null }[] };
  onScan(i: { scanId: string; code: string; entryMethod: 'QR' | 'TYPED'; returnState?: 'EMPTY' | 'PART_FILLED' | 'FULL'; lat?: number; lng?: number }): Promise<ScanResult>;
  stateSelector?: { value: 'EMPTY' | 'PART_FILLED' | 'FULL'; onChange(v): void };   // TAKE_BACK only
  allowTyped: boolean; complete: boolean; completeLabel: string; footer: ReactNode;
}
```
- **Camera:** `CameraView` with `barcodeTypes:['qr']`, a torch toggle, `useKeepAwake()`. It unmounts when the step is complete, the app is backgrounded or a sheet opens.
- **Read loop:**
  - trim the value;
  - ignore the same QR for 2.5 seconds;
  - allow one request in flight;
  - give every read a new `scanId`;
  - attach a best-effort GPS fix that never blocks;
  - re-arm 600 ms after a success, 1.2 seconds after a refusal.
- **Feedback**, never a pop-up:

  | Outcome | What the driver gets |
  |---|---|
  | Recorded | a green tick; strip "✓ {{shortCode}} · {{size}} {{verb}}"; the counter moves; 40 ms vibration and a beep; the screen reader says "{{done}} of {{total}} {{verb}}" |
  | Already recorded | neutral strip "Already scanned · {{shortCode}}"; no buzz |
  | Refused (4xx) | a scanError strip with `errors.<code>` (2 lines at most); double vibration and the error tone; it stays until the next good scan |
  | Not sent (network) | an amber row in "Not saved ({{n}})" with "Retry" and "Retry all", reusing the same `scanId`; the counter doesn't move |
  | Step complete | the card turns green ("All 5 loaded"); a 200 ms vibration and a chime; the camera stops; the footer is enabled |

- **Progress card:** a big "3 of 5" with the step's verb, and one row per size ("11.8 kg · 2 of 3"). TAKE_BACK has a soft target: "2 taken back · 3 expected", with rows by state.
- **Typed number** (if `features.typedCylinderNumber`): a ghost "Type number" opens an inline Field (placeholder "e.g. C0042"; it accepts 42, 0042, C0042 or AG-C0042) and sends `entryMethod:'TYPED'`. A refusal 404 `SCAN_CYLINDER_UNKNOWN` keeps the typed text in the field so it can be corrected.
- **Camera permission:**
  - not yet asked: "The camera reads the QR label on each cylinder." with "Allow camera";
  - blocked: "Open settings" and "Type number instead".
- **Leaving with unsaved scans:** a ConfirmSheet "{{count}} scan is not saved" / plural "{{count}} scans are not saved" with "Stay and retry" and "Leave".
- **Accessibility:** the camera label is "Camera. Point it at the cylinder's QR label." The counter is a live region.

**Scan copy**
| Key | Text |
|---|---|
| `scan.verb.LOAD` | loaded |
| `scan.verb.HANDOVER` | delivered |
| `scan.verb.TAKE_BACK` | taken back |
| `scan.verb.RECEIVE` | received |
| `scan.verb.REFILL_PICKUP` | picked up |
| `scan.verb.REFILL_FILL` | filled |
| `scan.progress` | {{done}} of {{total}} {{verb}} |
| `scan.expected` | {{done}} taken back · {{total}} expected |
| `scan.already` | Already scanned · {{shortCode}} |
| `scan.notSaved` | Not saved ({{count}}) |
| `scan.retry` / `scan.retryAll` | Retry / Retry all |
| `scan.typed.open` | Type number |
| `scan.state.label` | This cylinder is: |
| `scan.state.EMPTY` / `.PART_FILLED` / `.FULL` | Empty / Part-filled / Full |

### 7.2 Driver screens (Inc 2)
- **R2 Today** (new `driver/TodayScreen.tsx`; `GET /driver/home`)
  - Header "Today · {{date}}" with Call office.
  - A duty switch (56 dp, reuses `useLiveLocation`).
  - A van card: the plate and "{{full}} full · {{empty}} empty · {{part}} part-filled". With no van: "No van is assigned to you. Call the office."
  - A list of trips: "Trip · {{count}} customer · load at {{store}}" / plural "Trip · {{count}} customers · load at {{store}}", a step chip and "Start" or "Continue". Only the active or next trip has the primary button.
  - Empty: "No jobs yet. The office will assign your next job. This page updates by itself." It polls every 30 seconds while focused.
- **R3 Trip** (new `TripScreen.tsx`; `GET /trips/:id`, every 15 seconds)
  - A store card, then the steps: "Load at {{store}}", each customer ("Deliver {{give}} · take back {{back}}"), and "Hand back at {{store}}".
  - The footer's primary changes with progress: "Load at store", "Deliver to {{name}}", "Hand back at store", "Finish trip".
  - The driver may open any visit still to do.
  - Finish: `POST /trips/:id/finish`. `TRIP_VAN_NOT_EMPTY` shows `errors.TRIP_VAN_NOT_EMPTY`, the catalogue text ("The store still needs to scan in the cylinders on your van ({{count}} left)."), never its own wording.
  - When the refusal has `details.leftoversAllowed = true`, a ConfirmSheet opens instead: title `driver.trip.leftovers.title` "Finish with {{count}} cylinder still on the van?" / plural "Finish with {{count}} cylinders still on the van?", body `driver.trip.leftovers.body` "The office will see this. Hand them to the shop at the start of your next trip.", a required note `driver.trip.leftovers.reason` "Why can't the shop take them now?" (5–300 characters) and confirm `driver.trip.leftovers.confirm` "Finish trip". It resends the finish with `leftoverReason`.
- **R4 Load** (new `LoadScreen.tsx`)
  - ScanPanel(LOAD) with one row per size from the stop's progress.
  - Footer "Done loading", which calls `POST /trips/:id/stops/:stopId/finish`. It is disabled until complete (`LOAD_INCOMPLETE`).
  - A ghost link "Store doesn't have them all? Call the office".
- **R5 Visit** (new `VisitScreen.tsx`; replaces `DeliveryStepsScreen.tsx`)
  - **Phase 1, Deliver:** ScanPanel(HANDOVER) with rows "Give {{n}} × {{size}}". "Could not deliver" is disabled once anything has been given.
  - **Phase 2, Take back:**
    - A SegmentedControl "This cylinder is: Empty | Part-filled | Full" (56 dp, defaults to Empty, sticky), then ScanPanel(TAKE_BACK) with three lists.
    - A ghost "No label or other brand" opens a sheet with size, state and count (0–30; 0 removes the row) (`PUT …/unlabelled-returns`). These count as taken back.
    - Footer "Finish visit". If fewer came back than expected (labelled and unlabelled together), a ConfirmSheet "Took back {{taken}} of {{expected}}. Why?" offers Customer kept them, Customer had none, or Other (note). It sends `takeBackShort`.
  - **Phase 3, Done:** "Visit done", "Gave {{given}} · Took back {{taken}} ({{empty}} empty, {{part}} part-filled, {{full}} full)". Footer "Next: {{name}}", "Hand back at store" or "Back to trip".
  - **No share button and no link:** the driver never sees the confirmation link.
- **R6 Could not deliver:** a ConfirmSheet inside Visit, calling `POST /orders/:id/fail`.
  - Title "Couldn't deliver to {{name}}?". Reasons from `DeliveryFailureReason`.
  - Body "The cylinders stay on your van. Bring them back to the store today."
  - The result line: "Marked could not deliver." No money is mentioned to the driver.
- **R7 Hand back** (new `HandBackScreen.tsx`): passive, because the shop scans.
  - "Give each cylinder to the shop. They scan it in their app. This page updates by itself."
  - Groups: Not delivered (full) / Empty / Part-filled / Full (taken back), with "{{done}} of {{total}} received". It polls every 5 seconds.
  - Unlabelled returns aren't listed and never block Finish trip: they have no holder, so the driver hands them over by hand (the shop sees their counts on the order, S14).
  - Footer "Finish trip", enabled when the van is empty.
- **R8 New-job push:** register through `POST /push-tokens`. The message reads "New job · {{count}} customer · load at {{store}}" / plural "New job · {{count}} customers · load at {{store}}". On Sign out the app first calls `DELETE /push-tokens { token }` (best effort; a failure never blocks signing out). The next sign-in on that phone moves the token to the new driver anyway.
- **R9 Van** (extends `VehicleInfoScreen.tsx`/`VehicleLoad.tsx`): the real cylinders on the van, by state and size. The capacity maths at VehicleInfoScreen.tsx:46-51 is removed.

### 7.3 Shop app screens (Inc 2)
- **S13 Receive from driver** (new `distributor/ReceiveListScreen.tsx`, `ReceiveScanScreen.tsx`; `GET /store/incoming` every 15 seconds, `POST /store/scans`)
  - **List:** one row per van coming back, "{{driver}} · {{plate}}" with "{{total}} to receive · {{received}} received". With one van it opens straight into the scan. Empty: "No driver is bringing cylinders back right now."
  - **Scan:** ScanPanel(RECEIVE), with "All {{total}} received" when done. A cylinder already in the store is soft: "Already in your store". Unlabelled returns aren't on the list or scanned (they have no holder); their counts show on the order (S14).
  - **Home tile:** "Receive from driver", with the badge "{{n}} coming back".
- **S14 Order detail additions**
  - "Delivered" (given by size against the order) and "Taken back" (lists by state, plus unlabelled counts).
  - The cost line stays fixed: "Delivery cost {{fee}} · paid when the order was placed".
  - **The customer confirmation card** (only when `features.confirmations` is on and the order's `confirmation` is not null) is **record only**. See CUSTOMER_PAGE §10 for its states and share buttons. It never shows money lines.
- **S15:** the order rows and detail add the answer chip (§3.4) next to the stage chip. Home adds `home.problems` / `home.problems_plural` ("{{count}} customer problem" / "{{count}} customer problems") when the distributor has open cases (`GET /alerts/mine`). Tapping opens that order (one case) or a list of open cases: "{{shortCode}} · {{customer}}", the answer words (§3.4), "since {{when}}"; each row opens its order.
- **S15b Edit customer** (`PATCH /clients/:id`): AddCustomerScreen in edit mode. When `confirmationNeedsNewLink` is true: "The customer has a pending link on the old number. Make a new link from the order." Edit mode has step 1 only (name, mobile, notes). The address can't be edited: "To deliver somewhere else, add a new address from New order → Change address."
- **No cylinder-history screen** in the pilot: plain-word history is on the office website (UX_ADMIN §3.5). `GET /cylinders/:code/history` stays open to the owning distributor for later.

### 7.4 Inc 2 acceptance
- A scan never pops up a box. Every outcome gives a tick or a refusal strip, with sound and vibration. "X of Y" always matches the server.
- An unsaved scan is never dropped silently.
- A driver goes Load → Deliver → Take back → Hand back → Finish with exactly one primary button per screen.
- "No IN, no OUT" shows `SCAN_NOT_ON_YOUR_VAN`. A cylinder given on a visit can't be taken back (`SCAN_GIVEN_THIS_VISIT`). Taken-back cylinders show as three lists.
- Checked in sunlight on a pilot phone. A 6-hour shift without being signed out.

---

## 8. Increment 3: refills and day-end

### 8.1 Shop app: refills (replaces `RequestFillingScreen.tsx`; no money anywhere)
- **S16 Refills** (`RefillListScreen.tsx`)
  - Rows: "{{count}} × {{size}} · {{station}}" with a stage chip. Footer "New refill".
  - Empty: "No refills yet. Send empty cylinders to be filled."
- **S17 New refill** (one screen)
  - Size chips ("One size per refill. For two sizes, make two requests."), a Stepper from 1 to `refill.maxCylinders` ("Up to 30 per refill."), and a station (radio rows, or plain text if there is only one).
  - Primary "Request refill" (`POST /filling-orders`, Idempotency-Key).
  - Toast "Refill requested".
- **S18 Refill detail**
  - Timeline: Requested → Driver assigned → "Picked up {{n}} of {{t}}" → "Filled {{n}} of {{t}}" → "Back in your store {{n}} of {{t}}" → Done.
  - When filled < picked, Done reads `refill.detail.doneShort` "Done · {{filled}} of {{picked}} filled. The others came back as they were."
  - A driver card with Call.
  - "Cancel refill" (danger, only before pickup): ConfirmSheet "Cancel this refill?". `REFILL_NOT_CANCELLABLE` shows "This refill can't be cancelled after pickup."

  **Refill stages** (`stages.refill.*`, one row per `RefillStage`, API_CONTRACT §1.4):
  | Stage | Words |
  |---|---|
  | NEEDS_DRIVER | Waiting for driver |
  | DRIVER_ASSIGNED | Driver assigned |
  | PICKING_UP | Picking up empties |
  | PICKED_UP | Empties picked up |
  | AT_STATION | At the station |
  | COMING_BACK | Coming back filled |
  | BACK_AT_STORE | Back in your store |
  | DONE | Done |
  | CANCELLED | Cancelled |

  WAITING_FOR_DRIVER and FILLING are renamed NEEDS_DRIVER and AT_STATION.

- **Returns:** S13 Receive also lists refill vans ("Refill · {{driver}} · {{n}} to receive"). When the last one is scanned in: "All {{total}} back in your store · Refill done".

### 8.2 Driver: refill run (R10, `RefillRunScreen.tsx`; replaces the typed counts in `FillingOrdersScreen.tsx`)
1. **"Pick up empties at {{store}}":** ScanPanel(REFILL_PICKUP) with "{{n}} of {{t}} picked up". Footer "Done picking up" (`advance → EMPTIES_PICKED`), disabled until at least one cylinder is picked up.
2. **"Fill at {{station}}":** ScanPanel(REFILL_FILL) with the info "Scan each cylinder after the station fills it". Footer "Done filling" (`advance → FILLED`), disabled until at least one cylinder is filled. If the station fills none, the driver goes on to step 3: the shop's receive scans still finish the refill.
3. **"Hand back at {{store}}":** the passive R7 view. The shop's receive scans complete the refill.

Refusals use the `REFILL_*` and `SCAN_*` codes.

### 8.3 Shop app: day-end (setting `dayEnd.enabled`, read as `appConfig.features.dayEnd`; needs the 0.2.0 APK)
- **S19 Day-end** (`dayend/DayEndScreen.tsx`)
  - A header card: the business date and a status chip.

    | `stage` (API_CONTRACT §1.4) | Words (`dayEnd.stage.*`) |
    |---|---|
    | NOT_STARTED | Not sent yet |
    | READY | Check the differences |
    | WAITING_FOR_APPROVAL | Waiting for approval |
    | APPROVED | Approved · day closed |
    | SENT_BACK | Sent back · see note |

  - While `officeNote` is set: a warning card "The office sent this back: “{{note}}”" (SENT_BACK) or "The office reopened this day: “{{note}}”" (REOPENED), then "Fix it, upload the sheet again and send it."
  - Three numbered cards:
    1. **"Download today's sheet":** `FileSystem.downloadAsync` with the auth header, then `Sharing.shareAsync` ("Open with Excel, WPS or Sheets"). "One row per cylinder. Fill in only the rows that differ from your register."
    2. **"Fill it in":** "For each cylinder that isn't where the sheet says, choose where it really is and why."
    3. **"Upload the filled sheet":** footer primary "Choose file" (DocumentPicker, xlsx type) → "Checking your sheet…" → S20.
  - The buttons follow the day's `allowedActions`: download needs DOWNLOAD and "Choose file" needs UPLOAD (a sheet downloaded for this date). A day waiting for approval or approved has neither, so both are disabled.
  - An upload refused for the whole file (`DAY_SHEET_UNREADABLE`, `DAY_SHEET_WRONG_DISTRIBUTOR`, `DAY_SHEET_WRONG_DATE`, `DAY_SHEET_OUTDATED`, `FILE_TOO_LARGE`) shows an ErrorBanner on card 3 with `errors.<code>`; nothing was saved. Only the newest downloaded sheet can be uploaded.
- **S20 Day-end preview** (`dayend/DayEndPreviewScreen.tsx`)
  - Summary: two keys shown side by side, "{{count}} cylinder checked" / plural "{{count}} cylinders checked" (for example `dayEnd.preview.checked`) and "{{count}} difference" / plural "{{count}} differences" (`dayEnd.preview.differences`), as "35 cylinders checked · 1 difference", with chips by kind (`dayEnd.diff.*`: "In a different place", "State differs", "Place and state differ", "Number not in the app").
  - An upload refused with `DAY_SHEET_ROW_ERRORS`: a danger list "{{sheet}}, row {{row}}: {{problem}}" from `details.rows` ({{sheet}} "Cylinders" or "Extra cylinders"; {{problem}} = `dayEnd.rowError.<code>`), with "and {{count}} more row" / "and {{count}} more rows" when `total` is larger, and the primary "Fix the sheet and upload again". Nothing was saved, so there is nothing to send.
  - Each difference: "{{shortCode}} · {{size}}"; "App: {{where}}, {{state}}" → "Your sheet: {{where}}, {{state}}"; the reason; and what approval does (`dayEnd.fix.*`: "Move to your store", "Set to {{state}}", "Mark as lost", "Add as a new cylinder", "Not changed: the office will check it").
  - Footer "Send for approval ({{count}} difference)" / plural "Send for approval ({{count}} differences)": a ConfirmSheet "Send the day-end for {{date}}? After the office approves, this day is closed and can't be changed." It calls `POST /day-end/:date/submit {version}`.

### 8.4 Inc 3 acceptance
- Every refill step is a scan with "X of Y".
- No refill screen shows money.
- The day-end loop (download → upload → preview → send) works on the pilot distributor's phone with the spreadsheet app chosen at the site visit, including a file forwarded through WhatsApp.

---

## Appendix A. Screen map (old → new; lane in brackets)
| Old file (apps/mobile/src/screens) | New | Inc |
|---|---|---|
| auth/PhoneScreen.tsx | auth/SignInScreen, WrongAppScreen, UpdateRequiredScreen [foundation] | 1 |
| auth/OtpScreen.tsx, client/*, navigation/ClientStack.tsx | removed from navigation; files kept [foundation] | 1 |
| distributor/HomeScreen.tsx | extended: wallet card and hub [mobile-distributor] | 1 |
| distributor/TopupScreen.tsx | topup/Amount, HowToPay, TellUs, Status [mobile-distributor] | 1 |
| distributor/LedgerScreen.tsx | WalletScreen [mobile-distributor] | 1 |
| distributor/AddClientScreen.tsx | AddCustomerScreen [mobile-distributor] | 1 (+edit in 2) |
| distributor/PlaceOrderScreen.tsx | NewOrderScreen + PickAddress [mobile-distributor] | 1 |
| distributor/OrderHistoryScreen.tsx | OrdersScreen [mobile-distributor] | 1 |
| distributor/TrackOrderScreen.tsx | OrderDetailScreen [mobile-distributor] | 1 (+2) |
| distributor/ProfileScreen.tsx, AboutScreen.tsx | read-only Profile, HelpScreen [mobile-distributor] | 1 |
| distributor/RequestFillingScreen.tsx | minimal Inc 1 edits; then RefillList, NewRefill, RefillDetail | 1 / 3 |
| distributor/NotificationsScreen, InventoryScreen, AnalyticsScreen | hidden for the pilot | 1 |
| (none) | ReceiveListScreen, ReceiveScanScreen | 2 |
| (none) | DayEndScreen, DayEndPreviewScreen | 3 |
| driver/HomeScreen.tsx | stop-gaps (1) [mobile-driver], then TodayScreen (2) | 1 / 2 |
| driver/ActiveTripScreen.tsx | stop-gaps (1), then TripScreen (2) | 1 / 2 |
| driver/DeliveryStepsScreen.tsx | stop-gaps (1), then LoadScreen, VisitScreen, HandBackScreen (2) | 1 / 2 |
| driver/ScanScreen.tsx | ui/scan/ScanPanel [mobile-driver] | 1 / 2 |
| driver/TransferScanScreen.tsx | pattern for ScanPanel; hidden | 1 |
| driver/FillingOrdersScreen.tsx | type fix (1); RefillRunScreen (3) | 1 / 3 |
| driver/VehicleInfoScreen.tsx + components/VehicleLoad.tsx | copy fix (1); VanScreen (2) | 1 / 2 |
| driver/FuelRefill, Transfers, TransferDetail, Notifications, Reconcile | hidden for the pilot | 1 |

## Appendix B. API calls per screen (API_CONTRACT.md)
**Inc 1**
| Screen | Calls |
|---|---|
| All screens | `GET /app/config` |
| S1 | `POST /auth/login`, `POST /auth/refresh` |
| S2 | `GET /distributor/home`, `GET /users/me` |
| S3, S4 | `GET /payments/topup-info` |
| S5 | `POST /files/upload`, `POST /payments/topup-requests` |
| S6 | `GET /payments/:id` |
| S7 | `GET /wallet/statement`, `GET /payments/mine` |
| S8 | `GET /pricing/quote`, `POST /clients`, `POST /clients/:id/addresses` |
| S9 | `GET /clients`, `GET /cylinder-types`, `POST /orders/quote`, `POST /orders` |
| S10 | `GET /orders?tab` |
| S11 | `GET /orders/:id`, `GET /orders/:id/tracking`, `POST /orders/:id/cancel` |
| S12b | `GET /filling-stations`, `GET`/`POST /filling-orders`, `PATCH /filling-orders/:id/cancel` |
| R1 | `GET /trips/mine`, `GET /trips/:id`, `PATCH /trips/stops/:id/arrive\|depart`, `POST /custody/scan`, `PATCH /orders/:id/status`, `POST /orders/:id/fail` |

**Inc 2**
| Screen | Calls |
|---|---|
| R2 | `GET /driver/home` |
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
| S19, S20 | `/day-end/*` |

## Appendix C. Query keys (`api/keys.ts`, foundation) and invalidation
**Keys and polling**
| Key | Note |
|---|---|
| `qk.appConfig` | cached 5 minutes; S9 'Check and place' refetches it |
| `qk.me` | |
| `qk.home` | |
| `qk.wallet.statement(filter)` | |
| `qk.topups.info` | |
| `qk.topups.mine` | |
| `qk.topups.byId(id)` | polls 30 s while being checked |
| `qk.clients` | |
| `qk.pricing.quote(lat,lng)` | stale after 5 minutes |
| `qk.orders.list(tab)` | polls 30 s |
| `qk.orders.byId(id)` | polls 20 s while on the way |
| `qk.refills.mine` | |
| `qk.stations` | |
| `qk.driver.trips` | Inc 1 |
| `qk.driver.home` | Inc 2 |
| `qk.trip(id)` | polls 15 s; 5 s on Hand back |
| `qk.store.incoming` | polls 15 s |
| `qk.cases.mine` | |
| `qk.dayEnd(date)` | |

Polling runs only while the screen is focused and the app is active.

**Invalidation**
- **Order placed or cancelled:** `home`, `wallet.statement`, `orders.list`; set `orders.byId` from the response.
- **Top-up sent:** `home`, `topups.mine`.
- **Each scan:** merge the ScanResult progress into `trip(id)`.
- **Step complete:** `trip(id)` and `driver.home`.
- **Receive scan:** `store.incoming`; when a refill completes, also `refills.mine`.

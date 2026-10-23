# Customer confirmation page and messages (Inc 2)

**Status:** designed for Inc 2. It is built **last** in Inc 2 as a separate slice behind `confirmation.enabled`, which defaults to **false** until the owner confirms it stays in the pilot.

Nothing else depends on it. With the setting off:
- stops finish normally;
- no link is made;
- every screen hides its confirmation parts;
- the shop and office confirmation routes answer 403 `FEATURE_DISABLED`, and a link already sent shows "This link is no longer active" (410) and records nothing;
- nothing is deleted and the expiry job keeps running. Switching back on makes links only for orders delivered from then on.

**Record only.** The customer's answer **never moves money** (DECISIONS ADR-07, ADR-15).
- "Not received" and "Other problem" open one case for the super admin, who closes it with a note.
- "Partly received" opens a case only if `confirmation.caseOnAnswers` includes `PARTLY`.

Tables are in DATA_MODEL §4.3 (`delivery_confirmations`, `outbound_messages`). The routes are in API_CONTRACT §9.7.

---

## 1. Flow
```
Driver finishes the stop (given scans match the order; the take-back list is done)
 └ one DB transaction (custody / orders):
     order → DELIVERED (delivery_method SCANNED or MANUAL)           — no money, ever
     if confirmation.enabled:
       delivery_confirmations (PENDING, snapshot, expiresAt = deliveredAt + linkTtlHours, tokenVersion 1)
       outbound_messages (SMS, QUEUED, key confirm:<orderId>:v1:sms) if the customer phone is valid
 └ after commit: MessagingService.sendQueued(messageId)
       test mode on and not on the allowlist → SKIPPED (NOT_A_TEST_PHONE), provider not called; otherwise mock provider → SKIPPED (MOCK_PROVIDER)
Shop app (or the office) taps "Send on WhatsApp" → POST /orders/:id/confirmation/share {via:'WHATSAPP'}
       → wa.me opens with the message → the shop presses Send. The driver never sees the link.
Customer opens https://<link host>/c/<token> → page only (opening records nothing)
       → taps "All received" → POST /c/<token> → 303 /c/<token>?done=1 → "Thank you"
 └ one DB transaction: confirmation ANSWERED (first answer wins) + audit (actor CUSTOMER)
 └ same transaction: if the answer is in confirmation.caseOnAnswers → one CUSTOMER_PROBLEM alert (case)
Every 15 minutes: PENDING past expiresAt → EXPIRED (no money)
```
`ConfirmationsService.issueForDeliveredOrder(tx, {orderId, deliveredAt})`:
- runs in the transaction of every write that sets an order DELIVERED from Inc 2: the DELIVERY stop finish (and the legacy `PATCH /orders/:id/status DELIVERED`) and the office manual delivery v2;
- does nothing when the setting is off;
- is idempotent: an existing row is returned unchanged;
- with an invalid customer phone, stores `phoneE164 = NULL` and writes no SMS row, so the shop card asks for a fix.

## 2. Token rules
- **Derived, never stored raw.**
  ```
  token = crockfordBase32(HMAC_SHA256(CONFIRM_LINK_SECRET, "confirm:" + confirmationId + ":" + tokenVersion))
            .toLowerCase().slice(0, 26)        // 130 bits; alphabet 0123456789abcdefghjkmnpqrstvwxyz
  tokenHash = sha256hex(token)                  // the only thing stored (delivery_confirmations.token_hash, unique)
  ```
  The server can rebuild the current link at any time for sharing, so there is no encrypted copy and no link table.
- **`CONFIRM_LINK_SECRET`**: an env value of at least 32 characters. It is a boot guard in staging and production from Inc 2.
- **Accepting a token:** lower-case it, map `i` and `l` to `1` and `o` to `0`, and strip other characters. Anything other than exactly 26 characters (or input over 64 characters) gets the not-found page **without a database lookup**.
- **New link:** `tokenVersion += 1` and `tokenHash` updated, so the old link stops working and shows "We can't find this link".
  - The office or the shop does this, for example after fixing the customer's number.
  - It never extends `expiresAt`.
- **Expiry:** `expiresAt = deliveredAt + confirmation.linkTtlHours` (72; allowed 24–168), read when the link is issued and stored; a setting change affects only links issued after it.
- **Opening is not answering.** GET and HEAD only render the page. Link previews, URL scanners and bots can never record an answer: only a POST from a page button does.

## 3. Snapshot (frozen at delivery; the page renders only this)
```json
{ "v": 1,
  "shop": { "name": "Ali Gas", "phoneE164": "+923211234567" },
  "orderNo": "AG-0142",
  "deliveredAt": "2026-10-21T11:12:00.000Z",
  "delivered": [ { "cylinderTypeId": "…", "size": "11.8 kg", "count": 2 } ],
  "takenBack": [ { "cylinderTypeId": "…", "size": "11.8 kg", "state": "EMPTY", "count": 1, "unlabelled": false } ] }
```
- **`delivered`** is the stop's GIVEN list, grouped by size.
- **`takenBack`** is the TAKEN_BACK list grouped by size and state (Empty, Part-filled, Full), plus the unlabelled counts.
- **Sizes** are printed from `CylinderType.weightKg` without trailing zeros, plus " kg", in ascending order. Empty groups are hidden.
- **`shop.phoneE164`** is the distributor's login phone for the pilot. Whether a separate shop number is needed is an open question.
- **What the page never shows:** the customer's name, address, any price or money, or cylinder numbers. The link can be forwarded.

## 4. Public routes, states and HTTP (outside `/api/v1`)
| Method | Path | Behaviour |
|---|---|---|
| GET, HEAD | `/c/:token` | the main page or a state page |
| GET | `/c/:token/partly`, `/c/:token/not-received`, `/c/:token/other` | second-step forms; nothing is recorded |
| POST | `/c/:token` | records the answer, then 303 to `/c/:token?done=1` (post/redirect/get, so a refresh never posts again) |

**State order**, for GET and POST:
1. Bad format or unknown token: **404** "We can't find this link". A known token while `confirmation.enabled` is false: **410** "This link is no longer active", nothing recorded.
2. ANSWERED: GET **200**, "Thank you" if `?done=1`, otherwise "You already answered". POST of the stored answer: **303** to `/c/:token?done=1`, nothing recorded. POST of any other answer: **409** "You already answered" (`CONFIRM_ALREADY_ANSWERED`), nothing recorded.
3. CANCELLED: **410** "This link is no longer active".
4. EXPIRED, or `now ≥ expiresAt`: **410** "This link has expired".
5. PENDING: **200**, the main page.

The second-step pages (`/partly`, `/not-received`, `/other`) follow the same state order: PENDING shows the form, other states their page. Any other path or method under `/c/` gets the 404 page with no database lookup.

**POST validation** (zod by hand; the body typed `unknown`, as payments.controller.ts:39-41 does):
- After the state order: `answer` must be exactly `YES`, `PARTLY`, `NO` or `OTHER`; a missing or other value gets the main page with **400** and "Please choose one of the answers below." (`role="alert"`), nothing recorded. `v` is ignored.
- `comment`: each line break (CRLF, CR, LF) and tab becomes a space; other control characters (U+0000–U+001F, U+007F–U+009F) are removed; space runs become one; trimmed; cut to 300 code points. Empty is stored as NULL.
- `OTHER` needs a cleaned comment of at least 3 characters. Otherwise the Other page is shown again with **400** and the error (`CONFIRM_NOTE_REQUIRED`).
- The same answer posted again gets 303 to "Thank you"; its comment is ignored. A different answer gets **409** "You already answered".

**Headers on every response:**
- `Content-Type: text/html; charset=utf-8`
- `Cache-Control: no-store`
- `X-Robots-Tag: noindex, nofollow, noarchive`
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff`
- `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`

## 5. Rate limits and wiring
**Rate limits** (fixed windows in Redis; requests go through if Redis is down, because the 130-bit token is the real protection):

| Request | Limit |
|---|---|
| GET, HEAD | 60 per minute per IP |
| POST | 20 per minute per IP, and 6 per 10 minutes per token |
| Unknown tokens (well-formed, not found) | 30 per 10 minutes per IP |

Order: the per-IP GET/POST limit (every request); an IP with 30 misses in its 10-minute window gets 429 on every `/c/` request, valid links included, without a lookup; the format check (bad format = 404, no lookup, not a miss); for POST the per-token limit (refused 400s count); the lookup, where a well-formed unknown token adds a miss. The 429 page names the wait from `Retry-After`, rounded up to minutes.

**Wiring**
- **main.ts**
  - `NestFactory.create<NestExpressApplication>`, and `app.set('trust proxy', 1)`. Today main.ts:20 doesn't trust the proxy.
  - `app.setGlobalPrefix('api/v1', { exclude: [{ path: 'c/(.*)', method: RequestMethod.ALL }] })`, plus a catch-all controller route rendering the 404 page for anything that isn't one of the four routes.
- **The controller:** `PublicConfirmController` with `@Controller('c')`, `@Public()` (public.decorator.ts:4) and `@UseFilters(PublicPageExceptionFilter)`.
  - The filter turns every error, throttling included, into an HTML page with the code's status, never JSON, never echoing the URL: `CONFIRM_LINK_INVALID` 404 not found; `CONFIRM_LINK_INACTIVE` 410 no longer active; `CONFIRM_LINK_EXPIRED` 410 expired; `CONFIRM_ALREADY_ANSWERED` 409 already answered; `CONFIRM_NOTE_REQUIRED` 400 Other page with its error; `VALIDATION_FAILED` 400 main page with "Please choose one of the answers below."; `RATE_LIMITED` 429 too many tries; anything else 500. GET of an ANSWERED or PENDING link renders its 200 page directly.
  - Pages are sent with `res.status(code).type('html').send(html)`.
- **Redaction:** `/c/<token>` becomes `/c/[token]` in:
  - the global filter's `path` (http-exception.filter.ts:33);
  - Sentry `beforeSend` for `event.request.url` and breadcrumbs (sentry.ts:15-20);
  - the Caddy access log, with `format filter { wrap json; fields { request>uri regexp "^/c/[0-9a-z]+" "/c/[token]"; request>headers>Referer delete } }` (Caddyfile:5-25).
- **The link host** is the API host until a short domain is chosen. When it is, a Caddy site block serves only `/c/*`, `/robots.txt` (`Disallow: /`) and 404 for everything else.
- **Test banner:** when `APP_ENV` is not `production`, a yellow strip reads "Test system — this is not a real delivery."

## 6. The page: content, copy, design tokens, accessibility
Pure TypeScript template functions return escaped HTML, in `modules/confirmations/page/`:
- `layout`, `card`, `itemList`, `stateTag`, `buttonForm` (POST), `buttonLink` (GET), `textLink`, `commentField`, `helpLine`, `safetyNote`, `statusMark`, `testBanner`.
- All text comes from `t(key, params)` in `page/messages.en.ts` (`confirm.page.*`), and all values go through `escapeHtml`.
- Urdu later is `messages.ur.ts`, `?l=ur`, `lang="ur" dir="rtl"`.

**Design tokens** (`page/tokens.ts`)
- Injected as **literal values**: no CSS variables, no flex `gap`, no web fonts. The page then works on Opera Mini, KaiOS and old Android WebViews.
- They match the app palette (apps/mobile/src/theme/index.ts:4-20), tuned to AA.

| Token | Value | Use (contrast) |
|---|---|---|
| bg / surface | #F4F5F9 / #FFFFFF | page / card |
| ink / inkMuted | #1F2025 / #4B5563 | text 16:1 / secondary 7.6:1 |
| line / field | #E3E4E8 / #6B6F76 | dividers / input border 5:1 |
| positive | #15803D, white text 5.0:1 | All received, Send |
| danger | #B91C1C, 6.5:1 | Not received |
| link / focus | #0A55C4 6.8:1 / #0F6CF0 3 px outline | links / focus |
| tagBg / tagInk | #EEF0F4 / #374151 | state tags |
| safetyBg / safetyInk | #FEF3C7 / #78350F 8:1 | gas safety note |
| okBg / okInk | #E5F6EE / #166534 | thank-you tick |

- **Type:** base 18 px with line height 1.5, system font stack; h1 26 px, h2 18 px, small 15 px.
- **Layout:** max width 480 px with a 16 px gutter. Card radius 14, control radius 12.
- **Controls:** buttons at least 56 px high, full width, 12 px apart. Text links at least 48 px high.

**Main page (200)**
- **Head**
  - `<title>` "Confirm your delivery · {shop}".
  - `og:title` "Confirm your delivery from {shop}".
  - `og:description` "Tap to tell us what you received."
  - Link previews show no items.
- **Top**
  - Eyebrow "{shop}".
  - H1 "Did you get your delivery?"
  - Meta "Order {orderNo} · {Wed 21 Oct, 4:12 pm}".
- **Lists**
  - H2 "Delivered to you", with rows "{size} cylinder … {count}".
  - H2 "Taken back from you", with rows "[Empty | Part-filled | Full] {size} cylinder[ (no label)] … {count}". If there are none: "Nothing was taken back."
  - The hint "Something wrong with what was taken back? Tap Other problem."
- **Actions**
  - **[All received]**: positive, a form POST with `answer=YES`.
  - **[Partly received]**: outline, a link.
  - **[Not received]**: danger outline, a link.
  - "Other problem": a text link.
- **Footer**
  - "Questions? Call {shop}: {0321 1234567}" (`formatPkPhone` local style; the link is `tel:` plus the E.164 number).
  - "You can answer until {expiresAt}."
  - Safety: "Smell gas? Turn off the cylinder valve, open doors and windows, don't touch switches or flames, and call 1122."
  - "Smart Fleet sends this message for {shop}."

**Second-step pages.** Each has the eyebrow "{shop} · Order {orderNo}" and a "Back" link.

| Page | H1 | Text | Note field | Button |
|---|---|---|---|---|
| Partly received | What was missing? | Tell us what you did not get. This helps {shop} sort it out. | Your note (optional) | **[Send: partly received]** (positive, `PARTLY`) |
| Not received | You did not get this delivery? | We will tell {shop} straight away. | Anything to add? (optional) | **[Yes, I did not get it]** (danger, `NO`) |
| Other problem | Tell us what happened | | Your message (required, 300 characters at most) | **[Send]** (positive, `OTHER`) |

A missing message on the Other page shows the error "Please write a few words, or go back and pick an answer." with `role="alert"`, `aria-invalid`, `aria-describedby` and autofocus. The box keeps the cleaned text the customer sent.

**Result pages**
- **Thank you:** a tick, H1 "Thank you!", then a line for the answer:

  | Answer | Line |
  |---|---|
  | All received | We have told {shop} that you got everything. |
  | Partly received | We have told {shop} that something was missing. They may call you. |
  | Not received | We have told {shop} that you did not get this delivery. They may call you. |
  | Other problem | We have passed your message to {shop}. They may call you. |

  Then the help line and the safety note.
- **You already answered:** "On {respondedAt} you said: {answerLabel}." and "Wrong answer? Call {shop}: {phone}".
- **This link has expired (410):** "Answers close {lifetime} after delivery. If something is wrong with order {orderNo}, please call {shop}: {phone}." {lifetime} is the link's own lifetime: whole days "1 day" / "{n} days" (72 h → "3 days"), otherwise "{n} hours" (36 h → "36 hours").
- **This link is no longer active (410):** "Order {orderNo} does not need an answer any more. Questions? Call {shop}: {phone}."
- **We can't find this link (404):** "Please open the full link from your newest message. Need help? Call Smart Fleet support: {support.phone}." The number is a `tel:` link (E.164 href for a Pakistani mobile, else the stored digits keeping a leading +). When `support.phone` is null the second sentence ("Need help? Call Smart Fleet support: …") is left out, so the page shows only "Please open the full link from your newest message."
- **Too many tries (429):** "Please wait {minutes} minutes, then try again." ("Please wait 1 minute, then try again." for 1)
- **Something went wrong (500):** "Your answer was not saved. Please try again." The [Try again] form posts the hidden answer and comment again.

**Answer labels:** YES "All received", PARTLY "Partly received", NO "Not received", OTHER "Other problem".

**On every page**, state and error pages included, the gas safety note is the last block before the footer line.

**Main page skeleton** (literal tokens, no JS)
```html
<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<meta property="og:title" content="Confirm your delivery from Ali Gas"><meta property="og:description" content="Tap to tell us what you received.">
<link rel="icon" href="data:,"><title>Confirm your delivery · Ali Gas</title>
<style>*{box-sizing:border-box}body{margin:0;background:#F4F5F9;color:#1F2025;font:18px/1.5 -apple-system,"Segoe UI",Roboto,"Noto Sans",Arial,sans-serif;-webkit-text-size-adjust:100%}
.w{max-width:480px;margin:0 auto;padding:16px}.c{background:#FFF;border:1px solid #E3E4E8;border-radius:14px;padding:20px 16px;margin:0 0 16px}
.s{margin:0 0 4px;font-size:15px;font-weight:700;color:#4B5563}h1{margin:0 0 6px;font-size:26px;line-height:1.25}h2{margin:20px 0 4px;font-size:18px}
.m,.f{margin:0 0 12px;color:#4B5563;font-size:15px}ul{margin:0;padding:0;list-style:none}
li{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-top:1px solid #E3E4E8}li:first-child{border-top:0}
.q{font-weight:700;margin-left:12px}.tag{display:inline-block;font-style:normal;font-size:14px;font-weight:700;padding:2px 10px;margin-right:8px;border-radius:999px;background:#EEF0F4;color:#374151}
.b{display:block;width:100%;min-height:56px;margin:0 0 12px;padding:14px 16px;border:2px solid #1F2025;border-radius:12px;background:#FFF;color:#1F2025;font:inherit;font-weight:700;text-align:center;text-decoration:none}
.p{background:#15803D;border-color:#15803D;color:#FFF}.d{border-color:#B91C1C;color:#B91C1C}.dp{background:#B91C1C;border-color:#B91C1C;color:#FFF}
.lk{display:inline-block;min-height:48px;padding:12px 0;color:#0A55C4;font-weight:700}a:focus,button:focus,textarea:focus{outline:3px solid #0F6CF0;outline-offset:2px}
label{display:block;font-weight:700;margin:12px 0 6px}textarea{display:block;width:100%;min-height:120px;padding:12px;border:2px solid #6B6F76;border-radius:12px;font:inherit;color:#1F2025;background:#FFF}
.err{color:#B91C1C;font-weight:700}.safe{padding:12px;border-radius:12px;background:#FEF3C7;color:#78350F;font-size:15px}
.ok{width:64px;height:64px;line-height:64px;border-radius:32px;background:#E5F6EE;color:#166534;font-size:40px;text-align:center;margin:0 0 12px}</style></head>
<body><main class="w">
<section class="c" aria-labelledby="h"><p class="s">Ali Gas</p><h1 id="h">Did you get your delivery?</h1>
<p class="m">Order AG-0142 · Wed 21 Oct, 4:12 pm</p>
<h2>Delivered to you</h2><ul><li><span>11.8 kg cylinder</span><b class="q">2</b></li></ul>
<h2>Taken back from you</h2><ul><li><span><i class="tag">Empty</i>11.8 kg cylinder</span><b class="q">1</b></li></ul>
<p class="f">Something wrong with what was taken back? Tap Other problem.</p></section>
<form method="post" action="/c/{token}" accept-charset="utf-8"><input type="hidden" name="v" value="1">
<button class="b p" name="answer" value="YES">All received</button></form>
<a class="b" href="/c/{token}/partly">Partly received</a><a class="b d" href="/c/{token}/not-received">Not received</a>
<a class="lk" href="/c/{token}/other">Other problem</a>
<p class="f">Questions? Call Ali Gas: <a class="lk" href="tel:+923211234567">0321 1234567</a></p>
<p class="f">You can answer until Sat 24 Oct, 4:12 pm.</p>
<p class="safe" role="note">Smell gas? Turn off the cylinder valve, open doors and windows, don't touch switches or flames, and call 1122.</p>
<p class="f">Smart Fleet sends this message for Ali Gas.</p></main></body></html>
```

**Accessibility (WCAG 2.1 AA)**
- `lang` and `dir` set; one h1; lists as `<ul>`; real `<button>` and `<a>` elements.
- A visible focus outline; zoom is never locked; text at least 15 px.
- A state is never shown by colour alone (tags carry words).
- Labels are bound to their fields, and errors are announced. The thank-you page uses `aria-live="polite"`.
- Full-width blocks suit KaiOS D-pad navigation.

**Low-end budget**
- At most 12 KB of HTML (about 4 KB gzipped), with no JavaScript, cookies, fonts or images. The favicon is a `data:` URL and the tick is a text glyph.
- Server time at most 150 ms at the 95th percentile.
- Usable within 3 seconds on 2G.
- **Test on:** Android Go Chrome, Android 5 WebView, Opera Mini (extreme mode), UC Browser, KaiOS 2.5, iPhone Safari, and TalkBack.
- **Dates** use `formatPkDateTime` (shared-utils): "Wed 21 Oct, 4:12 pm" for 2026-10-21T11:12Z, at a fixed UTC+5 offset with no ICU dependency. Snapshot tests use its output, never these examples.

## 7. Recording an answer (`ConfirmationsService.record`)
One transaction:
1. Look up the token by `sha256(token)`.
2. Lock it: `SELECT … FROM delivery_confirmations WHERE token_hash = $h FOR UPDATE`.
3. Re-check that it is PENDING and that `now < expires_at`. Otherwise answer as the §4 state order says (for an ANSWERED link, 303 for the stored answer and 409 for another) and write nothing.
4. `UPDATE … SET response, comment, responded_at = now(), status = 'ANSWERED' WHERE id = $id AND status = 'PENDING'`.
5. Audit `confirmation.answer`: actor kind `CUSTOMER`, label `link:<orderShortCode>` (e.g. `link:AG-0142`), resourceType `Order`, resourceId the order id, distributorId the order's distributor, diff `{ response }`. No IP or user agent.
6. In the same transaction: if the response is in `confirmation.caseOnAnswers`, `alerts.raise({ alertType: 'CUSTOMER_PROBLEM', severity: PARTLY ? 'INFO' : 'WARNING', distributorId, resourceType: 'Order', resourceId: orderId, context: { orderId, orderShortCode, distributorId, answer, comment }, dedupeKey }, tx)`. `raise(…, tx)` uses the caller's transaction (alerts.service.ts:36 gains an optional `tx`). If it fails the answer rolls back and the customer gets the 500 page, so an answer that needs a case never ends without one.

**No wallet call exists anywhere in this module.** A test asserts it.

## 8. Messaging
The module is `apps/api/src/modules/messaging/` (@Global). The OTP `SmsService` stays as it is.
```ts
export type MessageChannel = 'SMS' | 'WHATSAPP';
export interface OutboundRequest {
  messageId: string;                       // outbound_messages.id = provider idempotency key
  channel: MessageChannel; toE164: string; // +923001234567
  templateKey: 'sms.deliveryConfirm.v1'; locale: 'en';
  params: Record<string, string>;          // shop, orderNo, link, phone
  text: string;                            // rendered and GSM-7 checked; WhatsApp adapters use templateKey + params instead
}
export type SendResult =
  | { kind: 'SENT'; providerMessageId: string }
  | { kind: 'SKIPPED'; reason: 'MOCK_PROVIDER' | 'NOT_A_TEST_PHONE' }
  | { kind: 'FAILED'; code: 'INVALID_NUMBER' | 'REJECTED' | 'TIMEOUT' | 'AUTH' | 'UNAVAILABLE' | 'UNKNOWN'; detail?: string };
export interface MessagingProvider {
  readonly name: string;                   // mock | eocean | (later) whatsapp-cloud
  supports(channel: MessageChannel): boolean;
  send(req: OutboundRequest): Promise<SendResult>;
}
```
- **`MockMessagingProvider`** is the Inc 2 default. It logs only `{to: maskPhone(toE164), templateKey, chars}`, **never the text or the link**. The current mock SMS logs the whole body (providers/mock-sms.provider.ts:27-34), so links must never go through it.
- **Choosing the provider:** a factory, like sms.module.ts:13-30, picks it from env `MESSAGING_PROVIDER`. An unknown name refuses to boot.
- **Test mode** (`messaging.testMode`, default true) wraps the provider. Only numbers in `messaging.allowlist` are sent for real; everyone else is `SKIPPED` with `NOT_A_TEST_PHONE`. The test-mode check runs first, so with the pilot defaults (mock, test mode on, empty allowlist) every SMS row is `SKIPPED` with `NOT_A_TEST_PHONE`; `MOCK_PROVIDER` appears only for allowlisted numbers or with test mode off.
- **Sending:** the `QUEUED` row is written inside the transaction that sets the order DELIVERED (the stop finish, or the office manual delivery v2) or makes a new link with `send: 'SMS'`. After commit, `MessagingService.sendQueued(id)` calls the provider once with 15 seconds to answer and updates the row to `SENT`, `SKIPPED` or `FAILED`: no answer is `TIMEOUT`, a thrown error `UNKNOWN` (detail only in the log).
  - There is **no queue, no sweeper and no automatic retry** for the pilot. A row still `QUEUED` 2 minutes after it was written (the process died) counts as not sent (reach `NOT_SENT`) and the shop shares the link.
- **The message log** (`outbound_messages`) has one row per SMS attempt and per app share:
  - a share is channel `SHARE_LINK`, provider `share-whatsapp`, `share-sms`, `share-sheet` or `share-copy`, status `SENT`, with `createdByUserId`;
  - `bodyRedacted` has the token replaced by `[link]`.
- **Later**, not in Inc 2: an `EoceanMessagingProvider` that sends the text in the POST body, not the query string (eocean-sms.provider.ts:28-41), plus delivery reports by webhook (no messaging webhook is registered in the pilot: `POST /webhooks/messaging/:provider` answers 404 until a provider that sends reports arrives, behind its own signature check) and a WhatsApp provider after Meta's written OK.
- **Status words** (the office website, from `reach` and `lastMessage`; the shop card uses the §10 bodies):

  | Status | Words |
  |---|---|
  | SMS QUEUED, under 2 minutes | Sending text… |
  | SMS QUEUED, 2 minutes or more (lost) | Not sent |
  | SMS SENT | Text sent {time} |
  | SMS DELIVERED (later) | Text delivered {time} |
  | SMS SKIPPED | Not sent — text messages are off |
  | SMS FAILED | Text didn't send — {reason} |
  | Share (SHARE_LINK) | Shared {time} by {byName} ({via}) |

  No message yet also reads "Not sent". Once the link is closed: "Answered {time}" or "Expired".

  FAILED reasons:

  | Code | Reason |
  |---|---|
  | INVALID_NUMBER | the number looks wrong |
  | REJECTED | the SMS company refused it |
  | TIMEOUT | the SMS company did not answer |
  | AUTH | SMS account problem |
  | UNAVAILABLE | the SMS company is down |
  | UNKNOWN | something went wrong |

## 9. SMS text (English, GSM-7, one segment)
Template `sms.deliveryConfirm.v1`: `{shop}: Order {orderNo} delivered. Did you get it? Tap {link} Help: {phone}`

Example (125 characters): `Ali Gas: Order AG-0142 delivered. Did you get it? Tap https://smartfleetpk.com/c/3h7k9m2q4r6t8v0w1x5y7z9a2b Help: 03211234567`

| Part | Maximum |
|---|---|
| Fixed text | 47 |
| `shop` (business name made GSM-safe, at most 20; rule below) | 20 |
| `orderNo` (`ABCDEF-9999`; past 9999 up to `ABCDEF-99999`) | 11 (12) |
| link (host of 24 or fewer) | 61 |
| `phone` (`formatPkPhone(phone, 'compact')`, "03211234567") | 11 |
| **Worst case** | **150 of 160 (151 past 9999)** |

`renderSms()`:
- asserts the GSM-7 basic set and at most 160 characters;
- when too long, drops " Help: {phone}" first, then shortens the shop name;
- never puts punctuation straight after the link.

**GSM-safe shop name** (`smsShopName`): decompose accents and drop the marks; ’ ‘ → ', – — → -, … → ..., other spaces → space; remove “ ”; keep only A–Z, a–z, 0–9, space and `. , - & ' ( ) ! ? /`; collapse spaces, trim, cut to 20, trim. Nothing left (an Urdu-only name) → "Smart Fleet". The page itself shows the full business name.

The same text is used for app shares (WhatsApp, the SMS app, the share sheet, copy).

## 10. Shop app and office API (owning distributor or SUPER_ADMIN; a DRIVER gets 404)
```ts
ConfirmationView = { orderId; orderShortCode; status: 'PENDING' | 'ANSWERED' | 'EXPIRED' | 'CANCELLED';
  response: 'YES' | 'PARTLY' | 'NO' | 'OTHER' | null; comment: string | null; respondedAt: string | null; expiresAt: string;
  reach: 'NOT_SENT' | 'SMS_SENDING' | 'SMS_SENT' | 'SMS_FAILED' | 'SHARED';  // newest row of the current link version: none, SKIPPED or QUEUED ≥ 2 min → NOT_SENT; QUEUED < 2 min → SMS_SENDING; SENT/DELIVERED → SMS_SENT; FAILED → SMS_FAILED; share → SHARED
  lastMessage: { channel; status; errorCode; at; byName: string | null; via: string | null } | null;  // newest row of the current link version; null right after a new link
  customer: { name; phoneDisplay; phoneValid: boolean };
  delivered: { size; count }[]; takenBack: { size; state; count; unlabelled }[];
  caseOpen: boolean; allowedActions: ('SHARE' | 'NEW_LINK')[] }
```
- **`GET /orders/:id/confirmation`**: `ConfirmationView`. Checks in order: setting off 403 `FEATURE_DISABLED` (`X-Feature-Disabled: confirmations`) for every caller; driver or other distributor 404; not DELIVERED 409 `CONFIRM_NOT_READY`; no confirmation row (delivered while off, no back-fill) 404 `NOT_FOUND`. Share and new link run these first.
- **`POST /orders/:id/confirmation/share`** `{ via: 'WHATSAPP' | 'SMS' | 'SHARE_SHEET' | 'COPY' }` returns `{ url, message, whatsappUrl, smsUrl, expiresAt }`.
  - The current token is re-derived (no rotation).
  - It writes a share row. `whatsappUrl` (`https://wa.me/923001234567?text=…`) and `smsUrl` (`sms:+923001234567?body=…`) are null when the phone is invalid.
  - `Cache-Control: no-store`. Key `share:<orderId>:<Idempotency-Key>` (a new UUID when none is sent): a repeat returns 200 with the same body and `Idempotent-Replay: true`, writing nothing (409 `IDEMPOTENCY_CONFLICT` when `via` differs). After the common checks: the replay; `CONFIRM_CLOSED` once answered, expired or cancelled; at most 20 share rows per order in any 60 minutes, else 429 `RATE_LIMITED` `{minutes}` (replays write no row and are never limited).
- **`POST /orders/:id/confirmation/new-link`** `{ send?: 'SMS' }`
  - After the common checks, in order: the Idempotency-Key of the last rotation → 200 current view with `Idempotent-Replay: true`, nothing done; not PENDING or `now ≥ expiresAt` → 409 `CONFIRM_CLOSED`; `send: 'SMS'` with an invalid current customer phone → 400 `CLIENT_PHONE_INVALID`, before any change.
  - One transaction: lock the row `FOR UPDATE` and re-check PENDING; `tokenVersion += 1`, new `tokenHash`, `phoneE164` refreshed from the customer's current phone (NULL if it isn't a mobile), `lastNewLinkKey` = the key (NULL without one, so every keyless call rotates); with `send: 'SMS'` a QUEUED row `confirm:<orderId>:v<n>:sms`, sent after commit. `expiresAt` never changes.
  - Returns `ConfirmationView`. Audit `confirmation.new_link` (resourceType `Order`).
- **Order lists** (`GET /orders?tab`, `GET /orders/board`) add `confirmation: { status, response, caseOpen } | null` in one join.

**The shop app card** (`apps/mobile/src/components/CustomerConfirmCard.tsx`)
- Shown in the order detail (UX_MOBILE S14) when `features.confirmations` is on and the order's `confirmation` field is not null.
- It refetches every 20 seconds while PENDING and the screen is focused.
- It uses only core React Native APIs, so it ships over the air:
  - `Linking.openURL(whatsappUrl or smsUrl)` (the wa.me precedent is AboutScreen.tsx:33);
  - `Share.share({message})`;
  - `Clipboard.setString(message)`.

  Each action calls `share` first, with the matching `via`.

| State | Title / pill | Body | Actions |
|---|---|---|---|
| Loading | "Customer confirmation" | skeleton | none |
| Error | none | "Could not load the customer confirmation." | [Try again] |
| PENDING, NOT_SENT, last SMS skipped | "Ask the customer to confirm" | `confirm.ask.smsOff` | **[Send on WhatsApp]** · [Send by text message] · "Share another way" · "Copy message" |
| PENDING, NOT_SENT, no SMS or lost send | same | `confirm.ask.notSent` | same |
| PENDING, SMS_FAILED | same | `confirm.ask.smsFailed` | same |
| PENDING, SHARED | pill "Waiting for {{name}}" | "Link given at {{time}} ({{via}}). Make sure it was sent." | the send buttons as secondary |
| PENDING, SMS_SENT | pill "Waiting for {{name}}" | "Link sent by text to {{phone}} at {{time}}." | "Send on WhatsApp too" · "Copy message" |
| PENDING, SMS_SENDING | pill "Waiting for {{name}}" | `confirm.smsSending` | the send buttons as secondary |
| ANSWERED | pill with the answer label (YES success, PARTLY warning, NO danger, OTHER warning) and the time | the comment in quotes. NO or OTHER: "The office will look into it." | none |
| EXPIRED | pill "No answer" | none | none |
| CANCELLED (reserved) | pill "Not needed" | "This link was closed." | none |
| Invalid phone | warning | "This number looks wrong: {{phone}}. Fix it, then make a new link." | [Fix number] → edit customer |

- The caption while PENDING: "{{name}} can answer until {{time}}."
- "Make a new link" (low emphasis) confirms first: "Make a new link? The old link will stop working." Afterwards the card reads as not sent until the new link is sent or shared.
- **The card has no money line.** The order's delivery cost line stays as it was when the order was placed.
- **Copy keys** (mobile namespace `confirm`):

  | Key | Text |
  |---|---|
  | `confirm.title` | Customer confirmation |
  | `confirm.ask.title` | Ask the customer to confirm |
  | `confirm.ask.smsOff` | Text messages are not switched on yet. Send this link to {{name}} ({{phone}}). |
  | `confirm.ask.notSent` | Send this link to {{name}} ({{phone}}). |
  | `confirm.ask.smsFailed` | The text message didn't send: {{reason}}. Send this link to {{name}} ({{phone}}). |
  | `confirm.smsFailReason.INVALID_NUMBER` / `.REJECTED` / `.TIMEOUT` / `.AUTH` / `.UNAVAILABLE` / `.UNKNOWN` | the §8 FAILED reasons: the number looks wrong / the SMS company refused it / the SMS company did not answer / SMS account problem / the SMS company is down / something went wrong |
  | `confirm.waiting` | Waiting for {{name}} |
  | `confirm.shared` | Link given at {{time}} ({{via}}). Make sure it was sent. |
  | `confirm.via.WHATSAPP` / `.SMS` / `.SHARE_SHEET` / `.COPY` | WhatsApp / text message / other app / copied |
  | `confirm.smsSent` | Link sent by text to {{phone}} at {{time}}. |
  | `confirm.smsSending` | Sending a text message to {{phone}}… |
  | `confirm.until` | {{name}} can answer until {{time}}. |
  | `confirm.answer.YES` / `.PARTLY` / `.NO` / `.OTHER` | All received / Partly received / Not received / Other problem |
  | `confirm.noReply` | No answer |
  | `confirm.officeWillCheck` | The office will look into it. |
  | `confirm.btn.whatsapp` | Send on WhatsApp |
  | `confirm.btn.sms` | Send by text message |
  | `confirm.btn.share` | Share another way |
  | `confirm.btn.copy` | Copy message |
  | `confirm.btn.newLink` | Make a new link |
  | `confirm.btn.fixNumber` | Fix number |
  | `confirm.toast.copied` | Message copied |
  | `confirm.newLink.confirm` | Make a new link? The old link will stop working. |
  | `confirm.loadError` | Could not load the customer confirmation. |
  | `confirm.linkError` | Could not get the link. Check your internet and try again. |

**The office:** the order drawer shows the answer and "Copy customer link", and Customer problems lists the cases (UX_ADMIN §3.2–3.3).

**The driver:** sees nothing of this. The Visit "Done" screen says "Visit done", with no link and no promise of a message.

## 11. Settings and env
| Key | Default |
|---|---|
| `confirmation.enabled` | false (owner to confirm) |
| `confirmation.linkTtlHours` | 72 |
| `confirmation.caseOnAnswers` | [NO, OTHER] |
| `messaging.testMode` | true |
| `messaging.allowlist` | [] |
| `support.phone` | set by the CLI or setup, before `confirmation.enabled` is switched on (the not-found page shows it) |

Env: `PUBLIC_LINK_BASE_URL` (https in production), `CONFIRM_LINK_SECRET` (at least 32 characters), `MESSAGING_PROVIDER` (`mock`), the existing Eocean variables, and `APP_ENV`.

Error codes are in API_CONTRACT §2.3, under "Customer confirmation and cases".

## 12. Security and privacy
- **The token** has 130 bits and is derived with a server secret. Only its hash is stored. It is redacted in Caddy, the global filter, Sentry, the mock provider and the message log.
- **The page** shows no customer name, address, price or cylinder numbers. Link previews show only the title and description.
- **Forms** are same-origin POSTs with no cookies. The CSP sets `form-action 'self'` and `frame-ancestors 'none'`.
- **Abuse is low value**, because an answer moves no money: at worst it opens a case.
  - The link is shared by the shop or the office, never by the driver.
  - Only a super admin closes cases, and every close is audited.
- **Retention:** `outbound_messages` are kept for 12 months. No IP address or user agent is stored for answers.

## 13. Tests (added to the Inc 2 suite)
**Unit**
- Token: derivation is stable for the same `(id, version)`; normalising `I`, `L`, `O` and upper case; 26-character format checks; no collisions in 100,000.
- `renderSms`: at most 160 characters across the worst-case matrix, GSM-7 only, the fallbacks work, nothing straight after the link.
- HTML: escaping; a snapshot per state; the token appears only in `href` and `action`; no `<script>`; no page contains a cylinder number (pattern `[A-Z][A-Z0-9]{1,5}-C[0-9]{4,}`).

**Integration** (real Postgres)
- Issuing twice for one order gives one row.
- GET, HEAD and bot user agents never record an answer.
- The same POST twice records once (the repeat gets 303 to "Thank you"); a different second answer gets 409; two different answers in parallel leave one winner.
- Each state page returns its HTTP code.
- A `NO` answer opens exactly one case; a `YES` opens none.
- **No answer, share or expiry job writes `ledger_entries` or changes `distributors.advance_balance_paisa`.**
- A driver gets 404 on the confirmation routes.
- Test mode calls the provider only for allowlisted phones.
- Redaction: no `/c/[0-9a-z]{26}` in logs, filter bodies, Sentry events or `bodyRedacted`.
- `/c/:token` works and `/api/v1/c/:token` returns 404.

**End to end on staging**
1. Finish a stop.
2. The shop card shows "Ask the customer to confirm".
3. Share the link.
4. Open the page: at most 12 KB, no extra requests.
5. Tap All received.
6. The card shows "All received" and the wallet is unchanged.

## 14. Build order and effort
1. Migration (DATA_MODEL §4).
2. Messaging module (interface, mock, test mode, log).
3. ConfirmationsService (issue, view, share, new link, record, expiry job).
4. Public page (controller, renderer, filter, headers, limits, prefix exclude, trust proxy, Caddy and Sentry redaction).
5. Shop app card.
6. Office drawer and problems page.
7. Settings.

Effort is about **6–8 person-days** (backend 4–5, mobile 1–1.5, web 1–1.5).

# Customer confirmation page and messages (Inc 2)

**Status:** designed for Inc 2. It is built **last** in Inc 2 as a separate slice behind `confirmation.enabled`, which defaults to **false** until the owner confirms it stays in the pilot.

Nothing else depends on it. With the setting off:
- stops finish normally;
- no link is made;
- every screen hides its confirmation parts;
- the shop and office confirmation routes answer 403 `FEATURE_DISABLED` ("This isn't available yet."), and a link already sent shows "This link is closed" (410) and records nothing;
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
1. Bad format or unknown token: **404** "We can't find this link". A known token while `confirmation.enabled` is false: **410** "This link is closed", nothing recorded.
2. ANSWERED: GET **200**, "Thank you" if `?done=1`, otherwise "You already answered". POST of the stored answer: **303** to `/c/:token?done=1`, nothing recorded. POST of any other answer: **409** "You already answered" (`CONFIRM_ALREADY_ANSWERED`), nothing recorded.
3. CANCELLED: **410** "This link is closed".
4. EXPIRED, or `now ≥ expiresAt`: **410** "This link has expired".
5. PENDING: **200**, the main page.

The second-step pages (`/partly`, `/not-received`, `/other`) follow the same state order: PENDING shows the form, other states their page. Any other path or method under `/c/` gets the 404 page with no database lookup.

**POST validation** (zod by hand; the body typed `unknown`, as payments.controller.ts:39-41 does):
- After the state order: `answer` must be exactly `YES`, `PARTLY`, `NO` or `OTHER`; a missing or other value gets the main page with **400** and "Please tap one answer below." (`role="alert"`), nothing recorded. `v` is ignored.
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
  - As built: the exclusion is `CONFIRM_PAGE_PREFIX_EXCLUDE` (modules/confirmation/public/page-routes.ts, which imports nothing but Nest), applied in `configureApp`, which main.ts and the API tests share. It has two entries, `c/(.*)` and `c/*`, both method ALL: Nest matches route paths against `c/(.*)` (path-to-regexp 3), while the app-wide middleware (the request id, the request log) is mounted on Express with each excluded path, and Express 4 reads only `c/*` as "anything under /c/". Without `c/*` the page gets no request id and the answer's audit row loses it. The controller's catch-all is `@All('*')`, declared last.
- **The controller:** `PublicConfirmController` with `@Controller('c')`, `@Public()` (public.decorator.ts:4) and `@UseFilters(PublicPageExceptionFilter)`.
  - The filter turns every error, throttling included, into an HTML page with the code's status, never JSON, never echoing the URL: `CONFIRM_LINK_INVALID` 404 not found; `CONFIRM_LINK_INACTIVE` 410 closed; `CONFIRM_LINK_EXPIRED` 410 expired; `CONFIRM_ALREADY_ANSWERED` 409 already answered; `CONFIRM_NOTE_REQUIRED` 400 Other page with its error; `VALIDATION_FAILED` 400 main page with "Please tap one answer below."; `RATE_LIMITED` 429 too many tries; anything else 500. GET of an ANSWERED or PENDING link renders its 200 page directly.
  - Pages are sent with `res.status(code).type('html').send(html)`.
- **Redaction:** `/c/<token>` becomes `/c/[token]` in:
  - the global filter's `path` (http-exception.filter.ts:33);
  - Sentry `beforeSend` for `event.request.url` and breadcrumbs (sentry.ts:15-20);
  - the Caddy access log, with `format filter { wrap json; fields { request>uri regexp "^/c/[0-9a-z]+" "/c/[token]"; request>headers>Referer delete } }` (Caddyfile:5-25). As built, both API hosts log this way, and their site-wide `header` block skips `/c` and `/c/*` (only HSTS applies there), so it neither overrides nor duplicates the page's own Referrer-Policy, X-Content-Type-Options and CSP. The short-link-domain block is in the Caddyfile, commented out, until a domain is chosen.
- **The link host** is the API host until a short domain is chosen. When it is, a Caddy site block serves only `/c/*`, `/robots.txt` (`Disallow: /`) and 404 for everything else.
- **Test banner:** when `APP_ENV` is not `production`, a yellow strip (`.strip`, first on the page) reads "Test only · not a real delivery".

## 6. The page: content, copy, design tokens, accessibility
Designed to UX_PRINCIPLES §7.6 on 2026-10-23 (the Inc 2/3 spec §1): a two-row summary, three 64 px answer buttons with small icons, and a tap-to-call row. The words above the buttons fall from 31 to 18.

As built (Inc 2 server, 2026-10-23): the page lives in `modules/confirmation/page/` (singular, as the module is named): `messages.en.ts`, `tokens.ts`, `icons.ts`, `templates.ts` (layout, eyebrow, statusMark, callRow, buttonForm, buttonLink, textLink, commentField, safetyNote, testBanner) and `pages.ts`. The copy and layout are the simple design's (the UX spec for the customer page, with DECIDED's inline SVG icons). Additions: the lifetime word "1 hour" for a 1-hour link (the list below had only days and "n hours"); state tags at 15 px (the skeleton's 14 px was below "text at least 15 px"); the column width written `max-width:30rem` (480 px at the default root size). The largest page measured 5,954 bytes (2,104 gzipped).

Pure TypeScript template functions return escaped HTML, in `modules/confirmations/page/`:
- `layout`, `card`, `summaryTable`, `stateTag`, `buttonForm` (POST), `buttonLink` (GET), `textLink`, `commentField`, `callRow`, `safetyNote`, `statusMark`, `icon`, `testStrip`.
  - `callRow(label, phone)` replaces `helpLine`: a full-width 48 px `tel:` link with the phone icon and "{label} · {phone}" (the phone in `formatPkPhone` local style, the href E.164).
  - `statusMark(kind)` draws the 64 px circle: green with the check icon, or neutral with the state's icon.
  - `icon(name)` returns one of the inline SVG icons below.
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
| link / focus | #0A55C4 6.8:1 / #0F6CF0 3 px outline | links, call rows / focus |
| tagBg / tagInk | #EEF0F4 / #374151 | state tags, the neutral status mark |
| safetyBg / safetyInk | #FEF3C7 / #78350F 8:1 | gas safety note, the test strip |
| okBg / okInk | #E5F6EE / #166534 | the green status mark |

- **Type:** base 18 px with line height 1.5, system font stack; h1 26 px, h2 18 px, small 15 px.
- **Layout:** max width 480 px with a 16 px gutter. Card radius 14, control radius 12.
- **Controls:** the answer buttons and Send are at least **64 px** high, full width, 12 px apart. Text links and call rows are at least 48 px high.
- **Icons:** decorative inline `<svg>` with lucide 0.400.0 geometry (ISC licence, already in the repo through the website): `viewBox="0 0 24 24"`, `stroke="currentColor"`, `aria-hidden="true"`, `focusable="false"`, and **no `xmlns`** (the HTML parser puts `<svg>` in the SVG namespace anyway, so the only URLs on the page stay the `/c/` paths, the `tel:` links and the `data:,` favicon). 28 px in buttons and rows, 36 px in the 64 px status mark; under `[dir=rtl]` the margin flips. The words carry the meaning, so a browser that draws nothing loses nothing. About 2 KB at most per page (the main page's 5 icons are about 1.6 KB before gzip).

  | Icon | Used on |
  |---|---|
  | circle-check | All received |
  | contrast | Partly received |
  | circle-x | Not received |
  | message-square-warning | Other problem |
  | phone | call rows |
  | arrow-left | Back |
  | check | the thank-you and already-answered mark |
  | clock | expired |
  | link-2-off | link closed |
  | circle-help | not found |
  | hourglass | too many tries |
  | circle-alert | something went wrong |

- **Test strip:** on any `APP_ENV` other than production, the strip "Test only · not a real delivery" (`.strip`) sits first.
- **Footer line:** on every page that knows the shop, "Sent by Smart Fleet for {shop}." comes last, with the gas safety note just above it.

**Main page (200)**
- **Head**
  - `<title>` "Confirm your delivery · {shop}".
  - `og:title` "Confirm your delivery from {shop}".
  - `og:description` "Tap to tell us what you received."
  - Link previews show no items.
- **Card**
  - Eyebrow "{shop}".
  - H1 "Did you get your delivery?"
  - Meta "Order {orderNo} · {Wed 21 Oct, 4:12 pm}".
  - **The summary table** (`<table class="sum">`, 2 rows, each a `<th scope="row">` and a `<td>`):
    - "Delivered": one line per size, "2 × 11.8 kg", in the snapshot's order (ascending sizes);
    - "Taken back": one line per size and state, "1 × 11.8 kg" plus the state tag (Empty, Part-filled or Full) and " · no label" for unlabelled rows; "None" when nothing was taken back.
  - The hint "Not right? Tap Other problem." (the three answers describe only what was delivered: a wrong take-back can be reported only through Other problem).
- **Only on 400:** a red line "Please tap one answer below." (`role="alert"`) above the buttons.
- **Actions**
  - **[All received]**: positive, solid, a form POST with `answer=YES`, with the circle-check icon.
  - **[Partly received]**: white with a dark border, a link to `/c/{token}/partly`, with the contrast icon.
  - **[Not received]**: a red border, a link to `/c/{token}/not-received`, with the circle-x icon.
  - "Other problem": a full-width 48 px text link to `/c/{token}/other`, with the message-square-warning icon.
- **Footer**
  - The call row "Call {shop} · {0321 1234567}" (`tel:` plus the E.164 number).
  - "Answer by {expiresAt}."
  - Safety: "Smell gas? Turn off the cylinder valve, open doors and windows, don't touch switches or flames, and call 1122." (never counted, never cut).
  - "Sent by Smart Fleet for {shop}."

**Second-step pages.** Each has the eyebrow "{shop} · Order {orderNo}", the h1 with its 32 px icon (the answer they tapped, so they can see what they are sending), one note field (`maxlength="300"`, the server's own cut, so the limit needs no words), and **"Back" (with the arrow-left icon) under the button**, so a keypad's D-pad reaches the box and Send first.

| Page | H1 | Note field | Button |
|---|---|---|---|
| Partly received | Partly received | What was missing? (optional) | **[Send]** (positive, `PARTLY`) |
| Not received | Not received | Anything to add? (optional) | **[Send]** (solid red, `NO`) |
| Other problem | Other problem | What happened? (required) | **[Send]** (positive, `OTHER`) |

A missing message on the Other page shows the error "Please write a few words." with `role="alert"`, `aria-invalid`, `aria-describedby` and autofocus. The box keeps the cleaned text the customer sent. The rules are unchanged: the same GET routes, POST and hidden fields; Other problem still needs at least 3 characters after cleaning; notes are still cleaned and cut to 300.

**Result pages.** Each is a card with the eyebrow "{shop} · Order {orderNo}" (only when the link is known), a 64 px status mark, the h1 and at most one line; then a call row when a phone is known; the gas safety note always; and the footer line only when the shop is known.
- **Thank you** (`aria-live="polite"`; the green mark with the check): H1 "Thank you!", then a line for the answer:

  | Answer | Line |
  |---|---|
  | All received | We told {shop} you got everything. |
  | Partly received | We told {shop} something was missing. They may call you. |
  | Not received | We told {shop} you did not get it. They may call you. |
  | Other problem | We sent your message to {shop}. They may call you. |

  Then the call row "Call {shop}".

| Page (HTTP) | Mark | H1 | Line | Call row |
|---|---|---|---|---|
| Already answered (200 / 409) | green, check | You already answered | You said: {answerLabel} · {respondedAt} | Wrong? Call {shop} |
| Expired (410) | grey, clock | This link has expired | Answers close {lifetime} after delivery. ({lifetime} is the link's own lifetime: whole days "1 day" / "{n} days" (72 h → "3 days"), otherwise "{n} hours" (36 h → "36 hours")) | Problem? Call {shop} |
| No longer active (410) | grey, link-2-off | This link is closed | No answer is needed. | Questions? Call {shop} |
| Not found (404) | grey, circle-help | We can't find this link | Open the full link in your newest message. | Call Smart Fleet support (only when `support.phone` is set; the number is a `tel:` link, E.164 for a Pakistani mobile, else the stored digits keeping a leading +). The page shows no shop, order or footer |
| Too many tries (429) | grey, hourglass | Too many tries | Please wait {minutes} minutes, then try again. ("Please wait 1 minute, then try again." for 1) | none |
| Something went wrong (500) | grey, circle-alert | Something went wrong | Your answer was not saved. | none; a green **[Try again]** form posts the hidden answer and comment again |

**Answer labels:** YES "All received", PARTLY "Partly received", NO "Not received", OTHER "Other problem".

**On every page**, state and error pages included, the gas safety note is the last block before the footer line.

**Main page skeleton** (literal tokens, no JS; the icons' paths are shortened here to "…")
```html
<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<meta property="og:title" content="Confirm your delivery from Ali Gas"><meta property="og:description" content="Tap to tell us what you received.">
<link rel="icon" href="data:,"><title>Confirm your delivery · Ali Gas</title>
<style>*{box-sizing:border-box}body{margin:0;background:#F4F5F9;color:#1F2025;font:18px/1.5 -apple-system,"Segoe UI",Roboto,"Noto Sans",Arial,sans-serif;-webkit-text-size-adjust:100%}
.w{max-width:480px;margin:0 auto;padding:16px}.c{background:#FFF;border:1px solid #E3E4E8;border-radius:14px;padding:20px 16px;margin:0 0 16px}
.s{margin:0 0 4px;font-size:15px;font-weight:700;color:#4B5563}h1{margin:0 0 6px;font-size:26px;line-height:1.25}
.m,.f{margin:0 0 12px;color:#4B5563;font-size:15px}
.sum{width:100%;border-collapse:collapse;margin:12px 0 4px}.sum th{width:34%;padding:8px 12px 8px 0;text-align:left;vertical-align:top;font-size:15px;color:#4B5563}
.sum td{padding:8px 0;font-weight:700}.sum tr+tr th,.sum tr+tr td{border-top:1px solid #E3E4E8}
.tag{display:inline-block;font-style:normal;font-size:14px;font-weight:700;padding:2px 10px;margin:0 8px;border-radius:999px;background:#EEF0F4;color:#374151}
.b{display:block;width:100%;min-height:64px;margin:0 0 12px;padding:14px 16px;border:2px solid #1F2025;border-radius:12px;background:#FFF;color:#1F2025;font:inherit;font-weight:700;text-align:center;text-decoration:none}
.p{background:#15803D;border-color:#15803D;color:#FFF}.d{border-color:#B91C1C;color:#B91C1C}.dp{background:#B91C1C;border-color:#B91C1C;color:#FFF}
.b svg,.blk svg,.call svg{vertical-align:middle;margin:0 10px 0 0}
.blk{display:block;text-align:center;min-height:48px;padding:12px 0;color:#0A55C4;font-weight:700}
.call{display:block;min-height:48px;padding:12px 0;color:#0A55C4;font-weight:700;text-decoration:none}
a:focus,button:focus,textarea:focus{outline:3px solid #0F6CF0;outline-offset:2px}
label{display:block;font-weight:700;margin:12px 0 6px}textarea{display:block;width:100%;min-height:120px;padding:12px;border:2px solid #6B6F76;border-radius:12px;font:inherit;color:#1F2025;background:#FFF}
.err{color:#B91C1C;font-weight:700}.safe{padding:12px;border-radius:12px;background:#FEF3C7;color:#78350F;font-size:15px}
.mk{width:64px;height:64px;border-radius:32px;padding:14px;margin:0 0 12px;background:#EEF0F4;color:#374151}.mk.ok{background:#E5F6EE;color:#166534}
.strip{margin:0 0 12px;padding:10px 12px;border-radius:12px;background:#FEF3C7;color:#78350F;font-size:15px;font-weight:700}
[dir=rtl] .b svg,[dir=rtl] .blk svg,[dir=rtl] .call svg{margin:0 0 0 10px}[dir=rtl] .sum th{text-align:right;padding:8px 0 8px 12px}</style></head>
<body><main class="w">
<p class="strip">Test only · not a real delivery</p>
<section class="c" aria-labelledby="h"><p class="s">Ali Gas</p><h1 id="h">Did you get your delivery?</h1>
<p class="m">Order AG-0142 · Wed 21 Oct, 4:12 pm</p>
<table class="sum"><tr><th scope="row">Delivered</th><td>2 × 11.8 kg</td></tr>
<tr><th scope="row">Taken back</th><td>1 × 11.8 kg<i class="tag">Empty</i></td></tr></table>
<p class="f">Not right? Tap Other problem.</p></section>
<form method="post" action="/c/{token}" accept-charset="utf-8"><input type="hidden" name="v" value="1">
<button class="b p" name="answer" value="YES"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false">…</svg>All received</button></form>
<a class="b" href="/c/{token}/partly"><svg …>…</svg>Partly received</a><a class="b d" href="/c/{token}/not-received"><svg …>…</svg>Not received</a>
<a class="blk" href="/c/{token}/other"><svg …>…</svg>Other problem</a>
<a class="call" href="tel:+923211234567"><svg …>…</svg>Call Ali Gas · 0321 1234567</a>
<p class="f">Answer by Sat 24 Oct, 4:12 pm.</p>
<p class="safe" role="note">Smell gas? Turn off the cylinder valve, open doors and windows, don't touch switches or flames, and call 1122.</p>
<p class="f">Sent by Smart Fleet for Ali Gas.</p></main></body></html>
```

**Accessibility (WCAG 2.1 AA)**
- `lang` and `dir` set; one h1; the summary as a table with row headers; real `<button>` and `<a>` elements.
- A visible focus outline; zoom is never locked; text at least 15 px.
- A state is never shown by colour alone (tags carry words). Icons are `aria-hidden`, so a screen reader (TalkBack) reads only each button's words.
- Labels are bound to their fields, and errors are announced. The thank-you page uses `aria-live="polite"`.
- Full-width blocks suit KaiOS D-pad navigation.

**Low-end budget**
- At most 12 KB of HTML (about 4 KB gzipped), with no JavaScript, cookies, fonts or image files. The favicon is a `data:` URL; the icons are inline SVG (about 2 KB at most per page), and the tick is the check icon in the green `.mk.ok` circle.
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

As built: the page itself runs the §4 state order without a lock and validates the body only for a PENDING link; `record` then re-checks everything under the row lock above. Of two racing answers, the same answer gets 303 and another gets 409, and the loser's page is drawn from the link as it now is. The case's dedupe is Order + orderId + CUSTOMER_PROBLEM.

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
  - `bodyRedacted` has the token replaced by `[link]`. As built it keeps the link's host and replaces only the token: `…Tap https://smartfleetpk.com/c/[link] Help: 03211234567`;
  - an SMS row's `provider` is the live provider's name even when test mode skips it, and `sent_at` is set only on `SENT`.
- **Later**, not in Inc 2: an `EoceanMessagingProvider` that sends the text in the POST body, not the query string (eocean-sms.provider.ts:28-41), plus delivery reports by webhook (no messaging webhook is registered in the pilot: `POST /webhooks/messaging/:provider` answers 404 until a provider that sends reports arrives, behind its own signature check) and a WhatsApp provider after Meta's written OK.
- **Status words** (the office website, from `reach` and `lastMessage`; the shop card uses the §10 bodies):

  | Status | Words |
  |---|---|
  | SMS QUEUED, under 2 minutes | Sending text… |
  | SMS QUEUED, 2 minutes or more (lost) | Not sent |
  | SMS SENT | Text sent {time} |
  | SMS DELIVERED (later) | Text delivered {time} |
  | SMS SKIPPED | Not sent · text messages are off |
  | SMS FAILED | Text didn't send · {reason} |
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
As built (API_CONTRACT §9.12): `customer` describes the link's target. `phoneValid` means the link has a mobile number (`phone_e164`); `phoneDisplay` is that number in local style, or, when it is NULL, the customer's stored number as stored; a fixed number takes effect with a new link (`PATCH /clients/:id` answers `confirmationNeedsNewLink: true` while a link is pending). A PENDING link past its `expiresAt` reads EXPIRED, with `allowedActions: []`, before the job stores it. `lastMessage.byName` is also set for an SMS a user asked for with new-link `{ send: 'SMS' }`. The order answers carry the short form `confirmation: { status, response, caseOpen } | null` for the shop and the office, never for a driver.
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

**The shop app card** (`apps/mobile/src/screens/distributor/confirm/CustomerAnswer.tsx`, the `useCustomerAnswer` hook that returns the card, the footer button and the sheets, with its rules in `confirmModel.ts`; built 2026-10-25 to the rulebook design of 2026-10-23, the Inc 2/3 spec §2.5–§2.6. The design named `components/CustomerConfirmCard.tsx`.)
- Shown in the order detail (UX_MOBILE S14) when `features.confirmations` is on and the order's `confirmation` field is not null. It sits under the status block, above the facts card.
- It refetches every 20 seconds while PENDING and the screen is focused.
- It uses only core React Native APIs, so it ships over the air:
  - `Linking.openURL(whatsappUrl or smsUrl)` (the wa.me precedent is AboutScreen.tsx:33);
  - `Share.share({message})`;
  - `Clipboard.setString(message)`.

  Each action calls `share` first, with the matching `via`.
- **Card contents:** the caption "Customer answer"; the answer chip (UX_MOBILE §3.4; "Waiting for customer" is the amber clock, never "Waiting for {{name}}"), with the answer time on the right once answered; one line by state (below); a caption while PENDING, "Link open until {{time}}"; and a ghost button: "Other ways" before the link is given, "Send again" after. Both open the Send link sheet.
- **The screen footer holds the one main button**, by state: "Send on WhatsApp" while the link isn't given and the phone is valid; "Fix number" when the phone is wrong; "Make new link" after a number fix; nothing otherwise. If the order detail gives a delivered order another footer button, this button moves into the card as its primary. Either way the screen keeps one main button.

| State (`status`, `reach`) | Chip | Line | Footer | In the card |
|---|---|---|---|---|
| Loading | skeleton | skeleton | none | none |
| Error | none | "Couldn't load the customer answer." + Try again | none | none |
| PENDING, NOT_SENT (any reason: no SMS, a lost send, text messages off) | Waiting for customer | Link not sent yet · {{name}}, {{phone}} | Send on WhatsApp | Other ways |
| PENDING, SMS_FAILED | Waiting for customer | Text didn't send: {{reason}}. | Send on WhatsApp | Other ways |
| PENDING, SMS_SENDING | Waiting for customer | Sending text… | none | Send again |
| PENDING, SMS_SENT | Waiting for customer | Text sent {{time}} · {{phone}} | none | Send again |
| PENDING, SHARED | Waiting for customer | Shared {{time}} · {{via}}. Check it was sent. | none | Send again |
| PENDING, phone not valid | Waiting for customer | a warning line "Number looks wrong: {{phone}}" | Fix number (→ Edit customer, UX_MOBILE S15b) | Other ways (Other app and Copy message only) |
| PENDING, number just fixed | Waiting for customer | Number changed. Make a new link. | Make new link (→ the confirm below) | none |
| ANSWERED | the answer chip + time: YES success, PARTLY warning, NO danger, OTHER warning (settled point G07-23, kept by the lead) | the comment in quotes; then "The office will look into it." while `caseOpen` | none | none |
| EXPIRED | No answer | none | none | none |
| CANCELLED (reserved) | grey "Not needed" | none | none | none |

- **The Send link sheet** (a PickerSheet with no search, as an action list): the title "Send link"; 56 dp rows, each an icon and a label: WhatsApp · Text message · Other app · Copy message; a divider, then "Make a new link" (only when `allowedActions` has `NEW_LINK`). As built the icons are the kit's `whatsApp`, `sms` (message-text-outline), `share`, `copy` and `link` (link-variant), and WhatsApp is listed first. A tap calls `share` with the matching `via`; the row shows a spinner until it answers, then the sheet closes and the app opens. WhatsApp and Text message are hidden when their URL is null (the phone isn't valid).
- **Make a new link** (rule 7): the sheet closes first (never a sheet on a sheet), then a ConfirmSheet "Make a new link?" / "The old link stops working." / [Make new link] (primary) / [Keep old link] (secondary). Afterwards the toast "New link made", and the card reads "Link not sent yet" until the new link is sent or shared.
- **Errors:** network: the footer line "Couldn't get the link. Try again." under the one "No connection · Try again" banner; `CONFIRM_CLOSED`: refetch the card and toast `errors.CONFIRM_CLOSED`; `RATE_LIMITED`: `errors.RATE_LIMITED` on the footer line.
- **The card has no money line.** The order's delivery cost line stays as it was when the order was placed.
- **Copy keys** (mobile namespace `confirm`):

  | Key | Text |
  |---|---|
  | `confirm.title` | Customer answer |
  | `confirm.notSent` | Link not sent yet · {{name}}, {{phone}} |
  | `confirm.smsFailed` | Text didn't send: {{reason}}. |
  | `confirm.smsFailReason.INVALID_NUMBER` / `.REJECTED` / `.TIMEOUT` / `.AUTH` / `.UNAVAILABLE` / `.UNKNOWN` | the §8 FAILED reasons: the number looks wrong / the SMS company refused it / the SMS company did not answer / SMS account problem / the SMS company is down / something went wrong |
  | `confirm.smsSending` | Sending text… |
  | `confirm.smsSent` | Text sent {{time}} · {{phone}} |
  | `confirm.shared` | Shared {{time}} · {{via}}. Check it was sent. |
  | `confirm.via.WHATSAPP` / `.SMS` / `.SHARE_SHEET` / `.COPY` | WhatsApp / text message / other app / copied |
  | `confirm.until` | Link open until {{time}} |
  | `stages.answer.*` | the chip words (UX_MOBILE §3.4): Customer: all received · Customer: partly received · Customer: not received · Customer sent a note · Waiting for customer · No answer |
  | `confirm.cancelled` | Not needed |
  | `confirm.officeWillCheck` | The office will look into it. |
  | `confirm.badPhone` | Number looks wrong: {{phone}} |
  | `confirm.numberChanged` | Number changed. Make a new link. |
  | `confirm.btn.whatsapp` / `.otherWays` / `.sendAgain` / `.fixNumber` / `.makeNewLink` | Send on WhatsApp / Other ways / Send again / Fix number / Make new link |
  | `confirm.sheet.title` / `.whatsapp` | Send link / WhatsApp |
  | `confirm.btn.sms` / `.share` / `.copy` / `.newLink` | Text message / Other app / Copy message / Make a new link |
  | `confirm.newLink.title` / `.body` / `.confirm` / `.keep` | Make a new link? / The old link stops working. / Make new link / Keep old link |
  | `confirm.toast.copied` / `.newLink` | Message copied / New link made |
  | `confirm.loadError` | Couldn't load the customer answer. |
  | `confirm.linkError` | Couldn't get the link. Try again. |

  Removed: `confirm.ask.title`, `confirm.ask.smsOff`, `confirm.ask.notSent`, `confirm.waiting` and `confirm.noReply` (the chip says them).

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
- **Retention:** `outbound_messages` are kept for 12 months. No IP address or user agent is stored for answers. (As built, no retention job deletes older rows yet; it belongs to the housekeeping job, before the pilot's first year ends.)

## 13. Tests (added to the Inc 2 suite)
**Unit**
- Token: derivation is stable for the same `(id, version)`; normalising `I`, `L`, `O` and upper case; 26-character format checks; no collisions in 100,000.
- `renderSms`: at most 160 characters across the worst-case matrix, GSM-7 only, the fallbacks work, nothing straight after the link.
- HTML: escaping; a snapshot per state; the token appears only in `href` and `action`; no `<script>`, no image file and no `xmlns` (the icons are inline SVG); every page under 12 KB; no page contains a cylinder number (pattern `[A-Z][A-Z0-9]{1,5}-C[0-9]{4,}`).

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
2. The shop card shows "Waiting for customer" and "Link not sent yet".
3. Share the link.
4. Open the page: at most 12 KB, no extra requests.
5. Tap All received.
6. The card shows "Customer: all received" and the wallet is unchanged.

## 14. Build order and effort
1. Migration (DATA_MODEL §4).
2. Messaging module (interface, mock, test mode, log).
3. ConfirmationsService (issue, view, share, new link, record, expiry job).
4. Public page (controller, renderer, filter, headers, limits, prefix exclude, trust proxy, Caddy and Sentry redaction).
5. Shop app card.
6. Office drawer and problems page.
7. Settings.

Effort is about **6–8 person-days** (backend 4–5, mobile 1–1.5, web 1–1.5).

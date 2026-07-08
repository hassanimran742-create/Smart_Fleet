"""
Smart_Fleet pilot — generate the comprehensive Excel test plan workbook.

Covers EVERY module surfaced by the codebase audit:
  API modules: 40
  Admin screens: 22
  Distributor mobile screens: 13
  Driver mobile screens: 13
  Client mobile screens: 2

Sheets:
  1. README
  2. Test Groups          (one group ≈ one sitting, independent)
  3. Atomic Cases         (~250 atomic outcomes)
  4. Field Scenarios      (real-world only)
  5. Build Backlog        (batch native changes → ONE rebuild)
  6. Defect Log
  7. Sign-off

Run from repo root:
    python3 scripts/generate_test_plan.py
"""

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter


# ---------------------------------------------------------------------------
# Styling helpers
# ---------------------------------------------------------------------------

HEADER_FILL = PatternFill("solid", fgColor="0F6CF0")
HEADER_FONT = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
HEADER_ALIGN = Alignment(horizontal="left", vertical="center", wrap_text=True)
CELL_ALIGN = Alignment(vertical="top", wrap_text=True)
THIN = Side(border_style="thin", color="D7DDE6")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

ZEBRA = PatternFill("solid", fgColor="F6F8FB")
GROUP_HEADER_FILL = PatternFill("solid", fgColor="EAF1FE")
GROUP_HEADER_FONT = Font(bold=True, color="0F4DAF")

PRIORITY_FILLS = {
    "P0": PatternFill("solid", fgColor="FFE0E0"),
    "P1": PatternFill("solid", fgColor="FFF3CD"),
    "P2": PatternFill("solid", fgColor="E5EFFF"),
}


def style_header(ws, row_idx, n_cols):
    for c in range(1, n_cols + 1):
        cell = ws.cell(row=row_idx, column=c)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = HEADER_ALIGN
        cell.border = BORDER
    ws.row_dimensions[row_idx].height = 32


def set_widths(ws, widths):
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


# ---------------------------------------------------------------------------
# README
# ---------------------------------------------------------------------------

def build_readme(wb):
    ws = wb.create_sheet("README")
    set_widths(ws, [4, 110])
    ws["A1"] = "Smart_Fleet — Comprehensive Pilot Test Plan"
    ws["A1"].font = Font(name="Calibri", size=18, bold=True, color="0F6CF0")
    ws.merge_cells("A1:B1")

    sections = [
        ("Purpose", [
            "Atomic test cases covering every module of the deployed pilot (smartfleetpk.com).",
            "Every row = one observable PASS/FAIL outcome. No ambiguity.",
            "Designed for the FEWEST APK rebuilds: group findings in 'Build Backlog', do ONE rebuild covering them all.",
        ]),
        ("Coverage", [
            "  • 40 API modules (auth, orders, custody, dispatch, ledger, transfers, alerts, audit, etc.)",
            "  • 22 admin web screens",
            "  • 13 distributor mobile screens",
            "  • 13 driver mobile screens",
            "  • 2 client mobile screens + the customer-portal flow",
            "  • Cross-cutting: security, network, files/S3, push, housekeeping, soak, OTA",
        ]),
        ("How to use", [
            "1. Open 'Test Groups' — each group is ONE sitting (15–45 min) and INDEPENDENT of all others.",
            "2. Run any group based on what you can test right now (desk, yard, motorbike, real shop).",
            "3. For each Atomic Case in that group, mark Result + Actual + Defect ID (if any).",
            "4. If a finding requires code: put it in 'Build Backlog' — DO NOT rebuild immediately.",
            "5. After a test cycle, do ONE rebuild covering every native change in the backlog.",
            "6. Run field groups (FD-1..FD-3) LAST: motorbike + sun + real shop is the most expensive setup.",
        ]),
        ("Reading OTPs in pilot (mock SMS)", [
            "On EC2: sudo docker logs smartfleet-api-prod --since 2m | grep -A4 'OTP-MOCK'",
            "Code is in the 'msg:' line. Codes valid 5 minutes. Only the newest one works.",
        ]),
        ("Test accounts (REPLACE BEFORE GO-LIVE)", [
            "Super admin   (web, password): +923000000000 / ChangeMe!Now123",
            "Branch admin  (web, password): +923000000001 / ChangeMe!Now123",
            "Distributor   (mobile, OTP):  +923001111111",
            "Driver        (mobile, OTP):  +923002222222",
            "Walk-in client phone:         +923009999999",
        ]),
        ("Legend — severity", [
            "P0 (red)   — blocks pilot launch. Must pass.",
            "P1 (amber) — should pass; workaround acceptable ≤1 week.",
            "P2 (blue)  — nice-to-have; track only.",
        ]),
        ("Legend — outcome", [
            "PASS    — actual matches expected.",
            "FAIL    — differs; write what you saw under 'Actual'.",
            "BLOCKED — cannot run (waiting on a dependency).",
            "N/A     — not applicable to this build / environment.",
        ]),
    ]
    row = 3
    for title, lines in sections:
        ws.cell(row=row, column=1, value="◼").font = Font(color="0F6CF0", bold=True)
        ws.cell(row=row, column=2, value=title).font = Font(bold=True, size=13)
        row += 1
        for line in lines:
            ws.cell(row=row, column=2, value=line).alignment = Alignment(wrap_text=True)
            row += 1
        row += 1


# ---------------------------------------------------------------------------
# Groups — 30 sittings, each independent
# ---------------------------------------------------------------------------

GROUPS = [
    # ----- AUTH (cross-surface) -----
    ("A",  "Cold-Start + Auth (admin + mobile)", "20 min", "Desk",
        "Distributor APK installed; admin web reachable.",
        "Login flows, OTP, password, persistence, idle/explicit logout, role isolation.",
        "No", "—"),

    # ----- DISTRIBUTOR APP (13 screens spread over 6 groups) -----
    ("DA-1", "Distributor — Home + Quick Actions", "15 min", "Desk",
        "Logged in as distributor.",
        "Home KPIs, balance, recent orders, quick-action navigation, pull-to-refresh.",
        "No", "A"),
    ("DA-2", "Distributor — Client Management", "20 min", "Desk",
        "Distributor logged in.",
        "Add client form, validation, address search, duplicate prevention, persistence, list search.",
        "No", "A"),
    ("DA-3", "Distributor — Place Order (matrix)", "30 min", "Desk",
        "Group DA-2 done (≥1 client); cylinder types seeded.",
        "Cart math, single/multi-type orders, empty returns, addresses, submit + rejection paths.",
        "No", "DA-2"),
    ("DA-4", "Distributor — Order History + Tracking", "20 min", "Desk",
        "≥5 orders from DA-3.",
        "History pagination/filter, order detail, Track screen, real-time status updates.",
        "No", "DA-3"),
    ("DA-5", "Distributor — Ledger + Top-up + Payments", "25 min", "Desk",
        "DA-3 done; pricing rules configured (W-Y).",
        "Ledger entries, balance arithmetic, top-up via 3 providers, payment status, reconciliation.",
        "No", "DA-3, Y"),
    ("DA-6", "Distributor — Inventory + Request Filling", "25 min", "Desk",
        "Cylinder types + filling stations seeded.",
        "Inventory counts, request-filling flow, pick station vs own, cart, submit, status updates.",
        "No", "T"),
    ("DA-7", "Distributor — Analytics + Notifications + Profile + About", "15 min", "Desk",
        "DA-3 done.",
        "Analytics charts, notifications read/unread, profile edit, About version info.",
        "No", "DA-3"),

    # ----- DRIVER APP (13 screens spread over 8 groups) -----
    ("DR-1", "Driver — Home + Vehicle Info + Trip Reception", "15 min", "Desk",
        "Driver APK installed; driver assigned to vehicle (X-4).",
        "Home suggestions, trip list, vehicle plate/capacity, available-trip preview.",
        "Driver APK only", "X, S-9"),
    ("DR-2", "Driver — Active Trip + Navigation", "20 min", "Desk first / yard",
        "Trip ASSIGNED to driver.",
        "Stops list, status transitions PLANNED→IN_PROGRESS→COMPLETED, deep-link to Google Maps.",
        "No", "DR-1"),
    ("DR-3", "Driver — Scan + Custody Chain (5 event types)", "30 min", "Yard",
        "Printed test QR stickers (admin Z); cylinders in store inventory.",
        "All 5 custody events: SCAN_OUT, DELIVERED, PICKED_UP_EMPTY, RETURNED_TO_DISTRIBUTOR, TRANSFER. Order matters.",
        "No", "Z"),
    ("DR-4", "Driver — Delivery Steps Flow", "20 min", "Yard",
        "Trip + stops + cylinders ready.",
        "One-step-at-a-time UI, arrive, deliver, capture proof photo, depart to next stop.",
        "No", "DR-3"),
    ("DR-5", "Driver — Fuel Refill", "10 min", "Desk",
        "Driver assigned to vehicle with odometer set.",
        "Record litres, cost, current odometer; previous-odometer validation; appears in admin Fuel Report.",
        "No", "X"),
    ("DR-6", "Driver — Filling Orders (pickup at station)", "15 min", "Desk",
        "Filling order assigned to driver (T-4).",
        "Pickup confirmation, custody chain to vehicle, quantity reconciliation.",
        "No", "T"),
    ("DR-7", "Driver — Transfers (intra-distributor moves)", "20 min", "Yard",
        "Transfer assigned (U-5).",
        "Transfer list/detail, scan-out at source, IN_TRANSIT, scan-in at destination, missing-cylinder flag.",
        "No", "U"),
    ("DR-8", "Driver — Reconciliation + Notifications + Profile", "15 min", "Desk",
        "Trip COMPLETED; some cash collected.",
        "End-of-day cash submit, admin verification, notification stream, profile edit, logout.",
        "No", "DR-4"),

    # ----- CLIENT-PORTAL -----
    ("CL", "Client — Portal & Confirmations", "15 min", "Desk",
        "Order DELIVERED but unconfirmed by client; client phone has the link.",
        "Client portal home, delivery detail, confirm-delivery, confirm-empties.",
        "No", "DR-4"),

    # ----- ADMIN OPS -----
    ("R",  "Admin — Dashboard + Live Deliveries", "25 min", "Desk",
        "Seed run; some orders + ≥1 driver.",
        "5 KPI tiles, recent-orders table, driver roster, Live map socket, driver markers.",
        "No", "DR-1"),
    ("S",  "Admin — Orders Management (current/previous/delivery)", "30 min", "Desk",
        "Orders in various statuses from DA-3.",
        "All status filters, assign/reassign, lifecycle PENDING→DELIVERED, illegal jumps rejected, cancel.",
        "No", "DA-3"),
    ("T",  "Admin — Filling Stations + Filling Orders", "20 min", "Desk",
        "Cylinder types + ≥1 distributor.",
        "Create stations, set price/cylinder, create filling order, assign driver, full status flow.",
        "No", "X"),
    ("U",  "Admin — Transfers + Returns", "20 min", "Desk",
        "Stores + driver + stock available.",
        "Create transfer, source-stock validation, assign driver, status flow, returns list.",
        "No", "W"),
    ("V",  "Admin — Alerts (configure + trigger + resolve)", "30 min", "Desk",
        "Distributor with balance; ≥1 client.",
        "Configure 3 alert rule types, trigger each, acknowledge/resolve, severity filter.",
        "No", "Y"),

    # ----- ADMIN MASTER DATA -----
    ("W",  "Admin — Geography (Cities, Zones, Stores)", "30 min", "Desk",
        "Seed cities present.",
        "Add city, add zone with polygon, edit polygon, soft delete; stores under zones.",
        "No", "—"),
    ("X",  "Admin — Fleet (Vehicles, Drivers, Cylinder Types, Accessories)", "25 min", "Desk",
        "Cities + zones.",
        "Vehicle CRUD, driver CRUD, assign driver↔vehicle, set availability, cylinder-type edit, accessories CRUD.",
        "No", "W"),
    ("Y",  "Admin — Distributors + Pricing Rules", "20 min", "Desk",
        "Cities/zones + cylinder types.",
        "Distributor CRUD, suspend (blocks mobile login), pricing rules (zone×zone×type → price), edit rules.",
        "No", "W"),
    ("Z",  "Admin — QR Generator (bulk cylinder tagging)", "20 min", "Desk + printer",
        "Distributors + cylinder types + stores.",
        "Pick distributor/type/store/qty, queue batches, generate (POST /cylinders), preview, print, CSV export.",
        "No", "X"),

    # ----- ADMIN INSIGHTS -----
    ("AA", "Admin — Reports (5 reports)", "30 min", "Desk",
        "Several days of orders + drivers + dispatch.",
        "Driver utilization, driver attendance + range filter, dispatch decisions, delivery funnel, inventory-by-store.",
        "No", "S, DR-2"),
    ("AB", "Admin — Expenses + Fuel Report", "15 min", "Desk",
        "DR-5 + driver assignments.",
        "Record expense, filter by category, fuel report with vehicle/driver/date filters, summary stats.",
        "No", "DR-5"),
    ("AC", "Admin — Inventory by Store + Cylinder Custody Trace", "15 min", "Desk",
        "Custody events from DR-3.",
        "Inventory totals per store match custody log; trace a single cylinder QR through its full history.",
        "No", "DR-3"),

    # ----- CROSS-CUTTING -----
    ("FI", "Files + S3 (proof photos, profile pics)", "20 min", "Desk",
        "S3 IAM user from Phase F.",
        "Upload reaches S3, pre-signed read works, direct URL blocked, lifecycle rule active.",
        "No", "DR-4"),
    ("PN", "Push Notifications + In-app Alerts", "20 min", "Desk + 2 phones",
        "Distributor + driver phones with push permissions granted.",
        "Order assigned/delivered/cancelled push, in-app notification, deep-link to right screen.",
        "Native (FCM) on first run", "DR-1, DR-4"),
    ("AU", "API & Backend (audit, support, push tokens, feature flags)", "20 min", "Desk + browser dev tools",
        "Admin token + browser dev tools.",
        "Audit log entries on key actions; support ticket CRUD; push-token register/revoke; feature flag toggle reflects.",
        "No", "S, AA"),
    ("NR", "Network Resilience", "20 min", "Desk + airplane-mode phone",
        "Distributor app + phone with airplane-mode shortcut.",
        "Full offline action, slow 3G, server 5xx, expired token, container restart.",
        "Defensive JS → backlog", "DA-2"),
    ("SE", "Security & Permissions", "30 min", "Desk + browser dev tools",
        "Two distributors with separate data; admin login.",
        "Cross-distributor isolation, role-restricted endpoints, JWT tamper rejection, S3 not listable, OTP not leaked in prod, PII encrypted at rest, suspended user blocked.",
        "No", "DA-3, Y"),
    ("DI", "Data Integrity + Housekeeping", "15 min", "Desk + EC2 SSH",
        "Production DB running ≥1 day.",
        "Old OTP purge, session purge, audit-log retention, photo archival to Glacier (>60d), snapshot existence.",
        "No", "L (soak)"),

    # ----- FIELD -----
    ("FD-1", "FIELD — Driver Day-in-Life", "≥1 work day", "Real route on motorbike",
        "Final driver APK; real distributor; consenting customer; real cylinder + sticker.",
        "Sun glare, dust, gloves, helmet noise, GPS accuracy in dense urban, battery drain, photo at dusk, signal dead-zones.",
        "Findings → backlog → ONE rebuild end of day", "DR-3..DR-8"),
    ("FD-2", "FIELD — Distributor Day-in-Life", "≥1 work day", "Real shop",
        "Final distributor APK; cheap Android (Rs.20–30k); real customer phones with consent.",
        "Phone-input ergonomics, OTP delivery perception, time-pressured order entry, WiFi↔SIM handoff, back-button confusion.",
        "Findings → backlog", "DA-3..DA-7"),
    ("FD-3", "FIELD — Client Receiving Delivery", "1 delivery", "Real customer home",
        "Real customer with phone; real driver delivers.",
        "Customer can confirm delivery (portal or via driver), proof photo legible, no-app fallback path works.",
        "Findings → backlog", "CL, DR-4"),
    ("L",  "Multi-Day Soak + OTA Update", "3–5 days elapsed", "Desk + field",
        "All apps installed and used; schedule one OTA in the middle.",
        "Token rollover, day boundaries, OTA delivery, log/alarm health, daily cost ≈ $0.",
        "Test OTA without rebuild", "DR-8, FD-1"),
]


# ---------------------------------------------------------------------------
# Atomic Cases — full coverage matrix
# ---------------------------------------------------------------------------

def c(tc_id, group, prio, area, surface, name, pre, steps, expected, tested_on, ttype):
    return (tc_id, group, prio, area, surface, name, pre, steps, expected, tested_on, ttype)


CASES = []

# ===== GROUP A — Cold-Start + Auth =====
CASES += [
    c("A01","A","P0","Auth","Admin web","Admin web loads without console errors",
      "Browser cache cleared; production URL up.",
      "Open https://admin.smartfleetpk.com; open DevTools → Console.",
      "Login screen renders; no red console errors; latest bundle filename.",
      "Admin web","Positive"),
    c("A02","A","P0","Auth","Admin web","Super-admin password login",
      "Seed run.",
      "Enter +923000000000 + correct password; Sign in.",
      "Lands in Dashboard within 3s.","Admin web","Positive"),
    c("A03","A","P0","Auth","Admin web","Wrong password rejected uniformly",
      "—",
      "Try (a) wrong password (b) unknown phone (c) blank password.",
      "Same generic 'Invalid phone or password' for all 3; no enumeration leak.","Admin web","Negative"),
    c("A04","A","P1","Auth","Admin web","Distributor phone rejected on password endpoint",
      "+923001111111 = DISTRIBUTOR.",
      "Try password login with +923001111111.",
      "Server: 'must sign in with a one-time code'.","Admin web","Negative"),
    c("A05","A","P1","Auth","Admin web","Token persists across reload",
      "Logged in.",
      "Ctrl+R.",
      "Still on dashboard.","Admin web","Positive"),
    c("A06","A","P1","Auth","Admin web","Explicit logout clears session",
      "Logged in.",
      "Logout from sidebar.",
      "Login screen; reload doesn't auto-login.","Admin web","Positive"),
    c("A07","A","P2","Auth","Admin web","Idle logout after configured timeout",
      "Logged in; idle = 10 min.",
      "Leave tab idle >10 min.",
      "Auto-logout.","Admin web","Edge"),
    c("A08","A","P0","Auth","Distributor app","OTP send returns success",
      "Distributor user exists ACTIVE.",
      "Enter +923001111111; tap Send OTP.",
      "App shows 'sent' state; logs contain OTP-MOCK block.","Distributor app","Positive"),
    c("A09","A","P0","Auth","Distributor app","OTP verify with fresh code logs in",
      "A08 done <5 min ago.",
      "Read code from logs; enter; submit.",
      "Lands on distributor home.","Distributor app","Positive"),
    c("A10","A","P1","Auth","Distributor app","Stale OTP rejected",
      "Wait >5 min OR send a new one then use old.",
      "Submit old code.",
      "'OTP expired or not found' or 'Invalid code'.","Distributor app","Negative"),
    c("A11","A","P1","Auth","Distributor app","Rate limit blocks >3 sends/60s",
      "Fresh phone.",
      "Tap Send OTP 4× within 30s.",
      "4th rejected: 'Too many OTP requests'.","Distributor app","Negative"),
    c("A12","A","P1","Auth","Distributor app","Token survives cold-start",
      "Logged in.",
      "Force-stop app; reopen.",
      "Home shown without re-login.","Distributor app","Positive"),
    c("A13","A","P1","Auth","Driver app","Driver OTP login",
      "+923002222222 = DRIVER w/ profile.",
      "Repeat A08–A09 with driver phone on driver APK.",
      "Lands on driver home.","Driver app","Positive"),
    c("A14","A","P1","Auth","Mobile","Suspended user cannot OTP-login",
      "Admin suspends +923001111111.",
      "Try OTP login.",
      "Login rejected; not active.","Mobile","Negative"),
]

# ===== GROUP DA-1 — Distributor Home + Quick Actions =====
CASES += [
    c("DA1-01","DA-1","P0","Home","Distributor app","Home screen renders",
      "Logged in.","Open app.",
      "Balance card, recent orders, quick action buttons visible; no crash.","Distributor app","Positive"),
    c("DA1-02","DA-1","P1","Home","Distributor app","Balance shows in PKR rupees not paisa",
      "Distributor with balance.","Inspect balance value.",
      "Displayed as Rs. X with decimals (not raw paisa integer).","Distributor app","Positive"),
    c("DA1-03","DA-1","P1","Home","Distributor app","Recent orders shows latest ≤5",
      "≥6 orders exist.","Open home.",
      "Top 5 newest orders visible; tap navigates to detail.","Distributor app","Positive"),
    c("DA1-04","DA-1","P0","Home","Distributor app","Quick action: Place Order navigates",
      "—","Tap Place Order.","New Order screen opens.","Distributor app","Positive"),
    c("DA1-05","DA-1","P0","Home","Distributor app","Quick action: Order History navigates",
      "—","Tap Order History.","History screen opens.","Distributor app","Positive"),
    c("DA1-06","DA-1","P0","Home","Distributor app","Quick action: Topup navigates",
      "—","Tap Topup.","Topup screen opens.","Distributor app","Positive"),
    c("DA1-07","DA-1","P0","Home","Distributor app","Quick action: Request Filling navigates",
      "—","Tap Request Filling.","Filling screen opens.","Distributor app","Positive"),
    c("DA1-08","DA-1","P1","Home","Distributor app","Pull-to-refresh updates state",
      "Admin changes status of an order.","Pull down on home.",
      "Balance & orders refetch; new state visible.","Distributor app","Positive"),
]

# ===== GROUP DA-2 — Client Management =====
CASES += [
    c("DA2-01","DA-2","P0","Clients","Distributor app","Add Client opens without map crash",
      "Logged in.","Tap Add Client.",
      "Form renders; MapStub card visible; no exit.","Distributor app","Positive"),
    c("DA2-02","DA-2","P0","Clients","Distributor app","Save valid client",
      "Add Client open.",
      "Name='Asma N', Phone='+923211234567', Area='G-13', City='Islamabad', pick address suggestion; Save.",
      "Success; appears in client list.","Distributor app","Positive"),
    c("DA2-03","DA-2","P1","Clients","Distributor app","Reject non-E.164 phone",
      "Form open.","Type '03001234567'; Save.",
      "Inline error; not saved.","Distributor app","Negative"),
    c("DA2-04","DA-2","P1","Clients","Distributor app","Address search returns Pakistani results",
      "Form open.","Type 'F-7 Markaz Islamabad'.",
      "Suggestions <3s; pick top → lat/lng visible.","Distributor app","Positive"),
    c("DA2-05","DA-2","P2","Clients","Distributor app","Search 'abc' returns empty gracefully",
      "—","Search 'abc'.",
      "Empty list / no-results msg; no crash/spinner.","Distributor app","Edge"),
    c("DA2-06","DA-2","P1","Clients","Distributor app","Duplicate phone prevented",
      "Client from DA2-02 saved.","Add another with same phone.",
      "Server rejects; UI shows clear error.","Distributor app","Negative"),
    c("DA2-07","DA-2","P1","Clients","Distributor app","Saved client persists across app restart",
      "DA2-02 done.","Force-stop; reopen; client list.",
      "Client still listed.","Distributor app","Positive"),
    c("DA2-08","DA-2","P2","Clients","Distributor app","Search by partial name and phone",
      "≥3 clients.","Type partial.",
      "Filtered list matches; clear restores.","Distributor app","Positive"),
    c("DA2-09","DA-2","P1","Clients","Admin web","Client visible under its distributor",
      "DA2-02 done.","Admin → Distributors → open distributor.",
      "Client listed there.","Admin web","Positive"),
]

# ===== GROUP DA-3 — Place Order =====
CASES += [
    c("DA3-01","DA-3","P0","Orders","Distributor app","New Order screen opens",
      "≥1 client + 4 cylinder types.","Tap New Order.",
      "'Who' step shows; client search focused; no crash.","Distributor app","Positive"),
    c("DA3-02","DA-3","P0","Orders","Distributor app","Single-type order submits",
      "DA3-01.","Pick client; LPG 11.8kg qty=1 empties=0; Submit.",
      "Success; new order id; appears as PENDING.","Distributor app","Positive"),
    c("DA3-03","DA-3","P0","Orders","Distributor app","Multi-type order with empties",
      "—","LPG 11.8 ×2, LPG 6 ×1; empties returned=1 of 11.8; Submit.",
      "One order; 2 lines; correct counts in detail.","Distributor app","Positive"),
    c("DA3-04","DA-3","P1","Orders","Distributor app","Cart +/-/remove consistent",
      "Cart non-empty.","Use +/- and remove; re-add.",
      "Totals consistent with submitted payload; no negatives.","Distributor app","Edge"),
    c("DA3-05","DA-3","P0","Orders","Distributor app","Empty cart cannot submit",
      "Cart empty.","Try Submit.",
      "Blocked; clear message.","Distributor app","Negative"),
    c("DA3-06","DA-3","P1","Orders","Distributor app","No client cannot submit",
      "Cart has items, no client.","Try Submit.",
      "Blocked; client step highlighted.","Distributor app","Negative"),
    c("DA3-07","DA-3","P1","Orders","Distributor app","Override address from client default",
      "Client has default address.","Pick different address for this order; Submit.",
      "Order shows the picked address in admin detail.","Distributor app","Positive"),
    c("DA3-08","DA-3","P1","Orders","Distributor app","Back nav preserves cart",
      "Cart with 2 lines.","Back to 'who'; pick another client; forward.",
      "Cart still has lines.","Distributor app","Edge"),
    c("DA3-09","DA-3","P2","Orders","Distributor app","Submit while offline",
      "Cart ready.","Airplane mode; Submit.",
      "Friendly error; no half-created order; retry on reconnect succeeds.","Distributor app","Edge"),
    c("DA3-10","DA-3","P0","Orders","Admin web","Order appears in admin within 30s",
      "DA3-02 just submitted.","Refresh Admin → Orders → Current.",
      "Order id present; distributor + client match.","Admin web","Positive"),
    c("DA3-11","DA-3","P1","Orders","Admin web","Order detail shows correct lines",
      "Multi-line order from DA3-03.","Open detail.",
      "All 2 lines + quantities match.","Admin web","Positive"),
]

# ===== GROUP DA-4 — Order History + Tracking =====
CASES += [
    c("DA4-01","DA-4","P0","History","Distributor app","Order History lists newest first",
      "≥5 orders today.","Open Order History.",
      "Sorted newest→oldest; correct status pills.","Distributor app","Positive"),
    c("DA4-02","DA-4","P1","History","Distributor app","Pagination on >20 orders",
      "≥25 orders.","Scroll to bottom.",
      "Load more triggers; no duplicates.","Distributor app","Positive"),
    c("DA4-03","DA-4","P1","History","Distributor app","Filter by status",
      "Mix of statuses.","Apply DELIVERED filter.",
      "Only DELIVERED orders visible.","Distributor app","Positive"),
    c("DA4-04","DA-4","P2","History","Distributor app","Filter by date range",
      "Orders from 2+ days.","Set date range.",
      "Only orders in range visible.","Distributor app","Positive"),
    c("DA4-05","DA-4","P1","History","Distributor app","Order detail accessible from list",
      "—","Tap an order.",
      "Detail screen opens with all fields populated.","Distributor app","Positive"),
    c("DA4-06","DA-4","P0","Track","Distributor app","Track Order opens without map crash",
      "Active order.","Open Track.",
      "Screen renders; MapStub visible; no exit.","Distributor app","Positive"),
    c("DA4-07","DA-4","P1","Track","Distributor app","Status timeline shown",
      "Order has multiple events.","Open Track.",
      "Each status with timestamp listed.","Distributor app","Positive"),
    c("DA4-08","DA-4","P1","Track","Distributor app","Live status update via socket",
      "Track open; admin changes order status.","Wait <30s.",
      "Status updates without manual refresh.","Distributor app","Positive"),
]

# ===== GROUP DA-5 — Ledger + Top-up + Payments =====
CASES += [
    c("DA5-01","DA-5","P0","Ledger","Distributor app","Ledger lists entries",
      "Pricing rules + orders exist.","Open Ledger.",
      "Entries listed; CREDIT_TOPUP, DEBIT_ORDER visible.","Distributor app","Positive"),
    c("DA5-02","DA-5","P1","Ledger","Distributor app","Entry types filterable",
      "Mix of CREDIT/DEBIT entries.","Filter by type.",
      "List filtered correctly.","Distributor app","Positive"),
    c("DA5-03","DA-5","P0","Ledger","Distributor app","Balance equals sum of entries",
      "—","Sum all entries.",
      "Equals displayed balance.","Distributor app","Positive"),
    c("DA5-04","DA-5","P0","Topup","Distributor app","Topup screen opens",
      "—","Tap Topup.",
      "Amount input + provider toggle visible.","Distributor app","Positive"),
    c("DA5-05","DA-5","P0","Topup","Distributor app","Topup with JazzCash provider",
      "Topup open.","Amount=2000; JazzCash; Submit.",
      "Pending payment; appears in My Payments.","Distributor app","Positive"),
    c("DA5-06","DA-5","P1","Topup","Distributor app","Topup with EasyPaisa",
      "—","Amount=1500; EasyPaisa; Submit.",
      "Same pending state created.","Distributor app","Positive"),
    c("DA5-07","DA-5","P1","Topup","Distributor app","Topup with Bank Manual",
      "—","Amount=5000; Bank; Submit.",
      "Created; admin must verify.","Distributor app","Positive"),
    c("DA5-08","DA-5","P1","Topup","Distributor app","Minimum amount enforced",
      "—","Amount=10; Submit.",
      "Blocked with min-amount error.","Distributor app","Negative"),
    c("DA5-09","DA-5","P0","Payments","Admin web","Admin verifies payment",
      "DA5-05 pending.","Admin → reconciliation/payments; verify.",
      "Payment SUCCESS; ledger CREDIT_TOPUP entry; balance increases.","Admin web","Positive"),
    c("DA5-10","DA-5","P1","Payments","Distributor app","Failed payment shown",
      "Admin marks payment FAILED.","Open My Payments.",
      "Status FAILED visible; no balance change.","Distributor app","Negative"),
]

# ===== GROUP DA-6 — Inventory + Request Filling =====
CASES += [
    c("DA6-01","DA-6","P1","Inventory","Distributor app","Inventory shows per-type counts",
      "Custody events seeded.","Open Inventory.",
      "Full + empty counts per cylinder type.","Distributor app","Positive"),
    c("DA6-02","DA-6","P1","Inventory","Distributor app","Inventory matches admin view",
      "Same distributor.","Compare app vs admin Inventory.",
      "Numbers match exactly.","Distributor app + Admin","Positive"),
    c("DA6-03","DA-6","P0","Filling","Distributor app","Request Filling opens",
      "Filling stations seeded.","Tap Request Filling.",
      "Choose station / own station option visible.","Distributor app","Positive"),
    c("DA6-04","DA-6","P0","Filling","Distributor app","Filling order via partner station",
      "—","Pick station; add cylinders; Submit.",
      "Order created PENDING; appears in My Filling Orders.","Distributor app","Positive"),
    c("DA6-05","DA-6","P1","Filling","Distributor app","Filling order via own station",
      "—","Pick 'own station'; fill name/address; Submit.",
      "Order created without partner station_id.","Distributor app","Positive"),
    c("DA6-06","DA-6","P1","Filling","Distributor app","Price calc matches station rate",
      "Station price set.","Add cylinders; observe total.",
      "Total = qty × price.","Distributor app","Positive"),
    c("DA6-07","DA-6","P1","Filling","Distributor app","Status updates as order moves",
      "Admin assigns driver; driver picks up.","Refresh My Filling Orders.",
      "Status transitions PENDING→IN_PROGRESS→COMPLETED.","Distributor app","Positive"),
]

# ===== GROUP DA-7 — Analytics + Notifications + Profile + About =====
CASES += [
    c("DA7-01","DA-7","P1","Analytics","Distributor app","Analytics screen loads",
      "Orders exist.","Open Analytics.",
      "Charts render or 'no data' state.","Distributor app","Positive"),
    c("DA7-02","DA-7","P2","Analytics","Distributor app","Date range filter applies",
      "—","Change date range.",
      "Charts update accordingly.","Distributor app","Positive"),
    c("DA7-03","DA-7","P1","Notifications","Distributor app","Notification list opens",
      "Notifications exist.","Open Notifications.",
      "List with unread badges.","Distributor app","Positive"),
    c("DA7-04","DA-7","P1","Notifications","Distributor app","Mark notification as read",
      "Unread notification.","Tap it.",
      "Badge clears; mark-read persists.","Distributor app","Positive"),
    c("DA7-05","DA-7","P1","Profile","Distributor app","Profile shows current info",
      "—","Open Profile.",
      "Name, phone, business name shown.","Distributor app","Positive"),
    c("DA7-06","DA-7","P1","Profile","Distributor app","Edit profile name",
      "—","Change name; Save.",
      "New name persists across reload.","Distributor app","Positive"),
    c("DA7-07","DA-7","P2","About","Distributor app","About screen shows version",
      "—","Open About.",
      "Version + build info visible; matches deployed.","Distributor app","Positive"),
    c("DA7-08","DA-7","P1","Profile","Distributor app","Logout from profile",
      "—","Logout.",
      "Returns to phone-input screen.","Distributor app","Positive"),
]

# ===== GROUP DR-1 — Driver Home + Vehicle + Trip Reception =====
CASES += [
    c("DR1-01","DR-1","P0","Home","Driver app","Driver home renders",
      "Logged in as driver.","Open home.",
      "Trips list, suggestions, transfers section; no crash.","Driver app","Positive"),
    c("DR1-02","DR-1","P1","Home","Driver app","Empty-trip state shown",
      "No assigned trips.","Open home.",
      "Empty-state message; no broken layout.","Driver app","Positive"),
    c("DR1-03","DR-1","P0","Home","Driver app","Sees newly-assigned trip",
      "Admin assigns trip.","Refresh.",
      "Trip appears in trips list.","Driver app","Positive"),
    c("DR1-04","DR-1","P1","Home","Driver app","Quick action: Scan",
      "—","Tap Scan.","Scan screen opens (camera permission requested if first time).","Driver app","Positive"),
    c("DR1-05","DR-1","P1","Home","Driver app","Quick action: Delivery (DELIVERED)",
      "—","Tap Delivery quick action.",
      "Scan screen with eventType=DELIVERED.","Driver app","Positive"),
    c("DR1-06","DR-1","P1","Vehicle","Driver app","Vehicle Info shows assignment",
      "Driver assigned to vehicle (X-4).","Open Vehicle Info.",
      "Plate + capacity + last odometer visible.","Driver app","Positive"),
    c("DR1-07","DR-1","P1","Vehicle","Driver app","Unassigned driver state",
      "Driver with no vehicle.","Open Vehicle Info.",
      "Clear 'not assigned' message; no crash.","Driver app","Edge"),
]

# ===== GROUP DR-2 — Active Trip + Navigation =====
CASES += [
    c("DR2-01","DR-2","P0","Trip","Driver app","Active Trip opens",
      "Trip assigned.","Tap trip.",
      "Stops list shown in order.","Driver app","Positive"),
    c("DR2-02","DR-2","P1","Trip","Driver app","Trip starts (PLANNED→IN_PROGRESS)",
      "Trip PLANNED.","Tap 'Start trip'.",
      "Status IN_PROGRESS; admin sees update.","Driver app","Positive"),
    c("DR2-03","DR-2","P1","Trip","Driver app","Tap stop opens Delivery Steps",
      "—","Tap a stop.",
      "Delivery Steps screen for that stop opens.","Driver app","Positive"),
    c("DR2-04","DR-2","P1","Trip","Driver app","Map deep-link opens Google Maps",
      "Stop has location.","Tap 'Open Map' on a stop.",
      "Google Maps opens with destination prefilled.","Driver app","Positive"),
    c("DR2-05","DR-2","P1","Trip","Driver app","Cannot end trip with incomplete stops",
      "One stop undelivered.","Tap End Trip.",
      "Blocked or confirmation; trip not COMPLETED.","Driver app","Negative"),
    c("DR2-06","DR-2","P0","Trip","Driver app","End trip when all stops done",
      "All stops complete.","End Trip.",
      "Status COMPLETED; driver shows AVAILABLE in admin.","Driver app","Positive"),
]

# ===== GROUP DR-3 — Scan + Custody Chain (5 event types) =====
CASES += [
    c("DR3-01","DR-3","P0","Scan","Driver app","Scan screen opens with camera",
      "Camera permission granted.","Open Scan.",
      "Live camera preview; scanner active.","Driver app","Positive"),
    c("DR3-02","DR-3","P0","Custody","Driver app","SCAN_OUT loads cylinder onto vehicle",
      "At store; QR scanned matches a cylinder.","Scan cylinder.",
      "Custody event SCAN_OUT created; custody=VEHICLE.","Driver app","Positive"),
    c("DR3-03","DR-3","P0","Custody","Driver app","DELIVERED to client",
      "Driver at customer location.","Scan with eventType=DELIVERED.",
      "Custody event DELIVERED created; custody=CLIENT.","Driver app","Positive"),
    c("DR3-04","DR-3","P1","Custody","Driver app","PICKED_UP_EMPTY",
      "Customer hands empty.","Scan empty cylinder QR.",
      "Custody=VEHICLE; cylinder state=EMPTY.","Driver app","Positive"),
    c("DR3-05","DR-3","P1","Custody","Driver app","RETURNED_TO_DISTRIBUTOR",
      "Empty back at distributor.","Scan at return.",
      "Custody event recorded; distributor inventory updates.","Driver app","Positive"),
    c("DR3-06","DR-3","P1","Custody","Driver app","TRANSFER event creates record",
      "Transfer task active.","Scan during transfer step.",
      "Custody event TRANSFER created.","Driver app","Positive"),
    c("DR3-07","DR-3","P1","Scan","Driver app","Unrecognized QR rejected",
      "Random QR.","Scan it.",
      "'Not recognized' inline error; no event created.","Driver app","Negative"),
    c("DR3-08","DR-3","P1","Scan","Driver app","Duplicate scan debounced",
      "Cylinder already VEHICLE.","Scan it again same event.",
      "No duplicate event OR clear 'already in custody' msg.","Driver app","Edge"),
    c("DR3-09","DR-3","P1","Scan","Driver app","Sequential events keep order",
      "Scan 5 cylinders rapidly.","Inspect audit/log.",
      "All 5 events present with monotonic timestamps.","Driver app","Edge"),
    c("DR3-10","DR-3","P0","Custody","Admin web","Custody chain visible in admin",
      "Events from DR3-02..06.","Open order/cylinder detail.",
      "Full chain rendered in chronological order.","Admin web","Positive"),
]

# ===== GROUP DR-4 — Delivery Steps Flow =====
CASES += [
    c("DR4-01","DR-4","P0","Delivery","Driver app","Delivery Steps opens",
      "Stop selected.","Open it.",
      "Single 'current step' card shown.","Driver app","Positive"),
    c("DR4-02","DR-4","P0","Delivery","Driver app","Arrive action records timestamp",
      "Step=ARRIVE.","Tap Arrive.",
      "arrivedAt timestamp set; UI moves to next sub-step.","Driver app","Positive"),
    c("DR4-03","DR-4","P0","Delivery","Driver app","Capture proof photo",
      "Step=DELIVER.","Tap Capture; take photo.",
      "Photo uploaded to S3 (smartfleet-files-prod).","Driver app","Positive"),
    c("DR4-04","DR-4","P0","Delivery","Driver app","Mark delivered action",
      "Photo captured.","Tap Mark Delivered.",
      "Order DELIVERED; reflected on admin.","Driver app","Positive"),
    c("DR4-05","DR-4","P1","Delivery","Driver app","Depart action moves to next stop",
      "Stop marked delivered.","Tap Depart.",
      "departedAt set; Active Trip shows progression.","Driver app","Positive"),
    c("DR4-06","DR-4","P1","Delivery","Driver app","Skip stop with reason",
      "Customer not home.","Skip; provide reason.",
      "Order marked FAILED with reason; driver moves on.","Driver app","Edge"),
    c("DR4-07","DR-4","P1","Delivery","Admin web","Proof photo visible in admin",
      "DR4-03 done.","Open order in admin → Proof Photo.",
      "Image renders (pre-signed URL).","Admin web","Positive"),
    c("DR4-08","DR-4","P1","Delivery","Distributor app","Status DELIVERED on distributor",
      "Distributor refreshes.","Open the order.",
      "Status DELIVERED with photo.","Distributor app","Positive"),
]

# ===== GROUP DR-5 — Fuel Refill =====
CASES += [
    c("DR5-01","DR-5","P1","Fuel","Driver app","Fuel screen prefills plate + odometer",
      "Driver+vehicle.","Open Fuel.",
      "Plate visible; last odometer prefilled.","Driver app","Positive"),
    c("DR5-02","DR-5","P0","Fuel","Driver app","Record refill",
      "—","Litres=10, Cost=2500, Odometer=12345.","Saved; in 'My refills'.","Driver app","Positive"),
    c("DR5-03","DR-5","P1","Fuel","Driver app","Odometer regression blocked",
      "Last odometer=12345.","Enter 12300.",
      "Blocked with validation msg.","Driver app","Negative"),
    c("DR5-04","DR-5","P1","Fuel","Driver app","Missing fields rejected",
      "—","Submit with empty litres.",
      "'Missing values' alert.","Driver app","Negative"),
    c("DR5-05","DR-5","P1","Fuel","Admin web","Refill in admin Fuel Report",
      "DR5-02.","Admin → Fuel Report.","Entry visible with cost + odometer + driver.","Admin web","Positive"),
]

# ===== GROUP DR-6 — Filling Orders (driver pickup) =====
CASES += [
    c("DR6-01","DR-6","P1","Filling","Driver app","Assigned filling orders shown",
      "T-4 assigned driver to a filling order.","Open Filling Orders.",
      "Order in list with station + counts.","Driver app","Positive"),
    c("DR6-02","DR-6","P1","Filling","Driver app","Open detail",
      "—","Tap order.",
      "Detail with station info, target counts.","Driver app","Positive"),
    c("DR6-03","DR-6","P1","Filling","Driver app","Pickup confirmation at station",
      "At station.","Confirm pickup.",
      "Status IN_TRANSIT; custody to VEHICLE.","Driver app","Positive"),
    c("DR6-04","DR-6","P1","Filling","Driver app","Quantity discrepancy flagged",
      "Station gave 8 instead of 10.","Enter actual=8.",
      "Variance recorded; admin can review.","Driver app","Edge"),
]

# ===== GROUP DR-7 — Transfers =====
CASES += [
    c("DR7-01","DR-7","P1","Transfer","Driver app","Transfers list shows tasks",
      "Transfer assigned (U-5).","Open Transfers.",
      "Task listed.","Driver app","Positive"),
    c("DR7-02","DR-7","P1","Transfer","Driver app","Open transfer detail",
      "—","Tap task.",
      "Source store, destination, cylinder list visible.","Driver app","Positive"),
    c("DR7-03","DR-7","P1","Transfer","Driver app","Scan at source picks cylinders",
      "—","Transfer Scan; scan all source cylinders.",
      "All scanned; status IN_TRANSIT.","Driver app","Positive"),
    c("DR7-04","DR-7","P1","Transfer","Driver app","Scan at destination drops",
      "Arrived at dest.","Scan each cylinder.",
      "Transfer COMPLETED; destination inventory increased.","Driver app","Positive"),
    c("DR7-05","DR-7","P1","Transfer","Driver app","Missing cylinder flagged",
      "Scan only 9 of 10.","Try to complete.",
      "Variance flagged; transfer stays open or partial.","Driver app","Negative"),
]

# ===== GROUP DR-8 — Reconciliation + Notifications + Profile =====
CASES += [
    c("DR8-01","DR-8","P1","Reconcile","Driver app","Reconcile screen opens",
      "Trip COMPLETED.","Open Reconcile.",
      "Cash input visible.","Driver app","Positive"),
    c("DR8-02","DR-8","P0","Reconcile","Driver app","Submit reconciliation",
      "—","Cash=5000; Submit.",
      "Recon created; status PENDING.","Driver app","Positive"),
    c("DR8-03","DR-8","P1","Reconcile","Admin web","Admin sees pending recon",
      "DR8-02.","Admin → Reconciliations.","Listed PENDING with driver + amount.","Admin web","Positive"),
    c("DR8-04","DR-8","P1","Reconcile","Admin web","Admin verifies/flags recon",
      "—","Mark VERIFIED.",
      "Driver app shows verified state on refresh.","Admin web + Driver app","Positive"),
    c("DR8-05","DR-8","P1","Notifications","Driver app","Notifications screen",
      "Some notifications exist.","Open Notifications.",
      "List renders.","Driver app","Positive"),
    c("DR8-06","DR-8","P1","Profile","Driver app","Profile view & edit",
      "—","Open Profile; change name; Save.",
      "Persists across reload.","Driver app","Positive"),
    c("DR8-07","DR-8","P1","Profile","Driver app","Logout from driver app",
      "—","Logout.",
      "Returns to phone screen.","Driver app","Positive"),
]

# ===== GROUP CL — Client Portal =====
CASES += [
    c("CL-01","CL","P1","Portal","Client device","Client receives delivery link/notification",
      "Order DELIVERED.","Check client phone (SMS/push depending on channel).",
      "Link or notification arrives with order id.","Client device","Positive"),
    c("CL-02","CL","P1","Portal","Client portal","Active deliveries shown",
      "Client logs in to portal.","Open active deliveries.",
      "Recent orders listed.","Client portal","Positive"),
    c("CL-03","CL","P1","Portal","Client portal","Order detail accessible",
      "—","Tap order.",
      "Lines, status, proof photo (if delivered) shown.","Client portal","Positive"),
    c("CL-04","CL","P0","Portal","Client portal","Confirm delivery received",
      "Order DELIVERED but unconfirmed.","Tap Confirm Delivery.",
      "Confirmation recorded; admin & driver see updated state.","Client portal","Positive"),
    c("CL-05","CL","P1","Portal","Client portal","Confirm empties picked up",
      "Empties returned.","Tap Confirm Empties.",
      "Empties confirmation recorded.","Client portal","Positive"),
]

# ===== GROUP R — Admin Dashboard + Live Deliveries =====
CASES += [
    c("R01","R","P0","Dashboard","Admin web","KPI tiles render",
      "—","Open Dashboard.",
      "5 tiles (drivers online, active, pending, delivered today, alerts).","Admin web","Positive"),
    c("R02","R","P1","Dashboard","Admin web","Drivers online count matches",
      "≥1 driver online.","Inspect tile vs Drivers screen count.",
      "Numbers match.","Admin web","Positive"),
    c("R03","R","P1","Dashboard","Admin web","Active deliveries count matches",
      "Orders IN_TRANSIT/ASSIGNED present.","Inspect tile vs Orders list filter.",
      "Counts match.","Admin web","Positive"),
    c("R04","R","P1","Dashboard","Admin web","Pending dispatch count",
      "Orders PENDING.","Compare.",
      "Match.","Admin web","Positive"),
    c("R05","R","P1","Dashboard","Admin web","Delivered today count uses local date",
      "Orders delivered today + yesterday.","Compare.",
      "Today's count only.","Admin web","Edge"),
    c("R06","R","P1","Dashboard","Admin web","Open alerts count matches Alerts screen",
      "—","Compare.",
      "Match.","Admin web","Positive"),
    c("R07","R","P1","Dashboard","Admin web","Recent orders table populated",
      "Orders exist.","Inspect.",
      "Latest ≤10 orders with correct fields.","Admin web","Positive"),
    c("R08","R","P1","Dashboard","Admin web","Driver roster lists drivers",
      "Drivers seeded.","Scroll roster.",
      "Lists each driver with online state.","Admin web","Positive"),
    c("R09","R","P0","Live","Admin web","Live Deliveries opens",
      "—","Open Live.",
      "Map + driver list render.","Admin web","Positive"),
    c("R10","R","P1","Live","Admin web","Driver markers appear when online",
      "≥1 driver online.","Wait <30s.",
      "Marker appears on map.","Admin web","Positive"),
    c("R11","R","P1","Live","Admin web","Marker moves as driver moves",
      "Driver walking.","Watch.",
      "Marker updates ≤30s.","Admin web","Positive"),
    c("R12","R","P2","Live","Admin web","Click marker shows driver info",
      "—","Click marker.",
      "Tooltip/panel with driver name + last update.","Admin web","Positive"),
    c("R13","R","P2","Live","Admin web","Socket reconnects after tab away",
      "Live open.","Switch tabs 60s; return.",
      "Markers up-to-date; no permanent disconnect.","Admin web","Edge"),
]

# ===== GROUP S — Admin Orders Management =====
CASES += [
    c("S01","S","P0","Orders","Admin web","Current Orders lists PENDING/ASSIGNED/IN_TRANSIT",
      "Mixed statuses.","Open Current.",
      "Only those statuses present.","Admin web","Positive"),
    c("S02","S","P0","Orders","Admin web","Previous Orders shows terminal statuses",
      "—","Open Previous.",
      "Only DELIVERED/CANCELLED/FAILED present.","Admin web","Positive"),
    c("S03","S","P1","Orders","Admin web","Delivery Orders list",
      "Active orders.","Open Delivery Orders.",
      "Only deliverable orders visible.","Admin web","Positive"),
    c("S04","S","P1","Orders","Admin web","Status filter",
      "Mixed.","Filter by status.",
      "Filter applies.","Admin web","Positive"),
    c("S05","S","P1","Orders","Admin web","Distributor filter",
      "≥2 distributors with orders.","Filter.",
      "Only chosen distributor's orders.","Admin web","Positive"),
    c("S06","S","P2","Orders","Admin web","Date range filter",
      "Orders across days.","Apply.","Restricted to range.","Admin web","Positive"),
    c("S07","S","P1","Orders","Admin web","Order detail complete",
      "Order has lines + proof.","Open detail.",
      "Lines, addresses, custody, timeline, proof all visible.","Admin web","Positive"),
    c("S08","S","P0","Orders","Admin web","Assign driver from detail",
      "PENDING order; driver exists.","Assign.",
      "Status ASSIGNED; driver attached.","Admin web","Positive"),
    c("S09","S","P0","Orders","Admin web","Status PENDING→CONFIRMED",
      "Order PENDING.","Confirm.",
      "Status updated.","Admin web","Positive"),
    c("S10","S","P0","Orders","Admin web","CONFIRMED→ASSIGNED",
      "—","Assign driver.","Status ASSIGNED.","Admin web","Positive"),
    c("S11","S","P0","Orders","Admin web","ASSIGNED→IN_TRANSIT",
      "Driver starts trip.","Watch admin.","Status IN_TRANSIT.","Admin web","Positive"),
    c("S12","S","P0","Orders","Admin web","IN_TRANSIT→DELIVERED",
      "Driver delivers.","Watch.","Status DELIVERED.","Admin web","Positive"),
    c("S13","S","P0","Orders","Admin web","Illegal status jump rejected",
      "Order PENDING.","Force DELIVERED via API.",
      "403/400; order stays PENDING.","Admin web","Negative"),
    c("S14","S","P1","Orders","Admin web","Cancel order with reason",
      "PENDING.","Cancel with reason.",
      "CANCELLED with reason; distributor sees.","Admin web","Positive"),
    c("S15","S","P1","Orders","Admin web","Reassign to different driver",
      "ASSIGNED.","Reassign.",
      "New driver attached; old driver's app removes it.","Admin web","Positive"),
]

# ===== GROUP T — Filling Stations + Filling Orders =====
CASES += [
    c("T01","T","P1","Filling","Admin web","Filling Stations list",
      "—","Open Filling Stations.","List renders or empty state.","Admin web","Positive"),
    c("T02","T","P1","Filling","Admin web","Create filling station",
      "—","Name, address, price/cylinder; Save.",
      "Listed; selectable on distributor app.","Admin web","Positive"),
    c("T03","T","P1","Filling","Admin web","Edit station price",
      "—","Change price.",
      "Persists; reflects on distributor request.","Admin web","Positive"),
    c("T04","T","P1","Filling","Admin web","Create filling order",
      "Station + distributor + type.","New Filling Order; fill; Save.",
      "Created PENDING.","Admin web","Positive"),
    c("T05","T","P1","Filling","Admin web","Assign driver to filling order",
      "PENDING order; driver.","Assign.",
      "Order ASSIGNED; visible in driver app.","Admin web","Positive"),
    c("T06","T","P1","Filling","Admin web","Cancel filling order",
      "PENDING.","Cancel.","Status CANCELLED.","Admin web","Positive"),
]

# ===== GROUP U — Transfers + Returns =====
CASES += [
    c("U01","U","P1","Transfers","Admin web","Transfers list opens",
      "—","Open Transfers.","List renders.","Admin web","Positive"),
    c("U02","U","P1","Transfers","Admin web","Create transfer with stock validation",
      "Source store has stock.","Pick source/dest; cylinders.",
      "Stock summary shown; cannot exceed available.","Admin web","Positive"),
    c("U03","U","P1","Transfers","Admin web","Source≠destination enforced",
      "—","Pick same store both.",
      "Validation: must differ.","Admin web","Negative"),
    c("U04","U","P1","Transfers","Admin web","Assign driver",
      "Transfer created.","Assign.","Driver sees task.","Admin web","Positive"),
    c("U05","U","P1","Transfers","Admin web","Track status REQUESTED→COMPLETED",
      "Driver carries out transfer.","Watch.","Status progresses correctly.","Admin web","Positive"),
    c("U06","U","P2","Returns","Admin web","Returns list shows empties going back",
      "—","Open Returns.","Empties listed with origin/destination.","Admin web","Positive"),
]

# ===== GROUP V — Alerts =====
CASES += [
    c("V01","V","P1","Alerts","Admin web","Alerts screen opens",
      "—","Open Alerts.","List opens.","Admin web","Positive"),
    c("V02","V","P1","Alerts","Admin web","Open vs all toggle",
      "—","Toggle.","Filter applies.","Admin web","Positive"),
    c("V03","V","P2","Alerts","Admin web","Filter by severity",
      "Alerts of various severities.","Filter.","Correct subset.","Admin web","Positive"),
    c("V04","V","P1","Alerts","Admin web","Acknowledge alert",
      "Open alert.","Ack.","Status ACK; UI updates.","Admin web","Positive"),
    c("V05","V","P1","Alerts","Admin web","Resolve alert",
      "—","Resolve.","Status RESOLVED.","Admin web","Positive"),
    c("V06","V","P1","Alerts","Admin web","Create DISTRIBUTOR_BALANCE_LOW rule",
      "—","New rule; threshold=500; pick distributor.",
      "Rule saved.","Admin web","Positive"),
    c("V07","V","P1","Alerts","Admin web","Rule triggers an alert",
      "V06; distributor balance below 500.","Wait for housekeeping cron or trigger.",
      "Alert created within ~1 min.","Admin web","Positive"),
    c("V08","V","P1","Alerts","Admin web","Create DISTRIBUTOR_CREDIT_OVER rule",
      "—","Threshold=2000 (PKR debt tolerated).",
      "Rule saved.","Admin web","Positive"),
    c("V09","V","P1","Alerts","Admin web","Create SPECIAL_CLIENT rule",
      "—","Pick client; create rule.","Saved.","Admin web","Positive"),
    c("V10","V","P1","Alerts","Admin web","Special client order triggers info alert",
      "V09; place order from that client.","Wait <1 min.",
      "Info alert created.","Admin web","Positive"),
]

# ===== GROUP W — Geography =====
CASES += [
    c("W01","W","P0","Cities","Admin web","Cities list seeded",
      "Seed run.","Open Cities.",
      "Islamabad/Rawalpindi/Lahore/Karachi visible.","Admin web","Positive"),
    c("W02","W","P1","Cities","Admin web","Add new city",
      "—","Add Peshawar.","Listed.","Admin web","Positive"),
    c("W03","W","P1","Zones","Admin web","List zones",
      "—","Open Zones.","List or empty state.","Admin web","Positive"),
    c("W04","W","P1","Zones","Admin web","Create zone with polygon",
      "City exists.","New Zone; draw polygon; Save.",
      "Saved with PostGIS polygon.","Admin web","Positive"),
    c("W05","W","P1","Zones","Admin web","Active-only filter",
      "Mix active/inactive.","Toggle filter.","Correct list.","Admin web","Positive"),
    c("W06","W","P1","Zones","Admin web","Edit zone polygon",
      "Zone exists.","Edit; redraw; Save.",
      "New polygon persists.","Admin web","Positive"),
    c("W07","W","P1","Zones","Admin web","Deactivate zone",
      "—","Toggle is_active off.",
      "Hidden in active-only view.","Admin web","Positive"),
    c("W08","W","P1","Stores","Admin web","Stores list",
      "—","Open Stores.",
      "List or empty state.","Admin web","Positive"),
    c("W09","W","P1","Stores","Admin web","Add store under a zone",
      "Zone exists.","New Store; pick zone; Save.","Listed.","Admin web","Positive"),
    c("W10","W","P2","Stores","Admin web","Soft delete store",
      "—","Deactivate.","Hidden by default.","Admin web","Positive"),
]

# ===== GROUP X — Fleet =====
CASES += [
    c("X01","X","P1","Vehicles","Admin web","Vehicles list",
      "—","Open Vehicles.","Renders.","Admin web","Positive"),
    c("X02","X","P0","Vehicles","Admin web","Add vehicle",
      "—","Plate, capacity, type; Save.","Listed.","Admin web","Positive"),
    c("X03","X","P1","Vehicles","Admin web","Edit vehicle",
      "—","Change capacity.","Persists.","Admin web","Positive"),
    c("X04","X","P0","Vehicles","Admin web","Assign driver to vehicle",
      "Driver + vehicle.","Assign.","Driver Vehicle Info reflects.","Admin web","Positive"),
    c("X05","X","P1","Vehicles","Admin web","Set status MAINTENANCE",
      "—","Change status.","Persists.","Admin web","Positive"),
    c("X06","X","P0","Cylinder types","Admin web","List cylinder types (seeded)",
      "Seed.","Open.","4 types listed.","Admin web","Positive"),
    c("X07","X","P1","Cylinder types","Admin web","Edit type display name",
      "—","Change name; Save.","Persists; reflects on apps.","Admin web","Positive"),
    c("X08","X","P2","Accessories","Admin web","List accessories (seeded)",
      "—","Open Accessories.","10 items listed.","Admin web","Positive"),
    c("X09","X","P2","Accessories","Admin web","Add accessory",
      "—","Code/name/category/price.","Listed.","Admin web","Positive"),
    c("X10","X","P2","Accessories","Admin web","Edit accessory price",
      "—","Change price.","Persists.","Admin web","Positive"),
    c("X11","X","P1","Drivers","Admin web","Drivers list",
      "—","Open Drivers.","Renders.","Admin web","Positive"),
    c("X12","X","P1","Drivers","Admin web","Driver detail with trip + refill history",
      "Driver with activity.","Open detail.",
      "Trips + fuel refills + reconciliations visible.","Admin web","Positive"),
    c("X13","X","P1","Drivers","Admin web","Set availability ON_LEAVE",
      "—","Change availability.","Persists; visible in dispatch.","Admin web","Positive"),
]

# ===== GROUP Y — Distributors + Pricing =====
CASES += [
    c("Y01","Y","P0","Distributors","Admin web","Distributors list",
      "—","Open Distributors.","Renders.","Admin web","Positive"),
    c("Y02","Y","P0","Distributors","Admin web","Add distributor",
      "—","Phone, name, business name; Save.",
      "User+profile created.","Admin web","Positive"),
    c("Y03","Y","P0","Distributors","Admin web","Suspend distributor blocks mobile login",
      "Active distributor.","Suspend; try mobile OTP.",
      "Mobile login refused.","Admin web + Mobile","Negative"),
    c("Y04","Y","P1","Distributors","Admin web","Re-activate distributor",
      "Suspended.","Re-activate.","Mobile login works again.","Admin web","Positive"),
    c("Y05","Y","P1","Distributors","Admin web","View distributor's clients",
      "Distributor with clients.","Open detail.","Clients listed.","Admin web","Positive"),
    c("Y06","Y","P1","Distributors","Admin web","View distributor orders",
      "Orders exist.","Open detail → orders tab.","Listed.","Admin web","Positive"),
    c("Y07","Y","P1","Distributors","Admin web","View distributor balance + ledger",
      "—","Open detail.","Balance + ledger entries visible.","Admin web","Positive"),
    c("Y08","Y","P1","Pricing","Admin web","Pricing screen opens",
      "—","Open Pricing.","Renders.","Admin web","Positive"),
    c("Y09","Y","P1","Pricing","Admin web","Create pricing rule",
      "Zones + types.","Origin zone × dest zone × type → base+per-unit; Save.",
      "Listed; takes effect on new orders.","Admin web","Positive"),
    c("Y10","Y","P1","Pricing","Admin web","Edit pricing rule",
      "—","Change per-unit.","Persists; reflects on next order's price.","Admin web","Positive"),
]

# ===== GROUP Z — QR Generator =====
CASES += [
    c("Z01","Z","P1","QR","Admin web","QR Generator opens",
      "—","Open QR Generator.","Form + batches list visible.","Admin web","Positive"),
    c("Z02","Z","P1","QR","Admin web","Build a batch",
      "Distributor + type + store + qty=10.","Add batch.",
      "Batch row visible.","Admin web","Positive"),
    c("Z03","Z","P0","QR","Admin web","Generate batch (POST /cylinders)",
      "Batch queued.","Generate.",
      "10 cylinders created; QR codes returned.","Admin web","Positive"),
    c("Z04","Z","P1","QR","Admin web","Preview grid renders",
      "Z03.","Inspect.",
      "10 QR codes shown.","Admin web","Positive"),
    c("Z05","Z","P1","QR","Admin web","Print page renders",
      "—","Print preview.",
      "Codes laid out for printing.","Admin web","Positive"),
    c("Z06","Z","P1","QR","Admin web","CSV export downloads",
      "—","Export CSV.",
      "CSV file with cylinder ids + QR strings.","Admin web","Positive"),
    c("Z07","Z","P0","QR","Admin web","New cylinders visible in inventory",
      "Z03.","Open Inventory.",
      "Counts match generated qty.","Admin web","Positive"),
]

# ===== GROUP AA — Reports =====
CASES += [
    c("AA01","AA","P1","Reports","Admin web","Reports screen opens",
      "—","Open Reports.","Sub-tabs visible.","Admin web","Positive"),
    c("AA02","AA","P1","Reports","Admin web","Driver utilization",
      "Trips data.","Open utilization.","Chart + numbers.","Admin web","Positive"),
    c("AA03","AA","P1","Reports","Admin web","Driver attendance with date range",
      "Shifts logged.","Pick range; refresh.","Per-driver hours render.","Admin web","Positive"),
    c("AA04","AA","P1","Reports","Admin web","Dispatch decisions report",
      "Orders with dispatch decisions.","Open.","List of decisions + scores.","Admin web","Positive"),
    c("AA05","AA","P1","Reports","Admin web","Delivery funnel",
      "Orders across statuses.","Open.","Counts per status; conversion %.","Admin web","Positive"),
    c("AA06","AA","P1","Reports","Admin web","Inventory by store",
      "Custody seeded.","Open.","Per-store/type counts.","Admin web","Positive"),
    c("AA07","AA","P2","Reports","Admin web","Charts render on empty data",
      "Empty environment.","Open each.","No crashes; empty states.","Admin web","Edge"),
]

# ===== GROUP AB — Expenses + Fuel Report =====
CASES += [
    c("AB01","AB","P1","Expenses","Admin web","Expenses screen opens",
      "—","Open.","Renders.","Admin web","Positive"),
    c("AB02","AB","P1","Expenses","Admin web","Record expense",
      "—","Category, amount, date; Save.","Listed.","Admin web","Positive"),
    c("AB03","AB","P2","Expenses","Admin web","Filter by category",
      "Multiple expenses.","Filter.","Correct subset.","Admin web","Positive"),
    c("AB04","AB","P1","Fuel","Admin web","Fuel Report opens",
      "—","Open.","Renders.","Admin web","Positive"),
    c("AB05","AB","P1","Fuel","Admin web","Filter by vehicle/driver/date",
      "Multiple refills.","Apply filters.","Subset matches.","Admin web","Positive"),
    c("AB06","AB","P2","Fuel","Admin web","Summary stats correct",
      "—","Inspect totals.","Sum of cost matches.","Admin web","Positive"),
]

# ===== GROUP AC — Inventory + Custody Trace =====
CASES += [
    c("AC01","AC","P1","Inventory","Admin web","Inventory by Store opens",
      "—","Open Inventory.","Stores listed with cylinder counts.","Admin web","Positive"),
    c("AC02","AC","P1","Inventory","Admin web","Counts match custody",
      "Custody events seeded.","Compare totals.",
      "Match.","Admin web","Positive"),
    c("AC03","AC","P1","Custody","Admin web","Trace single cylinder by QR",
      "Cylinder with events.","Search by QR.",
      "Full timeline of events.","Admin web","Positive"),
    c("AC04","AC","P2","Custody","Admin web","Cylinder marked LOST",
      "—","Mark LOST.",
      "State updated; visible in inventory.","Admin web","Edge"),
]

# ===== GROUP FI — Files + S3 =====
CASES += [
    c("FI01","FI","P0","Files","S3","Proof photo upload reaches S3",
      "DR4-03 just happened.","aws s3 ls s3://smartfleet-files-prod/.","Photo file visible.","S3","Positive"),
    c("FI02","FI","P1","Files","Mobile/Admin","Profile picture upload (if implemented)",
      "Profile screen.","Upload photo.","Visible in profile.","Mobile/Admin","Positive"),
    c("FI03","FI","P1","Files","Admin web","Pre-signed URL works",
      "Proof photo in S3.","Open in admin order detail.","Image renders.","Admin web","Positive"),
    c("FI04","FI","P0","Files","S3","Direct public URL blocked",
      "Bucket public-access blocked.","Open S3 URL in incognito.","AccessDenied.","S3","Negative"),
    c("FI05","FI","P1","Files","S3","Lifecycle rule active",
      "Bucket configured.","aws s3api get-bucket-lifecycle-configuration.","Rule moves >60d to Glacier IR.","S3","Positive"),
]

# ===== GROUP PN — Push Notifications =====
CASES += [
    c("PN01","PN","P0","Push","Driver app","Order assigned → push notification",
      "FCM configured (or fallback); driver app installed + permission granted.",
      "Admin assigns order to driver.",
      "Push received <30s.","Driver app","Positive"),
    c("PN02","PN","P1","Push","Distributor app","Order delivered → push to distributor",
      "—","Driver delivers.","Push received.","Distributor app","Positive"),
    c("PN03","PN","P1","Push","Client portal","Order delivered → notification to client",
      "—","Watch client device.","Notification or SMS link arrives.","Client device","Positive"),
    c("PN04","PN","P1","Push","Driver app","Tap notification deep-links to right screen",
      "Push received.","Tap.","Opens Active Trip or relevant screen.","Driver app","Positive"),
    c("PN05","PN","P2","Push","All apps","Backgrounded app receives push",
      "App in background.","Trigger.","Notification rings even if app not active.","All apps","Positive"),
    c("PN06","PN","P1","In-app","All apps","In-app notification badge increments",
      "Trigger event.","Refresh.","Bell badge increments.","All apps","Positive"),
]

# ===== GROUP AU — API & Backend =====
CASES += [
    c("AU01","AU","P1","Audit","API","Audit log entries on key actions",
      "Perform: status change, distributor suspend.","Query /audit-log.",
      "Entries exist with userId + action + timestamp.","API","Positive"),
    c("AU02","AU","P2","Audit","API","Audit log queryable by user",
      "—","Query with filter.","Returns only that user's events.","API","Positive"),
    c("AU03","AU","P1","Support","Admin web/API","Create support ticket",
      "—","Create.","Ticket persists; listed.","API + Admin web","Positive"),
    c("AU04","AU","P1","Support","Admin web/API","Resolve ticket",
      "Open ticket.","Resolve with note.","Status RESOLVED.","API + Admin web","Positive"),
    c("AU05","AU","P1","Push tokens","Mobile/API","Push token registers on login",
      "Push permission granted.","Login.","Token POSTed to /push-tokens.","API","Positive"),
    c("AU06","AU","P1","Push tokens","Mobile/API","Token deregisters on logout",
      "Logged in.","Logout.","Token deleted; no further push to that device.","API","Positive"),
    c("AU07","AU","P2","Feature flags","API","Feature flag toggle reflects on next call",
      "PostHog flag set.","Toggle on then off.","Behaviour changes accordingly.","API","Positive"),
]

# ===== GROUP NR — Network Resilience =====
CASES += [
    c("NR01","NR","P1","Network","Distributor app","Action on full offline",
      "Logged in.","Airplane mode; tap Send OTP / Place Order.",
      "Friendly 'no connection' msg; no spinner; no crash.","Distributor app","Edge"),
    c("NR02","NR","P1","Network","Distributor app","Slow 3G doesn't hang the app",
      "~150 kbps.","Open lists.",
      "Skeleton/spinner; eventually loads.","Distributor app","Edge"),
    c("NR03","NR","P1","Network","Distributor app","5xx from server",
      "Restart api-prod mid-request.","Trigger fetch.",
      "Retry button shown; no crash.","Distributor app","Edge"),
    c("NR04","NR","P1","Auth","Distributor app","Expired token forces re-login or silent refresh",
      "Token expired.","Call authed endpoint.",
      "Either auto-refresh silently OR redirect to login.","Distributor app","Edge"),
    c("NR05","NR","P0","Resilience","EC2","Container crash auto-restarts",
      "SSH.","docker kill smartfleet-api-prod.",
      "Auto-restart ~2s; /health/live OK ≤10s.","API","Edge"),
    c("NR06","NR","P1","Resilience","EC2","Full reboot recovers everything",
      "—","sudo reboot.","All come back: Caddy/containers/app reconnects.","All","Edge"),
]

# ===== GROUP SE — Security & Permissions =====
CASES += [
    c("SE01","SE","P0","Sec","API","Cross-distributor isolation",
      "Two distributors with their data.","Use A's token to list, then B's.",
      "Each sees only their own; no overlap.","API","Negative"),
    c("SE02","SE","P0","Sec","API","Role-restricted endpoint",
      "Distributor token.","POST /orders/{id}/assign.","403.","API","Negative"),
    c("SE03","SE","P0","Sec","API","Tampered JWT rejected",
      "Valid token; flip signature char.","Call /auth/me.","401.","API","Negative"),
    c("SE04","SE","P0","Sec","S3","Bucket not listable",
      "—","Open https://...s3.../ in incognito.","AccessDenied.","S3","Negative"),
    c("SE05","SE","P0","Sec","API","OTP not leaked in prod response",
      "—","POST /auth/otp/send in prod.","Response only {ok:true} (no devCode).","API","Positive"),
    c("SE06","SE","P1","Sec","DB","PII encrypted at rest (CNIC)",
      "User with CNIC.","Query users.cnic_encrypted.","Ciphertext.","DB","Positive"),
    c("SE07","SE","P1","Sec","API","Suspended user cannot authenticate",
      "Suspend +923001111111.","Try mobile OTP login.",
      "Refused with 'Account not active'.","API","Negative"),
    c("SE08","SE","P1","Sec","API","Driver role can't access admin endpoints",
      "Driver token.","Call /admin/* endpoints.","403.","API","Negative"),
    c("SE09","SE","P1","Sec","API","Field roles can't use password endpoint",
      "Distributor created with hashed password manually.","POST /auth/login as distributor.",
      "Rejected: 'must sign in with one-time code'.","API","Negative"),
    c("SE10","SE","P2","Sec","API","Brute-force protection on password",
      "—","Try 10 wrong passwords rapidly.",
      "Slows / locks (or just consistently rejects without crash).","API","Negative"),
]

# ===== GROUP DI — Data Integrity & Housekeeping =====
CASES += [
    c("DI01","DI","P1","Housekeeping","DB","Old OTP codes purged",
      "DB has codes >10 min old.","Query otp_codes.","No codes older than retention.","DB","Positive"),
    c("DI02","DI","P1","Housekeeping","DB","Expired sessions purged",
      "Old refresh tokens.","Query refresh_tokens.","None past expiry.","DB","Positive"),
    c("DI03","DI","P2","Housekeeping","DB","Audit log retention",
      "Old entries.","Query.","Entries >retention archived/dropped.","DB","Positive"),
    c("DI04","DI","P1","Backup","RDS","Automated snapshots exist",
      "—","aws rds describe-db-snapshots.","Recent snapshots present.","RDS","Positive"),
    c("DI05","DI","P1","Storage","S3","Glacier transition on >60d photos",
      "S3 lifecycle.","Test object aged via TestExecution.","Transitioned (if old enough).","S3","Positive"),
    c("DI06","DI","P1","Encryption","DB","Password hashes are argon2",
      "—","Inspect users.password_hash.","Starts with $argon2.","DB","Positive"),
]

# ===== FIELD groups (FD-1..FD-3, L) — keep inline below =====
FIELD_GROUPS_CASES = [
    # ---- FD-1 (driver day-in-life) ----
    ("FD1-01","FD-1","P0","Field","Driver app","Screen readable in midday sun",
      "Driver outside 11am–4pm.","Use screen for trip + scan.","Readable without shading.","Driver app","Field"),
    ("FD1-02","FD-1","P0","Field","Driver app","Scan worn QR sticker",
      "Cylinder used 1+ month.","Scan.","Reads or guides retry; ≥80% success.","Driver app","Field"),
    ("FD1-03","FD-1","P0","Field","Driver app","Proof photo at dusk",
      "Real delivery 7pm.","Capture.","Legible or torch prompt.","Driver app","Field"),
    ("FD1-04","FD-1","P0","Field","Driver app","Battery drain over 4-hour shift",
      "Start 100%.","Use 4h.","Drop ≤40%.","Driver app","Field"),
    ("FD1-05","FD-1","P1","Field","Driver app","Background location",
      "App backgrounded; phone in pocket.","Watch admin map.","Updates ≥15 min in BG.","Driver app + Admin","Field"),
    ("FD1-06","FD-1","P1","Field","Driver app","Dead-zone recovery",
      "Known dead-zone.","Pass through.","Queues; syncs on signal return.","Driver app","Field"),
    ("FD1-07","FD-1","P1","Field","Driver app","Notification heard with helmet",
      "Helmet + bike sounds.","Receive push.","Heard or felt; or document need for vibration.","Driver app","Field"),
    ("FD1-08","FD-1","P1","Field","Driver app","Glove-friendly buttons",
      "Riding gloves.","Tap.","First-tap accuracy.","Driver app","Field"),
    ("FD1-09","FD-1","P2","Field","Driver app","Urban GPS drift ≤30m",
      "6-storey buildings.","Compare.","Drift acceptable.","Driver app","Field"),
    # ---- FD-2 (distributor day-in-life) ----
    ("FD2-01","FD-2","P0","Field","Distributor app","Cheap-Android performance",
      "Rs.25k Android.","Place an order.","Completes ≤90s.","Distributor app","Field"),
    ("FD2-02","FD-2","P0","Field","Distributor app","OTP perception in tube light",
      "Shop.","Login 5×.","All complete <60s.","Distributor app","Field"),
    ("FD2-03","FD-2","P1","Field","Distributor app","Order entry under customer pressure",
      "Customer waiting.","Place order.","No blockers; <60s.","Distributor app","Field"),
    ("FD2-04","FD-2","P1","Field","Distributor app","WiFi↔SIM handoff mid-action",
      "Shop has both.","Walk out mid-order.","Continues on cellular; no data loss.","Distributor app","Field"),
    ("FD2-05","FD-2","P2","Field","Distributor app","Back-button confusion",
      "Naive user.","Watch them.","No 'stuck' moments.","Distributor app","Field"),
    ("FD2-06","FD-2","P1","Field","Distributor app","End-of-day responsiveness",
      "≥30 orders today.","Open app.","Lists <2s.","Distributor app","Field"),
    # ---- FD-3 (client field) ----
    ("FD3-01","FD-3","P1","Field","Customer","Customer can confirm delivery",
      "Delivery just happened.","Hand customer phone with link OR driver confirms verbally.",
      "Confirmation recorded.","Customer device","Field"),
    ("FD3-02","FD-3","P1","Field","Customer","Proof photo legible",
      "—","View photo.","Cylinder + signature visible.","Admin web","Field"),
    ("FD3-03","FD-3","P2","Field","Customer","No-app fallback path",
      "Customer has no smartphone.","Driver confirms.","Order still completes.","Driver app","Field"),
    # ---- L (soak + OTA) ----
    ("L01","L","P1","Soak","Apps","Token valid next morning",
      "Logged in overnight.","Reopen 12h later.","Still logged in OR refresh succeeds silently.","Apps","Edge"),
    ("L02","L","P0","OTA","Distributor app","EAS Update picked up",
      "Push small JS change.","eas update; close+reopen app.","Change visible; old crash not back.","Distributor app","Positive"),
    ("L03","L","P1","Cost","AWS","Day-over-day cost ≈ $0",
      "—","Billing → daily.","MTD <$1.","AWS","Positive"),
    ("L04","L","P1","Logs","CloudWatch","No recurring noisy errors",
      "—","Inspect log group.","Quiet; no repeat 500s.","CloudWatch","Positive"),
    ("L05","L","P1","Alarms","CloudWatch","No chronic ALARM state",
      "—","describe-alarms.","All OK / INSUFFICIENT_DATA.","CloudWatch","Positive"),
    ("L06","L","P2","Day boundary","Apps","Orders crossing midnight",
      "Order 11:55pm; deliver 12:05am.","Inspect timestamps.","Local-date logic correct; no off-by-one.","All","Edge"),
]
CASES += FIELD_GROUPS_CASES


# ---------------------------------------------------------------------------
# Sheet builders
# ---------------------------------------------------------------------------

def build_groups(wb):
    ws = wb.create_sheet("Test Groups")
    headers = ["Group", "Name", "Duration", "Where", "Pre-requirements", "What it covers", "Rebuild?", "Depends on"]
    set_widths(ws, [8, 40, 14, 22, 42, 70, 24, 16])
    for c_, h in enumerate(headers, start=1):
        ws.cell(row=1, column=c_, value=h)
    style_header(ws, 1, len(headers))

    for i, g in enumerate(GROUPS, start=2):
        gid, name, dur, where, pre, covers, rebuild, depends = g
        row = [gid, name, dur, where, pre, covers, rebuild, depends]
        for c_, v in enumerate(row, start=1):
            cell = ws.cell(row=i, column=c_, value=v)
            cell.alignment = CELL_ALIGN
            cell.border = BORDER
            if i % 2 == 0:
                cell.fill = ZEBRA
            if gid.startswith("FD") or gid == "L":
                cell.font = Font(color="A23A1A", bold=(c_ == 1))
        ws.row_dimensions[i].height = 60
    ws.freeze_panes = "A2"


def build_atomic(wb):
    ws = wb.create_sheet("Atomic Cases")
    headers = [
        "TC-ID", "Group", "Priority", "Area", "Surface", "Test Case",
        "Pre-condition", "Steps", "Expected Outcome",
        "Tested on", "Type",
        "Result", "Actual Result", "Defect ID",
        "Tester", "Date", "Notes",
    ]
    set_widths(ws, [10, 8, 9, 14, 14, 38, 30, 50, 50, 20, 11, 12, 28, 12, 14, 12, 24])
    for c_, h in enumerate(headers, start=1):
        ws.cell(row=1, column=c_, value=h)
    style_header(ws, 1, len(headers))

    row = 2
    current_group = None
    for tc in CASES:
        tc_id, group, prio, area, surface, name, pre, steps, expected, tested_on, ttype = tc
        if group != current_group:
            current_group = group
            label = next(g[1] for g in GROUPS if g[0] == group)
            cell = ws.cell(row=row, column=1, value=f"Group {group} — {label}")
            cell.fill = GROUP_HEADER_FILL
            cell.font = GROUP_HEADER_FONT
            cell.alignment = Alignment(vertical="center")
            ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=len(headers))
            ws.row_dimensions[row].height = 22
            row += 1

        values = [tc_id, group, prio, area, surface, name, pre, steps, expected, tested_on, ttype,
                  "", "", "", "", "", ""]
        for c_, v in enumerate(values, start=1):
            cell = ws.cell(row=row, column=c_, value=v)
            cell.alignment = CELL_ALIGN
            cell.border = BORDER
            if c_ == 3 and prio in PRIORITY_FILLS:
                cell.fill = PRIORITY_FILLS[prio]
        ws.row_dimensions[row].height = 55
        row += 1

    ws.freeze_panes = "F2"


FIELD_DETAILS = [
    ("FS-01", "Sun glare on screen",
        "Driver + distributor 11am–4pm. Read screen + find next-step button.",
        "≥1 user struggles ≥3× → P1 fix."),
    ("FS-02", "Dust on camera lens",
        "Driver on bike. 5 proof photos without wiping lens.",
        "Photos legible OR app prompts to wipe."),
    ("FS-03", "Worn / faded QR sticker",
        "Cylinders ≥1 month outdoor use. Scan deliberately damaged QRs.",
        "≥80% success."),
    ("FS-04", "Background location while screen off",
        "Lock phone 15 min while moving.",
        "Admin map keeps receiving pings."),
    ("FS-05", "Helmet + bike noise on push",
        "Push new-assignment while riding.",
        "Heard via Bluetooth or via stop-check vibration."),
    ("FS-06", "Glove-friendly tap targets",
        "Summer gloves; tap every primary action.",
        "All hit first try."),
    ("FS-07", "Cheap Android performance",
        "Rs.20–30k device, order flow.",
        "End-to-end ≤90s; lists ≤2s cached."),
    ("FS-08", "Network handoff WiFi↔SIM",
        "Walk out of WiFi range mid-action.",
        "Request completes/recovers; no orphan."),
    ("FS-09", "Battery drain real shift",
        "4 hours with location on.",
        "End ≥60%."),
    ("FS-10", "Dead-zone tolerance",
        "Known black spot.",
        "Queues; syncs on recovery."),
    ("FS-11", "OTP delivery perception",
        "Watch real distributor login 5× over a week.",
        "All <60s; frustration logged."),
    ("FS-12", "Confused first-time user",
        "Brand-new distributor; place order solo.",
        "≤2 stuck moments."),
    ("FS-13", "Photo upload weak 3G",
        "Rural area.",
        "Upload <60s or queues."),
    ("FS-14", "Multiple drivers on live map",
        "3 driver devices online.",
        "All markers updating, lag <5s."),
    ("FS-15", "Push notification delivery to backgrounded app",
        "Driver backgrounded; admin assigns 5 orders over 30 min.",
        "All 5 pushes received within ≤30s each."),
    ("FS-16", "Real cash reconciliation discrepancy",
        "Driver entered Rs. 5,000 but Rs. 4,800 actually counted.",
        "Admin flags discrepancy; clear UI."),
    ("FS-17", "Multiple deliveries in same zone",
        "Driver does 8 deliveries within 2 hours.",
        "Trip stops sequenced correctly; no out-of-order custody events."),
    ("FS-18", "Out-of-range customer phone",
        "Customer phone has no data signal at delivery.",
        "Driver can mark delivered without customer confirmation; reconciles later."),
    ("FS-19", "Real driver no English",
        "Driver only reads Urdu.",
        "UI strings clear/iconic; or i18n flagged for next sprint."),
    ("FS-20", "Cylinder swap edge case",
        "Customer returns DIFFERENT cylinder type than ordered.",
        "App allows scan; admin flags mismatch; not silently absorbed."),
]


def build_field(wb):
    ws = wb.create_sheet("Field Scenarios")
    headers = ["FS-ID", "Scenario", "How to run", "Pass criteria", "Result", "Notes / device", "Tester", "Date"]
    set_widths(ws, [9, 32, 60, 50, 16, 30, 14, 12])
    for c_, h in enumerate(headers, start=1):
        ws.cell(row=1, column=c_, value=h)
    style_header(ws, 1, len(headers))
    for i, row in enumerate(FIELD_DETAILS, start=2):
        fs_id, scen, how, pass_crit = row
        vals = [fs_id, scen, how, pass_crit, "", "", "", ""]
        for c_, v in enumerate(vals, start=1):
            cell = ws.cell(row=i, column=c_, value=v)
            cell.alignment = CELL_ALIGN
            cell.border = BORDER
            if i % 2 == 0:
                cell.fill = ZEBRA
        ws.row_dimensions[i].height = 48
    ws.freeze_panes = "A2"


def build_backlog(wb):
    ws = wb.create_sheet("Build Backlog")
    intro = ("Add every code-change idea here as you test. NOTHING triggers a rebuild on its own — "
             "we batch them and do ONE rebuild covering many fixes.")
    ws["A1"] = intro
    ws["A1"].font = Font(italic=True, color="555555")
    ws.merge_cells("A1:H1")
    ws.row_dimensions[1].height = 32

    headers = ["#", "Found in TC-ID", "Surface", "Problem (what user sees)", "Proposed change", "Native or JS-only?", "Status", "Notes"]
    set_widths(ws, [5, 14, 16, 50, 50, 18, 12, 30])
    for c_, h in enumerate(headers, start=1):
        ws.cell(row=2, column=c_, value=h)
    style_header(ws, 2, len(headers))
    for i in range(3, 60):
        for c_ in range(1, len(headers) + 1):
            cell = ws.cell(row=i, column=c_)
            cell.border = BORDER
            cell.alignment = CELL_ALIGN
            if i % 2 == 0:
                cell.fill = ZEBRA
    ws.freeze_panes = "A3"


def build_defects(wb):
    ws = wb.create_sheet("Defect Log")
    headers = ["DEF-ID", "TC-ID", "Severity", "Title", "Steps to reproduce", "Expected", "Actual", "Status", "Owner", "Found", "Fixed in", "Notes"]
    set_widths(ws, [9, 9, 12, 28, 40, 32, 32, 12, 14, 12, 14, 30])
    for c_, h in enumerate(headers, start=1):
        ws.cell(row=1, column=c_, value=h)
    style_header(ws, 1, len(headers))
    for i in range(2, 60):
        for c_ in range(1, len(headers) + 1):
            ws.cell(row=i, column=c_).border = BORDER
            ws.cell(row=i, column=c_).alignment = CELL_ALIGN
            if i % 2 == 0:
                ws.cell(row=i, column=c_).fill = ZEBRA
    ws.freeze_panes = "A2"


def build_signoff(wb):
    ws = wb.create_sheet("Sign-off")
    set_widths(ws, [40, 14, 14, 14, 14, 36])
    ws["A1"] = "Pilot Go-Live Sign-off"
    ws["A1"].font = Font(size=16, bold=True, color="0F6CF0")
    ws.merge_cells("A1:F1")

    headers = ["Group", "Pass", "Fail", "Blocked", "% Pass", "Tester / Date / Comment"]
    for c_, h in enumerate(headers, start=1):
        ws.cell(row=3, column=c_, value=h)
    style_header(ws, 3, len(headers))

    for i, g in enumerate(GROUPS, start=4):
        ws.cell(row=i, column=1, value=f"{g[0]} — {g[1]}")
        for c_ in range(1, len(headers) + 1):
            ws.cell(row=i, column=c_).border = BORDER
            ws.cell(row=i, column=c_).alignment = CELL_ALIGN
            if i % 2 == 0:
                ws.cell(row=i, column=c_).fill = ZEBRA

    base = 5 + len(GROUPS)
    ws.cell(row=base, column=1, value="Pilot approved for real users:").font = Font(bold=True)
    for r, label in [(base + 1, "Approver name"), (base + 2, "Signature"), (base + 3, "Date")]:
        ws.cell(row=r, column=1, value=label).alignment = Alignment(horizontal="right")
        ws.cell(row=r, column=2).border = BORDER


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

def main():
    wb = Workbook()
    wb.remove(wb.active)

    build_readme(wb)
    build_groups(wb)
    build_atomic(wb)
    build_field(wb)
    build_backlog(wb)
    build_defects(wb)
    build_signoff(wb)

    out = "docs/PILOT_TEST_PLAN.xlsx"
    wb.save(out)
    print(f"wrote {out}")
    print(f"  groups: {len(GROUPS)}")
    print(f"  atomic cases: {len(CASES)}")
    print(f"  field scenarios: {len(FIELD_DETAILS)}")


if __name__ == "__main__":
    main()

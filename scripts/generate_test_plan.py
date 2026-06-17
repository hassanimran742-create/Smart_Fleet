"""
Smart_Fleet pilot — generate the Excel test plan workbook.

Sheets:
  1. README          — how to use this workbook
  2. Test Groups     — batches that share setup; one group ≈ one sitting
  3. Atomic Cases    — the main test matrix (one observable outcome per row)
  4. Field Scenarios — tests that can ONLY be validated in real conditions
  5. Build Backlog   — fixes to bundle into the NEXT APK rebuild (saves rebuilds)
  6. Defect Log      — template
  7. Sign-off        — gate to "ready for real users"

Run from repo root:
    python3 scripts/generate_test_plan.py
Produces docs/PILOT_TEST_PLAN.xlsx
"""

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo


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
# Sheet 1 — README
# ---------------------------------------------------------------------------

def build_readme(wb):
    ws = wb.create_sheet("README")
    set_widths(ws, [4, 110])
    ws["A1"] = "Smart_Fleet — Pilot Test Plan"
    ws["A1"].font = Font(name="Calibri", size=18, bold=True, color="0F6CF0")
    ws.merge_cells("A1:B1")

    sections = [
        ("Purpose", [
            "Atomic test cases for the AWS pilot deployment (smartfleetpk.com).",
            "Every row = one observable outcome. Pass/fail is unambiguous.",
            "Designed to run grouped, not one-at-a-time, so you cover most features in the FEWEST APK rebuilds.",
        ]),
        ("How to use", [
            "1. Open the 'Test Groups' tab. Each group is one sitting (15–45 min) and is independent of every other group.",
            "2. Pick a group based on what you can test right now (e.g. distributor-only, or only when a driver is available).",
            "3. Run every Atomic Case in that group's range, marking Result + Actual.",
            "4. Anything that requires a code change goes into the 'Build Backlog' tab so it ships in the NEXT rebuild, not a new one each time.",
            "5. Field scenarios (the ones that need a real motorbike + sun + a damaged QR sticker) live in their own tab — schedule them.",
        ]),
        ("Why grouped this way", [
            "Each group shares 'setup state' — one login, one client, one order — and exercises many features off that shared state.",
            "Groups never depend on each other. You can run Group G (admin) without Groups A–F.",
            "Field groups (J, K) deliberately run LAST so all desk bugs are out of the way before motorbikes get involved.",
        ]),
        ("Reading OTPs in pilot (mock SMS)", [
            "EC2: sudo docker logs smartfleet-api-prod --since 2m | grep -A4 'OTP-MOCK'",
            "The 6-digit code is in the 'msg:' line. Codes expire in 5 minutes; only the most recent works.",
        ]),
        ("Test accounts (replace at go-live)", [
            "Super admin (web, password): +923000000000 / ChangeMe!Now123",
            "Branch admin  (web, password): +923000000001 / ChangeMe!Now123",
            "Distributor (mobile, OTP): +923001111111",
            "Driver      (mobile, OTP): +923002222222",
            "Walk-in client phone: +923009999999",
        ]),
        ("Severity legend", [
            "P0 (red)   — blocks pilot; must pass before letting any real user touch the system.",
            "P1 (amber) — should pass; workaround acceptable for ≤1 week.",
            "P2 (blue)  — nice-to-have; track but don't block.",
        ]),
        ("Outcome legend", [
            "PASS    — actual matches expected exactly.",
            "FAIL    — actual differs; write what you saw in 'Actual'.",
            "BLOCKED — couldn't run (e.g. waiting on a driver). Note why.",
            "N/A     — not applicable for this environment/build.",
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
# Sheet 2 — Test Groups
# ---------------------------------------------------------------------------

GROUPS = [
    {
        "id": "A", "name": "Cold-Start + Auth (admin + mobile)",
        "duration": "20 min", "where": "Desk", "needs": "Distributor APK installed, admin web reachable",
        "covers": "Login screens, OTP flow, password flow, token persistence, idle/explicit logout, negative auth, role isolation at login",
        "rebuild?": "No (run as-is)", "depends": "—",
    },
    {
        "id": "B", "name": "Distributor — Add Client + Address Search",
        "duration": "20 min", "where": "Desk", "needs": "Logged in as distributor",
        "covers": "Client form validation, duplicate prevention, address-search edge cases (English/Urdu/rural/urban), map-stub render, save-and-revisit",
        "rebuild?": "No", "depends": "A",
    },
    {
        "id": "C", "name": "Distributor — Place Order (matrix)",
        "duration": "30 min", "where": "Desk", "needs": "Group B done (at least 1 client), cylinder types seeded",
        "covers": "Cart math, single/multi-type orders, empty-return quantities, address autofill from client, submit, rejection paths",
        "rebuild?": "No", "depends": "B",
    },
    {
        "id": "D", "name": "Distributor — History, Track, Ledger, Inventory",
        "duration": "20 min", "where": "Desk", "needs": "≥3 orders from Group C",
        "covers": "Order history pagination/filters, tracking status flow, ledger entries, inventory counts, balance display, refresh behaviour",
        "rebuild?": "No", "depends": "C",
    },
    {
        "id": "E", "name": "Admin Web — Operations & Order Lifecycle",
        "duration": "30 min", "where": "Desk", "needs": "Orders from Group C",
        "covers": "Dashboard KPIs, order assignment, status transitions, role-restricted actions, distributor/driver/vehicle CRUD, live deliveries",
        "rebuild?": "No (admin web hot-deployable via S3 sync)", "depends": "C",
    },
    {
        "id": "F", "name": "Admin Web — Master Data CRUD",
        "duration": "30 min", "where": "Desk", "needs": "Admin login",
        "covers": "Cities, zones, stores, cylinder types, accessories, pricing rules, filling stations, drivers, vehicles. Create + edit + soft-delete each.",
        "rebuild?": "No", "depends": "—",
    },
    {
        "id": "G", "name": "Driver — Receive, Scan, Deliver, Return",
        "duration": "30 min", "where": "Desk first, then yard",
        "needs": "Driver APK installed (when ready), printed cylinder QR codes (use admin's QR generator), driver assigned to a vehicle",
        "covers": "Trip acceptance, sequential custody scans, proof photo upload, status transitions, location pings appearing in admin live map",
        "rebuild?": "Driver APK only (one-time)", "depends": "E (driver assigned)",
    },
    {
        "id": "H", "name": "Network Resilience",
        "duration": "20 min", "where": "Desk",
        "needs": "Distributor app + airplane-mode-capable phone",
        "covers": "Action on full offline, action on flaky/3G, server-side 5xx response, expired token mid-request, app behaviour when API is restarting",
        "rebuild?": "Defensive guards may queue → next rebuild", "depends": "B",
    },
    {
        "id": "I", "name": "Security & Permissions",
        "duration": "30 min", "where": "Desk",
        "needs": "Two distributor accounts, admin login, browser dev tools",
        "covers": "Cross-distributor data isolation, role-restricted endpoints reject wrong roles, token tampering rejected, S3 not publicly listable, OTP not leaked in prod, PII encrypted at rest",
        "rebuild?": "No (server-side)", "depends": "C, E",
    },
    {
        "id": "J", "name": "FIELD — Driver Day-in-the-Life",
        "duration": "≥1 work day", "where": "Real route on a motorbike",
        "needs": "Driver APK final build, real distributor, real customer (consenting test customer), real cylinder with real QR sticker",
        "covers": "Sun glare, dust, gloves, helmet ear-noise on notifications, GPS accuracy in tight alleys, battery drain over a shift, photo quality at dusk, custody-scan on a worn label, mobile signal drops between deliveries",
        "rebuild?": "Findings go into Build Backlog → batched into ONE rebuild at end of day", "depends": "G",
    },
    {
        "id": "K", "name": "FIELD — Distributor Operations",
        "duration": "≥1 work day", "where": "Real shop",
        "needs": "Distributor APK final build, real customer phone numbers (with consent)",
        "covers": "Phone-input ergonomics on cheap Androids, OTP delivery delay perception, order entry under customer time-pressure, screen visibility under tube light, back-button confusion, network handoff WiFi↔SIM",
        "rebuild?": "Same as Group J", "depends": "C",
    },
    {
        "id": "L", "name": "Multi-Day Soak + OTA",
        "duration": "3–5 days elapsed", "where": "Desk + field",
        "needs": "All apps installed and in use; one OTA fix scheduled in the middle",
        "covers": "Refresh token rollover, day-boundary edge cases (orders crossing midnight), OTA update delivery + auto-apply, log noise & alarm health, cost steady at ~$0/day",
        "rebuild?": "Test OTAs without rebuild; one rebuild at end if anything native broke", "depends": "G, J",
    },
]


def build_groups(wb):
    ws = wb.create_sheet("Test Groups")
    headers = ["Group", "Name", "Duration", "Where", "Pre-requirements", "What it covers", "Rebuild needed?", "Depends on"]
    set_widths(ws, [7, 32, 12, 18, 36, 70, 30, 12])
    for c, h in enumerate(headers, start=1):
        ws.cell(row=1, column=c, value=h)
    style_header(ws, 1, len(headers))

    for i, g in enumerate(GROUPS, start=2):
        row = [g["id"], g["name"], g["duration"], g["where"], g["needs"], g["covers"], g["rebuild?"], g["depends"]]
        for c, v in enumerate(row, start=1):
            cell = ws.cell(row=i, column=c, value=v)
            cell.alignment = CELL_ALIGN
            cell.border = BORDER
            if i % 2 == 0:
                cell.fill = ZEBRA
            if g["id"] in ("J", "K"):
                cell.font = Font(color="A23A1A", bold=True if c == 1 else False)
        ws.row_dimensions[i].height = 60

    ws.freeze_panes = "A2"


# ---------------------------------------------------------------------------
# Sheet 3 — Atomic Cases
# ---------------------------------------------------------------------------

CASES = [
    # ----- GROUP A: Cold-Start + Auth -----
    ("A01", "A", "P0", "Auth", "Admin web", "Admin web loads without console errors",
        "Browser cache cleared; production URL up.",
        "1. Open https://admin.smartfleetpk.com 2. Open DevTools → Console.",
        "Login screen renders; no red console errors; bundle filename in Network ≠ a stale broken one.",
        "Admin web", "Positive"),
    ("A02", "A", "P0", "Auth", "Admin web", "Super-admin signs in with valid password",
        "Seed run; default password ChangeMe!Now123 known.",
        "1. Enter +923000000000 + correct password 2. Submit.",
        "Lands in Dashboard within 3s; sidebar visible.",
        "Admin web", "Positive"),
    ("A03", "A", "P0", "Auth", "Admin web", "Wrong password is rejected with same message every time",
        "—",
        "Try (a) wrong password (b) unknown phone +923444444444 (c) blank password.",
        "All three return the exact same 'Invalid phone or password' (no enumeration leak); no dashboard.",
        "Admin web", "Negative"),
    ("A04", "A", "P1", "Auth", "Admin web", "Distributor phone with any password is rejected with role hint",
        "+923001111111 exists as DISTRIBUTOR.",
        "Sign in with +923001111111 + any password.",
        "Server returns 'must sign in with a one-time code, not a password'. Login fails.",
        "Admin web", "Negative"),
    ("A05", "A", "P1", "Auth", "Admin web", "Token persists across browser refresh",
        "Logged in as super-admin.",
        "Reload the tab (Ctrl+R).",
        "Still on Dashboard; no re-login required.",
        "Admin web", "Positive"),
    ("A06", "A", "P1", "Auth", "Admin web", "Explicit logout clears token + returns to login",
        "Logged in.",
        "Click Logout from sidebar/profile menu.",
        "Login screen shown; refreshing does not auto-login.",
        "Admin web", "Positive"),
    ("A07", "A", "P2", "Auth", "Admin web", "Idle logout after configured timeout",
        "Logged in. Site sets 10-min idle.",
        "Leave the tab focused but untouched for >10 min (cheat by editing the constant in dev if testing in <10).",
        "Auto-redirects to login.",
        "Admin web", "Edge"),
    ("A08", "A", "P0", "Auth", "Distributor app", "OTP send returns success",
        "Distributor user +923001111111 exists and is ACTIVE.",
        "Open app → enter +923001111111 → Send OTP.",
        "App shows 'code sent' state; logs on EC2 show an OTP-MOCK block for +923001111111.",
        "Distributor app", "Positive"),
    ("A09", "A", "P0", "Auth", "Distributor app", "OTP verify with fresh code succeeds",
        "A09 immediately after A08 (within 5 min).",
        "Read code from logs → enter → submit.",
        "Lands in distributor home; bottom tabs/main screen visible.",
        "Distributor app", "Positive"),
    ("A10", "A", "P1", "Auth", "Distributor app", "Stale OTP is rejected",
        "Wait >5 min after a send, or send a NEW OTP then try the OLD code.",
        "Submit the older code.",
        "Error 'OTP expired or not found' OR 'Invalid code'; not logged in.",
        "Distributor app", "Negative"),
    ("A11", "A", "P1", "Auth", "Distributor app", "Rate limit kicks in after 3 sends in 60s",
        "Fresh phone with no recent OTPs.",
        "Tap Send OTP four times within 30s.",
        "4th request returns 'Too many OTP requests'; client shows error.",
        "Distributor app", "Negative"),
    ("A12", "A", "P1", "Auth", "Distributor app", "Login state survives app cold-start",
        "Logged in.",
        "Force-stop the app, reopen.",
        "Back on home screen without re-OTP.",
        "Distributor app", "Positive"),
    ("A13", "A", "P1", "Auth", "Driver app", "Driver OTP login (same flow as distributor)",
        "+923002222222 exists as DRIVER with Driver profile.",
        "Repeat A08–A09 with driver phone using driver APK.",
        "Lands in driver home; trip queue/idle state visible.",
        "Driver app", "Positive"),

    # ----- GROUP B: Distributor — Clients -----
    ("B01", "B", "P0", "Clients", "Distributor app", "Add Client screen opens without crash",
        "Logged in.",
        "Tap Add Client.",
        "Form opens; MapStub card visible where map used to be; no white screen / no app exit.",
        "Distributor app", "Positive"),
    ("B02", "B", "P0", "Clients", "Distributor app", "Save a valid client",
        "Add Client open.",
        "Name='Asma Naveed', Phone='+923211234567', Area='G-13', City='Islamabad', address search → pick a suggestion. Save.",
        "Toast/success; client appears in client list.",
        "Distributor app", "Positive"),
    ("B03", "B", "P1", "Clients", "Distributor app", "Phone is validated as E.164",
        "Add Client open.",
        "Type '03001234567' (no country code) → Save.",
        "Inline error or rejection; not saved.",
        "Distributor app", "Negative"),
    ("B04", "B", "P1", "Clients", "Distributor app", "Address search returns Pakistani results",
        "Add Client open, search field focused.",
        "Type 'F-7 Markaz Islamabad'.",
        "Suggestions appear within ~3s; pick top → lat/lng visible in marker card.",
        "Distributor app", "Positive"),
    ("B05", "B", "P2", "Clients", "Distributor app", "Address search handles ambiguous query gracefully",
        "—",
        "Search 'abc'.",
        "Either no results message OR an empty list; no crash, no infinite spinner.",
        "Distributor app", "Edge"),
    ("B06", "B", "P1", "Clients", "Distributor app", "Duplicate phone is prevented",
        "Client from B02 saved.",
        "Add another client with same phone.",
        "Server rejects with a clear error; UI shows it.",
        "Distributor app", "Negative"),
    ("B07", "B", "P1", "Clients", "Distributor app", "Saved client persists across app restart",
        "B02 done.",
        "Force-stop app → reopen → go to client list.",
        "Client still listed.",
        "Distributor app", "Positive"),
    ("B08", "B", "P2", "Clients", "Distributor app", "Client list searchable by name and phone",
        "≥3 clients in list.",
        "Type partial name; then partial phone.",
        "Filtered results match; clearing search restores list.",
        "Distributor app", "Positive"),

    # ----- GROUP C: Distributor — Place Order -----
    ("C01", "C", "P0", "Orders", "Distributor app", "New Order screen opens",
        "Logged in; ≥1 client + 4 cylinder types seeded.",
        "Tap New Order.",
        "'Who' step shows; client search field focused; no crash.",
        "Distributor app", "Positive"),
    ("C02", "C", "P0", "Orders", "Distributor app", "Order with one cylinder type submits",
        "C01.",
        "Search 'Walk' → pick Walk-in Customer; address autofill OR re-search; cylinder 'LPG 11.8 kg' qty=1, empty-return=0; Submit.",
        "Success screen; new order id printed; appears in My Orders as PENDING.",
        "Distributor app", "Positive"),
    ("C03", "C", "P0", "Orders", "Distributor app", "Order with multiple cylinder types",
        "—",
        "Add LPG 11.8 (qty 2), LPG 6 (qty 1); empties returned = 1 of LPG 11.8. Submit.",
        "Single order created with 2 lines; quantities exactly as entered in My Orders detail.",
        "Distributor app", "Positive"),
    ("C04", "C", "P1", "Orders", "Distributor app", "Cart math: increment / decrement / remove",
        "Cart with mixed items.",
        "+/- buttons; remove a line; re-add same type.",
        "On-screen totals stay consistent with what you submit. No negative quantities.",
        "Distributor app", "Edge"),
    ("C05", "C", "P0", "Orders", "Distributor app", "Cannot submit empty cart",
        "Cart empty.",
        "Try Submit.",
        "Submit disabled or rejected with a message; no order created.",
        "Distributor app", "Negative"),
    ("C06", "C", "P1", "Orders", "Distributor app", "Cannot submit with no client",
        "Cart has items, client step skipped.",
        "Try Submit.",
        "Blocked; prompt to pick a client.",
        "Distributor app", "Negative"),
    ("C07", "C", "P1", "Orders", "Distributor app", "Address picked from address search saves on the order",
        "—",
        "Place an order using a different address than the client's default.",
        "Admin web Orders detail shows the picked address, not the client's default.",
        "Distributor app", "Positive"),
    ("C08", "C", "P1", "Orders", "Distributor app", "Back navigation does not lose cart",
        "Cart with 2 items.",
        "Back to 'Who' step; pick a different client; come forward.",
        "Cart intact (or behaviour matches expected design); no orphan order.",
        "Distributor app", "Edge"),
    ("C09", "C", "P2", "Orders", "Distributor app", "Submit while network drops",
        "Cart ready; toggle airplane mode at moment of Submit.",
        "Tap Submit with airplane mode on.",
        "Clear error; no half-created order on server; retry succeeds after reconnect.",
        "Distributor app", "Edge"),

    # ----- GROUP D: Distributor — History / Track / Ledger / Inventory -----
    ("D01", "D", "P0", "History", "Distributor app", "Order History lists today's orders",
        "≥3 orders placed today.",
        "Open Order History.",
        "All 3 visible, newest first; correct status badges.",
        "Distributor app", "Positive"),
    ("D02", "D", "P1", "History", "Distributor app", "Pull-to-refresh updates state",
        "Admin changes one order's status in web.",
        "Pull down to refresh in app.",
        "Status updates without app restart.",
        "Distributor app", "Positive"),
    ("D03", "D", "P0", "Track", "Distributor app", "Track Order screen opens without map crash",
        "Tap an active order.",
        "Open Track.",
        "Screen renders; MapStub card visible; no app exit.",
        "Distributor app", "Positive"),
    ("D04", "D", "P1", "Ledger", "Distributor app", "Ledger entries reflect order activity",
        "Pricing rules configured (admin) → otherwise mark N/A.",
        "Open Ledger.",
        "Entries present for placed orders OR explicit 'no activity' state; balance arithmetic correct.",
        "Distributor app", "Positive"),
    ("D05", "D", "P1", "Inventory", "Distributor app", "Inventory shows current full/empty counts",
        "Custody seeded or after Group G.",
        "Open Inventory.",
        "Counts shown by cylinder type; refresh consistent with admin view.",
        "Distributor app", "Positive"),

    # ----- GROUP E: Admin Web Operations -----
    ("E01", "E", "P0", "Dashboard", "Admin web", "KPI tiles populate",
        "Seed + Groups C ran.",
        "Open Dashboard.",
        "Tiles render (zero or non-zero values), no console errors.",
        "Admin web", "Positive"),
    ("E02", "E", "P0", "Dashboard", "Admin web", "Recent orders include the latest distributor order",
        "Place an order in app, wait <30s.",
        "Refresh Dashboard.",
        "Order id matches; correct distributor + client + status PENDING.",
        "Admin web", "Positive"),
    ("E03", "E", "P0", "Orders", "Admin web", "Assign order to driver",
        "Order PENDING; driver record exists.",
        "Open order → Assign → pick driver → Save.",
        "Status changes to ASSIGNED; driver attached; activity log updated.",
        "Admin web", "Positive"),
    ("E04", "E", "P1", "Orders", "Admin web", "Illegal status jump rejected by API",
        "Order PENDING.",
        "Use dev tools or admin UI to push status DELIVERED directly.",
        "Server rejects with a clear error; order stays PENDING.",
        "Admin web", "Negative"),
    ("E05", "E", "P1", "Orders", "Admin web", "Cancel order updates status",
        "Order PENDING.",
        "Cancel from admin web.",
        "Status CANCELLED; reflected in distributor app on refresh.",
        "Admin web", "Positive"),
    ("E06", "E", "P1", "Live", "Admin web", "Live Deliveries screen loads",
        "—",
        "Open Live screen.",
        "Map area + driver list render; no console errors. (Driver markers may be empty if no drivers online.)",
        "Admin web", "Positive"),
    ("E07", "E", "P1", "Live", "Admin web", "Driver location appears when driver is online",
        "Group G running.",
        "Driver online → admin watches.",
        "Marker appears within ~30s and updates as driver moves.",
        "Admin web", "Positive"),
    ("E08", "E", "P2", "Live", "Admin web", "Tab away + return reconnects socket",
        "Live screen open with driver online.",
        "Switch tabs for 1 min; return.",
        "Socket reconnects; latest location shown.",
        "Admin web", "Edge"),

    # ----- GROUP F: Master Data CRUD -----
    ("F01", "F", "P0", "Cities", "Admin web", "List cities (seeded)",
        "Seed ran.",
        "Open Cities.",
        "Islamabad / Rawalpindi / Lahore / Karachi visible.",
        "Admin web", "Positive"),
    ("F02", "F", "P1", "Zones", "Admin web", "Create a zone with a polygon",
        "City exists.",
        "New Zone → name → draw polygon → save.",
        "Zone saved with PostGIS polygon; appears on map.",
        "Admin web", "Positive"),
    ("F03", "F", "P1", "Stores", "Admin web", "Create a store under a zone",
        "Zone from F02.",
        "New Store → fill fields → Save.",
        "Store listed; assignable to drivers/orders.",
        "Admin web", "Positive"),
    ("F04", "F", "P0", "Cylinder types", "Admin web", "Cylinder types editable",
        "Seed types exist.",
        "Edit a type's display name.",
        "Saved; updated name shows in distributor app after refresh.",
        "Admin web", "Positive"),
    ("F05", "F", "P1", "Pricing", "Admin web", "Create a pricing rule",
        "City + cylinder type exist.",
        "Pricing → New Rule → set price.",
        "Rule listed; later orders use it.",
        "Admin web", "Positive"),
    ("F06", "F", "P1", "Vehicles", "Admin web", "Create a vehicle and assign driver",
        "Driver exists.",
        "Vehicles → New → plate / capacity → assign driver.",
        "Vehicle + assignment saved; visible in Driver detail.",
        "Admin web", "Positive"),
    ("F07", "F", "P1", "Drivers", "Admin web", "Edit driver (e.g. set availability)",
        "Driver record.",
        "Edit availability ON_LEAVE; save.",
        "Persists; dispatcher view reflects it.",
        "Admin web", "Positive"),
    ("F08", "F", "P1", "Distributors", "Admin web", "Suspend a distributor",
        "Distributor record.",
        "Suspend.",
        "Suspended distributor cannot place new orders on mobile (returns auth/role error).",
        "Admin web", "Edge"),
    ("F09", "F", "P2", "Accessories", "Admin web", "List + create accessory",
        "Seed accessories present.",
        "Create a new accessory.",
        "Saved; listed; pricing assignable.",
        "Admin web", "Positive"),
    ("F10", "F", "P2", "Filling stations", "Admin web", "Create a filling station",
        "—",
        "New filling station.",
        "Saved + listed.",
        "Admin web", "Positive"),

    # ----- GROUP G: Driver — Trip + Custody + Delivery -----
    ("G01", "G", "P0", "Driver", "Driver app", "Driver sees assigned trip",
        "E03 happened (order ASSIGNED).",
        "Open driver app.",
        "Assigned trip listed; tapping opens its details.",
        "Driver app", "Positive"),
    ("G02", "G", "P0", "Custody", "Driver app", "Scan cylinder QR at store pickup",
        "Printed test QR sticker generated by admin's QR generator.",
        "Open camera; scan the QR.",
        "Custody event created (VEHICLE); count increments.",
        "Driver app", "Positive"),
    ("G03", "G", "P0", "Custody", "Driver app", "Scan unrecognized QR is rejected",
        "Random QR.",
        "Scan a non-Smart_Fleet QR.",
        "Inline error 'not recognized'; no custody event created.",
        "Driver app", "Negative"),
    ("G04", "G", "P1", "Custody", "Driver app", "Re-scan of the same cylinder is debounced",
        "Cylinder already VEHICLE.",
        "Scan it again.",
        "No duplicate event OR a clear 'already in custody' message.",
        "Driver app", "Edge"),
    ("G05", "G", "P0", "Delivery", "Driver app", "Mark delivered + capture proof photo",
        "At delivery step.",
        "Capture proof photo → confirm.",
        "Photo uploads to S3 (smartfleet-files-prod) — verify in admin order detail.",
        "Driver app", "Positive"),
    ("G06", "G", "P0", "Delivery", "Driver app", "Delivered status reflects on distributor + admin",
        "After G05.",
        "Refresh distributor + admin views.",
        "Order status DELIVERED everywhere within ~30s.",
        "Distributor app / Admin web", "Positive"),
    ("G07", "G", "P1", "Custody", "Driver app", "Pick up empty cylinder back to vehicle",
        "Customer hands over empty cylinder QR.",
        "Scan empty in.",
        "Custody event captures empty; counts adjust.",
        "Driver app", "Positive"),
    ("G08", "G", "P1", "Trip", "Driver app", "End trip / return to store",
        "All stops complete.",
        "Mark trip complete.",
        "Trip COMPLETED; driver shows AVAILABLE again on admin.",
        "Driver app", "Positive"),
    ("G09", "G", "P1", "Location", "Driver app", "Live location pings reach admin",
        "Driver online + permission granted.",
        "Walk around for 60s.",
        "Admin Live screen marker moves; data points stored.",
        "Driver app + Admin web", "Positive"),

    # ----- GROUP H: Network Resilience -----
    ("H01", "H", "P1", "Network", "Distributor app", "Action on full offline shows friendly error",
        "Distributor logged in.",
        "Airplane mode ON → Send OTP/Place Order.",
        "Specific 'no connection' message; UI not stuck on spinner; no crash.",
        "Distributor app", "Edge"),
    ("H02", "H", "P1", "Network", "Distributor app", "Slow 3G doesn't hang the app",
        "Throttle to ~150 kbps using phone's slow-network shortcut OR a known weak-signal location.",
        "Open List screens.",
        "Skeleton/spinner shown; eventually loads; no white screen.",
        "Distributor app", "Edge"),
    ("H03", "H", "P1", "Network", "Distributor app", "5xx from server shown clearly",
        "Restart api-prod container while screen loads.",
        "Trigger a list fetch during restart.",
        "Error message + Retry button; no app exit.",
        "Distributor app", "Edge"),
    ("H04", "H", "P1", "Auth", "Distributor app", "Expired token triggers re-login",
        "Tamper with stored token to expire it (dev only) OR wait past JWT TTL.",
        "Trigger any authed call.",
        "App redirects to login OR refreshes token silently and continues.",
        "Distributor app", "Edge"),
    ("H05", "H", "P0", "Resilience", "EC2", "Container crash auto-restarts",
        "SSH to EC2.",
        "sudo docker kill smartfleet-api-prod",
        "Container restarts within ~2s; /health/live returns ok within 10s.",
        "API", "Edge"),
    ("H06", "H", "P1", "Resilience", "EC2", "After EC2 reboot, system is fully serving without manual steps",
        "SSH access.",
        "sudo reboot, wait, retest API + admin web + app.",
        "All come back: Caddy HTTPS, containers up, app reconnects.",
        "API + Admin web + Apps", "Edge"),

    # ----- GROUP I: Security & Permissions -----
    ("I01", "I", "P0", "Sec", "API", "Cross-distributor isolation",
        "Two distributors A and B with their own clients.",
        "Log in as A, hit /clients with A's token; then with B's token.",
        "Each sees only their own clients; no overlap.",
        "API", "Negative"),
    ("I02", "I", "P0", "Sec", "API", "Role-restricted endpoint rejects wrong role",
        "Distributor token in hand.",
        "Call POST /orders/{id}/assign with distributor token.",
        "403 Forbidden.",
        "API", "Negative"),
    ("I03", "I", "P0", "Sec", "API", "Tampered JWT rejected",
        "Valid token.",
        "Flip one character in the signature; call /auth/me.",
        "401 Unauthorized; no role escalation.",
        "API", "Negative"),
    ("I04", "I", "P0", "Sec", "S3", "S3 bucket cannot be listed publicly",
        "Bucket name.",
        "Open https://smartfleet-files-prod.s3.ap-southeast-1.amazonaws.com/ in incognito.",
        "AccessDenied. (Files accessible only via app/pre-signed URLs.)",
        "S3", "Negative"),
    ("I05", "I", "P0", "Sec", "API", "OTP NOT leaked in prod response",
        "—",
        "POST /auth/otp/send with phone in prod; inspect response.",
        "Body is {ok:true} ONLY (no devCode). Compare to staging which DOES return devCode.",
        "API", "Positive"),
    ("I06", "I", "P1", "Sec", "DB", "PII encrypted at rest",
        "SSH access; one user has CNIC stored.",
        "Query users.cnic_encrypted in RDS.",
        "Column is binary ciphertext, NOT readable plaintext.",
        "DB", "Positive"),
    ("I07", "I", "P1", "Sec", "API", "Suspended user cannot authenticate",
        "Suspend +923001111111 from admin.",
        "Try mobile OTP login.",
        "Login refused with 'Account not active' (or equivalent).",
        "API", "Negative"),

    # ----- GROUP J: FIELD — Driver -----
    ("J01", "J", "P0", "Field", "Driver app", "App readable in direct midday sun",
        "Real driver on bike, midday.",
        "Read trip details + scan QR.",
        "Driver can read screen without shading; if not, raise UI contrast issue.",
        "Driver app", "Field"),
    ("J02", "J", "P0", "Field", "Driver app", "QR scan on a worn / sun-faded sticker",
        "Cylinder used for ~1 month with sticker outside.",
        "Scan it.",
        "Either reads OR shows a clear 'try again with light/closer' guidance.",
        "Driver app", "Field"),
    ("J03", "J", "P0", "Field", "Driver app", "Photo proof at dusk / low light",
        "Real delivery at ~7pm.",
        "Capture proof.",
        "Photo legible OR app prompts to use torch; uploads succeed.",
        "Driver app", "Field"),
    ("J04", "J", "P0", "Field", "Driver app", "Battery drain over a 4-hour shift with location ON",
        "Start at 100% battery; driver app foreground/background.",
        "Use the app for 4 hours.",
        "Battery drop ≤40% on a typical mid-range Android. Anything worse is a P1.",
        "Driver app", "Field"),
    ("J05", "J", "P1", "Field", "Driver app", "Backgrounded app continues to report location",
        "Driver on the move; app in background.",
        "Watch admin live map.",
        "Location continues updating for at least 15 min in background.",
        "Driver app + Admin web", "Field"),
    ("J06", "J", "P1", "Field", "Driver app", "Mobile signal cuts in narrow alley → recovers",
        "Known dead-zone street.",
        "Pass through.",
        "App holds the trip in memory, syncs scans/photos automatically when signal returns.",
        "Driver app", "Field"),
    ("J07", "J", "P1", "Field", "Driver app", "Notifications heard with helmet on / loud street",
        "Helmet + bike sounds.",
        "Receive a new order while riding.",
        "Either sound is loud enough OR vibration is detectable on grip; or add a startup tip.",
        "Driver app", "Field"),
    ("J08", "J", "P1", "Field", "Driver app", "Glove-friendly buttons",
        "Driver wears riding gloves.",
        "Tap key buttons.",
        "All primary actions tappable; no double-tap required.",
        "Driver app", "Field"),
    ("J09", "J", "P2", "Field", "Driver app", "GPS accuracy in dense urban",
        "Run past 6-storey buildings in Karachi/Lahore.",
        "Compare app marker to real position.",
        "Drift ≤30m most of the time. Anything wilder → flag for future fix.",
        "Driver app", "Field"),

    # ----- GROUP K: FIELD — Distributor -----
    ("K01", "K", "P0", "Field", "Distributor app", "Phone-input ergonomics on a cheap Android",
        "Test on a Rs. 25k Android (e.g. Vivo Y02 / Tecno).",
        "Place an order under shop noise.",
        "Form usable; no frame drops; full flow completes in ≤90s.",
        "Distributor app", "Field"),
    ("K02", "K", "P0", "Field", "Distributor app", "Reading OTP under tube light + dusty shop",
        "Real distributor shop.",
        "Distributor receives + reads OTP. (For pilot OTP comes via separate channel.)",
        "Distributor can complete login within 60s of clicking Send.",
        "Distributor app", "Field"),
    ("K03", "K", "P1", "Field", "Distributor app", "Order entry under customer time-pressure",
        "Customer at counter waiting.",
        "Place order while talking to customer.",
        "Distributor does not get blocked by validation; flow completes <60s.",
        "Distributor app", "Field"),
    ("K04", "K", "P1", "Field", "Distributor app", "Switch WiFi ↔ mobile data mid-action",
        "Shop has both.",
        "Begin order on WiFi; walk out (loses WiFi) before Submit.",
        "App seamlessly continues over cellular; order saved correctly.",
        "Distributor app", "Field"),
    ("K05", "K", "P2", "Field", "Distributor app", "Back-button confusion",
        "Distributor unfamiliar with Android nav.",
        "Hand them the device, ask to place an order.",
        "No 'I'm lost' moments; if they get stuck twice, raise a UI issue.",
        "Distributor app", "Field"),
    ("K06", "K", "P1", "Field", "Distributor app", "After full work day, app still responsive",
        "Distributor places ≥30 orders over a day.",
        "End-of-day open app.",
        "No noticeable slowdown; lists render in <2s.",
        "Distributor app", "Field"),

    # ----- GROUP L: Soak + OTA -----
    ("L01", "L", "P1", "Soak", "Apps", "Token still valid next morning",
        "Logged in, leave overnight.",
        "Reopen 12h later.",
        "Either still logged in OR refresh-token flow runs silently.",
        "Apps", "Edge"),
    ("L02", "L", "P0", "OTA", "Distributor app", "EAS Update with a small JS change is picked up",
        "Push a benign change (e.g. version label).",
        "Run eas update --branch distributor-production; close + reopen app.",
        "New change visible; old crash not back; runtime version match confirmed.",
        "Distributor app", "Positive"),
    ("L03", "L", "P1", "Cost", "AWS Console", "Day-over-day actual cost ≈ $0",
        "—",
        "Billing → Bills, daily.",
        "MTD actual cost stays under $1 even with active use; matches free-tier expectations.",
        "AWS", "Positive"),
    ("L04", "L", "P1", "Logs", "CloudWatch", "Errors don't drown the log group",
        "—",
        "CloudWatch /smartfleet/prod — daily glance.",
        "<5 GB ingest/month overall; no recurring noisy error pattern.",
        "CloudWatch", "Positive"),
    ("L05", "L", "P1", "Alarms", "CloudWatch", "Alarms are not in ALARM state long-term",
        "—",
        "describe-alarms --alarm-name-prefix smartfleet-.",
        "All OK or INSUFFICIENT_DATA; nothing chronic in ALARM.",
        "CloudWatch", "Positive"),
    ("L06", "L", "P2", "Day boundary", "Apps", "Orders crossing midnight handled",
        "Place an order at 11:55 PM, deliver at 12:05 AM.",
        "Inspect timestamps + 'Delivered today' KPI.",
        "Delivered-today reflects the actual local date of delivery; no off-by-one.",
        "Apps + Admin web", "Edge"),
]


def build_atomic(wb):
    ws = wb.create_sheet("Atomic Cases")
    headers = [
        "TC-ID", "Group", "Priority", "Area", "Surface", "Test Case",
        "Pre-condition", "Steps", "Expected Outcome",
        "Tested on", "Type",
        "Result (PASS/FAIL/BLOCKED/NA)", "Actual Result", "Defect ID",
        "Tester", "Date", "Notes",
    ]
    set_widths(ws, [9, 8, 10, 14, 14, 38, 30, 50, 50, 20, 12, 18, 28, 12, 14, 12, 24])
    for c, h in enumerate(headers, start=1):
        ws.cell(row=1, column=c, value=h)
    style_header(ws, 1, len(headers))

    row = 2
    current_group = None
    for tc in CASES:
        tc_id, group, prio, area, surface, name, pre, steps, expected, tested_on, ttype = tc
        if group != current_group:
            current_group = group
            # group header row
            label = next(g["name"] for g in GROUPS if g["id"] == group)
            cell = ws.cell(row=row, column=1, value=f"Group {group} — {label}")
            cell.fill = GROUP_HEADER_FILL
            cell.font = GROUP_HEADER_FONT
            cell.alignment = Alignment(vertical="center")
            ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=len(headers))
            ws.row_dimensions[row].height = 22
            row += 1

        values = [tc_id, group, prio, area, surface, name, pre, steps, expected, tested_on, ttype,
                  "", "", "", "", "", ""]
        for c, v in enumerate(values, start=1):
            cell = ws.cell(row=row, column=c, value=v)
            cell.alignment = CELL_ALIGN
            cell.border = BORDER
            if c == 3 and prio in PRIORITY_FILLS:
                cell.fill = PRIORITY_FILLS[prio]
        ws.row_dimensions[row].height = 60
        row += 1

    ws.freeze_panes = "F2"  # freeze ID/Group/Priority/Area/Surface columns


# ---------------------------------------------------------------------------
# Sheet 4 — Field Scenarios (deep dive on the J/K stuff)
# ---------------------------------------------------------------------------

FIELD = [
    ("FS-01", "Sun glare on screen", "Drivers + distributors during 11am–4pm",
        "Take both apps outside in direct sun. Time how long to find the next-step button.",
        "Define brightness/contrast acceptable; if ≥1 user struggles ≥3 times → P1 fix."),
    ("FS-02", "Dust on camera lens", "Driver bike rider",
        "Don't wipe lens. Take 5 proof photos through dust.",
        "Photos legible OR app prompts to wipe lens."),
    ("FS-03", "Worn / faded QR sticker", "Real cylinders after 1+ month outdoor use",
        "Scan deliberately damaged QRs.",
        "App reads ≥80% of attempts. <80% → improve sticker material or QR error-correction level."),
    ("FS-04", "Background location while screen off", "Driver app",
        "Lock the phone for 15 min while moving.",
        "Admin live map keeps receiving pings during that 15 min."),
    ("FS-05", "Helmet + bike noise on notifications", "Driver",
        "Push a new-assignment notification while riding.",
        "Either heard via Bluetooth helmet speaker OR seen on next stop. Else add vibration pattern."),
    ("FS-06", "Glove-friendly tap targets", "Driver wearing summer gloves",
        "Tap every primary action (scan, capture, mark delivered).",
        "All hit on first attempt. Else raise minimum tap-target size."),
    ("FS-07", "Cheap-Android performance", "Distributor on Rs. 20–30k device",
        "Test on at least one budget Android (e.g. Infinix Smart 8, Vivo Y02).",
        "Order flow under 90s end-to-end. List screens under 2s on cached data."),
    ("FS-08", "Network handoff WiFi↔SIM", "Distributor walking out of shop",
        "Mid-action, walk past WiFi range.",
        "Ongoing request retries / completes; no orphan state."),
    ("FS-09", "Battery drain over a real shift", "Driver, 4 hours",
        "Start at 100% with location ON.",
        "End ≥60%. If <60%, throttle location ping rate."),
    ("FS-10", "Dead-zone tolerance", "Driver in a known signal black spot",
        "Place actions inside black spot.",
        "App queues or shows offline; recovers on signal return."),
    ("FS-11", "OTP delivery perception", "Real distributor in pilot",
        "Watch them log in 5 times across a week.",
        "All complete <60s from Send to Verify. Frustration index logged."),
    ("FS-12", "Confused-user think-aloud", "Brand-new distributor",
        "Ask them to place an order with no help.",
        "Time + count of 'stuck moments'. >2 stuck moments → UI issue → backlog."),
    ("FS-13", "Photo upload on weak 3G", "Driver in rural area",
        "Try proof photo at 3G.",
        "Upload completes <60s or queues for retry. App stays usable."),
    ("FS-14", "Multiple drivers on live map", "Run 3 driver devices concurrently",
        "All online, moving.",
        "Admin map shows all 3 markers updating; no lag >5s."),
    ("FS-15", "Push notification delivery", "Driver phone with app backgrounded",
        "Admin assigns 5 orders over 30 min.",
        "All 5 push notifications received within ≤30s of assignment."),
]


def build_field(wb):
    ws = wb.create_sheet("Field Scenarios")
    headers = ["FS-ID", "Scenario", "Who tests it", "How", "Pass criteria", "Result", "Notes / device", "Tester", "Date"]
    set_widths(ws, [9, 32, 24, 50, 60, 16, 30, 14, 12])
    for c, h in enumerate(headers, start=1):
        ws.cell(row=1, column=c, value=h)
    style_header(ws, 1, len(headers))
    for i, row in enumerate(FIELD, start=2):
        for c, v in enumerate(row, start=1):
            cell = ws.cell(row=i, column=c, value=v)
            cell.alignment = CELL_ALIGN
            cell.border = BORDER
            if i % 2 == 0:
                cell.fill = ZEBRA
        # blank result/notes/tester/date
        for c in range(6, 10):
            ws.cell(row=i, column=c).border = BORDER
        ws.row_dimensions[i].height = 50
    ws.freeze_panes = "A2"


# ---------------------------------------------------------------------------
# Sheet 5 — Build Backlog
# ---------------------------------------------------------------------------

def build_backlog(wb):
    ws = wb.create_sheet("Build Backlog")
    intro = (
        "Add every code-change idea here as you test. NOTHING triggers a rebuild on its own — "
        "we batch them, then do ONE rebuild that covers all of them."
    )
    ws["A1"] = intro
    ws["A1"].font = Font(italic=True, color="555555")
    ws.merge_cells("A1:H1")
    ws.row_dimensions[1].height = 32

    headers = ["#", "Found in TC-ID", "Surface", "Problem (what user sees)", "Proposed change", "Native or JS-only?", "Status", "Notes"]
    set_widths(ws, [5, 14, 16, 50, 50, 18, 12, 30])
    for c, h in enumerate(headers, start=1):
        ws.cell(row=2, column=c, value=h)
    style_header(ws, 2, len(headers))
    # blank rows ready to fill
    for i in range(3, 33):
        for c in range(1, len(headers) + 1):
            cell = ws.cell(row=i, column=c)
            cell.border = BORDER
            cell.alignment = CELL_ALIGN
        if i % 2 == 0:
            for c in range(1, len(headers) + 1):
                ws.cell(row=i, column=c).fill = ZEBRA
    ws.freeze_panes = "A3"


# ---------------------------------------------------------------------------
# Sheet 6 — Defect Log
# ---------------------------------------------------------------------------

def build_defects(wb):
    ws = wb.create_sheet("Defect Log")
    headers = ["DEF-ID", "TC-ID", "Severity (P0/P1/P2)", "Title", "Steps to reproduce", "Expected", "Actual", "Status", "Owner", "Found", "Fixed in", "Notes"]
    set_widths(ws, [9, 9, 14, 28, 40, 32, 32, 12, 14, 12, 14, 30])
    for c, h in enumerate(headers, start=1):
        ws.cell(row=1, column=c, value=h)
    style_header(ws, 1, len(headers))
    for i in range(2, 32):
        for c in range(1, len(headers) + 1):
            ws.cell(row=i, column=c).border = BORDER
            ws.cell(row=i, column=c).alignment = CELL_ALIGN
        if i % 2 == 0:
            for c in range(1, len(headers) + 1):
                ws.cell(row=i, column=c).fill = ZEBRA
    ws.freeze_panes = "A2"


# ---------------------------------------------------------------------------
# Sheet 7 — Sign-off
# ---------------------------------------------------------------------------

def build_signoff(wb):
    ws = wb.create_sheet("Sign-off")
    set_widths(ws, [22, 14, 14, 14, 14, 36])
    ws["A1"] = "Pilot Go-Live Sign-off"
    ws["A1"].font = Font(size=16, bold=True, color="0F6CF0")
    ws.merge_cells("A1:F1")

    headers = ["Group", "Cases Pass", "Cases Fail", "Cases Blocked", "% Pass", "Tester / Date / Comment"]
    for c, h in enumerate(headers, start=1):
        ws.cell(row=3, column=c, value=h)
    style_header(ws, 3, len(headers))

    for i, g in enumerate(GROUPS, start=4):
        ws.cell(row=i, column=1, value=f"{g['id']} — {g['name']}")
        for c in range(1, len(headers) + 1):
            ws.cell(row=i, column=c).border = BORDER
            ws.cell(row=i, column=c).alignment = CELL_ALIGN
        if i % 2 == 0:
            for c in range(1, len(headers) + 1):
                ws.cell(row=i, column=c).fill = ZEBRA

    base = 5 + len(GROUPS)
    ws.cell(row=base, column=1, value="Pilot approved for real users:").font = Font(bold=True)
    ws.cell(row=base + 1, column=1, value="Approver name").alignment = Alignment(horizontal="right")
    ws.cell(row=base + 1, column=2, value="").border = BORDER
    ws.cell(row=base + 2, column=1, value="Approver signature").alignment = Alignment(horizontal="right")
    ws.cell(row=base + 2, column=2, value="").border = BORDER
    ws.cell(row=base + 3, column=1, value="Date").alignment = Alignment(horizontal="right")
    ws.cell(row=base + 3, column=2, value="").border = BORDER


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

def main():
    wb = Workbook()
    # remove the default sheet so order is deterministic
    default = wb.active
    wb.remove(default)

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
    print(f"  field scenarios: {len(FIELD)}")


if __name__ == "__main__":
    main()

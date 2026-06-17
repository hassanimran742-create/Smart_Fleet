# Smart_Fleet — Real-World Deployment Test Plan

Pilot test plan for the AWS deployment (`smartfleetpk.com`). Run top-to-bottom
before onboarding real distributors/drivers, then keep as a regression checklist
for every future release.

**Environments**
- Production API: `https://api.smartfleetpk.com/api/v1`
- Staging API: `https://staging.smartfleetpk.com/api/v1`
- Admin web (prod): `https://admin.smartfleetpk.com`
- Distributor app: EAS `distributor-production` channel
- Driver app: EAS `driver-production` channel

**Test accounts (seed/test data — replace before real go-live)**
- Super admin (web, password): `+923000000000`
- Branch admin (web, password): `+923000000001`
- Distributor (mobile, OTP): `+923001111111`
- Driver (mobile, OTP): `+923002222222`
- Test client: `+923009999999` (Walk-in Customer)

> Reading OTPs in pilot (mock SMS): on EC2 run
> `sudo docker logs smartfleet-api-prod --since 2m | grep -A4 "OTP-MOCK"`

---

## 0. Pre-flight (run once before each test cycle)

| # | Check | How | Pass criteria |
|---|-------|-----|---------------|
| 0.1 | API alive | `curl https://api.smartfleetpk.com/api/v1/health/live` | `{"status":"ok"}` |
| 0.2 | DB reachable | `curl https://api.smartfleetpk.com/api/v1/health` | `checks.database.ok = true` |
| 0.3 | TLS valid | open `https://api.smartfleetpk.com` in browser | padlock, no cert warning |
| 0.4 | Admin web loads | open `https://admin.smartfleetpk.com` | login screen, no console errors |
| 0.5 | Containers up | EC2: `docker compose -f /srv/smartfleet/docker-compose.aws.yml ps` | caddy + api-prod + api-staging all "Up" |
| 0.6 | Disk/memory headroom | EC2: `df -h /` and `free -h` | disk <80%, some free mem/swap |
| 0.7 | Free-tier budget | AWS Billing → month-to-date | actual cost ≈ $0 |

---

## 1. Authentication

### 1.1 Admin password login (web)
1. Go to `admin.smartfleetpk.com`
2. Enter `+923000000000` + password → Sign in
3. **Pass:** lands in dashboard; refresh keeps you logged in
4. **Negative:** wrong password → "Invalid phone or password"; no dashboard
5. **Negative:** distributor phone `+923001111111` + any password → rejected ("must sign in with a one-time code")

### 1.2 Mobile OTP login (distributor + driver)
1. Open app → enter `+923001111111` → Send OTP
2. Read code from logs → enter it
3. **Pass:** lands in distributor home; token persists across app restart
4. **Negative:** wrong code → error, no login
5. **Negative:** expired code (wait >5 min) → "OTP expired or not found"
6. **Negative:** admin phone `+923000000000` on mobile → either rejected or no usable home (admins are web-only)

### 1.3 Session behaviour
- Admin web idle 10 min → auto sign-out (idle logout)
- Mobile token survives phone reboot
- Logout clears session on both

---

## 2. Distributor app — core flows

### 2.1 Add client
1. Home → Add Client
2. Fill name, phone, area, city; set address via search
3. **Pass:** client saved, appears in client list, no crash
4. Verify in admin web → Distributors → client visible under the distributor

### 2.2 Place order (the critical revenue path)
1. New Order → search + pick a client
2. Set delivery address via search (Nominatim suggestion)
3. Add cylinder type(s) + quantities, set expected empties to return
4. Submit
5. **Pass:** success confirmation; order shows in "My Orders" as PENDING
6. **Cross-check:** order appears in admin web dashboard "Recent orders" + Orders screen within seconds
7. **Negative:** submit with empty cart → blocked with validation message
8. **Negative:** submit with no client selected → blocked

### 2.3 Order history & tracking
- Order History lists past orders with correct status
- Track Order opens without crash (map stub card shows; live status updates)

### 2.4 Ledger / balance
- Distributor balance displays
- After an order, balance/ledger reflects expected change (if pricing configured)

---

## 3. Admin web — operations

### 3.1 Dashboard
- KPI tiles populate (drivers online, active deliveries, pending dispatch, delivered today, open alerts)
- "Recent orders" table shows real orders
- No console errors with empty AND populated data

### 3.2 Order management
1. Open the order placed in 2.2
2. **Assign** to driver `+923002222222`
3. **Pass:** status → ASSIGNED; driver receives it on the driver app
4. Change status through the lifecycle (CONFIRMED → ASSIGNED → IN_TRANSIT → DELIVERED)
5. **Negative:** illegal status jump blocked by role rules

### 3.3 Master data
- Create/edit: zone, store, vehicle, cylinder type, pricing rule, distributor, driver
- Each persists and shows after refresh

### 3.4 Live deliveries
- Live screen loads; driver location updates appear when driver app is online and sharing location

---

## 4. Driver app — delivery flow

> Requires the driver APK (`driver-production`) installed + driver `+923002222222` logged in via OTP.

### 4.1 Receive + start trip
1. Admin assigns order to driver (3.2)
2. **Pass:** driver app shows the assigned order/trip (push or on refresh)
3. Driver starts the trip → status IN_TRANSIT

### 4.2 Cylinder custody (chain-of-custody)
1. Driver scans cylinder QR at pickup → custody = VEHICLE
2. At customer: scan/deliver full cylinder → custody = CLIENT
3. Pick up empty → custody recorded
4. **Pass:** each scan creates a custody event; counts reconcile

### 4.3 Proof of delivery
1. Complete delivery → capture proof photo
2. **Pass:** photo uploads to S3 (`smartfleet-files-prod`); order → DELIVERED
3. **Cross-check:** admin web shows DELIVERED + proof photo viewable

### 4.4 Location sharing
- Driver online → location pings sent; admin live map updates
- Going offline stops pings

---

## 5. End-to-end happy path (the money test)

Single uninterrupted run, timed:

1. Distributor places order (app)
2. Admin sees it, assigns to driver (web)
3. Driver receives, starts trip, scans cylinders (app)
4. Driver delivers, captures proof photo (app)
5. Order shows DELIVERED with photo (web)
6. Custody log + ledger reflect the transaction

**Pass:** completes without crash, data consistent across app↔web↔DB, proof photo in S3.

---

## 6. Data integrity & security

| # | Check | How | Pass criteria |
|---|-------|-----|---------------|
| 6.1 | PII encrypted at rest | query a user row in RDS, inspect `cnic_encrypted` | ciphertext, not plaintext CNIC |
| 6.2 | Passwords hashed | inspect `password_hash` | argon2 hash, never plaintext |
| 6.3 | OTP not leaked in prod | `/auth/otp/send` response in prod | `{ok:true}` only, no `devCode` |
| 6.4 | TLS everywhere | API, admin web, all over HTTPS | no cleartext endpoints |
| 6.5 | Role isolation | distributor token calls an admin-only endpoint | 403 Forbidden |
| 6.6 | S3 not public | open an S3 file URL directly | AccessDenied (only via app/pre-signed) |
| 6.7 | Cross-distributor isolation | distributor A cannot see distributor B's clients/orders | empty/forbidden |

---

## 7. Resilience & recovery

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 7.1 | API container crash | EC2: `docker kill smartfleet-api-prod` | restarts automatically (~2s); health green |
| 7.2 | EC2 reboot | reboot instance | containers auto-start; Caddy serves HTTPS; app reconnects |
| 7.3 | DB restore drill | restore latest RDS snapshot to a temp instance | data intact; documented RTO |
| 7.4 | Bad deploy rollback | redeploy a previous image tag | prior version live in minutes |
| 7.5 | Offline mobile | place actions with phone in airplane mode | queues / graceful error, syncs on reconnect (verify actual behaviour) |
| 7.6 | Alarm fires | stop EC2 | CloudWatch alarm → notification within ~6 min |

---

## 8. Performance (pilot-scale sanity)

| # | Check | Target |
|---|-------|--------|
| 8.1 | Order create latency | < 1.5 s p95 |
| 8.2 | Admin dashboard load | < 2 s with ~100 orders |
| 8.3 | OTP send→receive (log) | < 3 s |
| 8.4 | Concurrent: 5 distributors + 5 drivers active | no errors, no OOM on t3.micro |
| 8.5 | Proof photo upload | < 5 s on 4G |

> If t3.micro shows memory pressure under concurrency (check `free -h`), that's the signal to move toward the Phase L / scale steps.

---

## 9. Observability

- App + system logs visible in CloudWatch (`/smartfleet/prod`, `/smartfleet/system`)
- Errors land in Sentry (trigger a test error, confirm)
- Logs queryable by `request_id`
- Free-tier usage alarms exist and are not in ALARM state

---

## 10. Go-live checklist (before real users)

- [ ] **Change all seed passwords** — `ChangeMe!Now123` replaced for `+92300000000x`
- [ ] **Create real admin account** with the operator's real phone; demote/remove seed admins
- [ ] **Remove test users** `+923001111111`, `+923002222222`, test client
- [ ] **Real SMS provider** wired (swap `SMS_PROVIDER=mock` → Eocean/Twilio) OR document the manual-OTP relay process for pilot
- [ ] Real cylinder types, pricing rules, zones, stores configured
- [ ] Distributor & driver onboarded with real phones; APKs distributed
- [ ] Backups confirmed (RDS automated snapshots on; one manual snapshot taken)
- [ ] Operator knows: how to read OTP logs, assign orders, restart a container, check alarms
- [ ] Incident contact + escalation path written down
- [ ] Domain auto-renew on; AWS billing alert active
- [ ] Map: decide before scale — keep stub, or add OSM WebView / Google key (rebuild)

---

## 11. Known pilot limitations (accept consciously)

| Limitation | Impact | Mitigation / when to fix |
|------------|--------|--------------------------|
| Single EC2, no failover | ~5–15 min outage on hardware failure | EC2 auto-recovery enabled; Phase L at ≥50 distributors |
| Mock SMS | OTP read from logs, relayed manually | fine ≤ handful of users; real gateway before wider rollout |
| Map is a stub | no visual map picker; address search still sets location | OSM WebView or Google key in a planned rebuild |
| Default seed password | known string | change at go-live (checklist) |
| No "change password" UI yet | admins can't self-rotate | add next sprint |

---

## Sign-off

| Area | Tester | Date | Result |
|------|--------|------|--------|
| Auth (1) | | | |
| Distributor (2) | | | |
| Admin (3) | | | |
| Driver (4) | | | |
| End-to-end (5) | | | |
| Security (6) | | | |
| Resilience (7) | | | |
| Go-live (10) | | | |

**Pilot approved for real users:** ____________________  Date: __________

# Cylinder Chain-of-Custody

Every cylinder is a tracked asset with a unique serial + QR code. Every handover is a `cylinder_events` row.

## States

```
FULL ──delivered──> EMPTY (at CLIENT)
EMPTY ─picked_up──> EMPTY (in VEHICLE then STORE)
EMPTY ──returned──> EMPTY (at DISTRIBUTOR)
DISTRIBUTOR refill──> FULL (back at DISTRIBUTOR)
*any* ──mark_faulty──> FAULTY (terminal until inspection)
*any* ──mark_lost   ──> LOST   (terminal)
```

## Custody locations (polymorphic)

```
DISTRIBUTOR      — sitting at the distributor's plant or returned for refill
STORE            — at one of Smart_Fleet's storage stores
VEHICLE          — loaded on a delivery vehicle
CLIENT           — delivered, in use by end customer
```

## Required events

| When | Event | Required fields |
|---|---|---|
| Distributor drops full cylinders at Smart_Fleet store | `SCAN_IN` | from=DISTRIBUTOR, to=STORE, photo, location |
| Store-keeper loads vehicle | `SCAN_OUT` | from=STORE, to=VEHICLE, trip_id |
| Driver delivers to client | `DELIVERED` | from=VEHICLE, to=CLIENT, order_id, photo (POD), client signature/OTP |
| Driver collects empty | `PICKED_UP_EMPTY` | from=CLIENT, to=VEHICLE, order_id |
| Vehicle drops empties at store | `SCAN_IN` | from=VEHICLE, to=STORE |
| Empties leave for distributor refill | `RETURNED_TO_DISTRIBUTOR` | from=STORE, to=DISTRIBUTOR |
| Inter-store rebalance | `TRANSFER` | from=STORE, to=STORE, transfer_id |
| Damage at any point | `MARK_FAULTY` | actor, photo, reason |
| Lost / unaccounted for | `MARK_LOST` | actor, last_known_location |

## Scan flow on mobile

```
1. Driver/store-keeper scans QR
2. App POSTs /cylinders/scan with {qr, expected_event_type, location, trip_id?}
3. API validates: cylinder exists, current custody matches expected from-state, transition is allowed
4. API writes cylinder_event + updates cylinder.custody_type/id + recalculates inventory_lots
5. API returns updated cylinder state
6. App proceeds to next scan or marks stop complete
```

## Dispute resolution
- Every event has actor user, GPS, optional photo, optional trip/order linkage.
- Replay `cylinder_events.where(cylinder_id).order(created_at)` gives full provenance.
- Disputed delivery: client claims non-delivery → check `DELIVERED` event's photo + location ≤ 50m of client address.

## Invariants
1. A cylinder's `(custody_type, custody_id)` always matches its most recent event's `to_*` fields.
2. `inventory_lots` aggregates equal the count of cylinders grouped by holder/distributor/type/state.
3. Faulty + Lost cylinders are excluded from inventory_lots.
4. Distributor A cannot deliver Distributor B's cylinder (enforced in DELIVERED event handler).

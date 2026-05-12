# Dispatch Algorithm

## Goal
Assign each delivery order to the (driver, vehicle, origin-store) tuple that minimises total cost while respecting hard constraints. v1 is a greedy scoring algorithm run per-order; v2 is batch VRP via OR-Tools.

## Hard constraints (filters)
A candidate (driver, vehicle, store) is **eligible** only if:
1. **Stock**: `store` holds ≥ `order.full_count` full cylinders of the right `cylinderType` **owned by `order.distributorId`**.
2. **Capacity**: `vehicle.capacity_units − vehicle.current_load_units ≥ order.units` (using `cylinder_type.capacity_units`).
3. **Online**: `driver.is_online = true` and not on an active trip that would block delivery within the time window.
4. **Zone**: `vehicle.home_zone_id` is the order's `dest_zone_id`, OR cross-zone if no in-zone vehicle has stock+capacity (cross-zone surcharge applies).
5. **Time window**: if order has `scheduled_window_*`, ETA must land inside it.

## Scoring (v1 — greedy)

For each eligible candidate `c`:

```
score(c) = w_storeToDriver  · normDist(driver → store)            // smaller is better
        + w_storeToClient  · normDist(store  → client)
        + w_routeDeviation · routeDeviationKm(driver, store, client)
        + w_capacityFit    · (1 − remainingAfter / totalCapacity)  // prefer fuller-but-not-overloaded vehicles
        + w_sameZonePref   · (vehicle.zone == dest.zone ? 0 : 1)
        + w_postpone       · max(0, etaMinutes − scheduledStartMin) / 60
```

Lower score is better. Initial weights (tune in prod):

| Weight | Value | Rationale |
|---|---|---|
| `w_storeToDriver` | 4.0 | empty-leg km cost most |
| `w_storeToClient` | 3.0 | productive leg |
| `w_routeDeviation` | 5.0 | strongly penalize backtracks |
| `w_capacityFit` | 1.5 | prefer combining vs running half-empty |
| `w_sameZonePref` | 2.0 | zone routing discipline |
| `w_postpone` | 2.5 | discourage running before SLA window |

`normDist` is `distanceKm * 1.0` for v1; switch to OSRM travel-time for v2.

## Algorithm

```
on order_created:
  enqueue('dispatch', order.id)

dispatch.processor.process(order_id):
  order = orders.get(order_id)
  candidates = []
  for store in stores.withStock(order.distributorId, order.lines):
    for vehicle in vehicles.eligibleFor(store, order):
      driver = vehicle.currentDriver
      if !driver?.is_online: continue
      candidates.push(score(driver, vehicle, store, order))
  if candidates.empty:
    orders.markPending(order.id, reason='NO_ELIGIBLE_DRIVER')
    notifications.alertDispatchers(order)
    return
  best = candidates.minBy(score)
  trip = trips.appendOrCreate(best, order)
  orders.update(order.id, status=ASSIGNED, trip_id=trip.id)
  notifications.notifyDriver(best.driver_id, trip.id)
```

## Batching
Within a 60-second dispatch window, group new orders by `dest_zone_id` and try to append them to an existing planned trip whose remaining capacity and route allow them, before creating a new trip.

## Concurrency
- Dispatch jobs serialized per `vehicle_id` (BullMQ named queue per vehicle) to avoid double-assignment.
- Optimistic lock on `vehicles.current_load_units` with retry.

## Postponement
If no candidate's score ≤ threshold AND order has slack in its window, schedule a re-dispatch attempt at `now + 5min` (BullMQ delayed job). Cap at 3 retries; after that, alert dispatcher.

## Observability
Every dispatch decision writes a row to `dispatch_decisions` (not in core schema yet) with: order_id, candidate list, chosen, scores, latency_ms. Used to tune weights.

## v2: VRP
Replace greedy with OR-Tools VRP every 5 minutes per zone, taking all unassigned orders + idle vehicles, returning a complete trip plan. Greedy stays as fallback for sub-window urgent orders.

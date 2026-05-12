# Pricing Matrix

Pricing is a **zone-pair matrix**: `(city, origin_zone, dest_zone, cylinder_type) → (base_paisa, per_unit_paisa)`.

## Why a matrix
- Same-zone delivery is cheap (shortest route, often shared trip).
- Cross-zone delivery costs more (vehicle reassignment, longer routes).
- Far-zone (across a city's bisecting boundary, e.g. across river) costs even more.
- Each cylinder type has different handling cost (45kg needs two-person handling).

## Computing an order's fee

```
rule = pricing_rules.findActive(
  city_id          = order.city_id,
  origin_zone_id   = origin_store.zone_id,
  dest_zone_id     = order.dest_zone_id,
  cylinder_type_id = line.cylinder_type_id,
  at               = order.created_at
)
line_fee = rule.base_paisa + rule.per_unit_paisa * line.full_count
order.delivery_fee_paisa = sum(line_fees) + optional surcharges
```

`findActive` returns the rule whose `effective_from ≤ at` and `effective_until` is NULL or `> at`. If no active rule, dispatch fails with `PRICING_NOT_CONFIGURED` and alerts an admin.

## Surcharges (future, not v1)
- Time-of-day (after-hours): multiplier
- Surge (zone backlog): multiplier
- Express delivery: flat add-on

## Admin UX
Admin-web `/pricing` page renders an N×N grid (origin × dest zones) per city per cylinder type, editable inline. Saving creates a new pricing_rule row with `effective_from = now`; the previous rule's `effective_until` is set to the same timestamp. History preserved.

## Distributor visibility
DISTRIBUTOR-role users can read the rules that apply to deliveries originating from their `home_store.zone`. They do not see other distributors' rules (they all share the same rules actually, but UX limits noise).

## Free / promotional zones (future)
A boolean `is_promo` on the rule + `effective_until` date for time-limited free deliveries within a launch zone.

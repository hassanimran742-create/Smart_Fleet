export function PricingScreen() {
  return (
    <>
      <h2>Pricing matrix</h2>
      <div className="card">
        <p className="muted">
          Zone-pair pricing rules: <code>(origin_zone × dest_zone × cylinder_type) → (base_paisa, per_unit_paisa)</code>.
          Editor grid will be added once zones &amp; cylinder types exist. POST <code>/api/v1/pricing/rules</code> to upsert.
        </p>
      </div>
    </>
  );
}

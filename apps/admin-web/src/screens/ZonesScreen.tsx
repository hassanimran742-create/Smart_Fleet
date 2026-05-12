export function ZonesScreen() {
  return (
    <>
      <h2>Zones</h2>
      <div className="card">
        <p className="muted">
          Zone polygons are managed via a map editor. v1 placeholder: POST zone polygons as MultiPolygon GeoJSON to <code>POST /api/v1/zones</code>.
          A Leaflet/Mapbox drawing UI will be added in a follow-up.
        </p>
      </div>
    </>
  );
}

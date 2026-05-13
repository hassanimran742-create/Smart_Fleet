import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapContainer, Marker, Polygon, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../api/client';

L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface City { id: string; name: string }
interface Area { name: string; lat: number; lng: number }
interface ZoneRow {
  id: string;
  city_id: string;
  name: string;
  centroid: GeoJSON.Point | null;
  polygon: GeoJSON.MultiPolygon | null;
}

/**
 * Build a square MultiPolygon centred on (lat, lng) with the given
 * half-side in degrees. Quick way to get a usable zone polygon from
 * an area centroid without a drawing tool.
 */
function boxAround(lat: number, lng: number, half = 0.012): GeoJSON.MultiPolygon {
  const ring: GeoJSON.Position[] = [
    [lng - half, lat - half],
    [lng + half, lat - half],
    [lng + half, lat + half],
    [lng - half, lat + half],
    [lng - half, lat - half],
  ];
  return { type: 'MultiPolygon', coordinates: [[ring]] };
}

export function ZonesScreen() {
  const qc = useQueryClient();
  const cities = useQuery({ queryKey: ['cities'], queryFn: async () => (await api.get<City[]>('/cities')).data });

  const [cityId, setCityId] = useState<string>('');
  const [areaName, setAreaName] = useState<string>('');
  const [zoneName, setZoneName] = useState<string>('');
  const [halfDeg, setHalfDeg] = useState('0.012');
  const [err, setErr] = useState<string | null>(null);

  const areas = useQuery({
    queryKey: ['areas', cityId],
    queryFn: async () => cityId ? (await api.get<Area[]>(`/cities/${cityId}/areas`)).data : [],
    enabled: !!cityId,
  });

  const zones = useQuery({
    queryKey: ['zones', cityId],
    queryFn: async () => cityId ? (await api.get<ZoneRow[]>(`/zones/city/${cityId}`)).data : [],
    enabled: !!cityId,
  });

  const pickedArea = (areas.data ?? []).find((a) => a.name === areaName);

  const create = useMutation({
    mutationFn: () => {
      if (!cityId || !zoneName || !pickedArea) {
        throw new Error('Pick a city, an area centre, and give the zone a name.');
      }
      const polygon = boxAround(pickedArea.lat, pickedArea.lng, Number(halfDeg));
      return api.post('/zones', { cityId, name: zoneName, polygonGeoJson: polygon }).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['zones', cityId] });
      setZoneName('');
      setErr(null);
    },
    onError: (e: any) => setErr(e?.message ?? 'Failed'),
  });

  const cityCenter: [number, number] = pickedArea
    ? [pickedArea.lat, pickedArea.lng]
    : (areas.data?.[0] ? [areas.data[0].lat, areas.data[0].lng] : [33.6844, 73.0479]);

  return (
    <>
      <h2>Zones</h2>

      <div className="card">
        <h3>Create a zone</h3>
        <div className="flex" style={{ gap: 16 }}>
          <div style={{ flex: 1 }}>
            <label>City *</label>
            <select value={cityId} onChange={(e) => { setCityId(e.target.value); setAreaName(''); }}>
              <option value="">— pick a city —</option>
              {(cities.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Centre on area *</label>
            <select
              value={areaName}
              onChange={(e) => setAreaName(e.target.value)}
              disabled={!cityId}
            >
              <option value="">— pick an area —</option>
              {(areas.data ?? []).map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Zone name *</label>
            <input value={zoneName} onChange={(e) => setZoneName(e.target.value)} placeholder={areaName || 'e.g. North-A'} />
          </div>
          <div style={{ width: 160 }}>
            <label>Half-side (deg)</label>
            <input value={halfDeg} onChange={(e) => setHalfDeg(e.target.value)} type="number" step="0.001" />
            <p className="muted" style={{ marginTop: 4 }}>~1.1 km per 0.01°.</p>
          </div>
        </div>
        <p className="muted">
          For now zones are square boxes around the chosen area centre. A drawing tool will replace this.
        </p>
        {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
        <button className="primary" style={{ marginTop: 12 }} onClick={() => create.mutate()}>Create zone</button>
      </div>

      {cityId && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', height: 400 }}>
          <MapContainer center={cityCenter} zoom={12} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              attribution='&copy; OpenStreetMap'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {(zones.data ?? []).map((z) => {
              if (!z.polygon) return null;
              const positions = z.polygon.coordinates[0][0].map(([lng, lat]) => [lat, lng]) as [number, number][];
              return <Polygon key={z.id} positions={positions} pathOptions={{ color: '#0f6cf0', fillOpacity: 0.15 }} />;
            })}
            {pickedArea && (
              <Marker position={[pickedArea.lat, pickedArea.lng]} />
            )}
          </MapContainer>
        </div>
      )}

      {cityId && (
        <div className="card">
          <h3>Zones in this city</h3>
          {(zones.data ?? []).length === 0 && <p className="muted">No zones yet. Create one above.</p>}
          <table>
            <thead><tr><th>Name</th><th>Centroid</th></tr></thead>
            <tbody>
              {(zones.data ?? []).map((z) => (
                <tr key={z.id}>
                  <td>{z.name}</td>
                  <td>
                    {z.centroid
                      ? `${z.centroid.coordinates[1].toFixed(4)}, ${z.centroid.coordinates[0].toFixed(4)}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

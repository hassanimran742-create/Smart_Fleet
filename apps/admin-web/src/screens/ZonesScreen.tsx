import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapContainer, Marker, Polygon, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../api/client';
import { Modal, confirmDialog } from '../components/Modal';

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
  is_active: boolean;
}

/**
 * Build a MultiPolygon whose parts are square boxes around each picked
 * area centroid. Lets one zone span several sectors.
 */
function multiBoxAround(areas: { lat: number; lng: number }[], half: number): GeoJSON.MultiPolygon {
  return {
    type: 'MultiPolygon',
    coordinates: areas.map((a) => [[
      [a.lng - half, a.lat - half],
      [a.lng + half, a.lat - half],
      [a.lng + half, a.lat + half],
      [a.lng - half, a.lat + half],
      [a.lng - half, a.lat - half],
    ]]),
  };
}

export function ZonesScreen() {
  const qc = useQueryClient();
  const cities = useQuery({ queryKey: ['cities'], queryFn: async () => (await api.get<City[]>('/cities')).data });

  const [cityId, setCityId] = useState<string>('');
  const [pickedAreas, setPickedAreas] = useState<string[]>([]);
  const [zoneName, setZoneName] = useState<string>('');
  const [halfDeg, setHalfDeg] = useState('0.012');
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const [editing, setEditing] = useState<ZoneRow | null>(null);
  const [editName, setEditName] = useState('');
  const [editPickedAreas, setEditPickedAreas] = useState<string[]>([]);
  const [editHalfDeg, setEditHalfDeg] = useState('0.012');

  const areas = useQuery({
    queryKey: ['areas', cityId],
    queryFn: async () => cityId ? (await api.get<Area[]>(`/cities/${cityId}/areas`)).data : [],
    enabled: !!cityId,
  });

  const zones = useQuery({
    queryKey: ['zones', cityId, showArchived],
    queryFn: async () => cityId ? (await api.get<ZoneRow[]>(`/zones/city/${cityId}`)).data : [],
    enabled: !!cityId,
  });

  const pickedAreaData = useMemo(
    () => (areas.data ?? []).filter((a) => pickedAreas.includes(a.name)),
    [areas.data, pickedAreas],
  );

  function toggleArea(name: string) {
    setPickedAreas((s) => s.includes(name) ? s.filter((x) => x !== name) : [...s, name]);
  }
  function toggleEditArea(name: string) {
    setEditPickedAreas((s) => s.includes(name) ? s.filter((x) => x !== name) : [...s, name]);
  }

  const create = useMutation({
    mutationFn: () => {
      if (!cityId || !zoneName || pickedAreaData.length === 0) {
        throw new Error('Pick a city, at least one area, and give the zone a name.');
      }
      const polygon = multiBoxAround(pickedAreaData, Number(halfDeg));
      return api.post('/zones', { cityId, name: zoneName, polygonGeoJson: polygon }).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['zones', cityId] });
      setZoneName(''); setPickedAreas([]); setCreateErr(null);
    },
    onError: (e: any) => setCreateErr(e?.message ?? 'Failed'),
  });

  const update = useMutation({
    mutationFn: () => {
      const payload: any = { name: editName };
      if (editPickedAreas.length > 0) {
        const picked = (areas.data ?? []).filter((a) => editPickedAreas.includes(a.name));
        payload.polygonGeoJson = multiBoxAround(picked, Number(editHalfDeg));
      }
      return api.patch(`/zones/${editing!.id}`, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['zones', cityId] });
      setEditing(null);
    },
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.delete(`/zones/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['zones', cityId] }),
  });
  const reactivate = useMutation({
    mutationFn: (id: string) => api.patch(`/zones/${id}/reactivate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['zones', cityId] }),
  });

  const cityCenter: [number, number] = pickedAreaData[0]
    ? [pickedAreaData[0].lat, pickedAreaData[0].lng]
    : (areas.data?.[0] ? [areas.data[0].lat, areas.data[0].lng] : [33.6844, 73.0479]);

  const visibleZones = (zones.data ?? []).filter((z) => showArchived || z.is_active);

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between' }}>
        <h2>Zones</h2>
        <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          show archived
        </label>
      </div>

      <div className="card">
        <h3>Create a zone</h3>
        <div className="flex" style={{ gap: 16 }}>
          <div style={{ flex: 1 }}>
            <label>City *</label>
            <select value={cityId} onChange={(e) => { setCityId(e.target.value); setPickedAreas([]); }}>
              <option value="">— pick a city —</option>
              {(cities.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Zone name *</label>
            <input value={zoneName} onChange={(e) => setZoneName(e.target.value)} placeholder="e.g. F-Sectors" />
          </div>
          <div style={{ width: 160 }}>
            <label>Half-side (deg)</label>
            <input value={halfDeg} onChange={(e) => setHalfDeg(e.target.value)} type="number" step="0.001" />
            <p className="muted" style={{ marginTop: 4 }}>0.01° ≈ 1.1 km.</p>
          </div>
        </div>

        <label>Include areas / sectors (pick one or many)</label>
        <div
          style={{
            display: 'flex', flexWrap: 'wrap', gap: 8, padding: 8,
            background: '#fafafa', border: '1px solid var(--border)', borderRadius: 6, maxHeight: 200, overflow: 'auto',
          }}
        >
          {(areas.data ?? []).length === 0 && <span className="muted">Pick a city first.</span>}
          {(areas.data ?? []).map((a) => {
            const checked = pickedAreas.includes(a.name);
            return (
              <label
                key={a.name}
                style={{
                  padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
                  background: checked ? 'var(--primary)' : 'white',
                  color: checked ? 'white' : 'inherit',
                  border: '1px solid', borderColor: checked ? 'var(--primary)' : 'var(--border)',
                }}
              >
                <input
                  type="checkbox"
                  style={{ width: 'auto', marginRight: 6 }}
                  checked={checked}
                  onChange={() => toggleArea(a.name)}
                />
                {a.name}
              </label>
            );
          })}
        </div>
        <p className="muted" style={{ marginTop: 4 }}>{pickedAreas.length} area(s) selected — one zone will contain all of them.</p>

        {createErr && <p style={{ color: 'var(--danger)' }}>{createErr}</p>}
        <button className="primary" style={{ marginTop: 12 }} onClick={() => create.mutate()}>Create zone</button>
      </div>

      {cityId && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', height: 400 }}>
          <MapContainer center={cityCenter} zoom={12} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              attribution='&copy; OpenStreetMap'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {visibleZones.map((z) => {
              if (!z.polygon) return null;
              return z.polygon.coordinates.map((part, idx) => {
                const positions = part[0].map(([lng, lat]) => [lat, lng]) as [number, number][];
                return (
                  <Polygon
                    key={`${z.id}-${idx}`}
                    positions={positions}
                    pathOptions={{ color: z.is_active ? '#0f6cf0' : '#9ca3af', fillOpacity: 0.15 }}
                  />
                );
              });
            })}
            {pickedAreaData.map((a) => (
              <Marker key={a.name} position={[a.lat, a.lng]} />
            ))}
          </MapContainer>
        </div>
      )}

      {cityId && (
        <div className="card">
          <h3>Zones in this city</h3>
          {visibleZones.length === 0 && <p className="muted">No zones yet.</p>}
          <table>
            <thead><tr><th>Name</th><th>Parts</th><th>Centroid</th><th>Active</th><th></th></tr></thead>
            <tbody>
              {visibleZones.map((z) => (
                <tr key={z.id} style={{ opacity: z.is_active ? 1 : 0.5 }}>
                  <td>{z.name}</td>
                  <td>{z.polygon?.coordinates.length ?? 0}</td>
                  <td>
                    {z.centroid
                      ? `${z.centroid.coordinates[1].toFixed(4)}, ${z.centroid.coordinates[0].toFixed(4)}`
                      : '—'}
                  </td>
                  <td>{z.is_active ? '✓' : '—'}</td>
                  <td>
                    <button onClick={() => {
                      setEditing(z); setEditName(z.name); setEditPickedAreas([]); setEditHalfDeg('0.012');
                    }}>Edit</button>{' '}
                    {z.is_active ? (
                      <button style={{ color: 'var(--danger)' }} onClick={() => { if (confirmDialog(`Archive zone "${z.name}"?`)) archive.mutate(z.id); }}>Archive</button>
                    ) : (
                      <button onClick={() => reactivate.mutate(z.id)}>Reactivate</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal title="Edit zone" open={!!editing} onClose={() => setEditing(null)} width={640}>
        {editing && (
          <>
            <label>Zone name</label>
            <input value={editName} onChange={(e) => setEditName(e.target.value)} />
            <label>Half-side (deg) for any redraw</label>
            <input value={editHalfDeg} onChange={(e) => setEditHalfDeg(e.target.value)} type="number" step="0.001" />

            <label style={{ marginTop: 12 }}>
              Redraw with these areas (leave empty to keep current polygon)
            </label>
            <div
              style={{
                display: 'flex', flexWrap: 'wrap', gap: 8, padding: 8,
                background: '#fafafa', border: '1px solid var(--border)', borderRadius: 6, maxHeight: 200, overflow: 'auto',
              }}
            >
              {(areas.data ?? []).map((a) => {
                const checked = editPickedAreas.includes(a.name);
                return (
                  <label
                    key={a.name}
                    style={{
                      padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
                      background: checked ? 'var(--primary)' : 'white',
                      color: checked ? 'white' : 'inherit',
                      border: '1px solid', borderColor: checked ? 'var(--primary)' : 'var(--border)',
                    }}
                  >
                    <input
                      type="checkbox"
                      style={{ width: 'auto', marginRight: 6 }}
                      checked={checked}
                      onChange={() => toggleEditArea(a.name)}
                    />
                    {a.name}
                  </label>
                );
              })}
            </div>
            <p className="muted">{editPickedAreas.length} area(s) selected.</p>

            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button onClick={() => setEditing(null)}>Cancel</button>{' '}
              <button className="primary" onClick={() => update.mutate()}>Save</button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

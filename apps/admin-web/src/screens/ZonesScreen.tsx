import { useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
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
interface Area { name: string; lat: number; lng: number; cityName: string }  // augmented with cityName
interface ZoneRow {
  id: string;
  city_id: string;
  name: string;
  centroid: GeoJSON.Point | null;
  polygon: GeoJSON.MultiPolygon | null;
  is_active: boolean;
}

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

/** Compute a unique area key including city, since two cities may share an area name. */
function areaKey(a: { name: string; cityName: string }) {
  return `${a.cityName}::${a.name}`;
}

export function ZonesScreen() {
  const qc = useQueryClient();
  const cities = useQuery({ queryKey: ['cities'], queryFn: async () => (await api.get<City[]>('/cities')).data });

  const [primaryCityId, setPrimaryCityId] = useState<string>('');
  const [sourceCityIds, setSourceCityIds] = useState<string[]>([]);   // cities to pull areas from
  const [pickedAreaKeys, setPickedAreaKeys] = useState<string[]>([]);
  const [zoneName, setZoneName] = useState<string>('');
  const [halfDeg, setHalfDeg] = useState('0.012');
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const [editing, setEditing] = useState<ZoneRow | null>(null);
  const [editName, setEditName] = useState('');
  const [editSourceCityIds, setEditSourceCityIds] = useState<string[]>([]);
  const [editPickedAreaKeys, setEditPickedAreaKeys] = useState<string[]>([]);
  const [editHalfDeg, setEditHalfDeg] = useState('0.012');

  // Areas for the CREATE form: queries for each city in sourceCityIds.
  const sourceAreaQueries = useQueries({
    queries: sourceCityIds.map((cid) => ({
      queryKey: ['areas', cid],
      queryFn: async () => {
        const data = (await api.get<{ name: string; lat: number; lng: number }[]>(`/cities/${cid}/areas`)).data;
        const cityName = cities.data?.find((c) => c.id === cid)?.name ?? '';
        return data.map((a) => ({ ...a, cityName }));
      },
    })),
  });
  const allAreas: Area[] = useMemo(
    () => sourceAreaQueries.flatMap((q) => (q.data ?? []) as Area[]),
    [sourceAreaQueries],
  );
  const pickedAreaData = useMemo(
    () => allAreas.filter((a) => pickedAreaKeys.includes(areaKey(a))),
    [allAreas, pickedAreaKeys],
  );

  // Same for EDIT form
  const editAreaQueries = useQueries({
    queries: editSourceCityIds.map((cid) => ({
      queryKey: ['areas', cid],
      queryFn: async () => {
        const data = (await api.get<{ name: string; lat: number; lng: number }[]>(`/cities/${cid}/areas`)).data;
        const cityName = cities.data?.find((c) => c.id === cid)?.name ?? '';
        return data.map((a) => ({ ...a, cityName }));
      },
    })),
  });
  const editAllAreas: Area[] = useMemo(
    () => editAreaQueries.flatMap((q) => (q.data ?? []) as Area[]),
    [editAreaQueries],
  );

  // Zones list for the chosen primary city
  const zones = useQuery({
    queryKey: ['zones', primaryCityId, showArchived],
    queryFn: async () => primaryCityId ? (await api.get<ZoneRow[]>(`/zones/city/${primaryCityId}`)).data : [],
    enabled: !!primaryCityId,
  });

  function toggleSourceCity(id: string) {
    setSourceCityIds((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  }
  function toggleEditSourceCity(id: string) {
    setEditSourceCityIds((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  }
  function toggleArea(key: string) {
    setPickedAreaKeys((s) => s.includes(key) ? s.filter((x) => x !== key) : [...s, key]);
  }
  function toggleEditArea(key: string) {
    setEditPickedAreaKeys((s) => s.includes(key) ? s.filter((x) => x !== key) : [...s, key]);
  }

  const create = useMutation({
    mutationFn: () => {
      if (!primaryCityId) throw new Error('Pick a primary city');
      if (!zoneName.trim()) throw new Error('Give the zone a name');
      if (pickedAreaData.length === 0) throw new Error('Pick at least one area (from any city)');
      const polygon = multiBoxAround(pickedAreaData, Number(halfDeg));
      return api.post('/zones', { cityId: primaryCityId, name: zoneName.trim(), polygonGeoJson: polygon }).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['zones', primaryCityId] });
      setZoneName(''); setPickedAreaKeys([]); setCreateErr(null);
    },
    onError: (e: any) => setCreateErr(e?.response?.data?.message ?? e?.message ?? 'Failed'),
  });

  const update = useMutation({
    mutationFn: () => {
      const payload: any = { name: editName };
      if (editPickedAreaKeys.length > 0) {
        const picked = editAllAreas.filter((a) => editPickedAreaKeys.includes(areaKey(a)));
        payload.polygonGeoJson = multiBoxAround(picked, Number(editHalfDeg));
      }
      return api.patch(`/zones/${editing!.id}`, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['zones', primaryCityId] });
      setEditing(null);
    },
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.delete(`/zones/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['zones', primaryCityId] }),
  });
  const reactivate = useMutation({
    mutationFn: (id: string) => api.patch(`/zones/${id}/reactivate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['zones', primaryCityId] }),
  });

  const mapCenter: [number, number] = pickedAreaData[0]
    ? [pickedAreaData[0].lat, pickedAreaData[0].lng]
    : (allAreas[0] ? [allAreas[0].lat, allAreas[0].lng] : [33.6844, 73.0479]);

  const visibleZones = (zones.data ?? []).filter((z) => showArchived || z.is_active);

  // Group areas by city for nicer rendering.
  function renderAreaChips(areas: Area[], selectedKeys: string[], onToggle: (k: string) => void) {
    const byCity: Record<string, Area[]> = {};
    for (const a of areas) (byCity[a.cityName] ??= []).push(a);
    const cityNames = Object.keys(byCity).sort();
    if (cityNames.length === 0) return <span className="muted">Pick at least one source city above.</span>;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {cityNames.map((c) => (
          <div key={c}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{c}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {byCity[c].map((a) => {
                const key = areaKey(a);
                const checked = selectedKeys.includes(key);
                return (
                  <label
                    key={key}
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
                      onChange={() => onToggle(key)}
                    />
                    {a.name}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

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
        <p className="muted">
          A zone can span areas from one or more cities. Pick the primary city (used for listing the zone), then tick the cities you want to draw areas from, then pick the specific areas. The zone's polygon will be the union of square boxes around each picked area.
        </p>

        <div className="flex" style={{ gap: 16 }}>
          <div style={{ flex: 1 }}>
            <label>Primary city *</label>
            <select value={primaryCityId} onChange={(e) => setPrimaryCityId(e.target.value)}>
              <option value="">— pick a city —</option>
              {(cities.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Zone name *</label>
            <input value={zoneName} onChange={(e) => setZoneName(e.target.value)} placeholder="e.g. Twin-cities North" />
          </div>
          <div style={{ width: 160 }}>
            <label>Half-side (deg)</label>
            <input value={halfDeg} onChange={(e) => setHalfDeg(e.target.value)} type="number" step="0.001" />
            <p className="muted" style={{ marginTop: 4 }}>0.01° ≈ 1.1 km.</p>
          </div>
        </div>

        <label>Pull areas from these cities (tick any)</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 6, background: '#fafafa', border: '1px solid var(--border)', borderRadius: 6 }}>
          {(cities.data ?? []).map((c) => {
            const checked = sourceCityIds.includes(c.id);
            return (
              <label
                key={c.id}
                style={{
                  padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
                  background: checked ? '#1ea675' : 'white',
                  color: checked ? 'white' : 'inherit',
                  border: '1px solid', borderColor: checked ? '#1ea675' : 'var(--border)',
                }}
              >
                <input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={checked} onChange={() => toggleSourceCity(c.id)} />
                {c.name}
              </label>
            );
          })}
        </div>

        <label style={{ marginTop: 12 }}>Include areas / sectors (pick one or many, from any selected city)</label>
        <div style={{ padding: 8, background: '#fafafa', border: '1px solid var(--border)', borderRadius: 6, maxHeight: 260, overflow: 'auto' }}>
          {renderAreaChips(allAreas, pickedAreaKeys, toggleArea)}
        </div>
        <p className="muted" style={{ marginTop: 4 }}>{pickedAreaKeys.length} area(s) selected.</p>

        {createErr && <p style={{ color: 'var(--danger)' }}>{createErr}</p>}
        <button className="primary" style={{ marginTop: 12 }} onClick={() => create.mutate()}>Create zone</button>
      </div>

      {primaryCityId && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', height: 420 }}>
          <MapContainer center={mapCenter} zoom={11} style={{ height: '100%', width: '100%' }}>
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
              <Marker key={areaKey(a)} position={[a.lat, a.lng]} />
            ))}
          </MapContainer>
        </div>
      )}

      {primaryCityId && (
        <div className="card">
          <h3>Zones filed under this primary city</h3>
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
                      setEditing(z); setEditName(z.name);
                      setEditPickedAreaKeys([]); setEditSourceCityIds([]); setEditHalfDeg('0.012');
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

      <Modal title="Edit zone" open={!!editing} onClose={() => setEditing(null)} width={720}>
        {editing && (
          <>
            <label>Zone name</label>
            <input value={editName} onChange={(e) => setEditName(e.target.value)} />

            <label style={{ marginTop: 12 }}>Half-side (deg) for any redraw</label>
            <input value={editHalfDeg} onChange={(e) => setEditHalfDeg(e.target.value)} type="number" step="0.001" />

            <label style={{ marginTop: 12 }}>Source cities for areas (only needed if redrawing)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 6, background: '#fafafa', border: '1px solid var(--border)', borderRadius: 6 }}>
              {(cities.data ?? []).map((c) => {
                const checked = editSourceCityIds.includes(c.id);
                return (
                  <label
                    key={c.id}
                    style={{
                      padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
                      background: checked ? '#1ea675' : 'white',
                      color: checked ? 'white' : 'inherit',
                      border: '1px solid', borderColor: checked ? '#1ea675' : 'var(--border)',
                    }}
                  >
                    <input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={checked} onChange={() => toggleEditSourceCity(c.id)} />
                    {c.name}
                  </label>
                );
              })}
            </div>

            <label style={{ marginTop: 12 }}>Redraw with these areas (leave empty to keep current polygon)</label>
            <div style={{ padding: 8, background: '#fafafa', border: '1px solid var(--border)', borderRadius: 6, maxHeight: 260, overflow: 'auto' }}>
              {renderAreaChips(editAllAreas, editPickedAreaKeys, toggleEditArea)}
            </div>
            <p className="muted">{editPickedAreaKeys.length} area(s) selected.</p>

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

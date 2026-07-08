import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

function defaultSince(days: number) {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

export function FuelReportScreen() {
  const [since, setSince] = useState(defaultSince(30));
  const [until, setUntil] = useState(today());
  const [driverFilter, setDriverFilter] = useState<string>('');
  const [vehicleFilter, setVehicleFilter] = useState<string>('');

  const fuel = useQuery({
    queryKey: ['fuel-report', since],
    queryFn: async () =>
      (await api.get(`/reports/fuel-consumption?since=${new Date(since).toISOString()}`)).data,
  });
  const perf = useQuery({
    queryKey: ['driver-perf', since],
    queryFn: async () =>
      (await api.get(`/reports/driver-performance?since=${new Date(since).toISOString()}`)).data,
  });
  const drivers = useQuery({ queryKey: ['drivers'], queryFn: async () => (await api.get('/drivers')).data });

  const fuelRows = (fuel.data ?? []) as any[];

  // Flatten all refills with vehicle info; apply driver + vehicle + date filters.
  const allRefills = useMemo(() => {
    const flat = fuelRows.flatMap((v: any) =>
      (v.refills ?? []).map((r: any) => ({ ...r, plateNo: v.plateNo, vehicleId: v.vehicleId })),
    );
    return flat
      .filter((r: any) => {
        const at = new Date(r.refillAt).getTime();
        const fromMs = new Date(since).getTime();
        const toMs = new Date(until + 'T23:59:59').getTime();
        if (at < fromMs || at > toMs) return false;
        if (driverFilter && r.driverName !== driverFilter) return false;
        if (vehicleFilter && r.vehicleId !== vehicleFilter) return false;
        return true;
      })
      .sort((a: any, b: any) => new Date(b.refillAt).getTime() - new Date(a.refillAt).getTime());
  }, [fuelRows, since, until, driverFilter, vehicleFilter]);

  // Filter per-vehicle aggregates if vehicleFilter is set
  const visibleVehicleRows = useMemo(
    () => (vehicleFilter ? fuelRows.filter((v) => v.vehicleId === vehicleFilter) : fuelRows),
    [fuelRows, vehicleFilter],
  );

  const visiblePerfRows = useMemo(() => {
    const rows = (perf.data ?? []) as any[];
    return driverFilter ? rows.filter((d) => d.name === driverFilter) : rows;
  }, [perf.data, driverFilter]);

  const totalLitres = visibleVehicleRows.reduce((s, r) => s + r.totalLitres, 0);
  const totalCostPkr = visibleVehicleRows.reduce((s, r) => s + Number(r.totalCostPaisa) / 100, 0);
  const totalKm = visibleVehicleRows.reduce((s, r) => s + r.kmInWindow, 0);

  const driverNames = Array.from(new Set((drivers.data ?? []).map((d: any) => d.user.name))).sort();
  const vehicleOptions = fuelRows.map((v) => ({ id: v.vehicleId, plate: v.plateNo }));

  function FilterBar() {
    return (
      <div className="flex" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={{ margin: 0 }}>From</label>
          <input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
        </div>
        <div>
          <label style={{ margin: 0 }}>To</label>
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </div>
        <div>
          <label style={{ margin: 0 }}>Driver</label>
          <select value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)}>
            <option value="">All drivers</option>
            {driverNames.map((n) => <option key={n as string} value={n as string}>{n as string}</option>)}
          </select>
        </div>
        <div>
          <label style={{ margin: 0 }}>Vehicle</label>
          <select value={vehicleFilter} onChange={(e) => setVehicleFilter(e.target.value)}>
            <option value="">All vehicles</option>
            {vehicleOptions.map((v: any) => <option key={v.id} value={v.id}>{v.plate}</option>)}
          </select>
        </div>
        {(driverFilter || vehicleFilter) && (
          <button onClick={() => { setDriverFilter(''); setVehicleFilter(''); }}>Clear filters</button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between' }}>
        <h2>Fuel & km</h2>
      </div>

      <div className="card">
        <FilterBar />
      </div>

      <div className="kpi">
        <div className="card">
          <div className="label">Total fuel (litres)</div>
          <div className="value">{totalLitres.toFixed(1)}</div>
        </div>
        <div className="card">
          <div className="label">Total fuel cost</div>
          <div className="value" style={{ color: 'var(--ok)' }}>Rs. {totalCostPkr.toLocaleString()}</div>
        </div>
        <div className="card">
          <div className="label">Total km driven</div>
          <div className="value">{totalKm.toLocaleString()}</div>
        </div>
        <div className="card">
          <div className="label">Fleet avg km/L</div>
          <div className="value">{totalLitres > 0 ? (totalKm / totalLitres).toFixed(1) : '—'}</div>
        </div>
      </div>

      <div className="card">
        <h3>Per vehicle</h3>
        <table>
          <thead>
            <tr>
              <th>Vehicle</th><th>km this period</th><th>Current odo</th>
              <th>Litres</th><th>Cost (PKR)</th><th>km/L</th><th>Refills</th><th>Last driver</th><th>Last fill</th>
            </tr>
          </thead>
          <tbody>
            {visibleVehicleRows.map((r) => (
              <tr key={r.vehicleId}>
                <td><strong>{r.plateNo}</strong></td>
                <td>{r.kmInWindow}</td>
                <td className="muted">{r.currentOdometerKm}</td>
                <td>{r.totalLitres}</td>
                <td>{(Number(r.totalCostPaisa) / 100).toLocaleString()}</td>
                <td>{r.kmPerLitre ?? '—'}</td>
                <td>{r.refillCount}</td>
                <td>{r.lastDriver}</td>
                <td className="muted">{new Date(r.lastRefillAt).toLocaleString()}</td>
              </tr>
            ))}
            {visibleVehicleRows.length === 0 && (
              <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                No refills match the filters.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Refill history</h3>
        <table>
          <thead>
            <tr><th>When</th><th>Vehicle</th><th>Driver</th><th>Litres</th><th>Cost (PKR)</th><th>Odometer (km)</th><th>Station</th></tr>
          </thead>
          <tbody>
            {allRefills.slice(0, 200).map((r: any) => (
              <tr key={r.id}>
                <td className="muted">{new Date(r.refillAt).toLocaleString()}</td>
                <td><strong>{r.plateNo}</strong></td>
                <td>{r.driverName}</td>
                <td>{r.litres}</td>
                <td>{(Number(r.costPaisa) / 100).toLocaleString()}</td>
                <td>{r.odometerKm}</td>
                <td>{r.fuelStation ?? '—'}</td>
              </tr>
            ))}
            {allRefills.length === 0 && (
              <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                No refills match the filters.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Per driver — km driven, orders, hours</h3>
        <table>
          <thead>
            <tr>
              <th>Driver</th><th>Vehicle</th><th>Availability</th>
              <th>km driven</th><th>Orders delivered</th><th>Filling runs</th>
              <th>Hours</th><th>Refills</th><th>Litres</th>
            </tr>
          </thead>
          <tbody>
            {visiblePerfRows.map((d: any) => {
              const tone = d.availability === 'AVAILABLE' ? 'pill-ok' : d.availability === 'ON_LEAVE' ? 'pill-warn' : 'pill-neutral';
              return (
                <tr key={d.driverId}>
                  <td>{d.name}</td>
                  <td>{d.plateNo ?? <span className="muted">—</span>}</td>
                  <td><span className={`pill ${tone}`}>{d.availability}</span></td>
                  <td><strong>{d.kmDriven}</strong></td>
                  <td>{d.deliveredOrders}</td>
                  <td>{d.fillingOrdersCompleted}</td>
                  <td>{d.totalHours}</td>
                  <td>{d.refillCount}</td>
                  <td>{d.fuelLitres}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

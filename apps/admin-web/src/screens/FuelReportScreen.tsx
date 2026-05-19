import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

function defaultSince(days: number) {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

export function FuelReportScreen() {
  const [since, setSince] = useState(defaultSince(30));

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

  const fuelRows = (fuel.data ?? []) as any[];
  const totalLitres = fuelRows.reduce((s, r) => s + r.totalLitres, 0);
  const totalCostPkr = fuelRows.reduce((s, r) => s + Number(r.totalCostPaisa) / 100, 0);
  const totalKm = fuelRows.reduce((s, r) => s + r.kmInWindow, 0);

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between' }}>
        <h2>Fuel consumption & driver performance</h2>
        <div className="flex" style={{ gap: 8 }}>
          <label style={{ margin: 0 }}>Since</label>
          <input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
        </div>
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
          <div className="label">Fleet avg km/litre</div>
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
            {fuelRows.map((r) => (
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
            {fuelRows.length === 0 && (
              <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                No fuel refills recorded in this period.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Refill history (chronological)</h3>
        <table>
          <thead>
            <tr><th>When</th><th>Vehicle</th><th>Driver</th><th>Litres</th><th>Cost (PKR)</th><th>Odometer (km)</th><th>Station</th></tr>
          </thead>
          <tbody>
            {fuelRows.flatMap((v) =>
              v.refills.map((r: any) => ({ ...r, plateNo: v.plateNo })),
            )
              .sort((a: any, b: any) => new Date(b.refillAt).getTime() - new Date(a.refillAt).getTime())
              .slice(0, 100)
              .map((r: any) => (
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
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Per driver — km driven, orders, hours</h3>
        <table>
          <thead>
            <tr>
              <th>Driver</th><th>Vehicle</th><th>Availability</th>
              <th>km driven</th><th>Orders delivered</th><th>Filling orders</th>
              <th>Hours</th><th>Refills</th><th>Litres</th>
            </tr>
          </thead>
          <tbody>
            {((perf.data ?? []) as any[]).map((d) => {
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

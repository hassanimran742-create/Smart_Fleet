import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

function defaultSince(days: number) {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

const STATUS_TONE: Record<string, string> = {
  PENDING: 'pill-warn',
  CONFIRMED: 'pill-primary',
  ASSIGNED: 'pill-primary',
  IN_TRANSIT: 'pill-primary',
  DELIVERED: 'pill-ok',
  CANCELLED: 'pill-neutral',
  FAILED: 'pill-danger',
};

export function ReportsScreen() {
  const [attendanceSince, setAttendanceSince] = useState(defaultSince(7));
  const [attendanceUntil, setAttendanceUntil] = useState(new Date().toISOString().slice(0, 10));

  const util = useQuery({
    queryKey: ['driver-util'],
    queryFn: async () => (await api.get('/reports/driver-utilization')).data,
  });
  const attendance = useQuery({
    queryKey: ['driver-attendance', attendanceSince, attendanceUntil],
    queryFn: async () =>
      (await api.get(
        `/reports/driver-attendance?since=${new Date(attendanceSince).toISOString()}&until=${new Date(attendanceUntil + 'T23:59:59').toISOString()}`,
      )).data,
  });
  const decisions = useQuery({
    queryKey: ['dispatch-decisions'],
    queryFn: async () => (await api.get('/reports/dispatch-decisions')).data,
  });
  const funnel = useQuery({
    queryKey: ['delivery-funnel'],
    queryFn: async () => (await api.get('/reports/delivery-funnel')).data,
  });
  const inventory = useQuery({
    queryKey: ['inventory-by-store-report'],
    queryFn: async () => (await api.get('/inventory/by-store')).data,
  });
  const orders = useQuery({
    queryKey: ['orders-all-report'],
    queryFn: async () => (await api.get('/orders/all')).data,
  });

  const revenueByZone: Record<string, number> = {};
  for (const o of orders.data ?? []) {
    if (o.status === 'DELIVERED') {
      const zone = o.destZone?.name ?? o.destZoneId;
      revenueByZone[zone] = (revenueByZone[zone] ?? 0) + Number(o.deliveryFeePaisa);
    }
  }
  const totalRevenue = Object.values(revenueByZone).reduce((s, v) => s + v, 0);

  const deliveredCount = funnel.data?.byStatus.find((r: any) => r.status === 'DELIVERED')?.count ?? 0;
  const failedCount    = funnel.data?.byStatus.find((r: any) => r.status === 'FAILED')?.count ?? 0;
  const cancelledCount = funnel.data?.byStatus.find((r: any) => r.status === 'CANCELLED')?.count ?? 0;
  const completed = deliveredCount + failedCount + cancelledCount;
  const successRate = completed > 0 ? Math.round((deliveredCount / completed) * 1000) / 10 : 0;

  return (
    <>
      <h2>Reports</h2>

      <div className="kpi">
        <div className="card">
          <div className="label">Total revenue (delivered)</div>
          <div className="value" style={{ color: 'var(--ok)' }}>Rs. {(totalRevenue / 100).toLocaleString()}</div>
        </div>
        <div className="card">
          <div className="label">Delivery success rate</div>
          <div className="value">{successRate}%</div>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 11 }}>{deliveredCount} delivered / {completed} closed</p>
        </div>
        <div className="card">
          <div className="label">Failed deliveries</div>
          <div className="value" style={{ color: 'var(--danger)' }}>{failedCount}</div>
        </div>
        <div className="card">
          <div className="label">Cancelled</div>
          <div className="value" style={{ color: 'var(--muted)' }}>{cancelledCount}</div>
        </div>
      </div>

      <div className="card">
        <h3>Order outcomes (last 30 days)</h3>
        <table>
          <thead><tr><th>Status</th><th>Count</th><th>% of total</th></tr></thead>
          <tbody>
            {(funnel.data?.byStatus ?? []).map((r: any) => (
              <tr key={r.status}>
                <td><span className={`pill ${STATUS_TONE[r.status] ?? 'pill-neutral'}`}>{r.status}</span></td>
                <td><strong>{r.count}</strong></td>
                <td>{r.percent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Algorithm dispatch decisions</h3>
        <p className="muted">
          Each row shows what the dispatch algorithm decided for an order — which driver, which vehicle, the origin store, current trip status, and the resulting fee. Use this to audit how the assignment scoring is performing.
        </p>
        <table>
          <thead>
            <tr>
              <th>Order</th><th>Distributor</th><th>Client</th><th>Driver / Vehicle</th>
              <th>Origin → Destination</th><th>Cylinders</th><th>Status</th><th>Fee (PKR)</th>
            </tr>
          </thead>
          <tbody>
            {(decisions.data ?? []).map((d: any) => (
              <tr key={d.orderId}>
                <td><code>{d.orderId.slice(0, 8)}</code></td>
                <td>{d.distributor}</td>
                <td>{d.client}</td>
                <td>
                  {d.driver ?? '—'}
                  {d.vehicle && <div className="muted" style={{ fontSize: 11 }}>{d.vehicle}</div>}
                </td>
                <td>
                  {d.origin ?? '—'} → {d.destinationZone}
                  <div className="muted" style={{ fontSize: 11 }}>{d.destination}</div>
                </td>
                <td>{d.cylinders}</td>
                <td>
                  <span className={`pill ${STATUS_TONE[d.status] ?? 'pill-neutral'}`}>{d.status}</span>
                  {d.cancellationReason && (
                    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{d.cancellationReason}</div>
                  )}
                </td>
                <td>{(Number(d.feePaisa) / 100).toLocaleString()}</td>
              </tr>
            ))}
            {(decisions.data ?? []).length === 0 && (
              <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                No dispatched orders in the last 7 days. Run <code>npm run seed:demo</code> to populate scenarios.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
          <h3 style={{ margin: 0 }}>Driver attendance</h3>
          <div className="flex" style={{ gap: 12 }}>
            <div>
              <label>From</label>
              <input type="date" value={attendanceSince} onChange={(e) => setAttendanceSince(e.target.value)} />
            </div>
            <div>
              <label>To</label>
              <input type="date" value={attendanceUntil} onChange={(e) => setAttendanceUntil(e.target.value)} />
            </div>
          </div>
        </div>
        <p className="muted">
          Hours from driver online/offline toggles. Each shift opens when a driver flips online, closes on offline or leave.
        </p>
        <table>
          <thead>
            <tr><th>Driver</th><th>Availability</th><th>Total hours</th><th>Days worked</th><th>Last shift ended</th></tr>
          </thead>
          <tbody>
            {(attendance.data ?? []).map((r: any) => {
              const tone = r.availability === 'AVAILABLE' ? 'pill-ok' : r.availability === 'ON_LEAVE' ? 'pill-warn' : 'pill-neutral';
              return (
                <tr key={r.driverId}>
                  <td>{r.name}</td>
                  <td><span className={`pill ${tone}`}>{r.availability}</span></td>
                  <td><strong>{r.totalHours}</strong></td>
                  <td>{r.daysWorked}</td>
                  <td className="muted">{r.lastShiftEndedAt ? new Date(r.lastShiftEndedAt).toLocaleString() : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Revenue by destination zone</h3>
        <table>
          <thead><tr><th>Zone</th><th>Revenue (PKR)</th></tr></thead>
          <tbody>
            {Object.entries(revenueByZone).map(([z, p]) => (
              <tr key={z}><td>{z}</td><td><strong>{(p / 100).toLocaleString()}</strong></td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Inventory levels by store</h3>
        <table>
          <thead><tr><th>Store</th><th>Distributor</th><th>Type</th><th>State</th><th>Count</th></tr></thead>
          <tbody>
            {(inventory.data ?? []).map((r: any, i: number) => (
              <tr key={i}>
                <td>{r.store_name}</td>
                <td>{r.distributor_name}</td>
                <td><code>{r.cylinder_type_code}</code></td>
                <td>{r.state}</td>
                <td><strong>{r.count}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Driver utilization (last 7 days)</h3>
        <table>
          <thead><tr><th>Driver</th><th>Trips</th><th>Orders delivered</th></tr></thead>
          <tbody>
            {(util.data ?? []).map((r: any) => (
              <tr key={r.driver_id}><td>{r.name}</td><td>{r.trips_count}</td><td>{r.orders_delivered}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

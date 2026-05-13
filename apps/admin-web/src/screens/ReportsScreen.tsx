import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

function defaultSince(days: number) {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

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
  const inventory = useQuery({
    queryKey: ['inventory-by-store-report'],
    queryFn: async () => (await api.get('/inventory/by-store')).data,
  });
  const orders = useQuery({
    queryKey: ['orders-all-report'],
    queryFn: async () => (await api.get('/orders/all')).data,
  });

  const statusCounts: Record<string, number> = {};
  for (const o of orders.data ?? []) statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1;

  const revenueByZone: Record<string, number> = {};
  for (const o of orders.data ?? []) {
    if (o.status === 'DELIVERED') {
      const zone = o.destZone?.name ?? o.destZoneId;
      revenueByZone[zone] = (revenueByZone[zone] ?? 0) + Number(o.deliveryFeePaisa);
    }
  }

  return (
    <>
      <h2>Reports</h2>

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
          Hours computed from driver online/offline toggles. Each shift starts when a driver flips Online and closes when they flip Offline (or go on leave).
        </p>
        <table>
          <thead>
            <tr><th>Driver</th><th>Availability</th><th>Total hours</th><th>Days worked</th><th>Last shift ended</th></tr>
          </thead>
          <tbody>
            {(attendance.data ?? []).map((r: any) => {
              const color =
                r.availability === 'AVAILABLE' ? '#1ea675'
                  : r.availability === 'ON_LEAVE' ? '#f59e0b'
                  : '#6b6f76';
              return (
                <tr key={r.driverId}>
                  <td>{r.name}</td>
                  <td><span style={{ color, fontWeight: 600 }}>● {r.availability}</span></td>
                  <td>{r.totalHours}</td>
                  <td>{r.daysWorked}</td>
                  <td>{r.lastShiftEndedAt ? new Date(r.lastShiftEndedAt).toLocaleString() : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Orders by status</h3>
        <table>
          <thead><tr><th>Status</th><th>Count</th></tr></thead>
          <tbody>
            {Object.entries(statusCounts).map(([s, c]) => (
              <tr key={s}><td>{s}</td><td>{c}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Revenue by zone (DELIVERED orders)</h3>
        <table>
          <thead><tr><th>Zone</th><th>Revenue (PKR)</th></tr></thead>
          <tbody>
            {Object.entries(revenueByZone).map(([z, p]) => (
              <tr key={z}><td>{z}</td><td>{(p / 100).toLocaleString()}</td></tr>
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
                <td>{r.cylinder_type_code}</td>
                <td>{r.state}</td>
                <td>{r.count}</td>
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

import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { messageFor } from '../api/errors';
import { formatDateTime, formatRs } from '../i18n/format';
import { StatusChip } from '../ui';

/**
 * Legacy Reports screen: in no menu, reachable only at `/reports` (ADR-04, G14-03). Its figures come
 * from the office-only `/reports` API; delivery-cost money comes from the ledger (costs taken minus
 * costs returned, API_CONTRACT §7.13), never from summing order fees in the browser. Touched for
 * UX_ADMIN §2.11: money as "Rs 3,450", chips instead of raw values, no id fragments, no developer text.
 */

function defaultSince(days: number) {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

interface City { id: string; name: string }
interface ZoneRevenue { zone_id: string; name: string; order_count: number; revenue_paisa: string | number }
interface FunnelRow { status: string; count: number; percent: number }
interface Decision {
  orderId: string;
  createdAt: string;
  status: string;
  distributor: string;
  client: string;
  origin: string | null;
  destination: string;
  destinationZone: string;
  driver: string | null;
  vehicle: string | null;
  cylinders: string;
  feePaisa: string;
  cancellationReason: string | null;
}
interface AttendanceRow {
  driverId: string;
  name: string;
  availability: string;
  totalHours: number;
  daysWorked: number;
  lastShiftEndedAt: string | null;
}
interface InventoryRow { store_name: string; distributor_name: string; cylinder_type_code: string; state: string; count: number }
interface UtilRow { driver_id: string; name: string; trips_count: number; orders_delivered: number }

function LoadProblem({ error, onRetry, colSpan }: { error: unknown; onRetry: () => void; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ textAlign: 'center', padding: 16 }}>
        <p style={{ color: 'var(--danger-fg)' }}>{messageFor(error)}</p>
        <button onClick={onRetry}>Try again</button>
      </td>
    </tr>
  );
}

export function ReportsScreen() {
  const [attendanceSince, setAttendanceSince] = useState(defaultSince(7));
  const [attendanceUntil, setAttendanceUntil] = useState(new Date().toISOString().slice(0, 10));

  const util = useQuery({
    queryKey: ['driver-util'],
    queryFn: async () => (await api.get<UtilRow[]>('/reports/driver-utilization')).data,
  });
  const attendance = useQuery({
    queryKey: ['driver-attendance', attendanceSince, attendanceUntil],
    queryFn: async () =>
      (
        await api.get<AttendanceRow[]>('/reports/driver-attendance', {
          params: {
            since: new Date(attendanceSince).toISOString(),
            until: new Date(`${attendanceUntil}T23:59:59`).toISOString(),
          },
        })
      ).data,
  });
  const decisions = useQuery({
    queryKey: ['dispatch-decisions'],
    queryFn: async () => (await api.get<Decision[]>('/reports/dispatch-decisions')).data,
  });
  const funnel = useQuery({
    queryKey: ['delivery-funnel'],
    queryFn: async () => (await api.get<{ byStatus: FunnelRow[] }>('/reports/delivery-funnel')).data,
  });
  const inventory = useQuery({
    queryKey: ['inventory-by-store-report'],
    queryFn: async () => (await api.get<InventoryRow[]>('/inventory/by-store')).data,
  });
  const cities = useQuery({ queryKey: ['cities'], queryFn: async () => (await api.get<City[]>('/cities')).data });
  const realCities = (cities.data ?? []).filter((c) => !c.id.startsWith('seed-'));
  const zoneReports = useQueries({
    queries: realCities.map((city) => ({
      queryKey: ['reports', 'orders-by-zone', city.id],
      queryFn: async () => (await api.get<ZoneRevenue[]>(`/reports/orders-by-zone/${city.id}`)).data,
    })),
  });

  const zoneRows = useMemo(
    () =>
      zoneReports
        .flatMap((q) => q.data ?? [])
        .filter((row) => Number(row.order_count) > 0 || Number(row.revenue_paisa) !== 0)
        .sort((a, b) => Number(b.revenue_paisa) - Number(a.revenue_paisa)),
    [zoneReports],
  );
  const totalCostsTaken = zoneRows.reduce((sum, row) => sum + BigInt(String(row.revenue_paisa)), 0n);
  const zonesFailed = zoneReports.find((q) => q.isError);

  const byStatus = funnel.data?.byStatus ?? [];
  const deliveredCount = byStatus.find((r) => r.status === 'DELIVERED')?.count ?? 0;
  const failedCount = byStatus.find((r) => r.status === 'FAILED')?.count ?? 0;
  const cancelledCount = byStatus.find((r) => r.status === 'CANCELLED')?.count ?? 0;
  const completed = deliveredCount + failedCount + cancelledCount;
  const successRate = completed > 0 ? Math.round((deliveredCount / completed) * 1000) / 10 : 0;

  return (
    <div className="legacy-old">
      <h2>Reports</h2>

      <div className="kpi">
        <div className="card">
          <div className="label">Delivery costs taken (last 30 days)</div>
          <div className="value" style={{ color: 'var(--success-fg)' }}>{formatRs(totalCostsTaken)}</div>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 11 }}>Costs taken from wallets, minus costs returned on cancels.</p>
        </div>
        <div className="card">
          <div className="label">Delivered (last 30 days)</div>
          <div className="value">{successRate}%</div>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 11 }}>
            {deliveredCount} delivered of {completed} finished
          </p>
        </div>
        <div className="card">
          <div className="label">Could not deliver</div>
          <div className="value" style={{ color: 'var(--danger-fg)' }}>{failedCount}</div>
        </div>
        <div className="card">
          <div className="label">Cancelled</div>
          <div className="value" style={{ color: 'var(--text-muted)' }}>{cancelledCount}</div>
        </div>
      </div>

      <div className="card">
        <h3>Order outcomes (last 30 days)</h3>
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Orders</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {byStatus.map((r) => (
              <tr key={r.status}>
                <td>
                  <StatusChip kind="orderStatus" value={r.status} />
                </td>
                <td>
                  <strong>{r.count}</strong>
                </td>
                <td>{r.percent}%</td>
              </tr>
            ))}
            {funnel.isError && <LoadProblem error={funnel.error} onRetry={() => void funnel.refetch()} colSpan={3} />}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Recent assignments (last 7 days)</h3>
        <p className="muted">Orders that got a driver: the driver and van, the store the trip started from, and the order's delivery cost.</p>
        <table>
          <thead>
            <tr>
              <th>Placed</th>
              <th>Distributor</th>
              <th>Customer</th>
              <th>Driver and van</th>
              <th>From store to zone</th>
              <th>Cylinders</th>
              <th>Status</th>
              <th>Delivery cost</th>
            </tr>
          </thead>
          <tbody>
            {(decisions.data ?? []).map((d) => (
              <tr key={d.orderId}>
                <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(d.createdAt)}</td>
                <td>{d.distributor}</td>
                <td>{d.client}</td>
                <td>
                  {d.driver ?? '—'}
                  {d.vehicle && (
                    <div className="muted" style={{ fontSize: 11 }}>
                      {d.vehicle}
                    </div>
                  )}
                </td>
                <td>
                  {d.origin ?? '—'} → {d.destinationZone}
                  <div className="muted" style={{ fontSize: 11 }}>
                    {d.destination}
                  </div>
                </td>
                <td>{d.cylinders}</td>
                <td>
                  <StatusChip kind="orderStatus" value={d.status} />
                  {d.cancellationReason && (
                    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                      {d.cancellationReason}
                    </div>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{formatRs(d.feePaisa)}</td>
              </tr>
            ))}
            {decisions.isError && <LoadProblem error={decisions.error} onRetry={() => void decisions.refetch()} colSpan={8} />}
            {!decisions.isPending && !decisions.isError && (decisions.data ?? []).length === 0 && (
              <tr>
                <td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                  No orders got a driver in the last 7 days.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
          <h3 style={{ margin: 0 }}>Driver attendance</h3>
          <div className="flex" style={{ gap: 12 }}>
            <div>
              <label htmlFor="attendance-from">From</label>
              <input id="attendance-from" type="date" value={attendanceSince} onChange={(e) => setAttendanceSince(e.target.value)} />
            </div>
            <div>
              <label htmlFor="attendance-to">To</label>
              <input id="attendance-to" type="date" value={attendanceUntil} onChange={(e) => setAttendanceUntil(e.target.value)} />
            </div>
          </div>
        </div>
        <p className="muted">Hours between a driver going on duty and off duty in the driver app.</p>
        <table>
          <thead>
            <tr>
              <th>Driver</th>
              <th>Availability</th>
              <th>Hours</th>
              <th>Days worked</th>
              <th>Last shift ended</th>
            </tr>
          </thead>
          <tbody>
            {(attendance.data ?? []).map((r) => (
              <tr key={r.driverId}>
                <td>{r.name}</td>
                <td>
                  <StatusChip kind="driver" value={r.availability} />
                </td>
                <td>
                  <strong>{r.totalHours}</strong>
                </td>
                <td>{r.daysWorked}</td>
                <td className="muted">{r.lastShiftEndedAt ? formatDateTime(r.lastShiftEndedAt) : '—'}</td>
              </tr>
            ))}
            {attendance.isError && <LoadProblem error={attendance.error} onRetry={() => void attendance.refetch()} colSpan={5} />}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Delivery costs by customer zone (last 30 days)</h3>
        <table>
          <thead>
            <tr>
              <th>Zone</th>
              <th>Orders</th>
              <th>Costs taken</th>
            </tr>
          </thead>
          <tbody>
            {zoneRows.map((row) => (
              <tr key={row.zone_id}>
                <td>{row.name}</td>
                <td>{row.order_count}</td>
                <td>
                  <strong>{formatRs(String(row.revenue_paisa))}</strong>
                </td>
              </tr>
            ))}
            {zonesFailed && <LoadProblem error={zonesFailed.error} onRetry={() => void zonesFailed.refetch()} colSpan={3} />}
            {!zonesFailed && zoneRows.length === 0 && (
              <tr>
                <td colSpan={3} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                  No orders in the last 30 days.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Cylinders in stores</h3>
        <table>
          <thead>
            <tr>
              <th>Store</th>
              <th>Distributor</th>
              <th>Size</th>
              <th>State</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            {(inventory.data ?? []).map((r, i) => (
              <tr key={i}>
                <td>{r.store_name}</td>
                <td>{r.distributor_name}</td>
                <td>{r.cylinder_type_code}</td>
                <td>
                  <StatusChip kind="cylinder" value={r.state} />
                </td>
                <td>
                  <strong>{r.count}</strong>
                </td>
              </tr>
            ))}
            {inventory.isError && <LoadProblem error={inventory.error} onRetry={() => void inventory.refetch()} colSpan={5} />}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Driver trips (last 7 days)</h3>
        <table>
          <thead>
            <tr>
              <th>Driver</th>
              <th>Trips finished</th>
              <th>Orders delivered</th>
            </tr>
          </thead>
          <tbody>
            {(util.data ?? []).map((r) => (
              <tr key={r.driver_id}>
                <td>{r.name}</td>
                <td>{r.trips_count}</td>
                <td>{r.orders_delivered}</td>
              </tr>
            ))}
            {util.isError && <LoadProblem error={util.error} onRetry={() => void util.refetch()} colSpan={3} />}
          </tbody>
        </table>
      </div>
    </div>
  );
}

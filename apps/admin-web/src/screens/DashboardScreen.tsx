import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useRouteStore } from '../store/route';

const STATUS_TONE: Record<string, string> = {
  PENDING: 'pill-warn',
  CONFIRMED: 'pill-primary',
  ASSIGNED: 'pill-primary',
  IN_TRANSIT: 'pill-primary',
  DELIVERED: 'pill-ok',
  CANCELLED: 'pill-neutral',
  FAILED: 'pill-danger',
};

export function DashboardScreen() {
  const go = useRouteStore((s) => s.go);
  const drivers = useQuery({ queryKey: ['drivers'], queryFn: async () => (await api.get('/drivers')).data });
  const orders = useQuery({ queryKey: ['orders-all-dash'], queryFn: async () => (await api.get('/orders/all')).data });
  const alerts = useQuery({
    queryKey: ['alerts-open'],
    queryFn: async () => (await api.get('/alerts?status=OPEN')).data,
    refetchInterval: 30000,
  });

  const allOrders = Array.isArray(orders.data) ? orders.data : [];
  const allDrivers = Array.isArray(drivers.data) ? drivers.data : [];
  const onlineDrivers = allDrivers.filter((d: any) => d.isOnline).length;
  const activeOrders = allOrders.filter((o: any) => ['ASSIGNED', 'IN_TRANSIT'].includes(o.status)).length;
  const pendingOrders = allOrders.filter((o: any) => o.status === 'PENDING').length;
  const deliveredToday = allOrders.filter(
    (o: any) => o.status === 'DELIVERED' &&
      new Date(o.updatedAt ?? o.createdAt).toDateString() === new Date().toDateString()
  ).length;

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ marginBottom: 0 }}>Dashboard</h2>
        <button onClick={() => go('live')}>Open live deliveries →</button>
      </div>

      <div className="kpi">
        <div className="card" style={{ cursor: 'pointer' }} onClick={() => go('drivers')}>
          <div className="label">Drivers online</div>
          <div className="value">{onlineDrivers} <span style={{ color: 'var(--muted)', fontSize: 14, fontWeight: 400 }}>/ {allDrivers.length}</span></div>
        </div>
        <div className="card" style={{ cursor: 'pointer' }} onClick={() => go('orders')}>
          <div className="label">Active deliveries</div>
          <div className="value" style={{ color: 'var(--primary)' }}>{activeOrders}</div>
        </div>
        <div className="card" style={{ cursor: 'pointer' }} onClick={() => go('orders')}>
          <div className="label">Pending dispatch</div>
          <div className="value" style={{ color: 'var(--warn)' }}>{pendingOrders}</div>
        </div>
        <div className="card">
          <div className="label">Delivered today</div>
          <div className="value" style={{ color: 'var(--ok)' }}>{deliveredToday}</div>
        </div>
        <div className="card" style={{ cursor: 'pointer' }} onClick={() => go('alerts')}>
          <div className="label">Open alerts</div>
          <div className="value" style={{ color: (Array.isArray(alerts.data) ? alerts.data.length : 0) > 0 ? 'var(--danger)' : 'var(--text)' }}>
            {Array.isArray(alerts.data) ? alerts.data.length : 0}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Recent orders</h3>
        <table>
          <thead><tr><th>ID</th><th>Distributor</th><th>Client</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>
            {allOrders.slice(0, 10).map((o: any) => (
              <tr key={o.id}>
                <td><code>{o.id.slice(0, 8)}</code></td>
                <td>{o.distributor?.businessName ?? '—'}</td>
                <td>{o.client?.name ?? '—'}</td>
                <td><span className={`pill ${STATUS_TONE[o.status] ?? 'pill-neutral'}`}>{o.status}</span></td>
                <td className="muted">{new Date(o.createdAt).toLocaleString()}</td>
              </tr>
            ))}
            {allOrders.length === 0 && (
              <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                No orders yet. Run <code>npm run seed:demo</code> to populate a sample scenario.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Driver roster</h3>
        <table>
          <thead><tr><th>Name</th><th>Phone</th><th>Online</th><th>Availability</th><th>Vehicle</th></tr></thead>
          <tbody>
            {allDrivers.slice(0, 10).map((d: any) => {
              const availClass = d.availability === 'AVAILABLE' ? 'pill-ok' : d.availability === 'ON_LEAVE' ? 'pill-warn' : 'pill-neutral';
              return (
                <tr key={d.id}>
                  <td>{d.user?.name}</td>
                  <td className="muted">{d.user?.phone}</td>
                  <td>{d.isOnline ? '🟢 yes' : <span className="muted">offline</span>}</td>
                  <td><span className={`pill ${availClass}`}>{d.availability ?? 'AVAILABLE'}</span></td>
                  <td>{d.currentVehicle?.plateNo ?? <span className="muted">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

export function DashboardScreen() {
  const drivers = useQuery({ queryKey: ['drivers'], queryFn: async () => (await api.get('/drivers')).data });
  const orders = useQuery({ queryKey: ['orders'], queryFn: async () => (await api.get('/orders')).data });

  return (
    <>
      <h2>Dashboard</h2>
      <div className="card">
        <h3>Recent orders</h3>
        <table>
          <thead><tr><th>ID</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>
            {(orders.data ?? []).slice(0, 10).map((o: any) => (
              <tr key={o.id}><td>{o.id.slice(0, 8)}</td><td>{o.status}</td><td>{new Date(o.createdAt).toLocaleString()}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3>Drivers</h3>
        <table>
          <thead><tr><th>Name</th><th>Online</th><th>Vehicle</th></tr></thead>
          <tbody>
            {(drivers.data ?? []).map((d: any) => (
              <tr key={d.id}>
                <td>{d.user?.name}</td>
                <td>{d.isOnline ? '🟢' : '⚪'}</td>
                <td>{d.currentVehicle?.plateNo ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

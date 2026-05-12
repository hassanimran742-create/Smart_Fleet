import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

export function ReportsScreen() {
  const util = useQuery({
    queryKey: ['driver-util'],
    queryFn: async () => (await api.get('/reports/driver-utilization')).data,
  });
  return (
    <>
      <h2>Reports</h2>
      <div className="card">
        <h3>Driver utilization (7d)</h3>
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

import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

export function ReportsScreen() {
  const util = useQuery({
    queryKey: ['driver-util'],
    queryFn: async () => (await api.get('/reports/driver-utilization')).data,
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

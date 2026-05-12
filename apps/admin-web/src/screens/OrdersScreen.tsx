import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

export function OrdersScreen() {
  const { data } = useQuery({ queryKey: ['orders'], queryFn: async () => (await api.get('/orders')).data });
  return (
    <>
      <h2>Orders</h2>
      <div className="card">
        <table>
          <thead><tr><th>ID</th><th>Status</th><th>Payment</th><th>Created</th></tr></thead>
          <tbody>
            {(data ?? []).map((o: any) => (
              <tr key={o.id}>
                <td>{o.id.slice(0, 8)}</td>
                <td>{o.status}</td>
                <td>{o.paymentStatus}</td>
                <td>{new Date(o.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

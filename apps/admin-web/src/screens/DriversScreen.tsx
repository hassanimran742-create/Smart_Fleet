import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

export function DriversScreen() {
  const { data } = useQuery({ queryKey: ['drivers'], queryFn: async () => (await api.get('/drivers')).data });
  return (
    <>
      <h2>Drivers</h2>
      <div className="card">
        <table>
          <thead><tr><th>Name</th><th>Licence</th><th>Online</th><th>Vehicle</th><th>Zone</th></tr></thead>
          <tbody>
            {(data ?? []).map((d: any) => (
              <tr key={d.id}>
                <td>{d.user?.name}</td>
                <td>{d.licenceNo}</td>
                <td>{d.isOnline ? '🟢' : '⚪'}</td>
                <td>{d.currentVehicle?.plateNo ?? '—'}</td>
                <td>{d.currentZoneId ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

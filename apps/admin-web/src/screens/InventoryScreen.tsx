import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

interface InventoryRow {
  store_id: string;
  store_name: string;
  distributor_id: string;
  distributor_name: string;
  cylinder_type_code: string;
  state: string;
  count: number;
}

export function InventoryScreen() {
  const { data } = useQuery({
    queryKey: ['inventory-by-store'],
    queryFn: async () => (await api.get<InventoryRow[]>('/inventory/by-store')).data,
    refetchInterval: 30000,
  });

  // Group by store -> distributor -> rows
  const grouped: Record<string, Record<string, InventoryRow[]>> = {};
  for (const r of data ?? []) {
    grouped[r.store_name] ??= {};
    grouped[r.store_name][r.distributor_name] ??= [];
    grouped[r.store_name][r.distributor_name].push(r);
  }

  return (
    <>
      <h2>Inventory</h2>
      <p className="muted">Auto-refreshes every 30s. Counts are computed from the cylinder custody event log.</p>
      {Object.keys(grouped).length === 0 && (
        <div className="card"><p className="muted">No inventory yet. Drop full cylinders at a store via SCAN_IN to populate.</p></div>
      )}
      {Object.entries(grouped).map(([storeName, distributors]) => (
        <div className="card" key={storeName}>
          <h3>{storeName}</h3>
          <table>
            <thead>
              <tr><th>Distributor</th><th>Cylinder type</th><th>Full</th><th>Empty</th></tr>
            </thead>
            <tbody>
              {Object.entries(distributors).map(([dName, rows]) => {
                // pivot per cylinder type
                const types: Record<string, { full: number; empty: number }> = {};
                for (const r of rows) {
                  types[r.cylinder_type_code] ??= { full: 0, empty: 0 };
                  if (r.state === 'FULL') types[r.cylinder_type_code].full += r.count;
                  if (r.state === 'EMPTY') types[r.cylinder_type_code].empty += r.count;
                }
                return Object.entries(types).map(([code, counts], idx) => (
                  <tr key={`${dName}-${code}`}>
                    <td>{idx === 0 ? dName : ''}</td>
                    <td>{code}</td>
                    <td>{counts.full}</td>
                    <td>{counts.empty}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

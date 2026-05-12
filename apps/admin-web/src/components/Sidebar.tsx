import { useRouteStore } from '../store/route';
import { useAuthStore } from '../store/auth';

const PAGES = [
  { id: 'dashboard',    label: 'Dashboard' },
  { id: 'orders',       label: 'Orders' },
  { id: 'drivers',      label: 'Drivers' },
  { id: 'distributors', label: 'Distributors' },
  { id: 'stores',       label: 'Stores' },
  { id: 'zones',        label: 'Zones' },
  { id: 'pricing',      label: 'Pricing' },
  { id: 'reports',      label: 'Reports' },
] as const;

export function Sidebar() {
  const { page, go } = useRouteStore();
  const { clear } = useAuthStore();

  return (
    <aside className="sidebar">
      <h1>Smart_Fleet</h1>
      <nav>
        {PAGES.map((p) => (
          <button
            key={p.id}
            className={page === p.id ? 'active' : ''}
            onClick={() => go(p.id as any)}
          >
            {p.label}
          </button>
        ))}
        <button onClick={clear} style={{ marginTop: 24, color: '#d33a3a' }}>
          Sign out
        </button>
      </nav>
    </aside>
  );
}

import { useQuery } from '@tanstack/react-query';
import { useRouteStore } from '../store/route';
import { useAuthStore } from '../store/auth';
import { api } from '../api/client';

type PageDef = {
  id: string;
  label: string;
  badge?: boolean;
  superAdminOnly?: boolean;
};

const PAGES: PageDef[] = [
  { id: 'dashboard',         label: 'Dashboard' },
  { id: 'live',              label: 'Live deliveries' },
  { id: 'orders',            label: 'Orders' },
  { id: 'alerts',            label: 'Alerts', badge: true },
  { id: 'drivers',           label: 'Drivers' },
  { id: 'vehicles',          label: 'Vehicles' },
  { id: 'distributors',      label: 'Distributors' },
  { id: 'payments',          label: 'Payments' },
  { id: 'stores',            label: 'Stores' },
  { id: 'inventory',         label: 'Inventory' },
  { id: 'qr-generator',      label: 'QR generator' },
  { id: 'transfers',         label: 'Inventory roll plan' },
  { id: 'filling-stations',  label: 'Filling stations' },
  { id: 'zones',             label: 'Zones' },
  { id: 'pricing',           label: 'Pricing' },
  { id: 'reports',           label: 'Reports',       superAdminOnly: true },
  { id: 'fuel-report',       label: 'Fuel & km',     superAdminOnly: true },
  { id: 'expenses',          label: 'Expenses',      superAdminOnly: true },
  { id: 'profile',           label: 'My profile' },
];

export function Sidebar() {
  const { page, go } = useRouteStore();
  const { clear, token, role } = useAuthStore();
  const isSuper = role === 'SUPER_ADMIN';

  const unread = useQuery({
    queryKey: ['alerts-unread'],
    queryFn: async () => (await api.get('/alerts/unread-count')).data,
    refetchInterval: 15000,
    enabled: !!token,
  });

  const visible = PAGES.filter((p) => !p.superAdminOnly || isSuper);

  return (
    <aside className="sidebar">
      <h1>LPG Management</h1>
      <p style={{ padding: '0 18px', margin: 0, fontSize: 11, color: '#7f838c' }}>
        {role === 'SUPER_ADMIN' ? '★ Super Admin' : role ?? 'signed in'}
      </p>
      <nav>
        {visible.map((p) => (
          <button
            key={p.id}
            className={page === p.id ? 'active' : ''}
            onClick={() => go(p.id as any)}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <span>{p.label}</span>
              {p.badge && unread.data?.count > 0 && (
                <span style={{ background: 'var(--danger)', color: 'white', fontSize: 11, padding: '2px 6px', borderRadius: 10 }}>
                  {unread.data.count}
                </span>
              )}
            </span>
          </button>
        ))}
        <button onClick={clear} style={{ marginTop: 24, color: '#d33a3a' }}>Sign out</button>
      </nav>
    </aside>
  );
}

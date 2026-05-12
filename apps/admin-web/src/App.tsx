import { useAuthStore } from './store/auth';
import { Sidebar } from './components/Sidebar';
import { LoginScreen } from './screens/LoginScreen';
import { DashboardScreen } from './screens/DashboardScreen';
import { ZonesScreen } from './screens/ZonesScreen';
import { StoresScreen } from './screens/StoresScreen';
import { OrdersScreen } from './screens/OrdersScreen';
import { DriversScreen } from './screens/DriversScreen';
import { PricingScreen } from './screens/PricingScreen';
import { DistributorsScreen } from './screens/DistributorsScreen';
import { ReportsScreen } from './screens/ReportsScreen';
import { useRouteStore } from './store/route';

export function App() {
  const { token } = useAuthStore();
  const { page } = useRouteStore();

  if (!token) return <LoginScreen />;

  let body = <DashboardScreen />;
  switch (page) {
    case 'zones':        body = <ZonesScreen />; break;
    case 'stores':       body = <StoresScreen />; break;
    case 'orders':       body = <OrdersScreen />; break;
    case 'drivers':      body = <DriversScreen />; break;
    case 'pricing':      body = <PricingScreen />; break;
    case 'distributors': body = <DistributorsScreen />; break;
    case 'reports':      body = <ReportsScreen />; break;
    default:             body = <DashboardScreen />;
  }

  return (
    <div className="layout">
      <Sidebar />
      <main className="content">{body}</main>
    </div>
  );
}

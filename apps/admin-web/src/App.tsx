import { useAuthStore } from './store/auth';
import { Sidebar } from './components/Sidebar';
import { LoginScreen } from './screens/LoginScreen';
import { DashboardScreen } from './screens/DashboardScreen';
import { ZonesScreen } from './screens/ZonesScreen';
import { StoresScreen } from './screens/StoresScreen';
import { OrdersScreen } from './screens/OrdersScreen';
import { DriversScreen } from './screens/DriversScreen';
import { VehiclesScreen } from './screens/VehiclesScreen';
import { PricingScreen } from './screens/PricingScreen';
import { DistributorsScreen } from './screens/DistributorsScreen';
import { ReportsScreen } from './screens/ReportsScreen';
import { InventoryScreen } from './screens/InventoryScreen';
import { LiveDeliveriesScreen } from './screens/LiveDeliveriesScreen';
import { TransfersScreen } from './screens/TransfersScreen';
import { AlertsScreen } from './screens/AlertsScreen';
import { FillingStationsScreen } from './screens/FillingStationsScreen';
import { FuelReportScreen } from './screens/FuelReportScreen';
import { ExpensesScreen } from './screens/ExpensesScreen';
import { QrGeneratorScreen } from './screens/QrGeneratorScreen';
import { useRouteStore } from './store/route';
import { useIdleLogout } from './hooks/useIdleLogout';

export function App() {
  const { token } = useAuthStore();
  const { page } = useRouteStore();

  // Sign out after 10 minutes of zero interaction. Active use (clicks,
  // typing, scrolling, mouse moves) keeps the session alive indefinitely
  // up to the JWT's 12-hour absolute lifetime.
  useIdleLogout(10 * 60 * 1000);

  if (!token) return <LoginScreen />;

  let body;
  switch (page) {
    case 'zones':        body = <ZonesScreen />; break;
    case 'stores':       body = <StoresScreen />; break;
    case 'orders':       body = <OrdersScreen />; break;
    case 'drivers':      body = <DriversScreen />; break;
    case 'vehicles':     body = <VehiclesScreen />; break;
    case 'pricing':      body = <PricingScreen />; break;
    case 'distributors': body = <DistributorsScreen />; break;
    case 'reports':      body = <ReportsScreen />; break;
    case 'inventory':    body = <InventoryScreen />; break;
    case 'accessories':  body = <InventoryScreen />; break;
    case 'live':         body = <LiveDeliveriesScreen />; break;
    case 'transfers':    body = <TransfersScreen />; break;
    case 'alerts':       body = <AlertsScreen />; break;
    case 'filling-stations': body = <FillingStationsScreen />; break;
    case 'fuel-report':      body = <FuelReportScreen />; break;
    case 'expenses':         body = <ExpensesScreen />; break;
    case 'qr-generator':     body = <QrGeneratorScreen />; break;
    default:                 body = <DashboardScreen />;
  }

  return (
    <div className="layout">
      <Sidebar />
      <main className="content">{body}</main>
    </div>
  );
}

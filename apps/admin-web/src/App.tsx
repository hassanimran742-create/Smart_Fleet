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
import { AccessoriesScreen } from './screens/AccessoriesScreen';
import { LiveDeliveriesScreen } from './screens/LiveDeliveriesScreen';
import { TransfersScreen } from './screens/TransfersScreen';
import { AlertsScreen } from './screens/AlertsScreen';
import { FillingStationsScreen } from './screens/FillingStationsScreen';
import { FuelReportScreen } from './screens/FuelReportScreen';
import { ExpensesScreen } from './screens/ExpensesScreen';
import { useRouteStore } from './store/route';

export function App() {
  const { token } = useAuthStore();
  const { page } = useRouteStore();

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
    case 'accessories':  body = <AccessoriesScreen />; break;
    case 'live':         body = <LiveDeliveriesScreen />; break;
    case 'transfers':    body = <TransfersScreen />; break;
    case 'alerts':       body = <AlertsScreen />; break;
    case 'filling-stations': body = <FillingStationsScreen />; break;
    case 'fuel-report':      body = <FuelReportScreen />; break;
    case 'expenses':         body = <ExpensesScreen />; break;
    default:                 body = <DashboardScreen />;
  }

  return (
    <div className="layout">
      <Sidebar />
      <main className="content">{body}</main>
    </div>
  );
}

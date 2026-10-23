import { VehicleLoad, useVanLoad } from '../../components/VehicleLoad';
import { DriverScreen, usePullToRefresh } from './components';

/**
 * My van (driver spec D15; VanScreen in Inc 2): the plate, how many cylinders are on it, and each size
 * with its full and empty counts. The office gives and changes vans; without one the screen says "No
 * van yet." with Call office. It polls every 10 seconds while on screen.
 */
export function VehicleInfoScreen() {
  const van = useVanLoad();
  const pull = usePullToRefresh(van.refetch);
  return (
    <DriverScreen refreshing={pull.refreshing} onRefresh={pull.onRefresh}>
      <VehicleLoad />
    </DriverScreen>
  );
}

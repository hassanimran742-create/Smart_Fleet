import { VehicleLoad, useVanLoad } from '../../components/VehicleLoad';
import { DriverScreen, usePullToRefresh } from './components';

/**
 * My van (UX_MOBILE §5 copy fix; VanScreen in Inc 2): the van's plate and what is on it, full and
 * empty, by size. The office gives and changes vans; without one the card says to call the office.
 * The old capacity maths (slots per size) is gone: it guessed instead of counting.
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

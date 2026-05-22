import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Body, Caption, Card, Heading, Pill, Screen } from '../../components/ui';
import { space } from '../../theme';

/**
 * Read-only view of the driver's currently assigned vehicle. Admin can
 * reassign on the Vehicles → Assign drivers tab in the admin web.
 */
export function VehicleInfoScreen() {
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/users/me')).data,
  });
  const vehicle = me.data?.driverProfile?.currentVehicle;

  if (!vehicle) {
    return (
      <Screen>
        <Card>
          <Heading size="h3">No vehicle assigned</Heading>
          <Caption style={{ marginTop: space.sm }}>
            Ask admin to assign a vehicle to you so you can pick up cylinders and start deliveries.
          </Caption>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Card>
        <Caption>YOUR VEHICLE</Caption>
        <Heading size="h1" style={{ marginTop: 6 }}>{vehicle.plateNo}</Heading>
        <Pill label={vehicle.status ?? 'ACTIVE'} tone={vehicle.status === 'ACTIVE' ? 'ok' : 'warn'} style={{ marginTop: space.sm, alignSelf: 'flex-start' }} />
      </Card>

      <Card>
        <Heading size="h3">Capacity</Heading>
        <Caption style={{ marginTop: space.sm }}>
          The vehicle holds <Body style={{ fontWeight: '700' }}>{vehicle.capacityUnits}</Body> 11-kg cylinder slots.
        </Caption>
        <View style={{ marginTop: space.sm }}>
          <Row label="11.8 kg cylinders" value={`up to ${vehicle.capacityUnits}`} />
          <Row label="15 kg cylinders" value={`up to ${Math.floor(vehicle.capacityUnits / 2)}`} />
          <Row label="45 kg cylinders" value={`up to ${Math.floor(vehicle.capacityUnits / 4)}`} />
        </View>
      </Card>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
      <Caption>{label}</Caption>
      <Body style={{ fontWeight: '600' }}>{value}</Body>
    </View>
  );
}

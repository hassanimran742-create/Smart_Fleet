import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { api } from '../../api/client';
import { Body, Button, Card, Caption, Heading, Input, Pill, Screen } from '../../components/ui';
import { space } from '../../theme';

export function FuelRefillScreen() {
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [vehiclePlate, setVehiclePlate] = useState<string>('');
  const [currentOdo, setCurrentOdo] = useState<number>(0);
  const [litres, setLitres] = useState('');
  const [costPkr, setCostPkr] = useState('');
  const [odometer, setOdometer] = useState('');
  const [station, setStation] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  // Find the driver's current vehicle on mount
  useState(() => {
    (async () => {
      const driverId = await SecureStore.getItemAsync('driverId');
      if (!driverId) return;
      try {
        const { data } = await api.get(`/drivers/${driverId}`);
        if (data.currentVehicle) {
          setVehicleId(data.currentVehicle.id);
          setVehiclePlate(data.currentVehicle.plateNo);
          setCurrentOdo(data.currentVehicle.currentOdometerKm ?? 0);
          setOdometer(String(data.currentVehicle.currentOdometerKm ?? 0));
        }
      } catch {}
    })();
  });

  const recent = useQuery({
    queryKey: ['my-refills'],
    queryFn: async () => (await api.get('/fuel-refills/mine')).data,
  });

  async function submit() {
    if (!vehicleId) {
      Alert.alert('No vehicle', 'You don\'t have a vehicle assigned. Ask the admin to assign one.');
      return;
    }
    const odo = Number(odometer);
    const lt = Number(litres);
    const cost = Number(costPkr);
    if (!Number.isFinite(odo) || !Number.isFinite(lt) || !Number.isFinite(cost)) {
      Alert.alert('Missing values', 'Litres, cost, and odometer reading are all required.');
      return;
    }
    if (odo < currentOdo) {
      Alert.alert('Odometer too low', `Vehicle's last reading was ${currentOdo} km. Your new reading must be ≥ that.`);
      return;
    }
    setLoading(true);
    try {
      await api.post('/fuel-refills', {
        vehicleId,
        litres: lt,
        costPaisa: Math.round(cost * 100),
        odometerKm: odo,
        fuelStation: station || undefined,
        notes: notes || undefined,
      });
      Alert.alert('Refill recorded', `${lt} L for Rs. ${cost.toLocaleString()} logged against ${vehiclePlate}.`);
      setLitres(''); setCostPkr(''); setStation(''); setNotes('');
      setCurrentOdo(odo);
      recent.refetch();
    } catch (e: any) {
      Alert.alert('Failed', e?.response?.data?.message ?? 'Try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen scroll>
      <Card>
        <Heading size="h3">Record a fuel refill</Heading>
        <Body muted style={{ marginTop: 4, marginBottom: space.md }}>
          {vehicleId
            ? `Logging against ${vehiclePlate} · last odometer ${currentOdo} km`
            : 'No vehicle assigned — ask admin'}
        </Body>
        <Input label="Litres *" value={litres} onChangeText={setLitres} keyboardType="decimal-pad" placeholder="e.g. 32.5" />
        <Input label="Cost (PKR) *" value={costPkr} onChangeText={setCostPkr} keyboardType="decimal-pad" placeholder="e.g. 9200" />
        <Input label="Odometer reading (km) *" value={odometer} onChangeText={setOdometer} keyboardType="number-pad" />
        <Input label="Fuel station" value={station} onChangeText={setStation} placeholder="e.g. PSO Pirwadhai" />
        <Input label="Notes" value={notes} onChangeText={setNotes} multiline />
        <Button title={loading ? 'Saving…' : 'Submit refill'} onPress={submit} disabled={loading || !vehicleId} />
      </Card>

      <Card>
        <Heading size="h3">Recent refills</Heading>
        {(recent.data ?? []).length === 0 && <Caption>No refills yet.</Caption>}
        {(recent.data ?? []).map((r: any) => (
          <View key={r.id} style={{ marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: '#eee' }}>
            <Body>
              {Number(r.litres)} L · Rs. {(Number(r.costPaisa) / 100).toLocaleString()} · {r.odometerKm} km
            </Body>
            <Caption>
              {r.vehicle?.plateNo} · {r.fuelStation ?? 'no station'} · {new Date(r.refillAt).toLocaleString()}
            </Caption>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

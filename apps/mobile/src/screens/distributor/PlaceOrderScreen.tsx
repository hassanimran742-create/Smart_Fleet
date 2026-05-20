import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Body, Button, Caption, Card, Heading, Input, Screen } from '../../components/ui';
import { colors, radius, space } from '../../theme';

interface CylinderType {
  id: string;
  code: string;
  name: string;
  weightKg: string;
}

/**
 * Minimal order form. Cylinder type is chosen via large chips —
 * the uneducated-user-friendly version. No technical text fields
 * like "cylinder type id".
 */
export function PlaceOrderScreen() {
  const nav = useNavigation<any>();
  const [step, setStep] = useState<'who' | 'what' | 'where' | 'confirm'>('who');

  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [cylinderTypeId, setCylinderTypeId] = useState('');
  const [cylinderTypeLabel, setCylinderTypeLabel] = useState('');
  const [fullCount, setFullCount] = useState('1');
  const [label, setLabel] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const clients = useQuery({
    queryKey: ['my-clients'],
    queryFn: async () => (await api.get('/clients')).data,
  });
  const types = useQuery({
    queryKey: ['cylinder-types'],
    queryFn: async () => (await api.get<CylinderType[]>('/cylinder-types')).data,
  });

  async function submit() {
    if (!clientId || !cylinderTypeId || !fullCount || !label || !lat || !lng) {
      Alert.alert('Missing info', 'Please pick a customer, cylinder type, quantity, and delivery address.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/orders', {
        clientId,
        deliveryLabel: label,
        deliveryLocation: { lat: Number(lat), lng: Number(lng) },
        lines: [{ cylinderTypeId, fullCount: Number(fullCount), expectedReturnCount: Number(fullCount) }],
      });
      Alert.alert('Order placed', 'A driver will be assigned shortly.', [
        { text: 'OK', onPress: () => nav.goBack() },
      ]);
    } catch (e: any) {
      Alert.alert('Could not place order', e?.response?.data?.message ?? 'Try again');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll>
      <StepDots step={step} />

      {step === 'who' && (
        <Card>
          <Heading size="h3">Who is this for?</Heading>
          <Caption style={{ marginTop: 4, marginBottom: space.md }}>
            Pick a customer from your list.
          </Caption>
          {(clients.data ?? []).length === 0 && (
            <Body muted>You have no saved customers yet. Add one from the admin portal first.</Body>
          )}
          {(clients.data ?? []).map((c: any) => (
            <ChoiceRow
              key={c.id}
              title={c.name}
              subtitle={c.phone}
              selected={clientId === c.id}
              onPress={() => { setClientId(c.id); setClientName(c.name); }}
            />
          ))}
          <Button
            title="Next →"
            onPress={() => clientId ? setStep('what') : Alert.alert('Pick a customer first')}
            style={{ marginTop: space.md }}
          />
        </Card>
      )}

      {step === 'what' && (
        <Card>
          <Heading size="h3">Which cylinders?</Heading>
          <Caption style={{ marginTop: 4, marginBottom: space.md }}>
            Tap the size you want to deliver.
          </Caption>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md }}>
            {(types.data ?? []).map((t) => {
              const isSel = cylinderTypeId === t.id;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => { setCylinderTypeId(t.id); setCylinderTypeLabel(t.name); }}
                  style={({ pressed }: any) => ({
                    flexBasis: '47%',
                    padding: space.md,
                    borderRadius: radius.md,
                    borderWidth: 2,
                    borderColor: isSel ? colors.primary : colors.border,
                    backgroundColor: isSel ? colors.primarySoft : colors.surface,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Body style={{ fontSize: 26, marginBottom: 4 }}>🛢️</Body>
                  <Heading size="h3" style={{ color: isSel ? colors.primary : colors.text }}>
                    {Number(t.weightKg)} kg
                  </Heading>
                  <Caption>{t.name}</Caption>
                </Pressable>
              );
            })}
          </View>

          <Caption style={{ marginBottom: 4 }}>How many?</Caption>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <BigStep label="−" onPress={() => setFullCount(String(Math.max(1, Number(fullCount) - 1)))} />
            <View style={{ flex: 1, alignItems: 'center', padding: space.md, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
              <Heading size="h1">{fullCount}</Heading>
            </View>
            <BigStep label="+" onPress={() => setFullCount(String(Number(fullCount) + 1))} />
          </View>

          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
            <Button title="← Back" variant="ghost" onPress={() => setStep('who')} fullWidth={false} />
            <Button
              title="Next →"
              onPress={() => cylinderTypeId ? setStep('where') : Alert.alert('Pick a cylinder size')}
            />
          </View>
        </Card>
      )}

      {step === 'where' && (
        <Card>
          <Heading size="h3">Delivery address</Heading>
          <Caption style={{ marginTop: 4, marginBottom: space.md }}>
            Where should the cylinders be delivered?
          </Caption>
          <Input label="Address label" value={label} onChangeText={setLabel} placeholder="e.g. House 14, Street 5, F-7/2" />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Input label="Latitude" value={lat} onChangeText={setLat} keyboardType="decimal-pad" placeholder="33.7177" />
            </View>
            <View style={{ flex: 1 }}>
              <Input label="Longitude" value={lng} onChangeText={setLng} keyboardType="decimal-pad" placeholder="73.0535" />
            </View>
          </View>
          <Caption style={{ marginBottom: space.md }}>
            Tip: get the customer's lat/lng from a Google Maps location share.
          </Caption>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button title="← Back" variant="ghost" onPress={() => setStep('what')} fullWidth={false} />
            <Button title="Review →" onPress={() => label && lat && lng ? setStep('confirm') : Alert.alert('Fill in the address')} />
          </View>
        </Card>
      )}

      {step === 'confirm' && (
        <Card>
          <Heading size="h3">Review order</Heading>
          <SummaryRow label="Customer" value={clientName} />
          <SummaryRow label="Cylinder" value={cylinderTypeLabel} />
          <SummaryRow label="Quantity" value={`${fullCount} cylinder(s)`} />
          <SummaryRow label="Delivery to" value={label} />
          <SummaryRow label="Coordinates" value={`${lat}, ${lng}`} />
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
            <Button title="← Back" variant="ghost" onPress={() => setStep('where')} fullWidth={false} />
            <Button
              title={submitting ? 'Placing…' : 'Place order'}
              variant="success"
              onPress={submit}
              disabled={submitting}
            />
          </View>
        </Card>
      )}
    </Screen>
  );
}

function StepDots({ step }: { step: 'who' | 'what' | 'where' | 'confirm' }) {
  const idx = { who: 0, what: 1, where: 2, confirm: 3 }[step];
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: space.md }}>
      {[0, 1, 2, 3].map((n) => (
        <View
          key={n}
          style={{
            width: n === idx ? 24 : 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: n <= idx ? colors.primary : colors.border,
          }}
        />
      ))}
    </View>
  );
}

function BigStep({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }: any) => ({
        width: 56, height: 56, borderRadius: 28,
        backgroundColor: colors.primary,
        alignItems: 'center', justifyContent: 'center',
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Body style={{ color: 'white', fontSize: 26, fontWeight: '700' }}>{label}</Body>
    </Pressable>
  );
}

function ChoiceRow({
  title, subtitle, selected, onPress,
}: { title: string; subtitle?: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }: any) => ({
        padding: space.md,
        marginVertical: 4,
        borderRadius: radius.md,
        borderWidth: 2,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? colors.primarySoft : colors.surface,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Heading size="h3" style={{ color: selected ? colors.primary : colors.text }}>{title}</Heading>
      {subtitle && <Caption style={{ marginTop: 2 }}>{subtitle}</Caption>}
    </Pressable>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Caption>{label}</Caption>
      <Body style={{ fontWeight: '600', textAlign: 'right', flex: 1, marginLeft: 12 }}>{value}</Body>
    </View>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Body, Button, Caption, Card, Heading, Input, Screen } from '../../components/ui';
import { colors, radius, space } from '../../theme';

interface CylinderType {
  id: string;
  code: string;
  name: string;
  weightKg: string;
}

interface CartLine {
  cylinderTypeId: string;
  label: string;
  weightKg: string;
  fullCount: number;
  expectedReturnCount: number;
}

interface ClientAddress { id: string; label: string; lat: number; lng: number }

// Light wrapper around Nominatim for free-tier geocoding biased to PK.
async function searchAddress(q: string) {
  if (q.trim().length < 3) return [];
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=8&countrycodes=pk&q=${encodeURIComponent(q + ', Pakistan')}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'LPG-Management/1.0' } });
    const data: any[] = await res.json();
    return data.map((r) => ({ name: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }));
  } catch {
    return [];
  }
}

/**
 * Place a new delivery order. Three steps:
 *  1. Customer (pick existing or add new — opens AddClient screen).
 *  2. Cylinder cart — multi-select with per-row quantity.
 *  3. Delivery address — pick from client's saved addresses, or drop a new pin
 *     (with optional name search). Final review then submit.
 */
export function PlaceOrderScreen() {
  const nav = useNavigation<any>();
  const qc = useQueryClient();
  const [step, setStep] = useState<'who' | 'cart' | 'where' | 'confirm'>('who');

  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [area, setArea] = useState('');
  const [label, setLabel] = useState('');
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ name: string; lat: number; lng: number }>>([]);
  const [savedAddrId, setSavedAddrId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const clients = useQuery({
    queryKey: ['my-clients'],
    queryFn: async () => (await api.get('/clients')).data,
    refetchOnWindowFocus: true,
  });
  const types = useQuery({
    queryKey: ['cylinder-types'],
    queryFn: async () => (await api.get<CylinderType[]>('/cylinder-types')).data,
  });
  const savedAddresses = useQuery({
    queryKey: ['client-addresses', clientId],
    queryFn: async () => clientId
      ? (await api.get<ClientAddress[]>(`/clients/${clientId}/addresses`)).data
      : [],
    enabled: !!clientId,
  });

  const mapRef = useRef<MapView>(null);
  const searchTimer = useRef<any>(null);
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!search.trim()) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearchResults(await searchAddress(search));
    }, 500);
    return () => searchTimer.current && clearTimeout(searchTimer.current);
  }, [search]);

  function addToCart(t: CylinderType) {
    setCart((c) => {
      const existing = c.find((x) => x.cylinderTypeId === t.id);
      if (existing) {
        return c.map((x) => x.cylinderTypeId === t.id
          ? { ...x, fullCount: x.fullCount + 1, expectedReturnCount: x.expectedReturnCount + 1 }
          : x);
      }
      return [...c, { cylinderTypeId: t.id, label: t.name, weightKg: t.weightKg, fullCount: 1, expectedReturnCount: 1 }];
    });
  }
  function changeQty(id: string, delta: number) {
    setCart((c) => c
      .map((x) => x.cylinderTypeId === id
        ? { ...x, fullCount: Math.max(0, x.fullCount + delta), expectedReturnCount: Math.max(0, x.expectedReturnCount + delta) }
        : x)
      .filter((x) => x.fullCount > 0));
  }
  function setReturn(id: string, n: number) {
    setCart((c) => c.map((x) => x.cylinderTypeId === id ? { ...x, expectedReturnCount: Math.max(0, n) } : x));
  }
  const cartTotal = cart.reduce((s, x) => s + x.fullCount, 0);

  function pickSavedAddress(a: ClientAddress) {
    setSavedAddrId(a.id);
    setLabel(a.label);
    setPin({ lat: a.lat, lng: a.lng });
    mapRef.current?.animateToRegion({
      latitude: a.lat, longitude: a.lng, latitudeDelta: 0.01, longitudeDelta: 0.01,
    }, 500);
  }

  async function submit() {
    if (!clientId || cart.length === 0 || !pin || !label.trim()) {
      Alert.alert('Missing info', 'Pick customer, cylinders, and a delivery address.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/orders', {
        clientId,
        deliveryLabel: label.trim() + (area ? ` · ${area}` : ''),
        deliveryLocation: { lat: pin.lat, lng: pin.lng },
        lines: cart.map((x) => ({
          cylinderTypeId: x.cylinderTypeId,
          fullCount: x.fullCount,
          expectedReturnCount: x.expectedReturnCount,
        })),
      });
      qc.invalidateQueries({ queryKey: ['orders-mine'] });
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
            Pick from your saved customers, or add a new one.
          </Caption>

          <Button
            title="+ Add new client"
            variant="success"
            onPress={() => nav.navigate('AddClient')}
            style={{ marginBottom: space.md }}
          />

          {(clients.data ?? []).length === 0 ? (
            <Body muted>No saved customers yet. Tap "+ Add new client" above.</Body>
          ) : (
            (clients.data ?? []).map((c: any) => (
              <Pressable
                key={c.id}
                onPress={() => { setClientId(c.id); setClientName(c.name); }}
                style={({ pressed }: any) => ({
                  padding: space.md, marginVertical: 4, borderRadius: radius.md,
                  borderWidth: 2,
                  borderColor: clientId === c.id ? colors.primary : colors.border,
                  backgroundColor: clientId === c.id ? colors.primarySoft : colors.surface,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Heading size="h3" style={{ color: clientId === c.id ? colors.primary : colors.text }}>{c.name}</Heading>
                <Caption style={{ marginTop: 2 }}>{c.phone}{c.area ? ` · ${c.area}` : ''}{c.city ? `, ${c.city}` : ''}</Caption>
              </Pressable>
            ))
          )}

          <Button
            title="Next →"
            onPress={() => clientId ? setStep('cart') : Alert.alert('Pick a customer first')}
            style={{ marginTop: space.md }}
          />
        </Card>
      )}

      {step === 'cart' && (
        <>
          <Card>
            <Heading size="h3">Pick cylinders</Heading>
            <Caption style={{ marginTop: 4, marginBottom: space.md }}>
              Tap a size to add it to the cart. Tap again to add more, or adjust below.
            </Caption>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {(types.data ?? []).map((t) => (
                <Pressable
                  key={t.id}
                  onPress={() => addToCart(t)}
                  style={({ pressed }: any) => ({
                    flexBasis: '47%',
                    padding: space.md, borderRadius: radius.md,
                    borderWidth: 2, borderColor: colors.border,
                    backgroundColor: colors.surface,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Body style={{ fontSize: 26, marginBottom: 4 }}>🛢️</Body>
                  <Heading size="h3">{Number(t.weightKg)} kg</Heading>
                  <Caption>{t.name}</Caption>
                  <Caption style={{ color: colors.primary, marginTop: 4 }}>+ Add to cart</Caption>
                </Pressable>
              ))}
            </View>
          </Card>

          <Card>
            <Heading size="h3">Your cart ({cartTotal})</Heading>
            {cart.length === 0 && <Caption style={{ marginTop: 4 }}>Empty — pick at least one cylinder above.</Caption>}
            {cart.map((x) => (
              <View key={x.cylinderTypeId} style={{ marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Body style={{ fontWeight: '600' }}>{x.label} ({Number(x.weightKg)} kg)</Body>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <RoundBtn label="−" onPress={() => changeQty(x.cylinderTypeId, -1)} />
                    <Body style={{ fontWeight: '700', minWidth: 24, textAlign: 'center' }}>{x.fullCount}</Body>
                    <RoundBtn label="+" onPress={() => changeQty(x.cylinderTypeId, 1)} />
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <Caption>Empties to pick up:</Caption>
                  <RoundBtn label="−" onPress={() => setReturn(x.cylinderTypeId, x.expectedReturnCount - 1)} small />
                  <Body style={{ minWidth: 24, textAlign: 'center' }}>{x.expectedReturnCount}</Body>
                  <RoundBtn label="+" onPress={() => setReturn(x.cylinderTypeId, x.expectedReturnCount + 1)} small />
                </View>
              </View>
            ))}
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
              <Button title="← Back" variant="ghost" onPress={() => setStep('who')} fullWidth={false} />
              <Button
                title="Next →"
                onPress={() => cartTotal > 0 ? setStep('where') : Alert.alert('Add at least one cylinder')}
              />
            </View>
          </Card>
        </>
      )}

      {step === 'where' && (
        <>
          <Card>
            <Heading size="h3">Delivery address</Heading>
            <Caption style={{ marginBottom: space.sm }}>
              Pick a saved address for {clientName}, search, or drop a pin on the map.
            </Caption>

            {(savedAddresses.data ?? []).length > 0 && (
              <>
                <Caption style={{ marginTop: space.sm }}>Saved addresses</Caption>
                {(savedAddresses.data ?? []).map((a) => (
                  <Pressable
                    key={a.id}
                    onPress={() => pickSavedAddress(a)}
                    style={({ pressed }: any) => ({
                      padding: space.sm, marginVertical: 2, borderRadius: radius.md,
                      borderWidth: 1, borderColor: savedAddrId === a.id ? colors.primary : colors.border,
                      backgroundColor: savedAddrId === a.id ? colors.primarySoft : colors.surface,
                      opacity: pressed ? 0.85 : 1,
                    })}
                  >
                    <Body>{a.label}</Body>
                  </Pressable>
                ))}
              </>
            )}

            <Input
              label="Area"
              value={area}
              onChangeText={setArea}
              placeholder='e.g. "F-7", "Bahria Town Phase 4"'
            />
            <Input
              label="Search location"
              value={search}
              onChangeText={setSearch}
              placeholder='e.g. "F-7 Markaz, Islamabad"'
            />
            {searchResults.length > 0 && (
              <View style={{ maxHeight: 160, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginTop: 4 }}>
                {searchResults.map((r) => (
                  <Pressable
                    key={`${r.lat}-${r.lng}`}
                    onPress={() => {
                      setPin({ lat: r.lat, lng: r.lng });
                      setSearch('');
                      setSearchResults([]);
                      mapRef.current?.animateToRegion({
                        latitude: r.lat, longitude: r.lng,
                        latitudeDelta: 0.005, longitudeDelta: 0.005,
                      }, 500);
                    }}
                    style={({ pressed }: any) => ({
                      padding: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border,
                      opacity: pressed ? 0.85 : 1,
                    })}
                  >
                    <Body numberOfLines={2}>{r.name}</Body>
                  </Pressable>
                ))}
              </View>
            )}
          </Card>

          <View style={{ height: 280, borderRadius: radius.lg, overflow: 'hidden', marginBottom: space.md }}>
            <MapView
              ref={mapRef}
              style={{ flex: 1 }}
              initialRegion={{
                latitude: pin?.lat ?? 33.7177,
                longitude: pin?.lng ?? 73.0535,
                latitudeDelta: 0.02, longitudeDelta: 0.02,
              }}
              onPress={(e: any) => {
                const c = e.nativeEvent.coordinate;
                setPin({ lat: c.latitude, lng: c.longitude });
                setSavedAddrId('');
              }}
            >
              {pin && <Marker coordinate={{ latitude: pin.lat, longitude: pin.lng }} />}
            </MapView>
          </View>

          <Card>
            <Input
              label="Address label *"
              value={label}
              onChangeText={setLabel}
              placeholder='e.g. "House 14, Street 5"'
            />
            {pin && (
              <Caption style={{ marginTop: 4 }}>
                Pin at {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
              </Caption>
            )}
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
              <Button title="← Back" variant="ghost" onPress={() => setStep('cart')} fullWidth={false} />
              <Button title="Review →" onPress={() => pin && label.trim() ? setStep('confirm') : Alert.alert('Fill in the address')} />
            </View>
          </Card>
        </>
      )}

      {step === 'confirm' && (
        <Card>
          <Heading size="h3">Review order</Heading>
          <SummaryRow label="Customer" value={clientName} />
          {cart.map((x) => (
            <SummaryRow
              key={x.cylinderTypeId}
              label={`${Number(x.weightKg)} kg × ${x.fullCount}`}
              value={`return ${x.expectedReturnCount}`}
            />
          ))}
          <SummaryRow label="Address" value={label + (area ? ` · ${area}` : '')} />
          {pin && <SummaryRow label="Map pin" value={`${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`} />}
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

function StepDots({ step }: { step: 'who' | 'cart' | 'where' | 'confirm' }) {
  const idx = { who: 0, cart: 1, where: 2, confirm: 3 }[step];
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: space.md }}>
      {[0, 1, 2, 3].map((n) => (
        <View
          key={n}
          style={{
            width: n === idx ? 24 : 8, height: 8, borderRadius: 4,
            backgroundColor: n <= idx ? colors.primary : colors.border,
          }}
        />
      ))}
    </View>
  );
}

function RoundBtn({ label, onPress, small }: { label: string; onPress: () => void; small?: boolean }) {
  const size = small ? 28 : 40;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }: any) => ({
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: colors.primary,
        alignItems: 'center', justifyContent: 'center',
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Body style={{ color: 'white', fontSize: small ? 16 : 20, fontWeight: '700' }}>{label}</Body>
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

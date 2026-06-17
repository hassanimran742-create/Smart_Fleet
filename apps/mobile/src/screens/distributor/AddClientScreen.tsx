import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import MapView, { Marker } from '../../components/MapStub';
import * as Location from 'expo-location';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { api } from '../../api/client';
import { Body, Button, Caption, Card, Heading, Input, Screen } from '../../components/ui';
import { colors, radius, space } from '../../theme';

// Free Nominatim search (OpenStreetMap). No API key needed but requires a
// User-Agent. We default search bias to Islamabad/Rawalpindi by appending it.
async function searchAddress(q: string): Promise<Array<{ name: string; lat: number; lng: number }>> {
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

const CITIES = ['Islamabad', 'Rawalpindi', 'Lahore', 'Karachi', 'Faisalabad', 'Multan', 'Peshawar', 'Quetta'];
const PRIORITIES = [
  { value: 1, label: '★★★ VIP', desc: 'Critical — never skip' },
  { value: 2, label: '★★ High', desc: 'Senior/regular customer' },
  { value: 3, label: '★ Normal', desc: 'Default' },
  { value: 4, label: 'Low', desc: 'Casual customer' },
  { value: 5, label: 'Rare', desc: 'One-off / walk-in' },
];

/**
 * Form to add a new client with full delivery address. Two-step:
 *  1. Basic info (name, phone, area, city, priority, credit limit)
 *  2. Pick a delivery address (search + tap-the-map to drop a pin)
 */
export function AddClientScreen() {
  const nav = useNavigation<any>();
  const qc = useQueryClient();

  const [step, setStep] = useState<'info' | 'address'>('info');
  const [form, setForm] = useState({
    name: '',
    phone: '',
    address: '',
    area: '',
    city: 'Islamabad',
    creditLimitRs: '0',
    priority: '3',
    notes: '',
  });

  // Address picker state
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [pinLabel, setPinLabel] = useState('');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ name: string; lat: number; lng: number }>>([]);
  const [searching, setSearching] = useState(false);
  const mapRef = useRef<MapView>(null);
  const searchTimer = useRef<any>(null);

  // Try to start the map near the user's current location for convenience.
  useEffect(() => {
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') return;
        const pos = await Location.getCurrentPositionAsync({});
        if (pos) {
          setPin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        }
      } catch {}
    })();
  }, []);

  // Debounced search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!search.trim()) { setSearchResults([]); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      const r = await searchAddress(search);
      setSearchResults(r);
      setSearching(false);
    }, 500);
    return () => searchTimer.current && clearTimeout(searchTimer.current);
  }, [search]);

  const create = useMutation({
    mutationFn: async () => {
      const created = await api.post('/clients', {
        name: form.name,
        phone: form.phone,
        address: form.address,
        area: form.area,
        city: form.city,
        creditLimitRs: form.creditLimitRs ? Number(form.creditLimitRs) : 0,
        priority: Number(form.priority),
        notes: form.notes,
      });
      if (pin && pinLabel.trim()) {
        await api.post(`/clients/${created.data.id}/addresses`, {
          label: pinLabel.trim(),
          lat: pin.lat,
          lng: pin.lng,
        });
      }
      return created.data;
    },
    onSuccess: (client) => {
      qc.invalidateQueries({ queryKey: ['my-clients'] });
      Alert.alert('Client added', `${client.name} is saved.`, [
        { text: 'OK', onPress: () => nav.goBack() },
      ]);
    },
    onError: (e: any) =>
      Alert.alert('Could not add client', e?.response?.data?.message ?? e?.message ?? 'Try again'),
  });

  function nextStep() {
    if (!form.name.trim()) { Alert.alert('Name is required'); return; }
    if (!form.phone.trim()) { Alert.alert('Phone is required'); return; }
    if (!/^\+?\d{10,13}$/.test(form.phone.replace(/\s/g, ''))) {
      Alert.alert('Phone looks wrong', 'Use the format +923XXXXXXXXX');
      return;
    }
    setStep('address');
  }

  function submit() {
    if (!pin) {
      Alert.alert('Pick the location', 'Search for the area, then tap the map to drop a pin where deliveries should go.');
      return;
    }
    if (!pinLabel.trim()) {
      Alert.alert('Label the address', 'e.g. "House 14, Street 5, F-7/2"');
      return;
    }
    create.mutate();
  }

  return (
    <Screen scroll>
      {step === 'info' && (
        <Card>
          <Heading size="h3">Customer info</Heading>
          <Caption style={{ marginBottom: space.md }}>
            We use phone to detect duplicates — same number can't be added twice.
          </Caption>
          <Input label="Name *" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />
          <Input label="Phone *" value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v })}
            keyboardType="phone-pad" placeholder="+923XXXXXXXXX" />
          <Input label="Area" value={form.area} onChangeText={(v) => setForm({ ...form, area: v })}
            placeholder='e.g. "F-7", "DHA Phase 2"' />
          <Caption style={{ marginTop: space.sm }}>City</Caption>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: space.sm }}>
            {CITIES.map((c) => (
              <Pressable
                key={c}
                onPress={() => setForm({ ...form, city: c })}
                style={({ pressed }: any) => ({
                  paddingVertical: 6, paddingHorizontal: 12,
                  borderRadius: radius.pill,
                  backgroundColor: form.city === c ? colors.primary : colors.surface,
                  borderWidth: 1, borderColor: form.city === c ? colors.primary : colors.border,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Body style={{ color: form.city === c ? 'white' : colors.text, fontWeight: '600' }}>{c}</Body>
              </Pressable>
            ))}
          </View>
          <Input
            label="Credit limit (PKR)"
            value={form.creditLimitRs}
            onChangeText={(v) => setForm({ ...form, creditLimitRs: v })}
            keyboardType="number-pad"
            placeholder="0 = no credit"
          />
          <Caption style={{ marginTop: space.sm }}>Priority</Caption>
          <View style={{ marginBottom: space.md }}>
            {PRIORITIES.map((p) => {
              const sel = form.priority === String(p.value);
              return (
                <Pressable
                  key={p.value}
                  onPress={() => setForm({ ...form, priority: String(p.value) })}
                  style={({ pressed }: any) => ({
                    padding: space.sm, marginVertical: 2,
                    borderRadius: radius.md,
                    backgroundColor: sel ? colors.primarySoft : colors.surface,
                    borderWidth: 1, borderColor: sel ? colors.primary : colors.border,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Body style={{ fontWeight: '600', color: sel ? colors.primary : colors.text }}>{p.label}</Body>
                  <Caption>{p.desc}</Caption>
                </Pressable>
              );
            })}
          </View>
          <Input label="Notes" value={form.notes} onChangeText={(v) => setForm({ ...form, notes: v })}
            placeholder="any internal notes" />
          <Button title="Next: pick address →" onPress={nextStep} style={{ marginTop: space.md }} />
        </Card>
      )}

      {step === 'address' && (
        <>
          <Card>
            <Heading size="h3">Delivery location</Heading>
            <Caption style={{ marginBottom: space.sm }}>
              Type the area to search, or pinch / tap the map to drop a pin.
            </Caption>
            <Input
              label="Search"
              value={search}
              onChangeText={setSearch}
              placeholder='e.g. "F-7 Markaz, Islamabad"'
            />
            {searching && <Caption>Searching…</Caption>}
            {searchResults.length > 0 && (
              <View style={{ maxHeight: 180, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginTop: 4 }}>
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

          <View style={{ height: 320, borderRadius: radius.lg, overflow: 'hidden', marginBottom: space.md }}>
            <MapView
              ref={mapRef}
              style={{ flex: 1 }}
              initialRegion={{
                latitude: pin?.lat ?? 33.7177,
                longitude: pin?.lng ?? 73.0535,
                latitudeDelta: 0.02,
                longitudeDelta: 0.02,
              }}
              onPress={(e: any) => {
                const c = e.nativeEvent.coordinate;
                setPin({ lat: c.latitude, lng: c.longitude });
              }}
            >
              {pin && (
                <Marker coordinate={{ latitude: pin.lat, longitude: pin.lng }} />
              )}
            </MapView>
          </View>

          <Card>
            <Input
              label="Address label *"
              value={pinLabel}
              onChangeText={setPinLabel}
              placeholder='e.g. "House 14, Street 5, F-7/2"'
            />
            {pin && (
              <Caption style={{ marginTop: 4 }}>
                Pin at {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
              </Caption>
            )}
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
              <Button title="← Back" variant="ghost" onPress={() => setStep('info')} fullWidth={false} />
              <Button
                title={create.isPending ? 'Saving…' : 'Save client'}
                variant="success"
                onPress={submit}
                disabled={create.isPending}
              />
            </View>
          </Card>
        </>
      )}
    </Screen>
  );
}

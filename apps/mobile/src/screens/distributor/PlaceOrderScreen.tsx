import { useState } from 'react';
import { Alert, Button, Text, TextInput, View, ScrollView } from 'react-native';
import { api } from '../../api/client';

export function PlaceOrderScreen() {
  const [clientId, setClientId] = useState('');
  const [label, setLabel] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [cylinderTypeId, setCylinderTypeId] = useState('');
  const [fullCount, setFullCount] = useState('1');

  async function submit() {
    try {
      await api.post('/orders', {
        clientId,
        deliveryLabel: label,
        deliveryLocation: { lat: Number(lat), lng: Number(lng) },
        lines: [{ cylinderTypeId, fullCount: Number(fullCount), expectedReturnCount: 0 }],
      });
      Alert.alert('Order placed');
    } catch (e: any) {
      Alert.alert('Failed', e?.response?.data?.message ?? 'Try again');
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 8 }}>
      <Text>Client ID</Text>
      <TextInput value={clientId} onChangeText={setClientId} style={inputStyle} />
      <Text>Delivery label</Text>
      <TextInput value={label} onChangeText={setLabel} style={inputStyle} />
      <Text>Latitude</Text>
      <TextInput value={lat} onChangeText={setLat} keyboardType="decimal-pad" style={inputStyle} />
      <Text>Longitude</Text>
      <TextInput value={lng} onChangeText={setLng} keyboardType="decimal-pad" style={inputStyle} />
      <Text>Cylinder type ID</Text>
      <TextInput value={cylinderTypeId} onChangeText={setCylinderTypeId} style={inputStyle} />
      <Text>Full count</Text>
      <TextInput value={fullCount} onChangeText={setFullCount} keyboardType="number-pad" style={inputStyle} />
      <View style={{ marginTop: 16 }}>
        <Button title="Place order" onPress={submit} />
      </View>
    </ScrollView>
  );
}

const inputStyle = { borderWidth: 1, borderColor: '#ddd', padding: 10, borderRadius: 6 } as const;

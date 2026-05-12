import { useState } from 'react';
import { Alert, Button, Text, TextInput, View } from 'react-native';
import { api } from '../../api/client';

export function ReconcileScreen() {
  const [cash, setCash] = useState('');
  const [delivered, setDelivered] = useState('');
  const [returned, setReturned] = useState('');

  async function submit() {
    try {
      await api.post('/reconciliations', {
        forDate: new Date().toISOString().slice(0, 10),
        submittedCashPaisa: Math.round(Number(cash) * 100),
        cylindersDelivered: Number(delivered),
        cylindersReturned: Number(returned),
      });
      Alert.alert('Submitted');
    } catch (e: any) {
      Alert.alert('Failed', e?.response?.data?.message ?? 'Try again');
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 8 }}>
      <Text>Cash collected (PKR)</Text>
      <TextInput value={cash} onChangeText={setCash} keyboardType="decimal-pad" style={inputStyle} />
      <Text>Cylinders delivered</Text>
      <TextInput value={delivered} onChangeText={setDelivered} keyboardType="number-pad" style={inputStyle} />
      <Text>Cylinders returned</Text>
      <TextInput value={returned} onChangeText={setReturned} keyboardType="number-pad" style={inputStyle} />
      <Button title="Submit" onPress={submit} />
    </View>
  );
}

const inputStyle = { borderWidth: 1, borderColor: '#ddd', padding: 10, borderRadius: 6 } as const;

import { useState } from 'react';
import { Alert, Button, Text, TextInput, View } from 'react-native';
import { api } from '../../api/client';

export function TopupScreen() {
  const [amount, setAmount] = useState('1000');
  const [provider, setProvider] = useState<'JAZZCASH' | 'EASYPAISA' | 'BANK_MANUAL'>('JAZZCASH');

  async function topup() {
    try {
      const { data } = await api.post('/payments/topup', {
        amountPaisa: Math.round(Number(amount) * 100),
        provider,
      });
      Alert.alert('Top-up initiated', JSON.stringify(data, null, 2));
    } catch (e: any) {
      Alert.alert('Failed', e?.response?.data?.message ?? 'Try again');
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text>Amount (PKR)</Text>
      <TextInput
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        style={{ borderWidth: 1, borderColor: '#ddd', padding: 12, borderRadius: 6 }}
      />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['JAZZCASH', 'EASYPAISA', 'BANK_MANUAL'] as const).map((p) => (
          <Button key={p} title={p} onPress={() => setProvider(p)} color={provider === p ? '#0f6cf0' : '#888'} />
        ))}
      </View>
      <Button title="Top up" onPress={topup} />
    </View>
  );
}

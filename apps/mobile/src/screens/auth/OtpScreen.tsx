import { useState } from 'react';
import { Alert, Button, Text, TextInput, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuthStore } from '../../store/auth';

export function OtpScreen() {
  const route = useRoute<any>();
  const phone: string = route.params?.phone;
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const setAuth = useAuthStore((s) => s.set);

  async function verify() {
    try {
      const { data } = await api.post('/auth/otp/verify', { phone, code });
      await setAuth(data);
    } catch (e: any) {
      Alert.alert('Verify failed', e?.response?.data?.message ?? 'Try again');
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
      <Text style={{ marginBottom: 8 }}>{phone}</Text>
      <Text>{t('otp')}</Text>
      <TextInput
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        maxLength={6}
        autoFocus
        style={{ borderWidth: 1, borderColor: '#ddd', padding: 12, borderRadius: 6, marginVertical: 12 }}
      />
      <Button title={t('verify')} onPress={verify} />
    </View>
  );
}

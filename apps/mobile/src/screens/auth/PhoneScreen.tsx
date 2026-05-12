import { useState } from 'react';
import { Alert, Button, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';

export function PhoneScreen() {
  const nav = useNavigation<any>();
  const { t } = useTranslation();
  const [phone, setPhone] = useState('+923');

  async function send() {
    try {
      await api.post('/auth/otp/send', { phone });
      nav.navigate('Otp', { phone });
    } catch (e: any) {
      Alert.alert('OTP failed', e?.response?.data?.message ?? 'Try again');
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
      <Text style={{ fontSize: 24, marginBottom: 16 }}>{t('welcome')}</Text>
      <Text>{t('phone')}</Text>
      <TextInput
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoFocus
        style={{ borderWidth: 1, borderColor: '#ddd', padding: 12, borderRadius: 6, marginVertical: 12 }}
      />
      <Button title={t('sendOtp')} onPress={send} />
    </View>
  );
}

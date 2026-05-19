import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { Body, Button, Caption, Card, Heading, Input, Screen } from '../../components/ui';
import { colors, space } from '../../theme';

export function PhoneScreen() {
  const nav = useNavigation<any>();
  const { t } = useTranslation();
  const [phone, setPhone] = useState('+923');
  const [loading, setLoading] = useState(false);

  async function send() {
    setLoading(true);
    try {
      await api.post('/auth/otp/send', { phone });
      nav.navigate('Otp', { phone });
    } catch (e: any) {
      Alert.alert('OTP failed', e?.response?.data?.message ?? 'Try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <View style={{ alignItems: 'center', marginBottom: space.xl }}>
          <View
            style={{
              width: 64, height: 64, borderRadius: 16,
              backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
              marginBottom: space.md,
            }}
          >
            <Heading size="h1" style={{ color: 'white' }}>LPG</Heading>
          </View>
          <Heading size="h1">LPG Management</Heading>
          <Body muted style={{ marginTop: 4 }}>Delivery, simplified</Body>
        </View>

        <Card>
          <Heading size="h3" style={{ marginBottom: space.sm }}>{t('welcome')}</Heading>
          <Caption style={{ marginBottom: space.md }}>
            Enter your PK mobile to receive a one-time code.
          </Caption>
          <Input
            label={t('phone') ?? 'Phone'}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoFocus
            placeholder="+923XXXXXXXXX"
          />
          <Button title={loading ? 'Sending…' : t('sendOtp') ?? 'Send OTP'} onPress={send} disabled={loading} />
        </Card>
      </View>
    </Screen>
  );
}

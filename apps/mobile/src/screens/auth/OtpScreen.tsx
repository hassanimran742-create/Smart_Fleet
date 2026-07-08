import { useState } from 'react';
import { Alert } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuthStore } from '../../store/auth';
import { Body, Button, Caption, Card, Heading, Input, Screen } from '../../components/ui';
import { space } from '../../theme';

export function OtpScreen() {
  const route = useRoute<any>();
  const phone: string = route.params?.phone;
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.set);

  async function verify() {
    setLoading(true);
    try {
      const { data } = await api.post('/auth/otp/verify', { phone, code });
      await setAuth(data);
    } catch (e: any) {
      Alert.alert('Verify failed', e?.response?.data?.message ?? 'Try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <Card style={{ marginTop: space.xxl }}>
        <Heading size="h3">Verify your number</Heading>
        <Body muted style={{ marginTop: space.xs, marginBottom: space.md }}>
          We sent a code to <Body>{phone}</Body>.
        </Body>
        <Input
          label={t('otp') ?? 'OTP code'}
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          maxLength={6}
          autoFocus
          placeholder="6-digit code"
        />
        <Button title={loading ? 'Verifying…' : t('verify') ?? 'Verify'} onPress={verify} disabled={loading} />
        <Caption style={{ marginTop: space.sm, textAlign: 'center' }}>
          Dev: check the API terminal for a [MockSMS] log line with your code.
        </Caption>
      </Card>
    </Screen>
  );
}

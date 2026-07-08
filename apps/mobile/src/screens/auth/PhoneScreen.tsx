import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuthStore } from '../../store/auth';
import { Body, Button, Caption, Card, Heading, Input, Screen } from '../../components/ui';
import { colors, radius, space } from '../../theme';
import { currentLanguage, setLanguage } from '../../i18n/persist';

// Login flow for the mobile app.
//
// Drivers, distributors, and admin/dispatcher-class users sign in with a
// PASSWORD (set by an admin). End-customer CLIENT users still sign in with
// an OTP — they're not staff and shouldn't manage a credential.
//
// We don't know the user's role until they tap "Sign in". Strategy:
//   1. Try password login. If it succeeds → done.
//   2. If the server rejects with a "must use one-time code" message,
//      fall back to the OTP path automatically.
//   3. If the server returns generic "Invalid phone or password", show that.

export function PhoneScreen() {
  const nav = useNavigation<any>();
  const { t, i18n } = useTranslation();
  const setAuth = useAuthStore((s) => s.set);
  const [phone, setPhone] = useState('+923');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lang, setLang] = useState<'en' | 'ur'>(currentLanguage());

  async function pickLang(next: 'en' | 'ur') {
    setLang(next);
    await setLanguage(next);
  }

  async function signIn() {
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { phone, password });
      // Auth store expects `accessToken` (not `token`) — naming matches the
      // server's issueTokens() response shape.
      await setAuth({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        role: data.role,
      });
      // Root navigator picks the right stack from `role`.
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? '';
      const needsOtp =
        typeof msg === 'string' &&
        (msg.toLowerCase().includes('one-time code') ||
          msg.toLowerCase().includes('otp'));

      if (needsOtp) {
        try {
          await api.post('/auth/otp/send', { phone });
          nav.navigate('Otp', { phone });
        } catch (e2: any) {
          Alert.alert('OTP failed', e2?.response?.data?.message ?? 'Try again');
        }
      } else {
        Alert.alert('Sign-in failed', msg || 'Check your phone number and password.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <View style={{ position: 'absolute', top: 12, right: 0, flexDirection: 'row', gap: 6 }}>
          <LangPill code="en" label="English" current={lang} onPress={pickLang} />
          <LangPill code="ur" label="اردو" current={lang} onPress={pickLang} />
        </View>

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
          <Body muted style={{ marginTop: 4 }}>{i18n.language === 'ur' ? 'گیس ڈلیوری' : 'Delivery, simplified'}</Body>
        </View>

        <Card>
          <Heading size="h3" style={{ marginBottom: space.sm }}>{t('signIn') ?? 'Sign in'}</Heading>
          <Caption style={{ marginBottom: space.md }}>
            {i18n.language === 'ur'
              ? 'فون اور پاس ورڈ درج کریں۔ اگر آپ کے پاس پاس ورڈ نہیں ہے تو اپنے ایڈمن سے رابطہ کریں۔'
              : 'Enter phone and password. Ask your admin to set one if you don\'t have it yet.'}
          </Caption>
          <Input
            label={t('phone') ?? 'Phone'}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoFocus
            placeholder="+923XXXXXXXXX"
          />
          <Input
            label={t('password') ?? 'Password'}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            placeholder="••••••••"
          />
          <Pressable onPress={() => setShowPassword((v) => !v)} style={{ alignSelf: 'flex-end', marginTop: -8, marginBottom: 8 }}>
            <Caption style={{ color: colors.primary }}>
              {showPassword ? (i18n.language === 'ur' ? 'چھپائیں' : 'Hide') : (i18n.language === 'ur' ? 'دکھائیں' : 'Show')}
            </Caption>
          </Pressable>
          <Button
            title={loading ? (i18n.language === 'ur' ? 'سائن ان...' : 'Signing in…') : (t('signIn') ?? 'Sign in')}
            onPress={signIn}
            disabled={loading || !phone || !password}
          />
        </Card>
      </View>
    </Screen>
  );
}

function LangPill({
  code, label, current, onPress,
}: { code: 'en' | 'ur'; label: string; current: 'en' | 'ur'; onPress: (c: 'en' | 'ur') => void }) {
  const selected = current === code;
  return (
    <Pressable
      onPress={() => onPress(code)}
      style={({ pressed }: any) => ({
        paddingVertical: 6, paddingHorizontal: 12,
        borderRadius: radius.pill,
        backgroundColor: selected ? colors.primary : 'white',
        borderWidth: 1,
        borderColor: selected ? colors.primary : colors.border,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Body style={{ color: selected ? 'white' : colors.text, fontWeight: '600' }}>{label}</Body>
    </Pressable>
  );
}

import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { Body, Button, Caption, Card, Heading, Input, Screen } from '../../components/ui';
import { colors, radius, space } from '../../theme';
import { currentLanguage, setLanguage } from '../../i18n/persist';

export function PhoneScreen() {
  const nav = useNavigation<any>();
  const { t, i18n } = useTranslation();
  const [phone, setPhone] = useState('+923');
  const [loading, setLoading] = useState(false);
  const [lang, setLang] = useState<'en' | 'ur'>(currentLanguage());

  async function pickLang(next: 'en' | 'ur') {
    setLang(next);
    await setLanguage(next);
  }

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
        {/* Language toggle at top-right */}
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
          <Heading size="h3" style={{ marginBottom: space.sm }}>{t('welcome')}</Heading>
          <Caption style={{ marginBottom: space.md }}>
            {i18n.language === 'ur'
              ? 'پاکستانی موبائل نمبر درج کریں تاکہ OTP موصول ہو سکے۔'
              : 'Enter your PK mobile to receive a one-time code.'}
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

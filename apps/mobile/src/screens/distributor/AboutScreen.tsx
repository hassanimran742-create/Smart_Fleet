import { Linking, View } from 'react-native';
import Constants from 'expo-constants';
import { Body, Button, Card, Caption, Heading, Screen } from '../../components/ui';
import { colors, space } from '../../theme';

export function AboutScreen() {
  const version = Constants.expoConfig?.version ?? '0.1.0';
  return (
    <Screen scroll>
      <Card style={{ alignItems: 'center', paddingVertical: space.xl }}>
        <View
          style={{
            width: 80, height: 80, borderRadius: 20,
            backgroundColor: colors.primary,
            alignItems: 'center', justifyContent: 'center', marginBottom: space.md,
          }}
        >
          <Heading size="h1" style={{ color: 'white' }}>LPG</Heading>
        </View>
        <Heading size="h2">LPG Management</Heading>
        <Caption style={{ marginTop: 4 }}>Distributor app · v{version}</Caption>
      </Card>

      <Card>
        <Heading size="h3">Need help?</Heading>
        <Caption style={{ marginTop: 4, marginBottom: space.md }}>
          Reach us by phone or message — we'll respond within working hours.
        </Caption>
        <Button title="📞 Call support" onPress={() => Linking.openURL('tel:+923000000000')} />
        <Button
          title="💬 WhatsApp us"
          variant="ghost"
          onPress={() => Linking.openURL('https://wa.me/923000000000')}
          style={{ marginTop: space.sm }}
        />
      </Card>

      <Card>
        <Heading size="h3">About</Heading>
        <Body style={{ marginTop: space.sm }}>
          LPG Management is a last-mile cylinder delivery platform serving Pakistan.
          We connect distributors, drivers, and end customers — from order placement to
          delivery, refill, and payment.
        </Body>
      </Card>
    </Screen>
  );
}

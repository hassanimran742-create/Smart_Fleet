import { useState } from 'react';
import { Alert, View, ScrollView } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { pickAndUploadImage } from '../../api/upload';
import { Body, Button, Caption, Card, Heading, Input, Pill, Screen } from '../../components/ui';
import { colors, space } from '../../theme';

interface Payment {
  id: string;
  amountPaisa: string | number;
  provider: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED';
  proofUrl: string | null;
  createdAt: string;
}

const rs = (paisa: string | number) => `Rs. ${(Number(paisa) / 100).toLocaleString()}`;
const toneFor = (s: string) =>
  s === 'SUCCESS' ? 'ok' : s === 'FAILED' ? 'danger' : s === 'PENDING' ? 'warn' : 'neutral';

export function TopupScreen() {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('1000');
  const [instructions, setInstructions] = useState<string | null>(null);
  const [activePaymentId, setActivePaymentId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const history = useQuery({
    queryKey: ['my-payments'],
    queryFn: async () => (await api.get<Payment[]>('/payments/mine')).data,
    refetchInterval: 20000,
  });

  // Step 1 — create a PENDING bank-transfer top-up and get the IBAN + reference.
  const start = useMutation({
    mutationFn: async () => {
      const amt = Math.round(Number(amount) * 100);
      if (!amt || amt < 10000) throw new Error('Enter at least Rs. 100');
      const { data } = await api.post('/payments/topup', {
        amountPaisa: amt,
        provider: 'BANK_MANUAL',
      });
      return data as { paymentId: string; formFields?: { instructions?: string } };
    },
    onSuccess: (data) => {
      setActivePaymentId(data.paymentId);
      setInstructions(data.formFields?.instructions ?? 'Transfer the amount and upload your receipt.');
      qc.invalidateQueries({ queryKey: ['my-payments'] });
    },
    onError: (e: any) => Alert.alert('Could not start top-up', e?.response?.data?.message ?? e.message ?? 'Try again'),
  });

  // Step 2 — upload the bank slip image against the pending payment.
  async function uploadProof(paymentId: string) {
    try {
      setUploading(true);
      const url = await pickAndUploadImage({ camera: false });
      if (!url) { setUploading(false); return; }
      await api.post(`/payments/${paymentId}/bank-proof`, { proofUrl: url });
      Alert.alert('Receipt uploaded', 'Your top-up is pending admin verification. Your balance updates once approved.');
      setActivePaymentId(null);
      setInstructions(null);
      qc.invalidateQueries({ queryKey: ['my-payments'] });
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message ?? 'Try again');
    } finally {
      setUploading(false);
    }
  }

  const payments = history.data ?? [];

  return (
    <Screen scroll>
      <Heading size="h2" style={{ marginBottom: space.sm }}>Top up balance</Heading>
      <Caption style={{ marginBottom: space.md }}>
        Transfer money to our bank account, then upload your receipt. Admin verifies it and your advance balance is credited.
      </Caption>

      <Card>
        <Body style={{ fontWeight: '700', marginBottom: 6 }}>1. Amount</Body>
        <Input
          label="Amount (PKR)"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="1000"
        />
        <Button
          title={start.isPending ? 'Starting…' : 'Get bank details'}
          onPress={() => start.mutate()}
          disabled={start.isPending}
        />
      </Card>

      {instructions && activePaymentId && (
        <Card style={{ marginTop: space.md, borderColor: colors.primary, borderWidth: 1 }}>
          <Body style={{ fontWeight: '700', marginBottom: 6 }}>2. Transfer & upload receipt</Body>
          <View style={{ backgroundColor: '#eef4ff', padding: 12, borderRadius: 8, marginBottom: 12 }}>
            <Body style={{ fontSize: 13 }}>{instructions}</Body>
          </View>
          <Button
            title={uploading ? 'Uploading…' : '📷 Upload receipt'}
            onPress={() => uploadProof(activePaymentId)}
            disabled={uploading}
          />
          <Caption style={{ marginTop: 6, textAlign: 'center' }}>
            Pick a clear photo of your transfer slip / screenshot.
          </Caption>
        </Card>
      )}

      <Heading size="h3" style={{ marginTop: space.xl, marginBottom: space.sm }}>My top-ups</Heading>
      {payments.length === 0 ? (
        <Card><Body muted>No top-ups yet.</Body></Card>
      ) : (
        payments.map((p) => (
          <Card key={p.id} style={{ marginBottom: space.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Body style={{ fontWeight: '700' }}>{rs(p.amountPaisa)}</Body>
                <Caption>{new Date(p.createdAt).toLocaleString()}</Caption>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Pill label={p.status} tone={toneFor(p.status) as any} />
                {p.status === 'PENDING' && !p.proofUrl && (
                  <Caption style={{ color: colors.warn, marginTop: 4 }}>Upload receipt</Caption>
                )}
              </View>
            </View>
            {p.status === 'PENDING' && !p.proofUrl && (
              <View style={{ marginTop: 10 }}>
                <Button
                  title={uploading ? 'Uploading…' : '📷 Upload receipt'}
                  variant="secondary"
                  onPress={() => uploadProof(p.id)}
                  disabled={uploading}
                />
              </View>
            )}
          </Card>
        ))
      )}
    </Screen>
  );
}

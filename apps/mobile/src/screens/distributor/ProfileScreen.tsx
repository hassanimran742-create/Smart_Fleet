import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Body, Button, Card, Caption, Heading, Input, Screen } from '../../components/ui';
import { space } from '../../theme';

export function ProfileScreen() {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/users/me')).data,
  });

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    cnic: '',
    businessName: '',
  });

  useEffect(() => {
    if (me.data) {
      setForm({
        name: me.data.name ?? '',
        email: me.data.email ?? '',
        phone: me.data.phone ?? '',
        cnic: me.data.cnic ?? '',
        businessName: me.data.distributorProfile?.businessName ?? '',
      });
    }
  }, [me.data]);

  const save = useMutation({
    mutationFn: () => api.patch('/users/me', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
      Alert.alert('Saved', 'Your profile has been updated.');
    },
    onError: (e: any) => Alert.alert('Failed', e?.response?.data?.message ?? 'Try again'),
  });

  return (
    <Screen scroll>
      <Card>
        <Heading size="h3">Your profile</Heading>
        <Caption style={{ marginTop: 4, marginBottom: space.md }}>
          These details show up on every order placed from your account.
        </Caption>

        <Input label="Your name" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />
        <Input label="Business name" value={form.businessName} onChangeText={(v) => setForm({ ...form, businessName: v })} />
        <Input label="Phone" value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v })} keyboardType="phone-pad" />
        <Input label="Email" value={form.email} onChangeText={(v) => setForm({ ...form, email: v })} keyboardType="email-address" placeholder="optional" />
        <Input label="CNIC" value={form.cnic} onChangeText={(v) => setForm({ ...form, cnic: v })} placeholder="12345-1234567-1" />

        <Button
          title={save.isPending ? 'Saving…' : 'Save changes'}
          onPress={() => save.mutate()}
          disabled={save.isPending}
          style={{ marginTop: space.md }}
        />
      </Card>

      <Card>
        <Heading size="h3">Account info</Heading>
        <Row label="Role" value={me.data?.role ?? '—'} />
        <Row label="Status" value={me.data?.status ?? '—'} />
        <Row label="Distributor ID" value={me.data?.distributorProfile?.id?.slice(0, 8) ?? '—'} />
        <Row label="Member since" value={me.data?.createdAt ? new Date(me.data.createdAt).toLocaleDateString() : '—'} />
      </Card>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
      <Caption>{label}</Caption>
      <Body style={{ fontWeight: '600' }}>{value}</Body>
    </View>
  );
}

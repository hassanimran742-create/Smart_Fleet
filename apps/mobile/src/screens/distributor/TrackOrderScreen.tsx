import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useQuery } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import Constants from 'expo-constants';
import { useRoute } from '@react-navigation/native';
import { api } from '../../api/client';
import { useAuthStore } from '../../store/auth';

export function TrackOrderScreen() {
  const route = useRoute<any>();
  const orderId = route.params?.orderId;
  const token = useAuthStore((s) => s.token);

  const tracking = useQuery({
    queryKey: ['tracking', orderId],
    queryFn: async () => (await api.get(`/orders/${orderId}/tracking`)).data,
    enabled: !!orderId,
    refetchInterval: 10000,
  });

  const [livePos, setLivePos] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!tracking.data?.driver?.id || !token) return;
    const apiBase = (Constants.expoConfig?.extra?.apiBaseUrl as string) ?? '';
    const host = apiBase.replace(/\/api\/v1\/?$/, '');
    const socket: Socket = io(`${host}/drivers`, { transports: ['websocket'], auth: { token } });

    socket.on('driver:location', (msg: { driverId: string; lat: number; lng: number }) => {
      if (msg.driverId === tracking.data.driver.id) setLivePos({ lat: msg.lat, lng: msg.lng });
    });

    return () => { socket.disconnect(); };
  }, [tracking.data?.driver?.id, token]);

  if (!tracking.data) return <Text style={{ padding: 24 }}>Loading…</Text>;
  const t = tracking.data;
  const center = livePos ?? t.driverLocation ?? t.destination ?? { lat: 31.5204, lng: 74.3587 };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 16, gap: 4, backgroundColor: '#fafafa' }}>
        <Text style={{ fontWeight: '600', fontSize: 16 }}>Order {t.orderId.slice(0, 8)}</Text>
        <Text>Status: {t.status} · Payment: {t.paymentStatus}</Text>
        <Text>Fee: {Number(t.deliveryFeePaisa) / 100} PKR</Text>
        {t.driver ? (
          <Text>
            Driver: {t.driver.name} · {t.driver.phone}
            {t.driver.vehiclePlate ? ` · ${t.driver.vehiclePlate}` : ''}
          </Text>
        ) : (
          <Text style={{ color: '#888' }}>No driver assigned yet</Text>
        )}
      </View>

      <MapView
        style={{ flex: 1 }}
        initialRegion={{
          latitude: center.lat,
          longitude: center.lng,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
      >
        {t.destination && (
          <Marker
            coordinate={{ latitude: t.destination.lat, longitude: t.destination.lng }}
            title="Delivery"
            pinColor="green"
          />
        )}
        {(livePos ?? t.driverLocation) && (
          <Marker
            coordinate={{
              latitude: (livePos ?? t.driverLocation).lat,
              longitude: (livePos ?? t.driverLocation).lng,
            }}
            title="Driver"
            pinColor="blue"
          />
        )}
      </MapView>
    </View>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FillingOrderDto } from '@smartfleet/shared-types';
import { useIdempotencyKey } from '../../api/client';
import { isNetworkError, type ApiError } from '../../api/errors';
import { qk } from '../../api/keys';
import { useAppConfig, useOfficeContact } from '../../hooks/useAppConfig';
import {
  ActionLine,
  Button,
  ChoiceChips,
  colors,
  ErrorBanner,
  Icon,
  OfflineEmpty,
  PickerSheet,
  radius,
  Screen,
  Skeleton,
  sizes,
  space,
  Stepper,
  Text,
  useNoConnection,
  useToast,
} from '../../ui';
import { fetchMyRefills, fetchStations, requestRefill, type FillingStationRow, type NewRefillBody } from './shared/api';
import { sizeLabelFromWeight, weightSortKey } from './shared/format';
import { useFormGuard, useShopNavigation } from './shared/navigation';
import { Notice } from './shared/Notice';
import { useCylinderTypes } from './shared/queries';

/** Up to this many stations show as radio rows; more open a PickerSheet (shop spec §X2). */
const STATION_ROWS_MAX = 6;

/**
 * S17 New refill (shop spec §X2; the Inc 3 spec's §4.2, built now): one size per refill as chips in
 * two columns (the size of the last refill picked), how many (1 to `refill.maxCylinders`), and the
 * filling station (the last one used). The button names what is asked for: "Request refill · 2 ×
 * 11.8 kg". Saved, it goes back to Refills with "Refill requested". No money anywhere (ADR-16), and
 * "Leave without saving?" only after a change.
 */
export function NewRefillScreen() {
  const { t } = useTranslation();
  const noConnection = useNoConnection();
  const navigation = useShopNavigation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const office = useOfficeContact();
  const { config } = useAppConfig();
  const max = Math.max(1, config.refill.maxCylinders);

  const types = useCylinderTypes();
  const stations = useQuery<FillingStationRow[], ApiError>({ queryKey: qk.stations, queryFn: fetchStations });
  // The last refill picks the size and station (its count starts again at 1).
  const mine = useQuery<FillingOrderDto[], ApiError>({ queryKey: qk.refills.mine, queryFn: fetchMyRefills });

  const sizeOptions = useMemo(
    () =>
      [...(types.data ?? [])]
        .sort((a, b) => weightSortKey(a.weightKg) - weightSortKey(b.weightKg))
        .map((type) => ({ value: type.id, label: sizeLabelFromWeight(type.weightKg, t) })),
    [types.data, t],
  );
  const stationList = useMemo(() => stations.data ?? [], [stations.data]);
  const last = useMemo(
    () => [...(mine.data ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null,
    [mine.data],
  );

  const [sizeId, setSizeId] = useState<string | null>(null);
  const [count, setCount] = useState(1);
  const [stationId, setStationId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const prefilled = useRef<{ sizeId: string | null; stationId: string | null }>({ sizeId: null, stationId: null });
  const touched = useRef({ size: false, station: false });

  // Prefill the size from the last refill, once the sizes are known and the person hasn't picked.
  useEffect(() => {
    if (touched.current.size || sizeId || !last) return;
    if (sizeOptions.some((option) => option.value === last.cylinderTypeId)) {
      prefilled.current.sizeId = last.cylinderTypeId;
      setSizeId(last.cylinderTypeId);
    }
  }, [last, sizeOptions, sizeId]);

  // The station: the last one used if it still takes refills, else the first; a station that went away is unpicked.
  useEffect(() => {
    if (stationList.length === 0) {
      if (stationId) setStationId(null);
      return;
    }
    if (stationId && stationList.some((station) => station.id === stationId)) return;
    if (touched.current.station && stationId) return;
    const lastStation = last?.fillingStation?.id;
    const next = stationList.find((station) => station.id === lastStation) ?? stationList[0];
    prefilled.current.stationId = next.id;
    setStationId(next.id);
  }, [stationList, stationId, last]);

  // The cap can come down in the settings while the screen is open.
  useEffect(() => {
    if (count > max) setCount(max);
  }, [count, max]);

  const idem = useIdempotencyKey([sizeId, count, stationId]);
  const guard = useFormGuard(
    sizeId !== prefilled.current.sizeId || count !== 1 || stationId !== prefilled.current.stationId,
  );

  const request = useMutation<FillingOrderDto, ApiError, NewRefillBody>({
    mutationFn: (body) => requestRefill(body, idem.key),
    onSuccess: () => {
      toast.show({ message: t('refill.request.requested'), tone: 'success' });
      void queryClient.invalidateQueries({ queryKey: qk.refills.mine });
      guard.release();
      const state = navigation.getState();
      if (state.routes[state.index - 1]?.name === 'Refills') navigation.goBack();
      else navigation.replace('Refills');
    },
    onError: (error) => {
      if (error.code === 'REFILL_STATION_INACTIVE') void stations.refetch();
    },
  });

  // With the "No connection" banner up and nothing saved, the one body state shows at once, not after
  // the retries (which go on, so the form appears when the answers do).
  const offline = noConnection && (!types.data || !stations.data);
  const loading = !offline && ((!types.data && !types.isError) || (!stations.data && !stations.isError));
  const failed = offline || (!types.data && types.isError) || (!stations.data && stations.isError);
  const failure = !types.data && types.isError ? types.error : stations.error;
  const serverFailure = failure && !isNetworkError(failure) && (types.isError || stations.isError) ? failure : null;
  const noSizes = !!types.data && sizeOptions.length === 0;
  const noStation = !!stations.data && stationList.length === 0;
  const blockedLine = noSizes ? t('refill.request.noSizes') : noStation ? t('refill.request.noStation') : null;
  const size = sizeOptions.find((option) => option.value === sizeId);
  const station = stationList.find((row) => row.id === stationId) ?? null;
  const canRequest = !!sizeId && !!stationId && count >= 1 && count <= max && !request.isPending && !blockedLine;

  const submit = () => {
    if (!canRequest || !sizeId || !stationId) return;
    request.mutate({ fillingStationId: stationId, cylinderTypeId: sizeId, requestedCount: count });
  };
  const retryAll = () => {
    if (!types.data) void types.refetch();
    if (!stations.data) void stations.refetch();
  };

  const footer = (
    <>
      {blockedLine ? (
        <Text tone="secondary" align="center">
          {blockedLine}
        </Text>
      ) : !sizeId && !loading && !failed ? (
        <Text tone="secondary" align="center">
          {t('refill.request.needSize')}
        </Text>
      ) : (
        <ActionLine error={request.error} />
      )}
      <Button
        label={size ? t('refill.request.submit', { count, size: size.label }) : t('refill.request.submitNoSize')}
        onPress={submit}
        size="lg"
        loading={request.isPending}
        loadingLabel={t('refill.request.sending')}
        disabled={!size || !stationId || !!blockedLine}
      />
    </>
  );

  if (failed && !loading) {
    // One body state for sizes and stations together (shop spec §3.1).
    return (
      <Screen footer={footer}>
        {serverFailure ? <ErrorBanner error={serverFailure} onRetry={retryAll} /> : <OfflineEmpty onRetry={retryAll} />}
      </Screen>
    );
  }

  return (
    <Screen footer={footer}>
      <View style={styles.stack}>
        {blockedLine ? (
          <Notice tone="warning" text={blockedLine}>
            {office.phone ? (
              <Button label={t('common.actions.callOffice')} onPress={office.call} icon="call" variant="secondary" fullWidth={false} />
            ) : null}
          </Notice>
        ) : null}

        <View style={styles.group}>
          <Text variant="label">{t('refill.request.size')}</Text>
          {!types.data ? (
            <View style={styles.skeletons}>
              <Skeleton height={48} rounded={24} />
              <Skeleton height={48} rounded={24} />
            </View>
          ) : sizeOptions.length > 0 ? (
            <ChoiceChips<string>
              columns={2}
              accessibilityLabel={t('refill.request.size')}
              options={sizeOptions}
              value={sizeId ?? ''}
              onChange={(value) => {
                touched.current.size = true;
                setSizeId(value);
              }}
            />
          ) : null}
          <Text variant="caption" tone="secondary">
            {t('refill.request.sizeHelp')}
          </Text>
        </View>

        <Stepper
          label={t('refill.request.count')}
          helper={t('refill.request.countHelp', { max })}
          value={count}
          min={1}
          max={max}
          onChange={setCount}
        />

        <View style={styles.group}>
          <Text variant="label">{t('refill.request.station')}</Text>
          {!stations.data ? (
            <Skeleton height={48} />
          ) : stationList.length === 1 ? (
            <Text>{stationList[0].name}</Text>
          ) : stationList.length > 1 && stationList.length <= STATION_ROWS_MAX ? (
            <View accessibilityRole="radiogroup" style={styles.stations}>
              {stationList.map((row) => (
                <StationOption
                  key={row.id}
                  station={row}
                  selected={row.id === stationId}
                  onPress={() => {
                    touched.current.station = true;
                    setStationId(row.id);
                  }}
                />
              ))}
            </View>
          ) : stationList.length > STATION_ROWS_MAX ? (
            <Pressable
              onPress={() => setPickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={station?.name ?? t('refill.request.station')}
              android_ripple={{ color: colors.ripple }}
              style={styles.station}
            >
              <Text style={styles.flex}>{station?.name ?? ''}</Text>
              <Icon name="chevron" size={24} tone="secondary" />
            </Pressable>
          ) : null}
        </View>
      </View>

      <PickerSheet<string>
        visible={pickerOpen}
        title={t('refill.request.station')}
        items={stationList.map((row) => ({
          key: row.id,
          value: row.id,
          title: row.name,
          subtitle: row.address ?? undefined,
          selected: row.id === stationId,
        }))}
        onPick={(value) => {
          touched.current.station = true;
          setStationId(value);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </Screen>
  );
}

/** One station to choose (a radio row, 56 dp, as the ConfirmSheet's reasons look). */
function StationOption({ station, selected, onPress }: { station: FillingStationRow; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={station.name}
      android_ripple={{ color: colors.ripple }}
      style={[styles.station, selected ? styles.stationSelected : null]}
    >
      <Icon name={selected ? 'radioOn' : 'radioOff'} size={24} tone={selected ? 'brand' : 'secondary'} />
      <View style={styles.flex}>
        <Text>{station.name}</Text>
        {station.address ? (
          <Text variant="caption" tone="secondary">
            {station.address}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.xl },
  group: { gap: space.sm },
  flex: { flex: 1 },
  skeletons: { gap: space.sm },
  stations: { gap: space.xs },
  station: {
    minHeight: sizes.menuRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  stationSelected: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
});

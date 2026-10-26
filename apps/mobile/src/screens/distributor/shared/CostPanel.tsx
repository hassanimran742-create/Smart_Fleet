import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { LocationQuote } from '@smartfleet/shared-types';
import { formatRs } from '@smartfleet/shared-utils';
import type { ApiError } from '../../../api/errors';
import { qk, STALE_MS } from '../../../api/keys';
import { useOfficeContact } from '../../../hooks/useAppConfig';
import { Button, colors, Icon, space, Text, useNoConnection, type IconName } from '../../../ui';
import { fetchLocationQuote } from './api';

/** A map pin. */
export interface Pin {
  lat: number;
  lng: number;
}

/** The cost line waits this long after the pin stops moving (UX_MOBILE S8). */
const QUOTE_DEBOUNCE_MS = 400;

/** Pins are compared and cached to 6 decimals (about 10 cm), as the server compares delivery points. */
export function roundPin(pin: Pin): Pin {
  return { lat: Math.round(pin.lat * 1e6) / 1e6, lng: Math.round(pin.lng * 1e6) / 1e6 };
}

/**
 * `value`, once it has stopped changing for `ms`. Takes a primitive, so a re-render with the same value
 * never restarts the wait (an object made on every render would, and would never settle).
 */
function useDebounced<T extends string | number | null>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export type CostPanelState =
  | { kind: 'noPin' }
  | { kind: 'checking' }
  | { kind: 'priced'; quote: LocationQuote }
  | { kind: 'outside' }
  | { kind: 'priceNotSet' }
  | { kind: 'error'; error: ApiError; retry: () => void };

/**
 * The delivery cost of a pin (`GET /pricing/quote?lat&lng`, 200 always), 400 ms after it stops
 * moving. Only `priced` lets a customer or an address be saved.
 */
export function useCostPanelState(pin: Pin | null): CostPanelState {
  const rounded = pin ? roundPin(pin) : null;
  const pinKey = rounded ? `${rounded.lat},${rounded.lng}` : null;
  const settledKey = useDebounced(pinKey, QUOTE_DEBOUNCE_MS);
  const settled = pinKey !== null && settledKey === pinKey;
  const query = useQuery<LocationQuote, ApiError>({
    queryKey: rounded && settled ? qk.pricing.quote(rounded.lat, rounded.lng) : [...qk.pricing.all, 'none'],
    queryFn: () => fetchLocationQuote(rounded!.lat, rounded!.lng),
    enabled: settled,
    staleTime: STALE_MS.pricingQuote,
  });

  if (!rounded) return { kind: 'noPin' };
  if (!settled || (query.isPending && query.fetchStatus !== 'idle') || (query.isFetching && query.isError)) {
    return { kind: 'checking' };
  }
  if (query.isError && !query.data) return { kind: 'error', error: query.error, retry: () => void query.refetch() };
  const quote = query.data;
  if (!quote) return { kind: 'checking' };
  if (quote.blockCode === 'PRICING_ZONE_NOT_COVERED') return { kind: 'outside' };
  if (quote.blockCode === 'PRICING_PRICE_NOT_SET') return { kind: 'priceNotSet' };
  if (!quote.price) return { kind: 'checking' };
  return { kind: 'priced', quote };
}

/**
 * The one line under the map (shop spec §M item 5): the hint before a pin, "Checking delivery area…",
 * the cost once priced ("Delivery cost Rs 250": one cost per order, whatever cylinders it holds, ADR-08),
 * or why the spot can't be saved, with its one action. It always says why "Save" is greyed out.
 * `locateError` is the "Use my location" failure, shown in the hint's place.
 */
export function CostLine({ state, locateError }: { state: CostPanelState; locateError?: string | null }) {
  const { t } = useTranslation();
  const office = useOfficeContact();
  const bannerShowing = useNoConnection();

  switch (state.kind) {
    case 'noPin':
      return locateError ? (
        <Line icon="error" tone="danger" text={locateError} />
      ) : (
        <Text variant="caption" tone="secondary" style={styles.hint}>
          {t('customers.location.mapHint')}
        </Text>
      );
    case 'checking':
      return (
        <View style={styles.row} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={colors.brand} />
          <Text tone="secondary" style={styles.flex}>
            {t('customers.cost.checking')}
          </Text>
        </View>
      );
    case 'error':
      return (
        <View style={styles.block}>
          <Line icon="error" tone="danger" text={t('customers.cost.error')} />
          {/* While the "No connection" banner shows, its Try again (it refetches this check too) is the only one. */}
          {bannerShowing ? null : (
            <Button label={t('common.actions.tryAgain')} onPress={state.retry} variant="secondary" fullWidth={false} />
          )}
        </View>
      );
    case 'outside':
      return <Line icon="error" tone="danger" text={t('customers.cost.outside')} />;
    case 'priceNotSet':
      return (
        <View style={styles.block}>
          <Line icon="error" tone="danger" text={t('customers.cost.priceNotSet')} />
          {office.phone ? (
            <Button
              label={t('common.actions.callOffice')}
              onPress={office.call}
              icon="call"
              variant="secondary"
              fullWidth={false}
            />
          ) : null}
        </View>
      );
    case 'priced':
      return (
        <View style={styles.row} accessibilityLiveRegion="polite">
          <Icon name="ok" size={24} tone="success" />
          <Text variant="bodyStrong" style={styles.flex}>
            {t('customers.cost.priced', { cost: formatRs(state.quote.price!.basePaisa) })}
          </Text>
        </View>
      );
  }
}

function Line({ icon, tone, text }: { icon: IconName; tone: 'danger' | 'secondary'; text: string }) {
  return (
    <View style={styles.row} accessibilityRole={tone === 'danger' ? 'alert' : undefined} accessibilityLiveRegion="polite">
      <Icon name={icon} size={24} tone={tone} />
      <Text tone={tone} style={styles.flex}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 32 },
  block: { gap: space.sm, alignItems: 'flex-start' },
  flex: { flex: 1 },
  hint: { paddingVertical: space.xs },
});

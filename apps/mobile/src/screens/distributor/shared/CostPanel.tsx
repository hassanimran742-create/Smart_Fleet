import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { LocationQuote } from '@smartfleet/shared-types';
import { formatRs } from '@smartfleet/shared-utils';
import type { ApiError } from '../../../api/errors';
import { qk, STALE_MS } from '../../../api/keys';
import { useOfficeContact } from '../../../hooks/useAppConfig';
import { Button, Card, ErrorBanner, Icon, space, Text } from '../../../ui';
import { fetchLocationQuote } from './api';
import { isPositivePaisa } from './format';

/** A map pin. */
export interface Pin {
  lat: number;
  lng: number;
}

/** The live panel waits this long after the pin stops moving (UX_MOBILE S8). */
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
  | { kind: 'priceNotSet'; zoneName: string }
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
  if (quote.blockCode === 'PRICING_PRICE_NOT_SET') return { kind: 'priceNotSet', zoneName: quote.zone?.name ?? '' };
  if (!quote.price) return { kind: 'checking' };
  return { kind: 'priced', quote };
}

/**
 * The cost panel under the map (UX_MOBILE S8): checking, priced (the base and every size that costs
 * more than Rs 0), outside the delivery area, no price in that zone (with "Call office"), or an error
 * with "Try again". It is inline and announced, never a pop-up.
 */
export function CostPanel({ state, purpose }: { state: CostPanelState; purpose: 'customer' | 'address' }) {
  const { t } = useTranslation();
  const office = useOfficeContact();

  switch (state.kind) {
    case 'noPin':
      return (
        <Text tone="secondary" style={styles.hint}>
          {t('customers.location.noPin')}
        </Text>
      );
    case 'checking':
      return (
        <Card accessibilityLabel={t('customers.cost.checking')}>
          <View style={styles.row} accessibilityLiveRegion="polite">
            <Icon name="checking" size={24} tone="secondary" />
            <Text tone="secondary" style={styles.flex}>
              {t('customers.cost.checking')}
            </Text>
          </View>
        </Card>
      );
    case 'error':
      return <ErrorBanner error={state.error} onRetry={state.retry} />;
    case 'outside':
    case 'priceNotSet': {
      const text =
        state.kind === 'outside'
          ? t('customers.cost.outside')
          : purpose === 'customer'
            ? t('customers.cost.priceNotSet', { zoneName: state.zoneName })
            : t('customers.cost.priceNotSetAddress', { zoneName: state.zoneName });
      return (
        <Card tone="danger">
          <View style={styles.row} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Icon name="error" size={24} tone="danger" />
            <Text style={styles.flex}>{text}</Text>
          </View>
          {office.phone ? (
            <Button
              label={t('common.actions.callOffice')}
              onPress={office.call}
              icon="call"
              variant="secondary"
              fullWidth={false}
              style={styles.action}
            />
          ) : null}
        </Card>
      );
    }
    case 'priced': {
      const price = state.quote.price!;
      const sizes = price.sizes.filter((size) => isPositivePaisa(size.perCylinderPaisa));
      return (
        <Card tone="success">
          <View style={styles.row} accessibilityLiveRegion="polite">
            <Icon name="ok" size={24} tone="success" />
            <View style={styles.flex}>
              <Text variant="bodyStrong">
                {t('customers.cost.priced', { zone: price.zone.name, base: formatRs(price.basePaisa) })}
              </Text>
              {sizes.map((size) => (
                <Text key={size.cylinderTypeId}>
                  {t('customers.cost.perSize', { amount: formatRs(size.perCylinderPaisa), size: size.sizeLabel })}
                </Text>
              ))}
            </View>
          </View>
        </Card>
      );
    }
  }
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  flex: { flex: 1, gap: space.xs },
  hint: { paddingVertical: space.sm },
  action: { marginTop: space.md },
});

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ClientAddressDto,
  ClientDto,
  DeliveryQuote,
  LocationQuote,
  OrderDto,
  OrderQuoteResult,
} from '@smartfleet/shared-types';
import { formatRs } from '@smartfleet/shared-utils';
import { ORDER_LINE_MAX_COUNT } from '@smartfleet/shared-validation';
import { useIdempotencyKey } from '../../api/client';
import type { ApiError } from '../../api/errors';
import { invalidate, qk, STALE_MS } from '../../api/keys';
import { useAppConfig, useOfficeContact } from '../../hooks/useAppConfig';
import {
  Button,
  Card,
  colors,
  EmptyState,
  ErrorBanner,
  Field,
  Icon,
  layout,
  MoneyText,
  Screen,
  SkeletonCard,
  SkeletonList,
  sizes,
  space,
  StatusChip,
  StepHeader,
  Stepper,
  Text,
  useToast,
} from '../../ui';
import {
  fetchClients,
  fetchCylinderTypes,
  fetchLocationQuote,
  placeOrder,
  quoteOrder,
  type CylinderTypeRow,
  type OrderBody,
} from './shared/api';
import {
  costBreakdownText,
  defaultAddress,
  isPositivePaisa,
  matchesCustomer,
  paisaOrZero,
  phoneText,
  sizeLabelFromWeight,
  subtractPaisa,
  weightSortKey,
} from './shared/format';
import { InfoRow } from './shared/InfoRow';
import { CYLINDER_TYPES_STALE_MS, shopKeys } from './shared/keys';
import { useFormGuard, useShopNavigation, useShopRoute } from './shared/navigation';
import { Notice } from './shared/Notice';
import { StaleNotice } from './shared/StaleNotice';

type Step = 1 | 2 | 3;

/** One size on the order: "Take back" follows "Deliver" until the person changes it. */
interface LineChoice {
  deliver: number;
  back: number;
  backTouched: boolean;
}

/** What blocks a customer's address from being ordered to. */
type AddressBlock = { kind: 'none' } | { kind: 'noAddress' } | { kind: 'priceNotSet'; zoneName: string } | { kind: 'outside' };

function blockOf(address: ClientAddressDto | null): AddressBlock {
  if (!address) return { kind: 'noAddress' };
  if (address.priceStatus === 'SET') return { kind: 'none' };
  if (address.priceStatus === 'NOT_SET') return { kind: 'priceNotSet', zoneName: address.zone?.name ?? '' };
  return { kind: 'outside' };
}

/** The money the shop is short of: from the quote, or from a refused place (fresher). */
interface Shortfall {
  requiredPaisa: string;
  balancePaisa: string;
  shortByPaisa: string;
}

/**
 * S9 New order (replaces PlaceOrderScreen), three steps: who it is for, the cylinders, and "Check and
 * place" built from `POST /orders/quote`. The cost is taken from the wallet when the order is placed
 * (`POST /orders` with this intent's Idempotency-Key and the quoted total). A changed price shows a
 * warning and the new breakdown; a short balance turns the footer into "Add money", prefilled.
 */
export function NewOrderScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { params } = useShopRoute<'NewOrder'>();
  const { config, query: configQuery } = useAppConfig();

  const [step, setStep] = useState<Step>(1);
  const [search, setSearch] = useState('');
  const [clientId, setClientId] = useState<string | null>(params?.clientId ?? null);
  const [addressId, setAddressId] = useState<string | null>(params?.addressId ?? null);
  const [lines, setLines] = useState<Record<string, LineChoice>>({});
  const [changedTotal, setChangedTotal] = useState<string | null>(null);
  const [shortfallFromPlace, setShortfallFromPlace] = useState<Shortfall | null>(null);

  // Back from Add customer or Change address: take the customer (and address) chosen there.
  useEffect(() => {
    if (!params?.pickedAt) return;
    if (params.clientId) setClientId(params.clientId);
    setAddressId(params.addressId ?? null);
  }, [params?.pickedAt, params?.clientId, params?.addressId]);

  const clients = useQuery<ClientDto[], ApiError>({ queryKey: qk.clients, queryFn: fetchClients });
  const types = useQuery<CylinderTypeRow[], ApiError>({
    queryKey: shopKeys.cylinderTypes,
    queryFn: fetchCylinderTypes,
    staleTime: CYLINDER_TYPES_STALE_MS,
  });

  const client = clients.data?.find((c) => c.id === clientId) ?? null;
  const address = client
    ? (addressId ? client.addresses.find((a) => a.id === addressId) : undefined) ?? defaultAddress(client)
    : null;
  const block = blockOf(address);

  // The customer's price, for "Delivery cost about …" and the size words (step 2).
  const addressPrice = useQuery<LocationQuote, ApiError>({
    queryKey: address ? qk.pricing.quote(address.lat, address.lng) : [...qk.pricing.all, 'none'],
    queryFn: () => fetchLocationQuote(address!.lat, address!.lng),
    enabled: !!address && block.kind === 'none' && step >= 2,
    staleTime: STALE_MS.pricingQuote,
  });

  const sizes = useMemo(
    () =>
      [...(types.data ?? [])]
        .sort((a, b) => weightSortKey(a.weightKg) - weightSortKey(b.weightKg))
        .map((type) => ({
          id: type.id,
          label:
            addressPrice.data?.price?.sizes.find((s) => s.cylinderTypeId === type.id)?.sizeLabel ??
            sizeLabelFromWeight(type.weightKg, t),
        })),
    [types.data, addressPrice.data, t],
  );

  const chosen = sizes
    .map((size) => ({ ...size, choice: lines[size.id] }))
    .filter((line): line is { id: string; label: string; choice: LineChoice } => !!line.choice && line.choice.deliver > 0);
  const total = chosen.reduce((sum, line) => sum + line.choice.deliver, 0);
  const cap = config.orders.maxCylindersPerOrder;

  const body: OrderBody | null =
    client && address && block.kind === 'none' && chosen.length > 0
      ? {
          clientId: client.id,
          addressId: address.id,
          deliveryLabel: address.label,
          lines: chosen.map((line) => ({
            cylinderTypeId: line.id,
            fullCount: line.choice.deliver,
            expectedReturnCount: line.choice.back,
          })),
        }
      : null;
  const signature = body ? JSON.stringify(body) : '';

  const quote = useQuery<OrderQuoteResult, ApiError>({
    queryKey: shopKeys.orderQuote(signature),
    queryFn: () => quoteOrder(body!),
    enabled: step === 3 && body !== null,
    staleTime: 0,
  });

  // One key per intent: the same customer, address and cylinders keep it across retries and a
  // changed price (API_CONTRACT §4.2 compares exactly these).
  const idem = useIdempotencyKey([client?.id, address?.id, body ? JSON.stringify(body.lines) : '']);
  const guard = useFormGuard(clientId !== null);

  // "Check and place" reads the refund rule fresh, not the 5-minute copy (G04-02), and re-quotes.
  useEffect(() => {
    if (step !== 3) return;
    void configQuery.refetch();
  }, [step, configQuery.refetch]);
  // Coming back to "Check and place" (e.g. from Add money) quotes again with the balance now.
  const refetchQuote = quote.refetch;
  const hasBody = body !== null;
  useFocusEffect(
    useCallback(() => {
      if (step === 3 && hasBody) void refetchQuote();
    }, [step, hasBody, refetchQuote]),
  );

  // A different order body means a new quote: forget the old warnings.
  useEffect(() => {
    setChangedTotal(null);
    setShortfallFromPlace(null);
  }, [signature]);
  // A refused place's shortfall holds only until a fresher quote says what the wallet has now.
  useEffect(() => {
    setShortfallFromPlace(null);
  }, [quote.dataUpdatedAt]);

  const place = useMutation<OrderDto, ApiError, OrderBody>({
    mutationFn: (orderBody) => placeOrder(orderBody, idem.key),
    onSuccess: (order) => {
      queryClient.setQueryData(qk.orders.byId(order.id), order);
      void invalidate.orderPlacedOrCancelled(queryClient);
      toast.show({
        message: isPositivePaisa(order.fee.totalPaisa)
          ? t('orders.new.placed', { fee: formatRs(order.fee.totalPaisa) })
          : t('orders.new.placedFree'),
        tone: 'success',
      });
      guard.release();
      navigation.replace('OrderDetail', { orderId: order.id });
    },
    onError: (error) => {
      if (error.code === 'PRICING_QUOTE_CHANGED') {
        const details = error.details as { totalPaisa?: unknown; quote?: DeliveryQuote };
        if (typeof details.totalPaisa === 'string') setChangedTotal(details.totalPaisa);
        if (details.quote) {
          queryClient.setQueryData<OrderQuoteResult>(shopKeys.orderQuote(signature), (old) =>
            old ? { ...old, quote: details.quote! } : old,
          );
        }
        void quote.refetch();
      } else if (error.code === 'WALLET_INSUFFICIENT_BALANCE') {
        const d = error.details as Partial<Shortfall>;
        if (d.requiredPaisa && d.balancePaisa && d.shortByPaisa) {
          setShortfallFromPlace({ requiredPaisa: d.requiredPaisa, balancePaisa: d.balancePaisa, shortByPaisa: d.shortByPaisa });
        }
        void quote.refetch();
      }
    },
  });

  const selectClient = (c: ClientDto) => {
    setClientId(c.id);
    setAddressId(defaultAddress(c)?.id ?? null);
  };

  const changeAddress = () => {
    if (!client) return;
    navigation.navigate('PickAddress', { clientId: client.id, selectedAddressId: address?.id });
  };

  const setDeliver = (id: string, deliver: number) =>
    setLines((current) => {
      const previous = current[id] ?? { deliver: 0, back: 0, backTouched: false };
      if (deliver <= 0) {
        const next = { ...current };
        delete next[id];
        return next;
      }
      return { ...current, [id]: { deliver, back: previous.backTouched ? previous.back : deliver, backTouched: previous.backTouched } };
    });

  const setBack = (id: string, back: number) =>
    setLines((current) => {
      const previous = current[id];
      if (!previous) return current;
      return { ...current, [id]: { ...previous, back, backTouched: true } };
    });

  // ---- Step 1: who is it for? ------------------------------------------------------------------
  if (step === 1) {
    const filtered = (clients.data ?? []).filter((c) => matchesCustomer(c, search));
    return (
      <Screen
        scroll={false}
        padded={false}
        footer={<Button label={t('common.actions.next')} onPress={() => setStep(2)} size="lg" disabled={!client || block.kind !== 'none'} />}
      >
        <FlatList
          data={clients.data ? filtered : []}
          keyExtractor={(c) => c.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <StepHeader step={1} total={3} title={t('orders.new.who')} />
              {clients.isError && clients.data ? (
                <StaleNotice updatedAt={clients.dataUpdatedAt} onRetry={() => void clients.refetch()} />
              ) : null}
              <Field
                label={t('orders.new.search')}
                value={search}
                onChangeText={setSearch}
                placeholder={t('orders.new.searchPlaceholder')}
                returnKeyType="search"
                autoCapitalize="none"
              />
              <Button
                label={t('orders.new.addCustomer')}
                onPress={() => navigation.navigate('AddCustomer', { forOrder: true })}
                icon="customer"
                variant="secondary"
              />
              {client ? <AddressBlockCard block={block} onChangeAddress={changeAddress} /> : null}
            </View>
          }
          renderItem={({ item }) => (
            <CustomerRow client={item} selected={item.id === clientId} onPress={() => selectClient(item)} />
          )}
          ItemSeparatorComponent={Divider}
          ListEmptyComponent={
            <View style={styles.empty}>
              {!clients.data ? (
                clients.isError ? (
                  <ErrorBanner error={clients.error} onRetry={() => void clients.refetch()} />
                ) : (
                  <SkeletonList rows={4} />
                )
              ) : clients.data.length === 0 ? (
                <EmptyState icon="customer" title={t('orders.new.noCustomers')} body={t('orders.new.noCustomersBody')} />
              ) : (
                <EmptyState icon="customer" title={t('orders.new.noMatch', { query: search.trim() })} />
              )}
            </View>
          }
        />
      </Screen>
    );
  }

  // ---- Step 2: cylinders -------------------------------------------------------------------------
  if (step === 2) {
    const price = addressPrice.data?.price ?? null;
    const aboutPaisa = price
      ? paisaOrZero(price.basePaisa) +
        chosen.reduce(
          (sum, line) =>
            sum + paisaOrZero(price.sizes.find((s) => s.cylinderTypeId === line.id)?.perCylinderPaisa) * line.choice.deliver,
          0,
        )
      : 0;
    return (
      <Screen
        footer={<Button label={t('common.actions.next')} onPress={() => setStep(3)} size="lg" disabled={total < 1} />}
      >
        <StepHeader step={2} total={3} title={t('orders.new.cylinders')} />
        <View style={styles.stack}>
          <Button label={t('orders.new.back')} onPress={() => setStep(1)} variant="ghost" fullWidth={false} />
          {!types.data ? (
            types.isError ? (
              <ErrorBanner error={types.error} onRetry={() => void types.refetch()} />
            ) : (
              <SkeletonList rows={3} />
            )
          ) : sizes.length === 0 ? (
            <Notice tone="warning" text={t('orders.new.noSizes')} />
          ) : (
            sizes.map((size) => {
              const choice = lines[size.id];
              const deliver = choice?.deliver ?? 0;
              const room = Math.max(0, cap - (total - deliver));
              return (
                <Card key={size.id}>
                  <Text variant="heading">{size.label}</Text>
                  <Stepper
                    label={t('orders.new.deliver')}
                    value={deliver}
                    min={0}
                    max={Math.min(ORDER_LINE_MAX_COUNT, room)}
                    onChange={(value) => setDeliver(size.id, value)}
                    style={styles.stepper}
                  />
                  {deliver > 0 ? (
                    <Stepper
                      label={t('orders.new.takeBack')}
                      value={choice?.back ?? 0}
                      min={0}
                      max={ORDER_LINE_MAX_COUNT}
                      onChange={(value) => setBack(size.id, value)}
                      style={styles.stepper}
                    />
                  ) : null}
                </Card>
              );
            })
          )}
          {total >= cap ? <Notice tone="brand" text={t('orders.new.capReached', { count: cap })} /> : null}
          {total > 0 && aboutPaisa > 0 ? (
            <Text variant="bodyStrong" accessibilityLiveRegion="polite">
              {t('orders.new.costAbout', { fee: formatRs(aboutPaisa) })}
            </Text>
          ) : null}
        </View>
      </Screen>
    );
  }

  // ---- Step 3: check and place -------------------------------------------------------------------
  const result = quote.data;
  const totalPaisa = result?.quote.totalPaisa ?? null;
  const free = result !== undefined && !isPositivePaisa(totalPaisa);
  const shortfall: Shortfall | null =
    shortfallFromPlace ??
    (result && !result.wallet.enough
      ? { requiredPaisa: result.quote.totalPaisa, balancePaisa: result.wallet.balancePaisa, shortByPaisa: result.wallet.shortByPaisa }
      : null);
  const rule = config.orders.deliveryStartedAt;
  const quoteBlocked = !result && quote.isError;

  const submit = () => {
    if (!body || !result || place.isPending) return;
    setChangedTotal(null);
    setShortfallFromPlace(null);
    place.mutate({ ...body, quotedTotalPaisa: result.quote.totalPaisa });
  };

  const placeError =
    place.error && !['PRICING_QUOTE_CHANGED', 'WALLET_INSUFFICIENT_BALANCE'].includes(place.error.code) ? place.error : null;

  const footer = shortfall ? (
    <Button
      label={t('orders.new.addMoney')}
      onPress={() => navigation.navigate('TopupAmount', { shortByPaisa: shortfall.shortByPaisa })}
      size="lg"
      icon="addMoney"
    />
  ) : (
    <Button
      label={
        result && !free ? t('orders.new.place', { fee: formatRs(result.quote.totalPaisa) }) : t('orders.new.placeFree')
      }
      onPress={submit}
      size="lg"
      loading={place.isPending}
      loadingLabel={t('orders.new.placing')}
      disabled={!result || !body}
    />
  );

  return (
    <Screen footer={footer}>
      <StepHeader step={3} total={3} title={t('orders.new.review')} />
      <View style={styles.stack}>
        <Button label={t('orders.new.back')} onPress={() => setStep(2)} variant="ghost" fullWidth={false} disabled={place.isPending} />
        {changedTotal ? (
          <Notice tone="warning" alert text={t('orders.new.priceChanged', { total: formatRs(changedTotal) })} />
        ) : null}
        {result && quote.isError ? (
          <StaleNotice updatedAt={quote.dataUpdatedAt} onRetry={() => void quote.refetch()} />
        ) : null}

        <Card>
          {client ? (
            <InfoRow label={t('orders.new.customer')} divider={false}>
              {t('orders.new.customerValue', { name: client.name, phone: phoneText(client.phone) })}
            </InfoRow>
          ) : null}
          {address ? (
            <InfoRow
              label={t('orders.new.deliverTo')}
              action={
                <Button
                  label={t('orders.new.changeAddress')}
                  onPress={changeAddress}
                  variant="ghost"
                  fullWidth={false}
                  disabled={place.isPending}
                />
              }
            >
              {t('orders.new.deliverToValue', {
                label: address.label,
                zone: result?.quote.zone.name ?? address.zone?.name ?? '',
              })}
            </InfoRow>
          ) : null}
          <InfoRow label={t('orders.new.cylindersRow')}>
            <View style={styles.lines}>
              {chosen.map((line) => (
                <Text key={line.id}>
                  {t('orders.new.line', { count: line.choice.deliver, size: line.label, back: line.choice.back })}
                </Text>
              ))}
            </View>
          </InfoRow>
          <InfoRow label={t('orders.new.deliveryCost')}>
            {result ? (
              <Text variant="bodyStrong">{costBreakdownText(result.quote, t)}</Text>
            ) : quoteBlocked ? (
              <Text tone="secondary">{formatRs(null)}</Text>
            ) : (
              <SkeletonCard lines={1} />
            )}
          </InfoRow>
          {result && !free ? (
            <InfoRow label={t('orders.new.yourWallet')}>
              <View style={styles.walletRow}>
                <Text style={styles.flex}>{t('orders.new.balanceNow')}</Text>
                <MoneyText paisa={result.wallet.balancePaisa} variant="bodyStrong" />
              </View>
              {shortfall ? null : (
                <View style={styles.walletRow}>
                  <Text style={styles.flex}>{t('orders.new.balanceAfter')}</Text>
                  <MoneyText paisa={subtractPaisa(result.wallet.balancePaisa, result.quote.totalPaisa)} variant="bodyStrong" />
                </View>
              )}
            </InfoRow>
          ) : null}
        </Card>

        {shortfall ? (
          <Notice
            tone="danger"
            alert
            text={t('orders.new.notEnough', {
              required: formatRs(shortfall.requiredPaisa),
              balance: formatRs(shortfall.balancePaisa),
            })}
          />
        ) : null}

        {result && !free && !shortfall ? (
          <Notice
            tone="brand"
            icon="info"
            text={t(`orders.new.refundRule.${rule}`, { fee: formatRs(result.quote.totalPaisa) })}
          />
        ) : null}

        {quoteBlocked ? (
          <ErrorBanner
            error={quote.error}
            onRetry={() => void quote.refetch()}
            extraAction={
              quote.error?.code === 'PRICING_PRICE_NOT_SET' || quote.error?.code === 'PRICING_ZONE_NOT_COVERED'
                ? { label: t('orders.new.changeAddress'), onPress: changeAddress, icon: 'map' }
                : undefined
            }
          />
        ) : null}
        {placeError ? <ErrorBanner error={placeError} onRetry={submit} /> : null}
      </View>
    </Screen>
  );
}

/** A customer in step 1: name, "0300 1234567 · Model Town", and the zone chip or why it can't be ordered. */
function CustomerRow({ client, selected, onPress }: { client: ClientDto; selected: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const address = defaultAddress(client);
  const phone = phoneText(client.phone);
  const subtitle = client.area ? t('orders.new.customerRow', { phone, area: client.area }) : phone;
  const chip =
    !address ? (
      <StatusChip tone="neutral" label={t('orders.new.noAddress')} icon="map" />
    ) : address.priceStatus === 'SET' && address.zone ? (
      <StatusChip tone="neutral" label={address.zone.name} icon="map" />
    ) : address.priceStatus === 'NOT_SET' ? (
      <StatusChip tone="danger" label={t('orders.new.noPrice')} icon="error" />
    ) : address.priceStatus === 'OUTSIDE' ? (
      <StatusChip tone="danger" label={t('orders.new.outside')} icon="error" />
    ) : null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={[client.name, subtitle].join(', ')}
      android_ripple={{ color: colors.ripple }}
      style={[styles.customer, selected ? styles.customerSelected : null]}
    >
      <View style={styles.flex}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {client.name}
        </Text>
        <Text variant="caption" tone="secondary">
          {subtitle}
        </Text>
        {chip ? <View style={styles.chip}>{chip}</View> : null}
      </View>
      {selected ? <Icon name="ok" size={24} tone="brand" label={t('orders.new.selected')} /> : null}
    </Pressable>
  );
}

/** Why the chosen customer's address can't take an order yet, with what to do about it. */
function AddressBlockCard({ block, onChangeAddress }: { block: AddressBlock; onChangeAddress: () => void }) {
  const { t } = useTranslation();
  const office = useOfficeContact();
  if (block.kind === 'none') return null;
  const text =
    block.kind === 'noAddress'
      ? t('orders.new.needsAddress')
      : block.kind === 'priceNotSet'
        ? t('orders.new.priceNotSet', { zoneName: block.zoneName })
        : t('orders.new.outsideCard');
  return (
    <Notice tone="danger" alert text={text}>
      <Button
        label={block.kind === 'noAddress' ? t('orders.new.addAddress') : t('orders.new.changeAddress')}
        onPress={onChangeAddress}
        icon="map"
        variant="secondary"
        fullWidth={false}
      />
      {block.kind !== 'noAddress' && office.phone ? (
        <Button label={t('common.actions.callOffice')} onPress={office.call} icon="call" variant="secondary" fullWidth={false} />
      ) : null}
    </Notice>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  flex: { flex: 1 },
  listContent: { paddingBottom: space.xxl, flexGrow: 1 },
  listHeader: { padding: layout.gutter, gap: space.md },
  empty: { paddingHorizontal: layout.gutter },
  customer: {
    minHeight: sizes.listRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.gutter,
    paddingVertical: space.md,
    backgroundColor: colors.surface,
  },
  customerSelected: { backgroundColor: colors.brandSoft },
  chip: { marginTop: space.xs },
  divider: { height: 1, backgroundColor: colors.border },
  stepper: { marginTop: space.md },
  lines: { gap: space.xs },
  walletRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});

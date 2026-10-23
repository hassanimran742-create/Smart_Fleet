import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
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
import { isNetworkError, type ApiError } from '../../api/errors';
import { invalidate, qk, STALE_MS } from '../../api/keys';
import { useAppConfig, useOfficeContact } from '../../hooks/useAppConfig';
import {
  ActionLine,
  Button,
  Card,
  colors,
  ErrorBanner,
  Fab,
  Icon,
  MoneyText,
  OfflineEmpty,
  radius,
  Screen,
  Skeleton,
  SkeletonList,
  sizes,
  space,
  StepHeader,
  Stepper,
  Text,
  useToast,
  type IconName,
} from '../../ui';
import { fetchLocationQuote, placeOrder, quoteOrder, type OrderBody } from './shared/api';
import { AddressPickerSheet } from './shared/AddressPickerSheet';
import { CustomerList } from './shared/CustomerList';
import {
  addressBlock,
  costParts,
  defaultAddress,
  isPositivePaisa,
  lastOrderOf,
  paisaOrZero,
  phoneText,
  sizeLabelFromWeight,
  subtractPaisa,
  weightSortKey,
} from './shared/format';
import { shopKeys } from './shared/keys';
import { useFormGuard, useShopNavigation, useShopRoute, useStepBack } from './shared/navigation';
import { Notice } from './shared/Notice';
import { firstPageOf, useClients, useCylinderTypes, useOrderPages } from './shared/queries';
import { StaleNotice } from './shared/StaleNotice';

type Step = 1 | 2 | 3;

/** One size on the order: "Take back" follows "Deliver" until the person changes it. */
interface LineChoice {
  deliver: number;
  back: number;
  backTouched: boolean;
}

/** The money the shop is short of: from the quote, or from a refused place (fresher). */
interface Shortfall {
  requiredPaisa: string;
  balancePaisa: string;
  shortByPaisa: string;
}

/** Lets the address sheet slide away before New address opens. */
const SHEET_CLOSE_MS = 200;

/**
 * S9 New order (shop spec §N, §O, §P), three steps:
 * 1. Who is it for? The customer list: a tap goes straight on, "Recent" first, a blocked row opens in
 *    place with its fix, and "+ Add customer" floats.
 * 2. Cylinders to deliver: one row per size, starting at 0, with "Same as last time" when the customer
 *    has ordered before (DECIDED: never prefilled silently), and the cost line above "Next".
 * 3. Check and place: one summary card from `POST /orders/quote`, the cost as a big total, the refund
 *    rule in one line, and "Place order · pay Rs 330". The cost is taken when the order is placed
 *    (`POST /orders` with this intent's Idempotency-Key and the quoted total). A changed price shows
 *    a line and the new total; a short balance turns the button into "Add money", prefilled.
 * The header arrow goes back a step; every step opens at the top.
 */
export function NewOrderScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const office = useOfficeContact();
  const { params } = useShopRoute<'NewOrder'>();
  const { config, query: configQuery } = useAppConfig();

  // A customer arriving with the route (Customers, Add customer, "Use Sana", New address) opens step 2.
  const [step, setStep] = useState<Step>(params?.clientId && params?.pickedAt ? 2 : 1);
  const [clientId, setClientId] = useState<string | null>(params?.clientId ?? null);
  const [addressId, setAddressId] = useState<string | null>(params?.addressId ?? null);
  const [lines, setLines] = useState<Record<string, LineChoice>>({});
  const [changedTotal, setChangedTotal] = useState<string | null>(null);
  const [shortfallFromPlace, setShortfallFromPlace] = useState<Shortfall | null>(null);
  /** The customer whose addresses the "Deliver to" sheet shows (the chosen one, or a blocked row's). */
  const [sheetClient, setSheetClient] = useState<ClientDto | null>(null);

  const clientRef = useRef(clientId);
  const stepRef = useRef(step);
  clientRef.current = clientId;
  stepRef.current = step;

  const choose = useCallback((nextClientId: string, nextAddressId: string | null) => {
    if (nextClientId !== clientRef.current) setLines({});
    setClientId(nextClientId);
    setAddressId(nextAddressId);
  }, []);

  // Back from Add customer, "Use Sana" or New address: take the customer (and address) chosen there.
  const seenPick = useRef(params?.pickedAt);
  useEffect(() => {
    if (!params?.pickedAt || params.pickedAt === seenPick.current || !params.clientId) return;
    seenPick.current = params.pickedAt;
    choose(params.clientId, params.addressId ?? null);
    if (stepRef.current === 1 || params.clientId !== clientRef.current) setStep(2);
  }, [params?.pickedAt, params?.clientId, params?.addressId, choose]);

  const clients = useClients();
  const types = useCylinderTypes();
  // "Same as last time" reads the newest orders My orders and "Recent" already loaded.
  const activeOrders = useOrderPages('active');
  const doneOrders = useOrderPages('done');

  const client = clients.data?.find((c) => c.id === clientId) ?? null;
  const address = client
    ? (addressId ? client.addresses.find((a) => a.id === addressId) : undefined) ?? defaultAddress(client)
    : null;
  const block = addressBlock(address);

  // The customer's price, for "Delivery cost about …" and the size words (step 2).
  const addressPrice = useQuery<LocationQuote, ApiError>({
    queryKey: address ? qk.pricing.quote(address.lat, address.lng) : [...qk.pricing.all, 'none'],
    queryFn: () => fetchLocationQuote(address!.lat, address!.lng),
    enabled: !!address && block === 'none' && step >= 2,
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

  const lastOrder: OrderDto | null = clientId
    ? lastOrderOf(clientId, [firstPageOf(activeOrders.data), firstPageOf(doneOrders.data)])
    : null;
  const lastLines = (lastOrder?.lines ?? []).filter(
    (line) => line.fullCount > 0 && sizes.some((size) => size.id === line.cylinderTypeId),
  );

  const body: OrderBody | null =
    client && address && block === 'none' && chosen.length > 0
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
  // On steps 2 and 3 the header arrow goes back a step; only leaving from step 1 asks.
  const guard = useFormGuard((clientId !== null || total > 0) && step === 1);
  useStepBack(step, () => setStep((current) => (current > 1 ? ((current - 1) as Step) : current)));

  // "Check and place" reads the refund rule fresh, not the 5-minute copy (G04-02), and re-quotes.
  const refetchConfig = configQuery.refetch;
  useEffect(() => {
    if (step !== 3) return;
    void refetchConfig();
  }, [step, refetchConfig]);
  // Coming back to "Check and place" (e.g. from Add money) quotes again with the balance now.
  const refetchQuote = quote.refetch;
  const hasBody = body !== null;
  useFocusEffect(
    useCallback(() => {
      if (step === 3 && hasBody) void refetchQuote();
    }, [step, hasBody, refetchQuote]),
  );

  // A different order body means a new quote: forget the old lines.
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

  /** "Same as last time": the sizes and counts of this customer's newest order, in one tap. */
  const fillLast = () => {
    const next: Record<string, LineChoice> = {};
    let room = cap;
    for (const line of lastLines) {
      const deliver = Math.min(line.fullCount, ORDER_LINE_MAX_COUNT, room);
      if (deliver <= 0) continue;
      room -= deliver;
      const back = Math.min(line.expectedReturnCount, ORDER_LINE_MAX_COUNT);
      next[line.cylinderTypeId] = { deliver, back, backTouched: back !== deliver };
    }
    setLines(next);
  };

  const openSheet = (forClient: ClientDto) => setSheetClient(forClient);
  const sheet = (
    <AddressPickerSheet
      visible={sheetClient !== null}
      client={sheetClient}
      currentAddressId={sheetClient && sheetClient.id === clientId ? address?.id : null}
      onClose={() => setSheetClient(null)}
      onPick={(picked) => {
        if (!sheetClient) return;
        choose(sheetClient.id, picked.id);
        if (step === 1) setStep(2);
      }}
      onNewAddress={() => {
        if (!sheetClient) return;
        const forClient = sheetClient.id;
        setTimeout(() => navigation.navigate('NewAddress', { clientId: forClient }), SHEET_CLOSE_MS);
      }}
    />
  );

  // ---- Step 1: who is it for? ------------------------------------------------------------------
  if (step === 1) {
    return (
      <Screen
        key="step-1"
        scroll={false}
        padded={false}
        fab={
          <Fab label={t('customers.list.add')} onPress={() => navigation.navigate('AddCustomer', { forOrder: true })} />
        }
      >
        <CustomerList
          variant="order"
          header={<StepHeader step={1} total={3} title={t('orders.new.who')} style={styles.stepHeader} />}
          chosenId={clientId}
          onPick={(picked: ClientDto, pickedAddress: ClientAddressDto) => {
            choose(picked.id, pickedAddress.id);
            setStep(2);
          }}
          onChangeAddress={openSheet}
          onAddAddress={(forClient) => navigation.navigate('NewAddress', { clientId: forClient.id })}
        />
        {sheet}
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
        key="step-2"
        footer={
          <>
            {total === 0 ? (
              <Text tone="secondary" align="center">
                {t('orders.new.pickSome')}
              </Text>
            ) : aboutPaisa > 0 ? (
              <Text variant="bodyStrong" align="center" accessibilityLiveRegion="polite">
                {t('orders.new.costAbout', { fee: formatRs(aboutPaisa) })}
              </Text>
            ) : null}
            {total >= cap ? (
              <Text tone="secondary" align="center">
                {t('orders.new.capReached', { count: cap })}
              </Text>
            ) : null}
            <Button label={t('common.actions.next')} onPress={() => setStep(3)} size="lg" disabled={total < 1} />
          </>
        }
      >
        <StepHeader step={2} total={3} title={t('orders.new.cylinders')} />
        <View style={styles.stack}>
          {client && address ? (
            <Text tone="secondary">{t('orders.new.forCustomer', { name: client.name, address: address.label })}</Text>
          ) : null}
          {total === 0 && lastLines.length > 0 ? (
            <ActionChip icon="history" label={t('orders.new.sameAsLast')} onPress={fillLast} />
          ) : null}
          {!types.data ? (
            types.isError ? (
              isNetworkError(types.error) ? (
                <OfflineEmpty onRetry={() => void types.refetch()} />
              ) : (
                <ErrorBanner error={types.error} onRetry={() => void types.refetch()} />
              )
            ) : (
              <SkeletonList rows={3} />
            )
          ) : sizes.length === 0 ? (
            <Notice tone="warning" text={t('orders.new.noSizes')}>
              {office.phone ? (
                <Button
                  label={t('common.actions.callOffice')}
                  onPress={office.call}
                  icon="call"
                  variant="secondary"
                  fullWidth={false}
                />
              ) : null}
            </Notice>
          ) : (
            <Card padding={0}>
              {sizes.map((size, index) => {
                const choice = lines[size.id];
                const deliver = choice?.deliver ?? 0;
                const room = Math.max(0, cap - (total - deliver));
                return (
                  <View key={size.id} style={[styles.sizeRow, index > 0 ? styles.divided : null]}>
                    <Stepper
                      label={size.label}
                      value={deliver}
                      min={0}
                      max={Math.min(ORDER_LINE_MAX_COUNT, room)}
                      onChange={(value) => setDeliver(size.id, value)}
                    />
                    {deliver > 0 ? (
                      <Stepper
                        label={t('orders.new.takeBack')}
                        value={choice?.back ?? 0}
                        min={0}
                        max={ORDER_LINE_MAX_COUNT}
                        onChange={(value) => setBack(size.id, value)}
                        style={styles.takeBack}
                      />
                    ) : null}
                  </View>
                );
              })}
            </Card>
          )}
        </View>
        {sheet}
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
  const quoteError = !result && quote.isError ? quote.error : null;
  const priceBlock =
    quoteError?.code === 'PRICING_PRICE_NOT_SET' ? 'noPrice' : quoteError?.code === 'PRICING_ZONE_NOT_COVERED' ? 'outside' : null;
  const parts = result && !free ? costParts(result.quote, t) : null;

  const submit = () => {
    if (!body || !result || place.isPending) return;
    setChangedTotal(null);
    setShortfallFromPlace(null);
    place.mutate({ ...body, quotedTotalPaisa: result.quote.totalPaisa });
  };

  const placeError =
    place.error && !['PRICING_QUOTE_CHANGED', 'WALLET_INSUFFICIENT_BALANCE'].includes(place.error.code) ? place.error : null;

  // At most one line above the button: short of money, a changed price, or the place's own failure.
  const footerLine = shortfall ? (
    <FooterLine
      tone="danger"
      text={t('orders.new.notEnough', { required: formatRs(shortfall.requiredPaisa), balance: formatRs(shortfall.balancePaisa) })}
    />
  ) : changedTotal ? (
    <FooterLine tone="warning" text={t('orders.new.priceChanged', { total: formatRs(changedTotal) })} />
  ) : (
    <ActionLine error={placeError} notSentLabel={t('orders.new.notSent')} />
  );

  const footer = (
    <>
      {footerLine}
      {shortfall ? (
        <Button
          label={t('orders.new.addMoney')}
          onPress={() => navigation.navigate('TopupAmount', { shortByPaisa: shortfall.shortByPaisa })}
          size="lg"
          icon="addMoney"
        />
      ) : (
        <Button
          label={result && !free ? t('orders.new.place', { fee: formatRs(result.quote.totalPaisa) }) : t('orders.new.placeFree')}
          onPress={submit}
          size="lg"
          loading={place.isPending}
          loadingLabel={t('orders.new.placing')}
          disabled={!result || !body}
        />
      )}
    </>
  );

  return (
    <Screen key="step-3" footer={footer}>
      <StepHeader step={3} total={3} title={t('orders.new.review')} />
      <View style={styles.stack}>
        {result && quote.isError ? (
          <StaleNotice updatedAt={quote.dataUpdatedAt} onRetry={() => void quote.refetch()} />
        ) : null}

        <Card padding={0}>
          {client && address ? (
            <CardSection first>
              <View style={styles.between}>
                <View style={styles.flex}>
                  <Text variant="bodyStrong">
                    {t('orders.new.customerValue', { name: client.name, phone: phoneText(client.phone) })}
                  </Text>
                  <Text tone="secondary">{address.label}</Text>
                </View>
                <Button
                  label={t('orders.new.change')}
                  accessibilityLabel={t('customers.block.changeAddress')}
                  onPress={() => openSheet(client)}
                  variant="ghost"
                  fullWidth={false}
                  disabled={place.isPending}
                />
              </View>
            </CardSection>
          ) : null}

          <CardSection>
            {chosen.map((line) => (
              <Text key={line.id}>
                {line.choice.back > 0
                  ? t('orders.new.line', { count: line.choice.deliver, size: line.label, back: line.choice.back })
                  : t('orders.new.lineNoBack', { count: line.choice.deliver, size: line.label })}
              </Text>
            ))}
          </CardSection>

          <CardSection>
            <View style={styles.between}>
              <Text variant="label" tone="secondary" style={styles.flex}>
                {t('orders.new.deliveryCost')}
              </Text>
              {result ? (
                free ? (
                  <Text variant="bodyStrong">{t('orders.new.costNone')}</Text>
                ) : (
                  <MoneyText paisa={result.quote.totalPaisa} variant="title" numberOfLines={1} />
                )
              ) : quoteError ? null : (
                <Skeleton width={112} height={28} />
              )}
            </View>
            {parts ? (
              <Text variant="caption" tone="secondary" align="right">
                {parts}
              </Text>
            ) : null}
            {quoteError && priceBlock && client ? (
              <BlockedCost block={priceBlock} onChangeAddress={() => openSheet(client)} />
            ) : quoteError ? (
              <View style={styles.costError}>
                <FooterLine tone="danger" text={t('orders.new.costError')} />
                <Button
                  label={t('common.actions.tryAgain')}
                  onPress={() => void quote.refetch()}
                  variant="secondary"
                  fullWidth={false}
                />
              </View>
            ) : null}
          </CardSection>

          {result && !free ? (
            <CardSection>
              <View style={styles.between}>
                <Text style={styles.flex}>{t('orders.new.balanceNow')}</Text>
                <MoneyText paisa={result.wallet.balancePaisa} variant="bodyStrong" />
              </View>
              {shortfall ? null : (
                <View style={styles.between}>
                  <Text style={styles.flex}>{t('orders.new.balanceAfter')}</Text>
                  <MoneyText paisa={subtractPaisa(result.wallet.balancePaisa, result.quote.totalPaisa)} variant="bodyStrong" />
                </View>
              )}
            </CardSection>
          ) : null}
        </Card>

        {result && !free && !shortfall ? (
          <View style={styles.rule}>
            <Icon name="info" size={20} tone="secondary" />
            <Text variant="caption" tone="secondary" style={styles.flex}>
              {t(`orders.new.refundRule.${rule}`)}
            </Text>
          </View>
        ) : null}
      </View>
      {sheet}
    </Screen>
  );
}

/** One section of the summary card, under a 1 px line (none above the first). */
function CardSection({ children, first = false }: { children: ReactNode; first?: boolean }) {
  return <View style={[styles.section, first ? null : styles.divided]}>{children}</View>;
}

/** A one-line message with its icon, in the footer or under the cost. */
function FooterLine({ tone, text }: { tone: 'danger' | 'warning'; text: string }) {
  return (
    <View style={styles.footerLine} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Icon name={tone === 'danger' ? 'error' : 'warn'} size={20} tone={tone} />
      <Text variant="caption" tone={tone} style={styles.flex}>
        {text}
      </Text>
    </View>
  );
}

/** The cost can't be worked out for this address: why, then "Change address" and "Call office", stacked. */
function BlockedCost({ block, onChangeAddress }: { block: 'noPrice' | 'outside'; onChangeAddress: () => void }) {
  const { t } = useTranslation();
  const office = useOfficeContact();
  return (
    <View style={styles.costError}>
      <FooterLine tone="danger" text={block === 'noPrice' ? t('customers.block.noPrice') : t('customers.block.outside')} />
      <Button label={t('customers.block.changeAddress')} onPress={onChangeAddress} icon="map" variant="secondary" />
      {office.phone ? (
        <Button label={t('common.actions.callOffice')} onPress={office.call} icon="call" variant="secondary" />
      ) : null}
    </View>
  );
}

/** A one-tap chip that does something ("Same as last time"), in the ChoiceChips look. */
function ActionChip({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={{ color: colors.ripple }}
      style={styles.chip}
    >
      <Icon name={icon} size={20} tone="brand" />
      <Text variant="label" tone="brand" style={styles.chipLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  flex: { flex: 1 },
  stepHeader: { marginBottom: 0 },
  // At least 64 dp a size (the 48 dp stepper and 8 dp above and below), so 4 sizes fit on a phone.
  sizeRow: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  takeBack: { marginStart: space.lg, marginTop: space.sm },
  divided: { borderTopWidth: 1, borderTopColor: colors.border },
  section: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.xs },
  between: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  costError: { gap: space.sm, marginTop: space.xs, alignItems: 'stretch' },
  rule: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  footerLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  chip: {
    alignSelf: 'flex-start',
    minHeight: sizes.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    maxWidth: '100%',
  },
  chipLabel: { flexShrink: 1 },
});

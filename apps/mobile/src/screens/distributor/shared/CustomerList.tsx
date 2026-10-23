import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import type { ClientAddressDto, ClientDto } from '@smartfleet/shared-types';
import { isNetworkError } from '../../../api/errors';
import { useOfficeContact } from '../../../hooks/useAppConfig';
import {
  Button,
  colors,
  EmptyState,
  ErrorBanner,
  FAB_CLEARANCE,
  Field,
  Icon,
  layout,
  ListRow,
  OfflineEmpty,
  SkeletonList,
  space,
  StatusChip,
  Text,
} from '../../../ui';
import { CallButton } from './CallButton';
import { addressBlock, byName, defaultAddress, matchesCustomer, phoneText, recentCustomerIds, type AddressBlock } from './format';
import { firstPageOf, useClients, useOrderPages } from './queries';
import { StaleNotice } from './StaleNotice';

export interface CustomerListProps {
  /**
   * `customers` (S8b): each row has a call button. `order` (New order step 1): tapping chooses, and
   * the chosen row shows a tick.
   */
  variant: 'customers' | 'order';
  /** Above the search box, e.g. New order's step header. */
  header?: ReactNode;
  /** New order: the customer chosen before, ticked when the person comes back to step 1. */
  chosenId?: string | null;
  /** A tap on a customer whose default address can take an order. */
  onPick: (client: ClientDto, address: ClientAddressDto) => void;
  /** "Change address" on a blocked row: the host opens the address sheet (§Q). */
  onChangeAddress: (client: ClientDto) => void;
  /** "Add address" on a customer with none: the host opens New address (§R). */
  onAddAddress: (client: ClientDto) => void;
}

interface Section {
  key: string;
  title?: string;
  data: ClientDto[];
}

/** How many customers "Recent" shows (shop spec §K). */
const RECENT_COUNT = 5;
/** Lets an opened row lay out before the list scrolls it into view. */
const EXPAND_SCROLL_MS = 120;

/**
 * The customer list of Customers and New order step 1 (shop spec §K, §N): a search box, "Recent" (the
 * customers of the newest orders) and "All customers" A–Z, in WhatsApp-like rows. A row that can't
 * take an order says why with a red chip, and a tap opens it in place, one at a time, with its fix.
 * Searching filters the downloaded list on the phone (CUS-009); GET /clients has no search.
 */
export function CustomerList({ variant, header, chosenId = null, onPick, onChangeAddress, onAddAddress }: CustomerListProps) {
  const { t } = useTranslation();
  const clients = useClients();
  // "Recent" reads the first pages My orders shows; if either list fails, the section just doesn't show.
  const active = useOrderPages('active');
  const done = useOrderPages('done');
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const listRef = useRef<SectionList<ClientDto, Section>>(null);

  const trimmed = query.trim();
  const searching = trimmed.length > 0;
  const activeFirst = firstPageOf(active.data);
  const doneFirst = firstPageOf(done.data);

  const sections = useMemo<Section[]>(() => {
    const all = clients.data ?? [];
    if (searching) {
      const found = all.filter((client) => matchesCustomer(client, trimmed)).sort(byName);
      return found.length ? [{ key: 'found', data: found }] : [];
    }
    const recentIds = activeFirst && doneFirst ? recentCustomerIds([activeFirst, doneFirst], RECENT_COUNT) : [];
    const recent = recentIds
      .map((id) => all.find((client) => client.id === id))
      .filter((client): client is ClientDto => client !== undefined);
    const rest = all.filter((client) => !recent.includes(client)).sort(byName);
    const out: Section[] = [];
    if (recent.length) out.push({ key: 'recent', title: t('customers.list.recent'), data: recent });
    if (rest.length) out.push({ key: 'all', title: recent.length ? t('customers.list.all') : undefined, data: rest });
    return out;
  }, [clients.data, searching, trimmed, activeFirst, doneFirst, t]);

  const refetchClients = clients.refetch;
  const refetchActive = active.refetch;
  const refetchDone = done.refetch;
  const refresh = useCallback(() => {
    setRefreshing(true);
    Promise.all([refetchClients(), refetchActive(), refetchDone()])
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  }, [refetchClients, refetchActive, refetchDone]);

  const tap = (client: ClientDto) => {
    const address = defaultAddress(client);
    if (address && addressBlock(address) === 'none') {
      setExpandedId(null);
      onPick(client, address);
      return;
    }
    const opening = expandedId !== client.id;
    setExpandedId(opening ? client.id : null);
    if (!opening) return;
    // The fix it shows must not open under the floating "+ Add customer": bring the row to the top
    // (its top is known before it opens; its new height isn't yet).
    const sectionIndex = sections.findIndex((section) => section.data.includes(client));
    const itemIndex = sectionIndex >= 0 ? sections[sectionIndex].data.indexOf(client) : -1;
    if (itemIndex < 0) return;
    setTimeout(
      () => listRef.current?.scrollToLocation({ sectionIndex, itemIndex, viewPosition: 0, animated: true }),
      EXPAND_SCROLL_MS,
    );
  };

  const listHeader = (
    <View style={styles.header}>
      {header}
      <Field
        leadingIcon="search"
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          setExpandedId(null);
        }}
        placeholder={t('customers.list.search')}
        accessibilityLabel={t('customers.list.searchA11y')}
        autoCapitalize="none"
        autoComplete="off"
        returnKeyType="search"
      />
      {clients.isError && clients.data ? (
        <StaleNotice updatedAt={clients.dataUpdatedAt} onRetry={() => void clients.refetch()} />
      ) : null}
    </View>
  );

  const empty = !clients.data ? (
    clients.isError ? (
      isNetworkError(clients.error) ? (
        <OfflineEmpty onRetry={() => void clients.refetch()} />
      ) : (
        <ErrorBanner error={clients.error} onRetry={() => void clients.refetch()} />
      )
    ) : (
      <SkeletonList rows={5} />
    )
  ) : searching ? (
    <EmptyState icon="search" title={t('customers.list.noMatch', { query: trimmed })} />
  ) : (
    <EmptyState icon="customers" title={t('customers.list.empty')} />
  );

  return (
    <SectionList<ClientDto, Section>
      ref={listRef}
      sections={sections}
      keyExtractor={(client) => client.id}
      extraData={`${expandedId ?? ''}|${chosenId ?? ''}`}
      stickySectionHeadersEnabled={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
      ListHeaderComponent={listHeader}
      renderSectionHeader={({ section }) =>
        section.title ? (
          <Text variant="label" tone="secondary" style={styles.sectionTitle} accessibilityRole="header">
            {section.title}
          </Text>
        ) : null
      }
      renderItem={({ item }) => (
        <CustomerRow
          client={item}
          variant={variant}
          chosen={item.id === chosenId}
          expanded={item.id === expandedId}
          onPress={() => tap(item)}
          onChangeAddress={() => onChangeAddress(item)}
          onAddAddress={() => onAddAddress(item)}
        />
      )}
      ItemSeparatorComponent={Divider}
      ListEmptyComponent={<View style={styles.empty}>{empty}</View>}
      onScrollToIndexFailed={() => undefined}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.brand]} tintColor={colors.brand} />}
    />
  );
}

function blockChipLabel(block: AddressBlock, t: TFunction): string | null {
  if (block === 'noPrice') return t('orders.new.noPrice');
  if (block === 'outside') return t('orders.new.outside');
  if (block === 'noAddress') return t('orders.new.noAddress');
  return null;
}

function CustomerRow({
  client,
  variant,
  chosen,
  expanded,
  onPress,
  onChangeAddress,
  onAddAddress,
}: {
  client: ClientDto;
  variant: 'customers' | 'order';
  chosen: boolean;
  expanded: boolean;
  onPress: () => void;
  onChangeAddress: () => void;
  onAddAddress: () => void;
}) {
  const { t } = useTranslation();
  const block = addressBlock(defaultAddress(client));
  const phone = phoneText(client.phone);
  const subtitle = client.area ? t('orders.new.customerRow', { phone, area: client.area }) : phone;
  const chip = blockChipLabel(block, t);
  const spoken = [client.name, subtitle, chip, chosen ? t('orders.new.selected') : null].filter(Boolean).join(', ');

  const trailing =
    variant === 'customers' ? (
      <CallButton phone={client.phone} label={t('customers.list.call', { name: client.name })} />
    ) : chosen ? (
      <Icon name="ok" size={24} tone="brand" />
    ) : undefined;

  return (
    <View>
      <ListRow
        title={client.name}
        subtitle={subtitle}
        trailing={trailing}
        below={chip ? <StatusChip tone="danger" icon="error" label={chip} /> : undefined}
        onPress={onPress}
        accessibilityLabel={spoken}
        style={chosen ? styles.chosen : undefined}
      />
      {expanded && block !== 'none' ? (
        <BlockedActions block={block} onChangeAddress={onChangeAddress} onAddAddress={onAddAddress} />
      ) : null}
    </View>
  );
}

/** A blocked row opened in place (shop spec §K): one line and its fix, stacked (the labels are long). */
function BlockedActions({
  block,
  onChangeAddress,
  onAddAddress,
}: {
  block: Exclude<AddressBlock, 'none'>;
  onChangeAddress: () => void;
  onAddAddress: () => void;
}) {
  const { t } = useTranslation();
  const office = useOfficeContact();
  const line =
    block === 'noPrice'
      ? t('customers.block.noPrice')
      : block === 'outside'
        ? t('customers.block.outside')
        : t('customers.block.noAddress');
  return (
    <View style={styles.expanded}>
      <View style={styles.blockLine} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Icon name="error" size={20} tone="danger" />
        <Text style={styles.flex}>{line}</Text>
      </View>
      {block === 'noAddress' ? (
        <Button label={t('customers.block.addAddress')} onPress={onAddAddress} icon="map" variant="secondary" />
      ) : (
        <>
          <Button label={t('customers.block.changeAddress')} onPress={onChangeAddress} icon="map" variant="secondary" />
          {office.phone ? (
            <Button label={t('common.actions.callOffice')} onPress={office.call} icon="call" variant="secondary" />
          ) : null}
        </>
      )}
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  content: { paddingBottom: FAB_CLEARANCE, flexGrow: 1 },
  header: { padding: layout.gutter, gap: space.md },
  sectionTitle: {
    paddingHorizontal: layout.gutter,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    backgroundColor: colors.canvas,
  },
  divider: { height: 1, backgroundColor: colors.border },
  empty: { paddingHorizontal: layout.gutter },
  chosen: { backgroundColor: colors.brandSoft },
  expanded: {
    paddingHorizontal: layout.gutter,
    paddingBottom: space.md,
    gap: space.sm,
    backgroundColor: colors.surface,
  },
  blockLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
});

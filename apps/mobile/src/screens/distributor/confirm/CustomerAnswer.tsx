import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Clipboard, Linking, Share, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { ConfirmationShareVia, ConfirmationView, OrderDto } from '@smartfleet/shared-types';
import { newRequestId, useIdempotencyKey } from '../../../api/client';
import { toApiError, toUserMessage, type ApiError } from '../../../api/errors';
import { qk } from '../../../api/keys';
import { useAppConfig } from '../../../hooks/useAppConfig';
import { useFocusedInterval } from '../../../hooks/useFocusedInterval';
import { whenTranslate } from '../../../i18n';
import {
  ActionLine,
  Button,
  Card,
  ConfirmSheet,
  ErrorBanner,
  Icon,
  keepTogether,
  PickerSheet,
  Skeleton,
  space,
  StatusChip,
  Text,
  useToast,
  type IconName,
  type PickerItem,
} from '../../../ui';
import { fetchConfirmation, makeNewConfirmationLink, shareConfirmation } from '../shared/api';
import { lineTime } from '../shared/format';
import { shopKeys } from '../shared/keys';
import { useShopNavigation } from '../shared/navigation';
import { cardModel, type CardLine, type CardModel } from './confirmModel';
import { useNewLinkStore } from './newLinkStore';

/** The card refetches every 20 seconds while the link is open and the order is on screen. */
const CONFIRM_POLL_MS = 20_000;
/** Lets the Send link sheet slide away before "Make a new link?" opens: never a sheet on a sheet. */
const SHEET_CLOSE_MS = 200;
/** The Send link sheet's icons (Inc 2/3 spec §0.2, §6): `sms` is message-text-outline, `link` link-variant. */
const ICON_SMS: IconName = 'sms';
const ICON_LINK: IconName = 'link';

type SheetValue = ConfirmationShareVia | 'NEW_LINK';

export interface CustomerAnswer {
  /** The confirmation once loaded (the delivered and taken-back lines read it too). */
  view: ConfirmationView | undefined;
  /** The card, under the status block; null when the order has no confirmation to show. */
  card: ReactNode;
  /** The screen footer's one main button (and its own failure line), or null. */
  footer: ReactNode;
  /** The Send link sheet and "Make a new link?", outside the order's boundary. */
  overlays: ReactNode;
}

/**
 * [Inc 2] The customer answer on a delivered order (CUSTOMER_PAGE §10; Inc 2/3 spec §2.5–§2.6), only
 * while `features.confirmations` is on and the order has a confirmation. A record only: no money line.
 *
 * - The card: "Customer answer", the answer chip (the answer's time on the right), one line by state,
 *   "Link open until …" while open, and a ghost "Other ways" or "Send again" opening the Send link sheet.
 * - The footer's one main button: "Send on WhatsApp" while the link isn't given, "Fix number" for a
 *   number that isn't a mobile (Edit customer), "Make new link" after a fix; nothing otherwise.
 * - Every send calls `share` first with its `via`, then hands the message to WhatsApp or the text app
 *   (their links), the OS share sheet, or the clipboard: core React Native only, no native module.
 * - "Make a new link?" (rule 7) confirms before the old link stops working.
 */
export function useCustomerAnswer(order: OrderDto | undefined): CustomerAnswer {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { config } = useAppConfig();
  const orderId = order?.id ?? '';
  const enabled = !!order && config.features.confirmations && order.status === 'DELIVERED' && !!order.confirmation;
  const poll = useFocusedInterval(CONFIRM_POLL_MS, enabled);
  const query = useQuery<ConfirmationView, ApiError>({
    queryKey: shopKeys.confirmation(orderId),
    queryFn: () => fetchConfirmation(orderId),
    enabled,
    refetchInterval: (current) => (current.state.data?.status === 'PENDING' ? poll : false),
  });
  const fixed = useNewLinkStore((state) => (orderId ? state.orders[orderId] : undefined));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [newLinkOpen, setNewLinkOpen] = useState(false);
  const [busy, setBusy] = useState<ConfirmationShareVia | null>(null);
  const [failure, setFailure] = useState<ApiError | null>(null);
  // One key per opening of "Make a new link?": a retry after a lost signal is the same new link.
  const newLinkKey = useIdempotencyKey([orderId, newLinkOpen]);

  const view = enabled ? query.data : undefined;
  const model = useMemo(
    () => (view ? cardModel(view, { currentPhone: order?.client.phone ?? null, numberFixed: !!fixed }) : null),
    [view, order?.client.phone, fixed],
  );
  const refetch = query.refetch;

  // A link that closed meanwhile (answered or expired) needs no new link any more.
  const closed = !!view && view.status !== 'PENDING';
  useEffect(() => {
    if (closed && fixed) useNewLinkStore.getState().done(orderId);
  }, [closed, fixed, orderId]);

  // Back from Edit customer with a number that needs a new link: ask once, at once.
  const askNow = !!fixed?.ask && view?.status === 'PENDING' && !!model?.newLink;
  useFocusEffect(
    useCallback(() => {
      if (!askNow) return;
      useNewLinkStore.getState().asked(orderId);
      setNewLinkOpen(true);
    }, [askNow, orderId]),
  );

  const share = useCallback(
    async (via: ConfirmationShareVia) => {
      if (!orderId) return;
      setBusy(via);
      setFailure(null);
      try {
        const result = await shareConfirmation(orderId, via, newRequestId());
        if (via === 'WHATSAPP' || via === 'SMS') {
          const url = via === 'WHATSAPP' ? result.whatsappUrl : result.smsUrl;
          if (url) await Linking.openURL(url).catch(() => undefined);
        } else if (via === 'SHARE_SHEET') {
          await Share.share({ message: result.message }).catch(() => undefined);
        } else {
          Clipboard.setString(result.message);
          toast.show({ message: t('confirm.toast.copied'), tone: 'success' });
        }
      } catch (thrown) {
        const error = toApiError(thrown);
        // Answered or expired meanwhile: the card catches up and says so once.
        if (error.code === 'CONFIRM_CLOSED') toast.show({ message: toUserMessage(error, t), tone: 'neutral' });
        else setFailure(error);
      } finally {
        setBusy(null);
        void refetch();
      }
    },
    [orderId, refetch, t, toast],
  );

  const fixNumber = () => {
    if (order) navigation.navigate('EditCustomer', { clientId: order.client.id, orderId: order.id });
  };

  const main = model?.main ?? null;
  const footer =
    enabled && (main || failure) ? (
      <>
        <ActionLine error={failure} notSentLabel={t('confirm.linkError')} />
        {main === 'whatsapp' ? (
          <Button
            label={t('confirm.btn.whatsapp')}
            icon="whatsApp"
            size="lg"
            loading={busy === 'WHATSAPP'}
            onPress={() => void share('WHATSAPP')}
            testID="confirm.whatsapp"
          />
        ) : main === 'fixNumber' ? (
          <Button label={t('confirm.btn.fixNumber')} icon="customer" size="lg" onPress={fixNumber} testID="confirm.fixNumber" />
        ) : main === 'makeNewLink' ? (
          <Button
            label={t('confirm.btn.makeNewLink')}
            icon={ICON_LINK}
            size="lg"
            onPress={() => setNewLinkOpen(true)}
            testID="confirm.makeNewLink"
          />
        ) : null}
      </>
    ) : null;

  const sheetItems: PickerItem<SheetValue>[] = model
    ? [
        ...(model.sendsDirect
          ? [
              { key: 'WHATSAPP', value: 'WHATSAPP' as const, title: t('confirm.sheet.whatsapp'), leadingIcon: 'whatsApp' as const },
              { key: 'SMS', value: 'SMS' as const, title: t('confirm.btn.sms'), leadingIcon: ICON_SMS },
            ]
          : []),
        { key: 'SHARE_SHEET', value: 'SHARE_SHEET', title: t('confirm.btn.share'), leadingIcon: 'share' },
        { key: 'COPY', value: 'COPY', title: t('confirm.btn.copy'), leadingIcon: 'copy' },
        ...(model.newLink
          ? [
              {
                key: 'NEW_LINK',
                value: 'NEW_LINK' as const,
                title: t('confirm.btn.newLink'),
                leadingIcon: ICON_LINK,
                dividerBefore: true,
              },
            ]
          : []),
      ]
    : [];

  const overlays = enabled ? (
    <>
      <PickerSheet<SheetValue>
        visible={sheetOpen}
        title={t('confirm.sheet.title')}
        items={sheetItems}
        search={false}
        onPick={(value) => {
          if (value === 'NEW_LINK') {
            setTimeout(() => setNewLinkOpen(true), SHEET_CLOSE_MS);
            return undefined;
          }
          return share(value);
        }}
        onClose={() => setSheetOpen(false)}
        testID="confirm.sheet"
      />
      <ConfirmSheet
        visible={newLinkOpen}
        title={t('confirm.newLink.title')}
        body={t('confirm.newLink.body')}
        confirmLabel={t('confirm.newLink.confirm')}
        confirmLoadingLabel={t('confirm.newLink.making')}
        cancelLabel={t('confirm.newLink.keep')}
        onClose={() => setNewLinkOpen(false)}
        onConfirm={async () => {
          try {
            const next = await makeNewConfirmationLink(orderId, newLinkKey.key);
            queryClient.setQueryData(shopKeys.confirmation(orderId), next);
            useNewLinkStore.getState().done(orderId);
            setFailure(null);
            toast.show({ message: t('confirm.toast.newLink'), tone: 'success' });
            void queryClient.invalidateQueries({ queryKey: qk.orders.byId(orderId) });
          } catch (thrown) {
            const error = toApiError(thrown);
            if (error.code !== 'CONFIRM_CLOSED') throw error;
            // The link closed meanwhile (answered or expired): nothing to make; the card catches up.
            useNewLinkStore.getState().done(orderId);
            void refetch();
            toast.show({ message: toUserMessage(error, t), tone: 'neutral' });
          }
        }}
        testID="confirm.newLink"
      />
    </>
  ) : null;

  const card = enabled ? (
    <AnswerCard query={query} model={model} onGhost={() => setSheetOpen(true)} />
  ) : null;

  return { view, card, footer, overlays };
}

/** The card itself: the caption, then the skeleton, the load error, or the chip and its line. */
function AnswerCard({
  query,
  model,
  onGhost,
}: {
  query: UseQueryResult<ConfirmationView, ApiError>;
  model: CardModel | null;
  onGhost: () => void;
}) {
  const { t } = useTranslation();
  const view = query.data;

  let body: ReactNode;
  if (!view || !model) {
    body = query.isError ? (
      <ErrorBanner error={t('confirm.loadError')} onRetry={() => void query.refetch()} />
    ) : (
      <View style={styles.skeletons} accessibilityLabel={t('common.loading')}>
        <Skeleton width="55%" height={28} rounded={14} />
        <Skeleton width="85%" />
      </View>
    );
  } else {
    const chip = model.chip;
    body = (
      <>
        <View style={styles.chipRow}>
          {chip.kind === 'notNeeded' ? (
            <StatusChip tone="neutral" label={t('confirm.cancelled')} />
          ) : (
            <StatusChip kind="answer" value={chip.value} />
          )}
          {chip.kind === 'answer' && chip.at ? (
            <Text variant="caption" tone="secondary" style={styles.time}>
              {lineTime(chip.at, whenTranslate)}
            </Text>
          ) : null}
        </View>
        {model.line ? <AnswerLine line={model.line} /> : null}
        {model.until ? (
          <Text variant="caption" tone="secondary">
            {t('confirm.until', { time: lineTime(model.until, whenTranslate) })}
          </Text>
        ) : null}
        {model.ghost ? (
          <Button
            label={model.ghost === 'otherWays' ? t('confirm.btn.otherWays') : t('confirm.btn.sendAgain')}
            icon="share"
            variant="ghost"
            fullWidth={false}
            onPress={onGhost}
            style={styles.ghost}
            testID="confirm.otherWays"
          />
        ) : null}
      </>
    );
  }

  return (
    <Card testID="confirm.card">
      <View style={styles.stack}>
        <Text variant="label" tone="secondary">
          {t('confirm.title')}
        </Text>
        {body}
      </View>
    </Card>
  );
}

function AnswerLine({ line }: { line: CardLine }) {
  const { t } = useTranslation();
  switch (line.kind) {
    // The number never splits across two lines (review23 ux-11).
    case 'notSent':
      return <Text>{t('confirm.notSent', { name: line.name, phone: keepTogether(line.phone) })}</Text>;
    case 'smsFailed':
      return <Text>{t('confirm.smsFailed', { reason: t(`confirm.smsFailReason.${line.reason}`) })}</Text>;
    case 'smsSending':
      return <Text>{t('confirm.smsSending')}</Text>;
    case 'smsSent':
      return <Text>{t('confirm.smsSent', { time: lineTime(line.at, whenTranslate), phone: keepTogether(line.phone) })}</Text>;
    case 'shared':
      return <Text>{t('confirm.shared', { time: lineTime(line.at, whenTranslate), via: t(`confirm.via.${line.via}`) })}</Text>;
    case 'badPhone':
      return (
        <View style={styles.warnLine}>
          <Icon name="warn" size={20} tone="warning" />
          <Text tone="warning" style={styles.flex}>
            {t('confirm.badPhone', { phone: keepTogether(line.phone) })}
          </Text>
        </View>
      );
    case 'numberChanged':
      return <Text>{t('confirm.numberChanged')}</Text>;
    case 'answered':
      return (
        <>
          {line.comment ? <Text>{t('confirm.comment', { comment: line.comment })}</Text> : null}
          {line.officeWillCheck ? <Text tone="secondary">{t('confirm.officeWillCheck')}</Text> : null}
        </>
      );
  }
}

const styles = StyleSheet.create({
  stack: { gap: space.sm },
  flex: { flex: 1 },
  skeletons: { gap: space.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  time: { marginStart: 'auto' },
  warnLine: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs },
  // The ghost's text lines up with the card's other lines.
  ghost: { paddingHorizontal: space.sm, marginStart: -space.sm },
});

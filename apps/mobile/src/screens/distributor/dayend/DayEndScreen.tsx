import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import type { DayEndDayDto } from '@smartfleet/shared-types';
import { formatIsoDay } from '@smartfleet/shared-utils';
import { isApiError, isNetworkError, type ApiError } from '../../../api/errors';
import { qk } from '../../../api/keys';
import { whenTranslate } from '../../../i18n';
import {
  ActionLine,
  Button,
  Card,
  colors,
  EmptyState,
  ErrorBanner,
  Icon,
  QueryBoundary,
  Screen,
  SkeletonCard,
  sizes,
  space,
  StatusChip,
  Text,
  type IconName,
} from '../../../ui';
import { fetchDayEnd } from '../shared/api';
import { lineTime } from '../shared/format';
import { useShopNavigation, useShopRoute } from '../shared/navigation';
import { usePullRefresh, useRefetchOnReturn } from '../shared/refresh';
import { dayEndView, isBusyRefusal, type StepState } from './dayEndModel';
import { SendDaySheet } from './SendDaySheet';
import { useDayEndDue } from './useDayEndDue';
import { useSheetDownload, useSheetUpload } from './useSheetFiles';

/**
 * [Inc 3] S19 Day-end (UX_MOBILE §8.3; Inc 2/3 spec §4.6): send one day's cylinder count to the office.
 * The business date and its chip; the office's note in a red card while the day is sent back; three
 * step rows (Download sheet, Fill in only what's different, Upload the sheet), each showing its state
 * by its icon; and one footer button by `allowedActions` and the stage: "Download sheet", "Upload filled
 * sheet" ("Checking your sheet…", then Check and send) or "Send for approval · 1 difference" (the
 * confirm). With the office, the line "The office is checking it." and no footer; approved, no footer.
 *
 * The day is the one the flow started with (review23 ux-01, robustness-jobs-04): Home passes the day
 * that waits for the shop (sent back or reopened, or an earlier day never sent), Check and send its own
 * date; with none, the screen finds that day itself, else today. It never jumps to another day when the
 * 3 am cut-off passes. An earlier day offers "Today's sheet", so today is never out of reach.
 * Reached only from Home's row, which shows while `features.dayEnd` is on. Never moves money.
 */
export function DayEndScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const { params } = useShopRoute<'DayEnd'>();
  // Today is read again whenever the screen shows (it turns over at the cut-off).
  const [now, setNow] = useState(() => Date.now());
  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
    }, []),
  );
  const due = useDayEndDue(now);
  // The day shown: the route's, else the day that waits (once the list has answered), kept from then on.
  const routeDate = params?.date;
  const [opened, setOpened] = useState<string | null>(routeDate ?? null);
  useEffect(() => {
    if (routeDate) setOpened(routeDate);
  }, [routeDate]);
  const settledDate = due.settled ? due.target.date : null;
  useEffect(() => {
    if (settledDate) setOpened((current) => current ?? settledDate);
  }, [settledDate]);
  const shown = opened ?? settledDate;
  const date = shown ?? due.today;
  const earlierDay = shown !== null && shown < due.today;

  const day = useQuery<DayEndDayDto, ApiError>({
    queryKey: qk.dayEnd(date),
    queryFn: () => fetchDayEnd(date),
    enabled: shown !== null,
  });
  const refetchDay = day.refetch;
  const refetchShown = useCallback(
    () => (shown !== null ? refetchDay() : Promise.resolve()),
    [shown, refetchDay],
  );
  const pull = usePullRefresh(refetchShown);
  useRefetchOnReturn(refetchShown);

  const download = useSheetDownload(date);
  const upload = useSheetUpload(date, (done) => {
    if (done) navigation.navigate('DayEndPreview', { date });
  });
  const [sendOpen, setSendOpen] = useState(false);
  const [sendError, setSendError] = useState<ApiError | null>(null);

  const notFound = !day.data && isApiError(day.error) && day.error.code === 'DAY_NOT_FOUND';
  const view = day.data ? dayEndView(day.data) : null;
  const differences = day.data?.lastUpload?.differences ?? 0;

  let button: ReactNode = null;
  if (view?.footer === 'download') {
    button = (
      <Button
        label={t('dayEnd.btn.download')}
        icon="download"
        size="lg"
        loading={download.busy}
        loadingLabel={t('dayEnd.btn.downloading')}
        onPress={download.download}
        testID="dayEnd.download"
      />
    );
  } else if (view?.footer === 'upload') {
    button = (
      <Button
        label={t('dayEnd.btn.upload')}
        icon="upload"
        size="lg"
        loading={upload.uploading}
        loadingLabel={t('dayEnd.btn.checking')}
        onPress={upload.start}
        testID="dayEnd.upload"
      />
    );
  } else if (view?.footer === 'send') {
    button = (
      <Button
        label={differences > 0 ? t('dayEnd.preview.send', { count: differences }) : t('dayEnd.preview.sendClean')}
        size="lg"
        onPress={() => {
          setSendError(null);
          setSendOpen(true);
        }}
        testID="dayEnd.send"
      />
    );
  }

  // One failure at a time, just above the button it belongs to.
  const failure = upload.error ?? download.error ?? sendError;
  const footer =
    button || failure ? (
      <>
        {failure && !isNetworkError(failure) ? (
          <ErrorBanner
            error={failure}
            // "The service is busy. Please try again in a minute.": the server reads one sheet at a time (503).
            onRetry={upload.error && isBusyRefusal(upload.error) && upload.retry ? upload.retry : undefined}
            extraAction={
              sendError?.code === 'DAY_VERSION_CHANGED' ? { label: t('dayEnd.btn.uploadAgain'), onPress: upload.start } : undefined
            }
          />
        ) : (
          <ActionLine
            error={failure}
            notSentLabel={t('errors.NETWORK_OFFLINE')}
            extraAction={upload.error && upload.retry ? { label: t('common.actions.tryAgain'), onPress: upload.retry } : null}
          />
        )}
        {button}
      </>
    ) : undefined;

  return (
    <Screen refreshing={pull.refreshing} onRefresh={pull.onRefresh} footer={footer}>
      {notFound ? (
        <EmptyState icon="sheet" title={t('errors.DAY_NOT_FOUND')} />
      ) : (
        <QueryBoundary query={day} skeleton={<DayEndSkeleton />}>
          {(data) => {
            const parts = dayEndView(data);
            const uploaded = parts.steps.upload === 'done' && data.lastUpload;
            return (
              <View style={styles.stack}>
                <View style={styles.dateRow}>
                  <Text variant="heading" style={styles.flex}>
                    {formatIsoDay(data.businessDate)}
                  </Text>
                  <StatusChip kind="dayEnd" value={data.stage} />
                </View>

                {parts.note ? (
                  <Card tone="danger">
                    <View style={styles.noteRow}>
                      <Icon name="error" size={24} tone="danger" />
                      <View style={styles.flex}>
                        <Text>{t(`dayEnd.note.${parts.note.kind}`, { note: parts.note.text })}</Text>
                        <Text variant="bodyStrong">{t('dayEnd.note.fix')}</Text>
                      </View>
                    </View>
                  </Card>
                ) : null}

                <Card padding={0}>
                  <StepRow icon="download" title={t('dayEnd.step.download')} state={parts.steps.download}>
                    {parts.downloadAgain ? (
                      <>
                        <Button
                          label={t('dayEnd.btn.downloadAgain')}
                          variant="ghost"
                          fullWidth={false}
                          loading={download.busy}
                          loadingLabel={t('dayEnd.btn.downloading')}
                          onPress={download.download}
                          accessibilityHint={t('dayEnd.btn.downloadAgainHelp')}
                          style={styles.ghost}
                          testID="dayEnd.downloadAgain"
                        />
                        {/* Only the newest sheet can be uploaded: a new one makes the filled copy unusable (ux-07). */}
                        <Text variant="caption" tone="secondary" testID="dayEnd.downloadAgainHelp">
                          {t('dayEnd.btn.downloadAgainHelp')}
                        </Text>
                      </>
                    ) : null}
                  </StepRow>
                  <Divider />
                  <StepRow
                    icon="sheet"
                    title={t('dayEnd.step.fill')}
                    helper={t('dayEnd.step.fillHelp')}
                    state={parts.steps.fill}
                  />
                  <Divider />
                  <StepRow
                    icon="upload"
                    title={t('dayEnd.step.upload')}
                    helper={
                      uploaded
                        ? t('dayEnd.lastUpload', {
                            count: data.lastUpload?.differences ?? 0,
                            time: lineTime(data.lastUpload?.uploadedAt ?? now, whenTranslate),
                          })
                        : undefined
                    }
                    state={parts.steps.upload}
                  >
                    {parts.uploadAgain ? (
                      <Button
                        label={t('dayEnd.btn.uploadAgain')}
                        variant="ghost"
                        fullWidth={false}
                        loading={upload.uploading}
                        loadingLabel={t('dayEnd.btn.checking')}
                        onPress={upload.start}
                        style={styles.ghost}
                      />
                    ) : null}
                  </StepRow>
                </Card>

                {parts.waiting ? <Text tone="secondary">{t('dayEnd.waiting')}</Text> : null}

                {earlierDay ? (
                  <Button
                    label={t('dayEnd.btn.today')}
                    icon="sheet"
                    variant="ghost"
                    fullWidth={false}
                    onPress={() => navigation.replace('DayEnd', { date: due.today })}
                    style={styles.ghost}
                    testID="dayEnd.today"
                  />
                ) : null}
              </View>
            );
          }}
        </QueryBoundary>
      )}

      {upload.picker}
      {day.data?.lastUpload ? (
        <SendDaySheet
          date={date}
          version={day.data.lastUpload.version}
          visible={sendOpen}
          onClose={() => setSendOpen(false)}
          onSent={() => setSendError(null)}
          onStale={setSendError}
        />
      ) : null}
    </Screen>
  );
}

const STEP_LOOKS: Record<StepState, { circle: string; tone: 'success' | 'brand' | 'secondary' }> = {
  done: { circle: colors.successSoft, tone: 'success' },
  current: { circle: colors.brandSoft, tone: 'brand' },
  todo: { circle: colors.sunken, tone: 'secondary' },
};

/**
 * One step (not tappable): the icon shows its state, a tick when done, the step's icon in brand when it
 * is the one to do now, grey when it is still to come; then the title, a helper, and a rare action.
 */
function StepRow({
  icon,
  title,
  helper,
  state,
  children,
}: {
  icon: IconName;
  title: string;
  helper?: string;
  state: StepState;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const look = STEP_LOOKS[state];
  const stateWord =
    state === 'done' ? t('common.timeline.done') : state === 'current' ? t('common.timeline.current') : t('common.timeline.todo');
  return (
    <View style={styles.step}>
      <View accessible accessibilityLabel={[title, stateWord, helper].filter(Boolean).join(', ')} style={styles.stepMain}>
        <View style={[styles.stepIcon, { backgroundColor: look.circle }]}>
          <Icon name={state === 'done' ? 'ok' : icon} size={24} tone={look.tone} />
        </View>
        <View style={styles.flex}>
          <Text variant={state === 'current' ? 'bodyStrong' : 'body'} tone={state === 'todo' ? 'secondary' : 'default'}>
            {title}
          </Text>
          {helper ? (
            <Text variant="caption" tone="secondary">
              {helper}
            </Text>
          ) : null}
        </View>
      </View>
      {children ? <View style={styles.stepAction}>{children}</View> : null}
    </View>
  );
}

function DayEndSkeleton() {
  return (
    <View style={styles.stack}>
      <SkeletonCard lines={1} />
      <SkeletonCard lines={3} />
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  flex: { flex: 1 },
  dateRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  step: { minHeight: sizes.listRow, paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.xs },
  stepMain: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  stepIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  // The step's action lines up under its words, past the 40 dp icon.
  stepAction: { marginStart: 40 + space.md },
  ghost: { paddingHorizontal: space.sm, marginStart: -space.sm },
  divider: { height: 1, backgroundColor: colors.border },
});

import { useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import {
  DAY_END_ROW_ERROR_CODES,
  type DayCloseDifferenceDto,
  type DayEndRowErrorCode,
  type DaySheetRowError,
} from '@smartfleet/shared-types';
import { isNetworkError, type ApiError } from '../../../api/errors';
import {
  ActionLine,
  Button,
  Card,
  ChoiceChips,
  EmptyState,
  ErrorBanner,
  Icon,
  Screen,
  space,
  StatusChip,
  Text,
} from '../../../ui';
import { shopKeys } from '../shared/keys';
import { useShopNavigation, useShopRoute } from '../shared/navigation';
import {
  checkedCount,
  differingParts,
  fixState,
  lineKinds,
  kindsPresent,
  ROW_ERRORS_SHOWN,
  yourCount,
  type DayUpload,
  type DiffKind,
} from './dayEndModel';
import { SendDaySheet } from './SendDaySheet';
import { useSheetUpload } from './useSheetFiles';

/** How long the last upload's answer is kept for this screen once nothing shows it. */
const UPLOAD_KEPT_MS = 30 * 60_000;

type Filter = 'ALL' | DiffKind;

/**
 * [Inc 3] S20 Check and send (UX_MOBILE §8.3; Inc 2/3 spec §4.7), right after an upload: the big
 * "1 difference" and "35 cylinders checked", chips by kind with 2 or more kinds, and one card per
 * difference ("App: In my store · Full" / "You: In my store · **Damaged**", the note, the fix chip and
 * "Will be skipped" when it moved since the sheet). The footer "Send for approval · 1 difference" asks
 * first (rule 7). With row errors nothing was saved: the red card, the rows, and "Upload fixed sheet".
 * The server can't list the differences again, so the answer comes from the upload (no fetch here).
 */
export function DayEndPreviewScreen() {
  const { t } = useTranslation();
  const navigation = useShopNavigation();
  const { params } = useShopRoute<'DayEndPreview'>();
  const date = params.date;
  const upload = useQuery<DayUpload | null>({
    queryKey: shopKeys.dayEndUpload(date),
    queryFn: () => null,
    enabled: false,
    gcTime: UPLOAD_KEPT_MS,
  });
  const again = useSheetUpload(date, () => undefined);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [sendOpen, setSendOpen] = useState(false);
  const [sendError, setSendError] = useState<ApiError | null>(null);
  const backToDay = () => navigation.navigate('DayEnd');

  const data = upload.data ?? null;
  const differences = useMemo(() => (data?.kind === 'result' ? data.result.differences : []), [data]);
  const kinds = kindsPresent(differences);
  // A new upload may not have the kind picked before: then every difference shows again.
  const activeFilter: Filter = filter !== 'ALL' && kinds.length >= 2 && kinds.includes(filter) ? filter : 'ALL';
  const shown =
    activeFilter === 'ALL' ? differences : differences.filter((line) => lineKinds(line).includes(activeFilter));

  const uploadButton = (label: string) => (
    <Button
      label={label}
      icon="upload"
      size="lg"
      loading={again.uploading}
      loadingLabel={t('dayEnd.btn.checking')}
      onPress={again.start}
      testID="dayEnd.reupload"
    />
  );

  const failure = again.error ?? sendError;
  const failureLine = failure ? (
    !isNetworkError(failure) ? (
      <ErrorBanner
        error={failure}
        extraAction={sendError?.code === 'DAY_VERSION_CHANGED' ? { label: t('dayEnd.btn.uploadAgain'), onPress: again.start } : undefined}
      />
    ) : (
      <ActionLine
        error={failure}
        notSentLabel={t('errors.NETWORK_OFFLINE')}
        extraAction={again.error && again.retry ? { label: t('common.actions.tryAgain'), onPress: again.retry } : null}
      />
    )
  ) : null;

  let footer;
  if (!data) {
    footer = (
      <>
        {failureLine}
        {uploadButton(t('dayEnd.btn.upload'))}
      </>
    );
  } else if (data.kind === 'rowErrors') {
    footer = (
      <>
        {failureLine}
        {uploadButton(t('dayEnd.rowError.reupload'))}
      </>
    );
  } else {
    const count = differences.length;
    footer = (
      <>
        {failureLine}
        <Button
          label={count > 0 ? t('dayEnd.preview.send', { count }) : t('dayEnd.preview.sendClean')}
          size="lg"
          onPress={() => {
            setSendError(null);
            setSendOpen(true);
          }}
          testID="dayEnd.preview.send"
        />
      </>
    );
  }

  return (
    <Screen footer={footer}>
      {!data ? (
        <EmptyState icon="upload" title={t('dayEnd.step.upload')} />
      ) : data.kind === 'rowErrors' ? (
        <RowErrors rows={data.rows} total={data.total} />
      ) : (
        <View style={styles.stack}>
          <View>
            <View style={styles.summary}>
              <Text variant="display" tabular>
                {differences.length}
              </Text>
              <Text variant="heading" style={styles.flexShrink}>
                {t('dayEnd.preview.differenceWord', { count: differences.length })}
              </Text>
            </View>
            <Text variant="caption" tone="secondary">
              {t('dayEnd.preview.checked', { count: checkedCount(data.result) })}
            </Text>
          </View>

          {kinds.length >= 2 ? (
            <ChoiceChips<Filter>
              accessibilityLabel={t('dayEnd.preview.title')}
              options={[
                { value: 'ALL', label: t('dayEnd.filter.ALL') },
                ...kinds.map((kind) => ({ value: kind, label: t(`dayEnd.filter.${kind}`) })),
              ]}
              value={activeFilter}
              onChange={setFilter}
            />
          ) : null}

          {differences.length === 0 ? (
            <EmptyState icon="ok" title={t('dayEnd.preview.clean')} />
          ) : (
            shown.map((line) => <DifferenceCard key={line.id} line={line} />)
          )}
        </View>
      )}

      {again.picker}
      {data?.kind === 'result' ? (
        <SendDaySheet
          date={date}
          version={data.result.version}
          visible={sendOpen}
          onClose={() => setSendOpen(false)}
          onSent={backToDay}
          onStale={(error) => {
            if (error.code === 'DAY_VERSION_CHANGED') setSendError(error);
            else backToDay();
          }}
        />
      ) : null}
    </Screen>
  );
}

function placeWords(place: NonNullable<DayCloseDifferenceDto['app']>['place'], t: TFunction): string {
  return t(`dayEnd.place.${place}`);
}

/** "App: On driver's van · LEA-101 · Full": where the app has it (with the van or customer), and its state. */
function appLine(line: DayCloseDifferenceDto, t: TFunction): string {
  const app = line.app;
  if (!app) return t('dayEnd.preview.appNone');
  const where =
    app.place === 'VAN' && app.plateNo
      ? t('dayEnd.placeVan', { plate: app.plateNo })
      : app.place === 'CUSTOMER' && app.customerName
        ? t('dayEnd.placeCustomer', { name: app.customerName })
        : placeWords(app.place, t);
  return app.state ? t('dayEnd.preview.app', { where, state: t(`dayEnd.state.${app.state}`) }) : t('dayEnd.preview.appNoState', { where });
}

function DifferenceCard({ line }: { line: DayCloseDifferenceDto }) {
  const { t } = useTranslation();
  const you = yourCount(line);
  const bold = differingParts(line);
  const where = you.place ? placeWords(you.place, t) : '';
  // A missing cylinder has no state to check: "You: Missing", never "You: Missing · Empty".
  const state = you.state && you.place !== 'NOT_FOUND' ? t(`dayEnd.state.${you.state}`) : '';
  const setTo = fixState(line);
  const fix =
    line.fix === 'SET_STATE' && setTo ? t('dayEnd.fix.SET_STATE', { state: t(`dayEnd.state.${setTo}`) }) : t(`dayEnd.fix.${line.fix}`);
  return (
    <Card>
      <View style={styles.cardStack}>
        <Text variant="bodyStrong">
          {line.sizeLabel ? t('dayEnd.preview.line', { shortCode: line.shortCode, size: line.sizeLabel }) : line.shortCode}
        </Text>
        <Text>{appLine(line, t)}</Text>
        <Text>
          <Trans
            i18nKey={state ? 'dayEnd.preview.you' : 'dayEnd.preview.youNoState'}
            values={{ where, state }}
            components={{
              place: <Text variant={bold.place ? 'bodyStrong' : 'body'} />,
              state: <Text variant={bold.state ? 'bodyStrong' : 'body'} />,
            }}
          />
        </Text>
        {line.note ? <Text tone="secondary">{t('dayEnd.preview.note', { note: line.note })}</Text> : null}
        <View style={styles.chips}>
          <StatusChip tone="brand" label={fix} />
          {line.movedSinceSheet ? <StatusChip tone="neutral" label={t('dayEnd.preview.skipped')} /> : null}
        </View>
      </View>
    </Card>
  );
}

/** Row-error mode: nothing was saved; the first rows and how many more. */
function RowErrors({ rows, total }: { rows: readonly DaySheetRowError[]; total: number }) {
  const { t } = useTranslation();
  const shown = rows.slice(0, ROW_ERRORS_SHOWN);
  const more = Math.max(0, total - shown.length);
  return (
    <View style={styles.stack}>
      <Card tone="danger">
        <View style={styles.errorRow}>
          <Icon name="error" size={24} tone="danger" />
          <Text style={styles.flexShrink}>{t('errors.DAY_SHEET_ROW_ERRORS')}</Text>
        </View>
      </Card>
      <Card>
        <View style={styles.cardStack}>
          {shown.map((row) => (
            <Text key={`${row.sheet}-${row.row}-${row.code}`}>
              {t('dayEnd.rowError.row', {
                row: row.row,
                sheet: t(`dayEnd.sheetName.${row.sheet}`),
                problem: rowProblem(row.code, t),
              })}
            </Text>
          ))}
          {more > 0 ? (
            <Text tone="secondary">{t('dayEnd.rowError.more', { count: more })}</Text>
          ) : null}
        </View>
      </Card>
    </View>
  );
}

function isRowCode(code: string): code is DayEndRowErrorCode {
  return (DAY_END_ROW_ERROR_CODES as readonly string[]).includes(code);
}

/** The row's problem in the shared words (`DAY_END_ROW_ERROR_EN`); an unknown code reads as unreadable. */
function rowProblem(code: string, t: TFunction): string {
  return isRowCode(code) ? t(`dayEnd.rowError.${code}`) : t('errors.DAY_SHEET_UNREADABLE');
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  flexShrink: { flexShrink: 1 },
  summary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space.sm },
  cardStack: { gap: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
});

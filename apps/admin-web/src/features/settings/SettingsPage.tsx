import { useId, useMemo, useState, type ReactNode } from 'react';
import { getRouteApi, useBlocker } from '@tanstack/react-router';
import type { AnySettingRow, SettingKey, TopupAccount } from '@smartfleet/shared-types';
import { formatPkDay } from '@smartfleet/shared-utils';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { messageFor, toApiError } from '../../api/errors';
import { SETTINGS_SECTIONS, type SettingsSection } from '../../app/search';
import { MODULES } from '../../app/modules';
import {
  Button,
  CopyButton,
  cx,
  ErrorState,
  Field,
  InlineAlert,
  KeyValueList,
  MoneyInput,
  PageHeader,
  RadioCards,
  Select,
  SkeletonText,
  Switch,
  TextInput,
  useConfirm,
  useToast,
  type KeyValueItem,
} from '../../ui';
import { patchSetting, useInvalidateAfterSettings, useReplaceSettingRow, useSettingRows } from './api';
import { draftFromValue, parseDraft, type Draft, type Parsed } from './drafts';
import { FIELDS, type FieldDef } from './fields';
import { formatSettingValue, sameValue, settingLabel } from './values';
import './settings.css';

const route = getRouteApi('/settings');

const DEFAULT_SECTION: SettingsSection = 'money';
const REASON_MIN = 5;
const REASON_MAX = 300;

type Edits = Partial<Record<SettingKey, Draft>>;

interface Change {
  field: FieldDef;
  row: AnySettingRow;
  value: unknown;
}

/**
 * Settings (`/settings?section=`, UX_ADMIN §2.8): a fixed form in sections. Changes wait in a sticky bar;
 * "Review and save" lists them and asks for a reason, then sends one `PATCH /settings/:key` per change.
 * Turning a module on asks first. Every save is in the Activity log.
 */
export function SettingsPage() {
  const { t } = useTranslation(['settings', 'common']);
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const rowsQuery = useSettingRows();
  const replaceRow = useReplaceSettingRow();
  const invalidate = useInvalidateAfterSettings();
  const [edits, setEdits] = useState<Edits>({});
  const [serverErrors, setServerErrors] = useState<Partial<Record<SettingKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  const section = search.section ?? DEFAULT_SECTION;

  const rows = useMemo(() => new Map((rowsQuery.data ?? []).map((row) => [row.key, row])), [rowsQuery.data]);
  const fields = useMemo(() => FIELDS.filter((field) => rows.has(field.key)), [rows]);

  // Each edited row: its parsed value, or why it isn't valid (with the top-up minimum ≤ maximum check).
  const parsed = useMemo(() => {
    const out = new Map<SettingKey, Parsed>();
    for (const field of fields) {
      const draft = edits[field.key];
      const row = rows.get(field.key);
      if (draft && row) out.set(field.key, parseDraft(field, draft, row));
    }
    const value = (key: SettingKey): unknown => {
      const entry = out.get(key);
      return entry ? (entry.ok ? entry.value : undefined) : rows.get(key)?.value;
    };
    const min = value('topup.minPaisa');
    const max = value('topup.maxPaisa');
    if (typeof min === 'number' && typeof max === 'number' && min > max) {
      const blame: SettingKey = out.has('topup.minPaisa') ? 'topup.minPaisa' : 'topup.maxPaisa';
      out.set(blame, { ok: false, error: t('errors.minAboveMax') });
    }
    return out;
  }, [edits, fields, rows, t]);

  const pending = useMemo(() => {
    const list: Array<{ field: FieldDef; row: AnySettingRow; result: Parsed }> = [];
    for (const field of fields) {
      const result = parsed.get(field.key);
      const row = rows.get(field.key);
      if (!result || !row) continue;
      if (result.ok && sameValue(result.value, row.value)) continue;
      list.push({ field, row, result });
    }
    return list;
  }, [fields, parsed, rows]);
  const invalid = pending.some((entry) => !entry.result.ok);

  // Leaving the page with changes not saved asks first; moving between sections doesn't.
  useBlocker({
    shouldBlockFn: async ({ next }) => {
      if (next.pathname === '/settings') return false;
      const { ok } = await confirm({
        title: t('common:dialog.discardTitle'),
        body: t('common:dialog.discardBody'),
        tone: 'danger',
        confirmLabel: t('common:actions.discardChanges'),
        cancelLabel: t('common:actions.keepEditing'),
      });
      return !ok;
    },
    enableBeforeUnload: pending.length > 0,
    disabled: pending.length === 0 || saving,
  });

  /** Merges a change into a row's draft (two events of one keystroke may each send a part). */
  const patchDraft = (field: FieldDef, patch: Partial<Draft>) => {
    setEdits((prev) => {
      const row = rows.get(field.key);
      const base = prev[field.key] ?? draftFromValue(field, row?.value);
      return { ...prev, [field.key]: { ...base, ...patch } as Draft };
    });
    setServerErrors(({ [field.key]: _drop, ...rest }) => rest);
    setSaveProblem(null);
  };

  const goTo = (next: SettingsSection) => {
    void navigate({ search: (prev) => ({ ...prev, section: next === DEFAULT_SECTION ? undefined : next }), replace: true });
  };

  const discard = async () => {
    const { ok } = await confirm({
      title: t('review.discardTitle'),
      body: t('review.discardBody'),
      tone: 'danger',
      confirmLabel: t('common:actions.discardChanges'),
      cancelLabel: t('common:actions.keepEditing'),
    });
    if (!ok) return;
    setEdits({});
    setServerErrors({});
    setSaveProblem(null);
  };

  const review = async () => {
    const changes: Change[] = pending.flatMap((entry) => (entry.result.ok ? [{ field: entry.field, row: entry.row, value: entry.result.value }] : []));
    if (changes.length === 0 || invalid) return;
    const facts: KeyValueItem[] = changes.map((change) => ({
      id: change.field.key,
      label: settingLabel(change.field.key),
      value: t('review.change', {
        from: formatSettingValue(change.field.key, change.row.value) ?? t('values.notSet'),
        to: formatSettingValue(change.field.key, change.value) ?? t('values.notSet'),
      }),
    }));
    const { ok, reason } = await confirm({
      title: t('review.title'),
      facts,
      reason: { label: t('review.reason'), hint: t('review.reasonHint'), required: true, minLength: REASON_MIN, maxLength: REASON_MAX },
      confirmLabel: t('review.save', { count: changes.length }),
    });
    if (!ok || !reason) return;
    await saveAll(orderForSaving(changes, rows), reason);
  };

  const saveAll = async (changes: Change[], reason: string) => {
    setSaving(true);
    setSaveProblem(null);
    let saved = 0;
    try {
      for (const change of changes) {
        try {
          const row = await patchSetting(change.field.key, change.value, reason);
          replaceRow(row);
          setEdits(({ [change.field.key]: _done, ...rest }) => rest);
          saved += 1;
        } catch (error) {
          const apiError = toApiError(error);
          const label = settingLabel(change.field.key);
          const message = apiError.isNetwork ? t('offline') : messageFor(apiError);
          if (apiError.is('SETTING_INVALID_VALUE', 'VALIDATION_FAILED')) {
            setServerErrors((prev) => ({ ...prev, [change.field.key]: messageFor(apiError) }));
          }
          setSaveProblem(
            saved > 0 ? t('saveFailedAfterOthers', { setting: label, message }) : t('saveFailed', { setting: label, message }),
          );
          return;
        }
      }
      toast.success(t('saved'));
    } finally {
      setSaving(false);
      if (saved > 0) void invalidate();
    }
  };

  const turnOnModule = async (field: FieldDef, on: boolean) => {
    const storedOn = rows.get(field.key)?.value === true;
    if (!on || storedOn || field.control.kind !== 'switch' || !field.control.module) {
      patchDraft(field, { kind: 'flag', value: on });
      return;
    }
    const module = t(`common:${MODULES[field.control.module].labelKey}`);
    const { ok } = await confirm({
      title: t('modules.turnOnTitle', { module }),
      body: t('modules.turnOnBody', { module }),
      confirmLabel: t('modules.turnOnConfirm'),
    });
    if (ok) patchDraft(field, { kind: 'flag', value: true });
  };

  if (rowsQuery.isError && !rowsQuery.data) {
    return (
      <div className="sf-settings">
        <PageHeader title={t('page.title')} subtitle={t('page.subtitle')} />
        <ErrorState error={rowsQuery.error} onRetry={() => void rowsQuery.refetch()} retrying={rowsQuery.isFetching} title={t('page.loadFailed')} />
      </div>
    );
  }

  const sectionFields = fields.filter((field) => field.section === section);

  return (
    <div className={cx('sf-settings', pending.length > 0 && 'has-bar')}>
      <PageHeader title={t('page.title')} subtitle={t('page.subtitle')} />
      <div className="sf-settings__layout">
        <nav className="sf-settings__menu" aria-label={t('page.menuLabel')}>
          <ul>
            {SETTINGS_SECTIONS.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  className={cx('sf-settings__menu-item', id === section && 'is-current')}
                  aria-current={id === section ? 'true' : undefined}
                  onClick={() => goTo(id)}
                >
                  {t(`sections.${id}`)}
                  {pending.some((entry) => entry.field.section === id) ? <span className="sf-settings__menu-dot" aria-hidden /> : null}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <Field label={t('page.sectionLabel')} className="sf-settings__section-select">
          <Select
            value={section}
            options={SETTINGS_SECTIONS.map((id) => ({ value: id, label: t(`sections.${id}`) }))}
            onChange={(event) => goTo(event.target.value as SettingsSection)}
          />
        </Field>

        <section className="sf-settings__panel" aria-labelledby="sf-settings-section-title">
          <h2 id="sf-settings-section-title" className="sf-settings__panel-title">
            {t(`sections.${section}`)}
          </h2>
          {rowsQuery.isPending ? (
            <SkeletonText lines={8} />
          ) : section === 'refills' ? (
            <RefillsBlock row={rows.get('refill.deliveryCost')} />
          ) : section === 'account' ? (
            <AccountBlock row={rows.get('topup.account')} />
          ) : (
            sectionFields.map((field) => {
              const row = rows.get(field.key);
              if (!row) return null;
              const result = parsed.get(field.key);
              const error = serverErrors[field.key] ?? (result && !result.ok ? result.error : undefined);
              return (
                <FieldRow
                  key={field.key}
                  field={field}
                  row={row}
                  draft={edits[field.key] ?? draftFromValue(field, row.value)}
                  error={error}
                  disabled={saving}
                  onPatch={(patch) => patchDraft(field, patch)}
                  onSwitch={(on) => void turnOnModule(field, on)}
                />
              );
            })
          )}
        </section>
      </div>

      {pending.length > 0 || saveProblem ? (
        <div className="sf-settings__bar" role="region" aria-label={t('bar.changes', { count: pending.length })}>
          {saveProblem ? (
            <InlineAlert tone="danger" live className="sf-settings__bar-alert">
              {saveProblem}
            </InlineAlert>
          ) : null}
          {pending.length > 0 ? (
            <div className="sf-settings__bar-row">
              <p className="sf-settings__bar-text" aria-live="polite">
                {saving ? t('bar.saving') : t('bar.changes', { count: pending.length })}
              </p>
              <div className="sf-settings__bar-actions">
                <Button onClick={() => void discard()} disabled={saving}>
                  {t('bar.discard')}
                </Button>
                <Button
                  variant="primary"
                  loading={saving}
                  disabled={invalid}
                  disabledReason={invalid ? t('bar.fixFirst') : undefined}
                  onClick={() => void review()}
                >
                  {t('bar.review')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The order to save in: when the top-up minimum and maximum both change and the new minimum is above the
 * stored maximum, the maximum goes first, so the server never sees minimum > maximum.
 */
function orderForSaving(changes: Change[], rows: ReadonlyMap<SettingKey, AnySettingRow>): Change[] {
  const min = changes.find((change) => change.field.key === 'topup.minPaisa');
  const max = changes.find((change) => change.field.key === 'topup.maxPaisa');
  const storedMax = rows.get('topup.maxPaisa')?.value;
  if (!min || !max || typeof min.value !== 'number' || typeof storedMax !== 'number' || min.value <= storedMax) return changes;
  return [max, ...changes.filter((change) => change !== max)];
}

interface FieldRowProps {
  field: FieldDef;
  row: AnySettingRow;
  draft: Draft;
  error: string | undefined;
  disabled: boolean;
  onPatch: (patch: Partial<Draft>) => void;
  onSwitch: (on: boolean) => void;
}

/** "Changed 21 Oct by Sana", "Changed 21 Oct" (the settings tool) or "Default". */
function RowMeta({ row }: { row: AnySettingRow }) {
  const { t } = useTranslation('settings');
  if (!row.updatedAt) return <p className="sf-settings__meta">{t('meta.default')}</p>;
  const date = formatPkDay(row.updatedAt, { weekday: false });
  return (
    <p className="sf-settings__meta">
      {row.updatedBy?.name ? t('meta.changedBy', { date, name: row.updatedBy.name }) : t('meta.changed', { date })}
    </p>
  );
}

function FieldRow({ field, row, draft, error, disabled, onPatch, onSwitch }: FieldRowProps) {
  const { t } = useTranslation('settings');
  const hoursId = useId();
  const locked = disabled || !row.editable;
  const hint = field.description ? t(field.description) : undefined;
  let control: ReactNode = null;

  switch (field.control.kind) {
    case 'money': {
      const money = draft.kind === 'money' ? draft : { kind: 'money' as const, text: '', paisa: null };
      control = (
        <MoneyInput
          valuePaisa={money.paisa}
          allowZero={field.control.allowZero}
          min={row.min}
          max={row.max}
          placeholder={field.control.nullable ? t('placeholders.noLimit') : undefined}
          onChange={(paisa) => onPatch({ kind: 'money', paisa })}
          onInput={(event) => onPatch({ kind: 'money', text: event.currentTarget.value })}
          disabled={locked}
        />
      );
      break;
    }
    case 'integer':
    case 'version':
    case 'text': {
      const text = draft.kind === 'text' ? draft.text : '';
      const placeholder =
        field.control.kind === 'text'
          ? t(field.control.placeholder === 'phone' ? 'placeholders.phone' : 'placeholders.hours')
          : field.control.kind === 'version'
            ? t('placeholders.version')
            : undefined;
      control = (
        <TextInput
          value={text}
          inputMode={field.control.kind === 'integer' ? 'numeric' : field.control.kind === 'text' && field.control.phone ? 'tel' : undefined}
          maxLength={field.control.kind === 'text' ? field.control.maxLength : 16}
          placeholder={placeholder}
          className="sf-settings__short"
          onChange={(event) => onPatch({ kind: 'text', text: event.target.value })}
          disabled={locked}
        />
      );
      break;
    }
    case 'switch':
      control = <Switch checked={draft.kind === 'flag' && draft.value} onChange={onSwitch} disabled={locked} />;
      break;
    case 'deliveryStartedAt':
    case 'onAmountMismatch': {
      const kind = field.control.kind;
      const options = (row.options ?? []).map((value) => ({
        value,
        label: kind === 'deliveryStartedAt' ? optionWord(t, 'deliveryStartedAt', value) : optionWord(t, 'onAmountMismatch', value),
        description: sameValue(value, row.default) ? t('options.default') : undefined,
      }));
      control = (
        <RadioCards
          options={options}
          value={draft.kind === 'choice' ? draft.value : null}
          onChange={(value) => onPatch({ kind: 'choice', value })}
        />
      );
      if (locked) control = <fieldset disabled className="sf-settings__locked">{control}</fieldset>;
      break;
    }
    case 'hours': {
      const hours = draft.kind === 'hours' ? draft : { kind: 'hours' as const, from: '', to: '' };
      control = (
        <span className="sf-settings__hours">
          <TextInput
            id={`${hoursId}-from`}
            type="time"
            aria-label={t('values.from')}
            value={hours.from}
            onChange={(event) => onPatch({ kind: 'hours', from: event.target.value })}
            disabled={locked}
          />
          <span aria-hidden>–</span>
          <TextInput
            id={`${hoursId}-to`}
            type="time"
            aria-label={t('values.to')}
            value={hours.to}
            onChange={(event) => onPatch({ kind: 'hours', to: event.target.value })}
            disabled={locked}
          />
        </span>
      );
      break;
    }
  }

  return (
    <div className="sf-settings__row">
      <Field label={settingLabel(field.key)} hint={hint} error={error ?? null}>
        {control}
      </Field>
      <RowMeta row={row} />
      {!row.editable ? <p className="sf-settings__meta">{t('meta.readOnly')}</p> : null}
    </div>
  );
}

function optionWord(
  t: TFunction<'settings'>,
  kind: 'deliveryStartedAt' | 'onAmountMismatch',
  value: string,
): string {
  if (kind === 'deliveryStartedAt' && (value === 'FIRST_LOAD_SCAN' || value === 'DRIVER_ASSIGNED' || value === 'LEFT_STORE')) {
    return t(`options.deliveryStartedAt.${value}`);
  }
  if (kind === 'onAmountMismatch' && (value === 'CREDIT_BANK_AMOUNT' || value === 'REJECT')) {
    return t(`options.onAmountMismatch.${value}`);
  }
  return t('values.notSet');
}

/** Refills: the reserved refill delivery cost, read only (ADR-16). */
function RefillsBlock({ row }: { row: AnySettingRow | undefined }) {
  const { t } = useTranslation('settings');
  return (
    <div className="sf-settings__row">
      <p className="sf-settings__readonly-label">{settingLabel('refill.deliveryCost')}</p>
      <p className="sf-settings__readonly-value">{t('refills.deliveryCostValue')}</p>
      {row ? <RowMeta row={row} /> : null}
      <p className="sf-settings__meta">{t('meta.readOnly')}</p>
    </div>
  );
}

/** Company account: read only, set by engineering on the owner's written request (ADR-09). */
function AccountBlock({ row }: { row: AnySettingRow | undefined }) {
  const { t } = useTranslation('settings');
  const account = row?.key === 'topup.account' ? (row.value as TopupAccount | null) : null;
  if (!account) {
    return (
      <div className="sf-settings__row">
        <InlineAlert tone="warning">{t('account.missing')}</InlineAlert>
        <p className="sf-settings__meta">{t('account.note')}</p>
      </div>
    );
  }
  const items: KeyValueItem[] = [
    { id: 'name', label: t('account.name'), value: account.accountTitle },
    { id: 'bank', label: t('account.bank'), value: account.bankName },
    {
      id: 'iban',
      label: t('account.iban'),
      value: (
        <span className="sf-settings__iban">
          <span className="sf-settings__mono">{account.iban}</span>
          <CopyButton value={account.iban} label={t('account.copyIban')} />
        </span>
      ),
    },
    { id: 'number', label: t('account.number'), value: <span className="sf-settings__mono">{account.accountNumber}</span> },
  ];
  return (
    <div className="sf-settings__row">
      <KeyValueList items={items} />
      <p className="sf-settings__meta">{t('account.note')}</p>
      {row ? <RowMeta row={row} /> : null}
    </div>
  );
}

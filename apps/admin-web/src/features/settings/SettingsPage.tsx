import { useId, useMemo, useState, type ReactNode } from 'react';
import { getRouteApi, useBlocker } from '@tanstack/react-router';
import { Lock } from 'lucide-react';
import type { AnySettingRow, SettingKey, TopupAccount } from '@smartfleet/shared-types';
import { formatPkDay } from '@smartfleet/shared-utils';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { messageFor, toApiError } from '../../api/errors';
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
  PhoneInput,
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
import { FIELDS, SECTIONS, sectionOf, type FieldDef, type SectionId } from './fields';
import { formatSettingValue, sameValue, settingLabel } from './values';
import './settings.css';

const route = getRouteApi('/settings');

const DEFAULT_SECTION: SectionId = 'money';
const REASON_MIN = 5;
const REASON_MAX = 300;

type Edits = Partial<Record<SettingKey, Draft>>;

interface Change {
  field: FieldDef;
  row: AnySettingRow;
  value: unknown;
}

/** A feature switch being turned on: the save review warns about it (website spec W39). */
function turnsFeatureOn(change: Change): boolean {
  return change.field.control.kind === 'switch' && Boolean(change.field.control.module) && change.value === true && change.row.value !== true;
}

/**
 * Settings (`/settings?section=`, website spec W38–W39): a fixed form in sections. Changes wait in a
 * sticky bar; "Review and save" lists them, warns about a feature being turned on and asks "Why?", then
 * sends one `PATCH /settings/:key` per change. Every save is in the Activity log.
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
  const section = sectionOf(search.section);

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
  const pendingKeys = useMemo(() => new Set(pending.map((entry) => entry.field.key)), [pending]);
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

  const goTo = (next: SectionId) => {
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

  // The one confirmation (W39), also for a feature being turned on: each change, its warning line, "Why?".
  const review = async () => {
    const changes: Change[] = pending.flatMap((entry) => (entry.result.ok ? [{ field: entry.field, row: entry.row, value: entry.result.value }] : []));
    if (changes.length === 0 || invalid) return;
    const facts: KeyValueItem[] = changes.map((change) => {
      const control = change.field.control;
      const module = control.kind === 'switch' && control.module ? t(`common:${MODULES[control.module].labelKey}`) : null;
      return {
        id: change.field.key,
        label: settingLabel(change.field.key),
        value: (
          <>
            {t('review.change', {
              from: formatSettingValue(change.field.key, change.row.value) ?? t('values.notSet'),
              to: formatSettingValue(change.field.key, change.value) ?? t('values.notSet'),
            })}
            {module && turnsFeatureOn(change) ? (
              <InlineAlert tone="warning" className="sf-settings__turn-on">
                {t('review.turnOn', { module })}
              </InlineAlert>
            ) : null}
          </>
        ),
      };
    });
    const { ok, reason } = await confirm({
      title: t('review.title'),
      facts,
      reason: { label: t('review.reason'), required: true, minLength: REASON_MIN, maxLength: REASON_MAX },
      confirmLabel: t('review.save', { count: changes.length }),
    });
    if (!ok || !reason) return;
    await saveAll(orderForSaving(changes, rows), reason);
  };

  const saveAll = async (changes: Change[], reason: string) => {
    // Saving keeps the page where it is (W38: it used to jump and hide the title).
    const scrollY = window.scrollY;
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
      window.requestAnimationFrame(() => {
        if (Math.abs(window.scrollY - scrollY) > 1) window.scrollTo({ top: scrollY });
      });
    }
  };

  const showBar = pending.length > 0 || saveProblem !== null;

  return (
    <div className="sf-settings">
      <PageHeader title={t('page.title')} subtitle={t('page.subtitle')} />
      <div className="sf-settings__layout">
        <nav className="sf-settings__menu" aria-label={t('page.menuLabel')}>
          <ul>
            {SECTIONS.map((id) => (
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
        <Field label={t('page.sectionLabel')} labelHidden className="sf-settings__section-select">
          <Select
            value={section}
            options={SECTIONS.map((id) => ({ value: id, label: t(`sections.${id}`) }))}
            onChange={(event) => goTo(event.target.value as SectionId)}
          />
        </Field>

        <section className="sf-settings__panel" aria-labelledby="sf-settings-section-title">
          <h2 id="sf-settings-section-title" className="sf-settings__panel-title">
            {t(`sections.${section}`)}
          </h2>
          {rowsQuery.isError && !rowsQuery.data ? (
            <ErrorState
              compact
              error={rowsQuery.error}
              onRetry={() => void rowsQuery.refetch()}
              retrying={rowsQuery.isFetching}
              title={t('page.loadFailed')}
            />
          ) : rowsQuery.isPending ? (
            <SkeletonText lines={8} />
          ) : section === 'account' ? (
            <AccountBlock row={rows.get('topup.account')} />
          ) : (
            <>
              {fields
                .filter((field) => field.section === section)
                .map((field) => {
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
                      unsaved={pendingKeys.has(field.key)}
                      disabled={saving}
                      onPatch={(patch) => patchDraft(field, patch)}
                    />
                  );
                })}
              {section === 'orders' ? <RefillCostBlock row={rows.get('refill.deliveryCost')} /> : null}
            </>
          )}
        </section>
      </div>

      {/* Always laid out, so showing or hiding it never moves the page. */}
      <div
        className={cx('sf-settings__bar', !showBar && 'is-idle')}
        role="region"
        aria-label={t('bar.changes', { count: pending.length })}
        aria-hidden={showBar ? undefined : true}
      >
        {saveProblem ? (
          <InlineAlert tone="danger" live className="sf-settings__bar-alert">
            {saveProblem}
          </InlineAlert>
        ) : null}
        <div className="sf-settings__bar-row">
          <p className="sf-settings__bar-text" aria-live="polite">
            {saving ? t('bar.saving') : pending.length > 0 ? t('bar.changes', { count: pending.length }) : null}
          </p>
          {pending.length > 0 ? (
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
          ) : null}
        </div>
      </div>
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

/** "Not saved" on an edited row, else "Changed 23 Oct by Owner" when it was ever changed; nothing for a default. */
function RowMeta({ row, unsaved }: { row: AnySettingRow; unsaved: boolean }) {
  const { t } = useTranslation('settings');
  if (unsaved) return <p className="sf-settings__meta is-unsaved">{t('meta.unsaved')}</p>;
  if (!row.updatedAt) return null;
  const date = formatPkDay(row.updatedAt, { weekday: false });
  return (
    <p className="sf-settings__meta">
      {row.updatedBy?.name ? t('meta.changedBy', { date, name: row.updatedBy.name }) : t('meta.changed', { date })}
    </p>
  );
}

/** A row the office can't change here: its label with a lock. */
function LockedLabel({ children }: { children: ReactNode }) {
  const { t } = useTranslation('settings');
  return (
    <span className="sf-settings__locked-label">
      {children}
      <Lock aria-hidden size={14} strokeWidth={2.25} className="sf-settings__lock" />
      <span className="sr-only">{t('meta.readOnly')}</span>
    </span>
  );
}

interface FieldRowProps {
  field: FieldDef;
  row: AnySettingRow;
  draft: Draft;
  error: string | undefined;
  unsaved: boolean;
  disabled: boolean;
  onPatch: (patch: Partial<Draft>) => void;
}

function FieldRow({ field, row, draft, error, unsaved, disabled, onPatch }: FieldRowProps) {
  const { t } = useTranslation('settings');
  const hoursId = useId();
  const locked = disabled || !row.editable;
  const hint = field.description ? t(field.description) : undefined;
  const control = field.control;
  let input: ReactNode = null;

  switch (control.kind) {
    case 'money': {
      const money = draft.kind === 'money' ? draft : { text: '', paisa: null };
      input = (
        <MoneyInput
          valuePaisa={money.paisa}
          allowZero={control.allowZero}
          min={row.min}
          max={row.max}
          onChange={(paisa) => onPatch({ kind: 'money', paisa })}
          onInput={(event) => onPatch({ kind: 'money', text: event.currentTarget.value })}
          disabled={locked}
        />
      );
      break;
    }
    case 'limit': {
      const limit = draft.kind === 'limit' ? draft : { on: false, text: '', paisa: null };
      input = (
        <div className="sf-settings__limit">
          <RadioCards
            columns={2}
            className="sf-settings__limit-choice"
            options={[
              { value: 'none', label: t('options.noLimit') },
              { value: 'set', label: t('options.setLimit') },
            ]}
            value={limit.on ? 'set' : 'none'}
            onChange={(choice) => onPatch({ kind: 'limit', on: choice === 'set' })}
          />
          {limit.on ? (
            <MoneyInput
              valuePaisa={limit.paisa}
              min={row.min}
              max={row.max}
              onChange={(paisa) => onPatch({ kind: 'limit', paisa })}
              onInput={(event) => onPatch({ kind: 'limit', text: event.currentTarget.value })}
              disabled={locked}
            />
          ) : null}
        </div>
      );
      if (locked) input = <fieldset disabled className="sf-settings__locked">{input}</fieldset>;
      break;
    }
    case 'integer':
      input = (
        <TextInput
          value={draft.kind === 'text' ? draft.text : ''}
          inputMode="numeric"
          maxLength={9}
          endAdornment={t(`units.${control.unit}`)}
          className="sf-settings__short"
          onChange={(event) => onPatch({ kind: 'text', text: event.target.value })}
          disabled={locked}
        />
      );
      break;
    case 'phone':
      input = (
        <PhoneInput
          value={draft.kind === 'text' ? draft.text : ''}
          className="sf-settings__short"
          onChange={(value) => onPatch({ kind: 'text', text: value })}
          disabled={locked}
        />
      );
      break;
    case 'text':
    case 'version':
      input = (
        <TextInput
          value={draft.kind === 'text' ? draft.text : ''}
          maxLength={control.kind === 'text' ? control.maxLength : 16}
          placeholder={t(control.kind === 'text' ? 'placeholders.hours' : 'placeholders.version')}
          className="sf-settings__short"
          onChange={(event) => onPatch({ kind: 'text', text: event.target.value })}
          disabled={locked}
        />
      );
      break;
    case 'switch':
      input = <Switch checked={draft.kind === 'flag' && draft.value} onChange={(on) => onPatch({ kind: 'flag', value: on })} disabled={locked} />;
      break;
    case 'deliveryStartedAt':
    case 'onAmountMismatch': {
      const kind = control.kind;
      input = (
        <RadioCards
          options={(row.options ?? []).map((value) => ({ value, label: optionWord(t, kind, value) }))}
          value={draft.kind === 'choice' ? draft.value : null}
          onChange={(value) => onPatch({ kind: 'choice', value })}
        />
      );
      if (locked) input = <fieldset disabled className="sf-settings__locked">{input}</fieldset>;
      break;
    }
    case 'hours': {
      const hours = draft.kind === 'hours' ? draft : { from: '', to: '' };
      input = (
        <span className="sf-settings__hours">
          <TextInput
            id={`${hoursId}-from`}
            type="time"
            step={60}
            aria-label={t('values.from')}
            value={hours.from}
            onChange={(event) => onPatch({ kind: 'hours', from: event.target.value })}
            disabled={locked}
          />
          <span aria-hidden>–</span>
          <TextInput
            id={`${hoursId}-to`}
            type="time"
            step={60}
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

  const label = settingLabel(field.key);
  return (
    <div className={cx('sf-settings__row', unsaved && 'is-unsaved')}>
      <Field label={row.editable ? label : <LockedLabel>{label}</LockedLabel>} hint={hint} error={error ?? null}>
        {input}
      </Field>
      <RowMeta row={row} unsaved={unsaved} />
    </div>
  );
}

function optionWord(t: TFunction<'settings'>, kind: 'deliveryStartedAt' | 'onAmountMismatch', value: string): string {
  if (kind === 'deliveryStartedAt' && (value === 'FIRST_LOAD_SCAN' || value === 'DRIVER_ASSIGNED' || value === 'LEFT_STORE')) {
    return t(`options.deliveryStartedAt.${value}`);
  }
  if (kind === 'onAmountMismatch' && (value === 'CREDIT_BANK_AMOUNT' || value === 'REJECT')) {
    return t(`options.onAmountMismatch.${value}`);
  }
  return t('values.notSet');
}

/** Refill delivery cost (under Orders and delivery): reserved and off, read only (ADR-16). */
function RefillCostBlock({ row }: { row: AnySettingRow | undefined }) {
  const { t } = useTranslation('settings');
  return (
    <div className="sf-settings__row">
      <p className="sf-settings__readonly-label">
        <LockedLabel>{settingLabel('refill.deliveryCost')}</LockedLabel>
      </p>
      <p className="sf-settings__readonly-value">{t('refills.deliveryCostValue')}</p>
      {row ? <RowMeta row={row} unsaved={false} /> : null}
    </div>
  );
}

/** Company account: read only, changed by the tech team on the owner's request (ADR-09). */
function AccountBlock({ row }: { row: AnySettingRow | undefined }) {
  const { t } = useTranslation('settings');
  const account = row?.key === 'topup.account' ? (row.value as TopupAccount | null) : null;
  const note = (
    <p className="sf-settings__description">
      <Lock aria-hidden size={14} strokeWidth={2.25} className="sf-settings__lock" />
      {t('descriptions.company')}
    </p>
  );
  if (!account) {
    return (
      <div className="sf-settings__row">
        {note}
        <InlineAlert tone="warning">{t('account.missing')}</InlineAlert>
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
  ];
  return (
    <div className="sf-settings__row">
      {note}
      <KeyValueList items={items} />
      {row ? <RowMeta row={row} unsaved={false} /> : null}
    </div>
  );
}

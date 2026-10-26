import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ImagePlus, X } from 'lucide-react';
import type { ExpenseDto, ExpenseTypeDto } from '@smartfleet/shared-types';
import {
  createExpenseSchema,
  EXPENSE_MAX_PAISA,
  type CreateExpenseInput,
  type UpdateExpenseInput,
} from '@smartfleet/shared-validation';
import { useTranslation } from 'react-i18next';
import { errorDetails, messageFor, toApiError } from '../../api/errors';
import { uploadFile } from '../../api/upload';
import { formatCalendarDate, formatDateTime, formatRs } from '../../i18n/format';
import {
  AddMore,
  Button,
  DateChips,
  Drawer,
  Field,
  FilterChips,
  flashRow,
  InlineAlert,
  KeyValueList,
  MoneyInput,
  MoneyText,
  Select,
  StatusChip,
  Textarea,
  todayInKarachi,
  useConfirm,
  useToast,
  useZodForm,
  type FormValues,
  type SelectOption,
} from '../../ui';
import {
  useCreateExpense,
  useDrivers,
  useInvalidateExpenses,
  useUpdateExpense,
  useVans,
  voidExpense,
} from './api';

export type ExpenseDrawerState = { mode: 'add' } | { mode: 'edit'; expense: ExpenseDto };

export interface ExpenseDrawerProps {
  state: ExpenseDrawerState;
  /** Every type (archived ones too, for an old expense's current type). */
  types: readonly ExpenseTypeDto[];
  onClose: () => void;
}

const NOTE_MAX = 200;
/** Up to this many types are chips; more make the Type a Select (UX_PRINCIPLES §3, website spec O10). */
const TYPE_CHIPS_MAX = 6;
/** The type of the last expense added in this browser, picked first next time (website spec W35). */
const LAST_TYPE_KEY = 'smartfleet.admin.expenses.lastType';

function readLastType(): string | null {
  try {
    return window.localStorage.getItem(LAST_TYPE_KEY);
  } catch {
    return null;
  }
}

function rememberType(typeId: string): void {
  try {
    window.localStorage.setItem(LAST_TYPE_KEY, typeId);
  } catch {
    // Storage unavailable: the next expense starts with no type picked.
  }
}

function initialValues(state: ExpenseDrawerState, types: readonly ExpenseTypeDto[]): FormValues<typeof createExpenseSchema> {
  if (state.mode === 'add') {
    const last = readLastType();
    const typeId = last && types.some((type) => type.id === last && !type.archived) ? last : '';
    return { expenseDate: todayInKarachi(), amountPaisa: null, typeId, vehicleId: '', driverId: '', description: '', receiptFileId: undefined };
  }
  const e = state.expense;
  return {
    expenseDate: e.expenseDate,
    amountPaisa: e.amountPaisa,
    typeId: e.type.id,
    vehicleId: e.vehicle?.id ?? '',
    driverId: e.driver?.id ?? '',
    description: e.description,
    receiptFileId: e.receiptFileId ?? undefined,
  };
}

/** The fields of a valid form that differ from the expense, for `PATCH` (null clears a link). */
function changesFrom(expense: ExpenseDto, data: CreateExpenseInput): UpdateExpenseInput {
  const out: UpdateExpenseInput = {};
  if (data.expenseDate !== expense.expenseDate) out.expenseDate = data.expenseDate;
  if (data.amountPaisa !== expense.amountPaisa) out.amountPaisa = data.amountPaisa;
  if (data.typeId !== expense.type.id) out.typeId = data.typeId;
  if ((data.vehicleId ?? null) !== (expense.vehicle?.id ?? null)) out.vehicleId = data.vehicleId ?? null;
  if ((data.driverId ?? null) !== (expense.driver?.id ?? null)) out.driverId = data.driverId ?? null;
  if (data.description !== expense.description) out.description = data.description;
  if ((data.receiptFileId ?? null) !== (expense.receiptFileId ?? null)) out.receiptFileId = data.receiptFileId ?? null;
  return out;
}

/** A field name for the codes the API answers about one field (UX_ADMIN §2.7 "Errors"). */
function codeFields(error: unknown): Record<string, string> {
  const field = errorDetails(error, 'NOT_FOUND')?.field;
  return {
    EXPENSE_DATE_IN_FUTURE: 'expenseDate',
    EXPENSE_TYPE_ARCHIVED: 'typeId',
    FILE_NOT_FOUND: 'receiptFileId',
    ...(field ? { NOT_FOUND: field } : {}),
  };
}

/** True for an empty form value ("" or null or missing). */
function blank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

/**
 * Add or edit an expense (UX_ADMIN §2.7, website spec W35) in a few taps: Date chips (Today picked),
 * Type chips (the last type used picked), the amount (focused), a short note, and the van, driver and
 * receipt photo behind "+ Add van, driver or receipt". A removed expense opens read-only. "Remove
 * expense…" asks why, with reason cards, and voids it.
 */
export function ExpenseDrawer({ state, types, onClose }: ExpenseDrawerProps) {
  if (state.mode === 'edit' && !state.expense.allowedActions.includes('EDIT')) {
    return <RemovedExpenseDrawer expense={state.expense} onClose={onClose} />;
  }
  return <ExpenseForm key={state.mode === 'edit' ? state.expense.id : 'new'} state={state} types={types} onClose={onClose} />;
}

function ExpenseForm({ state, types, onClose }: ExpenseDrawerProps) {
  const { t } = useTranslation(['expenses', 'common', 'errors']);
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidateExpenses();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editing = state.mode === 'edit' ? state.expense : null;
  const form = useZodForm(createExpenseSchema, initialValues(state, types));
  const create = useCreateExpense();
  const update = useUpdateExpense(editing?.id ?? null);
  const vans = useVans();
  const drivers = useDrivers();
  const [preview, setPreview] = useState<string | null>(editing?.receiptUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [removedMeanwhile, setRemovedMeanwhile] = useState(false);
  const today = todayInKarachi();
  const saving = create.isPending || update.isPending;
  const values = form.values;

  const typeOptions = useMemo<SelectOption[]>(() => {
    const options = types.filter((type) => !type.archived).map((type) => ({ value: type.id, label: type.name }));
    const current = editing ? types.find((type) => type.id === editing.type.id) : undefined;
    if (editing && (!current || current.archived)) {
      options.push({ value: editing.type.id, label: t('drawer.archivedType', { name: editing.type.name }) });
    }
    return options;
  }, [types, editing, t]);

  const vanOptions = useMemo<SelectOption[]>(() => {
    const options = (vans.data ?? []).map((van) => ({ value: van.id, label: van.plateNo }));
    if (editing?.vehicle && !options.some((o) => o.value === editing.vehicle?.id)) {
      options.push({ value: editing.vehicle.id, label: editing.vehicle.plateNo });
    }
    return options;
  }, [vans.data, editing]);

  const driverOptions = useMemo<SelectOption[]>(() => {
    const options = (drivers.data ?? []).map((driver) => ({ value: driver.id, label: driver.name }));
    if (editing?.driver && !options.some((o) => o.value === editing.driver?.id)) {
      options.push({ value: editing.driver.id, label: editing.driver.name });
    }
    return options;
  }, [drivers.data, editing]);

  const typeId = typeof values.typeId === 'string' ? values.typeId : '';
  const dateError =
    form.errorFor('expenseDate') ??
    (typeof values.expenseDate === 'string' && values.expenseDate > today ? t('errors:EXPENSE_DATE_IN_FUTURE') : undefined);
  const typeError = form.errorFor('typeId') ? (blank(values.typeId) ? t('drawer.typeMissing') : form.errorFor('typeId')) : undefined;
  const amountError = form.errorFor('amountPaisa') ? (blank(values.amountPaisa) ? t('drawer.amountMissing') : form.errorFor('amountPaisa')) : undefined;
  const noteError = form.errorFor('description') ? (blank(values.description) ? t('drawer.noteMissing') : form.errorFor('description')) : undefined;

  const submit = async (data: CreateExpenseInput) => {
    if (data.expenseDate > today) return;
    const typeName = types.find((type) => type.id === data.typeId)?.name ?? editing?.type.name ?? '';
    try {
      let saved: ExpenseDto | null = null;
      if (editing) {
        const patch = changesFrom(editing, data);
        if (Object.keys(patch).length === 0) {
          onClose();
          return;
        }
        saved = await update.mutateAsync(patch);
      } else {
        saved = await create.mutateAsync(data);
        rememberType(data.typeId);
      }
      toast.success(t('drawer.saved', { type: typeName, amount: formatRs(data.amountPaisa) }));
      if (saved) flashRow('expenses', saved.id);
      await invalidate();
      onClose();
    } catch (error) {
      if (toApiError(error).is('EXPENSE_ALREADY_VOIDED')) {
        setRemovedMeanwhile(true);
        void invalidate();
      }
      form.setServerError(error, codeFields(error));
    }
  };

  const pickReceipt = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const uploaded = await uploadFile(file, 'EXPENSE_RECEIPT');
      form.setValue('receiptFileId', uploaded.fileId);
      setPreview(uploaded.url);
    } catch (error) {
      setUploadError(messageFor(error));
    } finally {
      setUploading(false);
    }
  };

  const removeReceipt = () => {
    form.setValue('receiptFileId', undefined);
    setPreview(null);
    setUploadError(null);
  };

  const remove = async () => {
    if (!editing) return;
    const reasonWords: Record<string, string> = {
      TWICE: t('remove.reasons.twice'),
      AMOUNT: t('remove.reasons.amount'),
      TYPE: t('remove.reasons.type'),
    };
    const { ok } = await confirm({
      title: t('remove.title'),
      tone: 'danger',
      facts: [
        { label: t('drawer.date'), value: formatCalendarDate(editing.expenseDate, { year: true }) },
        { label: t('drawer.type'), value: editing.type.name },
        { label: t('drawer.amount'), value: <MoneyText paisa={editing.amountPaisa} /> },
      ],
      body: t('remove.body'),
      confirmLabel: t('remove.confirm'),
      reason: {
        optionsLabel: t('remove.reason'),
        options: [
          { value: 'TWICE', label: reasonWords.TWICE },
          { value: 'AMOUNT', label: reasonWords.AMOUNT },
          { value: 'TYPE', label: reasonWords.TYPE },
          { value: 'OTHER', label: t('remove.reasons.other') },
        ],
        optionColumns: 2,
        noteFor: ['OTHER'],
        requiredFor: ['OTHER'],
        label: t('remove.otherLabel'),
        minLength: 5,
        maxLength: 200,
      },
      // The picked card's words are the reason; "Other" sends what was typed (API: 5–200 characters).
      action: async ({ reason, reasonCode }) => {
        await voidExpense(editing.id, reasonCode && reasonCode !== 'OTHER' ? (reasonWords[reasonCode] ?? '') : (reason ?? ''));
      },
    });
    if (!ok) return;
    toast.success(t('remove.done'));
    flashRow('expenses', editing.id);
    await invalidate();
    onClose();
  };

  const listHint = (failed: boolean, retry: () => void) =>
    failed ? (
      <span>
        {t('drawer.listFailed')}{' '}
        <Button size="sm" variant="ghost" onClick={retry}>
          {t('drawer.retryList')}
        </Button>
      </span>
    ) : undefined;

  const formId = 'sf-expense-form';
  const extrasSet = Boolean(editing?.vehicle || editing?.driver || editing?.receiptFileId);

  return (
    <Drawer
      title={editing ? t('drawer.editTitle') : t('drawer.addTitle')}
      subtitle={
        editing ? t('drawer.recordedLine', { name: editing.recordedBy.name, when: formatDateTime(editing.createdAt) }) : undefined
      }
      dirty={form.isDirty}
      dismissible={!saving}
      onClose={onClose}
      notice={
        removedMeanwhile ? (
          <InlineAlert tone="warning" live>
            {t('drawer.alreadyRemoved')}
          </InlineAlert>
        ) : undefined
      }
      footer={{
        start:
          editing && editing.allowedActions.includes('VOID') && !removedMeanwhile ? (
            <Button variant="ghost-danger" onClick={() => void remove()} disabled={saving}>
              {t('drawer.remove')}
            </Button>
          ) : undefined,
        end: (
          <Button variant="primary" type="submit" form={formId} loading={saving} disabled={uploading || removedMeanwhile}>
            {t('drawer.save')}
          </Button>
        ),
      }}
    >
      <form
        id={formId}
        className="sf-expenses__form"
        noValidate
        onSubmit={(event) => {
          form.handleSubmit(submit)(event);
          // The type comes first on screen: a missing one takes the focus (its chips have no name).
          if (blank(values.typeId)) document.querySelector<HTMLElement>('.sf-expenses__type-chips [role="radio"]')?.focus();
        }}
      >
        {form.formError ? (
          <InlineAlert tone="danger" live>
            {form.formError}
          </InlineAlert>
        ) : null}
        <Field label={t('drawer.date')} error={dateError}>
          <DateChips
            value={typeof values.expenseDate === 'string' ? values.expenseDate : ''}
            max={today}
            onChange={(value) => form.setValue('expenseDate', value)}
            onBlur={() => form.touch('expenseDate')}
          />
        </Field>
        <Field label={t('drawer.type')} error={typeError}>
          {typeOptions.length <= TYPE_CHIPS_MAX ? (
            <FilterChips<string>
              className="sf-expenses__type-chips"
              options={typeOptions}
              value={typeId || null}
              onChange={(value) => form.setValue('typeId', value)}
            />
          ) : (
            <Select
              name="typeId"
              value={typeId}
              placeholder=""
              options={typeOptions}
              onChange={(event) => form.setValue('typeId', event.target.value)}
              onBlur={() => form.touch('typeId')}
            />
          )}
        </Field>
        <Field label={t('drawer.amount')} error={amountError} className="sf-expenses__amount">
          <MoneyInput
            name="amountPaisa"
            data-autofocus
            valuePaisa={typeof values.amountPaisa === 'string' ? values.amountPaisa : null}
            max={EXPENSE_MAX_PAISA}
            onChange={(value) => form.setValue('amountPaisa', value)}
            onBlur={() => form.touch('amountPaisa')}
          />
        </Field>
        <Field label={t('drawer.note')} error={noteError}>
          <Textarea
            name="description"
            rows={2}
            placeholder={t('drawer.notePlaceholder')}
            value={typeof values.description === 'string' ? values.description : ''}
            maxLength={NOTE_MAX}
            onChange={(event) => form.setValue('description', event.target.value)}
            onBlur={() => form.touch('description')}
          />
        </Field>
        <AddMore label={t('drawer.addMore')} defaultOpen={extrasSet}>
          <div className="sf-expenses__form-row">
            <Field label={t('drawer.van')} error={form.errorFor('vehicleId')} hint={listHint(vans.isError, () => void vans.refetch())}>
              <Select
                name="vehicleId"
                value={typeof values.vehicleId === 'string' ? values.vehicleId : ''}
                placeholder={t('drawer.noVan')}
                options={vanOptions}
                onChange={(event) => form.setValue('vehicleId', event.target.value)}
              />
            </Field>
            <Field label={t('drawer.driver')} error={form.errorFor('driverId')} hint={listHint(drivers.isError, () => void drivers.refetch())}>
              <Select
                name="driverId"
                value={typeof values.driverId === 'string' ? values.driverId : ''}
                placeholder={t('drawer.noDriver')}
                options={driverOptions}
                onChange={(event) => form.setValue('driverId', event.target.value)}
              />
            </Field>
          </div>
          <Field label={t('drawer.receipt')} error={uploadError ?? form.errorFor('receiptFileId')}>
            <div className="sf-expenses__receipt">
              {preview ? <img className="sf-expenses__receipt-preview" src={preview} alt={t('drawer.receipt')} /> : null}
              <input
                ref={fileInputRef}
                className="sf-expenses__file-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                tabIndex={-1}
                aria-hidden
                onChange={(event) => void pickReceipt(event)}
              />
              <Button icon={ImagePlus} loading={uploading} onClick={() => fileInputRef.current?.click()} disabled={saving}>
                {uploading ? t('drawer.uploading') : preview ? t('drawer.replaceReceipt') : t('drawer.attachReceipt')}
              </Button>
              {preview ? (
                <Button variant="ghost" icon={X} onClick={removeReceipt} disabled={saving || uploading}>
                  {t('drawer.removeReceipt')}
                </Button>
              ) : null}
            </div>
          </Field>
        </AddMore>
      </form>
    </Drawer>
  );
}

/** A removed expense, read-only: it stays in the activity log and out of totals. × closes it. */
function RemovedExpenseDrawer({ expense, onClose }: { expense: ExpenseDto; onClose: () => void }) {
  const { t } = useTranslation(['expenses', 'common']);
  return (
    <Drawer
      title={t('drawer.viewTitle')}
      subtitle={formatCalendarDate(expense.expenseDate, { year: true })}
      chip={<StatusChip kind="expense" value="VOIDED" />}
      onClose={onClose}
      notice={<InlineAlert tone="neutral">{t('drawer.removedNotice')}</InlineAlert>}
    >
      <KeyValueList
        items={[
          { label: t('drawer.amount'), value: <MoneyText paisa={expense.amountPaisa} /> },
          { label: t('drawer.type'), value: expense.type.name },
          { label: t('drawer.van'), value: expense.vehicle?.plateNo ?? t('table.none') },
          { label: t('drawer.driver'), value: expense.driver?.name ?? t('table.none') },
          { label: t('drawer.note'), value: expense.description },
          {
            label: t('drawer.receipt'),
            value: expense.receiptUrl ? (
              <a href={expense.receiptUrl} target="_blank" rel="noreferrer" aria-label={t('table.openReceipt')}>
                <img className="sf-expenses__receipt-preview" src={expense.receiptUrl} alt={t('drawer.receipt')} />
              </a>
            ) : (
              t('table.none')
            ),
          },
          { label: t('drawer.recordedBy'), value: expense.recordedBy.name },
          { label: t('drawer.recordedAt'), value: formatDateTime(expense.createdAt) },
          { label: t('drawer.removedAt'), value: expense.voidedAt ? formatDateTime(expense.voidedAt) : t('table.none') },
          { label: t('drawer.removedBy'), value: expense.voidedBy?.name ?? t('table.none') },
          { label: t('drawer.removedReason'), value: expense.voidReason ?? t('table.none') },
        ]}
      />
    </Drawer>
  );
}

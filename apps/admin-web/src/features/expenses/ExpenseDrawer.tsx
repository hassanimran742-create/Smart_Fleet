import { useId, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ImageUp, Trash2, X } from 'lucide-react';
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
import { formatCalendarDate, formatDateTime } from '../../i18n/format';
import {
  Button,
  DateInput,
  Drawer,
  Field,
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

function initialValues(state: ExpenseDrawerState): FormValues<typeof createExpenseSchema> {
  if (state.mode === 'add') {
    return { expenseDate: todayInKarachi(), amountPaisa: null, typeId: '', vehicleId: '', driverId: '', description: '', receiptFileId: undefined };
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

/**
 * Add or edit an expense (UX_ADMIN §2.7): Date, Amount, Type, Van, Driver, Note and a receipt photo.
 * A removed expense opens read-only. "Remove expense…" asks for a reason and voids it.
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
  const formId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editing = state.mode === 'edit' ? state.expense : null;
  const form = useZodForm(createExpenseSchema, initialValues(state));
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

  const dateError =
    form.errorFor('expenseDate') ??
    (typeof form.values.expenseDate === 'string' && form.values.expenseDate > today ? t('errors:EXPENSE_DATE_IN_FUTURE') : undefined);

  const submit = async (data: CreateExpenseInput) => {
    if (data.expenseDate > today) return;
    try {
      if (editing) {
        const patch = changesFrom(editing, data);
        if (Object.keys(patch).length > 0) await update.mutateAsync(patch);
      } else {
        await create.mutateAsync(data);
      }
      toast.success(t('drawer.saved'));
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

  const dirty = form.isDirty;

  const cancel = async () => {
    if (saving) return;
    if (dirty) {
      const { ok } = await confirm({
        title: t('common:dialog.discardTitle'),
        body: t('common:dialog.discardBody'),
        tone: 'danger',
        confirmLabel: t('common:actions.discardChanges'),
        cancelLabel: t('common:actions.keepEditing'),
      });
      if (!ok) return;
    }
    onClose();
  };

  const remove = async () => {
    if (!editing) return;
    const { ok } = await confirm({
      title: t('remove.title'),
      body: t('remove.body'),
      tone: 'danger',
      facts: [
        { label: t('drawer.date'), value: formatCalendarDate(editing.expenseDate, { year: true }) },
        { label: t('drawer.type'), value: editing.type.name },
        { label: t('drawer.amount'), value: <MoneyText paisa={editing.amountPaisa} /> },
      ],
      confirmLabel: t('remove.confirm'),
      reason: { label: t('remove.reason'), hint: t('remove.reasonHint'), required: true, minLength: 5, maxLength: 200 },
      action: async ({ reason }) => {
        await voidExpense(editing.id, reason ?? '');
      },
    });
    if (!ok) return;
    toast.success(t('remove.done'));
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

  return (
    <Drawer
      title={editing ? t('drawer.editTitle') : t('drawer.addTitle')}
      subtitle={
        editing ? t('drawer.recordedLine', { name: editing.recordedBy.name, when: formatDateTime(editing.createdAt) }) : undefined
      }
      dirty={dirty}
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
            <Button variant="ghost-danger" icon={Trash2} onClick={() => void remove()} disabled={saving}>
              {t('drawer.remove')}
            </Button>
          ) : undefined,
        end: (
          <>
            <Button onClick={() => void cancel()} disabled={saving}>
              {t('drawer.cancel')}
            </Button>
            <Button
              variant="primary"
              type="submit"
              form={formId}
              loading={saving}
              disabled={uploading || removedMeanwhile}
            >
              {t('drawer.save')}
            </Button>
          </>
        ),
      }}
    >
      <form id={formId} className="sf-expenses__form" onSubmit={form.handleSubmit(submit)} noValidate>
        {form.formError ? (
          <InlineAlert tone="danger" live>
            {form.formError}
          </InlineAlert>
        ) : null}
        <div className="sf-expenses__form-row">
          <Field label={t('drawer.date')} hint={t('drawer.dateHint')} error={dateError}>
            <DateInput
              name="expenseDate"
              value={typeof form.values.expenseDate === 'string' ? form.values.expenseDate : ''}
              max={today}
              required
              onChange={(value) => form.setValue('expenseDate', value)}
              onBlur={() => form.touch('expenseDate')}
            />
          </Field>
          <Field label={t('drawer.amount')} error={form.errorFor('amountPaisa')}>
            <MoneyInput
              name="amountPaisa"
              valuePaisa={typeof form.values.amountPaisa === 'string' ? form.values.amountPaisa : null}
              max={EXPENSE_MAX_PAISA}
              required
              onChange={(value) => form.setValue('amountPaisa', value)}
              onBlur={() => form.touch('amountPaisa')}
            />
          </Field>
        </div>
        <Field label={t('drawer.type')} error={form.errorFor('typeId')}>
          <Select
            name="typeId"
            value={typeof form.values.typeId === 'string' ? form.values.typeId : ''}
            placeholder={t('drawer.typePlaceholder')}
            options={typeOptions}
            required
            onChange={(event) => form.setValue('typeId', event.target.value)}
            onBlur={() => form.touch('typeId')}
          />
        </Field>
        <div className="sf-expenses__form-row">
          <Field label={t('drawer.van')} optional error={form.errorFor('vehicleId')} hint={listHint(vans.isError, () => void vans.refetch())}>
            <Select
              name="vehicleId"
              value={typeof form.values.vehicleId === 'string' ? form.values.vehicleId : ''}
              placeholder={t('drawer.noVan')}
              options={vanOptions}
              onChange={(event) => form.setValue('vehicleId', event.target.value)}
            />
          </Field>
          <Field
            label={t('drawer.driver')}
            optional
            error={form.errorFor('driverId')}
            hint={listHint(drivers.isError, () => void drivers.refetch())}
          >
            <Select
              name="driverId"
              value={typeof form.values.driverId === 'string' ? form.values.driverId : ''}
              placeholder={t('drawer.noDriver')}
              options={driverOptions}
              onChange={(event) => form.setValue('driverId', event.target.value)}
            />
          </Field>
        </div>
        <Field label={t('drawer.note')} hint={t('drawer.noteHint')} error={form.errorFor('description')}>
          <Textarea
            name="description"
            value={typeof form.values.description === 'string' ? form.values.description : ''}
            maxLength={NOTE_MAX}
            required
            onChange={(event) => form.setValue('description', event.target.value)}
            onBlur={() => form.touch('description')}
          />
        </Field>
        <Field label={t('drawer.receipt')} optional hint={t('drawer.receiptHint')} error={uploadError ?? form.errorFor('receiptFileId')}>
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
            <Button icon={ImageUp} loading={uploading} onClick={() => fileInputRef.current?.click()} disabled={saving}>
              {uploading ? t('drawer.uploading') : preview ? t('drawer.replaceReceipt') : t('drawer.attachReceipt')}
            </Button>
            {preview ? (
              <Button variant="ghost" icon={X} onClick={removeReceipt} disabled={saving || uploading}>
                {t('drawer.removeReceipt')}
              </Button>
            ) : null}
          </div>
        </Field>
      </form>
    </Drawer>
  );
}

/** A removed expense, read-only: it stays in the activity log and out of totals. */
function RemovedExpenseDrawer({ expense, onClose }: { expense: ExpenseDto; onClose: () => void }) {
  const { t } = useTranslation(['expenses', 'common']);
  return (
    <Drawer
      title={t('drawer.viewTitle')}
      subtitle={formatCalendarDate(expense.expenseDate, { year: true })}
      chip={<StatusChip kind="expense" value="VOIDED" />}
      onClose={onClose}
      notice={<InlineAlert tone="info">{t('drawer.removedNotice')}</InlineAlert>}
      footer={{ end: <Button onClick={onClose}>{t('drawer.close')}</Button> }}
    >
      <KeyValueList
        items={[
          { label: t('drawer.amount'), value: <MoneyText paisa={expense.amountPaisa} /> },
          { label: t('drawer.type'), value: expense.type.name },
          { label: t('drawer.van'), value: expense.vehicle?.plateNo ?? t('table.noVan') },
          { label: t('drawer.driver'), value: expense.driver?.name ?? t('table.noDriver') },
          { label: t('drawer.note'), value: expense.description },
          {
            label: t('drawer.receipt'),
            value: expense.receiptUrl ? (
              <a href={expense.receiptUrl} target="_blank" rel="noreferrer" aria-label={t('table.openReceipt')}>
                <img className="sf-expenses__receipt-preview" src={expense.receiptUrl} alt={t('drawer.receipt')} />
              </a>
            ) : (
              t('table.noReceipt')
            ),
          },
          { label: t('drawer.recordedBy'), value: expense.recordedBy.name },
          { label: t('drawer.recordedAt'), value: formatDateTime(expense.createdAt) },
          { label: t('drawer.removedAt'), value: expense.voidedAt ? formatDateTime(expense.voidedAt) : t('table.noVan') },
          { label: t('drawer.removedBy'), value: expense.voidedBy?.name ?? t('table.noVan') },
          { label: t('drawer.removedReason'), value: expense.voidReason ?? t('table.noVan') },
        ]}
      />
    </Drawer>
  );
}

import { useState } from 'react';
import { Archive, ArchiveRestore, Lock, Pencil, Plus } from 'lucide-react';
import type { ExpenseTypeDto } from '@smartfleet/shared-types';
import {
  createExpenseTypeSchema,
  renameExpenseTypeSchema,
  toExpenseTypeNameKey,
} from '@smartfleet/shared-validation';
import { useTranslation } from 'react-i18next';
import { messageFor, toApiError } from '../../api/errors';
import { useCloseDrawer } from '../../app/drawer';
import {
  Button,
  cx,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  SkeletonText,
  StatusChip,
  TextInput,
  useToast,
  useZodForm,
} from '../../ui';
import { useArchiveExpenseType, useCreateExpenseType, useExpenseTypes, useInvalidateExpenses, useRenameExpenseType } from './api';

/**
 * Manage types (UX_ADMIN §2.7, route `/expenses/types`): add, rename, archive and restore. Petrol and
 * Other show the lock "Can't be archived". A name taken by an archived type points at that type's
 * Restore button instead of only saying the name is taken (G13-02).
 */
export function ExpenseTypesDrawer() {
  const { t } = useTranslation(['expenses', 'common']);
  const close = useCloseDrawer();
  const types = useExpenseTypes();
  const [adding, setAdding] = useState(false);
  /** The archived type a refused name belongs to: its row is highlighted with its Restore button. */
  const [highlight, setHighlight] = useState<string | null>(null);

  const all = types.data ?? [];
  const active = all.filter((type) => !type.archived);
  const archived = all.filter((type) => type.archived);

  /** The archived type that already has this name (same key: case and spaces ignored), if any. */
  const archivedNamed = (name: string): ExpenseTypeDto | undefined => {
    const key = toExpenseTypeNameKey(name);
    return archived.find((type) => toExpenseTypeNameKey(type.name) === key);
  };

  let body;
  if (types.isPending) {
    body = <SkeletonText lines={6} />;
  } else if (types.isError && !types.data) {
    body = <ErrorState error={types.error} onRetry={() => void types.refetch()} retrying={types.isFetching} title={t('types.loadFailed')} />;
  } else if (all.length === 0) {
    body = <EmptyState compact title={t('types.empty')} />;
  } else {
    body = (
      <>
        <ul className="sf-expenses__types" aria-label={t('types.listCaption')}>
          {active.map((type) => (
            <TypeRow key={type.id} type={type} highlighted={false} archivedNamed={archivedNamed} onHighlight={setHighlight} />
          ))}
        </ul>
        {archived.length > 0 ? (
          <>
            <h3 className="sf-expenses__types-heading">{t('types.archivedHeading')}</h3>
            <ul className="sf-expenses__types" aria-label={t('types.archivedHeading')}>
              {archived.map((type) => (
                <TypeRow
                  key={type.id}
                  type={type}
                  highlighted={highlight === type.id}
                  archivedNamed={archivedNamed}
                  onHighlight={setHighlight}
                />
              ))}
            </ul>
          </>
        ) : null}
      </>
    );
  }

  return (
    <Drawer title={t('types.title')} subtitle={t('types.subtitle')} onClose={close}>
      <div className="sf-expenses__add-type">
        {adding ? (
          <AddTypeForm
            archivedNamed={archivedNamed}
            onHighlight={setHighlight}
            onDone={() => {
              setAdding(false);
              setHighlight(null);
            }}
          />
        ) : (
          <Button variant="primary" icon={Plus} onClick={() => setAdding(true)} disabled={types.isPending}>
            {t('types.add')}
          </Button>
        )}
      </div>
      {body}
    </Drawer>
  );
}

interface NameHelpers {
  archivedNamed: (name: string) => ExpenseTypeDto | undefined;
  onHighlight: (typeId: string | null) => void;
}

/** The message for a refused name: the archived-type hint when an archived type has it. */
function useNameError({ archivedNamed, onHighlight }: NameHelpers) {
  const { t } = useTranslation('expenses');
  return (error: unknown, name: string): string => {
    if (toApiError(error).is('EXPENSE_TYPE_NAME_TAKEN')) {
      const archived = archivedNamed(name);
      if (archived) {
        onHighlight(archived.id);
        return t('types.archivedNameTaken', { name: archived.name });
      }
    }
    onHighlight(null);
    return messageFor(error);
  };
}

function AddTypeForm({ archivedNamed, onHighlight, onDone }: NameHelpers & { onDone: () => void }) {
  const { t } = useTranslation('expenses');
  const toast = useToast();
  const invalidate = useInvalidateExpenses();
  const create = useCreateExpenseType();
  const form = useZodForm(createExpenseTypeSchema, { name: '' });
  const [serverError, setServerError] = useState<string | null>(null);
  const nameError = useNameError({ archivedNamed, onHighlight });

  const submit = async ({ name }: { name: string }) => {
    setServerError(null);
    try {
      const created = await create.mutateAsync(name);
      toast.success(t('types.created', { name: created.name }));
      await invalidate();
      onDone();
    } catch (error) {
      setServerError(nameError(error, name));
    }
  };

  return (
    <form className="sf-expenses__inline-form" onSubmit={form.handleSubmit(submit)} noValidate>
      <Field label={t('types.newName')} hint={t('types.nameHint')} error={serverError ?? form.errorFor('name')}>
        <TextInput
          name="name"
          autoFocus
          maxLength={60}
          value={typeof form.values.name === 'string' ? form.values.name : ''}
          onChange={(event) => {
            setServerError(null);
            form.setValue('name', event.target.value);
          }}
          onBlur={() => form.touch('name')}
        />
      </Field>
      <div className="sf-expenses__inline-actions">
        <Button onClick={onDone} disabled={create.isPending}>
          {t('types.cancel')}
        </Button>
        <Button variant="primary" type="submit" loading={create.isPending}>
          {t('types.save')}
        </Button>
      </div>
    </form>
  );
}

function TypeRow({ type, highlighted, archivedNamed, onHighlight }: NameHelpers & { type: ExpenseTypeDto; highlighted: boolean }) {
  const { t } = useTranslation('expenses');
  const toast = useToast();
  const invalidate = useInvalidateExpenses();
  const toggle = useArchiveExpenseType();
  const [renaming, setRenaming] = useState(false);

  const setArchived = async (archive: boolean) => {
    try {
      const updated = await toggle.mutateAsync({ id: type.id, archive });
      toast.success(archive ? t('types.archived', { name: updated.name }) : t('types.restored', { name: updated.name }));
      if (!archive) onHighlight(null);
      await invalidate();
    } catch (error) {
      toast.error(error);
    }
  };

  return (
    <li className={cx('sf-expenses__type', highlighted && 'is-highlighted')}>
      {renaming ? (
        <RenameForm type={type} archivedNamed={archivedNamed} onHighlight={onHighlight} onDone={() => setRenaming(false)} />
      ) : (
        <>
          <div className="sf-expenses__type-main">
            <span className="sf-expenses__type-name">{type.name}</span>
            <span className="sf-expenses__type-meta">{t('types.count', { count: type.expenseCount })}</span>
          </div>
          <StatusChip kind="expenseType" value={type.archived ? 'ARCHIVED' : 'ACTIVE'} />
          <div className="sf-expenses__type-actions">
            <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setRenaming(true)} disabled={toggle.isPending}>
              {t('types.rename')}
            </Button>
            {type.isSystem ? (
              <span className="sf-expenses__lock">
                <Lock aria-hidden size={14} />
                {t('types.locked')}
              </span>
            ) : type.archived ? (
              <Button
                size="sm"
                variant="secondary"
                icon={ArchiveRestore}
                loading={toggle.isPending}
                onClick={() => void setArchived(false)}
              >
                {t('types.restore')}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" icon={Archive} loading={toggle.isPending} onClick={() => void setArchived(true)}>
                {t('types.archive')}
              </Button>
            )}
          </div>
        </>
      )}
    </li>
  );
}

function RenameForm({ type, archivedNamed, onHighlight, onDone }: NameHelpers & { type: ExpenseTypeDto; onDone: () => void }) {
  const { t } = useTranslation('expenses');
  const toast = useToast();
  const invalidate = useInvalidateExpenses();
  const rename = useRenameExpenseType();
  const form = useZodForm(renameExpenseTypeSchema, { name: type.name });
  const [serverError, setServerError] = useState<string | null>(null);
  const nameError = useNameError({ archivedNamed, onHighlight });

  const submit = async ({ name }: { name: string }) => {
    setServerError(null);
    if (name === type.name) {
      onDone();
      return;
    }
    try {
      const renamed = await rename.mutateAsync({ id: type.id, name });
      toast.success(t('types.renamed', { name: renamed.name }));
      await invalidate();
      onDone();
    } catch (error) {
      setServerError(nameError(error, name));
    }
  };

  return (
    <form className="sf-expenses__inline-form" onSubmit={form.handleSubmit(submit)} noValidate>
      <Field label={t('types.renameLabel', { name: type.name })} hint={t('types.nameHint')} error={serverError ?? form.errorFor('name')}>
        <TextInput
          name="name"
          autoFocus
          maxLength={60}
          value={typeof form.values.name === 'string' ? form.values.name : ''}
          onChange={(event) => {
            setServerError(null);
            form.setValue('name', event.target.value);
          }}
          onBlur={() => form.touch('name')}
        />
      </Field>
      <div className="sf-expenses__inline-actions">
        <Button size="sm" onClick={onDone} disabled={rename.isPending}>
          {t('types.cancel')}
        </Button>
        {/* The drawer's one primary action is "Add type"; a row's save is secondary. */}
        <Button size="sm" variant="secondary" type="submit" loading={rename.isPending}>
          {t('types.saveName')}
        </Button>
      </div>
    </form>
  );
}

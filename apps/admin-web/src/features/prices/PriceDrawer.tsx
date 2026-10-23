import { useEffect, useState } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import type { PriceGridDto, PriceGridZone } from '@smartfleet/shared-types';
import { formatPkDay } from '@smartfleet/shared-utils';
import { PRICE_MAX_PAISA, type PutPriceInput } from '@smartfleet/shared-validation';
import { useTranslation } from 'react-i18next';
import { fieldMessage, messageFor, toApiError, type ApiError } from '../../api/errors';
import { useCloseDrawer } from '../../app/drawer';
import { formatRs } from '../../i18n/format';
import {
  Button,
  Drawer,
  ErrorState,
  Field,
  InlineAlert,
  MoneyInput,
  SkeletonText,
  StatusChip,
  useConfirm,
  useToast,
} from '../../ui';
import { PRICE_DRAWER_POLL_MS, removePrice, useApplyPriceRow, usePriceGrid, useSavePrice } from './api';
import { priceExample } from './example';
import './prices.css';

const route = getRouteApi('/prices/$distributorId/$zoneId');

/** A reason of 5–300 characters for removing a price (API_CONTRACT §7.5). */
const REASON_MIN = 5;
const REASON_MAX = 300;

/**
 * The price drawer (`/prices/$distributorId/$zoneId`, UX_ADMIN §2.3): a required base per order and an
 * optional amount per cylinder size (blank is Rs 0), each from Rs 0 to Rs 100,000, with a live example.
 * Saving answers the zone's row, which goes into the grid at once (G03-04).
 */
export function PriceDrawer() {
  const { t } = useTranslation(['prices', 'nav']);
  const { distributorId, zoneId } = route.useParams();
  const close = useCloseDrawer();
  const grid = usePriceGrid(distributorId, { pollMs: PRICE_DRAWER_POLL_MS });
  const row = grid.data?.zones.find((candidate) => candidate.zone.id === zoneId);

  if (grid.isPending) {
    return (
      <Drawer title={t('nav:pages.price')} onClose={close}>
        <SkeletonText lines={8} />
      </Drawer>
    );
  }
  if (!grid.data) {
    return (
      <Drawer title={t('nav:pages.price')} onClose={close}>
        <ErrorState error={grid.error} onRetry={() => void grid.refetch()} retrying={grid.isFetching} title={t('page.loadFailed')} />
      </Drawer>
    );
  }
  if (!row) {
    return (
      <Drawer title={t('nav:pages.price')} onClose={close}>
        <InlineAlert tone="warning">{t('drawer.zoneMissing')}</InlineAlert>
      </Drawer>
    );
  }
  return <PriceForm key={zoneId} grid={grid.data} row={row} onClose={close} reloadGrid={() => void grid.refetch()} />;
}

/** One money box: what the person typed (to tell blank from not-a-number) and its paisa value. */
interface AmountDraft {
  text: string;
  paisa: string | null;
}

function draftOf(paisa: string | null | undefined, blankZero: boolean): AmountDraft {
  if (paisa === null || paisa === undefined || (blankZero && paisa === '0')) return { text: '', paisa: null };
  return { text: paisa, paisa };
}

interface Drafts {
  base: AmountDraft;
  sizes: Record<string, AmountDraft>;
}

/** What the boxes say, ignoring how it was typed: blank, or the paisa value (null when not an amount). */
function signature(drafts: Drafts): string {
  const one = (draft: AmountDraft) => (draft.text.trim() === '' ? '' : draft.paisa);
  return JSON.stringify([one(drafts.base), Object.entries(drafts.sizes).map(([id, draft]) => [id, one(draft)])]);
}

function draftsOf(grid: PriceGridDto, row: PriceGridZone): Drafts {
  const sizes: Record<string, AmountDraft> = {};
  for (const size of grid.sizes) {
    const amount = row.price?.sizes.find((entry) => entry.cylinderTypeId === size.cylinderTypeId)?.perCylinderPaisa;
    sizes[size.cylinderTypeId] = draftOf(amount, true);
  }
  return { base: draftOf(row.price?.basePaisa, false), sizes };
}

/** The amount of a box, or the reason it isn't one. Blank is Rs 0 for a size; the base is required. */
function amountOf(draft: AmountDraft, required: boolean): { ok: true; paisa: bigint | null } | { ok: false; code: 'REQUIRED' | 'PRICE_INVALID' } {
  if (draft.text.trim() === '') return required ? { ok: false, code: 'REQUIRED' } : { ok: true, paisa: null };
  if (draft.paisa === null || !/^\d+$/.test(draft.paisa)) return { ok: false, code: 'PRICE_INVALID' };
  const paisa = BigInt(draft.paisa);
  return paisa > BigInt(PRICE_MAX_PAISA) ? { ok: false, code: 'PRICE_INVALID' } : { ok: true, paisa };
}

function PriceForm({ grid, row, onClose, reloadGrid }: { grid: PriceGridDto; row: PriceGridZone; onClose: () => void; reloadGrid: () => void }) {
  const { t } = useTranslation(['prices', 'validation', 'errors']);
  const toast = useToast();
  const confirm = useConfirm();
  const save = useSavePrice(grid.distributor.id, row.zone.id);
  const applyRow = useApplyPriceRow(grid.distributor.id);
  const [initial, setInitial] = useState(() => draftsOf(grid, row));
  const [drafts, setDrafts] = useState(initial);
  const [baseline, setBaseline] = useState(row.price?.updatedAt ?? null);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState<{ text: string; reload?: boolean } | null>(null);

  const distributor = grid.distributor.businessName;
  const zone = row.zone.name;
  const archived = !row.zone.isActive;
  const dirty = signature(drafts) !== signature(initial);
  // Someone else saved or removed this price while the drawer was open.
  const changedElsewhere = (row.price?.updatedAt ?? null) !== baseline;

  const base = amountOf(drafts.base, true);
  const sizeAmounts = grid.sizes.map((size) => ({ size, result: amountOf(drafts.sizes[size.cylinderTypeId] ?? { text: '', paisa: null }, false) }));
  const valid = base.ok && sizeAmounts.every((entry) => entry.result.ok);

  const amounts = new Map<string, bigint>();
  for (const entry of sizeAmounts) if (entry.result.ok && entry.result.paisa !== null) amounts.set(entry.size.cylinderTypeId, entry.result.paisa);
  const example = priceExample(base.ok ? base.paisa : null, grid.sizes, amounts);

  const message = (code: 'REQUIRED' | 'PRICE_INVALID') => t(`validation:${code}`);
  const baseError = serverErrors.basePaisa ?? (submitted && !base.ok ? message(base.code) : undefined);
  const sizeError = (id: string, result: ReturnType<typeof amountOf>) =>
    serverErrors[`size:${id}`] ?? (submitted && !result.ok ? message(result.code) : undefined);

  const reload = () => {
    const next = draftsOf(grid, row);
    setInitial(next);
    setDrafts(next);
    setBaseline(row.price?.updatedAt ?? null);
    setServerErrors({});
    setTopError(null);
  };

  // Nothing typed yet: follow a price someone else saved meanwhile. With edits, the notice offers "Reload".
  const rowVersion = row.price?.updatedAt ?? null;
  useEffect(() => {
    if (rowVersion === baseline || dirty) return;
    const next = draftsOf(grid, row);
    setInitial(next);
    setDrafts(next);
    setBaseline(rowVersion);
  }, [rowVersion, baseline, dirty, grid, row]);

  const setBase = (patch: Partial<AmountDraft>) => {
    setDrafts((prev) => ({ ...prev, base: { ...prev.base, ...patch } }));
    setServerErrors(({ basePaisa: _drop, ...rest }) => rest);
  };
  const setSize = (id: string, patch: Partial<AmountDraft>) => {
    setDrafts((prev) => ({ ...prev, sizes: { ...prev.sizes, [id]: { ...(prev.sizes[id] ?? { text: '', paisa: null }), ...patch } } }));
    setServerErrors(({ [`size:${id}`]: _drop, ...rest }) => rest);
  };

  const showError = (error: ApiError, sent: PutPriceInput) => {
    if (error.isNetwork) {
      setTopError({ text: t('drawer.offline') });
      return;
    }
    if (error.fields.length > 0) {
      const byField: Record<string, string> = {};
      for (const field of error.fields) {
        const text = fieldMessage(field);
        const sizeMatch = /^sizes\.(\d+)/.exec(field.path);
        if (field.path === 'basePaisa') byField.basePaisa = text;
        else if (sizeMatch && sent.sizes?.[Number(sizeMatch[1])]) byField[`size:${sent.sizes[Number(sizeMatch[1])].cylinderTypeId}`] = text;
      }
      setServerErrors(byField);
      if (Object.keys(byField).length === 0) setTopError({ text: messageFor(error) });
      return;
    }
    if (error.is('CONFLICT_STALE_STATE')) {
      setTopError({ text: t('drawer.stale'), reload: true });
      reloadGrid();
      return;
    }
    if (error.is('ZONE_ARCHIVED', 'NOT_FOUND')) reloadGrid();
    setTopError({ text: messageFor(error) });
  };

  const onSave = async () => {
    setSubmitted(true);
    if (!base.ok || base.paisa === null || !valid) return;
    const body: PutPriceInput = {
      basePaisa: base.paisa.toString(),
      sizes: sizeAmounts
        .filter((entry) => entry.result.ok && entry.result.paisa !== null)
        .map((entry) => ({
          cylinderTypeId: entry.size.cylinderTypeId,
          perCylinderPaisa: (entry.result as { ok: true; paisa: bigint }).paisa.toString(),
        })),
    };
    setTopError(null);
    setServerErrors({});
    try {
      const saved = await save.mutateAsync(body);
      await applyRow(saved);
      toast.success(t('drawer.saved', { zone }));
      onClose();
    } catch (error) {
      showError(toApiError(error), body);
    }
  };

  const onRemove = async () => {
    const { ok } = await confirm({
      title: t('drawer.removeTitle', { zone }),
      body: t('drawer.removeBody', { zone }),
      tone: 'danger',
      confirmLabel: t('drawer.removeConfirm'),
      reason: { label: t('drawer.removeReason'), hint: t('drawer.removeReasonHint'), required: true, minLength: REASON_MIN, maxLength: REASON_MAX },
      action: async ({ reason }) => {
        // A price that was already gone answers the same row (X-Already-Applied): it reads as removed.
        await applyRow(await removePrice(grid.distributor.id, row.zone.id, reason ?? ''));
      },
    });
    if (!ok) return;
    toast.success(t('drawer.removed', { zone }));
    onClose();
  };

  const busy = save.isPending;
  const updatedBy = row.price?.updatedBy?.name;
  const updatedAt = row.price ? formatPkDay(row.price.updatedAt, { weekday: false }) : null;

  return (
    <Drawer
      title={t('drawer.title', { distributor, zone })}
      subtitle={row.zone.cityName}
      chip={<StatusChip kind="price" value={row.price ? 'SET' : 'NOT_SET'} />}
      dirty={dirty && !busy}
      dismissible={!busy}
      onClose={onClose}
      notice={
        changedElsewhere && dirty ? (
          <InlineAlert
            tone="warning"
            live
            action={
              <Button size="sm" onClick={reload}>
                {t('drawer.reload')}
              </Button>
            }
          >
            {t('drawer.stale')}
          </InlineAlert>
        ) : undefined
      }
      footer={{
        start: row.price ? (
          <Button variant="ghost-danger" onClick={() => void onRemove()} disabled={busy}>
            {t('drawer.remove')}
          </Button>
        ) : undefined,
        end: archived ? undefined : (
          <Button variant="primary" loading={busy} onClick={() => void onSave()}>
            {t('drawer.save')}
          </Button>
        ),
      }}
    >
      {archived ? (
        <InlineAlert tone="info" className="sf-prices__drawer-alert">
          {t('drawer.archived')}
        </InlineAlert>
      ) : null}
      {!row.price && !archived ? (
        <InlineAlert tone="warning" className="sf-prices__drawer-alert">
          {t('drawer.notSet')}
        </InlineAlert>
      ) : null}
      {updatedAt ? (
        <p className="sf-prices__muted sf-prices__last-changed">
          {updatedBy ? t('drawer.lastChanged', { date: updatedAt, name: updatedBy }) : t('drawer.lastChangedNoName', { date: updatedAt })}
        </p>
      ) : null}

      <Field label={t('drawer.base')} hint={t('drawer.baseHint', { max: formatRs(PRICE_MAX_PAISA) })} error={baseError}>
        <MoneyInput
          name="basePaisa"
          allowZero
          min={0}
          max={PRICE_MAX_PAISA}
          valuePaisa={drafts.base.paisa}
          onChange={(paisa) => setBase({ paisa })}
          onInput={(event) => setBase({ text: event.currentTarget.value })}
          disabled={archived || busy}
        />
      </Field>

      {grid.sizes.length > 0 ? (
        <fieldset className="sf-prices__sizes" disabled={archived || busy}>
          <legend className="sf-prices__sizes-title">{t('drawer.perCylinderTitle')}</legend>
          <p className="sf-prices__muted sf-prices__sizes-hint">{t('drawer.perCylinderHint', { max: formatRs(PRICE_MAX_PAISA) })}</p>
          <div className="sf-prices__sizes-grid">
            {sizeAmounts.map(({ size, result }) => (
              <Field key={size.cylinderTypeId} label={size.label} error={sizeError(size.cylinderTypeId, result)}>
                <MoneyInput
                  allowZero
                  min={0}
                  max={PRICE_MAX_PAISA}
                  valuePaisa={drafts.sizes[size.cylinderTypeId]?.paisa ?? null}
                  onChange={(paisa) => setSize(size.cylinderTypeId, { paisa })}
                  onInput={(event) => setSize(size.cylinderTypeId, { text: event.currentTarget.value })}
                  disabled={archived || busy}
                />
              </Field>
            ))}
          </div>
        </fieldset>
      ) : null}

      <section className="sf-prices__example" aria-live="polite">
        <h3 className="sf-prices__example-title">{t('drawer.exampleTitle')}</h3>
        {example ? <p>{example}</p> : <p className="sf-prices__muted">{t('drawer.example.needsBase')}</p>}
      </section>
      <p className="sf-prices__muted">{t('drawer.note')}</p>

      {topError ? (
        <InlineAlert
          tone="danger"
          live
          className="sf-prices__drawer-alert"
          action={
            topError.reload ? (
              <Button size="sm" onClick={reload}>
                {t('drawer.reload')}
              </Button>
            ) : undefined
          }
        >
          {topError.text}
        </InlineAlert>
      ) : null}
    </Drawer>
  );
}

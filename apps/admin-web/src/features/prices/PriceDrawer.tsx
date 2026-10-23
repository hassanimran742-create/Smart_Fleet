import { useEffect, useRef, useState } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import type { PriceGridDto, PriceGridPrice, PriceGridZone } from '@smartfleet/shared-types';
import { formatPkDay } from '@smartfleet/shared-utils';
import { PRICE_MAX_PAISA, type PutPriceInput } from '@smartfleet/shared-validation';
import { useTranslation } from 'react-i18next';
import { fieldMessage, messageFor, toApiError, type ApiError } from '../../api/errors';
import { useCloseDrawer } from '../../app/drawer';
import { formatRs } from '../../i18n/format';
import {
  AddMore,
  Button,
  Drawer,
  ErrorState,
  Field,
  flashRow,
  InlineAlert,
  MoneyInput,
  Select,
  Skeleton,
  SkeletonText,
  StatusChip,
  useConfirm,
  useToast,
} from '../../ui';
import { PRICE_DRAWER_POLL_MS, PRICES_FLASH, removePrice, useApplyPriceRow, usePriceGrid, useSavePrice } from './api';
import { priceExample } from './example';
import './prices.css';

const route = getRouteApi('/prices/$distributorId/$zoneId');

/** A reason of 5–300 characters for removing a price (API_CONTRACT §7.5). */
const REASON_MIN = 5;
const REASON_MAX = 300;

/**
 * The price drawer (`/prices/$distributorId/$zoneId`, website spec W16): a base per order (Rs 0 allowed)
 * and, behind "+ Add per-cylinder amounts", an amount per full cylinder by size (blank is Rs 0), each up
 * to Rs 100,000, with "Copy from…" another zone and a live example. Saving answers the zone's row,
 * which goes into the grid at once (G03-04).
 */
export function PriceDrawer() {
  const { t } = useTranslation(['prices', 'nav']);
  const { distributorId, zoneId } = route.useParams();
  const close = useCloseDrawer();
  const grid = usePriceGrid(distributorId, { pollMs: PRICE_DRAWER_POLL_MS });
  const row = grid.data?.zones.find((candidate) => candidate.zone.id === zoneId);

  if (grid.isPending) {
    return (
      <Drawer title={<Skeleton width="14rem" />} onClose={close}>
        <SkeletonText lines={6} />
      </Drawer>
    );
  }
  if (!grid.data) {
    return (
      <Drawer title={t('nav:pages.price')} onClose={close}>
        <ErrorState error={grid.error} onRetry={() => void grid.refetch()} retrying={grid.isFetching} title={t('index.loadFailed')} />
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

function draftsFromPrice(grid: PriceGridDto, price: PriceGridPrice | null): Drafts {
  const sizes: Record<string, AmountDraft> = {};
  for (const size of grid.sizes) {
    const amount = price?.sizes.find((entry) => entry.cylinderTypeId === size.cylinderTypeId)?.perCylinderPaisa;
    sizes[size.cylinderTypeId] = draftOf(amount, true);
  }
  return { base: draftOf(price?.basePaisa, false), sizes };
}

/** Any size has an amount above Rs 0. */
function hasSizeAmounts(drafts: Drafts): boolean {
  return Object.values(drafts.sizes).some((draft) => draft.text.trim() !== '' && draft.paisa !== '0');
}

/** The amount of a box, or the reason it isn't one. Blank is Rs 0 for a size; the base is required. */
function amountOf(draft: AmountDraft, required: boolean): { ok: true; paisa: bigint | null } | { ok: false; code: 'REQUIRED' | 'PRICE_INVALID' } {
  if (draft.text.trim() === '') return required ? { ok: false, code: 'REQUIRED' } : { ok: true, paisa: null };
  if (draft.paisa === null || !/^\d+$/.test(draft.paisa)) return { ok: false, code: 'PRICE_INVALID' };
  const paisa = BigInt(draft.paisa);
  return paisa > BigInt(PRICE_MAX_PAISA) ? { ok: false, code: 'PRICE_INVALID' } : { ok: true, paisa };
}

function PriceForm({ grid, row, onClose, reloadGrid }: { grid: PriceGridDto; row: PriceGridZone; onClose: () => void; reloadGrid: () => void }) {
  const { t } = useTranslation(['prices', 'validation']);
  const toast = useToast();
  const confirm = useConfirm();
  const save = useSavePrice(grid.distributor.id, row.zone.id);
  const applyRow = useApplyPriceRow(grid.distributor.id);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [initial, setInitial] = useState(() => draftsFromPrice(grid, row.price));
  const [drafts, setDrafts] = useState(initial);
  const [sizesOpen, setSizesOpen] = useState(() => hasSizeAmounts(initial));
  const [copiedFrom, setCopiedFrom] = useState('');
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

  const baseError =
    serverErrors.basePaisa ?? (submitted && !base.ok ? (base.code === 'REQUIRED' ? t('drawer.baseMissing') : t('validation:PRICE_INVALID')) : undefined);
  const sizeError = (id: string, result: ReturnType<typeof amountOf>) =>
    serverErrors[`size:${id}`] ?? (submitted && !result.ok ? t('validation:PRICE_INVALID') : undefined);

  // Other zones of this distributor that have a price: "Copy from…" fills the boxes from one of them.
  const copyable = grid.zones.filter((other) => other.zone.id !== row.zone.id && other.price !== null);

  const reload = () => {
    const next = draftsFromPrice(grid, row.price);
    setInitial(next);
    setDrafts(next);
    setSizesOpen(hasSizeAmounts(next));
    setCopiedFrom('');
    setBaseline(row.price?.updatedAt ?? null);
    setServerErrors({});
    setTopError(null);
  };

  // Nothing typed yet: follow a price someone else saved meanwhile. With edits, the notice offers "Reload".
  const rowVersion = row.price?.updatedAt ?? null;
  useEffect(() => {
    if (rowVersion === baseline || dirty) return;
    const next = draftsFromPrice(grid, row.price);
    setInitial(next);
    setDrafts(next);
    if (hasSizeAmounts(next)) setSizesOpen(true);
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

  const copyFrom = (zoneId: string) => {
    setCopiedFrom(zoneId);
    const source = copyable.find((other) => other.zone.id === zoneId);
    if (!source?.price) return;
    const next = draftsFromPrice(grid, source.price);
    setDrafts(next);
    if (hasSizeAmounts(next)) setSizesOpen(true);
    setServerErrors({});
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

  // "Save price" stays pressable: with a gap, the box that needs fixing says so and gets the focus.
  const onSave = async () => {
    setSubmitted(true);
    if (!base.ok || base.paisa === null || !valid) {
      const badSize = sizeAmounts.find((entry) => !entry.result.ok);
      if (badSize) setSizesOpen(true);
      window.requestAnimationFrame(() => {
        const target = !base.ok ? '[name="basePaisa"]' : badSize ? `[name="size-${badSize.size.cylinderTypeId}"]` : null;
        if (target) bodyRef.current?.querySelector<HTMLElement>(target)?.focus();
      });
      return;
    }
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
      flashRow(PRICES_FLASH, row.zone.id);
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
      reason: { label: t('drawer.removeReason'), required: true, minLength: REASON_MIN, maxLength: REASON_MAX },
      action: async ({ reason }) => {
        // A price that was already gone answers the same row (X-Already-Applied): it reads as removed.
        await applyRow(await removePrice(grid.distributor.id, row.zone.id, reason ?? ''));
      },
    });
    if (!ok) return;
    toast.success(t('drawer.removed', { zone }));
    flashRow(PRICES_FLASH, row.zone.id);
    onClose();
  };

  const busy = save.isPending;
  const locked = archived || busy;
  const updatedBy = row.price?.updatedBy?.name;
  const updatedAt = row.price ? formatPkDay(row.price.updatedAt, { weekday: false }) : null;
  const subtitle = updatedAt
    ? updatedBy
      ? t('drawer.subtitleChanged', { city: row.zone.cityName, date: updatedAt, name: updatedBy })
      : t('drawer.subtitleChangedNoName', { city: row.zone.cityName, date: updatedAt })
    : row.zone.cityName;

  return (
    <Drawer
      title={t('drawer.title', { distributor, zone })}
      subtitle={subtitle}
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
      <div ref={bodyRef}>
        {archived ? (
          <InlineAlert tone="info" className="sf-prices__drawer-alert">
            {t('drawer.archived')}
          </InlineAlert>
        ) : null}

        {copyable.length > 0 && !archived ? (
          <Field label={t('drawer.copyFrom')} labelHidden className="sf-prices__copy">
            <Select
              value={copiedFrom}
              placeholder={t('drawer.copyFrom')}
              options={copyable.map((other) => ({
                value: other.zone.id,
                label: t('drawer.copyOption', {
                  zone: other.zone.name,
                  summary:
                    other.price && other.price.sizes.some((entry) => entry.perCylinderPaisa !== '0')
                      ? t('drawer.copyWithSizes', { base: formatRs(other.price.basePaisa) })
                      : formatRs(other.price?.basePaisa ?? null),
                }),
              }))}
              onChange={(event) => copyFrom(event.target.value)}
              disabled={busy}
            />
          </Field>
        ) : null}

        <Field label={t('drawer.base')} error={baseError}>
          <MoneyInput
            name="basePaisa"
            data-autofocus
            allowZero
            min={0}
            max={PRICE_MAX_PAISA}
            valuePaisa={drafts.base.paisa}
            onChange={(paisa) => setBase({ paisa })}
            onInput={(event) => setBase({ text: event.currentTarget.value })}
            disabled={locked}
          />
        </Field>

        {grid.sizes.length > 0 ? (
          <AddMore label={t('drawer.addSizes')} open={sizesOpen} onOpenChange={setSizesOpen}>
            <fieldset className="sf-prices__sizes" disabled={locked}>
              <legend className="sf-prices__sizes-title">{t('drawer.perCylinderTitle')}</legend>
              <div className="sf-prices__sizes-grid">
                {sizeAmounts.map(({ size, result }) => (
                  <Field key={size.cylinderTypeId} label={size.label} error={sizeError(size.cylinderTypeId, result)}>
                    <MoneyInput
                      name={`size-${size.cylinderTypeId}`}
                      allowZero
                      min={0}
                      max={PRICE_MAX_PAISA}
                      valuePaisa={drafts.sizes[size.cylinderTypeId]?.paisa ?? null}
                      onChange={(paisa) => setSize(size.cylinderTypeId, { paisa })}
                      onInput={(event) => setSize(size.cylinderTypeId, { text: event.currentTarget.value })}
                      disabled={locked}
                    />
                  </Field>
                ))}
              </div>
              <p className="sf-prices__muted sf-prices__sizes-hint">{t('drawer.perCylinderHint')}</p>
            </fieldset>
          </AddMore>
        ) : null}

        {example ? (
          <section className="sf-prices__example" aria-live="polite">
            <h3 className="sf-prices__example-title">{t('drawer.exampleTitle')}</h3>
            <p>{example}</p>
          </section>
        ) : null}
        <p className="sf-prices__muted sf-prices__note">{t('drawer.note')}</p>

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
      </div>
    </Drawer>
  );
}

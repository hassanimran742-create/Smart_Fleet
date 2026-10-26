import { useEffect, useRef, useState } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import type { PriceGridDto, PriceGridPrice, PriceGridZone } from '@smartfleet/shared-types';
import { formatPkDay } from '@smartfleet/shared-utils';
import { PRICE_MAX_PAISA, type PutPriceInput } from '@smartfleet/shared-validation';
import { useTranslation } from 'react-i18next';
import { fieldMessage, messageFor, toApiError, type ApiError } from '../../api/errors';
import { useCloseDrawer } from '../../app/drawer';
import {
  Button,
  Drawer,
  ErrorState,
  Field,
  flashRow,
  InlineAlert,
  MoneyInput,
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
 * The price drawer (`/prices/$distributorId/$zoneId`, website spec W16): one box, "Delivery cost per
 * order" (Rs 0 to Rs 100,000), the same for any order whatever cylinders it holds (ADR-08), with a
 * one-line example. Saving answers the zone's row, which goes into the grid at once (G03-04).
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

/** The money box: what the person typed (to tell blank from not-a-number) and its paisa value. */
interface AmountDraft {
  text: string;
  paisa: string | null;
}

function draftFromPrice(price: PriceGridPrice | null): AmountDraft {
  const paisa = price?.basePaisa;
  return paisa === undefined ? { text: '', paisa: null } : { text: paisa, paisa };
}

/** What the box says, ignoring how it was typed: blank, or the paisa value (null when not an amount). */
function signature(draft: AmountDraft): string {
  return JSON.stringify(draft.text.trim() === '' ? '' : draft.paisa);
}

/** The amount in the box, or the reason it isn't one: the cost is required, and Rs 0 is an amount. */
function amountOf(draft: AmountDraft): { ok: true; paisa: bigint } | { ok: false; code: 'REQUIRED' | 'PRICE_INVALID' } {
  if (draft.text.trim() === '') return { ok: false, code: 'REQUIRED' };
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
  const [initial, setInitial] = useState(() => draftFromPrice(row.price));
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(row.price?.updatedAt ?? null);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState<{ text: string; reload?: boolean } | null>(null);

  const distributor = grid.distributor.businessName;
  const zone = row.zone.name;
  const archived = !row.zone.isActive;
  const dirty = signature(draft) !== signature(initial);
  // Someone else saved or removed this price while the drawer was open.
  const changedElsewhere = (row.price?.updatedAt ?? null) !== baseline;

  const cost = amountOf(draft);
  const example = priceExample(cost.ok ? cost.paisa : null);

  const costError =
    serverErrors.basePaisa ?? (submitted && !cost.ok ? (cost.code === 'REQUIRED' ? t('drawer.costMissing') : t('validation:PRICE_INVALID')) : undefined);

  const reload = () => {
    const next = draftFromPrice(row.price);
    setInitial(next);
    setDraft(next);
    setBaseline(row.price?.updatedAt ?? null);
    setServerErrors({});
    setTopError(null);
  };

  // Nothing typed yet: follow a price someone else saved meanwhile. With edits, the notice offers "Reload".
  const rowVersion = row.price?.updatedAt ?? null;
  useEffect(() => {
    if (rowVersion === baseline || dirty) return;
    const next = draftFromPrice(row.price);
    setInitial(next);
    setDraft(next);
    setBaseline(rowVersion);
  }, [rowVersion, baseline, dirty, row]);

  const setCost = (patch: Partial<AmountDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setServerErrors(({ basePaisa: _drop, ...rest }) => rest);
  };

  const showError = (error: ApiError) => {
    if (error.isNetwork) {
      setTopError({ text: t('drawer.offline') });
      return;
    }
    if (error.fields.length > 0) {
      const byField: Record<string, string> = {};
      for (const field of error.fields) {
        if (field.path === 'basePaisa') byField.basePaisa = fieldMessage(field);
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

  // "Save price" stays pressable: with a gap, the box says so and gets the focus.
  const onSave = async () => {
    setSubmitted(true);
    if (!cost.ok) {
      window.requestAnimationFrame(() => bodyRef.current?.querySelector<HTMLElement>('[name="basePaisa"]')?.focus());
      return;
    }
    const body: PutPriceInput = { basePaisa: cost.paisa.toString() };
    setTopError(null);
    setServerErrors({});
    try {
      const saved = await save.mutateAsync(body);
      await applyRow(saved);
      toast.success(t('drawer.saved', { zone }));
      flashRow(PRICES_FLASH, row.zone.id);
      onClose();
    } catch (error) {
      showError(toApiError(error));
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

        <Field label={t('drawer.cost')} error={costError}>
          <MoneyInput
            name="basePaisa"
            data-autofocus
            allowZero
            min={0}
            max={PRICE_MAX_PAISA}
            valuePaisa={draft.paisa}
            onChange={(paisa) => setCost({ paisa })}
            onInput={(event) => setCost({ text: event.currentTarget.value })}
            disabled={locked}
          />
        </Field>

        {example ? (
          <p className="sf-prices__example" aria-live="polite">
            {example}
          </p>
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

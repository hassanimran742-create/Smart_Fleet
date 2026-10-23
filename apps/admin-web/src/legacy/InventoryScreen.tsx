import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Boxes } from 'lucide-react';
import type { DistributorDto } from '@smartfleet/shared-types';
import { BULK_REGISTER_MAX } from '@smartfleet/shared-validation';
import { api } from '../api/client';
import { messageFor } from '../api/errors';
import { useModule } from '../app/modules';
import { Modal } from '../components/Modal';
import { formatDateTime, formatNumber, formatRs } from '../i18n/format';
import {
  actionInWords,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  InlineAlert,
  Select,
  Table,
  Tabs,
  TextInput,
  useConfirm,
  type TableColumn,
} from '../ui';
import { sizeLabelOf, useLegacyT } from './i18n';
import './legacy.css';

/**
 * Legacy inventory screen (Cylinders & labels → Cylinder stock; and `/accessories` while that module is
 * on). Light pass (website spec W47): it opens on "In stores", the stock of every store; the sub-tabs
 * read In stores · On vans · Add stock; sizes read "15 kg", never a size code; counts are plain numbers.
 * A registration is at most 500 cylinders and always starts in the store's own distributor's store
 * (G05-12). The accessory tabs and cards show only while `features.accessories` is on (their old words
 * stay until that module is rebuilt).
 */

interface Store { id: string; name: string }
interface CylinderTypeFull { id: string; code: string; name: string; weightKg: string; capacityUnits: number }
interface Accessory {
  id: string; code: string; name: string; category: string; unit: string;
  defaultPricePaisa: string; isActive: boolean;
}
interface AccessoryStockRow {
  id: string;
  storeId: string;
  accessoryId: string;
  quantity: number;
  unitPricePaisa: string | null;
  accessory: Accessory;
}
interface AccessoryMovement {
  id: string;
  createdAt: string;
  delta: number;
  reason: string;
  note: string | null;
  accessory: { name: string };
}
interface ByStoreRow {
  store_id: string;
  store_name: string;
  distributor_id: string;
  distributor_name: string;
  cylinder_type_code: string;
  state: 'FULL' | 'EMPTY';
  count: number;
}

const REASONS = ['RECEIPT', 'SALE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT', 'DAMAGE_LOSS'] as const;
const CATEGORIES = ['PIPE', 'CONNECTOR', 'REGULATOR', 'VALVE', 'BURNER', 'HOSE', 'ADAPTER', 'VAPORISER', 'OTHER'] as const;
type Category = typeof CATEGORIES[number];

type Tab = 'stores' | 'vans' | 'add' | 'catalog';

/** A thrown form check keeps its words; anything from the API is shown by its error code. */
function errMsg(e: unknown): string {
  return e instanceof Error && !('isAxiosError' in e) ? e.message : messageFor(e);
}

/** "TRANSFER_IN" → "Transfer in": a stored code shown as plain words. */
function words(code: string): string {
  return actionInWords(code);
}

/** The cylinder sizes, by code ("15 kg"), for the stock lists that carry only the type's code. */
function useSizeWords(): (code: string) => string {
  const types = useQuery({
    queryKey: ['cylinder-types'],
    queryFn: async () => (await api.get<CylinderTypeFull[]>('/cylinder-types')).data,
  });
  const byCode = useMemo(() => new Map((types.data ?? []).map((type) => [type.code, sizeLabelOf(type)])), [types.data]);
  return (code: string) => byCode.get(code) ?? '';
}

export function InventoryScreen() {
  const lt = useLegacyT();
  const [tab, setTab] = useState<Tab>('stores');
  const accessories = useModule('accessories');
  const accessoriesOn = accessories.enabled;
  const tabs: { id: Tab; label: string }[] = [
    { id: 'stores', label: lt('stock.tabs.stores') },
    { id: 'vans', label: lt('stock.tabs.vans') },
    { id: 'add', label: lt('stock.tabs.add') },
    ...(accessoriesOn ? [{ id: 'catalog' as const, label: lt('stock.tabs.catalog') }] : []),
  ];
  const current: Tab = tab === 'catalog' && !accessoriesOn ? 'stores' : tab;

  return (
    <div className="sf-legacy-page">
      <Tabs<Tab> label={lt('stock.title')} items={tabs} value={current} onChange={setTab} className="sf-legacy__subtabs" />
      {current === 'stores' && <ViewTab accessoriesOn={accessoriesOn} />}
      {current === 'vans' && <VehiclesInventoryTab />}
      {current === 'add' && <AddTab accessoriesOn={accessoriesOn} />}
      {current === 'catalog' && accessoriesOn && <CatalogTab />}
    </div>
  );
}

interface VehLoad {
  vehicleId: string;
  plateNo: string;
  totalFull: number;
  totalEmpty: number;
  byType: Array<{ cylinderTypeId: string; code: string; name: string; full: number; empty: number }>;
}

interface VanStockRow {
  key: string;
  plateNo: string;
  first: boolean;
  size: string;
  full: number;
  empty: number;
}

/** What is on each van now, by size: plain counts, no chips. */
function VehiclesInventoryTab() {
  const lt = useLegacyT();
  const sizeOf = useSizeWords();
  const query = useQuery<VehLoad[]>({
    queryKey: ['inventory-vehicles-summary'],
    queryFn: async () => (await api.get('/inventory/vehicles-summary')).data,
    refetchInterval: 20000,
  });

  const vehicles = query.data ?? [];
  const fleetFull = vehicles.reduce((s, v) => s + v.totalFull, 0);
  const fleetEmpty = vehicles.reduce((s, v) => s + v.totalEmpty, 0);
  const rows: VanStockRow[] = vehicles.flatMap((v) =>
    v.byType.map((t, i) => ({
      key: `${v.vehicleId}-${t.cylinderTypeId}`,
      plateNo: v.plateNo,
      first: i === 0,
      size: sizeOf(t.code) || t.name,
      full: t.full,
      empty: t.empty,
    })),
  );
  const columns: TableColumn<VanStockRow>[] = [
    { id: 'van', header: lt('stock.columns.van'), cell: (row) => (row.first ? <span className="sf-legacy__strong">{row.plateNo}</span> : null) },
    { id: 'size', header: lt('stock.columns.size'), cell: (row) => row.size },
    { id: 'full', header: lt('stock.columns.full'), align: 'end', cell: (row) => formatNumber(row.full) },
    { id: 'empty', header: lt('stock.columns.empty'), align: 'end', cell: (row) => formatNumber(row.empty) },
  ];

  return (
    <>
      {vehicles.length > 0 ? (
        <p className="sf-legacy__muted">{lt('stock.vansTotal', { full: formatNumber(fleetFull), empty: formatNumber(fleetEmpty) })}</p>
      ) : null}
      <Table<VanStockRow>
        caption={lt('stock.tabs.vans')}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.key}
        state={query.isPending ? 'loading' : query.isError && !query.data ? 'error' : 'ready'}
        empty={<EmptyState compact icon={Boxes} title={lt('stock.vansEmpty')} />}
        error={<ErrorState compact error={query.error} title={lt('stock.loadFailed')} onRetry={() => void query.refetch()} retrying={query.isFetching} />}
      />
    </>
  );
}

function AddTab({ accessoriesOn }: { accessoriesOn: boolean }) {
  const lt = useLegacyT();
  const qc = useQueryClient();
  const stores = useQuery({ queryKey: ['stores'], queryFn: async () => (await api.get<Store[]>('/stores')).data });
  const [storeId, setStoreId] = useState<string>('');

  return (
    <>
      <FilterBar>
        <Field label={lt('stock.store')}>
          <Select
            value={storeId}
            placeholder={lt('stock.pickStore')}
            options={(stores.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
            onChange={(e) => setStoreId(e.target.value)}
          />
        </Field>
      </FilterBar>
      {stores.data && stores.data.length === 0 ? <p className="sf-legacy__muted">{lt('stock.noStores')}</p> : null}

      {storeId && (
        <>
          <AddCylindersCard storeId={storeId} qc={qc} />
          {accessoriesOn && <AddAccessoriesCard storeId={storeId} qc={qc} />}
        </>
      )}
    </>
  );
}

function ViewTab({ accessoriesOn }: { accessoriesOn: boolean }) {
  const lt = useLegacyT();
  const stores = useQuery({ queryKey: ['stores'], queryFn: async () => (await api.get<Store[]>('/stores')).data });
  const [storeId, setStoreId] = useState<string>('');

  return (
    <>
      <FilterBar>
        <Field label={lt('stock.store')} labelHidden>
          <Select
            value={storeId}
            options={[{ value: '', label: lt('stock.allStores') }, ...(stores.data ?? []).map((s) => ({ value: s.id, label: s.name }))]}
            onChange={(e) => setStoreId(e.target.value)}
          />
        </Field>
      </FilterBar>

      {storeId ? (
        <>
          <CylindersAtStore storeId={storeId} />
          {accessoriesOn && <AccessoryStockAtStore storeId={storeId} />}
        </>
      ) : (
        <AllStoresOverview />
      )}
    </>
  );
}

function AddCylindersCard({ storeId, qc }: { storeId: string; qc: QueryClient }) {
  const lt = useLegacyT();
  const distributors = useQuery({ queryKey: ['distributors'], queryFn: async () => (await api.get<DistributorDto[]>('/distributors')).data });
  // A distributor has exactly one store, and new cylinders always start there (ADR-01): only the
  // store's own distributor can register cylinders into it.
  const owners = (distributors.data ?? []).filter((d) => d.store?.id === storeId);
  const types = useQuery({ queryKey: ['cylinder-types'], queryFn: async () => (await api.get<CylinderTypeFull[]>('/cylinder-types')).data });

  const [form, setForm] = useState({ distributorId: '', cylinderTypeId: '', quantity: '' });
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const distributorId = form.distributorId || (owners.length === 1 ? owners[0].id : '');

  const register = useMutation({
    mutationFn: () => {
      const qty = Math.floor(Number(form.quantity));
      if (!distributorId) throw new Error(lt('stock.addCard.distributorMissing'));
      if (!form.cylinderTypeId) throw new Error(lt('stock.addCard.sizeMissing'));
      if (!Number.isFinite(qty) || qty <= 0) throw new Error(lt('stock.addCard.countMissing'));
      if (qty > BULK_REGISTER_MAX) throw new Error(lt('stock.addCard.tooMany', { max: BULK_REGISTER_MAX }));
      return api.post('/cylinders/bulk-register', {
        distributorId,
        cylinderTypeId: form.cylinderTypeId,
        quantity: qty,
        initialCustodyType: 'STORE',
        initialCustodyId: storeId,
      });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['inventory-by-store-all'] });
      qc.invalidateQueries({ queryKey: ['inventory-by-store-filtered'] });
      const count = Array.isArray(r.data) ? r.data.length : 0;
      setResult(lt('stock.addCard.added', { count }));
      setErr(null);
      setForm({ ...form, quantity: '' });
    },
    onError: (e: unknown) => {
      setErr(errMsg(e));
      setResult(null);
    },
  });

  return (
    <section className="sf-legacy-card">
      <h3 className="sf-legacy-card__title">{lt('stock.addCard.title')}</h3>
      <p className="sf-legacy__muted">{lt('stock.addCard.hint')}</p>
      <div className="sf-legacy-form__grid sf-legacy-form__grid--three">
        <Field label={lt('stock.addCard.distributor')}>
          <Select
            value={distributorId}
            placeholder={lt('stock.addCard.pickDistributor')}
            options={owners.map((d) => ({ value: d.id, label: d.businessName }))}
            onChange={(e) => setForm({ ...form, distributorId: e.target.value })}
          />
        </Field>
        <Field label={lt('stock.addCard.size')}>
          <Select
            value={form.cylinderTypeId}
            placeholder={lt('stock.addCard.pickSize')}
            options={(types.data ?? []).map((t) => ({ value: t.id, label: sizeLabelOf(t) }))}
            onChange={(e) => setForm({ ...form, cylinderTypeId: e.target.value })}
          />
        </Field>
        <Field label={lt('stock.addCard.count')} hint={lt('stock.addCard.max', { max: BULK_REGISTER_MAX })}>
          <TextInput
            type="number"
            min={1}
            max={BULK_REGISTER_MAX}
            inputMode="numeric"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
          />
        </Field>
      </div>
      {distributors.data && owners.length === 0 ? <p className="sf-legacy__muted">{lt('stock.addCard.noOwner')}</p> : null}
      {err ? (
        <InlineAlert tone="danger" live>
          {err}
        </InlineAlert>
      ) : null}
      {result ? (
        <InlineAlert tone="success" live>
          {result}
        </InlineAlert>
      ) : null}
      <div>
        <Button variant="primary" onClick={() => register.mutate()} loading={register.isPending}>
          {lt('stock.addCard.submit')}
        </Button>
      </div>
    </section>
  );
}

function AddAccessoriesCard({ storeId, qc }: { storeId: string; qc: QueryClient }) {
  const accessories = useQuery({
    queryKey: ['accessories'],
    queryFn: async () => (await api.get<Accessory[]>('/accessories')).data,
  });

  const [form, setForm] = useState({
    accessoryId: '',
    delta: '0',
    reason: 'RECEIPT' as typeof REASONS[number],
    note: '',
    unitPriceRs: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const adjust = useMutation({
    mutationFn: () => {
      const delta = Number(form.delta);
      if (!form.accessoryId || !Number.isFinite(delta) || delta === 0) {
        throw new Error('Pick an accessory and enter a non-zero quantity (+ to add, - to remove)');
      }
      return api.post('/accessories/stock/adjust', {
        storeId,
        accessoryId: form.accessoryId,
        delta,
        reason: form.reason,
        note: form.note || undefined,
        unitPricePaisa: form.unitPriceRs ? Math.round(Number(form.unitPriceRs) * 100) : undefined,
      });
    },
    onSuccess: () => {
      const n = Number(form.delta);
      qc.invalidateQueries({ queryKey: ['accessory-stock', storeId] });
      qc.invalidateQueries({ queryKey: ['accessory-movements', storeId] });
      setForm({ ...form, delta: '0', note: '', unitPriceRs: '' });
      setErr(null);
      setResult(`Stock updated (${n > 0 ? '+' : ''}${n}).`);
    },
    onError: (e: unknown) => { setErr(errMsg(e)); setResult(null); },
  });

  if ((accessories.data ?? []).length === 0) {
    return (
      <div className="card legacy-old">
        <h3>Add accessory stock</h3>
        <p className="muted">No accessory types defined yet. Switch to the <strong>Accessory catalog</strong> tab to add some first.</p>
      </div>
    );
  }

  return (
    <div className="card legacy-old">
      <h3>Add or adjust accessory stock</h3>
      <p className="muted">
        Positive numbers add stock (e.g. receiving a shipment). Negative numbers reduce stock (sales, damage, transfer out).
      </p>
      <div className="flex" style={{ gap: 12 }}>
        <div style={{ flex: 2 }}>
          <label>Accessory *</label>
          <select value={form.accessoryId} onChange={(e) => setForm({ ...form, accessoryId: e.target.value })}>
            <option value="">Pick an accessory</option>
            {(accessories.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.code}) · {a.unit}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label>Quantity delta * (+ / −)</label>
          <input type="number" value={form.delta} onChange={(e) => setForm({ ...form, delta: e.target.value })} placeholder="+10 or -3" />
        </div>
        <div style={{ flex: 1 }}>
          <label>Reason</label>
          <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value as any })}>
            {REASONS.map((r) => <option key={r} value={r}>{words(r)}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label>Unit price PKR (override)</label>
          <input type="number" value={form.unitPriceRs} onChange={(e) => setForm({ ...form, unitPriceRs: e.target.value })} placeholder="optional" />
        </div>
      </div>
      <label>Note</label>
      <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. invoice #4521 from supplier X" />
      {err && <p style={{ color: 'var(--danger-fg)' }}>{err}</p>}
      {result && <p style={{ color: 'var(--success-fg)' }}>{result}</p>}
      <button className="primary" style={{ marginTop: 12 }} onClick={() => adjust.mutate()}>Apply</button>
    </div>
  );
}


interface StockRow {
  key: string;
  distributor: string;
  first: boolean;
  size: string;
  full: number;
  empty: number;
}

/** Store rows by distributor and size, with full and empty counts (the API sends one row per state). */
function stockRows(rows: readonly ByStoreRow[], sizeOf: (code: string) => string): StockRow[] {
  const pivot = new Map<string, Map<string, { full: number; empty: number }>>();
  for (const r of rows) {
    const byType = pivot.get(r.distributor_name) ?? new Map<string, { full: number; empty: number }>();
    const counts = byType.get(r.cylinder_type_code) ?? { full: 0, empty: 0 };
    counts[r.state === 'FULL' ? 'full' : 'empty'] += r.count;
    byType.set(r.cylinder_type_code, counts);
    pivot.set(r.distributor_name, byType);
  }
  const out: StockRow[] = [];
  for (const [distributor, byType] of pivot) {
    let first = true;
    for (const [code, counts] of byType) {
      out.push({ key: `${distributor}-${code}`, distributor, first, size: sizeOf(code) || code, full: counts.full, empty: counts.empty });
      first = false;
    }
  }
  return out;
}

function StockTable({ rows, caption }: { rows: StockRow[]; caption: string }) {
  const lt = useLegacyT();
  const columns: TableColumn<StockRow>[] = [
    { id: 'distributor', header: lt('stock.columns.distributor'), cell: (row) => (row.first ? row.distributor : null) },
    { id: 'size', header: lt('stock.columns.size'), cell: (row) => row.size },
    { id: 'full', header: lt('stock.columns.full'), align: 'end', cell: (row) => formatNumber(row.full) },
    { id: 'empty', header: lt('stock.columns.empty'), align: 'end', cell: (row) => formatNumber(row.empty) },
  ];
  return (
    <Table<StockRow>
      caption={caption}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.key}
      state="ready"
      empty={<EmptyState compact icon={Boxes} title={lt('stock.storeEmpty')} />}
    />
  );
}

function CylindersAtStore({ storeId }: { storeId: string }) {
  const lt = useLegacyT();
  const sizeOf = useSizeWords();
  const cylinderInv = useQuery({
    queryKey: ['inventory-by-store-filtered', storeId],
    queryFn: async () => {
      const all = (await api.get<ByStoreRow[]>('/inventory/by-store')).data;
      return all.filter((r) => r.store_id === storeId);
    },
    refetchInterval: 30000,
  });
  if (cylinderInv.isError && !cylinderInv.data) {
    return (
      <ErrorState
        compact
        error={cylinderInv.error}
        title={lt('stock.loadFailed')}
        onRetry={() => void cylinderInv.refetch()}
        retrying={cylinderInv.isFetching}
      />
    );
  }
  return <StockTable rows={stockRows(cylinderInv.data ?? [], sizeOf)} caption={lt('stock.tabs.stores')} />;
}

function AccessoryStockAtStore({ storeId }: { storeId: string }) {
  const stock = useQuery({
    queryKey: ['accessory-stock', storeId],
    queryFn: async () => (await api.get<AccessoryStockRow[]>(`/accessories/stock/store/${storeId}`)).data,
    refetchInterval: 30000,
  });
  const movements = useQuery({
    queryKey: ['accessory-movements', storeId],
    queryFn: async () => (await api.get<AccessoryMovement[]>(`/accessories/movements/store/${storeId}`)).data,
  });

  return (
    <div className="legacy-old">
      <div className="card">
        <h3>Accessory stock at this store</h3>
        {(stock.data ?? []).length === 0 && <p className="muted">No accessory stock yet at this store.</p>}
        {(stock.data ?? []).length > 0 && (
          <table>
            <thead><tr><th>Code</th><th>Name</th><th>Category</th><th>Unit</th><th>Quantity</th><th>Unit price</th></tr></thead>
            <tbody>
              {(stock.data ?? []).map((r) => (
                <tr key={r.id}>
                  <td>{r.accessory.code}</td>
                  <td>{r.accessory.name}</td>
                  <td>{words(r.accessory.category)}</td>
                  <td>{r.accessory.unit}</td>
                  <td><strong>{r.quantity}</strong></td>
                  <td>
                    {r.unitPricePaisa != null
                      ? formatRs(r.unitPricePaisa)
                      : `${formatRs(r.accessory.defaultPricePaisa)} (default)`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Recent accessory movements</h3>
        {(movements.data ?? []).length === 0 && <p className="muted">No movements yet.</p>}
        {(movements.data ?? []).length > 0 && (
          <table>
            <thead><tr><th>When</th><th>Accessory</th><th>Change</th><th>Reason</th><th>Note</th></tr></thead>
            <tbody>
              {(movements.data ?? []).slice(0, 50).map((m: AccessoryMovement) => (
                <tr key={m.id}>
                  <td>{formatDateTime(m.createdAt)}</td>
                  <td>{m.accessory.name}</td>
                  <td style={{ color: m.delta > 0 ? 'var(--success-fg)' : 'var(--danger-fg)' }}>{m.delta > 0 ? '+' : ''}{m.delta}</td>
                  <td>{words(m.reason)}</td>
                  <td>{m.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}


/** "In stores": every store's stock, one table per store. */
function AllStoresOverview() {
  const lt = useLegacyT();
  const sizeOf = useSizeWords();
  const query = useQuery({
    queryKey: ['inventory-by-store-all'],
    queryFn: async () => (await api.get<ByStoreRow[]>('/inventory/by-store')).data,
    refetchInterval: 30000,
  });
  if (query.isError && !query.data) {
    return <ErrorState compact error={query.error} title={lt('stock.loadFailed')} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  }
  if (query.isPending) {
    return (
      <Table<StockRow>
        caption={lt('stock.tabs.stores')}
        columns={[]}
        rows={undefined}
        rowKey={(row) => row.key}
        state="loading"
        empty={null}
      />
    );
  }
  const grouped = new Map<string, ByStoreRow[]>();
  for (const r of query.data ?? []) grouped.set(r.store_name, [...(grouped.get(r.store_name) ?? []), r]);
  if (grouped.size === 0) return <EmptyState icon={Boxes} title={lt('stock.allEmpty')} />;
  return (
    <>
      {[...grouped.entries()].map(([store, rows]) => (
        <section key={store} className="sf-legacy-stock">
          <h3 className="sf-legacy-stock__store">{store}</h3>
          <StockTable rows={stockRows(rows, sizeOf)} caption={store} />
        </section>
      ))}
    </>
  );
}

function CatalogTab() {
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const { data } = useQuery({
    queryKey: ['accessories', showArchived],
    queryFn: async () => (await api.get<Accessory[]>(`/accessories${showArchived ? '?includeInactive=true' : ''}`)).data,
  });

  const [form, setForm] = useState({ code: '', name: '', category: 'PIPE' as Category, unit: 'piece', defaultPriceRs: '0' });
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Accessory | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; category: string; unit: string; defaultPriceRs: string }>({
    name: '',
    category: 'PIPE',
    unit: 'piece',
    defaultPriceRs: '0',
  });
  const [editErr, setEditErr] = useState<string | null>(null);
  const confirm = useConfirm();

  const create = useMutation({
    mutationFn: () => {
      if (!form.code.trim()) throw new Error('Code is required');
      if (!form.name.trim()) throw new Error('Name is required');
      if (!form.unit.trim()) throw new Error('Unit is required');
      return api.post('/accessories', {
        ...form,
        defaultPricePaisa: Math.round(Number(form.defaultPriceRs || '0') * 100),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accessories'] });
      setForm({ code: '', name: '', category: 'PIPE', unit: 'piece', defaultPriceRs: '0' });
      setCreateErr(null);
    },
    onError: (e: unknown) => setCreateErr(errMsg(e)),
  });

  const update = useMutation({
    mutationFn: () =>
      api.patch(`/accessories/${editing!.id}`, {
        name: editForm.name,
        category: editForm.category,
        unit: editForm.unit,
        defaultPricePaisa: Math.round(Number(editForm.defaultPriceRs || '0') * 100),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accessories'] });
      setEditing(null);
      setEditErr(null);
    },
    onError: (e: unknown) => setEditErr(errMsg(e)),
  });

  async function archiveAccessory(a: Accessory) {
    const { ok } = await confirm({
      title: `Archive ${a.name}?`,
      body: 'It is hidden from new stock changes. Its history stays.',
      tone: 'danger',
      confirmLabel: `Archive ${a.name}`,
      action: () => api.delete(`/accessories/${a.id}`),
    });
    if (ok) void qc.invalidateQueries({ queryKey: ['accessories'] });
  }
  const reactivate = useMutation({
    mutationFn: (id: string) => api.patch(`/accessories/${id}/reactivate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accessories'] }),
  });

  function openEdit(a: Accessory) {
    setEditing(a);
    setEditForm({
      name: a.name,
      category: a.category,
      unit: a.unit,
      defaultPriceRs: String(Number(a.defaultPricePaisa) / 100),
    });
  }

  return (
    <div className="legacy-old">
      <div className="flex" style={{ justifyContent: 'space-between' }}>
        <p className="muted" style={{ marginTop: 0 }}>
          Define the types of accessories (pipes, connectors, regulators, etc.) sold or installed alongside cylinders.
          Stock per store is managed on the Add / View tabs.
        </p>
        <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      <div className="card">
        <h3>Add accessory type</h3>
        <div className="flex" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Code *</label>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="For example PIPE-HALF-INCH" />
          </div>
          <div style={{ flex: 2 }}>
            <label>Name *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="For example 1/2 inch gas pipe" />
          </div>
        </div>
        <div className="flex" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Category</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Category })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{words(c)}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Unit</label>
            <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
              {['piece', 'meter', 'foot', 'kg', 'box', 'set'].map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Default price per unit (Rs)</label>
            <input type="number" value={form.defaultPriceRs} onChange={(e) => setForm({ ...form, defaultPriceRs: e.target.value })} />
          </div>
        </div>
        {createErr && <p style={{ color: 'var(--danger-fg)' }}>{createErr}</p>}
        <button className="primary" style={{ marginTop: 12 }} onClick={() => create.mutate()}>Add accessory type</button>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr><th>Code</th><th>Name</th><th>Category</th><th>Unit</th><th>Default price</th><th>Status</th><th aria-label="Actions"></th></tr>
          </thead>
          <tbody>
            {(data ?? []).map((a) => (
              <tr key={a.id} style={{ opacity: a.isActive ? 1 : 0.5 }}>
                <td>{a.code}</td>
                <td>{a.name}</td>
                <td>{words(a.category)}</td>
                <td>{a.unit}</td>
                <td>{formatRs(a.defaultPricePaisa)}</td>
                <td>{a.isActive ? <Chip tone="success">In use</Chip> : <Chip tone="neutral">Archived</Chip>}</td>
                <td>
                  <button onClick={() => openEdit(a)}>Edit</button>{' '}
                  {a.isActive ? (
                    <button style={{ color: 'var(--danger-fg)' }} onClick={() => void archiveAccessory(a)}>Archive</button>
                  ) : (
                    <button onClick={() => reactivate.mutate(a.id)}>Reactivate</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal title="Edit accessory" open={!!editing} onClose={() => setEditing(null)}>
        {editing && (
          <>
            <label>Name</label>
            <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            <label>Category</label>
            <select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{words(c)}</option>)}
            </select>
            <label>Unit</label>
            <select value={editForm.unit} onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })}>
              {['piece', 'meter', 'foot', 'kg', 'box', 'set'].map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <label>Default price per unit (Rs)</label>
            <input type="number" value={editForm.defaultPriceRs} onChange={(e) => setEditForm({ ...editForm, defaultPriceRs: e.target.value })} />
            {editErr && <p style={{ color: 'var(--danger-fg)' }}>{editErr}</p>}
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button onClick={() => setEditing(null)}>Go back</button>{' '}
              <button className="primary" onClick={() => update.mutate()}>Save</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

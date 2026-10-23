import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { QRCodeCanvas } from 'qrcode.react';
import { FileDown, Minus, Plus, Printer } from 'lucide-react';
import type { DistributorDto } from '@smartfleet/shared-types';
import { BULK_REGISTER_MAX } from '@smartfleet/shared-validation';
import { api } from '../api/client';
import { messageFor } from '../api/errors';
import { formatNumber } from '../i18n/format';
import { Button, Field, IconButton, InlineAlert, Select, Table, TextInput, type TableColumn } from '../ui';
import { sizeLabelOf, useLegacyT } from './i18n';
import './legacy.css';

interface CylinderType {
  id: string;
  code: string;
  name: string;
  weightKg: string;
}
interface GeneratedCylinder {
  id: string;
  serial: string;
  qrCode: string;
  cylinderTypeId: string;
  distributorId: string;
}

interface Batch {
  key: number;
  cylinderTypeId: string;
  size: string;
  quantity: number;
}

type Label = GeneratedCylinder & { size: string; distributorName: string };

/**
 * QR labels (Cylinders & labels → QR labels). Light pass (website spec W47): three steps, "1
 * Distributor · 2 What to print · 3 Print"; batches go on a print list (size and a − / + count, up to
 * 500 each); "Add 12 cylinders" registers them and shows their labels to print or export. Every new
 * cylinder starts in the distributor's one store (API_CONTRACT §7.2 bulk-register, ADR-01), so there is
 * no store picker: the store is shown, and sent as the first holder (G05-12).
 */
export function QrGeneratorScreen() {
  const lt = useLegacyT();
  const distributors = useQuery({ queryKey: ['distributors'], queryFn: async () => (await api.get<DistributorDto[]>('/distributors')).data });
  const types = useQuery({ queryKey: ['cylinder-types'], queryFn: async () => (await api.get<CylinderType[]>('/cylinder-types')).data });

  const [distributorId, setDistributorId] = useState('');
  const [batches, setBatches] = useState<Batch[]>([]);
  const [typeId, setTypeId] = useState('');
  const [quantity, setQuantity] = useState('10');
  const [batchError, setBatchError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<Label[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const distributor = (distributors.data ?? []).find((d) => d.id === distributorId) ?? null;
  const store = distributor?.store ?? null;
  const totalQueued = batches.reduce((sum, b) => sum + b.quantity, 0);

  const step = (delta: number) => {
    const next = Math.min(BULK_REGISTER_MAX, Math.max(1, (Math.floor(Number(quantity)) || 0) + delta));
    setQuantity(String(next));
  };

  function addBatch() {
    const qty = Number(quantity);
    const type = types.data?.find((t) => t.id === typeId);
    if (!type) {
      setBatchError(lt('labels.sizeMissing'));
      return;
    }
    if (!Number.isInteger(qty) || qty <= 0 || qty > BULK_REGISTER_MAX) {
      setBatchError(lt('labels.max', { max: BULK_REGISTER_MAX }));
      return;
    }
    setBatchError(null);
    setBatches((list) => [...list, { key: Date.now(), cylinderTypeId: type.id, size: sizeLabelOf(type), quantity: qty }]);
    setTypeId('');
    setQuantity('10');
  }

  const generate = useMutation({
    mutationFn: async () => {
      if (!distributor || !store) throw new Error(lt('labels.noStore', { name: distributor?.businessName ?? '' }));
      const out: Label[] = [];
      for (const b of batches) {
        const res = await api.post<GeneratedCylinder[]>('/cylinders/bulk-register', {
          distributorId: distributor.id,
          cylinderTypeId: b.cylinderTypeId,
          quantity: b.quantity,
          initialCustodyType: 'STORE',
          initialCustodyId: store.id,
        });
        out.push(...res.data.map((c) => ({ ...c, size: b.size, distributorName: distributor.businessName })));
      }
      return out;
    },
    onSuccess: (out) => {
      setGenerated(out);
      setBatches([]);
      setErr(null);
    },
    onError: (e: unknown) => setErr(e instanceof Error && !('isAxiosError' in e) ? e.message : messageFor(e)),
  });

  function exportCsv() {
    const rows = [
      ['serial', 'qrCode', 'size', 'distributor', 'cylinderId'],
      ...generated.map((c) => [c.serial, c.qrCode, c.size, c.distributorName, c.id]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${(v ?? '').toString().replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cylinder-qrs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const batchColumns: TableColumn<Batch>[] = [
    { id: 'size', header: lt('labels.columns.size'), cell: (b) => b.size },
    { id: 'quantity', header: lt('labels.columns.quantity'), align: 'end', cell: (b) => <strong>{formatNumber(b.quantity)}</strong> },
    {
      id: 'remove',
      header: <span className="sr-only">{lt('labels.columns.remove')}</span>,
      align: 'end',
      cell: (b) => (
        <Button size="sm" variant="ghost-danger" onClick={() => setBatches((list) => list.filter((x) => x.key !== b.key))}>
          {lt('labels.remove')}
        </Button>
      ),
    },
  ];

  const blockedReason = !store ? lt('labels.pickDistributorFirst') : batches.length === 0 ? lt('labels.addBatchFirst') : undefined;

  return (
    <div className="sf-legacy-page">
      <section className="sf-legacy-card no-print">
        <h3 className="sf-legacy-card__title">{lt('labels.step1')}</h3>
        <Field label={lt('labels.distributor')} labelHidden>
          <Select
            value={distributorId}
            placeholder={lt('labels.pickDistributor')}
            options={(distributors.data ?? []).map((d) => ({ value: d.id, label: d.businessName }))}
            onChange={(e) => {
              setDistributorId(e.target.value);
              setBatches([]);
              setErr(null);
            }}
          />
        </Field>
        {distributor ? (
          store ? (
            <p className="sf-legacy__muted">{lt('labels.startsIn', { store: store.name })}</p>
          ) : (
            <InlineAlert tone="danger">{lt('labels.noStore', { name: distributor.businessName })}</InlineAlert>
          )
        ) : null}
      </section>

      <section className="sf-legacy-card no-print">
        <h3 className="sf-legacy-card__title">{lt('labels.step2')}</h3>
        <div className="sf-legacy-batch">
          <Field label={lt('labels.size')}>
            <Select
              value={typeId}
              placeholder={lt('labels.pickSize')}
              options={(types.data ?? []).map((t) => ({ value: t.id, label: sizeLabelOf(t) }))}
              onChange={(e) => setTypeId(e.target.value)}
            />
          </Field>
          <Field label={lt('labels.quantity')} hint={lt('labels.max', { max: BULK_REGISTER_MAX })}>
            <div className="sf-legacy-stepper">
              <IconButton icon={Minus} variant="secondary" label={lt('labels.less')} onClick={() => step(-1)} />
              <TextInput
                type="number"
                min={1}
                max={BULK_REGISTER_MAX}
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
              <IconButton icon={Plus} variant="secondary" label={lt('labels.more')} onClick={() => step(1)} />
            </div>
          </Field>
          <Button onClick={addBatch} disabled={!store} disabledReason={store ? undefined : lt('labels.pickDistributorFirst')} icon={Plus}>
            {lt('labels.addToList')}
          </Button>
        </div>
        {batchError ? (
          <InlineAlert tone="danger" live>
            {batchError}
          </InlineAlert>
        ) : null}
        {batches.length > 0 ? (
          <>
            <Table<Batch> caption={lt('labels.step2')} columns={batchColumns} rows={batches} rowKey={(b) => String(b.key)} state="ready" empty={null} />
            <p className="sf-legacy__strong">{lt('labels.total', { count: totalQueued })}</p>
          </>
        ) : null}
      </section>

      <section className="sf-legacy-card no-print">
        <h3 className="sf-legacy-card__title">{lt('labels.step3')}</h3>
        {err ? (
          <InlineAlert tone="danger" live>
            {err}
          </InlineAlert>
        ) : null}
        <div>
          <Button
            variant="primary"
            onClick={() => generate.mutate()}
            loading={generate.isPending}
            disabled={Boolean(blockedReason)}
            disabledReason={blockedReason}
            reasonVisible
          >
            {lt('labels.addCylinders', { count: totalQueued })}
          </Button>
        </div>
      </section>

      {generated.length > 0 ? (
        <>
          <section className="sf-legacy-card no-print">
            <div className="sf-legacy-card__row">
              <h3 className="sf-legacy-card__title">{lt('labels.ready', { count: generated.length })}</h3>
              <span className="sf-legacy__actions">
                <Button icon={FileDown} onClick={exportCsv}>
                  {lt('labels.exportCsv')}
                </Button>
                <Button variant="primary" icon={Printer} onClick={() => window.print()}>
                  {lt('labels.print')}
                </Button>
              </span>
            </div>
          </section>

          <div className="qr-grid">
            {generated.map((c) => (
              <div className="qr-label" key={c.id}>
                <QRCodeCanvas value={c.qrCode} size={120} includeMargin />
                <div className="qr-label__text">
                  <div className="qr-label__size">{c.size}</div>
                  <div className="qr-label__owner">{c.distributorName}</div>
                  <div className="qr-label__serial">{c.serial}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

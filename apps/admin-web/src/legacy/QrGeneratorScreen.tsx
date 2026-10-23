import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { QRCodeCanvas } from 'qrcode.react';
import { FileDown, Printer } from 'lucide-react';
import type { DistributorDto } from '@smartfleet/shared-types';
import { BULK_REGISTER_MAX } from '@smartfleet/shared-validation';
import { api } from '../api/client';
import { messageFor } from '../api/errors';
import { Button } from '../ui';
import './legacy.css';

interface CylinderType { id: string; code: string; name: string; weightKg: string }
interface GeneratedCylinder {
  id: string;
  serial: string;
  qrCode: string;
  cylinderTypeId: string;
  distributorId: string;
}

interface Batch {
  cylinderTypeId: string;
  cylinderTypeLabel: string;
  quantity: number;
}

/**
 * Bulk QR generation: pick a distributor, queue one or more batches (cylinder size × quantity),
 * generate them in one go, preview the QR grid, print or export to CSV.
 *
 * Every new cylinder starts in the distributor's one store (API_CONTRACT §7.2 bulk-register, ADR-01), so
 * there is no store picker: the store is shown, and sent as the first holder. A batch is at most 500
 * cylinders (G05-12). Touched for UX_ADMIN §2.11: labelled icons instead of emoji.
 */
export function QrGeneratorScreen() {
  const distributors = useQuery({ queryKey: ['distributors'], queryFn: async () => (await api.get<DistributorDto[]>('/distributors')).data });
  const types = useQuery({ queryKey: ['cylinder-types'], queryFn: async () => (await api.get<CylinderType[]>('/cylinder-types')).data });

  const [distributorId, setDistributorId] = useState('');
  const [batches, setBatches] = useState<Batch[]>([]);
  const [draft, setDraft] = useState<{ typeId: string; qty: string }>({ typeId: '', qty: '10' });
  const [generated, setGenerated] = useState<Array<GeneratedCylinder & { typeLabel: string; weight: string; distributorName: string }>>([]);
  const [err, setErr] = useState<string | null>(null);

  const distributor = (distributors.data ?? []).find((d) => d.id === distributorId) ?? null;
  const store = distributor?.store ?? null;

  function addBatch() {
    setErr(null);
    const qty = Number(draft.qty);
    if (!draft.typeId || !draft.qty || !Number.isInteger(qty) || qty <= 0) {
      setErr('Pick a cylinder size and a whole number of cylinders.');
      return;
    }
    if (qty > BULK_REGISTER_MAX) {
      setErr(`Maximum ${BULK_REGISTER_MAX} cylinders per registration.`);
      return;
    }
    const type = types.data?.find((t) => t.id === draft.typeId);
    if (!type) return;
    setBatches((b) => [...b, { cylinderTypeId: type.id, cylinderTypeLabel: type.name, quantity: qty }]);
    setDraft({ typeId: '', qty: '10' });
  }

  const generate = useMutation({
    mutationFn: async () => {
      if (!distributor) throw new Error('Pick a distributor first.');
      if (!store) throw new Error('This distributor has no store yet. Set it up on their page first.');
      if (batches.length === 0) throw new Error('Add at least one batch.');
      const distName = distributor.businessName;
      const out: typeof generated = [];
      for (const b of batches) {
        const res = await api.post<GeneratedCylinder[]>('/cylinders/bulk-register', {
          distributorId: distributor.id,
          cylinderTypeId: b.cylinderTypeId,
          quantity: b.quantity,
          initialCustodyType: 'STORE',
          initialCustodyId: store.id,
        });
        const type = types.data?.find((t) => t.id === b.cylinderTypeId);
        out.push(...res.data.map((c) => ({
          ...c,
          typeLabel: type?.name ?? '',
          weight: type ? `${Number(type.weightKg)} kg` : '',
          distributorName: distName,
        })));
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
      ['serial', 'qrCode', 'type', 'weight', 'distributor', 'cylinderId'],
      ...generated.map((c) => [c.serial, c.qrCode, c.typeLabel, c.weight, c.distributorName, c.id]),
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

  function printLabels() {
    window.print();
  }

  const totalQueued = batches.reduce((s, b) => s + b.quantity, 0);

  return (
    <>
      <h2>Cylinder QR labels</h2>
      <p className="muted">
        Register cylinders in bulk and print their labels. Each cylinder gets its own serial and QR code, which the driver and shop
        apps scan.
      </p>

      <div className="card no-print">
        <h3>1. Pick distributor</h3>
        <label htmlFor="qr-distributor">Distributor *</label>
        <select
          id="qr-distributor"
          value={distributorId}
          onChange={(e) => {
            setDistributorId(e.target.value);
            setBatches([]);
            setErr(null);
          }}
        >
          <option value="">Pick a distributor</option>
          {(distributors.data ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.businessName}
            </option>
          ))}
        </select>
        {distributor &&
          (store ? (
            <p className="muted" style={{ marginTop: 8 }}>
              New cylinders start in <strong>{store.name}</strong>, the store of {distributor.businessName}.
            </p>
          ) : (
            <p style={{ marginTop: 8, color: 'var(--danger-fg)' }}>
              {distributor.businessName} has no store yet. Set it up on their page first.
            </p>
          ))}
      </div>

      <div className="card no-print">
        <h3>2. Queue batches</h3>
        <p className="muted">Add one or more rows. Each becomes its own block of cylinders, at most {BULK_REGISTER_MAX} per row.</p>
        <div className="flex" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label htmlFor="qr-size">Cylinder size</label>
            <select id="qr-size" value={draft.typeId} onChange={(e) => setDraft({ ...draft, typeId: e.target.value })}>
              <option value="">Pick a size</option>
              {(types.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({Number(t.weightKg)} kg)
                </option>
              ))}
            </select>
          </div>
          <div style={{ width: 140 }}>
            <label htmlFor="qr-qty">Quantity</label>
            <input
              id="qr-qty"
              type="number"
              min={1}
              max={BULK_REGISTER_MAX}
              value={draft.qty}
              onChange={(e) => setDraft({ ...draft, qty: e.target.value })}
            />
          </div>
          <div style={{ alignSelf: 'flex-end' }}>
            <button className="primary" onClick={addBatch} disabled={!store}>
              Add batch
            </button>
          </div>
        </div>
        {batches.length > 0 && (
          <table style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>Size</th>
                <th>Store</th>
                <th>Quantity</th>
                <th aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b, i) => (
                <tr key={i}>
                  <td>{b.cylinderTypeLabel}</td>
                  <td>{store?.name ?? '—'}</td>
                  <td>
                    <strong>{b.quantity}</strong>
                  </td>
                  <td>
                    <button style={{ color: 'var(--danger-fg)' }} onClick={() => setBatches((bs) => bs.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              <tr style={{ background: 'var(--surface-2)' }}>
                <td colSpan={2}>
                  <strong>Total cylinders to register</strong>
                </td>
                <td colSpan={2}>
                  <strong>{totalQueued}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="card no-print">
        <h3>3. Register</h3>
        {err && <p style={{ color: 'var(--danger-fg)' }}>{err}</p>}
        <button className="primary" onClick={() => generate.mutate()} disabled={!store || batches.length === 0 || generate.isPending}>
          {generate.isPending ? 'Registering…' : `Register ${totalQueued} cylinder${totalQueued === 1 ? '' : 's'}`}
        </button>
      </div>

      {generated.length > 0 && (
        <>
          <div className="card no-print">
            <div className="flex" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <h3 style={{ margin: 0 }}>4. Print or export {generated.length} labels</h3>
                <p className="muted" style={{ margin: 0 }}>
                  Each label shows the QR code, the serial, the size and the distributor.
                </p>
              </div>
              <div className="flex" style={{ gap: 8 }}>
                <Button icon={FileDown} onClick={exportCsv}>
                  Export CSV
                </Button>
                <Button variant="primary" icon={Printer} onClick={printLabels}>
                  Print labels
                </Button>
              </div>
            </div>
          </div>

          <div className="qr-grid">
            {generated.map((c) => (
              <div className="qr-label" key={c.id}>
                <QRCodeCanvas value={c.qrCode} size={120} includeMargin />
                <div style={{ marginTop: 8, textAlign: 'center', fontSize: 11 }}>
                  <div style={{ fontWeight: 700 }}>{c.weight}</div>
                  <div className="muted">{c.distributorName}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 10, wordBreak: 'break-all' }}>{c.serial}</div>
                </div>
              </div>
            ))}
          </div>

          <style>{`
            .qr-grid {
              display: grid;
              grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
              gap: 12px;
              margin-top: 16px;
            }
            .qr-label {
              background: white;
              border: 1px solid var(--border);
              border-radius: 8px;
              padding: 12px;
              display: flex;
              flex-direction: column;
              align-items: center;
              page-break-inside: avoid;
            }
            @media print {
              .sidebar, .no-print, .sf-shell__nav, .sf-topbar, .sf-env, .sf-tabs { display: none !important; }
              .content, .sf-main { padding: 0 !important; }
              .qr-grid { grid-template-columns: repeat(3, 1fr); gap: 8px; }
              .layout, .sf-shell { grid-template-columns: 1fr !important; }
            }
          `}</style>
        </>
      )}
    </>
  );
}

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { QRCodeCanvas } from 'qrcode.react';
import { api } from '../api/client';

interface CylinderType { id: string; code: string; name: string; weightKg: string }
interface Distributor { id: string; businessName: string }
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
  storeId: string;
  storeName: string;
  quantity: number;
}

/**
 * Bulk QR generation: pick a distributor, queue one or more batches
 * (cylinder type × store × quantity), generate them in one go,
 * preview the QR grid, print or export to CSV.
 */
export function QrGeneratorScreen() {
  const distributors = useQuery({ queryKey: ['distributors'], queryFn: async () => (await api.get<Distributor[]>('/distributors')).data });
  const types        = useQuery({ queryKey: ['cylinder-types'], queryFn: async () => (await api.get<CylinderType[]>('/cylinder-types')).data });
  const stores       = useQuery({ queryKey: ['stores'], queryFn: async () => (await api.get('/stores')).data });

  const [distributorId, setDistributorId] = useState('');
  const [batches, setBatches] = useState<Batch[]>([]);
  const [draft, setDraft] = useState<{ typeId: string; storeId: string; qty: string }>({ typeId: '', storeId: '', qty: '10' });
  const [generated, setGenerated] = useState<Array<GeneratedCylinder & { typeLabel: string; weight: string; distributorName: string }>>([]);
  const [err, setErr] = useState<string | null>(null);

  function addBatch() {
    setErr(null);
    if (!draft.typeId || !draft.storeId || !draft.qty || Number(draft.qty) <= 0) {
      setErr('Pick cylinder type, destination store, and a positive quantity.');
      return;
    }
    const type = types.data?.find((t) => t.id === draft.typeId);
    const store = (stores.data ?? []).find((s: any) => s.id === draft.storeId);
    if (!type || !store) return;
    setBatches((b) => [...b, {
      cylinderTypeId: type.id,
      cylinderTypeLabel: type.name,
      storeId: store.id,
      storeName: store.name,
      quantity: Number(draft.qty),
    }]);
    setDraft({ typeId: '', storeId: draft.storeId, qty: '10' });
  }

  const generate = useMutation({
    mutationFn: async () => {
      if (!distributorId) throw new Error('Pick a distributor first');
      if (batches.length === 0) throw new Error('Add at least one batch');
      const dist = (distributors.data ?? []).find((d) => d.id === distributorId);
      const distName = dist?.businessName ?? '';
      const out: typeof generated = [];
      for (const b of batches) {
        const res = await api.post<GeneratedCylinder[]>('/cylinders/bulk-register', {
          distributorId,
          cylinderTypeId: b.cylinderTypeId,
          quantity: b.quantity,
          initialCustodyType: 'STORE',
          initialCustodyId: b.storeId,
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
    onError: (e: any) => setErr(e?.response?.data?.message ?? e?.message ?? 'Failed'),
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
      <h2>Cylinder QR generator</h2>
      <p className="muted">
        Register cylinders in bulk and print labels. Each cylinder gets a unique serial + QR code; scanning it in the driver / distributor apps surfaces the cylinder's type, weight, owner distributor, and current custody.
      </p>

      <div className="card no-print">
        <h3>1. Pick distributor</h3>
        <label>Distributor *</label>
        <select value={distributorId} onChange={(e) => setDistributorId(e.target.value)}>
          <option value="">— pick a distributor —</option>
          {(distributors.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.businessName}</option>)}
        </select>
      </div>

      <div className="card no-print">
        <h3>2. Queue batches</h3>
        <p className="muted">Add one or more rows. Each becomes its own block of cylinders.</p>
        <div className="flex" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Cylinder type</label>
            <select value={draft.typeId} onChange={(e) => setDraft({ ...draft, typeId: e.target.value })}>
              <option value="">— pick a type —</option>
              {(types.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name} ({Number(t.weightKg)} kg)</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Drop them at store</label>
            <select value={draft.storeId} onChange={(e) => setDraft({ ...draft, storeId: e.target.value })}>
              <option value="">— pick a store —</option>
              {(stores.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div style={{ width: 120 }}>
            <label>Quantity</label>
            <input type="number" min={1} value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} />
          </div>
          <div style={{ alignSelf: 'flex-end' }}>
            <button className="primary" onClick={addBatch}>+ Add batch</button>
          </div>
        </div>
        {batches.length > 0 && (
          <table style={{ marginTop: 16 }}>
            <thead><tr><th>Type</th><th>Store</th><th>Quantity</th><th></th></tr></thead>
            <tbody>
              {batches.map((b, i) => (
                <tr key={i}>
                  <td>{b.cylinderTypeLabel}</td>
                  <td>{b.storeName}</td>
                  <td><strong>{b.quantity}</strong></td>
                  <td>
                    <button style={{ color: 'var(--danger)' }} onClick={() => setBatches((bs) => bs.filter((_, j) => j !== i))}>Remove</button>
                  </td>
                </tr>
              ))}
              <tr style={{ background: 'var(--surface-soft)' }}>
                <td colSpan={2}><strong>Total cylinders to generate</strong></td>
                <td colSpan={2}><strong>{totalQueued}</strong></td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="card no-print">
        <h3>3. Generate</h3>
        {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
        <button
          className="primary"
          onClick={() => generate.mutate()}
          disabled={!distributorId || batches.length === 0 || generate.isPending}
        >
          {generate.isPending ? 'Generating…' : `Generate ${totalQueued} cylinder${totalQueued === 1 ? '' : 's'}`}
        </button>
      </div>

      {generated.length > 0 && (
        <>
          <div className="card no-print">
            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ margin: 0 }}>4. Print / export {generated.length} labels</h3>
                <p className="muted" style={{ margin: 0 }}>Each label shows the QR + serial + size + owner distributor.</p>
              </div>
              <div className="flex" style={{ gap: 8 }}>
                <button onClick={exportCsv}>Export CSV</button>
                <button className="primary" onClick={printLabels}>🖨️ Print labels</button>
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
              .sidebar, .no-print { display: none !important; }
              .content { padding: 0 !important; }
              .qr-grid { grid-template-columns: repeat(3, 1fr); gap: 8px; }
              .layout { grid-template-columns: 1fr !important; }
            }
          `}</style>
        </>
      )}
    </>
  );
}

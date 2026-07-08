import { useState } from 'react';
import { FillingOrdersScreen } from './FillingOrdersScreen';
import { CurrentOrdersScreen } from './CurrentOrdersScreen';
import { PreviousOrdersScreen } from './PreviousOrdersScreen';

type Tab = 'current' | 'previous' | 'filling';

export function OrdersScreen() {
  const [tab, setTab] = useState<Tab>('current');

  return (
    <>
      <h2 style={{ marginBottom: 12 }}>Orders</h2>

      <div className="flex" style={{ gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        <TabButton active={tab === 'current'} onClick={() => setTab('current')}>Current orders</TabButton>
        <TabButton active={tab === 'previous'} onClick={() => setTab('previous')}>Previous orders</TabButton>
        <TabButton active={tab === 'filling'} onClick={() => setTab('filling')}>Filling orders</TabButton>
      </div>

      {tab === 'current'  && <CurrentOrdersScreen />}
      {tab === 'previous' && <PreviousOrdersScreen />}
      {tab === 'filling'  && <FillingOrdersScreen />}
    </>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '10px 18px',
        background: 'transparent',
        border: 0,
        borderBottom: active ? '3px solid var(--primary)' : '3px solid transparent',
        color: active ? 'var(--primary)' : 'var(--muted)',
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  );
}

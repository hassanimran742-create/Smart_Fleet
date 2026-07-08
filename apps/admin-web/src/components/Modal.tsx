import { ReactNode } from 'react';

interface Props {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}

export function Modal({ title, open, onClose, children, width = 520 }: Props) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white', borderRadius: 8, width, maxWidth: '92vw', maxHeight: '90vh',
          overflow: 'auto', padding: 24, boxShadow: '0 12px 40px rgba(0,0,0,.2)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 0, fontSize: 22, cursor: 'pointer', color: '#888' }}
          >×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function confirmDialog(message: string): boolean {
  // eslint-disable-next-line no-alert
  return window.confirm(message);
}

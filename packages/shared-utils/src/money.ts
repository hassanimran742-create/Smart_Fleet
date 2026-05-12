export type Paisa = number;

export function pkrToPaisa(pkr: number): Paisa {
  return Math.round(pkr * 100);
}

export function paisaToPkr(paisa: Paisa): number {
  return paisa / 100;
}

export function formatPkr(paisa: Paisa): string {
  return `Rs. ${(paisa / 100).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

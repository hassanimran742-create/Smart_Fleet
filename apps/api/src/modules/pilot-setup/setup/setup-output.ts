import { randomInt } from 'crypto';
import type { UserRole } from '@prisma/client';
import { formatPkPhone } from '@smartfleet/shared-utils';

/**
 * What a setup run hands back to the person running it (API_CONTRACT §10.3): the new logins' passwords,
 * printed once to the terminal, and the labels CSV for the cylinders it registered.
 */

/** Letters and digits that can't be misread when written down or read aloud (no 0/O, 1/l/I). */
const PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/** The length of every password a setup run creates. */
export const SETUP_PASSWORD_LENGTH = 12;

/** A new random 12-character password (about 69 bits), never stored in clear, logged or written to a file. */
export function generateSetupPassword(): string {
  let password = '';
  for (let i = 0; i < SETUP_PASSWORD_LENGTH; i++) password += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  return password;
}

/** A login the run created, with its one-time password. */
export interface NewLogin {
  name: string;
  role: UserRole;
  /** E.164. */
  phone: string;
  password: string;
}

/** The block printed at the end of a successful run, and nowhere else. */
export function loginLines(logins: readonly NewLogin[]): string[] {
  if (logins.length === 0) return ['No new logins: no passwords were made (a re-run never resets one).'];
  const nameWidth = Math.max(4, ...logins.map((login) => login.name.length));
  const roleWidth = Math.max(4, ...logins.map((login) => login.role.length));
  return [
    `New logins (${logins.length}). Write the passwords down now: they are shown only this once.`,
    ...logins.map(
      (login) => `  ${login.name.padEnd(nameWidth)}  ${login.role.padEnd(roleWidth)}  ${formatPkPhone(login.phone, 'international').padEnd(15)}  ${login.password}`,
    ),
  ];
}

/** One label to print: a cylinder the run registered. */
export interface CylinderLabel {
  shortNo: number;
  /** AG-C0001: the number printed on the label (and typed by people). */
  shortCode: string;
  /** The value the QR code encodes (`cylinders.qr_code`), scanned by the apps. */
  qrValue: string;
  /** "11.8 kg". */
  sizeLabel: string;
  state: 'FULL' | 'EMPTY';
  distributorCode: string;
  distributorName: string;
}

export const LABEL_CSV_HEADER = ['Cylinder number', 'QR value', 'Size', 'State', 'Shop code', 'Shop'] as const;

/** A CSV cell: quoted when needed, and never read as a formula by a spreadsheet. */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The labels file: a header, then one row per cylinder in label-number order (CRLF, for label printers and Excel). */
export function labelsCsv(labels: readonly CylinderLabel[]): string {
  const rows = [...labels]
    .sort((a, b) => a.distributorCode.localeCompare(b.distributorCode) || a.shortNo - b.shortNo)
    .map((label) =>
      [label.shortCode, label.qrValue, label.sizeLabel, label.state === 'FULL' ? 'Full' : 'Empty', label.distributorCode, label.distributorName]
        .map(cell)
        .join(','),
    );
  return [LABEL_CSV_HEADER.join(','), ...rows].join('\r\n') + '\r\n';
}

/** The default labels file name: `pilot-labels-20261024-153012.csv` (UTC), so a run never overwrites one. */
export function defaultLabelsFileName(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `pilot-labels-${stamp}.csv`;
}

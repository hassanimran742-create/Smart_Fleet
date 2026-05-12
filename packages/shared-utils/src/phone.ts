// Pakistan E.164 normalization. Accepts: 03001234567, 3001234567, +923001234567, 923001234567.
// Returns canonical +923XXXXXXXXX or null if it doesn't look like a PK mobile.
export function normalizePkPhone(raw: string): string | null {
  const digits = raw.replace(/\D+/g, '');
  let local = digits;
  if (local.startsWith('92')) local = local.slice(2);
  else if (local.startsWith('0')) local = local.slice(1);
  if (local.length !== 10) return null;
  if (!local.startsWith('3')) return null;
  return `+92${local}`;
}

export function maskPhone(e164: string): string {
  if (e164.length < 6) return e164;
  return `${e164.slice(0, 4)}*****${e164.slice(-2)}`;
}

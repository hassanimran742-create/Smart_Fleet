/**
 * Teach BigInt how to JSON-serialise. Prisma returns paisa-denominated money columns and other large
 * counters as BigInt; JSON carries them as digit strings (API_CONTRACT §1.1), and installed apps
 * already call `Number(x)` on them. Without this every response with one throws
 * "Do not know how to serialize a BigInt". Safe to call more than once.
 */
export function installBigIntJson(): void {
  const proto = BigInt.prototype as unknown as { toJSON?: () => string };
  if (typeof proto.toJSON === 'function') return;
  Object.defineProperty(BigInt.prototype, 'toJSON', {
    value: function toJSON(this: bigint): string {
      return this.toString();
    },
    writable: true,
    configurable: true,
  });
}

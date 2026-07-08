import { CryptoService } from './crypto.service';

class FakeCfg {
  constructor(private map: Record<string, string>) {}
  get<T>(key: string): T | undefined {
    return this.map[key] as any;
  }
}

const KEY = '0'.repeat(64);
const OLD = '1'.repeat(64);
const BI = '2'.repeat(64);

describe('CryptoService', () => {
  it('round-trips encrypt → decrypt', () => {
    const svc = new CryptoService(
      new FakeCfg({ 'encryption.key': KEY, 'encryption.blindIndexKey': BI }) as any,
    );
    const ct = svc.encrypt('hello world');
    expect(ct).not.toBe('hello world');
    expect(svc.decrypt(ct)).toBe('hello world');
  });

  it('preserves null and empty', () => {
    const svc = new CryptoService(new FakeCfg({ 'encryption.key': KEY }) as any);
    expect(svc.encrypt(null)).toBe(null);
    expect(svc.encrypt('')).toBe(null);
    expect(svc.decrypt(null)).toBe(null);
  });

  it('blind index is deterministic', () => {
    const svc = new CryptoService(
      new FakeCfg({ 'encryption.key': KEY, 'encryption.blindIndexKey': BI }) as any,
    );
    const a = svc.blindIndex('+923001234567');
    const b = svc.blindIndex('+923001234567');
    const c = svc.blindIndex('+923001234568');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('reads ciphertext written with previous key during rotation', () => {
    const oldSvc = new CryptoService(new FakeCfg({ 'encryption.key': OLD }) as any);
    const ct = oldSvc.encrypt('legacy secret')!;
    const rotated = new CryptoService(
      new FakeCfg({ 'encryption.key': KEY, 'encryption.keyOld': OLD }) as any,
    );
    expect(rotated.decrypt(ct)).toBe('legacy secret');
  });

  it('falls back to passthrough when encryption disabled', () => {
    const svc = new CryptoService(new FakeCfg({}) as any);
    expect(svc.encrypt('plain')).toBe('plain');
    expect(svc.decrypt('plain')).toBe('plain');
  });
});

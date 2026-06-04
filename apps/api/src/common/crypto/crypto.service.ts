import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

// Application-level encryption for sensitive PII columns (e.g. CNIC).
// Ciphertext format: base64( version(1) | iv(12) | authTag(16) | ciphertext )
// Key rotation: ENCRYPTION_KEY is current write key; ENCRYPTION_KEY_OLD allows
// reading rows written under the previous key during the rotation window.
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly keys: Buffer[];
  private readonly blindIndexKey: Buffer;
  private readonly enabled: boolean;

  constructor(cfg: ConfigService) {
    const primary = cfg.get<string>('encryption.key') ?? '';
    const old = cfg.get<string>('encryption.keyOld') ?? '';
    this.enabled = primary.length > 0;

    this.keys = [primary, old]
      .filter((k) => k && k.length > 0)
      .map((k) => Buffer.from(k, 'hex'));

    if (this.enabled) {
      for (const k of this.keys) {
        if (k.length !== 32) {
          throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
        }
      }
    } else {
      this.logger.warn(
        'ENCRYPTION_KEY not set — application-level PII encryption disabled. NOT for production.',
      );
    }

    const bi = cfg.get<string>('encryption.blindIndexKey') ?? '';
    this.blindIndexKey = bi ? Buffer.from(bi, 'hex') : Buffer.alloc(0);
  }

  encrypt(plaintext: string | null | undefined): string | null {
    if (plaintext == null || plaintext === '') return null;
    if (!this.enabled) return plaintext;

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.keys[0], iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const out = Buffer.concat([Buffer.from([1]), iv, tag, enc]);
    return out.toString('base64');
  }

  decrypt(ciphertext: string | null | undefined): string | null {
    if (ciphertext == null || ciphertext === '') return null;
    if (!this.enabled) return ciphertext;

    let buf: Buffer;
    try {
      buf = Buffer.from(ciphertext, 'base64');
    } catch {
      return ciphertext;
    }
    if (buf.length < 1 + 12 + 16 + 1 || buf[0] !== 1) {
      return ciphertext;
    }
    const iv = buf.subarray(1, 13);
    const tag = buf.subarray(13, 29);
    const enc = buf.subarray(29);

    let lastErr: unknown;
    for (const key of this.keys) {
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
        return dec.toString('utf8');
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr ?? new Error('decryption failed');
  }

  // Deterministic HMAC for searchable encrypted columns
  // (e.g. WHERE phone_blind = HMAC(phone)).
  blindIndex(value: string | null | undefined): string | null {
    if (value == null || value === '') return null;
    if (this.blindIndexKey.length === 0) {
      return crypto.createHash('sha256').update(value).digest('hex');
    }
    return crypto
      .createHmac('sha256', this.blindIndexKey)
      .update(value)
      .digest('hex');
  }
}

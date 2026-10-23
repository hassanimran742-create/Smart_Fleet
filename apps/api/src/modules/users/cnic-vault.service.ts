import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import { maskCnic, normalizeCnic } from '../../common/security/cnic';

/** The two `users` columns a CNIC is stored in. The legacy plain `users.cnic` is never written. */
export interface SealedCnic {
  cnicEncrypted: Buffer;
  cnicIndex: string;
}

/** The stored CNIC columns of a user row, for masking. */
export interface StoredCnic {
  cnicEncrypted?: Uint8Array | null;
  /** The legacy plain column, still set on rows from before Inc 1. */
  cnic?: string | null;
}

/**
 * CNIC storage (API_CONTRACT §3.5, §7.3 rule 4). A CNIC is reduced to its 13 digits, stored
 * encrypted with `ENCRYPTION_KEY` (`users.cnic_encrypted`: the CryptoService text, as UTF-8 bytes)
 * and indexed with HMAC-SHA256 under `BLIND_INDEX_KEY` (`users.cnic_index`, `CryptoService.blindIndex`
 * of the 13 digits), so "35202-7654321-3" and "3520276543213" are one CNIC, unique across users.
 * Responses never carry it: office views of a distributor or a driver get only {@link maskOf}.
 */
@Injectable()
export class CnicVault {
  private readonly logger = new Logger(CnicVault.name);

  constructor(private readonly crypto: CryptoService) {}

  /** The blind index of a CNIC typed with or without dashes; null when it isn't 13 digits. */
  indexOf(cnic: string): string | null {
    const digits = normalizeCnic(cnic);
    return digits ? this.crypto.blindIndex(digits) : null;
  }

  /** The column values for a CNIC (13 digits, with or without dashes). */
  seal(cnic: string): SealedCnic {
    const digits = normalizeCnic(cnic);
    const encrypted = digits ? this.crypto.encrypt(digits) : null;
    const index = digits ? this.crypto.blindIndex(digits) : null;
    if (!digits || !encrypted || !index) throw new Error('CnicVault.seal needs a 13-digit CNIC');
    return { cnicEncrypted: Buffer.from(encrypted, 'utf8'), cnicIndex: index };
  }

  /**
   * 409 USER_CNIC_IN_USE when a user other than `exceptUserId` holds this CNIC: by its blind index, or
   * in the legacy plain column written before Inc 1 (compared as 13 digits). Takes a transaction-scoped
   * advisory lock on the index first, so two requests claiming one CNIC at the same moment are
   * serialised and the second sees the first.
   */
  async assertFree(tx: Prisma.TransactionClient, cnic: string, exceptUserId?: string): Promise<void> {
    const digits = normalizeCnic(cnic);
    const cnicIndex = digits ? this.crypto.blindIndex(digits) : null;
    if (!digits || !cnicIndex) throw new Error('CnicVault.assertFree needs a 13-digit CNIC');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${cnicIndex}, 0))`;
    const except = exceptUserId ?? '00000000-0000-0000-0000-000000000000';
    const holders = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM users
      WHERE id <> ${except}::uuid
        AND (cnic_index = ${cnicIndex} OR regexp_replace(cnic, '[^0-9]', '', 'g') = ${digits})
      LIMIT 1`;
    if (holders.length > 0) throw new AppError('USER_CNIC_IN_USE');
  }

  /** `cnicMasked` for an office view: "*****-****567-1", or null when no CNIC is stored. */
  maskOf(row: StoredCnic): string | null {
    if (row.cnicEncrypted && row.cnicEncrypted.length > 0) {
      try {
        return maskCnic(this.crypto.decrypt(Buffer.from(row.cnicEncrypted).toString('utf8')));
      } catch {
        // Written under a key this process doesn't have: show nothing rather than fail the view.
        this.logger.warn('A stored CNIC could not be decrypted; cnicMasked is null');
        return null;
      }
    }
    return maskCnic(row.cnic ?? null);
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { SmsProvider } from '../sms-provider.interface';

// Eocean (Pakistan) HTTP API.
// Docs: https://www.eocean.com/sms-api/
// Endpoint accepts GET or POST with params: username, password, mask, to, message.
@Injectable()
export class EoceanSmsProvider implements SmsProvider {
  private readonly logger = new Logger(EoceanSmsProvider.name);

  constructor(private readonly cfg: ConfigService) {}

  async send(to: string, body: string): Promise<{ id: string }> {
    const username = this.cfg.get<string>('sms.eocean.username');
    const password = this.cfg.get<string>('sms.eocean.password');
    const mask = this.cfg.get<string>('sms.from');
    const baseUrl =
      this.cfg.get<string>('sms.eocean.baseUrl') ?? 'https://sendpk.com/api/sms.php';

    if (!username || !password || !mask) {
      throw new Error('Eocean SMS provider not configured (username/password/mask)');
    }

    const normalized = this.normalizePkNumber(to);

    const res = await axios.post(
      baseUrl,
      null,
      {
        params: {
          username,
          password,
          mask,
          to: normalized,
          message: body,
        },
        timeout: 10_000,
      },
    );

    const text = String(res.data ?? '').trim();
    if (!text.toLowerCase().startsWith('ok') && !text.toLowerCase().includes('success')) {
      this.logger.warn(`Eocean returned unexpected response: ${text}`);
      throw new Error(`Eocean send failed: ${text.slice(0, 200)}`);
    }

    const idMatch = text.match(/id[:\s]+([\w-]+)/i);
    return { id: idMatch?.[1] ?? `eocean_${Date.now()}` };
  }

  // Eocean expects PK numbers as 92XXXXXXXXXX (no leading 0, no +).
  private normalizePkNumber(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    if (digits.startsWith('92')) return digits;
    if (digits.startsWith('0')) return `92${digits.slice(1)}`;
    if (digits.length === 10) return `92${digits}`;
    return digits;
  }
}

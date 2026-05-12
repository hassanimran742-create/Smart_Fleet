import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { SmsService } from '../sms/sms.service';

interface ExpoPushMessage {
  to: string;
  title?: string;
  body: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  private logger = new Logger(NotificationsService.name);
  private expoToken: string;

  constructor(cfg: ConfigService, private sms: SmsService) {
    this.expoToken = cfg.get<string>('push.expoAccessToken') ?? '';
  }

  async push(messages: ExpoPushMessage[]) {
    if (!messages.length) return { ok: true };
    try {
      const { data } = await axios.post(
        'https://exp.host/--/api/v2/push/send',
        messages,
        {
          headers: {
            'Content-Type': 'application/json',
            ...(this.expoToken ? { Authorization: `Bearer ${this.expoToken}` } : {}),
          },
        },
      );
      return data;
    } catch (e) {
      this.logger.warn(`Push send failed: ${(e as Error).message}`);
      return { ok: false };
    }
  }

  notifyTripAssigned(expoToken: string, tripId: string) {
    return this.push([
      {
        to: expoToken,
        title: 'New trip',
        body: 'You have a new trip assigned',
        data: { type: 'TRIP_ASSIGNED', tripId },
      },
    ]);
  }

  async smsAlert(phone: string, body: string) {
    return this.sms.send(phone, body);
  }
}

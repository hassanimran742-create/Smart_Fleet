import { Injectable } from '@nestjs/common';

/**
 * The time the expenses module judges "today" by (API_CONTRACT §7.12: an expense date is at most
 * today's calendar date in Asia/Karachi, and the lists default to the current month). A provider of
 * its own, so tests can fix the clock without faking timers for the whole API.
 */
@Injectable()
export class ExpensesClock {
  now(): Date {
    return new Date();
  }
}

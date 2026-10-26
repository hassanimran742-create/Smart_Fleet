import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { WorkerHost } from '@nestjs/bullmq';
import { Queue, type Worker } from 'bullmq';

/** One warning per queue or worker per minute while Redis is unreachable, as for the rate limits (§3.6). */
export const QUEUE_WARN_EVERY_MS = 60_000;

/** The one event both a BullMQ Queue and Worker are listened to for here. */
interface ErrorEmitter {
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/**
 * Error listeners for every BullMQ queue and worker (API_CONTRACT §3.6: with Redis down, requests go
 * through and a warning is logged at most once a minute). Without a listener, BullMQ prints each
 * reconnect failure with `console.error` as a multi-line stack dump, with no timestamp, context or
 * request id; these go through the Nest logger instead, one line per source per minute. Queues are
 * found when the modules start; workers only exist once the BullMQ explorer has made them.
 */
@Injectable()
export class QueueErrorLog implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger('Queues');
  private readonly watched = new WeakSet<object>();
  private readonly lastWarnAt = new Map<string, number>();

  constructor(private readonly discovery: DiscoveryService) {}

  /** As early as possible: a connection that fails before its listener exists is still printed by BullMQ. */
  onModuleInit(): void {
    this.watchAll();
  }

  /** Again once every module has started, for the workers the explorer made after our first look. */
  onApplicationBootstrap(): void {
    this.watchAll();
  }

  private watchAll(): void {
    for (const instance of this.instances()) {
      if (instance instanceof Queue) this.watch(instance, `queue ${instance.name}`);
      if (instance instanceof WorkerHost) {
        let worker: Worker;
        try {
          worker = instance.worker;
        } catch {
          continue; // not made yet, or registered by hand: nothing to watch now
        }
        this.watch(worker, `worker ${worker.name}`);
      }
    }
  }

  /** Logs one queue or worker error, at most once a minute per source. */
  warn(source: string, error: unknown, now = Date.now()): boolean {
    const last = this.lastWarnAt.get(source);
    if (last !== undefined && now - last < QUEUE_WARN_EVERY_MS) return false;
    this.lastWarnAt.set(source, now);
    const reason = error instanceof Error ? error.message : String(error);
    this.logger.warn(`${source}: ${reason} (jobs wait until Redis answers; repeated errors are not logged for a minute)`);
    return true;
  }

  private watch(emitter: Queue | Worker, source: string): void {
    if (this.watched.has(emitter)) return;
    this.watched.add(emitter);
    (emitter as unknown as ErrorEmitter).on('error', (error: Error) => {
      this.warn(source, error);
    });
  }

  private instances(): unknown[] {
    return this.discovery.getProviders().map((wrapper) => wrapper.instance as unknown);
  }
}

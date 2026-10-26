import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DispatchService, type DispatchOutcome } from './dispatch.service';

/** The dispatch queue's worker: a no-op while `dispatch.autoAssign.enabled` is false (API_CONTRACT §8.5). */
@Processor('dispatch')
export class DispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(DispatchProcessor.name);

  constructor(private readonly dispatch: DispatchService) {
    super();
  }

  async process(job: Job<{ orderId: string }>): Promise<DispatchOutcome | { skipped: 'AUTO_ASSIGN_OFF' }> {
    if (!(await this.dispatch.isOn())) {
      this.logger.log(`Automatic assignment is off; order ${job.data.orderId} waits for the office`);
      return { skipped: 'AUTO_ASSIGN_OFF' };
    }
    const result = await this.dispatch.dispatchOrder(job.data.orderId);
    this.logger.log(`Dispatch result for ${job.data.orderId}: ${JSON.stringify(result)}`);
    return result;
  }
}

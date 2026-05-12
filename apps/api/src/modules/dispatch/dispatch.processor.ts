import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DispatchService } from './dispatch.service';

@Processor('dispatch')
export class DispatchProcessor extends WorkerHost {
  private logger = new Logger(DispatchProcessor.name);

  constructor(private readonly dispatch: DispatchService) {
    super();
  }

  async process(job: Job<{ orderId: string }>) {
    this.logger.log(`Dispatching order ${job.data.orderId}`);
    const result = await this.dispatch.dispatchOrder(job.data.orderId);
    this.logger.log(`Dispatch result: ${JSON.stringify(result)}`);
    return result;
  }
}

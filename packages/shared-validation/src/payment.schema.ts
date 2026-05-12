import { z } from 'zod';

export const topupSchema = z.object({
  amountPaisa: z.number().int().min(10000).max(50_000_000), // 100 PKR – 500,000 PKR
  provider: z.enum(['JAZZCASH', 'EASYPAISA', 'BANK_MANUAL']),
});
export type TopupInput = z.infer<typeof topupSchema>;

export const manualBankProofSchema = z.object({
  paymentId: z.string().uuid(),
  proofUrl: z.string().url(),
  bankRef: z.string().min(3).max(64),
});

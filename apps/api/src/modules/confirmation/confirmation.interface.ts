/**
 * Customer confirmation [Inc 2] (docs/pilot/CUSTOMER_PAGE.md, API_CONTRACT §5.9 and §9.7, ADR-15): the
 * cross-lane entry point. Every name other lanes and tests import is re-exported here, and the global
 * module is defined here, so app.module.ts keeps its import.
 *
 * - confirmation.contract.ts: `ConfirmationService` (abstract class, also the DI token) and its types.
 * - confirmation-token.ts: the link-token rules (CUSTOMER_PAGE §2).
 * - confirmation.service.ts: `ConfirmationServiceImpl`, the real service.
 * - confirmation.controller.ts: `GET /orders/:id/confirmation`, `…/share`, `…/new-link`.
 * - public/: the `/c/:token` page (controller, page service, limits, the HTML error filter).
 * - page/: the page's templates, copy, tokens and icons.
 * - confirmation-expiry.job.ts: every 15 minutes, PENDING past `expires_at` → EXPIRED.
 *
 * A record only: nothing in this module reaches the wallet or the ledger.
 */
import { Global, Module } from '@nestjs/common';
import { ConfirmationExpiryJob } from './confirmation-expiry.job';
import { ConfirmationController } from './confirmation.controller';
import { ConfirmationService } from './confirmation.contract';
import { ConfirmationServiceImpl } from './confirmation.service';
import { PageLimits } from './public/page-limits';
import { PublicConfirmController } from './public/public-confirm.controller';
import { PublicPageExceptionFilter } from './public/public-page.filter';
import { PublicPageService } from './public/public-page.service';

export * from './confirmation.contract';
export * from './confirmation-token';
export { ConfirmationServiceImpl, effectiveStatus, reachOf, QUEUED_LOST_AFTER_MS, SHARES_PER_HOUR } from './confirmation.service';
export { buildSnapshot, readSnapshot, sizeLabel, type SnapshotInput } from './confirmation-snapshot';
export { confirmationPath, confirmationUrl, publicLinkBase, smsUrl, telHref, waMeNumber, whatsappUrl } from './confirmation-links';
export { CONFIRMATION_EXPIRY_JOB, ConfirmationExpiryJob } from './confirmation-expiry.job';
export { CONFIRM_PAGE_PREFIX_EXCLUDE, PublicConfirmController } from './public/public-confirm.controller';
export { PublicPageExceptionFilter, pageForError } from './public/public-page.filter';
export { PAGE_HEADERS } from './public/page-response';
export { PAGE_LIMITS } from './public/page-limits';

/** Global, so the scan, trips and orders modules inject `ConfirmationService` without importing this module. */
@Global()
@Module({
  controllers: [ConfirmationController, PublicConfirmController],
  providers: [
    ConfirmationServiceImpl,
    { provide: ConfirmationService, useExisting: ConfirmationServiceImpl },
    ConfirmationExpiryJob,
    PageLimits,
    PublicPageService,
    PublicPageExceptionFilter,
  ],
  exports: [ConfirmationService, ConfirmationServiceImpl],
})
export class ConfirmationModule {}

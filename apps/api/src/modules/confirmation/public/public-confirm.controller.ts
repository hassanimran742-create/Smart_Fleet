import { All, Body, Controller, Get, Param, Post, Query, Req, Res, UseFilters } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { PublicPageExceptionFilter } from './public-page.filter';
import { PublicPageService } from './public-page.service';

export { CONFIRM_PAGE_PREFIX_EXCLUDE } from './page-routes';

function isDone(value: unknown): boolean {
  return Array.isArray(value) ? value.some((item) => item === '1') : value === '1';
}

/**
 * `/c/:token`: the customer's one-time confirmation page (CUSTOMER_PAGE §4, API_CONTRACT §9.7).
 * Public (no sign-in, no cookies), server-rendered HTML for every answer, errors included.
 *
 * | Method | Path | What |
 * |---|---|---|
 * | GET, HEAD | `/c/:token` | the main page or a state page (`?done=1`: "Thank you" once answered) |
 * | GET | `/c/:token/partly`, `/not-received`, `/other` | the second-step forms; nothing is recorded |
 * | POST | `/c/:token` | records the answer, then 303 to `/c/:token?done=1` |
 * | any | anything else under `/c/` | the not-found page, with no database lookup |
 */
@Controller('c')
@Public()
@UseFilters(PublicPageExceptionFilter)
export class PublicConfirmController {
  constructor(private readonly page: PublicPageService) {}

  @Get(':token')
  async main(@Req() req: Request, @Res() res: Response, @Param('token') token: string, @Query('done') done: unknown): Promise<void> {
    await this.page.show(req, res, token, null, isDone(done));
  }

  @Get(':token/partly')
  async partly(@Req() req: Request, @Res() res: Response, @Param('token') token: string): Promise<void> {
    await this.page.show(req, res, token, 'partly', false);
  }

  @Get(':token/not-received')
  async notReceived(@Req() req: Request, @Res() res: Response, @Param('token') token: string): Promise<void> {
    await this.page.show(req, res, token, 'not-received', false);
  }

  @Get(':token/other')
  async other(@Req() req: Request, @Res() res: Response, @Param('token') token: string): Promise<void> {
    await this.page.show(req, res, token, 'other', false);
  }

  @Post(':token')
  async answer(@Req() req: Request, @Res() res: Response, @Param('token') token: string, @Body() body: unknown): Promise<void> {
    await this.page.answer(req, res, token, body);
  }

  /** Declared last, so it only catches what the routes above don't. */
  @All('*')
  async anythingElse(@Req() req: Request): Promise<void> {
    await this.page.notFound(req);
  }
}

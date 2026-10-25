import type {
  CaseDto,
  ClientAddressCreateResult,
  ClientCreateResult,
  ClientDto,
  ClientUpdateResult,
  ConfirmationShareResult,
  ConfirmationShareVia,
  ConfirmationView,
  DayEndDayDto,
  DayEndListItem,
  DayEndUploadResult,
  DistributorDto,
  DistributorHomeDto,
  FillingOrderDto,
  LocationQuote,
  OrderCancelReason,
  OrderCancelResult,
  OrderDto,
  OrderListTab,
  OrderQuoteResult,
  Page,
  PayerChannel,
  PaymentDto,
  ScanEntryMethod,
  StatementItem,
  StatementKind,
  StoreIncomingDto,
  StoreScanResult,
  TopupInfoDto,
  UUID,
} from '@smartfleet/shared-types';
import { api, postMultipart, UPLOAD_TIMEOUT_MS, withIdempotencyKey } from '../../../api/client';
import { apiErrorFromHttp, isApiError } from '../../../api/errors';
import { bytesToBase64, bytesToText } from './bytes';

/**
 * The shop app's calls (UX_MOBILE Appendix B, API_CONTRACT §7). Every function returns the response
 * body typed with the shared DTOs; failures reject as `ApiError` (api/client.ts). Create and money
 * calls take the screen's Idempotency-Key, so a retry after a timeout never makes a second record.
 */

const path = (template: string, id: string) => template.replace(':id', encodeURIComponent(id));

// ---- Home, profile ---------------------------------------------------------------------------

/** `GET /distributor/home`: the wallet, order counts and store status in one round trip (S2). */
export async function fetchHome(): Promise<DistributorHomeDto> {
  return (await api.get<DistributorHomeDto>('/distributor/home')).data;
}

/** `GET /distributors/me`: the shop's own details for Profile (S12). */
export async function fetchDistributorMe(): Promise<DistributorDto> {
  return (await api.get<DistributorDto>('/distributors/me')).data;
}

// ---- Wallet and top-ups -----------------------------------------------------------------------

/** `GET /payments/topup-info`: the company account, limits and quick amounts (S3, S4). */
export async function fetchTopupInfo(): Promise<TopupInfoDto> {
  return (await api.get<TopupInfoDto>('/payments/topup-info')).data;
}

/** `GET /payments/mine`: every top-up request of this shop, newest first (a bare array). */
export async function fetchMyTopups(): Promise<PaymentDto[]> {
  const { data } = await api.get<PaymentDto[]>('/payments/mine');
  return Array.isArray(data) ? data : [];
}

/** `GET /payments/:id` (S6). */
export async function fetchTopup(id: string): Promise<PaymentDto> {
  return (await api.get<PaymentDto>(path('/payments/:id', id))).data;
}

export interface TopupRequestBody {
  amountPaisa: string;
  payerName: string;
  payerChannel: PayerChannel;
  transactionId?: string;
  proofFileId?: string;
}

/** `POST /payments/topup-requests` with the screen's Idempotency-Key (S5). */
export async function sendTopupRequest(body: TopupRequestBody, idempotencyKey: string): Promise<PaymentDto> {
  return (await api.post<PaymentDto>('/payments/topup-requests', body, withIdempotencyKey(idempotencyKey))).data;
}

export const STATEMENT_PAGE_SIZE = 30;

/** `GET /wallet/statement?kind&cursor&limit` (S7); `kinds` is sent as one comma-separated list. */
export async function fetchStatement(params: {
  kinds?: readonly StatementKind[];
  cursor?: string | null;
}): Promise<Page<StatementItem>> {
  const { data } = await api.get<Page<StatementItem>>('/wallet/statement', {
    params: {
      kind: params.kinds?.length ? params.kinds.join(',') : undefined,
      cursor: params.cursor ?? undefined,
      limit: STATEMENT_PAGE_SIZE,
    },
  });
  return { items: data.items ?? [], nextCursor: data.nextCursor ?? null };
}

// ---- Customers and prices ---------------------------------------------------------------------

/** `GET /clients`: this shop's customers with each address's live zone and price status. */
export async function fetchClients(): Promise<ClientDto[]> {
  const { data } = await api.get<ClientDto[]>('/clients');
  return Array.isArray(data) ? data : [];
}

/** `GET /pricing/quote?lat&lng`: always 200; a blocked spot carries `blockCode` (S8 cost panel). */
export async function fetchLocationQuote(lat: number, lng: number): Promise<LocationQuote> {
  return (await api.get<LocationQuote>('/pricing/quote', { params: { lat, lng } })).data;
}

export interface NewClientBody {
  name: string;
  phone: string;
  address: { label: string; lat: number; lng: number };
  area?: string;
  notes?: string;
}

/** `POST /clients`: the customer and their first address in one atomic call (S8). */
export async function createClient(body: NewClientBody, idempotencyKey: string): Promise<ClientCreateResult> {
  return (await api.post<ClientCreateResult>('/clients', body, withIdempotencyKey(idempotencyKey))).data;
}

/** `POST /clients/:id/addresses`: add a delivery spot (addresses are add-only in the pilot). */
export async function addClientAddress(
  clientId: string,
  body: { label: string; lat: number; lng: number },
  idempotencyKey: string,
): Promise<ClientAddressCreateResult> {
  return (
    await api.post<ClientAddressCreateResult>(
      path('/clients/:id/addresses', clientId),
      body,
      withIdempotencyKey(idempotencyKey),
    )
  ).data;
}

/** A row of `GET /cylinder-types` (signed in): the sizes a shop can order. */
export interface CylinderTypeRow {
  id: UUID;
  code: string;
  name: string;
  /** A decimal as text ("11.80"). */
  weightKg: string | number;
}

export async function fetchCylinderTypes(): Promise<CylinderTypeRow[]> {
  const { data } = await api.get<CylinderTypeRow[]>('/cylinder-types');
  return Array.isArray(data) ? data : [];
}

// ---- Orders -----------------------------------------------------------------------------------

export interface OrderLineBody {
  cylinderTypeId: UUID;
  fullCount: number;
  expectedReturnCount: number;
}

/** The `POST /orders` and `POST /orders/quote` body (API_CONTRACT §7.6). */
export interface OrderBody {
  clientId: UUID;
  addressId: UUID;
  deliveryLabel: string;
  lines: OrderLineBody[];
  /** The cost the person saw; a different quote answers `PRICING_QUOTE_CHANGED`. */
  quotedTotalPaisa?: string;
}

/** `POST /orders/quote`: the cost as it stands and whether the wallet covers it (S9 step 3). */
export async function quoteOrder(body: OrderBody): Promise<OrderQuoteResult> {
  // The quote takes the create body; `quotedTotalPaisa` is ignored there, so it isn't sent.
  const { clientId, addressId, deliveryLabel, lines } = body;
  return (await api.post<OrderQuoteResult>('/orders/quote', { clientId, addressId, deliveryLabel, lines })).data;
}

/** `POST /orders` with the screen's Idempotency-Key: the cost is deducted when it is placed. */
export async function placeOrder(body: OrderBody, idempotencyKey: string): Promise<OrderDto> {
  return (await api.post<OrderDto>('/orders', body, withIdempotencyKey(idempotencyKey))).data;
}

export const ORDERS_PAGE_SIZE = 30;

/** `GET /orders?tab=active|done&cursor` (S10). */
export async function fetchOrdersPage(tab: OrderListTab, cursor: string | null): Promise<Page<OrderDto>> {
  const { data } = await api.get<Page<OrderDto>>('/orders', {
    params: { tab, cursor: cursor ?? undefined, limit: ORDERS_PAGE_SIZE },
  });
  return { items: data.items ?? [], nextCursor: data.nextCursor ?? null };
}

/** `GET /orders/:id` (S11). */
export async function fetchOrder(id: string): Promise<OrderDto> {
  return (await api.get<OrderDto>(path('/orders/:id', id))).data;
}

/** The fields of `GET /orders/:id/tracking` the order screen reads (orders.service.ts shape). */
export interface OrderTrackingDto {
  destination: { lat: number; lng: number } | null;
  driverLocation: { lat: number; lng: number } | null;
}

export async function fetchOrderTracking(id: string): Promise<OrderTrackingDto> {
  const { data } = await api.get<Partial<OrderTrackingDto>>(path('/orders/:id/tracking', id));
  return { destination: data.destination ?? null, driverLocation: data.driverLocation ?? null };
}

export interface CancelOrderBody {
  reasonCode: OrderCancelReason;
  note?: string;
  /** The refund the person saw; different terms answer `ORDER_CANCEL_TERMS_CHANGED`. */
  confirmRefundPaisa: string;
}

/** `POST /orders/:id/cancel` (S11). A repeat answers like the first cancel did. */
export async function cancelOrder(id: string, body: CancelOrderBody, idempotencyKey: string): Promise<OrderCancelResult> {
  return (await api.post<OrderCancelResult>(path('/orders/:id/cancel', id), body, withIdempotencyKey(idempotencyKey)))
    .data;
}

// ---- Customer problems [Inc 2] ----------------------------------------------------------------

/** `GET /alerts/mine`: the shop's open customer-problem cases, oldest first (API_CONTRACT §9.6). */
export async function fetchMyCases(): Promise<Page<CaseDto>> {
  const { data } = await api.get<Page<CaseDto>>('/alerts/mine');
  return { items: data.items ?? [], nextCursor: data.nextCursor ?? null };
}

// ---- Refills (S12b) ---------------------------------------------------------------------------

/** A row of `GET /filling-stations` (active stations only). The legacy price column is ignored. */
export interface FillingStationRow {
  id: UUID;
  name: string;
  address?: string | null;
}

export async function fetchStations(): Promise<FillingStationRow[]> {
  const { data } = await api.get<FillingStationRow[]>('/filling-stations');
  return Array.isArray(data) ? data : [];
}

/** `GET /filling-orders/mine` (a bare array of FillingOrderDto). */
export async function fetchMyRefills(): Promise<FillingOrderDto[]> {
  const { data } = await api.get<FillingOrderDto[]>('/filling-orders/mine');
  return Array.isArray(data) ? data : [];
}

export interface NewRefillBody {
  fillingStationId: UUID;
  cylinderTypeId: UUID;
  requestedCount: number;
}

/**
 * `POST /filling-orders`. Inc 1 ignores the Idempotency-Key (G08-01); it is sent anyway, so the Inc 3
 * server replays a retry with no app change.
 */
export async function requestRefill(body: NewRefillBody, idempotencyKey: string): Promise<FillingOrderDto> {
  return (await api.post<FillingOrderDto>('/filling-orders', body, withIdempotencyKey(idempotencyKey))).data;
}

/** `PATCH /filling-orders/:id/cancel { reason }`: the owner, before pickup only. */
export async function cancelRefill(id: string, reason: string): Promise<FillingOrderDto> {
  return (await api.patch<FillingOrderDto>(path('/filling-orders/:id/cancel', id), { reason })).data;
}

/** [Inc 3] `GET /filling-orders/:id` (S18): the refill with its picked cylinders (`cylinders`). */
export async function fetchRefill(id: string): Promise<FillingOrderDto> {
  return (await api.get<FillingOrderDto>(path('/filling-orders/:id', id))).data;
}

// ---- Store receive [Inc 2] (API_CONTRACT §9.4) --------------------------------------------------

/** `GET /store/incoming`: the shop's cylinders on any van, one row per van with something left. */
export async function fetchStoreIncoming(): Promise<StoreIncomingDto> {
  const { data } = await api.get<StoreIncomingDto>('/store/incoming');
  return { vans: Array.isArray(data?.vans) ? data.vans : [] };
}

export interface StoreScanBody {
  /** A new id per read, kept for every resend of it, so the server records the read once. */
  scanId: string;
  code: string;
  entryMethod: ScanEntryMethod;
}

/**
 * `POST /store/scans` (RECEIVE): a cylinder off a van into the shop's one store. 201 RECORDED; a resend
 * or the same move again answers 200 ALREADY_RECORDED. The body can never name a store (ADR-13).
 */
export async function sendStoreScan(body: StoreScanBody): Promise<StoreScanResult> {
  return (await api.post<StoreScanResult>('/store/scans', body)).data;
}

// ---- Customer confirmation [Inc 2] (CUSTOMER_PAGE §10, API_CONTRACT §9.7) ------------------------

/** `GET /orders/:id/confirmation`: the card's state. 403 FEATURE_DISABLED while the switch is off. */
export async function fetchConfirmation(orderId: string): Promise<ConfirmationView> {
  return (await api.get<ConfirmationView>(path('/orders/:id/confirmation', orderId))).data;
}

/**
 * `POST /orders/:id/confirmation/share { via }` with a new Idempotency-Key per tap: the link and the
 * message to pass on. `whatsappUrl` and `smsUrl` are null when the customer's phone isn't a mobile.
 */
export async function shareConfirmation(
  orderId: string,
  via: ConfirmationShareVia,
  idempotencyKey: string,
): Promise<ConfirmationShareResult> {
  return (
    await api.post<ConfirmationShareResult>(
      path('/orders/:id/confirmation/share', orderId),
      { via },
      withIdempotencyKey(idempotencyKey),
    )
  ).data;
}

/** `POST /orders/:id/confirmation/new-link`: the old link stops working; `expiresAt` never changes. */
export async function makeNewConfirmationLink(orderId: string, idempotencyKey: string): Promise<ConfirmationView> {
  return (
    await api.post<ConfirmationView>(path('/orders/:id/confirmation/new-link', orderId), {}, withIdempotencyKey(idempotencyKey))
  ).data;
}

// ---- Customers [Inc 2] (API_CONTRACT §9.4) ------------------------------------------------------

export interface ClientUpdateBody {
  name?: string;
  /** E.164 (`+923001234567`). */
  phone?: string;
  /** A blank note clears it. */
  notes?: string;
}

/**
 * `PATCH /clients/:id` (S15b). `confirmationNeedsNewLink` is true only when the phone changed while a
 * link is pending: the order then asks "Make a new link?". Addresses can't change here (add-only).
 */
export async function updateClient(id: string, body: ClientUpdateBody): Promise<ClientUpdateResult> {
  return (await api.patch<ClientUpdateResult>(path('/clients/:id', id), body)).data;
}

// ---- Day-end [Inc 3] (API_CONTRACT §10.2) -------------------------------------------------------

/** The day-end sheet's file type (an Excel workbook). */
export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * `GET /day-end`: the shop's days that have a row (a sheet was made), newest first, one page (30). Home
 * and S19 read it to find a day the office sent back or reopened, or an earlier day never sent
 * (dayEndModel.dayEndTarget).
 */
export async function fetchDayEndList(): Promise<Page<DayEndListItem>> {
  const { data } = await api.get<Page<DayEndListItem>>('/day-end');
  return { items: Array.isArray(data?.items) ? data.items : [], nextCursor: data?.nextCursor ?? null };
}

/** `GET /day-end/:date` (S19). A date with no row reads NOT_STARTED; a later date is 404 DAY_NOT_FOUND. */
export async function fetchDayEnd(date: string): Promise<DayEndDayDto> {
  return (await api.get<DayEndDayDto>(path('/day-end/:id', date))).data;
}

/** The workbook's bytes, ready to write into a file, and the name the server gave it. */
export interface DaySheetFile {
  base64: string;
  fileName: string;
}

function fileNameFrom(disposition: unknown, date: string): string {
  const match = typeof disposition === 'string' ? /filename="?([^";]+)"?/i.exec(disposition) : null;
  return match?.[1]?.trim() || `day-end-${date}.xlsx`;
}

/**
 * `GET /day-end/:date/sheet.xlsx`: a new sheet (only the newest can be uploaded). It goes through the
 * API client (auth, renewal, the connection banner); a refusal's JSON body arrives as bytes, so it is
 * read again here into its catalogue code.
 */
export async function fetchDaySheet(date: string): Promise<DaySheetFile> {
  try {
    const response = await api.get<ArrayBuffer>(`${path('/day-end/:id', date)}/sheet.xlsx`, {
      responseType: 'arraybuffer',
      timeout: UPLOAD_TIMEOUT_MS,
      headers: { Accept: XLSX_MIME_TYPE },
    });
    return {
      base64: bytesToBase64(new Uint8Array(response.data)),
      fileName: fileNameFrom(response.headers['content-disposition'], date),
    };
  } catch (thrown) {
    const reply = isApiError(thrown) ? thrown.response : undefined;
    if (!isApiError(thrown) || !reply || !(reply.data instanceof ArrayBuffer)) throw thrown;
    let body: unknown = null;
    try {
      body = JSON.parse(bytesToText(new Uint8Array(reply.data)));
    } catch {
      body = null;
    }
    throw apiErrorFromHttp(reply.status, body, reply.headers, thrown.requestId);
  }
}

/**
 * `POST /day-end/:date/upload` (multipart field `file`, at most 2 MiB). `uri` may be a `content://`
 * document the shop picked: React Native's networking reads it directly. A refusal for the whole file
 * (DAY_SHEET_UNREADABLE …) or for rows (DAY_SHEET_ROW_ERRORS) stores nothing.
 */
export async function uploadDaySheet(date: string, file: { uri: string; name: string }): Promise<DayEndUploadResult> {
  const form = new FormData();
  // React Native's FormData takes a { uri, name, type } file part.
  form.append('file', { uri: file.uri, name: file.name, type: XLSX_MIME_TYPE } as unknown as Blob);
  return postMultipart<DayEndUploadResult>(`${path('/day-end/:id', date)}/upload`, form, { timeoutMs: UPLOAD_TIMEOUT_MS });
}

/** `POST /day-end/:date/submit { version }`: sends the uploaded version for approval (rule 7). */
export async function submitDayEnd(date: string, version: number): Promise<DayEndDayDto> {
  return (await api.post<DayEndDayDto>(`${path('/day-end/:id', date)}/submit`, { version })).data;
}

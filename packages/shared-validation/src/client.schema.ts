import { z } from 'zod';
import { latSchema, lngSchema, optionalTextSchema, optionalUuidSchema, phoneInputSchema, textSchema } from './common.schema';

/** A delivery address with its map pin. The service finds its zone and price (API_CONTRACT §7.4). */
export const clientAddressInputSchema = z.object({
  label: textSchema(1, 60),
  lat: latSchema,
  lng: lngSchema,
});
export type ClientAddressInput = z.infer<typeof clientAddressInputSchema>;

/** Installed 0.1.0 apps send `address` as free text; it moves to `legacyAddressText` before parsing. */
function moveLegacyAddress(body: unknown): unknown {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return body;
  const { address, ...rest } = body as Record<string, unknown>;
  return typeof address === 'string' ? { ...rest, legacyAddressText: address } : body;
}

/**
 * `POST /clients` (distributor). The service normalises the phone (`CLIENT_PHONE_INVALID`), checks it is
 * unique (`CLIENT_PHONE_EXISTS`) and, with an `address`, checks coverage and price (422) before
 * saving the customer and address in one transaction.
 *
 * Installed apps send `address` as free text and the pin later through `POST /clients/:id/addresses`;
 * that text arrives as `legacyAddressText`. The legacy `creditLimitRs`, `priority` and `city` are dropped.
 */
export const createClientSchema = z.preprocess(
  moveLegacyAddress,
  z.object({
    name: textSchema(1, 80),
    phone: phoneInputSchema,
    address: clientAddressInputSchema.optional(),
    legacyAddressText: optionalTextSchema(255),
    area: optionalTextSchema(80),
    notes: optionalTextSchema(200),
  }),
);
export type CreateClientInput = z.infer<typeof createClientSchema>;

/**
 * `GET /clients` (a bare array). The office must pass `distributorId` (the controller answers
 * `VALIDATION_FAILED` `REQUIRED` without it); a distributor's own id always comes from its token, so
 * any value it sends is ignored.
 */
export const clientsQuerySchema = z.object({
  distributorId: optionalUuidSchema,
});
export type ClientsQuery = z.infer<typeof clientsQuerySchema>;

/** `POST /clients/:id/addresses` (distributor) `{ label, lat, lng }`. */
export const createClientAddressSchema = clientAddressInputSchema;
export type CreateClientAddressInput = ClientAddressInput;

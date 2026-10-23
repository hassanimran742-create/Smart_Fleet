import {
  APP_ERROR_MESSAGE_EN,
  type AppErrorCode,
  type ClientErrorCode,
  type ErrorCode,
} from '@smartfleet/shared-types';

/**
 * `errors.<CODE>` (foundation namespace; API_CONTRACT §2.1, UX_MOBILE §3.2). The English resource
 * **is** the shared catalogue: `ERROR_MESSAGE_EN` plus the three client-only codes, so there is one
 * English source and every code has a key by construction. Never add or reword a message here; change
 * packages/shared-types instead. Templates use `{{param}}` from the error's `details`, with `*Paisa`
 * values formatted by `formatRs` (see `toUserMessage` in api/errors.ts).
 */
export const errors: { readonly [C in AppErrorCode]: string } = { ...APP_ERROR_MESSAGE_EN };

// Compile-time guard (API_CONTRACT §8.6): every server and client code has an `errors.<CODE>` key.
type Assert<T extends true> = T;
type _EveryCodeHasAKey = Assert<
  [Exclude<ErrorCode | ClientErrorCode, keyof typeof errors>] extends [never] ? true : false
>;

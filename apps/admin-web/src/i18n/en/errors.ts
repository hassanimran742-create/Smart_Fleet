import {
  CLIENT_ERROR_MESSAGE_EN,
  ERROR_MESSAGE_EN,
  type AppErrorCode,
} from '@smartfleet/shared-types';

/**
 * `errors`: one entry per stable error code (`errors:<CODE>`), owned by the foundation lane.
 *
 * The English resource IS the server catalogue (`ERROR_MESSAGE_EN` in @smartfleet/shared-types) plus the
 * client-only codes (NETWORK_OFFLINE, NETWORK_TIMEOUT, UNKNOWN), so there is one English source
 * (API_CONTRACT §2.1, ADR-18). Never add or reword a message here: change the shared catalogue.
 *
 * Values are typed as plain strings so `t()` accepts the params of any code (`toMessageParams(details)`).
 */
export const errors: Readonly<Record<AppErrorCode, string>> = {
  ...ERROR_MESSAGE_EN,
  ...CLIENT_ERROR_MESSAGE_EN,
};

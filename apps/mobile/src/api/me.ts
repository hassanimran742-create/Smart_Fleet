import type { MeDto } from '@smartfleet/shared-types';
import { api } from './client';

/**
 * `GET /users/me` sends shared-types' MeDto (SafeUserDto: explicit safe fields, `hasPassword` and the
 * shop or driver profile; secrets are stripped by the server, API_CONTRACT §7, §7.2). Re-exported so
 * screens keep importing it from here.
 */
export type { MeDto };

/** `GET /users/me`; use with `qk.me`. */
export async function fetchMe(): Promise<MeDto> {
  const { data } = await api.get<MeDto>('/users/me');
  return data;
}

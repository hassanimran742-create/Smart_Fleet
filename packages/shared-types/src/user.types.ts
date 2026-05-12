import type { ISODateString, UUID } from './common.types';

export enum UserRole {
  ADMIN = 'ADMIN',
  DISPATCHER = 'DISPATCHER',
  STORE_KEEPER = 'STORE_KEEPER',
  DISTRIBUTOR = 'DISTRIBUTOR',
  DRIVER = 'DRIVER',
  CLIENT = 'CLIENT',
}

export enum UserStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

export interface User {
  id: UUID;
  phone: string;
  email?: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  createdAt: ISODateString;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

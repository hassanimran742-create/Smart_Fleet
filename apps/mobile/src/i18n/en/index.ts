import { auth } from './auth';
import { common } from './common';
import { confirm } from './confirm';
import { customers } from './customers';
import { dayEnd } from './dayEnd';
import { driver } from './driver';
import { errors } from './errors';
import { home } from './home';
import { money } from './money';
import { orders } from './orders';
import { receive } from './receive';
import { refill } from './refill';
import { scan } from './scan';
import { stages } from './stages';
import { topup } from './topup';
import { validation } from './validation';
import { wallet } from './wallet';

/**
 * The English resources: one TypeScript module per namespace, merged into the default `translation`
 * namespace, so a key reads `t('orders.new.title')` (UX_MOBILE §3.3).
 *
 * | Owner | Namespaces |
 * |---|---|
 * | foundation | common, auth, stages, errors, validation, money |
 * | mobile-distributor (shop) | home, wallet, topup, customers, orders, refill, receive, confirm, dayEnd |
 * | mobile-driver | driver, scan |
 *
 * Inc 2 adds `receive` and `confirm` (shop); Inc 3 adds `dayEnd` (shop).
 * `typeof en` types every `t()` call (i18n/types.d.ts), so a missing key fails the typecheck.
 */
export const en = {
  common,
  auth,
  stages,
  errors,
  validation,
  money,
  home,
  wallet,
  topup,
  customers,
  orders,
  refill,
  receive,
  confirm,
  dayEnd,
  driver,
  scan,
};

export type EnResources = typeof en;

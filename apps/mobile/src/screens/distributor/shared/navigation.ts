import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CommonActions, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { DistributorStackParams, PayChannel } from '../../../navigation/DistributorStack';
import { confirm } from '../../../ui';
import { isLeavingByHand } from './leaving';

export type ShopRoute = keyof DistributorStackParams;
export type ShopNavigation = NativeStackNavigationProp<DistributorStackParams>;

/** The typed navigation of the shop app's stack (replaces `useNavigation<any>()`). */
export function useShopNavigation(): ShopNavigation {
  return useNavigation<ShopNavigation>();
}

/** The typed route of one shop screen. */
export function useShopRoute<R extends ShopRoute>(): RouteProp<DistributorStackParams, R> {
  return useRoute<RouteProp<DistributorStackParams, R>>();
}

/** The screens of the Add money flow (S3 to S5), which the status screen replaces once it is sent. */
const TOPUP_FORM_ROUTES: ReadonlySet<string> = new Set(['TopupAmount', 'TopupHowToPay', 'TopupTellUs']);

/** A route as `CommonActions.reset` takes it again (key, name and params). */
function kept(routes: ReturnType<ShopNavigation['getState']>['routes']) {
  return routes.map(({ key, name, params }) => ({ key, name, params }));
}

/**
 * After a top-up request is sent (S5): the stack becomes "where Add money started" + Status, so Back
 * from the status never returns to the form (UX_MOBILE S5, TOP-009).
 */
export function showSentTopup(navigation: ShopNavigation, id: string): void {
  const state = navigation.getState();
  const start = state.routes.findIndex((route) => TOPUP_FORM_ROUTES.has(route.name));
  if (start <= 0) {
    navigation.replace('TopupStatus', { id });
    return;
  }
  const routes = [...kept(state.routes.slice(0, start)), { name: 'TopupStatus' as const, params: { id } }];
  navigation.dispatch(CommonActions.reset({ index: routes.length - 1, routes }));
}

/** What "Tell us again" fills in: the refused request's amount, name and channel. */
export interface TellUsAgain {
  amountPaisa: string;
  payerName?: string;
  payerChannel: PayChannel;
}

/**
 * "Tell us again" on a top-up that wasn't added (shop spec §I): the status screen gives way to the
 * three Add money steps, prefilled, opening on Tell us you paid. The header arrow then shows How to
 * pay and the amount, and nothing asks the person to pay a second time.
 */
export function tellUsAgain(navigation: ShopNavigation, prefill: TellUsAgain): void {
  const state = navigation.getState();
  const below = state.routes.slice(0, Math.max(0, state.index));
  const routes = [
    ...kept(below),
    { name: 'TopupAmount' as const, params: { amountPaisa: prefill.amountPaisa, payerName: prefill.payerName, payerChannel: prefill.payerChannel } },
    { name: 'TopupHowToPay' as const, params: { ...prefill } },
    { name: 'TopupTellUs' as const, params: { ...prefill } },
  ];
  navigation.dispatch(CommonActions.reset({ index: routes.length - 1, routes }));
}

/**
 * Back to New order on "Cylinders to deliver" for a customer (and address): after Add customer,
 * "Use Sana" or New address. When New order is under this screen it goes back to it; opened from
 * Customers, this screen gives way to a new New order, so Back returns to the list.
 */
export function returnToOrder(navigation: ShopNavigation, params: { clientId: string; addressId?: string }): void {
  const target = { clientId: params.clientId, addressId: params.addressId, pickedAt: Date.now() };
  const underThis = navigation.getState().routes.some((route) => route.name === 'NewOrder');
  if (underThis) navigation.navigate('NewOrder', target);
  else navigation.replace('NewOrder', target);
}

/**
 * "Leave without saving?" (UX_MOBILE §2.2 screen rules) for a form with input. Only leaving by hand
 * asks (`isLeavingByHand`): a screen that saved and moves on (replace, reset, navigate) is never
 * stopped. `release()` turns the question off at once, for a save that then goes back.
 */
export function useFormGuard(dirty: boolean): { release: () => void } {
  const navigation = useNavigation();
  const { t } = useTranslation();
  const dirtyRef = useRef(dirty);
  const released = useRef(false);
  dirtyRef.current = dirty;

  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (released.current || !dirtyRef.current || !isLeavingByHand(event.data.action)) return;
        event.preventDefault();
        void confirm({
          title: t('common.leaveGuard.title'),
          body: t('common.leaveGuard.body'),
          confirmLabel: t('common.leaveGuard.leave'),
          confirmTone: 'danger',
          cancelLabel: t('common.leaveGuard.stay'),
        }).then(({ confirmed }) => {
          if (!confirmed) return;
          released.current = true;
          navigation.dispatch(event.data.action);
        });
      }),
    [navigation, t],
  );

  const release = useCallback(() => {
    released.current = true;
  }, []);
  return { release };
}

/**
 * The header arrow and Android Back go back one step in a multi-step screen (shop spec §3.3): while
 * `step` is above 1, leaving by hand calls `back` instead. On step 1 the screen leaves as usual
 * (through its "Leave without saving?" guard, which the caller keeps quiet on later steps).
 * `release()` lets a screen that saved leave from a later step (its own `goBack`).
 */
export function useStepBack(step: number, back: () => void): { release: () => void } {
  const navigation = useNavigation();
  const stepRef = useRef(step);
  const backRef = useRef(back);
  const released = useRef(false);
  stepRef.current = step;
  backRef.current = back;

  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (released.current || stepRef.current <= 1 || !isLeavingByHand(event.data.action)) return;
        event.preventDefault();
        backRef.current();
      }),
    [navigation],
  );

  const release = useCallback(() => {
    released.current = true;
  }, []);
  return { release };
}

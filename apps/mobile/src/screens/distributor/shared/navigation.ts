import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CommonActions, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { DistributorStackParams } from '../../../navigation/DistributorStack';
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
  const routes = [
    ...state.routes.slice(0, start).map(({ key, name, params }) => ({ key, name, params })),
    { name: 'TopupStatus' as const, params: { id } },
  ];
  navigation.dispatch(CommonActions.reset({ index: routes.length - 1, routes }));
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

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { confirm } from './ConfirmSheet';

/**
 * "Leave without saving?" (UX_MOBILE §2.2 screen rules): while `dirty` is true, leaving the screen
 * (Back, the header arrow, a navigation reset) first asks in a ConfirmSheet. Turn it off after a
 * successful save, before navigating away.
 */
export function useLeaveGuard(dirty: boolean): void {
  const navigation = useNavigation();
  const { t } = useTranslation();

  useEffect(() => {
    if (!dirty) return;
    return navigation.addListener('beforeRemove', (event) => {
      event.preventDefault();
      void confirm({
        title: t('common.leaveGuard.title'),
        body: t('common.leaveGuard.body'),
        confirmLabel: t('common.leaveGuard.leave'),
        confirmTone: 'danger',
        cancelLabel: t('common.leaveGuard.stay'),
      }).then(({ confirmed }) => {
        if (confirmed) navigation.dispatch(event.data.action);
      });
    });
  }, [dirty, navigation, t]);
}

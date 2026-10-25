import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { formatIsoDay } from '@smartfleet/shared-utils';
import { toApiError, type ApiError } from '../../../api/errors';
import { qk } from '../../../api/keys';
import { ConfirmSheet, useToast } from '../../../ui';
import { submitDayEnd } from '../shared/api';
import { shopKeys } from '../shared/keys';

/**
 * [Inc 3] "Send day-end for Thu 22 Oct?" (rule 7: once the office approves, the day is closed): the
 * confirm of S19 at READY and of S20. It sends the uploaded `version`; success refreshes the day
 * ("Waiting for office") with the toast "Sent to the office".
 *
 * - `DAY_VERSION_CHANGED`, `DAY_SHEET_NOT_UPLOADED` and `DAY_ALREADY_SUBMITTED`: the sheet closes, the
 *   day refreshes and `onStale` gets the error (the screen offers "Upload again" or goes back to S19).
 * - No answer: the line above the buttons, and the confirm sends the same version again.
 */
export function SendDaySheet({
  date,
  version,
  visible,
  onClose,
  onSent,
  onStale,
}: {
  date: string;
  version: number;
  visible: boolean;
  onClose: () => void;
  onSent: () => void;
  onStale: (error: ApiError) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();
  return (
    <ConfirmSheet
      visible={visible}
      title={t('dayEnd.send.title', { date: formatIsoDay(date) })}
      body={t('dayEnd.send.body')}
      confirmLabel={t('dayEnd.send.confirm')}
      confirmLoadingLabel={t('dayEnd.send.sending')}
      cancelLabel={t('dayEnd.send.cancel')}
      onClose={onClose}
      onConfirm={async () => {
        try {
          const day = await submitDayEnd(date, version);
          queryClient.setQueryData(qk.dayEnd(date), day);
          queryClient.removeQueries({ queryKey: shopKeys.dayEndUpload(date) });
          toast.show({ message: t('dayEnd.send.done'), tone: 'success' });
          onSent();
        } catch (thrown) {
          const error = toApiError(thrown);
          if (error.code === 'DAY_VERSION_CHANGED' || error.code === 'DAY_SHEET_NOT_UPLOADED' || error.code === 'DAY_ALREADY_SUBMITTED') {
            void queryClient.invalidateQueries({ queryKey: qk.dayEnd(date) });
            onStale(error);
            return;
          }
          throw error;
        }
      }}
      testID="dayEnd.send"
    />
  );
}

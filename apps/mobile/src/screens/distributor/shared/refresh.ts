import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

/**
 * Pull to refresh: `refreshing` is true only while the person's own pull runs, so a background
 * refetch or poll never shows the spinner.
 */
export function usePullRefresh(refetch: () => Promise<unknown>): { refreshing: boolean; onRefresh: () => void } {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refetch()
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  }, [refetch]);
  return { refreshing, onRefresh };
}

/**
 * Refetches when the person comes back to the screen (not on its first mount, which loads anyway),
 * so Home shows a top-up or order made on another screen at once.
 */
export function useRefetchOnReturn(refetch: () => unknown): void {
  const mounted = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!mounted.current) {
        mounted.current = true;
        return;
      }
      void refetch();
    }, [refetch]),
  );
}

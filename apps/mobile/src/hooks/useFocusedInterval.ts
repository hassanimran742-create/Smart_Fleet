import { useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { NavigationContext } from '@react-navigation/native';

/** True while the screen around the caller is focused; true outside a navigator. */
function useScreenFocused(): boolean {
  const navigation = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => navigation?.isFocused() ?? true);

  useEffect(() => {
    if (!navigation) return;
    setFocused(navigation.isFocused());
    const offFocus = navigation.addListener('focus', () => setFocused(true));
    const offBlur = navigation.addListener('blur', () => setFocused(false));
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation]);

  return focused;
}

/** True while the app is in the foreground. */
function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => setActive(status === 'active'));
    return () => subscription.remove();
  }, []);
  return active;
}

/**
 * A polling interval that runs only while the screen is focused and the app is active
 * (UX_MOBILE §3.5). Pass it as React Query's `refetchInterval`:
 *
 *   useQuery({ ..., refetchInterval: useFocusedInterval(POLL_MS.ordersList) })
 *
 * Returns `false` (no polling) when unfocused, in the background or when `enabled` is false.
 */
export function useFocusedInterval(ms: number, enabled = true): number | false {
  const focused = useScreenFocused();
  const active = useAppActive();
  return enabled && focused && active && ms > 0 ? ms : false;
}

import { useCallback } from 'react';
import { useLocation, useMatches, useRouter } from '@tanstack/react-router';
import { stringifySearch } from './search';

/**
 * Closes a drawer route by going to its parent route, keeping the page's tabs and filters
 * (`/orders/abc?tab=all` → `/orders?tab=all`). Drawers are child routes (UX_ADMIN §1.2), so the
 * browser's Back button closes them too.
 */
export function useCloseDrawer(): () => void {
  const router = useRouter();
  const location = useLocation();
  const matches = useMatches();
  return useCallback(() => {
    const parent = matches.length >= 2 ? matches[matches.length - 2] : undefined;
    const path = parent && parent.pathname !== location.pathname ? parent.pathname : '/';
    const search = stringifySearch(location.search as Record<string, unknown>);
    void router.navigate({ href: `${path.replace(/\/+$/, '') || '/'}${search}` });
  }, [location.pathname, location.search, matches, router]);
}

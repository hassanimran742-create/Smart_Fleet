import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { I18nextProvider } from 'react-i18next';
// The design system's stylesheets load first: the router imports every page and its stylesheet, and a
// page's rule must come after the component rule it adjusts (equal specificity: the later one wins).
import './ui/tokens.css';
import './ui/base.css';
import './ui/components.css';
import { toApiError } from './api/errors';
import { createAppRouter } from './app/router';
import i18n from './i18n';
import { useAuthStore } from './store/auth';
import { registerLegacyNavigator } from './store/route';
import { ConfirmProvider } from './ui/ConfirmDialog';
import { ToastProvider } from './ui/Toast';
import './styles.css';

/** GET requests retry twice (UX_ADMIN §1.7); a 4xx is an answer, so it is never retried. */
function retryQuery(failureCount: number, error: unknown): boolean {
  const status = toApiError(error).status;
  if (status !== null && status >= 400 && status < 500) return false;
  return failureCount < 2;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Off by default; queue pages (top-ups, orders, the summary) turn it on (UX_ADMIN §1.7).
      refetchOnWindowFocus: false,
      retry: retryQuery,
      // Offline is shown as an error with "Try again", never as a request that silently waits.
      networkMode: 'always',
    },
    mutations: {
      // Mutations never retry by themselves; "Try again" reuses the same Idempotency-Key.
      retry: false,
      networkMode: 'always',
    },
  },
});

const router = createAppRouter(queryClient);

// Old screens navigate with `useRouteStore().go('drivers')`; send those through the router.
registerLegacyNavigator((href) => {
  void router.navigate({ href });
});

// After sign-out, forget everything the previous session loaded (once the screens have unmounted).
useAuthStore.subscribe((state, previous) => {
  if (previous.token && !state.token) window.setTimeout(() => queryClient.clear(), 0);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ConfirmProvider>
            <RouterProvider router={router} />
          </ConfirmProvider>
        </ToastProvider>
      </QueryClientProvider>
    </I18nextProvider>
  </React.StrictMode>,
);

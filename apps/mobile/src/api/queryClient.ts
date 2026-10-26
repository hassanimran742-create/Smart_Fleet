import { AppState, Platform, type AppStateStatus } from 'react-native';
import { focusManager, QueryClient } from '@tanstack/react-query';
import { useAppStatusStore } from '../store/appStatus';
import { toApiError } from './errors';
import { qk } from './keys';

/** Queries retry twice, only for retryable errors (no response, 5xx): after 1 s, then 2 s (cap 4 s). */
const QUERY_RETRIES = 2;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => failureCount < QUERY_RETRIES && toApiError(error).retryable,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
        refetchOnReconnect: true,
        // "Window focus" is the app returning to the foreground (see bindAppStateFocus).
        refetchOnWindowFocus: true,
      },
      // The person retries a failed action by hand, with the same idempotency key.
      mutations: { retry: 0 },
    },
  });
}

/** The app's one query cache. Cleared on sign-out so the next account never sees the last one's data. */
export const queryClient = createQueryClient();

/** The public `GET /app/config` answer is not account data, so it survives a sign-out. */
const PUBLIC_QUERY_ROOTS: ReadonlySet<unknown> = new Set([qk.appConfig[0]]);

/**
 * Forgets every cached answer (and, unless `keepMutations`, every recorded action) of the signed-in
 * account. Sign-in keeps its own running mutation.
 */
export function clearAccountData(options: { keepMutations?: boolean } = {}, client: QueryClient = queryClient): void {
  const isAccountQuery = (query: { queryKey: readonly unknown[] }) => !PUBLIC_QUERY_ROOTS.has(query.queryKey[0]);
  void client.cancelQueries({ predicate: isAccountQuery });
  client.removeQueries({ predicate: isAccountQuery });
  if (!options.keepMutations) client.getMutationCache().clear();
}

/**
 * Drives React Query's focus from AppState (UX_MOBILE §3.5): stale queries refetch when the app
 * comes back to the foreground, and polling pauses in the background. Returns the unsubscribe.
 */
export function bindAppStateFocus(): () => void {
  if (Platform.OS === 'web') return () => undefined;
  const onChange = (status: AppStateStatus) => focusManager.setFocused(status === 'active');
  const subscription = AppState.addEventListener('change', onChange);
  return () => subscription.remove();
}

/**
 * Refetches stale on-screen queries when the network comes back. Until the 0.2.0 APK adds NetInfo,
 * "back" means a request got a response after a network failure. Returns the unsubscribe.
 */
export function bindReconnectRefetch(client: QueryClient = queryClient): () => void {
  return useAppStatusStore.subscribe((state, previous) => {
    if (previous.lastNetworkErrorAt !== null && state.lastNetworkErrorAt === null) {
      void client.refetchQueries({ type: 'active', stale: true });
    }
  });
}

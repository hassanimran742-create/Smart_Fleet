import { useCallback, useRef } from 'react';
import { useMutation, type UseMutationOptions, type UseMutationResult } from '@tanstack/react-query';
import { ApiError, toApiError } from './errors';
import { newUuid } from './ids';

/** What `mutationFn` receives besides the variables. Spread `headers` into the request config. */
export interface ApiMutationContext {
  /** The dialog's Idempotency-Key, when the mutation is `idempotent`. */
  idempotencyKey: string | undefined;
  /** `{ 'Idempotency-Key': key }`, or `{}`. */
  headers: Record<string, string>;
}

export interface UseApiMutationOptions<TData, TVariables, TOnMutateResult>
  extends Omit<UseMutationOptions<TData, ApiError, TVariables, TOnMutateResult>, 'mutationFn' | 'retry'> {
  mutationFn: (variables: TVariables, context: ApiMutationContext) => Promise<TData>;
  /**
   * Sends an `Idempotency-Key` (API_CONTRACT §4.2). One key is made when the component mounts (the
   * dialog opens), reused on every retry, and replaced after a success or by `resetKey()`; it is dropped
   * when the component unmounts. A retried approval can never add money twice.
   */
  idempotent?: boolean;
}

export type UseApiMutationResult<TData, TVariables, TOnMutateResult> = UseMutationResult<
  TData,
  ApiError,
  TVariables,
  TOnMutateResult
> & {
  /** The key the next attempt will send (undefined unless `idempotent`). */
  idempotencyKey: string | undefined;
  /** Starts a new action: the next attempt gets a new Idempotency-Key. */
  resetKey: () => void;
};

/**
 * `useMutation` for API writes (UX_ADMIN §1.7): errors are always {@link ApiError}s, a mutation never
 * retries by itself (the person presses "Try again", which reuses the key), and `idempotent` adds the
 * Idempotency-Key header.
 *
 * ```ts
 * const approve = useApiMutation({
 *   idempotent: true,
 *   mutationFn: (body: ApproveTopupInput, { headers }) =>
 *     api.post(`/payments/${id}/approve`, body, { headers }).then((r) => r.data),
 *   onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.topups.all }),
 * });
 * ```
 */
export function useApiMutation<TData = unknown, TVariables = void, TOnMutateResult = unknown>(
  options: UseApiMutationOptions<TData, TVariables, TOnMutateResult>,
): UseApiMutationResult<TData, TVariables, TOnMutateResult> {
  const { mutationFn, idempotent = false, onSuccess, ...rest } = options;
  const keyRef = useRef<string | undefined>(undefined);
  if (idempotent && keyRef.current === undefined) keyRef.current = newUuid();

  const resetKey = useCallback(() => {
    keyRef.current = idempotent ? newUuid() : undefined;
  }, [idempotent]);

  const mutation = useMutation<TData, ApiError, TVariables, TOnMutateResult>({
    ...rest,
    retry: false,
    mutationFn: async (variables) => {
      const key = idempotent ? (keyRef.current ??= newUuid()) : undefined;
      try {
        return await mutationFn(variables, { idempotencyKey: key, headers: key ? { 'Idempotency-Key': key } : {} });
      } catch (error) {
        throw toApiError(error);
      }
    },
    onSuccess: (...args) => {
      // The action is done: anything sent next is a new action with a new key.
      if (idempotent) keyRef.current = newUuid();
      return onSuccess?.(...args);
    },
  });

  return Object.assign(mutation, { idempotencyKey: keyRef.current, resetKey });
}

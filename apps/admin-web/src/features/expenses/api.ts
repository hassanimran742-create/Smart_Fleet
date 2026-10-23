import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExpenseDto, ExpenseSummary, ExpenseTypeDto, Page } from '@smartfleet/shared-types';
import type { CreateExpenseInput, UpdateExpenseInput } from '@smartfleet/shared-validation';
import { api } from '../../api/client';
import { qk } from '../../api/keys';
import { useApiMutation } from '../../api/useApiMutation';

/**
 * Queries and mutations of the Expenses page (API_CONTRACT §7.12). Every key is a leaf of
 * `qk.expenses`, so one invalidation of `qk.expenses.all` refreshes the list, the totals and the types.
 */

/** The list and summary filters, as the API takes them (inclusive `YYYY-MM-DD` dates). */
export interface ExpenseFilters {
  from: string;
  to: string;
  typeId?: string;
  vehicleId?: string;
  driverId?: string;
  includeVoided?: boolean;
}

const PAGE_SIZE = 30;

/** `GET /expense-types?includeArchived=true`: every type, so archived names still show on old rows. */
export function useExpenseTypes() {
  return useQuery({
    queryKey: qk.expenses.types({ includeArchived: true }),
    queryFn: async ({ signal }) =>
      (await api.get<ExpenseTypeDto[]>('/expense-types', { params: { includeArchived: true }, signal })).data,
    placeholderData: keepPreviousData,
  });
}

/** `GET /expenses/summary?from&to`: totals by type and month, plus the drivers' fuel logs. */
export function useExpenseSummary(range: { from: string; to: string }) {
  return useQuery({
    queryKey: qk.expenses.summary(range),
    queryFn: async ({ signal }) => (await api.get<ExpenseSummary>('/expenses/summary', { params: range, signal })).data,
    placeholderData: keepPreviousData,
  });
}

/** `GET /expenses` with cursor pages ("Load more"). */
export function useExpenseList(filters: ExpenseFilters) {
  return useInfiniteQuery({
    queryKey: qk.expenses.list({ ...filters }),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) =>
      (
        await api.get<Page<ExpenseDto>>('/expenses', {
          params: {
            from: filters.from,
            to: filters.to,
            typeId: filters.typeId,
            vehicleId: filters.vehicleId,
            driverId: filters.driverId,
            includeVoided: filters.includeVoided ? true : undefined,
            limit: PAGE_SIZE,
            cursor: pageParam ?? undefined,
          },
          signal,
        })
      ).data,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });
}

/** A van as the picker needs it (`GET /vehicles`). */
export interface VanOption {
  id: string;
  plateNo: string;
}

/** A driver as the picker needs it (`GET /drivers`: the office view carries `user.name`). */
export interface DriverOption {
  id: string;
  name: string;
}

const LISTS_STALE_MS = 5 * 60_000;

export function useVans() {
  return useQuery({
    queryKey: [...qk.expenses.all, 'vans'] as const,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<Array<{ id: string; plateNo: string }>>('/vehicles', { signal });
      return data
        .map((van): VanOption => ({ id: van.id, plateNo: van.plateNo }))
        .sort((a, b) => a.plateNo.localeCompare(b.plateNo));
    },
    staleTime: LISTS_STALE_MS,
  });
}

export function useDrivers() {
  return useQuery({
    queryKey: [...qk.expenses.all, 'drivers'] as const,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<Array<{ id: string; name?: string; user?: { name?: string } }>>('/drivers', { signal });
      return data
        .map((driver): DriverOption => ({ id: driver.id, name: driver.user?.name ?? driver.name ?? '' }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    staleTime: LISTS_STALE_MS,
  });
}

/** One fuel log inside a van's bucket of `GET /reports/fuel-consumption` (reports.service.ts). */
export interface FuelLog {
  id: string;
  driverName: string;
  litres: number;
  costPaisa: string;
  odometerKm: number;
  fuelStation: string | null;
  refillAt: string;
}

export interface FuelVanReport {
  vehicleId: string;
  plateNo: string;
  refills: FuelLog[];
}

/** `GET /reports/fuel-consumption?since` (office): per van, every log since the instant. */
export function useFuelConsumption(sinceIso: string) {
  return useQuery({
    queryKey: [...qk.expenses.all, 'fuel-logs', sinceIso] as const,
    queryFn: async ({ signal }) =>
      (await api.get<FuelVanReport[]>('/reports/fuel-consumption', { params: { since: sinceIso }, signal })).data,
    placeholderData: keepPreviousData,
  });
}

/** Refreshes everything the page shows after a write. */
export function useInvalidateExpenses(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: qk.expenses.all });
  };
}

/** `POST /expenses` with an Idempotency-Key (one per drawer; a retry reuses it). */
export function useCreateExpense() {
  return useApiMutation({
    idempotent: true,
    mutationFn: (body: CreateExpenseInput, { headers }) => api.post<ExpenseDto>('/expenses', body, { headers }).then((r) => r.data),
  });
}

/** `PATCH /expenses/:id` with the changed fields only. */
export function useUpdateExpense(id: string | null) {
  return useApiMutation({
    mutationFn: (body: UpdateExpenseInput) => api.patch<ExpenseDto>(`/expenses/${id}`, body).then((r) => r.data),
  });
}

/** `POST /expenses/:id/void { reason }`. */
export function voidExpense(id: string, reason: string): Promise<ExpenseDto> {
  return api.post<ExpenseDto>(`/expenses/${id}/void`, { reason }).then((r) => r.data);
}

export function useCreateExpenseType() {
  return useApiMutation({
    mutationFn: (name: string) => api.post<ExpenseTypeDto>('/expense-types', { name }).then((r) => r.data),
  });
}

export function useRenameExpenseType() {
  return useApiMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch<ExpenseTypeDto>(`/expense-types/${id}`, { name }).then((r) => r.data),
  });
}

export function useArchiveExpenseType() {
  return useApiMutation({
    mutationFn: ({ id, archive }: { id: string; archive: boolean }) =>
      api.post<ExpenseTypeDto>(`/expense-types/${id}/${archive ? 'archive' : 'restore'}`).then((r) => r.data),
  });
}

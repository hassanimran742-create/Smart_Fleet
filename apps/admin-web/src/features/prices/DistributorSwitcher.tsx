import { useNavigate } from '@tanstack/react-router';
import { CircleAlert, CircleCheck } from 'lucide-react';
import type { DistributorDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { FilterChips, SearchSelect } from '../../ui';

/** Up to this many distributors show as chips; more show as a search box (website spec W15, §1.4). */
const CHIPS_MAX = 6;

export interface SwitcherOption {
  id: string;
  name: string;
  priced: number;
  total: number;
}

/** The switcher's options; the open distributor's coverage comes from its grid, which is the freshest. */
export function switcherOptions(
  directory: readonly DistributorDto[],
  current: { id: string; name: string; coverage: { priced: number; total: number } } | null,
): SwitcherOption[] {
  const options = directory.map((d) => ({ id: d.id, name: d.businessName, priced: d.prices.priced, total: d.prices.total }));
  if (!current) return options;
  const known = options.some((option) => option.id === current.id);
  const merged = options.map((option) =>
    option.id === current.id ? { ...option, priced: current.coverage.priced, total: current.coverage.total } : option,
  );
  return known ? merged : [{ id: current.id, name: current.name, ...current.coverage }, ...merged];
}

export interface DistributorSwitcherProps {
  options: readonly SwitcherOption[];
  currentId: string;
}

/**
 * Whose prices the grid shows (W15): one chip per distributor with a red "1 missing" or a green tick
 * and "All set", or a search box when there are more than 6. The choice stays in the URL.
 */
export function DistributorSwitcher({ options, currentId }: DistributorSwitcherProps) {
  const { t } = useTranslation('prices');
  const navigate = useNavigate();
  if (options.length === 0) return null;

  const go = (distributorId: string) => {
    if (distributorId !== currentId) void navigate({ to: '/prices/$distributorId', params: { distributorId }, search: true });
  };
  const missingOf = (option: SwitcherOption) => Math.max(0, option.total - option.priced);
  const stateOf = (option: SwitcherOption): string | null => {
    if (option.total === 0) return null;
    const missing = missingOf(option);
    return missing > 0 ? t('switcher.missing', { count: missing }) : t('switcher.complete');
  };

  if (options.length <= CHIPS_MAX) {
    return (
      <FilterChips
        label={t('switcher.label')}
        className="sf-prices__switcher"
        options={options.map((option) => {
          const state = stateOf(option);
          const missing = missingOf(option) > 0;
          const Icon = missing ? CircleAlert : CircleCheck;
          return {
            value: option.id,
            label: option.name,
            meta: state ? (
              <span className="sf-prices__state">
                <Icon aria-hidden size={14} strokeWidth={2.25} />
                {state}
              </span>
            ) : undefined,
            metaTone: missing ? ('danger' as const) : ('success' as const),
          };
        })}
        value={currentId}
        onChange={go}
      />
    );
  }

  return (
    <div className="sf-prices__switcher sf-prices__switcher--search">
      <SearchSelect
        label={t('switcher.label')}
        options={options.map((option) => {
          const state = stateOf(option);
          return { value: option.id, label: state ? t('switcher.option', { name: option.name, state }) : option.name };
        })}
        value={currentId}
        onChange={(id) => {
          if (id) go(id);
        }}
      />
    </div>
  );
}

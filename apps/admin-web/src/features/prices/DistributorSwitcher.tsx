import { Link, useNavigate } from '@tanstack/react-router';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import type { DistributorDto } from '@smartfleet/shared-types';
import { useTranslation } from 'react-i18next';
import { cx, Field, Select } from '../../ui';

/** Up to this many distributors show as a segmented control; more show as a Select (UX_ADMIN §2.3). */
const SEGMENTED_MAX = 4;

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

/** "8/10" with a warning icon when a zone has no price, or a check when all do (never colour alone). */
function Coverage({ priced, total }: { priced: number; total: number }) {
  const { t } = useTranslation('prices');
  const missing = priced < total;
  const Icon = missing ? TriangleAlert : CircleCheck;
  return (
    <span className={cx('sf-prices__coverage', missing ? 'is-missing' : 'is-complete')}>
      <Icon aria-hidden size={14} strokeWidth={2.25} />
      <span aria-hidden>{t('switcher.coverage', { priced, total })}</span>
      <span className="sr-only">{t('switcher.coverageLabel', { priced, total })}</span>
    </span>
  );
}

export interface DistributorSwitcherProps {
  options: readonly SwitcherOption[];
  currentId: string;
}

/** Picks whose prices the grid shows, with each distributor's coverage. */
export function DistributorSwitcher({ options, currentId }: DistributorSwitcherProps) {
  const { t } = useTranslation('prices');
  const navigate = useNavigate();
  if (options.length === 0) return null;

  if (options.length <= SEGMENTED_MAX) {
    return (
      <nav className="sf-prices__switcher" aria-label={t('switcher.label')}>
        <ul className="sf-prices__segments">
          {options.map((option) => (
            <li key={option.id}>
              <Link
                to="/prices/$distributorId"
                params={{ distributorId: option.id }}
                search={true}
                className={cx('sf-prices__segment', option.id === currentId && 'is-current')}
                aria-current={option.id === currentId ? 'page' : undefined}
              >
                <span className="sf-prices__segment-name">{option.name}</span>
                <Coverage priced={option.priced} total={option.total} />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    );
  }

  return (
    <Field label={t('switcher.label')} className="sf-prices__switcher-select">
      <Select
        value={currentId}
        options={options.map((option) => ({
          value: option.id,
          label: t('switcher.option', { name: option.name, priced: option.priced, total: option.total }),
        }))}
        onChange={(event) =>
          void navigate({ to: '/prices/$distributorId', params: { distributorId: event.target.value }, search: true })
        }
      />
    </Field>
  );
}

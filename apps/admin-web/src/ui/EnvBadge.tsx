import { FlaskConical, GraduationCap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { EnvKind } from '../app/env';
import { cx } from './cx';

/**
 * The strip above the top bar on non-live servers (UX_ADMIN §2.10): test is "Test server — not real
 * money" (info), training is "Training — dummy bank details, no real money" (warning), live shows nothing.
 */
export function EnvBadge({ kind, className }: { kind: EnvKind; className?: string }) {
  const { t } = useTranslation();
  if (kind === 'live') return null;
  const Icon = kind === 'training' ? GraduationCap : FlaskConical;
  return (
    <div className={cx('sf-env', `sf-env--${kind}`, className)} role="note">
      <Icon aria-hidden size={16} strokeWidth={2} />
      <span>{kind === 'training' ? t('env.training') : t('env.test')}</span>
    </div>
  );
}

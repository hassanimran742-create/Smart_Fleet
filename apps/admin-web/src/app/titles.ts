import { useEffect } from 'react';
import { useMatches } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { resolveEnvKind } from './env';
import './routeMeta';

/**
 * The current page's title (`nav:pages.<titleKey>` of the deepest titled route), "Page not found" for
 * an unknown address, or null. The top bar under 1024 px shows it; the browser tab uses it too.
 */
export function usePageTitle(): string | null {
  const matches = useMatches();
  const { t } = useTranslation('nav');
  if (matches.some((match) => match.globalNotFound || match.status === 'notFound')) return t('pages.notFound');
  const titleKey = [...matches].reverse().find((m) => m.staticData?.titleKey)?.staticData.titleKey;
  return titleKey ? t(`pages.${titleKey}`) : null;
}

/**
 * Keeps the browser tab's title current (UX_ADMIN §1.3): "(5) Top-ups · Smart Fleet Office", where 5 is
 * the Today badge (top-ups to check + orders needing a driver, plus open customer problems from Inc 2;
 * see NavBadgeCounts.waiting), and "[TEST] …" on every server that isn't live.
 */
export function useDocumentTitle(waiting: number, serverEnvironment?: Parameters<typeof resolveEnvKind>[0]): void {
  const { t } = useTranslation(['common', 'nav']);
  const page = usePageTitle();
  const env = resolveEnvKind(serverEnvironment);

  useEffect(() => {
    const app = t('appName');
    let title: string = page ? t('documentTitle.page', { page, app }) : app;
    if (waiting > 0) title = t('documentTitle.waiting', { count: waiting, title });
    if (env !== 'live') title = t('documentTitle.env', { prefix: t('env.titlePrefix'), title });
    document.title = title;
  }, [env, page, t, waiting]);
}

import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { useRouter } from '@tanstack/react-router';

/**
 * An in-app link to a path known only at run time (a breadcrumb's parent page). It navigates through
 * the router on a plain click and keeps Ctrl/Cmd-click and middle-click opening a new tab. For links to
 * a known route use `<Link to>` or `<ButtonLink>`, which are type-checked.
 */
export function HrefLink({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const router = useRouter();
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    void router.navigate({ href });
  };
  return <a {...rest} href={href} onClick={handleClick} />;
}

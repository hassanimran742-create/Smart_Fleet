import type { ReactNode } from 'react';
import { LoginPage, RoleGatePage } from '../features/auth';
import { isOfficeRole, useAuthStore } from '../store/auth';

/**
 * The office gate (UX_ADMIN §2.10): no session shows the sign-in page, a signed-in account that isn't
 * SUPER_ADMIN sees the role-gate page, and only the office gets the app. It never changes the URL, so
 * after signing in the person is exactly where they meant to go (a link to a top-up opens that top-up).
 * The server checks the role on every request too; this only decides what to show.
 */
export function RequireStaff({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.role);
  if (!token) return <LoginPage />;
  if (!isOfficeRole(role)) return <RoleGatePage />;
  return <>{children}</>;
}

/**
 * Sign-in, the role gate and the session pages (UX_ADMIN §2.10). Owned by the admin-web-ops lane.
 *
 * Contract with app/RequireStaff.tsx (foundation), which shows these instead of the shell:
 * - `LoginPage`: shown whenever there is no session, at any URL, so after signing in the person lands
 *   where they were going. It starts the session with `useAuthStore.getState().set(...)` after
 *   `POST /auth/login` and shows `<SessionEndedNotice />` (why the last session ended) at the top.
 * - `RoleGatePage`: shown to a signed-in account that isn't SUPER_ADMIN (a saved session only: the
 *   server refuses such accounts at sign-in).
 */
export { LoginPage } from './LoginPage';
export { RoleGatePage } from './RoleGatePage';

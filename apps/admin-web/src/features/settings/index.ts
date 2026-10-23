/**
 * Settings (UX_ADMIN §2.8). Owned by the admin-web-money lane.
 *
 * Contract with app/router.tsx (foundation): `SettingsPage` is the component of `/settings` (route id
 * '/settings'); search `SettingsSearch` from app/search.ts (`section`, so "Open settings" on a switched-off
 * module can link to `?section=modules`). A save invalidates `qk.appConfig()`, so the navigation follows
 * the module switches straight away.
 *
 * `settingLabel` and `formatSettingValue` put a setting and its value into words; the Activity log uses
 * them too.
 */
export { SettingsPage } from './SettingsPage';
export { formatSettingValue, settingLabel } from './values';

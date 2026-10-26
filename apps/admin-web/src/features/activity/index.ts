/**
 * Activity log (website spec W40, UX_ADMIN §2.9). Owned by the admin-web-money lane.
 *
 * Contract with app/router.tsx (foundation): `ActivityPage` is the component of `/activity` (route id
 * '/activity'); search `ActivitySearch` from app/search.ts (`what`, `who`, `from`, `to`).
 *
 * The sentences live in i18n/en/activity.ts. The shared `<ActivityList />` in src/ui renders them for any
 * record drawer; `activityLine(row, context)` is the page's sentence, which also names the distributor
 * and puts a setting's values in words.
 */
export { ActivityPage } from './ActivityPage';
export { activityLine, activityTarget, activityWhy, areaOf } from './sentences';
export type { ActivityContext, ActivityTarget } from './sentences';

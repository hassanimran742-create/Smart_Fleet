/**
 * Activity log (UX_ADMIN §2.9). Owned by the admin-web-money lane.
 *
 * Contract with app/router.tsx (foundation): `ActivityPage` is the component of `/activity` (route id
 * '/activity'); search `ActivitySearch` from app/search.ts (`what`, `who`, `from`, `to`).
 *
 * The sentences live in i18n/en/activity.ts. The shared `<ActivityList />` in src/ui renders them for any
 * record drawer; `RecordActivity` is this lane's version for its own drawers, which also names the
 * distributor and puts a reason code into words. `activityLine(row, context)` is the page's sentence.
 */
export { ActivityPage } from './ActivityPage';
export { RecordActivity } from './RecordActivity';
export type { RecordActivityProps } from './RecordActivity';
export { activityLine, activityWhy, areaOf } from './sentences';
export type { ActivityContext } from './sentences';

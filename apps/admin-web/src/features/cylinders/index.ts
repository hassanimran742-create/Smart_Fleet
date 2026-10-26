/**
 * Find cylinder (UX_ADMIN §3.5, Inc 2). Owned by the office UI lane.
 *
 * - `CylinderPage`: `/cylinders/find/$number` (route id '/cylinders/find/$number').
 * - `FindCylinderBox`: the search box. Its place is the top of the menu, under the product name
 *   (`<FindCylinderBox tone="nav" onNavigate={onNavigate} />` in components/Sidebar.tsx); the cylinder
 *   page also shows one in its header.
 * - The history lookup is shared with the office's manual delivery, which checks each number as it is named.
 */
export { cylinderKeys, fetchCylinderHistory, useCylinderHistory } from './api';
export { codeOfNumber, readCylinderNumber, type TypedCylinder } from './code';
export { CylinderPage } from './CylinderPage';
export { FindCylinderBox, type FindCylinderBoxProps } from './FindCylinderBox';

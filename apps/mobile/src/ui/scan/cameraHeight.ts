/**
 * The camera's height: 28% of the window, between 160 and 300 dp (driver spec §1.2). `short` is take
 * back's (18%, between 112 and 220 dp): that step also holds the state tap and, right under it, the
 * result strip above the camera (review23 ux-03), and the whole camera still fits above the footer on a
 * 360×640 phone.
 *
 * Plain logic with no imports, so the API's unit tests can check it.
 */
export function cameraHeightFor(windowHeight: number, short = false): number {
  const [share, min, max] = short ? [0.18, 112, 220] : [0.28, 160, 300];
  return Math.round(Math.min(Math.max(windowHeight * share, min), max));
}

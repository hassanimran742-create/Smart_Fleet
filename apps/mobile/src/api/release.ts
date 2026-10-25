/**
 * The version of this JavaScript release, sent as `X-App-Version` (API_CONTRACT §1.2, §6) and compared
 * with `app.minVersion.<variant>` by the update gate on both sides.
 *
 * Over-the-air updates keep the installed APK's native version (app.config.ts `version`, which
 * `runtimeVersion` follows, so it must stay "0.1.0" for the update to reach the installed phones). Read
 * from the binary, the new JS would report "0.1.0" like the JS it replaces, and no `app.minVersion` could
 * stop the old screens (review23 contract-compat-02). So the JS names its own release:
 * - bump it with every over-the-air release;
 * - the switch-over then raises `app.minVersion.driver` and `.distributor` to it, once every pilot phone
 *   shows it on Help ("App version 0.1.1").
 * appInfo.ts `APP_VERSION` takes the later of this and the native version, so a newer APK never reports
 * less than its own version.
 *
 * This file imports nothing, so the API's unit tests can read it.
 */
export const JS_RELEASE_VERSION = '0.1.1';

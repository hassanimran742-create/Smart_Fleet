/**
 * The headers the Inc 2/3 phone apps send on every call (apps/mobile/src/api/client.ts `appHeaders`): the
 * variant and the over-the-air JS's own release (apps/mobile/src/api/release.ts, API_CONTRACT §1.2, §6).
 *
 * A call with neither header is the installed 0.1.0 JS. The server answers it 426 APP_RESTART_TO_UPDATE
 * on the routes only the Inc 2/3 apps may use (`@NewAppOnly`, such as `POST /filling-orders`, Appendix A)
 * and in place of its dead ends (review23 contract-compat-01), so a suite that plays the Inc 2/3 apps on
 * those routes sends these:
 *
 *   await http(app).post(`${API}/filling-orders`).set(authHeader(std.DA.actor)).set(NEW_SHOP_APP).send(body);
 */
import { JS_RELEASE_VERSION } from '../../../mobile/src/api/release';

/** The Inc 2/3 shop app (over the air). */
export const NEW_SHOP_APP: Record<string, string> = { 'X-App-Variant': 'distributor', 'X-App-Version': JS_RELEASE_VERSION };

/** The Inc 2/3 driver app (over the air). */
export const NEW_DRIVER_APP: Record<string, string> = { 'X-App-Variant': 'driver', 'X-App-Version': JS_RELEASE_VERSION };

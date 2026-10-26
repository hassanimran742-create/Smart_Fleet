/**
 * REVIEW23 ux-11 (the app's part): a phone number never breaks across two lines in the shop and driver
 * apps. At font 1.3 the shop's order read "Bilal Khan · 0302" / "3334455", easy to misread aloud or copy
 * wrong. The apps now write the number with a no-break space ("0302 3334455"), so a line wraps
 * before it instead. Display only: tel: links use the E.164 value, and the shared parser reads the
 * written form back. The customer page's call rows are the server's part of this finding.
 */
import * as fs from 'fs';
import * as path from 'path';
import { normalizePkPhone } from '@smartfleet/shared-utils';

const MOBILE_SRC = path.resolve(__dirname, '..', '..', '..', '..', 'mobile', 'src');

/* eslint-disable @typescript-eslint/no-var-requires */
const { phoneText } = require(path.join(MOBILE_SRC, 'screens', 'distributor', 'shared', 'format.ts')) as typeof import('../../../../mobile/src/screens/distributor/shared/format');
const { keepTogether } = require(path.join(MOBILE_SRC, 'ui', 'keepTogether.ts')) as typeof import('../../../../mobile/src/ui/keepTogether');
/* eslint-enable @typescript-eslint/no-var-requires */

const NBSP = ' ';

describe('REV23 ux-11 Phone numbers stay on one line in the apps', () => {
  it('REV23 ux-11 the shop\'s phone text joins the two halves with a no-break space', () => {
    expect(phoneText('+923023334455')).toBe(`0302${NBSP}3334455`);
    expect(phoneText('+923023334455')).not.toContain(' ');
    expect(phoneText(null)).toBe('');
    // Not a Pakistani mobile: as stored, and still kept together.
    expect(phoneText('042 3576 1234')).toBe(`042${NBSP}3576${NBSP}1234`);
  });

  it('REV23 ux-11 the written form reads back to the same number (search, paste and tel: are unaffected)', () => {
    expect(normalizePkPhone(phoneText('+923023334455'))).toBe('+923023334455');
    expect(normalizePkPhone(keepTogether('0300 1112233'))).toBe('+923001112233');
  });

  it('REV23 ux-11 every place the apps print a number uses it', () => {
    const read = (relative: string) => fs.readFileSync(path.join(MOBILE_SRC, relative), 'utf8');
    // The shop's rows and order detail go through phoneText.
    for (const file of ['screens/distributor/OrderDetailScreen.tsx', 'screens/distributor/NewOrderScreen.tsx', 'screens/distributor/shared/CustomerList.tsx']) {
      expect(read(file)).toMatch(/phoneText\(/);
    }
    // The customer answer card prints the server's number: kept together too.
    const answer = read('screens/distributor/confirm/CustomerAnswer.tsx');
    expect(answer.match(/phone: keepTogether\(line\.phone\)/g)?.length).toBe(3);
    expect(answer).not.toMatch(/phone: line\.phone\b/);
    // The driver's Help and the shop's menu header.
    expect(read('screens/driver/HelpScreen.tsx').match(/keepTogether\(formatPkPhone\(/g)?.length).toBe(2);
    expect(read('navigation/menus/distributorMenu.ts')).toMatch(/keepTogether\(formatPkPhone\(me\.data\.phone\)\)/);
  });
});

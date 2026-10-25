/**
 * REV23 ux-11: on the customer page at 360 px "Wrong? Call Ahmed Gas · 0321" / "1234567" broke across two
 * lines, easy to misread or mistype for an elderly customer. The number now sits in a no-wrap span; the
 * label may still wrap before it, and the tap target and the tel: link are unchanged.
 */
import { callRow } from '../../src/modules/confirmation/page/templates';
import { PAGE_CSS } from '../../src/modules/confirmation/page/tokens';

describe('REV23 ux-11 the customer page keeps a phone number on one line', () => {
  it('REV23 ux-11 the call row puts the number in a no-wrap span', () => {
    const html = callRow('Wrong? Call Ahmed Gas', '+923211234567');
    expect(html).toContain('href="tel:+923211234567"');
    expect(html).toContain('<span class="nw">0321 1234567</span>');
    expect(html.replace(/<[^>]+>/g, '')).toBe('Wrong? Call Ahmed Gas · 0321 1234567');
    expect(PAGE_CSS).toContain('.nw{white-space:nowrap}');
    expect(callRow('Call', null)).toBe('');
  });
});

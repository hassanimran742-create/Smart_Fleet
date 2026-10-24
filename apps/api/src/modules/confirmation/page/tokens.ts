/**
 * The customer page's design tokens, injected as literal values (CUSTOMER_PAGE §6, UX spec
 * customer-and-inc23.md §1.0): no CSS variables, no flex `gap`, no web fonts, so the page works on
 * Opera Mini, KaiOS and old Android WebViews. The colours match the app palette, tuned to AA:
 *
 * | Token | Value | Use |
 * |---|---|---|
 * | bg / surface | #F4F5F9 / #FFFFFF | page / card |
 * | ink / inkMuted | #1F2025 / #4B5563 | text / secondary |
 * | line / field | #E3E4E8 / #6B6F76 | dividers / input border |
 * | positive | #15803D | All received, Send |
 * | danger | #B91C1C | Not received |
 * | link / focus | #0A55C4 / #0F6CF0 | links / 3 px focus outline |
 * | tagBg / tagInk | #EEF0F4 / #374151 | state tags, the neutral status mark |
 * | safetyBg / safetyInk | #FEF3C7 / #78350F | the gas safety note, the test strip |
 * | okBg / okInk | #E5F6EE / #166534 | the green status mark |
 *
 * Type: base 18 px, line height 1.5, the system font stack; h1 26 px; small 15 px. Layout: at most
 * 480 px wide with a 16 px gutter; card radius 14, control radius 12. The answer buttons and Send are
 * at least 64 px high and full width; text links at least 48 px.
 */
export const PAGE_CSS = [
  '*{box-sizing:border-box}',
  'body{margin:0;background:#F4F5F9;color:#1F2025;font:18px/1.5 -apple-system,"Segoe UI",Roboto,"Noto Sans",Arial,sans-serif;-webkit-text-size-adjust:100%}',
  // 30rem is the 480 px column at the default root size (written in rem so no amount-like 480 is on the page).
  '.w{max-width:30rem;margin:0 auto;padding:16px}',
  '.c{background:#FFF;border:1px solid #E3E4E8;border-radius:14px;padding:20px 16px;margin:0 0 16px}',
  '.s{margin:0 0 4px;font-size:15px;font-weight:700;color:#4B5563}',
  'h1{margin:0 0 6px;font-size:26px;line-height:1.25}',
  '.m,.f{margin:0 0 12px;color:#4B5563;font-size:15px}',
  '.tag{display:inline-block;font-style:normal;font-size:15px;font-weight:700;padding:2px 10px;margin:0 2px;border-radius:999px;background:#EEF0F4;color:#374151}',
  '.sum{width:100%;border-collapse:collapse;margin:12px 0 4px}',
  '.sum th{width:34%;padding:8px 12px 8px 0;text-align:left;vertical-align:top;font-size:15px;color:#4B5563}',
  '.sum td{padding:8px 0;font-weight:700}',
  '.sum tr+tr th,.sum tr+tr td{border-top:1px solid #E3E4E8}',
  '.b{display:block;width:100%;min-height:64px;margin:0 0 12px;padding:14px 16px;border:2px solid #1F2025;border-radius:12px;background:#FFF;color:#1F2025;font:inherit;font-weight:700;text-align:center;text-decoration:none}',
  '.p{background:#15803D;border-color:#15803D;color:#FFF}',
  '.d{border-color:#B91C1C;color:#B91C1C}',
  '.dp{background:#B91C1C;border-color:#B91C1C;color:#FFF}',
  '.b svg,.blk svg,.call svg,h1 svg{vertical-align:middle;margin:0 10px 0 0}',
  '.blk{display:block;text-align:center;min-height:48px;padding:12px 0;color:#0A55C4;font-weight:700}',
  '.call{display:block;min-height:48px;padding:12px 0;color:#0A55C4;font-weight:700;text-decoration:none}',
  'a:focus,button:focus,textarea:focus{outline:3px solid #0F6CF0;outline-offset:2px}',
  'label{display:block;font-weight:700;margin:12px 0 6px}',
  'textarea{display:block;width:100%;min-height:120px;padding:12px;border:2px solid #6B6F76;border-radius:12px;font:inherit;color:#1F2025;background:#FFF}',
  '.err{color:#B91C1C;font-weight:700}',
  '.safe{padding:12px;border-radius:12px;background:#FEF3C7;color:#78350F;font-size:15px}',
  '.mk{width:64px;height:64px;border-radius:32px;padding:14px;margin:0 0 12px;background:#EEF0F4;color:#374151}',
  '.mk.ok{background:#E5F6EE;color:#166534}',
  '.mk svg{display:block}',
  '.strip{margin:0 0 12px;padding:10px 12px;border-radius:12px;background:#FEF3C7;color:#78350F;font-size:15px;font-weight:700}',
  '[dir=rtl] .b svg,[dir=rtl] .blk svg,[dir=rtl] .call svg,[dir=rtl] h1 svg{margin:0 0 0 10px}',
  '[dir=rtl] .sum th{text-align:right;padding:8px 0 8px 12px}',
].join('');

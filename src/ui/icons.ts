// Inline SVG icons (no external assets).
const svg = (body: string, vb = '0 0 48 48') => `<svg viewBox="${vb}" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  coin: svg('<circle cx="24" cy="24" r="20" fill="#f6c343" stroke="#b07a12" stroke-width="3"/><circle cx="24" cy="24" r="12" fill="none" stroke="#d99a1c" stroke-width="3"/><path d="M19 17l4-3 7 2" stroke="#fff6c8" stroke-width="3" fill="none" stroke-linecap="round"/>'),
  soundOn: svg('<path d="M8 19h8l10-8v26l-10-8H8z" fill="currentColor"/><path d="M32 17c3 4 3 10 0 14M37 12c6 7 6 17 0 24" stroke="currentColor" stroke-width="3.5" fill="none" stroke-linecap="round"/>'),
  soundOff: svg('<path d="M8 19h8l10-8v26l-10-8H8z" fill="currentColor"/><path d="M32 18l10 12M42 18L32 30" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>'),
  stats: svg('<rect x="8" y="26" width="7" height="14" rx="2" fill="currentColor"/><rect x="20" y="16" width="7" height="24" rx="2" fill="currentColor"/><rect x="32" y="8" width="7" height="32" rx="2" fill="currentColor"/>'),
  shop: svg('<path d="M8 18l4-9h24l4 9" stroke="currentColor" stroke-width="3.5" fill="none" stroke-linejoin="round"/><rect x="9" y="18" width="30" height="21" rx="3" fill="currentColor"/><rect x="20" y="26" width="8" height="13" rx="1.5" fill="#fff4e3"/>'),
  helper: svg('<rect x="6" y="30" width="36" height="9" rx="2" fill="currentColor"/><path d="M14 30V22l12-8 8 6" stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="14" cy="22" r="3.5" fill="#fff4e3" stroke="currentColor" stroke-width="2.5"/><path d="M34 20l4 5" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>'),
  album: svg('<path d="M10 8h22a6 6 0 016 6v26H16a6 6 0 01-6-6z" fill="currentColor"/><path d="M10 34a6 6 0 016-6h22" stroke="#fff4e3" stroke-width="2.5" fill="none"/><path d="M21 14l2 4 4.5.6-3.3 3 .8 4.4-4-2.1-4 2.1.8-4.4-3.3-3 4.5-.6z" fill="#fff4e3"/>'),
  lock: svg('<rect x="12" y="21" width="24" height="18" rx="3" fill="currentColor"/><path d="M17 21v-5a7 7 0 0114 0v5" stroke="currentColor" stroke-width="4" fill="none"/>'),
  close: svg('<path d="M14 14l20 20M34 14L14 34" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>'),
  sparkle: svg('<path d="M24 4l4 16 16 4-16 4-4 16-4-16-16-4 16-4z" fill="currentColor"/>'),
  hand: svg(
    '<path d="M26 58c-6 0-10-3-13-8l-8-13c-1.5-2.5 1-5 3.5-4l6 4V12a4 4 0 018 0v16-4a4 4 0 018 0v4-2a4 4 0 018 0v3a4 4 0 018 0v13c0 10-7 18-17 18z" fill="#fff" stroke="#3b2616" stroke-width="3" stroke-linejoin="round"/>',
    '0 0 64 64',
  ),
};

/** Tool icons tinted by the skin colors. */
export function toolIcon(id: string, color: string, accent: string): string {
  switch (id) {
    case 'sponge':
      return svg(`<rect x="7" y="14" width="34" height="22" rx="7" fill="${color}" stroke="${accent}" stroke-width="2.5"/><rect x="7" y="27" width="34" height="9" rx="4" fill="${accent}" opacity=".55"/><circle cx="16" cy="21" r="2" fill="${accent}" opacity=".6"/><circle cx="27" cy="19" r="1.6" fill="${accent}" opacity=".6"/><circle cx="33" cy="23" r="2.2" fill="${accent}" opacity=".6"/>`);
    case 'brush':
      return svg(`<rect x="8" y="10" width="32" height="13" rx="5" fill="${color}" stroke="${accent}" stroke-width="2.5"/><path d="M11 23v13M16 23v15M21 23v14M26 23v15M31 23v14M36 23v13" stroke="${accent}" stroke-width="2.6" stroke-linecap="round"/>`);
    case 'washer':
      return svg(`<path d="M6 18h22l4-4h6v10h-6l-4-3h-8l-3 15h-8l2-15H6z" fill="${color}" stroke="${accent}" stroke-width="2.5" stroke-linejoin="round"/><path d="M38 19h5M40 14l3-2M40 24l3 2" stroke="#6ab7ff" stroke-width="2.5" stroke-linecap="round"/>`);
    case 'laser':
      return svg(`<rect x="6" y="20" width="26" height="10" rx="4" fill="${color}" stroke="${accent}" stroke-width="2.5"/><rect x="32" y="22" width="5" height="6" fill="${accent}"/><path d="M38 25h8" stroke="#ff4b4b" stroke-width="3" stroke-linecap="round"/><circle cx="14" cy="25" r="2" fill="#ff4b4b"/>`);
    default:
      return '';
  }
}

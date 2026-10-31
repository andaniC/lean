// Inline SVG icons. Stroke icons inherit currentColor.
const s = (body, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;
const f = (body) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${body}</svg>`;

export const icons = {
  flame: f(
    `<path d="M12.3 2.2c.6 3-1 4.9-2.7 6.7C7.9 10.7 6.2 12.6 6.2 15.5c0 3.6 2.6 6.3 5.8 6.3s5.8-2.7 5.8-6.3c0-2.7-1.3-4.8-2.8-6.3-.3 1.5-1 2.6-2 3.2.4-3.5-.1-7-0.7-10.2z"/>` +
      `<path fill="#fff" d="M12 20.2c-1.5 0-2.6-1.2-2.6-2.7 0-1.6 1.2-2.7 2.6-4.4 1.4 1.7 2.6 2.8 2.6 4.4 0 1.5-1.1 2.7-2.6 2.7z"/>`
  ),
  check: s(`<path d="M6 12.5l3.8 3.7L18 8.2"/>`, `stroke-width="3"`),
  person: f(`<circle cx="12" cy="7.8" r="4.2"/><path d="M3.8 20.6c0-4.2 3.7-6.9 8.2-6.9s8.2 2.7 8.2 6.9V21H3.8z"/>`),
  plus: s(`<path d="M12 5v14M5 12h14"/>`, `stroke-width="2.6"`),
  minus: s(`<path d="M5 12h14"/>`, `stroke-width="2.6"`),
  grid: f(
    `<rect x="3" y="3" width="8.3" height="8.3" rx="2.6"/><rect x="12.7" y="3" width="8.3" height="8.3" rx="2.6"/>` +
      `<rect x="3" y="12.7" width="8.3" height="8.3" rx="2.6"/><rect x="12.7" y="12.7" width="8.3" height="8.3" rx="2.6"/>`
  ),
  progress:
    `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="currentColor"/>` +
    `<path d="M6 13.2h2.6l1.7-3.9 2.6 6.6 1.8-3.4H18" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  close: s(`<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>`, `stroke-width="2.4"`),
  image: f(
    `<path fill-rule="evenodd" d="M6.5 3.5h11a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3v-11a3 3 0 0 1 3-3zm2.6 3.7a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8zM5.5 17.2v.3c0 .6.4 1 1 1h11c.6 0 1-.4 1-1v-2.1l-3.2-2.9-3.8 3.6-2.6-2.1z"/>`
  ),
  bolt: f(`<path d="M13.6 2.2 4.8 13.3c-.3.4 0 .9.4.9h5.6l-1.2 7.1c-.1.5.6.8.9.4l8.7-11.1c.3-.4 0-.9-.4-.9h-5.6l1.3-7.1c.1-.5-.6-.8-.9-.4z"/>`),
  boltOff: s(`<path d="M13 3 7 11h4l-1 6M17 11h-2M3 3l18 18"/>`),
  scanFood: f(
    `<path d="M3.2 12.2h17.6c.4 0 .7.3.7.7-.3 4.5-4.2 8-9.5 8s-9.2-3.5-9.5-8c0-.4.3-.7.7-.7z"/>` +
      `<path d="M14.6 2.6l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8zM8.4 5.4l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4L6.4 7.4l1.4-.6zM18.6 7.2l.5 1.1 1.1.5-1.1.5-.5 1.1-.5-1.1-1.1-.5 1.1-.5z"/>`
  ),
  barcode: s(
    `<path d="M4 8V6.5A2.5 2.5 0 0 1 6.5 4H8M16 4h1.5A2.5 2.5 0 0 1 20 6.5V8M20 16v1.5a2.5 2.5 0 0 1-2.5 2.5H16M8 20H6.5A2.5 2.5 0 0 1 4 17.5V16"/>` +
      `<path d="M8.5 9v6M11 9v6M13.5 9v6M15.8 9v6" stroke-width="1.7"/>`
  ),
  label: s(`<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M8.5 7.5h7M8.5 11h7M8.5 14.5h4.5"/>`),
  camera: s(
    `<path d="M3.5 8.8A2.3 2.3 0 0 1 5.8 6.5h1.7l1.5-2.2h6l1.5 2.2h1.7a2.3 2.3 0 0 1 2.3 2.3v8.4a2.3 2.3 0 0 1-2.3 2.3H5.8a2.3 2.3 0 0 1-2.3-2.3z"/><circle cx="12" cy="12.8" r="3.4"/>`
  ),
  pencil: s(`<path d="M4.5 19.5l1-4.2L16 4.8a2 2 0 0 1 2.9 0l.3.3a2 2 0 0 1 0 2.9L8.7 18.5z"/><path d="M14 7l3 3"/>`),
  sparkle: f(
    `<path d="M10 3.5l1.6 4.3 4.4 1.7-4.4 1.6L10 15.5 8.4 11.1 4 9.5l4.4-1.7zM17.5 13l.9 2.3 2.3.9-2.3.9-.9 2.4-.9-2.4-2.3-.9 2.3-.9z"/>`
  ),
  scale: s(`<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M8 9.5a5.5 5.5 0 0 1 8 0l-2.2 2.2a2.6 2.6 0 0 0-3.6 0z"/>`),
  trash: s(`<path d="M4.5 7h15M9.5 7V5.2c0-.7.5-1.2 1.2-1.2h2.6c.7 0 1.2.5 1.2 1.2V7M6.5 7l.8 11.3c.1 1 .9 1.7 1.9 1.7h5.6c1 0 1.8-.7 1.9-1.7L17.5 7"/>`),
  chevronLeft: s(`<path d="M15 5l-7 7 7 7"/>`, `stroke-width="2.4"`),
  chevronRight: s(`<path d="M9 5l7 7-7 7"/>`, `stroke-width="2.4"`),
  fork: s(`<path d="M7 3v7a2 2 0 0 0 2 2v9M11 3v7a2 2 0 0 1-2 2M9 3v6M17 21V3c-2 1-3 3.5-3 6.5V13h3"/>`),
  key: s(`<circle cx="8" cy="15" r="4.5"/><path d="M11.2 11.8 20 3M16.5 6.5l2.5 2.5M14 9l2 2"/>`),
  retry: s(`<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5M4.5 4v4.5H9"/>`),
  search: s(`<circle cx="10.8" cy="10.8" r="6.3"/><path d="M20 20l-4.6-4.6"/>`, `stroke-width="2.3"`),
  share: s(`<path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5.5A1.5 1.5 0 0 0 4 12.5v7A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H18"/>`),
  wand: s(`<path d="M4 20 15 9M13.5 4.5v2M18.5 8.5h2M17 4.8l-1.4 1.4M9.5 4.5v2M8.5 5.5h2M19.5 13.5v2M18.5 14.5h2"/>`),
};

export const icon = (name, cls = "") => `<span class="ic ${cls}">${icons[name]}</span>`;

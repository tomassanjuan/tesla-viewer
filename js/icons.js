// Event-type icons: 24x24 stroke glyphs (currentColor) so they render the same on every platform, unlike emoji.
// Inner SVG markup only; `typeIcon(key)` wraps it. Unknown reasons use the generic glyph.
export const EVENT_ICONS = {
  emergency_braking: '<path d="M12 3 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/>',                                  // warning triangle
  collision: '<path d="m12 2 2.2 5.2L20 6l-2 5.4 4 2.6-5.6.8L15 20.5 12 16l-3 4.5-1.4-5.7L2 14l4-2.6L4 6l5.8 1.2z"/>',   // impact burst
  handle: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',                    // padlock (handle pulled while locked)
  person: '<circle cx="12" cy="7" r="3.5"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7"/>',                                    // person / object
  motion: '<path d="M3 12h3l2-6 4 12 2-6h7"/>',                                                                       // activity pulse
  honk: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',                 // horn with sound waves
  saved: '<path d="M6 3h12v18l-6-4-6 4z"/>',                                                                          // bookmark
};
export const GENERIC_ICON = '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/>'; // "?" for other reasons
export const NO_TYPE_ICON = '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>';

export const iconMarkup = (k) => (k in EVENT_ICONS ? EVENT_ICONS[k] : k ? GENERIC_ICON : NO_TYPE_ICON);
export const typeIcon = (k) => `<svg class="tic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${iconMarkup(k)}</svg>`;

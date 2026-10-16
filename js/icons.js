// js/icons.js
//
// Icônes SVG (remplacent les emojis comme icônes d'UI) et correspondance
// avec l'enum SuuntoActivityType de la librairie.

export const ACTIVITY_NAMES = {
  0: "Marche", 1: "Course à pied", 2: "Vélo", 3: "Ski de fond",
  10: "VTT", 11: "Randonnée", 12: "Roller",
};
export const ACTIVITY_ICONS = {
  0: "walk", 1: "run", 2: "bike", 3: "ski",
  10: "bike", 11: "mountain", 12: "skate",
};

const ICON_PATHS = {
  mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  sparkles: '<path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
  medal: '<circle cx="12" cy="8" r="6"/><path d="M8.2 13.9 7 23l5-3 5 3-1.2-9.1"/>',
  gauge: '<path d="M4.6 16a8 8 0 1 1 14.8 0"/><path d="M12 13a1.6 1.6 0 1 0 0-3.2A1.6 1.6 0 0 0 12 13z"/><path d="m13.2 10.4 3-3.2"/>',
  alertTriangle: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  walk: '<path d="M8 18c1.1 0 2-1.3 2-3s-.9-3-2-3-2 1.3-2 3 .9 3 2 3z"/><path d="M16 12c1.1 0 2-1.3 2-3s-.9-3-2-3-2 1.3-2 3 .9 3 2 3z"/><path d="M6 21c0-1.5 1-2 2-2s1 1.5 1 2"/><path d="M14 15c0-1.5 1-2 2-2s1 1.5 1 2"/>',
  run: '<circle cx="14.5" cy="4.5" r="1.8"/><path d="m6 20 3-4 2-2-1-4 4 1 2 4 4 2"/><path d="m9 14-3 1"/>',
  bike: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17 10 8h4l3 5"/><path d="M9 17h6"/><path d="m12 8 2 4"/>',
  ski: '<path d="M8 20 12 9l4 11"/><line x1="4" y1="20" x2="9" y2="6"/><line x1="15" y1="20" x2="20" y2="6"/><circle cx="12" cy="6" r="1.6"/>',
  skate: '<circle cx="6" cy="19" r="1.5"/><circle cx="18" cy="19" r="1.5"/><path d="M6 19h12"/><path d="M8 19V9l8-3v13"/>',
  chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
  chevronRight: '<polyline points="9 18 15 12 9 6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9c.2.6.7 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
  pulse: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
};

export function icon(name, size) {
  const body = ICON_PATHS[name] || ICON_PATHS.medal;
  const px = size || 16;
  return `<svg class="icon" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

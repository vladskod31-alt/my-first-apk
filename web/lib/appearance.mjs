export const APPEARANCE_PRESETS = {
  libo: { accent: '#8b45e6', background: '#f8f5ff', chat: '#f3edfc' },
  midnight: { accent: '#c3ff39', background: '#21103c', chat: '#2b1649' },
  ocean: { accent: '#2878d6', background: '#f2f7fc', chat: '#eaf2fc' },
  mint: { accent: '#148c76', background: '#f1f9f6', chat: '#e8f5ef' },
  rose: { accent: '#bd477c', background: '#fcf3f7', chat: '#f9eaf1' },
};
const HEX = /^#[0-9a-f]{6}$/i;
export const isColor = value => typeof value === 'string' && HEX.test(value);
export function validWallpaper(value) { return typeof value === 'string' && value.length <= 1_400_000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value); }
const color = value => isColor(value) ? value.toLowerCase() : null;
export function normalizeAppearance(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  return { preset: Object.hasOwn(APPEARANCE_PRESETS, value.preset) ? value.preset : 'libo', accent: color(value.accent), background: color(value.background), chat: color(value.chat), outgoing: color(value.outgoing),
    wallpaper: validWallpaper(value.wallpaper) ? value.wallpaper : '', dim: Number.isFinite(value.dim) ? Math.min(.85, Math.max(0, value.dim)) : .25,
    fontSize: Number.isFinite(value.fontSize) ? Math.min(20, Math.max(12, value.fontSize)) : 14 };
}
export function normalizeChatAppearance(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  return { background: color(value.background), outgoing: color(value.outgoing), wallpaper: validWallpaper(value.wallpaper) ? value.wallpaper : '', dim: Number.isFinite(value.dim) ? Math.min(.85, Math.max(0, value.dim)) : .2 };
}
const rgb = hex => [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16));
export function mix(a, b, amount) {
  const x = rgb(a), y = rgb(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * amount).toString(16).padStart(2, '0')).join('');
}
export function luminance(hex) { const [r, g, b] = rgb(hex).map(v => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; }
export const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
export const readableText = background => { const dark = contrast('#191426', background) >= 4.5 ? '#191426' : '#000000'; return contrast('#ffffff', background) >= contrast(dark, background) ? '#ffffff' : dark; };
function accessibleAccent(accent, background) {
  const target = readableText(background);
  for (let i = 0; i <= 20; i++) { const candidate = mix(accent, target, i / 20); if (contrast(candidate, background) >= 4.5) return candidate; }
  return target;
}
export function appearanceTokens(raw, dark = false) {
  const a = normalizeAppearance(raw), preset = APPEARANCE_PRESETS[a.preset];
  const background = a.background || (dark && a.preset !== 'midnight' ? '#191520' : preset.background);
  const accent = a.accent || preset.accent, text = readableText(background), isDark = text === '#ffffff';
  const panel = mix(background, isDark ? '#ffffff' : '#ffffff', isDark ? .045 : .68);
  const outgoing = a.outgoing || mix(background, accent, isDark ? .28 : .13);
  const secondary = mix(text, background, .22), muted = mix(text, background, .38);
  return { '--bg': background, '--panel': panel, '--surface': mix(background, text, .035), '--text': text, '--secondary': secondary, '--muted': muted,
    '--line': mix(background, text, .10), '--accent': accent, '--accent-hover': mix(accent, readableText(accent) === '#ffffff' ? '#000000' : '#ffffff', .10), '--accent-soft': mix(background, accent, .11), '--accent-text': accessibleAccent(accent, background), '--on-accent': readableText(accent),
    '--outgoing': outgoing, '--outgoing-text': readableText(outgoing), '--incoming': panel, '--incoming-text': readableText(panel), '--chat-background': a.chat || (dark && a.preset !== 'midnight' ? '#1d1728' : preset.chat),
    '--message-size': `${a.fontSize}px`, '--panel-glass': rgba(panel, .91), '--chat-dot': rgba(text, .05) };
}
const rgba = (hex, alpha) => `rgba(${rgb(hex).join(',')},${alpha})`;
export function applyAppearance(raw, dark = false, root = document.documentElement) {
  const a = normalizeAppearance(raw), tokens = appearanceTokens(a, dark);
  for (const [key, value] of Object.entries(tokens)) root.style.setProperty(key, value);
  root.dataset.customWallpaper = a.wallpaper ? 'true' : 'false';
  document.body.style.backgroundImage = a.wallpaper ? `linear-gradient(${rgba(tokens['--bg'], a.dim)},${rgba(tokens['--bg'], a.dim)}),url("${a.wallpaper}")` : '';
  document.body.style.backgroundSize = 'cover'; document.body.style.backgroundPosition = 'center'; document.body.style.backgroundAttachment = 'fixed';
  return tokens;
}
export function applyChatAppearance(raw, globalAppearance = {}, dark = false, node = document.querySelector('#messages')) {
  if (!node) return;
  const chat = normalizeChatAppearance(raw), a = normalizeAppearance(globalAppearance), tokens = appearanceTokens(a, dark);
  const background = chat.background || tokens['--chat-background'];
  node.style.backgroundColor = background;
  const image = chat.wallpaper || a.wallpaper;
  node.style.backgroundImage = image ? `linear-gradient(${rgba(background, chat.wallpaper ? chat.dim : a.dim)},${rgba(background, chat.wallpaper ? chat.dim : a.dim)}),url("${image}")` : '';
  node.style.backgroundSize = image ? 'cover' : '';
  node.style.backgroundPosition = 'center';
  node.style.setProperty('--outgoing', chat.outgoing || tokens['--outgoing']);
  node.style.setProperty('--outgoing-text', readableText(chat.outgoing || tokens['--outgoing']));
}
export function clearPrivateWallpaper() {
  document.body.style.backgroundImage = '';
  document.documentElement.dataset.customWallpaper = 'false';
  const node = document.querySelector('#messages'); if (node) node.style.backgroundImage = '';
}

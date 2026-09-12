import { Picker } from 'emoji-mart';
import data from '@emoji-mart/data/sets/15/native.json';
import ru from '@emoji-mart/data/i18n/ru.json';
import uk from '@emoji-mart/data/i18n/uk.json';
import en from '@emoji-mart/data/i18n/en.json';
import ruNames from 'emojibase-data/ru/compact.json';
import ukNames from 'emojibase-data/uk/compact.json';
import twemoji from '@twemoji/api';
import assets from 'virtual:emoji-assets';

const supported = new Set(assets);
const localized = new Map();
const svgCode = code => supported.has(code) ? code : supported.has(code.replaceAll('-fe0f', '')) ? code.replaceAll('-fe0f', '') : null;
const key = value => value.toLowerCase().replace(/-?fe0f/g, '');
function emojiData(language) {
  if (localized.has(language)) return localized.get(language);
  const names = new Map((language === 'en' ? [] : language === 'uk' ? ukNames : ruNames).map(e => [key(e.hexcode), e]));
  const copy = structuredClone(data);
  for (const emoji of Object.values(copy.emojis)) {
    for (const skin of emoji.skins) {
      const native = skin.native.includes('\u200d') ? skin.native : skin.native.replaceAll('\ufe0f', '');
      const code = svgCode(twemoji.convert.toCodePoint(native));
      if (code) skin.src = new URL(`./emoji/svg/${code}.svg`, document.baseURI).href;
    }
    const annotation = names.get(key(emoji.skins[0].unified));
    if (annotation) { emoji.keywords.push(emoji.name, annotation.label, ...(annotation.tags || [])); emoji.name = annotation.label; }
  }
  localized.set(language, copy); return copy;
}
export function createEmojiPicker({ language = 'ru', theme = 'light', onSelect }) {
  return new Picker({
    data: emojiData(language), locale: language, i18n: { ru, uk, en }[language], theme,
    set: 'native', emojiVersion: 15, perLine: 8, maxFrequentRows: 2,
    searchPosition: 'sticky', previewPosition: 'bottom', skinTonePosition: 'search', autoFocus: false,
    onEmojiSelect: onSelect,
  });
}
export function renderEmoji(element) {
  twemoji.parse(element, { callback: code => svgCode(code) ? new URL(`./emoji/svg/${svgCode(code)}.svg`, document.baseURI).href : false });
  for (const image of element.querySelectorAll('img.emoji')) {
    image.loading = 'lazy'; image.decoding = 'async'; image.draggable = false;
    image.onerror = () => image.replaceWith(document.createTextNode(image.alt));
  }
}
export function downloadEmojiPack() {
  if (window.LiboAndroid?.saveEmojiPack) { window.LiboAndroid.saveEmojiPack(); return; }
  const a = document.createElement('a');
  a.href = new URL('./emoji/libo-emoji-svg.zip', document.baseURI).href;
  a.download = 'LIBO-Emoji-15.0-SVG.zip'; a.click();
}
export const emojiAssetCount = assets.length;

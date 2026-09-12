import { messages } from './messages.mjs';
export const languages = ['ru', 'uk', 'en'];
let chosen;
try { chosen = localStorage.getItem('libo.language'); } catch {}
let current = languages.includes(chosen) ? chosen : 'ru';
export const language = () => current;
export const locale = () => ({ ru: 'ru-RU', uk: 'uk-UA', en: 'en-GB' })[current];
export function t(key, values = {}) {
  const row = messages[key];
  let text = row ? (row.length === 3 ? row[languages.indexOf(current)] : current === 'ru' ? key : row[current === 'uk' ? 0 : 1]) : key;
  for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}
export function setLanguage(value) {
  current = languages.includes(value) ? value : 'ru';
  try { localStorage.setItem('libo.language', current); } catch {}
  if (typeof document !== 'undefined') document.documentElement.lang = current;
  return current;
}
const texts = new WeakMap(), attributes = new WeakMap();
const skip = 'script,style,textarea,[data-dynamic],#chat-list,#messages,#contacts-list,#blocked-list,#toast,#chat-title,#chat-presence,#reply-name,#reply-text,#network-status,#composer-hint,#profile-button,#settings-avatar,#channel-picker,#emoji-picker';
// Translate app chrome only; user names, drafts and message content never pass through a translator.
export function translateStatic(root = document) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!node.parentElement || node.parentElement.closest(skip)) continue;
    const original = texts.get(node) || node.nodeValue;
    if (!/[А-Яа-яЁёІіЇїЄєҐґ]/.test(original.trim()) && !texts.has(node)) continue;
    if (!texts.has(node)) texts.set(node, original);
    const key = original.trim();
    node.nodeValue = original.replace(key, t(key));
  }
  for (const element of root.querySelectorAll('[placeholder],[title],[aria-label]')) {
    if (element.closest(skip) && element.tagName !== 'TEXTAREA') continue;
    const saved = attributes.get(element) || {};
    for (const attr of ['placeholder', 'title', 'aria-label']) {
      const original = saved[attr] ?? element.getAttribute(attr);
      if (original === null) continue;
      saved[attr] = original; element.setAttribute(attr, t(original));
    }
    attributes.set(element, saved);
  }
  document.documentElement.lang = current;
  document.querySelectorAll('#app-language,.gate-language').forEach(el => { el.value = current; });
}

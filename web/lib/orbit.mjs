// Local, fictional currency. Not a payment system; clock/data edits are possible.
export const DAY = 86400000;
export const ORBIT_COST = 300;
export const initialOrbit = () => ({ v: 1, coins: 0, stars: 0, claimedDay: -1, premiumUntil: 0, accent: 'violet', collectibles: [], ledger: [], adsEnabled: false, endpoint: '', analytics: false, campaigns: [], exposures: {} });
export function premium(s, now = Date.now()) { return Number.isSafeInteger(s.premiumUntil) && s.premiumUntil > now; }
export function mutateOrbit(state, action, now = Date.now()) {
  const s = JSON.parse(JSON.stringify(state));
  if (s.v !== 1 || !Number.isSafeInteger(s.coins) || !Number.isSafeInteger(s.stars) || s.coins < 0 || s.stars < 0) throw new Error('Некоректні дані гаманця');
  let coins = 0, stars = 0, title = '';
  if (action.type === 'daily') {
    const today = Math.floor(now / DAY);
    if (s.claimedDay >= today) throw new Error('Бонус уже отримано. Наступний — після 00:00 UTC');
    s.claimedDay = today; coins = 100; stars = 5; title = 'Щоденний бонус';
  } else if (action.type === 'premium') {
    if (premium(s, now)) throw new Error('Orbit уже активний');
    coins = -ORBIT_COST; s.premiumUntil = now + 7 * DAY; title = 'Orbit Premium · 7 днів';
  } else if (action.type === 'exchange') {
    coins = -50; stars = 5; title = 'Обмін 50 монет → 5 зірок';
  } else if (action.type === 'collect') {
    if (!['comet','moon','satellite'].includes(action.item)) throw new Error('Невідомий предмет');
    if (s.collectibles.includes(action.item)) throw new Error('Предмет уже у колекції');
    stars = -10; s.collectibles.push(action.item); title = `Колекція: ${action.item}`;
  } else if (action.type === 'accent') {
    if (!premium(s, now)) throw new Error('Потрібен активний Orbit Premium');
    if (!['violet','ocean','sunset'].includes(action.value)) throw new Error('Невідома тема');
    s.accent = action.value; return s;
  } else throw new Error('Невідома операція');
  if (s.coins + coins < 0 || s.stars + stars < 0) throw new Error('Недостатньо віртуальних коштів');
  if (!Number.isSafeInteger(s.coins + coins) || !Number.isSafeInteger(s.stars + stars)) throw new Error('Ліміт балансу');
  s.coins += coins; s.stars += stars;
  s.ledger.unshift({ id: crypto.randomUUID(), at: now, title, coins, stars });
  s.ledger = s.ledger.slice(0, 100);
  return s;
}
export function safeLink(value) {
  if (!value) return '';
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || value.length > 2048) throw new Error('Посилання має бути HTTPS без пароля');
  return u.href;
}
export function validateCampaign(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Некоректна кампанія');
  const text = (key, max) => { if (typeof raw[key] !== 'string' || !raw[key].trim() || raw[key].length > max) throw new Error(`Перевірте поле ${key}`); return raw[key].trim(); };
  const id = text('id', 64); if (['__proto__','prototype','constructor'].includes(id) || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Некоректний ID');
  const c = { id, title: text('title', 80), text: text('text', 280), sponsor: text('sponsor', 80), url: safeLink(raw.url), enabled: raw.enabled === true };
  for (const [key, min, max] of [['start', 0, 8640000000000000], ['end', 1, 8640000000000000], ['dailyCap', 1, 20], ['cooldownMinutes', 1, 1440], ['weight', 1, 10]]) {
    if (!Number.isSafeInteger(raw[key]) || raw[key] < min || raw[key] > max) throw new Error(`Некоректне поле ${key}`);
    c[key] = raw[key];
  }
  if (c.start >= c.end) throw new Error('Кінець має бути після початку');
  c.image = '';
  if (raw.image) {
    if (typeof raw.image !== 'string' || raw.image.length > 120000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(raw.image)) throw new Error('Лише вбудоване PNG/JPEG/WebP до 90 КБ; URL-трекери заборонені');
    c.image = raw.image;
  }
  return c;
}
export function chooseCampaign(campaigns, exposures, now = Date.now(), random = Math.random) {
  const day = Math.floor(now / DAY);
  const candidates = campaigns.filter(c => {
    const e = exposures[c.id];
    return c.enabled && c.start <= now && now < c.end && (!e || (e.day !== day || e.count < c.dailyCap) && now - e.last >= c.cooldownMinutes * 60000);
  });
  let pick = random() * candidates.reduce((n,c) => n + c.weight, 0);
  for (const c of candidates) { pick -= c.weight; if (pick < 0) return c; }
  return null;
}
export function recordExposure(exposures, id, now = Date.now()) {
  const day = Math.floor(now / DAY), previous = exposures[id];
  const entries = Object.entries(exposures).filter(([,e]) => e.day >= day - 2).slice(-199);
  return { ...Object.fromEntries(entries), [id]: { day, count: previous?.day === day ? previous.count + 1 : 1, last: now } };
}

// Read-modify-write in one IndexedDB transaction: safe against duplicate taps and
// multiple tabs. Wallet is explicitly a local demo, not encrypted financial data.
export class OrbitStore {
  async open() {
    this.db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('libo-orbit-demo-v1', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('state');
      req.onsuccess = () => { req.result.onversionchange = () => req.result.close(); resolve(req.result); };
      req.onerror = () => reject(req.error);
    });
    return this.update(s => s);
  }
  update(fn) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('state', 'readwrite'); const store = tx.objectStore('state');
      const request = store.get('orbit'); let result, failure;
      request.onsuccess = () => {
        try { result = fn(request.result || initialOrbit()); store.put(result, 'orbit'); }
        catch (e) { failure = e; tx.abort(); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure || tx.error || new Error('Не вдалося зберегти'));
      tx.onerror = () => { failure ||= tx.error; };
    });
  }
}

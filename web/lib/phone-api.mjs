import { publicKeyText, cleanPublicKey, signText } from './crypto.mjs';

export const phoneProof = (id, nonce, phone, name, publicKey, discoverable) => JSON.stringify(['LIBO-PHONE-1', id, nonce, phone, name, publicKeyText(publicKey), !!discoverable]);
export function accountUrl(value, origin = '') {
  let url;
  try { url = new URL(value); } catch { throw new Error('ACCOUNT_SERVER_REQUIRED'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.origin === origin && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('ACCOUNT_SERVER_HTTPS');
  if (url.username || url.password || url.hash || url.search) throw new Error('ACCOUNT_SERVER_HTTPS');
  return url.href.replace(/\/$/, '');
}
export class PhoneApi {
  constructor(base, token = '', origin = globalThis.location?.origin || '') { this.base = accountUrl(base, origin); this.token = token; }
  async request(path, method = 'GET', body) {
    const response = await fetch(this.base + path, {
      method, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15_000),
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'SERVER_ERROR');
    return value;
  }
  features() { return this.request('/features'); }
  start(phone) { return this.request('/sms/request', 'POST', { phone }); }
  async verify(challenge, phone, name, code, identity, discoverable) {
    const publicKey = cleanPublicKey(identity.publicKey);
    const proof = await signText(identity, phoneProof(challenge.id, challenge.nonce, phone, name, publicKey, discoverable));
    return this.request('/sms/verify', 'POST', { challengeId: challenge.id, name, code, publicKey, proof, discoverable });
  }
  find(phone) { return this.request('/contacts/find', 'POST', { phone }); }
  me() { return this.request('/me'); }
  setDiscoverable(discoverable) { return this.request('/me', 'PATCH', { discoverable }); }
  remove() { return this.request('/me', 'DELETE'); }
}

import { accountUrl } from './phone-api.mjs';
import { signText } from './crypto.mjs';
import { cloudLoginText } from './cloud-crypto.mjs';

export class CloudApi {
  constructor(base, token = '', origin = globalThis.location?.origin || '') { this.base = accountUrl(base, origin); this.token = token; }
  async request(path, method = 'GET', data, signal) {
    let response, value;
    if (signal?.aborted) throw new Error('CLOUD_STOPPED');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      response = await fetch(this.base + path, { method, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal,
        headers: { ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
        body: data !== undefined ? JSON.stringify(data) : undefined });
      value = await response.json();
    } catch (error) { if (signal?.aborted) throw new Error('CLOUD_STOPPED'); throw new Error('CLOUD_UNREACHABLE'); }
    finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
    if (!response.ok) throw new Error(typeof value.error === 'string' && /^[A-Z_]{3,60}$/.test(value.error) ? value.error : 'SERVER_ERROR');
    return value;
  }
  features() { return this.request('/features'); }
  async signIn(bundle, identity, deviceId, backup, { signal, notificationToken = '' } = {}) {
    const challenge = await this.request('/challenge', 'POST', { name: bundle.name, deviceId }, signal);
    const signature = await signText(identity, cloudLoginText(challenge, deviceId, bundle, backup, notificationToken));
    return this.request('/session', 'POST', { challengeId: challenge.id, bundle, backup, signature, notificationToken }, signal);
  }
  directory(id, signal) { return this.request('/directory/' + encodeURIComponent(id), 'GET', undefined, signal); }
  history(after, signal) { return this.request('/history?after=' + encodeURIComponent(after), 'GET', undefined, signal); }
  sendMessage(to, incoming, outgoing, signal) { return this.request('/messages', 'POST', { to, incoming, outgoing }, signal); }
  sendControl(envelope, signal) { return this.request('/control', 'POST', { envelope }, signal); }
  usage() { return this.request('/usage'); }
  setBlocked(ids, signal) { return this.request('/blocked', 'PUT', { ids }, signal); }
  recover(id) { return this.request('/recover', 'POST', { id }); }
  clearHistory() { return this.request('/history', 'DELETE'); }
  removeAccount() { return this.request('/account', 'DELETE'); }
}

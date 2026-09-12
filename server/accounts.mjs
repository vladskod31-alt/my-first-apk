import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { normalizePhone, normalizeNickname, peerIdForNickname } from '../web/lib/core.mjs';
import { cleanPublicKey, fingerprint, verifyText } from '../web/lib/crypto.mjs';
import { phoneProof } from '../web/lib/phone-api.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const random = () => randomBytes(32).toString('base64url');
export class TwilioVerify {
  constructor({ accountSid, authToken, serviceSid }) { this.accountSid = accountSid; this.authToken = authToken; this.serviceSid = serviceSid; }
  async call(action, body) {
    const response = await fetch(`https://verify.twilio.com/v2/Services/${this.serviceSid}/${action}`, {
      method: 'POST', signal: AbortSignal.timeout(12_000),
      headers: { Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
    if (!response.ok) throw new Error('SMS_PROVIDER_ERROR');
    return response.json();
  }
  async send(phone) { await this.call('Verifications', { To: phone, Channel: 'sms' }); }
  async verify(phone, code) { return (await this.call('VerificationCheck', { To: phone, Code: code })).status === 'approved'; }
}
export function providerFromEnv(env = process.env) {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_VERIFY_SERVICE_SID) return null;
  return new TwilioVerify({ accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, serviceSid: env.TWILIO_VERIFY_SERVICE_SID });
}

// No development SMS codes or fake verification endpoint are provided. Tests inject a provider explicitly.
export function createAccountsApi({ filename = '.local/accounts.sqlite', provider = providerFromEnv(), now = Date.now, maxDaily = 25 } = {}) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true, mode: 0o700 });
  maxDaily = Number.isSafeInteger(maxDaily) && maxDaily > 0 && maxDaily <= 10000 ? maxDaily : 25;
  const db = new DatabaseSync(filename);
  if (filename !== ':memory:') fs.chmodSync(filename, 0o600);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, phone TEXT NOT NULL, nonce TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0, ip TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS accounts (phone TEXT PRIMARY KEY, nick TEXT UNIQUE NOT NULL, peer TEXT NOT NULL, public_key TEXT NOT NULL, fingerprint TEXT NOT NULL, discoverable INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, phone TEXT NOT NULL REFERENCES accounts(phone) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS lookups (session TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS challenge_phone ON challenges(phone, created);`);
  const api = express.Router();
  api.use(express.json({ limit: '16kb', strict: true }));
  api.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('X-Content-Type-Options', 'nosniff'); next(); });
  const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
  const fail = (status, code) => Object.assign(new Error(code), { status });
  function auth(req) {
    const token = req.get('authorization')?.match(/^Bearer ([\w-]{43})$/)?.[1];
    if (!token) throw fail(401, 'AUTH_REQUIRED');
    const sessionHash = hash(token);
    const account = db.prepare('SELECT accounts.* FROM sessions JOIN accounts ON sessions.phone=accounts.phone WHERE sessions.hash=? AND sessions.expires>?').get(sessionHash, now());
    if (!account) throw fail(401, 'AUTH_REQUIRED');
    return { ...account, sessionHash };
  }
  const publicAccount = a => ({ phone: a.phone, name: a.nick, id: a.peer, publicKey: JSON.parse(a.public_key), fingerprint: a.fingerprint, discoverable: !!a.discoverable, verified: true });
  api.get('/features', (_req, res) => res.json({ sms: !!provider, provider: provider ? 'sms' : null, protocol: 1 }));
  api.post('/sms/request', wrap(async (req, res) => {
    if (!provider) throw fail(503, 'SMS_NOT_CONFIGURED');
    const phone = normalizePhone(req.body?.phone);
    if (!phone) throw fail(400, 'PHONE_INVALID');
    const time = now();
    db.prepare('DELETE FROM challenges WHERE created<?').run(time - 2 * 86400_000);
    db.prepare('DELETE FROM sessions WHERE expires<?').run(time);
    db.prepare('DELETE FROM lookups WHERE at<?').run(time - 86400_000);
    const ip = hash(req.ip || 'unknown'); // No raw IP address in the SMS database.
    const day = time - 86400_000;
    const count = (sql, ...args) => Number(db.prepare(sql).get(...args).n);
    if (count('SELECT count(*) n FROM challenges WHERE phone=? AND created>?', phone, time - 60_000) ||
      count('SELECT count(*) n FROM challenges WHERE phone=? AND created>?', phone, day) >= 5 ||
      count('SELECT count(*) n FROM challenges WHERE ip=? AND created>?', ip, day) >= 15 ||
      count('SELECT count(*) n FROM challenges WHERE created>?', day) >= maxDaily) throw fail(429, 'RATE_LIMITED');
    const id = random(), nonce = random();
    db.prepare('INSERT INTO challenges(id,phone,nonce,created,expires,ip) VALUES(?,?,?,?,?,?)').run(id, phone, nonce, time, time + 300_000, ip);
    try { await provider.send(phone); }
    catch { db.prepare('UPDATE challenges SET used=1 WHERE id=?').run(id); throw fail(502, 'SMS_PROVIDER_ERROR'); }
    res.json({ id, nonce, expiresIn: 300 });
  }));
  api.post('/sms/verify', wrap(async (req, res) => {
    if (!provider) throw fail(503, 'SMS_NOT_CONFIGURED');
    const body = req.body || {};
    const challenge = typeof body.challengeId === 'string' ? db.prepare('SELECT * FROM challenges WHERE id=?').get(body.challengeId) : null;
    if (!challenge || challenge.used || challenge.expires <= now() || challenge.attempts >= 5) throw fail(400, 'SMS_CHALLENGE_INVALID');
    const name = normalizeNickname(body.name);
    if (!name || !/^\d{4,10}$/.test(body.code || '')) throw fail(400, 'SMS_CODE_INVALID');
    db.prepare('UPDATE challenges SET attempts=attempts+1 WHERE id=?').run(challenge.id);
    let publicKey;
    try {
      publicKey = cleanPublicKey(body.publicKey);
      if (!await verifyText(publicKey, phoneProof(challenge.id, challenge.nonce, challenge.phone, name, publicKey, !!body.discoverable), body.proof)) throw new Error();
    } catch { throw fail(400, 'CRYPTO_SIGNATURE'); }
    let approved;
    try { approved = await provider.verify(challenge.phone, body.code); }
    catch { throw fail(502, 'SMS_PROVIDER_ERROR'); }
    if (!approved) throw fail(400, 'SMS_CODE_INVALID');
    const peer = await peerIdForNickname(name), keyFingerprint = await fingerprint(publicKey);
    const token = random();
    // A challenge cannot mint a second session through concurrent verification requests.
    db.exec('BEGIN IMMEDIATE');
    try {
      const reserved = db.prepare('UPDATE challenges SET used=1 WHERE id=? AND used=0 AND expires>?').run(challenge.id, now());
      if (!reserved.changes) throw fail(400, 'SMS_CHALLENGE_INVALID');
      const owner = db.prepare('SELECT phone FROM accounts WHERE nick=?').get(name);
      if (owner && owner.phone !== challenge.phone) throw fail(409, 'NICK_IN_USE');
      db.prepare('DELETE FROM sessions WHERE phone=?').run(challenge.phone);
      db.prepare(`INSERT INTO accounts(phone,nick,peer,public_key,fingerprint,discoverable,updated) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(phone) DO UPDATE SET nick=excluded.nick,peer=excluded.peer,public_key=excluded.public_key,fingerprint=excluded.fingerprint,discoverable=excluded.discoverable,updated=excluded.updated`).run(challenge.phone, name, peer, JSON.stringify(publicKey), keyFingerprint, body.discoverable ? 1 : 0, now());
      db.prepare('INSERT INTO sessions(hash,phone,expires) VALUES(?,?,?)').run(hash(token), challenge.phone, now() + 30 * 86400_000);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    res.json({ token, account: publicAccount(db.prepare('SELECT * FROM accounts WHERE phone=?').get(challenge.phone)) });
  }));
  api.get('/me', wrap((req, res) => res.json({ account: publicAccount(auth(req)) })));
  api.patch('/me', wrap((req, res) => {
    const account = auth(req);
    if (typeof req.body?.discoverable !== 'boolean') throw fail(400, 'REQUEST_INVALID');
    db.prepare('UPDATE accounts SET discoverable=? WHERE phone=?').run(req.body.discoverable ? 1 : 0, account.phone);
    res.json({ account: publicAccount(db.prepare('SELECT * FROM accounts WHERE phone=?').get(account.phone)) });
  }));
  api.post('/contacts/find', wrap((req, res) => {
    const self = auth(req), phone = normalizePhone(req.body?.phone);
    if (!phone) throw fail(400, 'PHONE_INVALID');
    const lookups = db.prepare('SELECT count(*) n FROM lookups WHERE session=? AND at>?').get(self.sessionHash, now() - 86400_000).n;
    if (lookups >= 50) throw fail(429, 'RATE_LIMITED');
    db.prepare('INSERT INTO lookups(session,at) VALUES(?,?)').run(self.sessionHash, now());
    const contact = db.prepare('SELECT * FROM accounts WHERE phone=? AND discoverable=1').get(phone);
    if (!contact) throw fail(404, 'CONTACT_NOT_FOUND');
    res.json({ contact: publicAccount(contact) });
  }));
  api.delete('/me', wrap((req, res) => { const self = auth(req); db.prepare('DELETE FROM accounts WHERE phone=?').run(self.phone); db.prepare('DELETE FROM challenges WHERE phone=?').run(self.phone); res.json({ deleted: true }); }));
  api.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.status ? error.message : 'SERVER_ERROR' }));
  return { router: api, close: () => db.close() };
}

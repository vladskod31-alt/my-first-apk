import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeNickname, normalizePeerId, peerIdForNickname } from '../web/lib/core.mjs';
import { from64, publicKeyText, verifyText, fingerprint } from '../web/lib/crypto.mjs';
import { verifyBundle, verifyEnvelope, cloudLoginText } from '../web/lib/cloud-crypto.mjs';

const random = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');
const DAY = 86400_000;
const sameKey = (a, b) => publicKeyText(a) === publicKeyText(b);
const DEVICE_ID = /^[a-f0-9-]{16,64}$/;
export function createCloudApi({ filename = '.local/cloud.sqlite', now = Date.now, quotaBytes = 64 * 1024 * 1024, maxAccounts = 100, registrationLimit = 20, totalQuotaBytes = 512 * 1024 * 1024, pollTimeout = 25_000 } = {}) {
  quotaBytes = Number.isSafeInteger(quotaBytes) && quotaBytes >= 4 * 1024 * 1024 ? quotaBytes : 64 * 1024 * 1024;
  maxAccounts = Number.isSafeInteger(maxAccounts) && maxAccounts > 0 ? maxAccounts : 100;
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true, mode: 0o700 });
  totalQuotaBytes = Number.isSafeInteger(totalQuotaBytes) && totalQuotaBytes >= quotaBytes ? totalQuotaBytes : Math.max(quotaBytes, 512 * 1024 * 1024);
  const db = new DatabaseSync(filename);
  if (filename !== ':memory:') fs.chmodSync(filename, 0o600);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, bundle TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, name TEXT NOT NULL, device TEXT NOT NULL, nonce TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, device TEXT NOT NULL, scope TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_owner ON sessions(owner,device);
    CREATE TABLE IF NOT EXISTS recovery (id TEXT PRIMARY KEY, owner TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE, box TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS items (seq INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, author TEXT NOT NULL, event TEXT NOT NULL, kind TEXT NOT NULL, peer TEXT NOT NULL, box TEXT NOT NULL, bytes INTEGER NOT NULL, created INTEGER NOT NULL, UNIQUE(owner,author,event));
    CREATE INDEX IF NOT EXISTS items_owner ON items(owner,seq);
    CREATE TABLE IF NOT EXISTS notifications (seq INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS notifications_owner ON notifications(owner,seq);
    CREATE TABLE IF NOT EXISTS blocked (owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, peer TEXT NOT NULL, PRIMARY KEY(owner,peer));
    CREATE TABLE IF NOT EXISTS rates (bucket TEXT PRIMARY KEY, starts INTEGER NOT NULL, count INTEGER NOT NULL);`);
  const router = express.Router(), waiting = new Map();
  router.use(express.json({ limit: '4500kb', strict: true }));
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'no-referrer'); next(); });
  const fail = (status, code) => Object.assign(new Error(code), { status });
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  function rate(bucket, limit, period) {
    const time = now(), row = db.prepare('SELECT * FROM rates WHERE bucket=?').get(bucket);
    if (!row || row.starts + period <= time) db.prepare('INSERT INTO rates(bucket,starts,count) VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET starts=excluded.starts,count=1').run(bucket, time);
    else { if (row.count >= limit) throw fail(429, 'RATE_LIMITED'); db.prepare('UPDATE rates SET count=count+1 WHERE bucket=?').run(bucket); }
    db.prepare('DELETE FROM rates WHERE starts<?').run(time - 2 * DAY);
  }
  function auth(req, notificationOnly = false) {
    const token = req.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!token) throw fail(401, 'CLOUD_AUTH_REQUIRED');
    const account = db.prepare('SELECT users.*,sessions.scope,sessions.device,sessions.hash AS session_hash FROM sessions JOIN users ON users.id=sessions.owner WHERE sessions.hash=? AND sessions.expires>?').get(hash(token), now());
    if (!account || (!notificationOnly && account.scope !== 'full')) throw fail(401, 'CLOUD_AUTH_REQUIRED');
    return account;
  }
  const getUsage = owner => db.prepare('SELECT coalesce(sum(bytes),0) AS bytes,count(*) AS rows FROM items WHERE owner=?').get(owner);
  function checkQuota(owner, bytes, rows = 1) {
    const usage = getUsage(owner);
    if (usage.bytes + bytes > quotaBytes || usage.rows + rows > 20000 || db.prepare('SELECT coalesce(sum(bytes),0) AS n FROM items').get().n + bytes > totalQuotaBytes) throw fail(413, 'CLOUD_QUOTA');
  }
  function validateBackup(value) {
    if (!value || value.v !== 1 || typeof value.id !== 'string' || !/^[a-f0-9]{64}$/.test(value.id) || value.box?.vault !== 1 || from64(value.box.iv, 32).length !== 12 || from64(value.box.data, 24000).length < 16) throw fail(400, 'RECOVERY_INVALID');
    return { v: 1, id: value.id, box: { vault: 1, iv: value.box.iv, data: value.box.data } };
  }
  const notify = owner => { for (const finish of [...waiting.get(owner) || []]) finish(); };
  router.get('/features', (_req, res) => res.json({ protocol: 1, version: '2.3', encryptedHistory: true, offlineDelivery: true, background: 'android-foreground-service', quotaBytes, maxHistoryRows: 20000 }));
  router.post('/challenge', wrap(async (req, res) => {
    rate('challenge:' + hash(req.ip || 'unknown'), 60, 60_000);
    const name = normalizeNickname(req.body?.name), deviceId = req.body?.deviceId;
    if (!name || typeof deviceId !== 'string' || !DEVICE_ID.test(deviceId)) throw fail(400, 'CLOUD_INVALID');
    db.prepare('DELETE FROM challenges WHERE expires<?').run(now());
    db.prepare('DELETE FROM sessions WHERE expires<?').run(now());
    if (db.prepare('SELECT count(*) AS n FROM challenges').get().n > 2000) throw fail(429, 'RATE_LIMITED');
    const id = random(), nonce = random();
    db.prepare('INSERT INTO challenges VALUES(?,?,?,?,?)').run(id, name, deviceId, nonce, now() + 60_000);
    res.json({ id, nonce, expiresIn: 60 });
  }));
  router.post('/session', wrap(async (req, res) => {
    rate('session:' + hash(req.ip || 'unknown'), 60, 60_000);
    const body = req.body || {};
    const challenge = typeof body.challengeId === 'string' ? db.prepare('SELECT * FROM challenges WHERE id=? AND expires>?').get(body.challengeId, now()) : null;
    if (!challenge) throw fail(400, 'CLOUD_CHALLENGE');
    let bundle, backup;
    try {
      bundle = await verifyBundle(body.bundle);
      backup = body.backup ? validateBackup(body.backup) : null;
      if (bundle.name !== challenge.name || !await verifyText(bundle.identity, cloudLoginText(challenge, challenge.device, bundle, backup, body.notificationToken || ''), body.signature)) throw new Error();
    } catch { throw fail(400, 'CRYPTO_SIGNATURE'); }
    const fullToken = random(), expiry = now() + 30 * DAY;
    let notificationToken = random(), reuseNotification = false;
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!db.prepare('DELETE FROM challenges WHERE id=? AND expires>?').run(challenge.id, now()).changes) throw fail(400, 'CLOUD_CHALLENGE');
      const existing = db.prepare('SELECT * FROM users WHERE id=?').get(bundle.id);
      if (existing) {
        const original = JSON.parse(existing.bundle);
        if (!sameKey(original.identity, bundle.identity) || !sameKey(original.encryption, bundle.encryption)) throw fail(409, 'CLOUD_NICK_OWNED');
      } else {
        if (!backup) throw fail(400, 'RECOVERY_REQUIRED');
        rate('register:' + hash(req.ip || 'unknown'), registrationLimit, DAY);
        if (db.prepare('SELECT count(*) AS n FROM users').get().n >= maxAccounts) throw fail(503, 'CLOUD_CAPACITY');
        if (db.prepare('SELECT id FROM recovery WHERE id=?').get(backup.id)) throw fail(409, 'RECOVERY_INVALID');
        db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(bundle.id, bundle.name, JSON.stringify(bundle), now());
        db.prepare('INSERT INTO recovery VALUES(?,?,?)').run(backup.id, bundle.id, JSON.stringify(backup));
      }
      if (typeof body.notificationToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(body.notificationToken)) {
        reuseNotification = !!db.prepare("SELECT 1 FROM sessions WHERE hash=? AND owner=? AND device=? AND scope='notify' AND expires>?").get(hash(body.notificationToken), bundle.id, challenge.device, now());
        if (reuseNotification) notificationToken = body.notificationToken;
      }
      db.prepare("DELETE FROM sessions WHERE owner=? AND device=? AND scope='full'").run(bundle.id, challenge.device);
      if (db.prepare('SELECT count(DISTINCT device) AS n FROM sessions WHERE owner=? AND device<>?').get(bundle.id, challenge.device).n >= 16) throw fail(429, 'CLOUD_DEVICE_LIMIT');
      const statement = db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)');
      statement.run(hash(fullToken), bundle.id, challenge.device, 'full', expiry);
      if (reuseNotification) db.prepare('UPDATE sessions SET expires=? WHERE hash=?').run(expiry, hash(notificationToken));
      else statement.run(hash(notificationToken), bundle.id, challenge.device, 'notify', expiry);
      db.prepare("DELETE FROM sessions WHERE owner=? AND device=? AND scope='notify' AND hash NOT IN (SELECT hash FROM sessions WHERE owner=? AND device=? AND scope='notify' ORDER BY expires DESC LIMIT 8)").run(bundle.id, challenge.device, bundle.id, challenge.device);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    const notificationCursor = db.prepare('SELECT coalesce(max(seq),0) AS n FROM notifications WHERE owner=?').get(bundle.id).n;
    res.json({ token: fullToken, notificationToken, expiresAt: expiry, notificationCursor, bundle });
  }));
  router.post('/recover', wrap((req, res) => {
    rate('recover:' + hash(req.ip || 'unknown'), 30, 60_000);
    const id = req.body?.id;
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw fail(400, 'RECOVERY_INVALID');
    const row = db.prepare('SELECT box FROM recovery WHERE id=?').get(id);
    if (!row) throw fail(404, 'RECOVERY_NOT_FOUND');
    res.json({ backup: JSON.parse(row.box) });
  }));
  router.get('/directory/:id', wrap((req, res) => {
    const user = auth(req); rate('directory:' + user.id, 240, 60_000);
    if (!normalizePeerId(req.params.id)) throw fail(400, 'CLOUD_INVALID');
    const peer = db.prepare('SELECT bundle FROM users WHERE id=?').get(req.params.id);
    if (!peer) throw fail(404, 'CLOUD_PEER_MISSING');
    res.json({ bundle: JSON.parse(peer.bundle) });
  }));
  router.post('/messages', wrap(async (req, res) => {
    const user = auth(req); rate('send:' + user.id, 90, 60_000);
    const to = req.body?.to;
    if (!normalizePeerId(to) || to === user.id) throw fail(400, 'CLOUD_INVALID');
    const recipient = db.prepare('SELECT * FROM users WHERE id=?').get(to);
    if (!recipient) throw fail(404, 'CLOUD_PEER_MISSING');
    if (db.prepare('SELECT 1 FROM blocked WHERE owner=? AND peer=?').get(to, user.id)) throw fail(403, 'CONTACT_BLOCKED');
    const senderBundle = JSON.parse(user.bundle), recipientBundle = JSON.parse(recipient.bundle);
    let incoming, outgoing;
    try {
      [incoming, outgoing] = await Promise.all([verifyEnvelope(req.body.incoming, senderBundle.identity), verifyEnvelope(req.body.outgoing, senderBundle.identity)]);
      if (incoming.from !== user.id || outgoing.from !== user.id || incoming.to !== to || outgoing.to !== user.id || incoming.peer !== user.id || outgoing.peer !== to || incoming.id !== outgoing.id || incoming.kind !== 'message' || outgoing.kind !== 'message' || incoming.recipientKey !== await fingerprint(recipientBundle.encryption) || outgoing.recipientKey !== await fingerprint(senderBundle.encryption) || !sameKey(incoming.peerKey, senderBundle.identity) || !sameKey(outgoing.peerKey, recipientBundle.identity)) throw new Error();
    } catch { throw fail(400, 'CLOUD_INVALID'); }
    const previous = db.prepare("SELECT owner,peer FROM items WHERE author=? AND event=? AND kind='message' LIMIT 3").all(user.id, outgoing.id);
    if (previous.length) {
      if (previous.some(row => row.owner === user.id ? row.peer !== to : row.owner !== to)) throw fail(409, 'CLOUD_ID_CONFLICT');
      return res.json({ stored: true, duplicate: true });
    }
    const inText = JSON.stringify(incoming), outText = JSON.stringify(outgoing);
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.prepare('SELECT coalesce(sum(bytes),0) AS n FROM items').get().n + Buffer.byteLength(inText) + Buffer.byteLength(outText) > totalQuotaBytes) throw fail(413, 'CLOUD_QUOTA');
      checkQuota(to, Buffer.byteLength(inText)); checkQuota(user.id, Buffer.byteLength(outText));
      const statement = db.prepare('INSERT INTO items(owner,author,event,kind,peer,box,bytes,created) VALUES(?,?,?,?,?,?,?,?)');
      statement.run(to, user.id, incoming.id, incoming.kind, user.id, inText, Buffer.byteLength(inText), now());
      statement.run(user.id, user.id, outgoing.id, outgoing.kind, to, outText, Buffer.byteLength(outText), now());
      db.prepare('INSERT INTO notifications(owner,created) VALUES(?,?)').run(to, now());
      db.prepare('DELETE FROM notifications WHERE created<?').run(now() - 30 * DAY);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    notify(to); res.json({ stored: true, duplicate: false });
  }));
  router.post('/control', wrap(async (req, res) => {
    const user = auth(req); rate('control:' + user.id, 500, 60_000);
    let envelope;
    try { envelope = await verifyEnvelope(req.body?.envelope, JSON.parse(user.bundle).identity); }
    catch { throw fail(400, 'CLOUD_INVALID'); }
    if (envelope.from !== user.id || envelope.peer !== user.id || envelope.to === user.id || envelope.kind === 'message' || !sameKey(envelope.peerKey, JSON.parse(user.bundle).identity)) throw fail(400, 'CLOUD_INVALID');
    if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(envelope.to)) throw fail(404, 'CLOUD_PEER_MISSING');
    if (db.prepare('SELECT 1 FROM blocked WHERE owner=? AND peer=?').get(envelope.to, user.id)) throw fail(403, 'CONTACT_BLOCKED');
    if (!db.prepare("SELECT 1 FROM items WHERE kind='message' AND ((owner=? AND peer=?) OR (owner=? AND peer=?)) LIMIT 1").get(user.id, envelope.to, envelope.to, user.id)) throw fail(403, 'CLOUD_CONTROL_REJECTED');
    const old = db.prepare('SELECT seq FROM items WHERE owner=? AND author=? AND event=?').get(envelope.to, user.id, envelope.id);
    if (old) return res.json({ stored: true, duplicate: true });
    const text = JSON.stringify(envelope);
    checkQuota(envelope.to, Buffer.byteLength(text));
    db.prepare('INSERT INTO items(owner,author,event,kind,peer,box,bytes,created) VALUES(?,?,?,?,?,?,?,?)').run(envelope.to, user.id, envelope.id, envelope.kind, user.id, text, Buffer.byteLength(text), now());
    res.json({ stored: true });
  }));
  router.get('/history', wrap((req, res) => {
    const user = auth(req), after = Number(req.query.after || 0);
    if (!Number.isSafeInteger(after) || after < 0) throw fail(400, 'CLOUD_INVALID');
    rate('history:' + user.id, 500, 60_000);
    const candidates = db.prepare('SELECT seq,box,bytes FROM items WHERE owner=? AND seq>? ORDER BY seq LIMIT 11').all(user.id, after);
    const items = []; let bytes = 0;
    for (const row of candidates) { if (items.length >= 10 || (items.length && bytes + row.bytes > 4_200_000)) break; items.push({ seq: row.seq, envelope: JSON.parse(row.box) }); bytes += row.bytes; }
    res.json({ items, hasMore: candidates.length > items.length, cursor: items.at(-1)?.seq || after });
  }));
  router.get('/usage', wrap((req, res) => { const user = auth(req); res.json({ ...getUsage(user.id), quotaBytes, maxRows: 20000 }); }));
  router.put('/blocked', wrap((req, res) => {
    const user = auth(req), ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => !normalizePeerId(id) || id === user.id)) throw fail(400, 'CLOUD_INVALID');
    db.exec('BEGIN IMMEDIATE');
    try { db.prepare('DELETE FROM blocked WHERE owner=?').run(user.id); const insert = db.prepare('INSERT OR IGNORE INTO blocked VALUES(?,?)'); ids.forEach(id => insert.run(user.id, id)); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    res.json({ saved: true });
  }));
  router.get('/notifications', wrap((req, res) => {
    const user = auth(req, true), after = Number(req.query.after || 0);
    if (!Number.isSafeInteger(after) || after < 0) throw fail(400, 'CLOUD_INVALID');
    rate('poll:' + user.session_hash, 120, 60_000);
    if ((waiting.get(user.id)?.size || 0) >= 16) throw fail(429, 'RATE_LIMITED');
    let timer, finished = false;
    const cleanup = () => { clearTimeout(timer); waiting.get(user.id)?.delete(finish); if (!waiting.get(user.id)?.size) waiting.delete(user.id); };
    const finish = () => {
      if (finished) return; finished = true; cleanup();
      if (res.destroyed) return;
      const row = db.prepare('SELECT count(*) AS count,coalesce(max(seq),?) AS cursor FROM notifications WHERE owner=? AND seq>?').get(after, user.id, after);
      res.json({ cursor: row.cursor, count: row.count });
    };
    const row = db.prepare('SELECT 1 FROM notifications WHERE owner=? AND seq>? LIMIT 1').get(user.id, after);
    if (row || req.query.wait === '0') return finish();
    if (!waiting.has(user.id)) waiting.set(user.id, new Set()); waiting.get(user.id).add(finish);
    timer = setTimeout(finish, pollTimeout);
    res.on('close', () => { if (!finished) { finished = true; cleanup(); } });
  }));
  router.delete('/history', wrap((req, res) => { const user = auth(req); db.prepare('DELETE FROM items WHERE owner=?').run(user.id); db.prepare('DELETE FROM notifications WHERE owner=?').run(user.id); res.json({ deleted: true }); }));
  router.delete('/account', wrap((req, res) => { const user = auth(req); notify(user.id); db.prepare('DELETE FROM users WHERE id=?').run(user.id); res.json({ deleted: true }); }));
  router.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.status && /^[A-Z_]+$/.test(error.message) ? error.message : error.type === 'entity.too.large' ? 'CLOUD_QUOTA' : 'SERVER_ERROR' }));
  return { router, close() { for (const callbacks of [...waiting.values()]) for (const finish of [...callbacks]) finish(); db.close(); } };
}

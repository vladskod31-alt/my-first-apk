import { createCloudApi } from './cloud.mjs';
import express from 'express';
import http from 'node:http';
import { ExpressPeerServer } from 'peer';
import { createAccountsApi } from './accounts.mjs';

const app = express();
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.disable('x-powered-by');
const origins = new Set((process.env.ALLOWED_ORIGINS || 'https://appassets.androidplatform.net').split(',').map(s => s.trim()));
app.use('/api', (req, res, next) => {
  const origin = req.get('origin');
  if (origin && !origins.has(origin)) return res.status(403).json({ error: 'ORIGIN_DENIED' });
  if (origin) { res.set('Access-Control-Allow-Origin', origin); res.vary('Origin'); }
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
const accounts = createAccountsApi({ filename: process.env.ACCOUNT_DB || '.local/accounts.sqlite', maxDaily: Number(process.env.MAX_SMS_PER_DAY || 25) });
const cloud = createCloudApi({ filename: process.env.CLOUD_DB || '.local/cloud.sqlite', quotaBytes: Number(process.env.CLOUD_QUOTA_BYTES || 67108864), totalQuotaBytes: Number(process.env.CLOUD_TOTAL_QUOTA_BYTES || 536870912), maxAccounts: Number(process.env.CLOUD_MAX_ACCOUNTS || 100) });
app.use('/api/cloud', cloud.router);
app.use('/api', accounts.router);
app.get('/health', (_req, res) => res.json({ ok: true }));
const server = http.createServer(app);
app.use('/peerjs', ExpressPeerServer(server, { path: '/', allow_discovery: false, proxied: process.env.TRUST_PROXY === '1' }));
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('LIBO account/signaling service ready. TLS must be provided by the reverse proxy.'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => { cloud.close(); accounts.close(); process.exit(0); }));

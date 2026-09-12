import { createCloudApi } from '../server/cloud.mjs';
import express from 'express';
import http from 'node:http';
import { createServer as createViteServer } from 'vite';
import { ExpressPeerServer } from 'peer';
import { createAccountsApi } from '../server/accounts.mjs';
import { prepareEmojiPack, svgRoot } from './emoji-assets.mjs';

const app = express();
const httpServer = http.createServer(app);
const accounts = createAccountsApi();
const emojiPack = prepareEmojiPack();
const cloud = createCloudApi({ filename: process.env.CLOUD_DB || '.local/cloud.sqlite', quotaBytes: Number(process.env.CLOUD_QUOTA_BYTES || 67108864), totalQuotaBytes: Number(process.env.CLOUD_TOTAL_QUOTA_BYTES || 536870912), maxAccounts: Number(process.env.CLOUD_MAX_ACCOUNTS || 1000), registrationLimit: 1000 });
app.use('/api/cloud', cloud.router);
app.use('/api', accounts.router);
app.use('/emoji/svg', express.static(svgRoot, { index: false }));
app.get('/emoji/libo-emoji-svg.zip', (_req, res) => res.sendFile(emojiPack));
// A non-listening HTTP emitter isolates PeerJS's websocket handler. PeerJS would
// otherwise reject Vite's HMR upgrades with HTTP 400 on the shared preview port.
const signalingTransport = http.createServer();
app.use('/peerjs', ExpressPeerServer(signalingTransport, {
  path: '/', proxied: true, allow_discovery: false, concurrent_limit: 100,
}));
httpServer.on('upgrade', (request, socket, head) => {
  if (request.url?.startsWith('/peerjs/')) signalingTransport.emit('upgrade', request, socket, head);
});
const vite = await createViteServer({
  server: { middlewareMode: true, hmr: { server: httpServer, path: '/__vite_hmr' } },
});
app.use(vite.middlewares);
httpServer.listen(Number(process.env.PORT || 5173), '0.0.0.0', () => {
  console.log('LIBO preview ready on 0.0.0.0:' + (process.env.PORT || 5173));
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  await vite.close();
  httpServer.close(() => { cloud.close(); accounts.close(); process.exit(0); });
});

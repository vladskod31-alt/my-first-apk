import express from 'express';
import { adsApi } from '../server/ads-api.mjs';
import http from 'node:http';
import { createServer as createViteServer } from 'vite';
import { ExpressPeerServer } from 'peer';

const app = express();
const httpServer = http.createServer(app);
app.use('/api/ads/v1', adsApi());
// Signaling rate limit (per client IP, sliding minute). The server only relays
// SDP/ICE; it never sees keys or plaintext, but it should not be a free amplifier.
const hits = new Map();
app.use('/peerjs', (request, response, next) => {
  const ip = request.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(at => now - at < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (recent.length > 120) { response.status(429).end('Too Many Requests'); return; }
  next();
});
setInterval(() => { const now = Date.now(); for (const [ip, list] of hits) if (!list.some(at => now - at < 60_000)) hits.delete(ip); }, 60_000).unref();
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
  httpServer.close(() => process.exit(0));
});

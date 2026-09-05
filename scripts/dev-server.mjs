import express from 'express';
import http from 'node:http';
import { createServer as createViteServer } from 'vite';
import { ExpressPeerServer } from 'peer';

const app = express();
const httpServer = http.createServer(app);
// Development signaling only. Production APKs use the public PeerJS broker by default.
app.use('/peerjs', ExpressPeerServer(httpServer, {
  path: '/', proxied: true, allow_discovery: false, concurrent_limit: 100,
}));
const vite = await createViteServer({
  // PeerJS owns websocket upgrades on this server. Avoid an HMR websocket competing for them.
  server: { middlewareMode: true, hmr: false },
});
// Vite still allocates an unused websocket port with hmr:false; close it so only the app is exposed.
await vite.ws.close();
app.use(vite.middlewares);
httpServer.listen(Number(process.env.PORT || 5173), '0.0.0.0', () => {
  console.log('LIBO preview ready on 0.0.0.0:' + (process.env.PORT || 5173));
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  await vite.close();
  httpServer.close(() => process.exit(0));
});

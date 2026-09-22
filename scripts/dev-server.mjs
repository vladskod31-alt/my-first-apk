import express from 'express';
import http from 'node:http';
import { createServer as createViteServer } from 'vite';
import { ExpressPeerServer } from 'peer';

const app = express();
const httpServer = http.createServer(app);
const apkPath = new URL('../downloads/Swamp-Attack-1.0.0.apk', import.meta.url).pathname;
app.get('/Swamp-Attack-1.0.0.apk', (_request, response) => {
  response.set('Cache-Control', 'public, max-age=3600');
  response.download(apkPath, 'Swamp-Attack-1.0.0.apk');
});
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

import express from 'express';
import { adsApi } from './ads-api.mjs';
const app=express();
app.disable('x-powered-by');
app.use('/api/ads/v1',adsApi({ file:process.env.LIBO_ADS_FILE, adminToken:process.env.LIBO_ADS_ADMIN_TOKEN, origins:(process.env.LIBO_ADS_ORIGINS||'').split(',').filter(Boolean) }));
const server=app.listen(Number(process.env.PORT||8787),'0.0.0.0',()=>console.log('LIBO advertising API ready; TLS reverse proxy required for public deployment.'));
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>server.close(()=>process.exit(0)));

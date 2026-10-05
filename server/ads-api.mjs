import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { validateCampaign } from '../web/lib/orbit.mjs';

// Self-hosted advertising API, never reads a chat database. Events are untrusted
// aggregate diagnostics, NOT billable impressions or reward/payment evidence.
export function adsApi({ file, adminToken = '', origins = [], now = Date.now } = {}) {
  const router = express.Router(); const rate = new Map(), counts = new Map(); let writes = Promise.resolve();
  async function load() {
    if (!file) return [];
    const stat = await fs.stat(file); if (stat.size > 256000) throw new Error('Campaign file too large');
    const json = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!Array.isArray(json) || json.length > 50) throw new Error('At most 50 campaigns');
    const result = json.map(validateCampaign);
    if (new Set(result.map(c => c.id)).size !== result.length) throw new Error('Duplicate IDs');
    return result;
  }
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store').set('X-Content-Type-Options', 'nosniff');
    const origin = req.get('origin');
    if (origin && origins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin).set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization').set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    const ip = req.socket.remoteAddress || 'unknown', t = now();
    for (const [k,v] of rate) if (t - v.since > 60000) rate.delete(k);
    if (!rate.has(ip) && rate.size >= 1000) { res.sendStatus(503); return; }
    const r = rate.get(ip) || { since: t, hits: 0 }; r.hits++; rate.set(ip,r);
    if (r.hits > 120) { res.set('Retry-After','60').sendStatus(429); return; }
    next();
  });
  router.use(express.json({ limit: '256kb', strict: true }));
  const route = fn => (req,res,next) => Promise.resolve(fn(req,res)).catch(next);
  function admin(req,res,next) {
    if (!adminToken || adminToken.length < 32 || !file) { res.status(503).json({ error: 'Administration is not configured' }); return; }
    const input = Buffer.from(req.get('authorization') || ''); const expected = Buffer.from('Bearer ' + adminToken);
    if (input.length !== expected.length || !timingSafeEqual(input,expected)) { res.sendStatus(401); return; }
    next();
  }
  async function change(fn) {
    const action = writes.catch(() => {}).then(async () => {
      const current = await load(); const updated = fn(current);
      const text = JSON.stringify(updated,null,2);
      if(updated.length>50 || Buffer.byteLength(text)>256000)throw new Error('Campaign capacity exceeded');
      const tmp = file + '.tmp'; await fs.mkdir(path.dirname(file),{recursive:true});
      await fs.writeFile(tmp,text,{mode:0o600}); await fs.rename(tmp,file);
      return updated;
    }); writes = action; return action;
  }
  router.get('/health', (req,res) => res.json({ version: '1', mode: 'experimental', monetaryValue: false }));
  router.get('/campaigns', route(async (req,res) => {
    const campaigns = (await load()).filter(c => c.enabled && c.start <= now() && now() < c.end);
    res.json({ version: 1, campaigns });
  }));
  router.post('/events', route(async (req,res) => {
    const b=req.body;
    if (!b || Object.keys(b).some(k=>!['campaignId','type'].includes(k)) || !['impression','click'].includes(b.type) || typeof b.campaignId !== 'string') { res.status(400).json({error:'Only campaignId and type are accepted'});return; }
    const c=(await load()).find(c=>c.id===b.campaignId && c.enabled && c.start<=now() && now()<c.end);
    if(!c){res.sendStatus(404);return;}
    // Bounded memory; no IP, identity, chat content or per-user event records kept.
    if(counts.size>=100 && !counts.has(c.id))counts.delete(counts.keys().next().value);
    const old=counts.get(c.id)||{impression:0,click:0};old[b.type]=Math.min(Number.MAX_SAFE_INTEGER,old[b.type]+1);counts.set(c.id,old);
    res.status(202).json({accepted:true,billable:false});
  }));
  router.get('/stats',admin,(req,res)=>res.json({persistent:false,billable:false,campaigns:Object.fromEntries(counts)}));
  router.put('/campaigns/:id',admin,route(async(req,res)=>{
    let c;try{c=validateCampaign(req.body);if(c.id!==req.params.id)throw new Error('ID mismatch');}catch(e){res.status(400).json({error:e.message});return;}
    await change(all=>[...all.filter(x=>x.id!==c.id),c]);res.json(c);
  }));
  router.delete('/campaigns/:id',admin,route(async(req,res)=>{await change(all=>all.filter(c=>c.id!==req.params.id));res.sendStatus(204);}));
  router.use((err,req,res,next)=>{res.status(err.status===413?413:err instanceof SyntaxError?400:503).json({error:'Advertising API unavailable or invalid input'});});
  return router;
}

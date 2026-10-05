import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {adsApi} from '../server/ads-api.mjs';
test('API auth, persistent CRUD, consent-compatible feed, strict aggregate events and rate limit',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'libo-ads-')),file=path.join(dir,'ads.json');await fs.writeFile(file,'[]');
 const token='unit-test-only-'.repeat(3);const app=express();app.use('/api/ads/v1',adsApi({file,adminToken:token,origins:['https://appassets.androidplatform.net']}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/ads/v1`;
 const req=(p,method='GET',body,auth=false)=>fetch(base+p,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const campaign={id:'demo',title:'Hello',text:'Local',sponsor:'Test',url:'https://example.com',enabled:true,start:0,end:4102444800000,dailyCap:2,cooldownMinutes:1,weight:1};
 try{
  assert.equal((await req('/campaigns/demo','PUT',campaign)).status,401);
  assert.equal((await req('/campaigns/demo','PUT',campaign,true)).status,200);
  assert.equal(JSON.parse(await fs.readFile(file,'utf8'))[0].id,'demo');
  assert.equal((await (await req('/campaigns')).json()).campaigns.length,1);
  assert.equal((await req('/events','POST',{campaignId:'demo',type:'impression',peerId:'must-not-be-accepted'})).status,400);
  assert.equal((await req('/events','POST',{campaignId:'unknown',type:'click'})).status,404);
  assert.equal((await req('/events','POST',{campaignId:'demo',type:'click'})).status,202);
  assert.equal((await req('/stats')).status,401);
  const stats=await (await req('/stats','GET',null,true)).json();assert.equal(stats.campaigns.demo.click,1);assert.equal(stats.billable,false);
  assert.equal((await req('/campaigns/demo','DELETE',null,true)).status,204);
  assert.deepEqual((await (await req('/campaigns')).json()).campaigns,[]);
  const cors=await fetch(base+'/health',{headers:{Origin:'https://appassets.androidplatform.net'}});assert.equal(cors.headers.get('access-control-allow-origin'),'https://appassets.androidplatform.net');
  let last;for(let n=0;n<125;n++)last=await req('/health');assert.equal(last.status,429);
 }finally{await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});

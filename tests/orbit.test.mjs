import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DAY,initialOrbit,mutateOrbit,premium,validateCampaign,chooseCampaign,recordExposure,safeLink} from '../web/lib/orbit.mjs';
const now=20000*DAY;
const campaign=(changes={})=>validateCampaign({id:'test',title:'Title',text:'Text',sponsor:'LIBO',url:'https://example.com',enabled:true,start:0,end:now+10*DAY,dailyCap:2,cooldownMinutes:1,weight:1,...changes});
test('daily grant, UTC boundary, backward clock and immutable input',()=>{
 const original=initialOrbit();let s=mutateOrbit(original,{type:'daily'},now);
 assert.equal(s.coins,100);assert.equal(s.stars,5);assert.equal(original.coins,0);
 assert.throws(()=>mutateOrbit(s,{type:'daily'},now+DAY-1));assert.throws(()=>mutateOrbit(s,{type:'daily'},now-DAY));
 s=mutateOrbit(s,{type:'daily'},now+DAY);assert.equal(s.coins,200);
});
test('insufficient funds never mutate balances; premium costs 300 for 7 days, no auto-renew',()=>{
 let s=initialOrbit();assert.throws(()=>mutateOrbit(s,{type:'premium'},now));
 for(let n=0;n<3;n++)s=mutateOrbit(s,{type:'daily'},now+n*DAY);
 s=mutateOrbit(s,{type:'premium'},now+2*DAY);assert.equal(s.coins,0);assert.ok(premium(s,now+8*DAY));assert.equal(premium(s,now+9*DAY),false);
 assert.throws(()=>mutateOrbit(s,{type:'premium'},now+3*DAY));assert.throws(()=>mutateOrbit(s,{type:'accent',value:'ocean'},now+9*DAY));
});
test('exchange, collectibles and history bounds',()=>{
 let s=mutateOrbit(initialOrbit(),{type:'daily'},now);s=mutateOrbit(s,{type:'exchange'},now);
 assert.equal(s.coins,50);assert.equal(s.stars,10);s=mutateOrbit(s,{type:'collect',item:'moon'},now);assert.equal(s.stars,0);
 assert.throws(()=>mutateOrbit(s,{type:'collect',item:'moon'},now));assert.throws(()=>mutateOrbit(s,{type:'collect',item:'unknown'},now));
 for(let n=1;n<150;n++)s=mutateOrbit(s,{type:'daily'},now+n*DAY);assert.equal(s.ledger.length,100);
});
test('ads reject scripts, credentials, trackers, oversized fields and prototype IDs',()=>{
 for(const url of ['javascript:alert(1)','http://example.com','https://user:pass@example.com'])assert.throws(()=>safeLink(url));
 for(const change of [{id:'__proto__'},{image:'https://tracker.example/1.png'},{title:'a'.repeat(81)},{dailyCap:0},{weight:99},{end:0},{image:'data:image/svg+xml;base64,YQ=='}])assert.throws(()=>campaign(change));
 assert.equal(campaign({title:'<script>literal</script>'}).title,'<script>literal</script>');
});
test('automatic ad eligibility: schedule, daily cap, cooldown, pause and weighted selection',()=>{
 const a=campaign(), b=campaign({id:'second',weight:3});
 assert.equal(chooseCampaign([a,b],{},now,()=>.9).id,'second');
 let e=recordExposure({},a.id,now);assert.equal(chooseCampaign([a],e,now+1),null);
 assert.equal(chooseCampaign([a],e,now+60000).id,a.id);e=recordExposure(e,a.id,now+60000);
 assert.equal(chooseCampaign([a],e,now+120000),null);assert.equal(chooseCampaign([a],e,now+DAY).id,a.id);
 assert.equal(chooseCampaign([campaign({enabled:false})],{},now),null);assert.equal(chooseCampaign([campaign({start:now+1})],{},now),null);
});
test('ad exposure store bounded across rotating remote feeds',()=>{let e={};for(let n=0;n<300;n++)e=recordExposure(e,'ad-'+n,now);assert.equal(Object.keys(e).length,200);});

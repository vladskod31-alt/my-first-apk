import { OrbitStore, mutateOrbit, premium, validateCampaign, safeLink, chooseCampaign, recordExposure, DAY } from './orbit.mjs';

async function readFeed(endpoint, signal) {
  const res=await fetch(endpoint+'/campaigns',{signal,credentials:'omit',referrerPolicy:'no-referrer'});
  if(!res.ok)throw new Error('API недоступне');
  const reader=res.body.getReader();let bytes=0,parts=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>256000)throw new Error('Завелика відповідь API');parts.push(value);}}finally{await reader.cancel();}
  const data=new Uint8Array(bytes);let at=0;for(const part of parts){data.set(part,at);at+=part.length;}
  const json=JSON.parse(new TextDecoder().decode(data));
  if(json.version!==1 || !Array.isArray(json.campaigns) || json.campaigns.length>50)throw new Error('Невідомий формат API');
  const result=json.campaigns.map(validateCampaign);
  if(new Set(result.map(c=>c.id)).size!==result.length)throw new Error('Повторні ID API');
  return result;
}

export async function setupOrbit({openDialog,notify,locked}) {
  const $=s=>document.querySelector(s), db=new OrbitStore(); let state=await db.open(), ad=null, displayed=false, generation=0, controller, exposureTimer;
  const dismissed=new Set();
  const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('libo-orbit-sync'):null;
  const names={comet:'☄ Комета',moon:'☾ Місяць',satellite:'◇ Супутник'};
  const endpoint=()=>state.endpoint;
  function hideAd(){ad=null;displayed=false;clearTimeout(exposureTimer);$('#orbit-sponsor').hidden=true;}
  async function update(fn, announce=true){state=await db.update(fn);render();if(announce)channel?.postMessage('refresh');return state;}
  const act=fn=>async()=>{try{await fn();}catch(e){notify(e.message || 'Не вдалося виконати операцію',true);}};
  function render(){
    const active=premium(state);
    document.documentElement.dataset.orbit=active?state.accent:'violet';
    $('#orbit-coins').textContent=state.coins;$('#orbit-stars').textContent=state.stars;
    $('#orbit-status').textContent=active?`Orbit активний до ${new Date(state.premiumUntil).toLocaleString('uk')}`:'Безкоштовний профіль';
    $('#orbit-buy').disabled=active || state.coins<300;
    $('#orbit-claim').disabled=state.claimedDay>=Math.floor(Date.now()/DAY);
    $('#orbit-exchange').disabled=state.coins<50;
    $('#orbit-accent').disabled=!active;$('#orbit-accent').value=active?state.accent:'violet';
    $('#orbit-ads-enabled').checked=state.adsEnabled;$('#orbit-analytics').checked=state.analytics;
    $('#orbit-endpoint').value=state.endpoint;
    $('#orbit-collection').textContent=state.collectibles.map(k=>names[k]).join(' · ') || 'Колекція поки порожня';
    for(const b of document.querySelectorAll('[data-orbit-item]'))b.disabled=state.stars<10 || state.collectibles.includes(b.dataset.orbitItem);
    const history=$('#orbit-history');history.replaceChildren();
    for(const item of state.ledger){const li=document.createElement('li');li.textContent=`${new Date(item.at).toLocaleString('uk')} · ${item.title} · ${item.coins>0?'+':''}${item.coins} ◉ / ${item.stars>0?'+':''}${item.stars} ★`;history.append(li);}
    if(!state.ledger.length){const li=document.createElement('li');li.textContent='Операцій ще немає';history.append(li);}
    const list=$('#ad-campaigns');list.replaceChildren();
    for(const c of state.campaigns){
      const row=document.createElement('div');row.className='orbit-campaign';
      const name=document.createElement('strong');name.textContent=c.title;
      const detail=document.createElement('small');detail.textContent=`${c.enabled?'Увімкнено':'Пауза'} · ${c.dailyCap}/день · вага ${c.weight}`;
      const toggle=document.createElement('button');toggle.className='secondary-button';toggle.textContent=c.enabled?'Пауза':'Увімкнути';
      toggle.onclick=act(async()=>{await update(s=>({...s,campaigns:s.campaigns.map(x=>x.id===c.id?{...x,enabled:!x.enabled}:x)}));await refreshAds();});
      const edit=document.createElement('button');edit.className='secondary-button';edit.textContent='Редагувати';edit.onclick=()=>fillCampaign(c);
      const del=document.createElement('button');del.className='secondary-button';del.textContent='Видалити';
      del.onclick=act(async()=>{await update(s=>({...s,campaigns:s.campaigns.filter(x=>x.id!==c.id)}));await refreshAds();});
      row.append(name,detail,edit,toggle,del);list.append(row);
    }
    if(active || !state.adsEnabled || locked()){hideAd();controller?.abort();}
  }
  $('#open-orbit').onclick=act(async()=>{await update(s=>s,false);openDialog('orbit-dialog');});
  $('#orbit-claim').onclick=act(async()=>{await update(s=>mutateOrbit(s,{type:'daily'}));notify('+100 монет і +5 зірок. Без грошової вартості.');});
  $('#orbit-buy').onclick=act(async()=>{await update(s=>mutateOrbit(s,{type:'premium'}));notify('Orbit активний на 7 днів');});
  $('#orbit-exchange').onclick=act(()=>update(s=>mutateOrbit(s,{type:'exchange'})));
  $('#orbit-accent').onchange=act(()=>update(s=>mutateOrbit(s,{type:'accent',value:$('#orbit-accent').value})));
  for(const b of document.querySelectorAll('[data-orbit-item]'))b.onclick=act(()=>update(s=>mutateOrbit(s,{type:'collect',item:b.dataset.orbitItem})));
  $('#open-ad-studio').onclick=()=>{openDialog('ad-studio-dialog');render();};
  $('#ad-back').onclick=()=>openDialog('orbit-dialog');
  let editId=null, image='';
  const localDate=t=>{const d=new Date(t);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
  function fillCampaign(c){editId=c?.id||null;image=c?.image||'';$('#ad-title').value=c?.title||'';$('#ad-text').value=c?.text||'';$('#ad-sponsor').value=c?.sponsor||'';$('#ad-url').value=c?.url||'';$('#ad-start').value=localDate(c?.start||Date.now());$('#ad-end').value=localDate(c?.end||Date.now()+7*DAY);$('#ad-cap').value=c?.dailyCap||3;$('#ad-cooldown').value=c?.cooldownMinutes||30;$('#ad-weight').value=c?.weight||1;$('#ad-image').value='';$('#ad-image-status').textContent=image?'Зображення додано':'Без зображення';$('#ad-editor-title').textContent=c?'Редагування кампанії':'Нова кампанія';}
  $('#ad-new').onclick=()=>fillCampaign();fillCampaign();
  $('#ad-clear-image').onclick=()=>{image='';$('#ad-image').value='';$('#ad-image-status').textContent='Без зображення';};
  $('#ad-image').onchange=act(async()=>{
    const file=$('#ad-image').files[0];if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size>88000)throw new Error('PNG/JPEG/WebP до 85 КіБ');
    const bytes=await file.arrayBuffer();image=`data:${file.type};base64,${btoa(Array.from(new Uint8Array(bytes),c=>String.fromCharCode(c)).join(''))}`;$('#ad-image-status').textContent='Зображення додано';
  });
  $('#ad-editor').onsubmit=e=>{e.preventDefault();void act(async()=>{
    const c=validateCampaign({id:editId||crypto.randomUUID(),title:$('#ad-title').value,text:$('#ad-text').value,sponsor:$('#ad-sponsor').value,url:$('#ad-url').value,image,enabled:true,start:new Date($('#ad-start').value).getTime(),end:new Date($('#ad-end').value).getTime(),dailyCap:Number($('#ad-cap').value),cooldownMinutes:Number($('#ad-cooldown').value),weight:Number($('#ad-weight').value)});
    await update(s=>{if(s.campaigns.length>=20&&!s.campaigns.some(x=>x.id===c.id))throw new Error('Ліміт 20 локальних кампаній');const campaigns=[...s.campaigns.filter(x=>x.id!==c.id),c];if(new TextEncoder().encode(JSON.stringify(campaigns)).length>256000)throw new Error('Усі кампанії разом: максимум 256 КБ');return {...s,campaigns};});fillCampaign();notify('Збережено локально. Для інших пристроїв опублікуйте кампанію на власному API.');await refreshAds();
  })();};
  $('#ad-preferences').onsubmit=e=>{e.preventDefault();void act(async()=>{
    const value=$('#orbit-endpoint').value.trim();let url='';
    if(value){url=safeLink(value).replace(/\/$/,'');const parsed=new URL(url);if(parsed.search||parsed.hash)throw new Error('API URL без query-параметрів і токенів');}
    await update(s=>({...s,adsEnabled:$('#orbit-ads-enabled').checked,analytics:$('#orbit-analytics').checked,endpoint:url}));
    await refreshAds();notify('Налаштування реклами збережено');
  })();};
  $('#ad-export').onclick=()=>{if(window.LiboAndroid?.saveText){window.LiboAndroid.saveText('libo-campaigns.json',JSON.stringify(state.campaigns));return;}const blob=new Blob([JSON.stringify(state.campaigns)],{type:'application/json'});const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download='libo-campaigns.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  $('#ad-import').onchange=act(async()=>{const file=$('#ad-import').files[0];if(!file)return;if(file.size>256000)throw new Error('JSON до 256 КБ');const rows=JSON.parse(await file.text());if(!Array.isArray(rows)||rows.length>20)throw new Error('До 20 кампаній');const campaigns=rows.map(validateCampaign);if(new Set(campaigns.map(c=>c.id)).size!==campaigns.length)throw new Error('Повторні ID');await update(s=>({...s,campaigns}));$('#ad-import').value='';await refreshAds();notify('Локальні кампанії замінено імпортованими');});
  async function sendEvent(type,c){
    if(!state.analytics || !state.adsEnabled || premium(state) || !state.endpoint || !c.remote || locked())return;
    // No wallet, peer ID, chat or device identifier is sent. Metrics are optional.
    const ac=new AbortController(), timer=setTimeout(()=>ac.abort(),4000);
    try{await fetch(endpoint()+'/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({campaignId:c.id,type}),credentials:'omit',referrerPolicy:'no-referrer',signal:ac.signal});}catch{}finally{clearTimeout(timer);}
  }
  async function refreshAds(){
    const gen=++generation;controller?.abort();hideAd();
    if(!state.adsEnabled || premium(state) || locked())return;
    let campaigns=state.campaigns;
    if(state.endpoint){
      controller=new AbortController();const timer=setTimeout(()=>controller.abort(),4000);
      try{campaigns=(await readFeed(endpoint(),controller.signal)).map(c=>({...c,remote:true}));$('#ad-api-status').textContent='API: кампанії отримано';}
      catch{if(gen===generation)$('#ad-api-status').textContent='API недоступне або формат некоректний. Рекламу не показано.';return;}
      finally{clearTimeout(timer);}
    }else $('#ad-api-status').textContent='Локальні кампанії — тільки на цьому пристрої';
    if(gen!==generation || !state.adsEnabled || premium(state) || locked())return;
    ad=chooseCampaign(campaigns.filter(c=>!dismissed.has(c.id)),state.exposures);if(!ad)return;
    $('#sponsor-title').textContent=ad.title;$('#sponsor-text').textContent=ad.text;$('#sponsor-name').textContent=ad.sponsor;
    $('#sponsor-image').hidden=!ad.image;if(ad.image)$('#sponsor-image').src=ad.image;else $('#sponsor-image').removeAttribute('src');
    $('#sponsor-link').hidden=!ad.url;$('#sponsor-link').href=ad.url||'#';$('#orbit-sponsor').hidden=false;
    observer.unobserve($('#orbit-sponsor'));observer.observe($('#orbit-sponsor'));
  }
  const observer=new IntersectionObserver(entries=>{
    clearTimeout(exposureTimer);if(!entries[0]?.isIntersecting || entries[0].intersectionRatio<.5 || displayed || !ad || document.hidden || document.querySelector('dialog[open]'))return;
    const candidate=ad;
    exposureTimer=setTimeout(()=>{void (async()=>{
      if(ad!==candidate || locked() || document.hidden || document.querySelector('dialog[open]'))return;
      await update(s=>{if(!s.adsEnabled || premium(s) || !chooseCampaign([candidate],s.exposures))throw new Error('Ліміт показів');return {...s,exposures:recordExposure(s.exposures,candidate.id)};},false);
      displayed=true;await sendEvent('impression',candidate);
    })().catch(()=>hideAd());},1000);
  },{threshold:[0,.5,1]});
  for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('close',()=>{if(!document.querySelector('dialog[open]'))void refreshAds();});
  $('#sponsor-dismiss').onclick=()=>{if(ad)dismissed.add(ad.id);hideAd();};
  $('#sponsor-link').onclick=e=>{if(!ad){e.preventDefault();return;}void sendEvent('click',ad);};
  channel && (channel.onmessage=()=>void act(async()=>{await update(s=>s,false);await refreshAds();})());
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(exposureTimer);controller?.abort();}else void act(async()=>{await update(s=>s,false);await refreshAds();})();});
  setInterval(()=>{if(premium(state) && state.premiumUntil-Date.now()<30000 || locked())render();else if(document.documentElement.dataset.orbit!=='violet'&&!premium(state))render();},15000);
  render();await refreshAds();
  return {hide:()=>{generation++;controller?.abort();hideAd();}};
}

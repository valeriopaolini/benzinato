'use strict';
const APP_VERSION='1.1.0', SETTINGS_KEY='benza.settings.v1', SPLASH_KEY='benza.splashDate';
const ITALIAN_PROVINCES='AG:Agrigento|AL:Alessandria|AN:Ancona|AO:Aosta|AR:Arezzo|AP:Ascoli Piceno|AT:Asti|AV:Avellino|BA:Bari|BT:Barletta-Andria-Trani|BL:Belluno|BN:Benevento|BG:Bergamo|BI:Biella|BO:Bologna|BZ:Bolzano|BS:Brescia|BR:Brindisi|CA:Cagliari|CL:Caltanissetta|CB:Campobasso|CE:Caserta|CT:Catania|CZ:Catanzaro|CH:Chieti|CO:Como|CS:Cosenza|CR:Cremona|KR:Crotone|CN:Cuneo|EN:Enna|FM:Fermo|FE:Ferrara|FI:Firenze|FG:Foggia|FC:Forlì-Cesena|FR:Frosinone|GE:Genova|GO:Gorizia|GR:Grosseto|IM:Imperia|IS:Isernia|AQ:L’Aquila|SP:La Spezia|LT:Latina|LE:Lecce|LC:Lecco|LI:Livorno|LO:Lodi|LU:Lucca|MC:Macerata|MN:Mantova|MS:Massa-Carrara|MT:Matera|ME:Messina|MI:Milano|MO:Modena|MB:Monza e Brianza|NA:Napoli|NO:Novara|NU:Nuoro|OR:Oristano|PD:Padova|PA:Palermo|PR:Parma|PV:Pavia|PG:Perugia|PU:Pesaro e Urbino|PE:Pescara|PC:Piacenza|PI:Pisa|PT:Pistoia|PN:Pordenone|PZ:Potenza|PO:Prato|RG:Ragusa|RA:Ravenna|RC:Reggio Calabria|RE:Reggio Emilia|RI:Rieti|RN:Rimini|RM:Roma|RO:Rovigo|SA:Salerno|SS:Sassari|SV:Savona|SI:Siena|SR:Siracusa|SO:Sondrio|SU:Sud Sardegna|TA:Taranto|TE:Teramo|TR:Terni|TO:Torino|TP:Trapani|TN:Trento|TV:Treviso|TS:Trieste|UD:Udine|VA:Varese|VE:Venezia|VB:Verbano-Cusio-Ossola|VC:Vercelli|VR:Verona|VV:Vibo Valentia|VI:Vicenza|VT:Viterbo'.split('|').map(v=>{const[code,...name]=v.split(':');return{code,name:name.join(':')}});
const defaults={useGps:false,latitude:'',longitude:'',provinces:[],fuel:'',mode:'self',radius:10,sort:'price',freshHours:24,oldHours:72,navigator:/iPhone|iPad|Mac/.test(navigator.userAgent)?'apple':'google',lastCheck:null};
let settings={...defaults,...readSettings()},manifest=null,localData=[],map=null,markers=null,selectedStation=null,availableUpdate=false;
const $=id=>document.getElementById(id);
const fields={useGps:'use-gps',latitude:'latitude',longitude:'longitude',fuel:'fuel',mode:'mode',radius:'radius',sort:'sort',freshHours:'fresh-hours',oldHours:'old-hours',navigator:'navigator'};

function readSettings(){try{return JSON.parse(localStorage.getItem(SETTINGS_KEY))||{}}catch{return {}}}
function saveSettings(){localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings))}
function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function toast(message){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),2600)}
function humanDate(value){if(!value)return 'Mai';return new Intl.DateTimeFormat('it',{dateStyle:'short',timeStyle:'short'}).format(new Date(value))}
function today(){return new Date().toISOString().slice(0,10)}

function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open('benza-data-v2',1);req.onupgradeneeded=()=>req.result.createObjectStore('datasets',{keyPath:'key'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function dbAll(){const db=await openDb();return new Promise((resolve,reject)=>{const req=db.transaction('datasets').objectStore('datasets').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function dbPut(value){const db=await openDb();return new Promise((resolve,reject)=>{const req=db.transaction('datasets','readwrite').objectStore('datasets').put(value);req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error)})}
async function dbClear(){const db=await openDb();return new Promise((resolve,reject)=>{const req=db.transaction('datasets','readwrite').objectStore('datasets').clear();req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error)})}

async function getManifest(show=false){
  try{const response=await fetch(`data/manifest.json?t=${Date.now()}`,{cache:'no-cache'});if(!response.ok)throw new Error(`HTTP ${response.status}`);manifest=await response.json();validateManifest(manifest);settings.lastCheck=new Date().toISOString();saveSettings();availableUpdate=await hasUpdates();if(show)toast(availableUpdate?'Aggiornamenti disponibili':'I dati sono aggiornati');return true}
  catch(error){if(show)toast('Controllo non riuscito: sei offline?');return false}
  finally{renderDataStatus()}
}
function validateManifest(value){if(value?.schemaVersion!==2||!Array.isArray(value.provinces)||!Array.isArray(value.fuels))throw new Error('Manifest non valido')}
function manifestFuels(){return new Map((manifest?.fuels||[]).map(f=>[f.id,f.label]))}
function requiredFiles(){if(!manifest)return[];return manifest.provinces.filter(p=>settings.provinces.includes(p.code)).map(p=>({...p,province:p.code,key:p.code}))}
async function hasUpdates(){const local=new Map((await dbAll()).map(d=>[d.key,d]));return requiredFiles().some(f=>local.get(f.key)?.sha256!==f.sha256)}
async function downloadData(){
  if(!settings.provinces.length)return toast('Seleziona almeno una provincia');
  if(!manifest&&!await getManifest())return toast('Manifest non disponibile');
  const files=requiredFiles(),local=new Map((await dbAll()).map(d=>[d.key,d])),needed=files.filter(f=>local.get(f.key)?.sha256!==f.sha256);
  if(!needed.length)return toast('I dati necessari sono già aggiornati');
  const button=$('download-data');button.disabled=true;button.textContent=`Download 0/${needed.length}`;
  try{for(let i=0;i<needed.length;i++){const file=needed[i],response=await fetch(file.path,{cache:'no-cache'});if(!response.ok)throw new Error(file.path);const payload=await response.json();if(payload?.schemaVersion!==2||payload.province!==file.province||!Array.isArray(payload.stations))throw new Error('Dataset non valido');await dbPut({key:file.key,province:file.province,sha256:file.sha256,generatedAt:manifest.generatedAt,stations:payload.stations,bytes:file.bytes});button.textContent=`Download ${i+1}/${needed.length}`}
    availableUpdate=false;await loadLocal();toast('Dati aggiornati');renderCurrent()
  }catch{toast('Download interrotto. I dati già presenti restano disponibili')}
  finally{button.disabled=false;button.textContent='Scarica / aggiorna dati';renderDataStatus()}
}
async function loadLocal(){const all=await dbAll();localData=all.filter(d=>settings.provinces.includes(d.province));renderDataStatus()}

function syncForm(){for(const[key,id]of Object.entries(fields)){const el=$(id);if(el.type==='checkbox')el.checked=!!settings[key];else el.value=settings[key]??''}toggleCoordinates();syncQuick();renderProvinces();renderFuelOptions()}
function updateFromForm(){
  for(const[key,id]of Object.entries(fields)){const el=$(id);settings[key]=el.type==='checkbox'?el.checked:el.type==='number'?(el.value===''?'':Number(el.value)):el.value}
  const error=validateSettings();if(error){$('settings-message').hidden=false;$('settings-message').textContent=error;return false}$('settings-message').hidden=true;saveSettings();syncQuick();return true
}
function validateSettings(){if(!settings.useGps){const lat=Number(settings.latitude),lon=Number(settings.longitude);if(settings.latitude!==''&&(!Number.isFinite(lat)||lat< -90||lat>90))return'Latitudine non valida.';if(settings.longitude!==''&&(!Number.isFinite(lon)||lon< -180||lon>180))return'Longitudine non valida.'}if(!Number.isInteger(settings.radius)||settings.radius<=0)return'Il raggio deve essere un intero maggiore di zero.';if(!Number.isInteger(settings.freshHours)||settings.freshHours<=0||!Number.isInteger(settings.oldHours)||settings.oldHours<=settings.freshHours)return'Le soglie devono essere intere, positive e la seconda maggiore della prima.';return''}
function toggleCoordinates(){$('latitude').disabled=settings.useGps;$('longitude').disabled=settings.useGps;$('locate').hidden=!settings.useGps}
function renderProvinces(filter=''){const provinces=ITALIAN_PROVINCES;$('province-list').innerHTML=provinces.filter(p=>`${p.name} ${p.code}`.toLowerCase().includes(filter.toLowerCase())).map(p=>`<label><input type="checkbox" data-province="${p.code}" ${settings.provinces.includes(p.code)?'checked':''}> ${esc(p.name)} <small>(${p.code})</small></label>`).join('')}
function renderFuelOptions(){const fuels=manifestFuels(),options=[...fuels].map(([id,label])=>`<option value="${esc(id)}">${esc(label)}</option>`).join('');$('fuel').innerHTML=options;if(fuels.has(settings.fuel))$('fuel').value=settings.fuel;if(!settings.fuel&&fuels.size){settings.fuel=fuels.keys().next().value;saveSettings();$('fuel').value=settings.fuel}}
function syncQuick(){$('quick-sort').value=settings.sort}

function currentLocation(){const lat=Number(settings.latitude),lon=Number(settings.longitude);return Number.isFinite(lat)&&Number.isFinite(lon)&&settings.latitude!==''&&settings.longitude!==''?[lat,lon]:null}
function distanceKm(a,b,c,d){const rad=Math.PI/180,x=(c-a)*rad,y=(d-b)*rad,sa=Math.sin(x/2),sb=Math.sin(y/2),v=sa*sa+Math.cos(a*rad)*Math.cos(c*rad)*sb*sb;return 6371*2*Math.atan2(Math.sqrt(v),Math.sqrt(1-v))}
function ageInfo(reportedAt){const hours=Math.max(0,(Date.now()-new Date(reportedAt).getTime())/36e5);return{hours,state:hours<=settings.freshHours?'fresh':hours<=settings.oldHours?'aging':'stale',text:hours<1?'meno di 1 h fa':hours<48?`${Math.floor(hours)} h fa`:`${Math.floor(hours/24)} gg fa`}}
function representativeOffer(station){const offers=station.offers.filter(o=>o.group===settings.fuel&&o.isSelf===(settings.mode==='self')),preferred=offers.filter(o=>o.primary),candidates=preferred.length?preferred:offers;return candidates.sort((a,b)=>a.price-b.price)[0]||null}
function matchingRecords(withRadius=true){const origin=currentLocation(),records=localData.flatMap(d=>d.stations).map(station=>{const offer=representativeOffer(station);return offer?{...station,...offer,offers:station.offers,distance:origin?distanceKm(origin[0],origin[1],station.latitude,station.longitude):null}:null}).filter(Boolean),filtered=withRadius&&origin?records.filter(r=>r.distance<=settings.radius):records;return filtered.sort(settings.sort==='distance'?(a,b)=>(a.distance??Infinity)-(b.distance??Infinity)||a.price-b.price:(a,b)=>a.price-b.price||(a.distance??Infinity)-(b.distance??Infinity))}
function renderRanking(){
  const list=$('ranking-list'),summary=$('ranking-summary'),label=manifestFuels().get(settings.fuel)||'Carburante',criteria=`${label} · ${settings.mode==='self'?'Self-service':'Servito'} · ${settings.radius} km`;summary.textContent=criteria;
  if(!settings.provinces.length)return empty(list,'Nessuna provincia configurata','Apri Impostazioni e scegli le province da usare.','Impostazioni',()=>showView('settings'));
  if(!localData.length)return empty(list,'Dati non scaricati','Scarica i dati delle province configurate.','Scarica dati',downloadData);
  if(!currentLocation())return empty(list,'Posizione necessaria','Configura il GPS o inserisci coordinate manuali valide.','Impostazioni',()=>showView('settings'));
  const records=matchingRecords();if(!records.length)return empty(list,'Nessun distributore trovato','Prova ad aumentare il raggio o cambiare carburante e modalità.');
  const average=records.reduce((total,r)=>total+r.price,0)/records.length;summary.innerHTML=`<span>${esc(criteria)}</span><strong>Prezzo medio € ${average.toFixed(3)}</strong>`;
  list.innerHTML=records.map(r=>{const age=ageInfo(r.reportedAt);return`<article class="station" data-id="${r.id}"><div class="price ${age.state}"><span>€ ${r.price.toFixed(3)}</span><small>${age.text}</small><small class="price-distance">${r.distance.toFixed(r.distance<10?1:0)} km</small></div><div><h3>${esc(r.name)}${r.brand?` · ${esc(r.brand)}`:''}</h3><p>${r.isSelf?'Self-service':'Servito'}</p><p>${esc(r.address)} · ${esc(r.municipality)}</p></div><button class="nav-out" data-nav="${r.id}" aria-label="Apri navigatore">➜</button></article>`}).join('');
  list.querySelectorAll('.station').forEach(el=>el.addEventListener('click',()=>{selectedStation=records.find(x=>String(x.id)===el.dataset.id);showView('map')}));list.querySelectorAll('[data-nav]').forEach(el=>el.addEventListener('click',event=>{event.stopPropagation();openNavigation(records.find(x=>String(x.id)===el.dataset.nav))}))
}
function empty(container,title,text,action,handler){container.innerHTML=`<div class="empty"><strong>${title}</strong><span>${text}</span>${action?`<br><button id="empty-action">${action}</button>`:''}</div>`;if(handler)$('empty-action').onclick=handler}
function notice(){const el=$('notice');if(!settings.provinces.length)el.hidden=true;else if(availableUpdate){el.innerHTML='Sono disponibili dati nuovi o mancanti. <button id="notice-action">Scarica</button>';el.hidden=false;$('notice-action').onclick=downloadData}else if(settings.lastCheck&&Date.now()-new Date(settings.lastCheck)>864e5){el.textContent='È passato più di un giorno: controlla se ci sono aggiornamenti.';el.hidden=false}else el.hidden=true}

function initMap(){if(map||!window.L)return;map=L.map('map',{zoomControl:false}).setView([42.5,12.5],6);L.control.zoom({position:'topright'}).addTo(map);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);markers=L.layerGroup().addTo(map);map.on('moveend',renderMapMarkers)}
function renderMap(){initMap();renderMapDetail();setTimeout(()=>{map?.invalidateSize();const all=selectedStation?[selectedStation]:matchingRecords(false);if(selectedStation)map.setView([selectedStation.latitude,selectedStation.longitude],16);else if(currentLocation()&&map.getZoom()<7)map.setView(currentLocation(),11);renderMapMarkers();$('map-empty').hidden=all.length>0;$('map-empty').textContent=all.length?'':'Nessun distributore nei dati caricati. La mappa non scarica altre province.'},50)}
function renderMapDetail(){const el=$('map-detail');if(!selectedStation){el.hidden=true;el.innerHTML='';return}const r=selectedStation,distance=r.distance==null?'':`${r.distance.toFixed(r.distance<10?1:0)} km · `,labels=manifestFuels(),order=new Map([...labels.keys()].map((id,index)=>[id,index])),groups=[...new Set(r.offers.map(o=>o.group))].sort((a,b)=>(order.get(a)??99)-(order.get(b)??99)),prices=groups.map(group=>`<section class="fuel-group"><h3>${esc(labels.get(group)||group)}</h3>${r.offers.filter(o=>o.group===group).sort((a,b)=>Number(b.primary)-Number(a.primary)||Number(b.isSelf)-Number(a.isSelf)||a.price-b.price).map(o=>{const age=ageInfo(o.reportedAt);return`<div class="fuel-offer"><span><strong>${esc(o.product)}</strong><small>${o.isSelf?'Self-service':'Servito'}${o.primary?' · principale':''}</small></span><span class="offer-price ${age.state}">€ ${o.price.toFixed(3)}<small>${age.text}</small></span></div>`}).join('')}</section>`).join('');el.innerHTML=`<div class="station-detail-head"><div><h2>${esc(r.name)}${r.brand?` · ${esc(r.brand)}`:''}</h2><p>${distance}${esc(r.address)} · ${esc(r.municipality)}</p></div><button id="map-navigate" class="nav-out" aria-label="Apri navigatore">➜</button></div><div class="station-fuels">${prices}</div>`;el.hidden=false;$('map-navigate').onclick=()=>openNavigation(r)}
function renderMapMarkers(){if(!map||!markers)return;markers.clearLayers();const records=selectedStation?[selectedStation]:matchingRecords(false).filter(r=>map.getBounds().contains([r.latitude,r.longitude]));for(const r of records){const age=ageInfo(r.reportedAt),icon=L.divIcon({className:'price-marker',html:`<div class="${age.state}" aria-label="€ ${r.price.toFixed(3)}, ${age.text}">€${r.price.toFixed(3)}</div>`,iconSize:[64,30],iconAnchor:[32,15]});L.marker([r.latitude,r.longitude],{icon,title:`${r.name}, € ${r.price.toFixed(3)}`}).on('click',()=>openNavigation(r)).addTo(markers)}}
function openNavigation(r){const q=encodeURIComponent(`${r.latitude},${r.longitude}`),label=encodeURIComponent(r.name||'Distributore');let url=settings.navigator==='waze'?`https://www.waze.com/ul?ll=${q}&navigate=yes`:settings.navigator==='apple'?`https://maps.apple.com/?daddr=${q}&q=${label}`:`https://www.google.com/maps/dir/?api=1&destination=${q}`;window.open(url,'_blank','noopener')}
function showView(name){document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));document.querySelectorAll('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===name));$('page-title').textContent={ranking:'Classifica',map:'Mappa',settings:'Impostazioni'}[name];if(name==='ranking')renderRanking();if(name==='map')renderMap();if(name==='settings')renderDataStatus()}
function renderCurrent(){notice();if($('view-ranking').classList.contains('active'))renderRanking();if($('view-map').classList.contains('active'))renderMap()}
async function renderDataStatus(){const all=await dbAll().catch(()=>[]);$('last-check').textContent=humanDate(settings.lastCheck);$('local-generated').textContent=humanDate(all.map(x=>x.generatedAt).sort().at(-1));$('storage-size').textContent=`${(all.reduce((n,x)=>n+(x.bytes||JSON.stringify(x.stations).length),0)/1024).toFixed(1)} KB`;notice()}
async function locationPermissionState(){
  try{if(!navigator.permissions?.query)return'non supportato';return(await navigator.permissions.query({name:'geolocation'})).state}
  catch(error){return`non disponibile: ${error.message||error.name}`}
}
async function locate(){
  const status=$('location-status'),permission=await locationPermissionState(),context=`HTTPS: ${window.isSecureContext?'sì':'no'} · permesso API: ${permission} · modalità: ${window.matchMedia('(display-mode: standalone)').matches?'web app':'Safari'}`;
  if(!navigator.geolocation){status.textContent=`Geolocalizzazione non disponibile. ${context}`;return}
  status.textContent=`Ricerca posizione… ${context}`;
  navigator.geolocation.getCurrentPosition(pos=>{settings.latitude=pos.coords.latitude;settings.longitude=pos.coords.longitude;saveSettings();status.textContent=`Posizione aggiornata (precisione ${Math.round(pos.coords.accuracy)} m). ${context}`;renderCurrent()},error=>{const names={1:'PERMISSION_DENIED',2:'POSITION_UNAVAILABLE',3:'TIMEOUT'};status.textContent=`GPS ${names[error.code]||'ERRORE'} (${error.code}): ${error.message||'nessun dettaglio da Safari'}. ${context}`;console.error('Geolocation error',{code:error.code,message:error.message,permission,secureContext:window.isSecureContext})},{enableHighAccuracy:true,timeout:12000,maximumAge:300000})
}

function bind(){
  document.querySelectorAll('.bottom-nav button').forEach(b=>b.onclick=()=>{selectedStation=null;showView(b.dataset.view)});$('sync-shortcut').onclick=()=>getManifest(true);$('check-updates').onclick=async()=>{await getManifest(true);renderFuelOptions();renderProvinces()};$('download-data').onclick=downloadData;$('locate').onclick=locate;
  for(const id of Object.values(fields))$(id).addEventListener('change',async()=>{if(updateFromForm()){toggleCoordinates();await loadLocal();renderCurrent()}});
  $('quick-sort').addEventListener('change',()=>{settings.sort=$('quick-sort').value;saveSettings();syncForm();renderCurrent()});
  $('province-list').addEventListener('change',async e=>{if(!e.target.dataset.province)return;settings.provinces=e.target.checked?[...new Set([...settings.provinces,e.target.dataset.province])]:settings.provinces.filter(p=>p!==e.target.dataset.province);saveSettings();await loadLocal();availableUpdate=await hasUpdates();renderCurrent()});$('province-search').oninput=e=>renderProvinces(e.target.value);
  $('select-all').onclick=()=>selectProvinces(true);$('select-none').onclick=()=>selectProvinces(false);
  $('clear-data').onclick=async()=>{if(confirm('Svuotare tutti i dati scaricati?')){await dbClear();await loadLocal();toast('Dati scaricati eliminati');renderCurrent()}};
  $('reset-settings').onclick=async()=>{if(confirm('Ripristinare tutte le impostazioni?')){settings={...defaults};saveSettings();syncForm();await loadLocal();renderCurrent();toast('Impostazioni ripristinate')}}
}
async function selectProvinces(all){settings.provinces=all?ITALIAN_PROVINCES.map(p=>p.code):[];saveSettings();renderProvinces($('province-search').value);await loadLocal();availableUpdate=await hasUpdates();renderCurrent()}
async function start(){
  const splash=$('splash');if(localStorage.getItem(SPLASH_KEY)!==today()){splash.hidden=false;localStorage.setItem(SPLASH_KEY,today());requestAnimationFrame(()=>setTimeout(()=>splash.hidden=true,1500))}
  bind();await getManifest(false);renderFuelOptions();syncForm();await loadLocal();availableUpdate=await hasUpdates();renderCurrent();if(settings.useGps)locate();if('serviceWorker'in navigator)navigator.serviceWorker.register('service-worker.js').catch(()=>{});window.addEventListener('online',()=>toast('Connessione ripristinata'));window.addEventListener('offline',()=>toast('Offline: uso i dati locali'))
}
start();

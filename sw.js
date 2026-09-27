const CACHE='riftmastery-v0.1.1';
const ASSETS=['./','./index.html','./styles.css','./app.js','./db.js','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{const clone=response.clone();caches.open(CACHE).then(c=>c.put(event.request,clone));return response;}).catch(()=>caches.match('./index.html'))));
});

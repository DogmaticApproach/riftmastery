const CACHE='riftmastery-v0.2.0';
const SCOPE=self.registration.scope;
const INDEX=new URL('./index.html',SCOPE).href;
const ASSETS=[
  new URL('./',SCOPE).href,
  INDEX,
  new URL('./styles.css',SCOPE).href,
  new URL('./app.js',SCOPE).href,
  new URL('./db.js',SCOPE).href,
  new URL('./manifest.webmanifest',SCOPE).href,
  new URL('./icon.svg',SCOPE).href
];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(cache=>cache.addAll(ASSETS))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;

  if(req.mode==='navigate'){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE);
      const cachedIndex=await cache.match(INDEX);
      if(cachedIndex){
        event.waitUntil(
          fetch(INDEX,{cache:'no-store'})
            .then(response=>response.ok?cache.put(INDEX,response.clone()):undefined)
            .catch(()=>undefined)
        );
        return cachedIndex;
      }
      try{
        const response=await fetch(req);
        if(response.ok) await cache.put(INDEX,response.clone());
        return response;
      }catch{
        return new Response(
          '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;background:#0b0d10;color:#fff;padding:24px"><h1>RiftMastery</h1><p>Offline files are not ready yet. Reconnect once, reload RiftMastery, then try again.</p></body>',
          {headers:{'Content-Type':'text/html'}}
        );
      }
    })());
    return;
  }

  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const cached=await cache.match(req);
    if(cached) return cached;
    try{
      const response=await fetch(req);
      if(response.ok && new URL(req.url).origin===location.origin) await cache.put(req,response.clone());
      return response;
    }catch{
      return new Response('',{status:503,statusText:'Offline'});
    }
  })());
});

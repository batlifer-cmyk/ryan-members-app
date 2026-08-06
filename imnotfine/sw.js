const CACHE='imnotfine-v2';
const ASSETS=['./','./index.html','./styles.css','./app.js','./config.js','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method==='POST'&&url.pathname.endsWith('/share-target')){
    event.respondWith((async()=>{
      const form=await event.request.formData();
      const file=form.get('image');
      const text=form.get('text')||'';
      if(file&&file.size) await saveShared({file,text,createdAt:Date.now()});
      return Response.redirect('./?shared=1',303);
    })());
    return;
  }
  if(event.request.method!=='GET') return;
  event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));return res}).catch(()=>caches.match('./index.html'))));
});
function saveShared(payload){return new Promise((resolve,reject)=>{const req=indexedDB.open('imnotfine-share',1);req.onupgradeneeded=()=>req.result.createObjectStore('inbox');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const tx=req.result.transaction('inbox','readwrite');tx.objectStore('inbox').put(payload,'latest');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)}})}
